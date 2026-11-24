import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildInspirationVideoMapping } from "../scripts/import-inspiration-videos.mjs";
import { buildOfficialCatalog, readOfficialCatalogPack } from "@/lib/inspirations/official-catalog";
import { enrichInspirationVideos, publicInspirationVideoUrl, readInspirationVideoLinks } from "@/lib/inspirations/video-enrichment";
import { getInspirationPrompt } from "@/services/api/online-gallery";
import { apiClient } from "@/services/api/request";
import { invalidateInspirationCatalog, loadInspirationCatalog } from "@/services/inspiration-catalog";

const sources = ["seedance", "haohaoxue", "youmind"] as const;
const payloads = sources.map((source) => JSON.parse(readFileSync(new URL(`../public/inspirations/${source}.json`, import.meta.url), "utf8")));
const packs = sources.map((source, index) => readOfficialCatalogPack(payloads[index], source, source));
const manifest = JSON.parse(readFileSync(new URL("../public/inspirations/manifest.json", import.meta.url), "utf8"));
const supplement = JSON.parse(readFileSync(new URL("../public/inspiration-video-urls.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
const originalAdapter = apiClient.defaults.adapter;
const originalWarn = console.warn;
const row = { id: "seedance:case", sourceId: "seedance", sourceUrl: "https://x.com/author/status/123", videoUrl: "https://media.goodcase.ai/cases/case.mp4" };

afterEach(() => {
    globalThis.fetch = originalFetch;
    apiClient.defaults.adapter = originalAdapter;
    console.warn = originalWarn;
    invalidateInspirationCatalog();
});

test("真实官方补充映射覆盖767静态视频，正文、封面、署名、来源、顺序及总量均不变", () => {
    const links = readInspirationVideoLinks(supplement);
    expect(links.rejectedCount).toBe(0);
    expect(links.entries.length).toBeGreaterThanOrEqual(767);
    expect(supplement.coverage).toEqual({ staticVideoEntries: 767, matchedStaticVideoEntries: 767 });
    const plain = buildOfficialCatalog(packs, manifest);
    const enriched = buildOfficialCatalog(packs, manifest, null, links);
    expect(enriched.entries).toHaveLength(1341);
    const videos = enriched.entries.filter((entry) => entry.sourceId === "seedance");
    expect(videos).toHaveLength(767);
    expect(videos.every((entry) => publicInspirationVideoUrl(entry.videoUrl))).toBe(true);
    for (let index = 0; index < plain.entries.length; index += 1) {
        const { videoUrl, ...entry } = enriched.entries[index];
        expect(entry).toEqual(plain.entries[index]);
    }
    expect(enriched.entries.filter((entry) => entry.sourceId !== "seedance").every((entry) => !entry.videoUrl)).toBe(true);
});

test("仅允许公开CDN的真实MP4路径，拒绝页面、私网、未知主机、凭据和签名冻结", () => {
    for (const path of ["/cases/case.mp4", "/media/video/case.mp4", "/media/goodcase/case.mp4", "/supabase-legacy/case-media/case.mp4"]) expect(publicInspirationVideoUrl(`https://media.goodcase.ai${path}`)).toBe(true);
    for (const url of [
        "http://media.goodcase.ai/cases/case.mp4",
        "https://goodcase.ai/media/goodcase/case.mp4",
        "https://localhost/cases/case.mp4",
        "https://127.0.0.1/cases/case.mp4",
        "https://media.goodcase.ai.evil.test/cases/case.mp4",
        "https://user:secret@media.goodcase.ai/cases/case.mp4",
        "https://media.goodcase.ai:8443/cases/case.mp4",
        "https://media.goodcase.ai/cases/case.mp4?token=expired",
        "https://media.goodcase.ai/cases/case.mp4#token",
        "https://media.goodcase.ai/cases/page.html",
        "javascript:alert(1)",
    ])
        expect(publicInspirationVideoUrl(url)).toBe(false);
});

test("非法行独立拒绝，冲突ID全部隐藏，不能把签名链接或审核身份塞入官方映射", () => {
    expect(() => readInspirationVideoLinks({ version: 2, entries: [] })).toThrow("版本");
    const links = readInspirationVideoLinks({
        version: 1,
        entries: [
            row,
            { ...row, id: "seedance:expired", expiresAt: "2020-01-01" },
            { ...row, id: "authorized-library:case", sourceId: "authorized-library" },
            { ...row, id: "seedance:bad", videoUrl: "https://unknown.test/case.mp4" },
            { ...row, id: "seedance:licensed", authorization: {} },
        ],
    });
    expect(links.entries).toEqual([row]);
    expect(links.rejectedCount).toBe(4);
    const conflict = readInspirationVideoLinks({ version: 1, entries: [row, { ...row, videoUrl: "https://media.goodcase.ai/cases/other.mp4" }] });
    expect(conflict.entries).toEqual([]);
    expect(conflict.rejectedCount).toBe(2);
});

test("精确ID加原始出处匹配，只补视频地址，不覆盖原地址或混入图片/审核库", () => {
    const item = { ...row, videoUrl: undefined, mode: "video", prompt: "原始正文" };
    const links = readInspirationVideoLinks({ version: 1, entries: [row] });
    expect(enrichInspirationVideos([item], links)[0]).toEqual({ ...item, videoUrl: row.videoUrl });
    for (const changed of [
        { ...item, sourceUrl: "https://x.com/other/status/123" },
        { ...item, id: "seedance:other" },
        { ...item, sourceId: "authorized-library" },
        { ...item, mode: "image" },
        { ...item, videoUrl: "https://cdn.example.com/original.mp4" },
    ])
        expect(enrichInspirationVideos([changed], links)[0]).toBe(changed);
});

test("提取器从原案例mediaUrl读取，固定版本优先，不误用其他模型retests的artifactUrl", () => {
    const item = { slug: "case", mediaType: "video", sourceUrl: row.sourceUrl, mediaUrl: row.videoUrl, retests: [{ artifactUrl: "https://media.goodcase.ai/cases/wrong-model.mp4" }] };
    const mapping = buildInspirationVideoMapping([
        { revision: "pinned", payload: { cases: [item] } },
        {
            revision: "latest",
            payload: {
                cases: [
                    { ...item, mediaUrl: "https://media.goodcase.ai/cases/new-version.mp4" },
                    { ...item, slug: "new", mediaUrl: "https://media.goodcase.ai/cases/new.mp4" },
                    { ...item, slug: "missing", mediaUrl: undefined },
                ],
            },
        },
    ]);
    expect(mapping.entries.find((entry: { id: string }) => entry.id === row.id)?.videoUrl).toBe(row.videoUrl);
    expect(mapping.entries).toHaveLength(2);
    expect(mapping.ignored).toHaveLength(1);
    expect(JSON.stringify(mapping.entries)).not.toContain("wrong-model");
});

function mockCatalog(videoStatus = 200) {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === "/inspiration-video-urls.json") return new Response(JSON.stringify(supplement), { status: videoStatus });
        const index = sources.findIndex((source) => url === `/inspirations/${source}.json`);
        return new Response(JSON.stringify(index >= 0 ? payloads[index] : manifest), { status: 200 });
    }) as typeof globalThis.fetch;
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { enabled: false, entries: [] }, msg: "ok" } });
    return requests;
}

test("真实业务加载和收藏详情共享补充目录，静态条目得到地址且不新增业务API请求", async () => {
    const requests = mockCatalog();
    const [catalog, detail] = await Promise.all([loadInspirationCatalog(), getInspirationPrompt(packs[0][0].id)]);
    expect(catalog.entries).toHaveLength(1341);
    expect(publicInspirationVideoUrl(detail.videoUrl)).toBe(true);
    expect(requests.filter((url) => url === "/inspiration-video-urls.json")).toHaveLength(1);
});

test("补充目录404保持原始官方正文和总量并记录告警，不用伪造视频掩盖失败", async () => {
    mockCatalog(404);
    const warnings: unknown[][] = [];
    console.warn = (...args) => warnings.push(args);
    const catalog = await loadInspirationCatalog();
    expect(catalog.entries).toHaveLength(1341);
    expect(catalog.entries.filter((entry) => entry.sourceId === "seedance").every((entry) => !entry.videoUrl)).toBe(true);
    expect(warnings.some((args) => String(args[0]).includes("视频地址暂不可用"))).toBe(true);
});

test("补充目录等待时调用方取消保持AbortError，另一个调用方仍能读取同一真实目录", async () => {
    mockCatalog();
    const fetcher = globalThis.fetch;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    globalThis.fetch = (async (input, init) => {
        if (String(input) === "/inspiration-video-urls.json") await pending;
        return fetcher(input, init);
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const canceled = getInspirationPrompt(packs[0][0].id, controller.signal);
    const shared = loadInspirationCatalog();
    controller.abort(new DOMException("cancel video lookup", "AbortError"));
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    release();
    const catalog = await shared;
    expect(catalog.entries).toHaveLength(1341);
    expect(publicInspirationVideoUrl(catalog.entries[0].videoUrl)).toBe(true);
});
