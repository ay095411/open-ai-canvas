import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { normalizeAuthorizedSummary, normalizeExternalFavorite, normalizeOnlineFavorite, normalizeOnlineSummary } from "@/lib/inspirations/external-favorites";
import { filterZzaiGalleryFavorites, mergeZzaiGalleryPages, toZzaiGalleryInspiration } from "@/lib/inspirations/zzai-gallery";
import { getInspirationPrompt, getOnlineGalleryFacets, getOnlineGalleryPrompt, getOnlineGalleryPrompts, type InspirationGallerySummary, type OnlineGalleryDetail } from "@/services/api/online-gallery";
import { apiClient, ApiError } from "@/services/api/request";
import { getZzaiGalleryPrompt } from "@/services/api/zzai-gallery";
import { authorizedEntry, authorizedSummary } from "./fixtures/authorized-inspirations";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

function onlineEntry(slug = "sample", patch: Partial<OnlineGalleryDetail> = {}): OnlineGalleryDetail {
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
        expect(toZzaiGalleryInspiration(entry)).toEqual(normalizeExternalFavorite(entry));
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
        const online = normalizeOnlineSummary(onlineEntry());
        const licensed = authorizedSummary(authorizedEntry("sample"));
        const merged = mergeZzaiGalleryPages<InspirationGallerySummary>([{ items: [online, licensed] }, { items: [{ ...online, title: "重复页标题" }] }]);
        expect(merged).toEqual([online, licensed]);
    });

    test("收藏筛选接受合法在线快照但拒绝身份混淆，不用隐藏正文匹配关键词", () => {
        const online = onlineEntry("online", { featured: true });
        const licensed = authorizedSummary(authorizedEntry("licensed"));
        expect(
            filterZzaiGalleryFavorites([online, licensed], {})
                .map((item) => item.id)
                .sort(),
        ).toEqual([licensed.id, online.id].sort());
        expect(filterZzaiGalleryFavorites([online, licensed], { sort: "featured" }).map((item) => item.id)).toEqual([online.id]);
        expect(filterZzaiGalleryFavorites([online], { mediaType: "video", search: "电影感" })).toEqual([online]);
        expect(filterZzaiGalleryFavorites([online], { search: "缓慢移动" })).toEqual([]);
        expect(filterZzaiGalleryFavorites([{ ...licensed, sourceId: "zzai-gallery" } as unknown as OnlineGalleryDetail], {})).toEqual([]);
    });
});

describe("在线图库业务API", () => {
    test("列表只走后端中转，无需licensed-v1；传递紧凑筛选、分页和signal", async () => {
        const summary = normalizeOnlineSummary(onlineEntry());
        const page = { items: [summary], total: 41_499, nextCursor: "cursor_21" };
        const signal = new AbortController().signal;
        let captured: Record<string, unknown> | undefined;
        apiClient.defaults.adapter = async (config) => {
            captured = config as unknown as Record<string, unknown>;
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: page, msg: "ok" } };
        };
        expect(await getOnlineGalleryPrompts({ search: " 电影感 ", mediaType: "video", category: "story", model: "", sort: "latest", limit: 21, cursor: "cursor_0" }, signal)).toEqual(page);
        expect(captured?.url).toBe("/public/inspirations/zzai-gallery/prompts");
        expect(captured?.params).toEqual({ search: "电影感", media_type: "video", category: "story", sort: "latest", limit: 21, cursor: "cursor_0" });
        expect(captured?.signal).toBeInstanceOf(AbortSignal);
        expect((captured?.signal as AbortSignal).aborted).toBe(false);
        expect(captured?.withCredentials).toBe(true);
    });

    test.each([
        null,
        { items: [], total: -1 },
        { items: [], total: 1.5 },
        { items: {}, total: 0 },
        { items: Array(51).fill(normalizeOnlineSummary(onlineEntry())), total: 51 },
        { items: [authorizedSummary(authorizedEntry("wrong-source"))], total: 1 },
        { items: [], total: 0, nextCursor: 1 },
        { items: [], total: 0, nextCursor: "?not-a-cursor" },
        { items: [], total: 0, nextCursor: "x".repeat(2049) },
    ])("错误在线分页不降级为空成功 %#", async (data) => {
        serve(data);
        await expect(getOnlineGalleryPrompts()).rejects.toThrow();
    });

    test("空在线目录诚实保留，既不补授权库数据也不伪造许可版本", async () => {
        serve({ items: [], total: 0 });
        expect(await getOnlineGalleryPrompts()).toEqual({ items: [], total: 0 });
    });

    test("完整详情与请求slug一致；不接受错配或授权库响应", async () => {
        serve(onlineEntry("sample"));
        expect((await getOnlineGalleryPrompt("sample")).id).toBe("zzai-gallery:sample");
        serve(onlineEntry("other"));
        await expect(getOnlineGalleryPrompt("sample")).rejects.toThrow("所选条目");
        serve(authorizedEntry("sample"));
        await expect(getOnlineGalleryPrompt("sample")).rejects.toThrow();
    });

    test("详情按稳定ID明确分流，非法ID不发出请求", async () => {
        const urls: string[] = [];
        const signal = new AbortController().signal;
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            expect(config.signal?.aborted).toBe(false);
            const data = config.url!.includes("/zzai-gallery/") ? onlineEntry("same") : authorizedEntry("same");
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } };
        };
        expect((await getInspirationPrompt("zzai-gallery:same", signal)).sourceId).toBe("zzai-gallery");
        expect((await getInspirationPrompt("authorized-library:same", signal)).sourceId).toBe("authorized-library");
        for (const id of ["original:same", "zzai-gallery:", "zzai-gallery:../same", "authorized-library:same?x=1", "zzai-gallery: same"]) expect(() => getInspirationPrompt(id, signal)).toThrow();
        expect(() => getOnlineGalleryPrompt("../same")).toThrow();
        expect(urls).toEqual(["/public/inspirations/zzai-gallery/prompts/same", "/public/inspirations/library/prompts/same"]);
    });

    test("授权详情端点不能接受同slug的有效在线对象", async () => {
        serve(onlineEntry("same"));
        await expect(getZzaiGalleryPrompt("same")).rejects.toThrow();
        await expect(getInspirationPrompt("authorized-library:same")).rejects.toThrow();
        serve(authorizedEntry("same"));
        await expect(getInspirationPrompt("zzai-gallery:same")).rejects.toThrow();
    });

    test("facets使用在线端点并验证有界字符串集合", async () => {
        const value = { categories: ["story"], models: ["示例模型"], tags: [], total: 50 };
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/public/inspirations/zzai-gallery/facets");
            expect(config.params).toEqual({ media_type: "video" });
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: value, msg: "ok" } };
        };
        expect(await getOnlineGalleryFacets("video")).toEqual(value);
        for (const patch of [{ categories: [1] }, { models: [""] }, { tags: Array(1001).fill("tag") }, { total: -1 }]) {
            serve({ ...value, ...patch });
            await expect(getOnlineGalleryFacets()).rejects.toThrow();
        }
    });

    test("在线接口失败保留业务错误，不偷偷回退人工库", async () => {
        const urls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            urls.push(config.url!);
            return { config, status: 502, statusText: "Bad Gateway", headers: {}, data: { code: 502, data: null, msg: "上游不可用", reason: "upstream_unavailable" } };
        };
        await expect(getOnlineGalleryPrompts()).rejects.toBeInstanceOf(ApiError);
        expect(urls).toEqual(["/public/inspirations/zzai-gallery/prompts"]);
    });

    test("取消保持AbortError且不发起替代请求", async () => {
        apiClient.defaults.adapter = async () => {
            throw new axios.CanceledError();
        };
        await expect(getOnlineGalleryPrompts({}, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
        await expect(getInspirationPrompt("zzai-gallery:sample", new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    });

    test("调用方取消会传递到http组合后的传输signal，迟到响应不能成功", async () => {
        const controller = new AbortController();
        let transportSignal: AbortSignal | undefined;
        let started = () => {};
        let release = () => {};
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const beginning = new Promise<void>((resolve) => {
            started = resolve;
        });
        apiClient.defaults.adapter = async (config) => {
            transportSignal = config.signal as AbortSignal;
            started();
            await pending;
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: [], total: 0 }, msg: "ok" } };
        };
        const request = getOnlineGalleryPrompts({}, controller.signal);
        await beginning;
        controller.abort();
        expect(transportSignal?.aborted).toBe(true);
        release();
        await expect(request).rejects.toMatchObject({ name: "AbortError" });
    });
});
