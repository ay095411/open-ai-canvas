import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = "LearnPrompt/awesome-seedance";
const webRoot = fileURLToPath(new URL("../", import.meta.url));

function videoUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            !url.search &&
            !url.hash &&
            url.hostname === "media.goodcase.ai" &&
            /^(\/media\/(video|goodcase)\/|\/cases\/|\/supabase-legacy\/case-media\/).+\.mp4$/i.test(url.pathname)
        );
    } catch {
        return false;
    }
}

function sourceUrl(value) {
    try {
        const url = new URL(value);
        return typeof value === "string" && url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}

export function buildInspirationVideoMapping(datasets) {
    const entries = new Map();
    const ignored = [];
    for (const dataset of datasets) {
        const cases = Array.isArray(dataset.payload) ? dataset.payload : dataset.payload?.cases;
        if (!Array.isArray(cases) || !cases.length || cases.length > 5000) throw new Error("上游 cases.json 格式或数量不正确");
        for (const item of cases) {
            if (item?.mediaType !== "video" || typeof item.slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(item.slug) || !sourceUrl(item.sourceUrl) || !videoUrl(item.mediaUrl)) {
                ignored.push({ slug: typeof item?.slug === "string" ? item.slug : null, revision: dataset.revision, reason: "missing-or-unsupported-public-video" });
                continue;
            }
            const id = `seedance:${item.slug}`;
            // The catalog's pinned revision wins; never swap its media for a model retest.
            if (!entries.has(id)) entries.set(id, { id, sourceId: "seedance", sourceUrl: item.sourceUrl, videoUrl: item.mediaUrl, revision: dataset.revision });
        }
    }
    return { entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id, "en")), ignored };
}

async function fetchBytes(url) {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "open-ai-canvas-inspiration-video-import" }, signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > 12 * 1024 * 1024) throw new Error("上游 JSON 超过大小上限");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 12 * 1024 * 1024) throw new Error("上游 JSON 超过大小上限");
    return bytes;
}

async function main() {
    const { values } = parseArgs({ options: { "pinned-file": { type: "string" }, "latest-file": { type: "string" }, "latest-ref": { type: "string" }, output: { type: "string" } }, strict: true });
    const manifest = JSON.parse(await readFile(resolve(webRoot, "public/inspirations/manifest.json"), "utf8"));
    const pinnedRef = manifest.sources?.seedance?.revision;
    if (!/^[a-f0-9]{40}$/.test(pinnedRef ?? "")) throw new Error("官方目录缺少 Seedance 精确版本");
    let latestRef = values["latest-ref"];
    if (!latestRef) latestRef = JSON.parse((await fetchBytes(`https://api.github.com/repos/${repo}/commits/main`)).toString("utf8")).sha;
    if (!/^[a-f0-9]{40}$/.test(latestRef ?? "")) throw new Error("上新数据缺少精确 Git commit");
    const datasets = [];
    for (const [revision, localFile] of [
        [pinnedRef, values["pinned-file"]],
        [latestRef, values["latest-file"]],
    ]) {
        const url = `https://raw.githubusercontent.com/${repo}/${revision}/data/cases.json`;
        const bytes = localFile ? await readFile(resolve(localFile)) : await fetchBytes(url);
        if (bytes.length > 12 * 1024 * 1024) throw new Error("上游 JSON 超过大小上限");
        datasets.push({ revision, url, sha256: createHash("sha256").update(bytes).digest("hex"), payload: JSON.parse(bytes.toString("utf8")) });
    }
    const { entries, ignored } = buildInspirationVideoMapping(datasets);
    if (!entries.length) throw new Error("未提取到可用视频地址，不覆盖现有文件");
    const catalog = JSON.parse(await readFile(resolve(webRoot, "public/inspirations/seedance.json"), "utf8"));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const missingCatalogIds = catalog.entries.filter((entry) => byId.get(entry.id)?.sourceUrl !== entry.sourceUrl).map((entry) => entry.id);
    if (missingCatalogIds.length) throw new Error(`有 ${missingCatalogIds.length} 条固定目录无法按 ID 和原始出处精确匹配，拒绝替换补充文件`);
    const result = {
        version: 1,
        repository: `https://github.com/${repo}`,
        extractedAt: new Date().toISOString(),
        sources: datasets.map(({ payload, ...source }) => source),
        coverage: { staticVideoEntries: catalog.entries.length, matchedStaticVideoEntries: catalog.entries.length - missingCatalogIds.length },
        entries,
    };
    const output = resolve(values.output ?? resolve(webRoot, "public/inspiration-video-urls.json"));
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ output, ...result.coverage, extractedVideoLinks: entries.length, ignored }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
