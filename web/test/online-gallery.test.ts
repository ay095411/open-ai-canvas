import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { invalidateInspirationCatalog } from "@/services/inspiration-catalog";
import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { normalizeOfficialInspiration, type OfficialCatalogEntry } from "@/lib/inspirations/official-catalog";

import { normalizeAuthorizedSummary, normalizeExternalFavorite, normalizeOnlineFavorite, normalizeOnlineSummary, type OnlineInspirationDetail } from "@/lib/inspirations/external-favorites";
import { filterZzaiGalleryFavorites, mergeZzaiGalleryPages, toZzaiGalleryInspiration } from "@/lib/inspirations/zzai-gallery";
import {
    getInspirationPrompt,
    getOnlineGalleryFacets,
    getOnlineGalleryPrompt,
    getOnlineGalleryPrompts,
    getInspirationGalleryPrompts,
    getInspirationGalleryFacets,
    normalizeInspirationDetail,
    type InspirationGallerySummary,
    type InspirationGalleryDetail,
} from "@/services/api/online-gallery";
import { apiClient, ApiError } from "@/services/api/request";
import { getZzaiGalleryPrompt } from "@/services/api/zzai-gallery";
import { authorizedEntry, authorizedSummary } from "./fixtures/authorized-inspirations";

const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    invalidateInspirationCatalog();
});

function onlineEntry(slug = "sample", patch: Partial<OnlineInspirationDetail> = {}): OnlineInspirationDetail {
    return {
        id: `zzai-gallery:${slug}`,
        slug,
        sourceId: "zzai-gallery",
        title: `在线作品 ${slug}`,
        description: "上游提供的作品描述",
        image: `https://media.example.com/${slug}.webp`,
        videoUrl: `https://media.example.com/${slug}.mp4`,
        width: 1280,
        height: 720,
        mode: "video",
        category: "story",
        model: "示例模型",
        galleryUrl: `https://api.seedance.nz/prompt-gallery/${slug}`,
        sourceUrl: `https://creator.example.com/works/${slug}`,
        credit: "原作者",
        featured: false,
        tags: ["电影感"],
        prompt: " Original camera movement. ",
        promptZh: " 缓慢移动镜头。 ",
        publishedAt: "2026-11-15T01:00:00Z",
        ...patch,
    };
}

function serve(data: unknown) {
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } });
}

describe("在线聚合响应与授权库身份隔离", () => {
    test("在线摘要保留来源和HTTPS媒体，但不提前暴露正文或声称授权", () => {
        const entry = onlineEntry();
        const summary = normalizeOnlineSummary(entry);
        expect(summary.id).toBe("zzai-gallery:sample");
        expect(summary.sourceUrl).toBe(entry.sourceUrl);
        expect(summary.galleryUrl).toBe(entry.galleryUrl);
        expect(summary.image).toBe(entry.image);
        expect(summary.videoUrl).toBe(entry.videoUrl);
        expect(summary.credit).toBe(entry.credit);
        expect(summary).not.toHaveProperty("authorization");
        expect(summary).not.toHaveProperty("prompt");
        expect(summary).not.toHaveProperty("promptZh");
    });

    test("完整在线详情保留中文正文与参考要求，本地快照可从稳定ID恢复slug", () => {
        const entry = onlineEntry("detail", { requiresReference: true, usageNotes: " 需要参考图片。 " });
        const result = normalizeOnlineFavorite({ ...entry, slug: undefined });
        expect(result.slug).toBe("detail");
        expect(result.prompt).toBe("Original camera movement.");
        expect(result.promptZh).toBe("缓慢移动镜头。");
        expect(result.requiresReference).toBe(true);
        expect(result.usageNotes).toBe("需要参考图片。");
        expect(normalizeOnlineFavorite({ ...entry, prompt: "" }).prompt).toBe("缓慢移动镜头。");
        expect(() => toZzaiGalleryInspiration(entry as unknown as InspirationGalleryDetail)).toThrow();
    });

    test.each([
        { id: "authorized-library:sample" },
        { id: "zzai-gallery:other" },
        { slug: "../sample" },
        { sourceId: "authorized-library" },
        { authorization: authorizedEntry("sample").authorization },
        { authorization: null },
        { title: " " },
        { title: "x".repeat(501) },
        { image: "http://media.example.com/cover.jpg" },
        { image: "data:image/png;base64,unsafe" },
        { image: "https://user:password@media.example.com/cover.jpg" },
        { videoUrl: "javascript:alert(1)" },
        { sourceUrl: "javascript:alert(1)" },
        { sourceUrl: "https://user:password@creator.example.com/" },
        { galleryUrl: "https://api.seedance.nz/prompt-gallery/other" },
        { galleryUrl: "https://unrelated.example.com/prompt-gallery/sample" },
        { galleryUrl: "https://api.seedance.nz/prompt-gallery/sample?authorization=verified" },
        { width: Number.NaN },
        { height: -1 },
        { height: 20_001 },
        { tags: [123] },
        { tags: Array(51).fill("标签") },
        { featured: "true" },
        { publishedAt: "not-a-date" },
    ])("错误身份、伪造授权、危险链接与超限字段拒绝 %#", (patch) => {
        expect(() => normalizeOnlineSummary({ ...onlineEntry(), ...patch })).toThrow();
    });

    test("摘要和空正文不能变成可收藏/使用的详情", () => {
        const entry = onlineEntry();
        expect(() => normalizeOnlineFavorite(normalizeOnlineSummary(entry))).toThrow("完整提示词");
        expect(() => normalizeOnlineFavorite({ ...entry, prompt: " ", promptZh: " " })).toThrow("完整提示词");
        expect(() => normalizeOnlineFavorite({ ...entry, prompt: "x".repeat((512 << 10) + 1) })).toThrow();
        expect(() => normalizeOnlineFavorite({ ...entry, requiresReference: "yes" })).toThrow();
    });

    test("授权库原有强校验保留，来源之间不得通过改名冒充", () => {
        const authorized = authorizedEntry("licensed");
        expect(normalizeExternalFavorite(authorized).authorization).toEqual(authorized.authorization);
        expect(() => normalizeAuthorizedSummary(onlineEntry())).toThrow();
        expect(() => normalizeExternalFavorite({ ...authorized, sourceId: "zzai-gallery" })).toThrow();
        expect(() => normalizeExternalFavorite({ ...onlineEntry(), sourceId: "authorized-library" })).toThrow();
        expect(() => normalizeExternalFavorite({ ...authorized, authorization: undefined })).toThrow();
    });

    test("跨来源同名条目不冲突，跨页重叠保留首次摘要", () => {
        const online = officialEntry("sample");
        const licensed = authorizedSummary(authorizedEntry("sample"));
        const merged = mergeZzaiGalleryPages<InspirationGallerySummary>([{ items: [online, licensed] }, { items: [{ ...online, title: "重复页标题" }] }]);
        expect(merged).toEqual([online, licensed]);
    });

    test("收藏筛选接受合法在线快照但拒绝身份混淆，不用隐藏正文匹配关键词", () => {
        const online = officialEntry("online", { featured: true });
        const ignoredModel = onlineEntry("ignored-model", { model: "zhenzhen-image-muse" });
        const ignoredOrigin = onlineEntry("ignored-origin", { sourceUrl: "https://api.seedance.nz/prompt-gallery/origin" });
        const ignoredFallbackOrigin = onlineEntry("ignored-fallback", { model: "Google Nano Banana Pro", sourceUrl: undefined });
        const licensed = authorizedSummary(authorizedEntry("licensed"));
        expect(
            filterZzaiGalleryFavorites([online, ignoredModel, ignoredOrigin, ignoredFallbackOrigin, licensed], {})
                .map((item) => item.id)
                .sort(),
        ).toEqual([licensed.id, online.id].sort());
        expect(filterZzaiGalleryFavorites([online, licensed], { sort: "featured" }).map((item) => item.id)).toEqual([online.id]);
        expect(filterZzaiGalleryFavorites([online], { mediaType: "video", search: "电影感" })).toEqual([online]);
        expect(filterZzaiGalleryFavorites([online], { search: "缓慢移动" })).toEqual([]);
        expect(filterZzaiGalleryFavorites([{ ...licensed, sourceId: "zzai-gallery" } as unknown as CreationInspiration], {})).toEqual([]);
    });

    test("历史在线来源仍可校验归档但不会再请求旧上游或变成官方授权", async () => {
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            throw new Error("No legacy request allowed");
        };
        for (const entry of [onlineEntry("zz-model", { model: "zhenzhen-image-muse" }), onlineEntry("sd-source", { sourceUrl: "https://api.seedance.nz/prompt-gallery/example" }), onlineEntry("sd-fallback", { sourceUrl: undefined })]) {
            expect(() => getInspirationPrompt(entry.id)).toThrow("停用");
            expect(() => normalizeInspirationDetail(entry)).toThrow();
        }
        expect(urls).toEqual([]);
    });

    test("本地收藏遵循多媒体范围，并与具体类型取交集而不影响普通全部", () => {
        const image = officialEntry("range-image", { mode: "image" });
        const video = officialEntry("range-video", { mode: "video" });
        const text = officialEntry("range-text", { mode: "text" });
        const licensed = authorizedSummary(authorizedEntry("range-licensed"));
        const entries = [image, video, text, licensed];
        expect(filterZzaiGalleryFavorites(entries, {})).toHaveLength(4);
        expect(
            filterZzaiGalleryFavorites(entries, { mediaTypes: ["image", "video"] })
                .map((item) => item.id)
                .sort(),
        ).toEqual([image.id, video.id, licensed.id].sort());
        expect(filterZzaiGalleryFavorites(entries, { mediaType: "text", mediaTypes: ["image", "video"] })).toEqual([]);
        expect(filterZzaiGalleryFavorites(entries, { mediaTypes: [] })).toEqual([]);
    });
});

function officialEntry(slug = "sample", patch: Partial<OfficialCatalogEntry> = {}): OfficialCatalogEntry {
    return normalizeOfficialInspiration({ ...onlineEntry(slug), id: `seedance:${slug}`, sourceId: "seedance", image: `/inspiration-thumbs/seedance/${slug}.webp`, ...patch });
}

function installCatalog(entries: unknown[] = [officialEntry()], fetcher?: typeof globalThis.fetch) {
    invalidateInspirationCatalog();
    globalThis.fetch =
        fetcher ??
        ((async (input) => {
            const url = String(input);
            if (url === "/inspiration-video-urls.json") return new Response(JSON.stringify({ version: 1, entries: [] }));
            if (url === "/inspirations/manifest.json") return new Response(JSON.stringify({ sources: { seedance: { categories: { story: "故事" } } } }));
            if (!["/inspirations/seedance.json", "/inspirations/haohaoxue.json", "/inspirations/youmind.json"].includes(url)) throw new Error(`Unexpected static request: ${url}`);
            return new Response(JSON.stringify({ entries: url.includes("/seedance.json") ? entries : [] }));
        }) as typeof globalThis.fetch);
    apiClient.defaults.adapter = async (config) => {
        if (config.url !== "/public/inspirations/feed") throw new Error(`Unexpected API: ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { enabled: false, entries: [] }, msg: "ok" } };
    };
}

describe("官方目录业务能力与人工审核库隔离", () => {
    test("列表读官方文件并本地紧凑筛选分页，正文已包含，保存实际来源身份", async () => {
        const entry = officialEntry("filtered");
        installCatalog([entry]);
        const page = await getInspirationGalleryPrompts("official-catalog", { search: " 电影感 ", mediaType: "video", category: "story", sourceId: "seedance", sort: "latest", limit: 21 }, new AbortController().signal);
        expect(page).toEqual({ items: [entry], total: 1 });
        expect(page.items[0].prompt).toBe(entry.prompt);
        expect(page.items[0].sourceId).toBe("seedance");
        expect(page.items[0].authorization).toBeUndefined();
    });

    test.each([
        null,
        { entries: null },
        { items: [] },
        { entries: [null] },
        { entries: [authorizedEntry("wrong-source")] },
        { entries: [{ ...officialEntry(), id: "youmind:wrong-id" }] },
        { entries: [{ ...officialEntry(), prompt: "" }] },
        { entries: [{ ...officialEntry(), image: "javascript:alert(1)" }] },
    ])("错误静态目录不降级为空成功 %#", async (payload) => {
        installCatalog([], (async (input) => new Response(JSON.stringify(String(input).includes("/seedance.json") ? payload : String(input).includes("manifest") ? { sources: {} } : { entries: [] }))) as typeof globalThis.fetch);
        await expect(getOnlineGalleryPrompts()).rejects.toThrow();
    });

    test("空外部目录仍保留官方22模板，不冒充人工授权库或补虚假许可", async () => {
        installCatalog([]);
        const page = await getOnlineGalleryPrompts({ limit: 50 });
        expect(page.total).toBe(22);
        expect(page.items.every((item) => item.sourceId === "original" || item.sourceId === "chatgpt-prompts")).toBe(true);
        expect(page.items.every((item) => !item.authorization)).toBe(true);
    });

    test("完整详情按目录稳定ID读取，错配来源/不存在条目均拒绝", async () => {
        const entry = officialEntry();
        installCatalog([entry]);
        expect((await getOnlineGalleryPrompt(entry.id)).prompt).toBe(entry.prompt);
        await expect(getOnlineGalleryPrompt("seedance:other")).rejects.toThrow("未找到");
        await expect(getOnlineGalleryPrompt("sample")).rejects.toThrow("标识无效");
        expect(() => normalizeInspirationDetail({ ...entry, sourceId: "authorized-library" })).toThrow();
    });

    test("详情按稳定ID明确分流，历史ZZAI及非法ID不发出请求", async () => {
        const entry = officialEntry("same");
        installCatalog([entry]);
        await getInspirationPrompt(entry.id);
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            expect(config.signal?.aborted).toBe(false);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: authorizedEntry("same"), msg: "ok" } };
        };
        expect((await getInspirationPrompt("authorized-library:same", new AbortController().signal)).sourceId).toBe("authorized-library");
        for (const id of ["zzai-gallery:same", "zzai-gallery:", "zzai-gallery:../same", "authorized-library:same?x=1", "custom:untrusted"]) expect(() => getInspirationPrompt(id)).toThrow();
        expect(urls).toEqual(["/public/inspirations/library/prompts/same"]);
    });

    test("授权详情端点不能接受同slug的有效官方目录对象", async () => {
        installCatalog();
        serve(officialEntry("same"));
        await expect(getZzaiGalleryPrompt("same")).rejects.toThrow();
        await expect(getInspirationPrompt("authorized-library:same")).rejects.toThrow();
        expect(() => getInspirationPrompt("zzai-gallery:same")).toThrow("停用");
    });

    test("facets来自全量目录与manifest，并支持文本，授权库拒绝文本而不发请求", async () => {
        installCatalog();
        const facets = await getOnlineGalleryFacets("video");
        expect(facets).toEqual({ categories: ["story"], models: ["示例模型"], tags: ["电影感"], total: 8, categoryLabels: { story: "故事" } });
        const text = await getOnlineGalleryFacets("text");
        expect(text.total).toBe(9);
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            throw new Error("No unsupported request allowed");
        };
        expect(() => getInspirationGalleryFacets("authorized-library", "text")).toThrow("不支持文本");
        expect(() => getInspirationGalleryPrompts("authorized-library", { mediaType: "text" })).toThrow("不支持文本");
        expect(urls).toEqual([]);
    });

    test("视觉范围在分页前排除文本，全部页的总数与连续游标只计算图片和视频", async () => {
        const mediaTypes = ["image", "video"] as const;
        const entries = [...Array.from({ length: 7 }, (_, index) => officialEntry(`visual-${index}`, { mode: index % 2 ? "image" : "video" })), ...Array.from({ length: 3 }, (_, index) => officialEntry(`text-only-${index}`, { mode: "text" }))];
        installCatalog(entries);
        const all = await getOnlineGalleryPrompts({ limit: 50 });
        const text = await getOnlineGalleryPrompts({ mediaType: "text", limit: 50 });
        let page = await getInspirationGalleryPrompts("official-catalog", { mediaTypes, limit: 3 });
        const collected: InspirationGallerySummary[] = [];
        const cursors: string[] = [];
        expect(all.total).toBe(32);
        expect(text.total).toBe(12);
        while (true) {
            expect(page.total).toBe(20);
            expect(page.items).toHaveLength(Math.min(3, page.total - collected.length));
            expect(page.items.every((item) => item.mode === "image" || item.mode === "video")).toBe(true);
            collected.push(...page.items);
            if (!page.nextCursor) break;
            expect(page.nextCursor).toBe(`catalog_${collected.length}`);
            expect(cursors).not.toContain(page.nextCursor);
            cursors.push(page.nextCursor);
            expect(cursors.length).toBeLessThan(20);
            page = await getInspirationGalleryPrompts("official-catalog", { mediaTypes, cursor: page.nextCursor, limit: 3 });
        }
        expect(collected).toHaveLength(all.total - text.total);
        expect(new Set(collected.map((item) => item.id)).size).toBe(collected.length);
        expect(collected.map((item) => item.id).sort()).toEqual(
            all.items
                .filter((item) => item.mode !== "text")
                .map((item) => item.id)
                .sort(),
        );
        expect((await getOnlineGalleryPrompts({ limit: 50 })).total).toBe(all.total);
        expect((await getOnlineGalleryPrompts({ mediaType: "text", limit: 50 })).items).toEqual(text.items);
    });

    test("视觉范围facets不混入文本独有分类、模型或标签，普通全部及文本读取仍完整", async () => {
        installCatalog([
            officialEntry("visual-image", { mode: "image", category: "visual-image", model: "图片专用模型", tags: ["图片专用标签"] }),
            officialEntry("visual-video", { mode: "video", category: "visual-video", model: "视频专用模型", tags: ["视频专用标签"] }),
            officialEntry("text-only", { mode: "text", category: "text-only", model: "文本专用模型", tags: ["文本专用标签"] }),
        ]);
        const scope = { mediaTypes: ["image", "video"] as const };
        const facets = await getInspirationGalleryFacets("official-catalog", scope, new AbortController().signal);
        expect(facets.total).toBe(15);
        expect(facets.categories).toEqual(expect.arrayContaining(["visual-image", "visual-video"]));
        expect(facets.models).toEqual(expect.arrayContaining(["图片专用模型", "视频专用模型"]));
        expect(facets.tags).toEqual(expect.arrayContaining(["图片专用标签", "视频专用标签"]));
        expect(facets.categories).not.toContain("text-only");
        expect(facets.categoryLabels).not.toHaveProperty("text-only");
        expect(facets.models).not.toContain("文本专用模型");
        expect(facets.tags).not.toContain("文本专用标签");
        expect(await getOnlineGalleryFacets(scope)).toEqual(facets);
        const all = await getOnlineGalleryFacets();
        const text = await getOnlineGalleryFacets("text");
        expect(all.total).toBe(25);
        expect(all.categories).toContain("text-only");
        expect(all.models).toContain("文本专用模型");
        expect(text.total).toBe(10);
        expect(text.categories).toContain("text-only");
        expect(text.models).toContain("文本专用模型");
        expect(text.tags).toContain("文本专用标签");
    });

    test.each(["image", "video", "text"] as const)("具体%s类型与视觉范围取交集，不覆盖多类型约束", async (mediaType) => {
        const entries = (["image", "video", "text"] as const).map((mode) => officialEntry(`intersection-${mode}`, { mode }));
        installCatalog(entries);
        const mediaTypes = ["image", "video"] as const;
        const page = await getOnlineGalleryPrompts({ sourceId: "seedance", mediaType, mediaTypes, limit: 50 });
        expect(page.items).toEqual(mediaType === "text" ? [] : [entries.find((item) => item.mode === mediaType)!]);
        expect(page.total).toBe(mediaType === "text" ? 0 : 1);
        const facets = await getOnlineGalleryFacets({ mediaType, mediaTypes });
        expect(facets).toEqual(mediaType === "text" ? { categories: [], models: [], tags: [], total: 0, categoryLabels: {} } : await getOnlineGalleryFacets(mediaType));
    });

    test("空范围不退化为全部，互斥的单类型和范围返回真实空结果", async () => {
        installCatalog([officialEntry("scope-image", { mode: "image" })]);
        expect(await getOnlineGalleryPrompts({ mediaTypes: [] })).toEqual({ items: [], total: 0 });
        expect(await getOnlineGalleryFacets({ mediaTypes: [] })).toEqual({ categories: [], models: [], tags: [], total: 0, categoryLabels: {} });
        expect(await getOnlineGalleryPrompts({ mediaType: "video", mediaTypes: ["image"] })).toEqual({ items: [], total: 0 });
        expect(await getOnlineGalleryFacets({ mediaType: "video", mediaTypes: ["image"] })).toEqual({ categories: [], models: [], tags: [], total: 0, categoryLabels: {} });
    });

    test("人工审核库明确拒绝任何多类型范围，列表与facets均不发请求", () => {
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            throw new Error("No unsupported media scope request allowed");
        };
        for (const mediaTypes of [[], ["image"], ["image", "video"], ["text"]] as const) {
            expect(() => getInspirationGalleryPrompts("authorized-library", { mediaTypes })).toThrow("不支持多类型筛选");
            expect(() => getInspirationGalleryFacets("authorized-library", { mediaTypes })).toThrow("不支持多类型筛选");
        }
        expect(urls).toEqual([]);
    });

    test("主静态目录失败保留错误，不偷偷回退人工库；上新失败可降级静态", async () => {
        installCatalog([], (async () => new Response("unavailable", { status: 503 })) as typeof globalThis.fetch);
        await expect(getOnlineGalleryPrompts()).rejects.toThrow("HTTP 503");
        installCatalog();
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            throw new ApiError("上新不可用", { status: 502, code: 502, reason: "upstream_unavailable" });
        };
        expect((await getOnlineGalleryPrompts()).total).toBe(23);
        expect(urls).toEqual(["/public/inspirations/feed"]);
    });

    test("取消保持AbortError且不发起替代请求", async () => {
        installCatalog();
        const controller = new AbortController();
        controller.abort();
        await expect(getOnlineGalleryPrompts({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        await expect(getOnlineGalleryPrompt("seedance:sample", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        apiClient.defaults.adapter = async () => {
            throw new axios.CanceledError();
        };
        await expect(getInspirationPrompt("authorized-library:sample", new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    });

    test("调用方取消不会让共享目录的迟到响应成为该调用方的成功", async () => {
        let release!: () => void;
        let start!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const beginning = new Promise<void>((resolve) => {
            start = resolve;
        });
        installCatalog([], (async (input) => {
            start();
            await gate;
            return new Response(JSON.stringify(String(input).includes("manifest") ? { sources: {} } : { entries: [] }));
        }) as typeof globalThis.fetch);
        const controller = new AbortController();
        const request = getOnlineGalleryPrompts({}, controller.signal).catch((error: Error) => error);
        await beginning;
        controller.abort();
        release();
        expect(await request).toMatchObject({ name: "AbortError" });
    });
});
