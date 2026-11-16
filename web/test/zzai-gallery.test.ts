import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { readFileSync } from "node:fs";
import { normalizeAuthorizedSummary } from "@/lib/inspirations/external-favorites";
import { filterZzaiGalleryFavorites, toZzaiGalleryInspiration, zzaiCategoryLabel } from "@/lib/inspirations/zzai-gallery";
import { getZzaiGalleryFacets, getZzaiGalleryPrompt, getZzaiGalleryPrompts, resolveInspirationFavorites } from "@/services/api/zzai-gallery";
import { apiClient, ApiError } from "@/services/api/request";
import { authorizedEntry, authorizedMedia, authorizedSummary, policyVersion } from "./fixtures/authorized-inspirations";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});
const item = authorizedEntry("sample", { mode: "video", videoUrl: authorizedMedia("sample", "video"), prompt: " A slow camera movement. ", promptZh: " 缓慢移动镜头。 ", category: "story", tags: ["电影感"] });
describe("授权素材响应边界", () => {
    test("完整详情保留署名许可、版本、正文和固定同源媒体", () => {
        const mapped = toZzaiGalleryInspiration(item);
        expect(mapped.prompt).toBe("A slow camera movement.");
        expect(mapped.promptZh).toBe("缓慢移动镜头。");
        expect(mapped.authorization).toEqual(item.authorization);
        expect(mapped.videoUrl).toBe(item.videoUrl);
        expect(mapped.sourceUrl).toBe(item.sourceUrl);
        expect(normalizeAuthorizedSummary(item)).not.toHaveProperty("prompt");
        expect(normalizeAuthorizedSummary(item)).not.toHaveProperty("promptZh");
    });
    test("摘要、空正文、旧来源、缺许可、版本与身份不匹配均拒绝", () => {
        for (const patch of [
            { prompt: undefined, promptZh: undefined },
            { prompt: " ", promptZh: " " },
            { id: "authorized-library:other" },
            { sourceId: "zzai-gallery" },
            { authorization: undefined },
            { authorization: { ...item.authorization, policyVersion: "old" } },
            { authorization: { ...item.authorization, mediaLicense: { ...item.authorization.mediaLicense, attribution: "" } } },
        ]) {
            expect(() => toZzaiGalleryInspiration({ ...item, ...patch } as typeof item)).toThrow();
        }
    });
    test("拒绝上游媒体热链、错误hash/revision/path及危险来源链接", () => {
        for (const patch of [
            { image: "https://example.com/image.png" },
            { image: item.image.replace("revision=1", "revision=2") },
            { image: item.image.replace("hash=" + "b".repeat(64), "hash=missing") },
            { videoUrl: "https://example.com/video.mp4" },
            { sourceUrl: "javascript:alert(1)" },
            { image: authorizedMedia("another") },
            { galleryUrl: "https://name:secret@example.com/source" },
        ])
            expect(() => toZzaiGalleryInspiration({ ...item, ...patch })).toThrow();
    });
    test("收藏筛选仅用当前摘要；归档正文不可影响搜索", () => {
        const entries = [authorizedSummary(item), authorizedSummary(authorizedEntry("portrait", { featured: true, publishedAt: "2026-11-16T00:00:00Z" }))];
        expect(filterZzaiGalleryFavorites(entries, {}).map((entry) => entry.id)).toEqual(["authorized-library:portrait", "authorized-library:sample"]);
        expect(filterZzaiGalleryFavorites(entries, { mediaType: "video", search: "缓慢" })).toEqual([]);
        expect(filterZzaiGalleryFavorites(entries, { sort: "featured" }).map((entry) => entry.id)).toEqual(["authorized-library:portrait"]);
        expect(filterZzaiGalleryFavorites([{ ...item, sourceId: "zzai-gallery" } as typeof item], {})).toEqual([]);
    });
    test("未知分类不虚构中文标签", () => {
        expect(zzaiCategoryLabel("portrait")).toBe("人物肖像");
        expect(zzaiCategoryLabel("new-category")).toBe("new-category");
        expect(zzaiCategoryLabel()).toBe("未分类");
    });
});

describe("授权发布库业务API", () => {
    test("列表使用唯一业务http入口、策略版本、紧凑参数与取消signal", async () => {
        let captured: Record<string, unknown> | undefined;
        const page = { policyVersion, items: [authorizedSummary(item)], total: 1, nextCursor: "cursor" };
        apiClient.defaults.adapter = async (config) => {
            captured = config as unknown as Record<string, unknown>;
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: page, msg: "" } };
        };
        expect(await getZzaiGalleryPrompts({ search: "  电影感  ", mediaType: "video", category: "", model: "", sort: "latest", limit: 24 }, new AbortController().signal)).toEqual(page);
        expect(captured?.url).toBe("/public/inspirations/library/prompts");
        expect(captured?.params).toEqual({ search: "电影感", media_type: "video", sort: "latest", limit: 24 });
        expect(captured?.withCredentials).toBe(true);
    });
    test("详情、facets、resolve固定本地端点；resolve无正文", async () => {
        const calls: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            calls.push(config.url!);
            const data = config.url?.endsWith("facets") ? { policyVersion, categories: [], models: [], tags: [], total: 0 } : config.url?.endsWith("resolve") ? { policyVersion, items: [item] } : item;
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
        };
        expect((await getZzaiGalleryPrompt("sample")).prompt).toBe("A slow camera movement.");
        await getZzaiGalleryFacets("image");
        expect((await resolveInspirationFavorites([item.id])).items[0]).not.toHaveProperty("prompt");
        expect(calls).toEqual(["/public/inspirations/library/prompts/sample", "/public/inspirations/library/facets", "/public/inspirations/library/resolve"]);
        expect(() => getZzaiGalleryPrompt(" ")).toThrow();
    });
    test("策略过期或未核验条目不能成为成功页面", async () => {
        for (const data of [
            { policyVersion: "old", items: [], total: 0 },
            { policyVersion, items: [{ ...item, sourceId: "zzai-gallery" }], total: 1 },
        ]) {
            apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } });
            await expect(getZzaiGalleryPrompts()).rejects.toThrow();
        }
    });
    test("历史收藏超过100项按批复核并保持顺序；任一批失败整体拒绝", async () => {
        const ids = Array.from({ length: 205 }, (_, index) => `authorized-library:item-${index}`);
        const sizes: number[] = [];
        apiClient.defaults.adapter = async (config) => {
            const batch = JSON.parse(config.data).ids as string[];
            sizes.push(batch.length);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { policyVersion, items: [...batch].reverse().map((id) => authorizedSummary(authorizedEntry(id.slice("authorized-library:".length)))) }, msg: "" } };
        };
        expect((await resolveInspirationFavorites([...ids, ids[0]])).items.map((item) => item.id)).toEqual(ids);
        expect(sizes).toEqual([100, 100, 5]);
        let calls = 0;
        apiClient.defaults.adapter = async (config) => {
            calls += 1;
            if (calls === 2) throw new Error("Second batch unavailable");
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { policyVersion, items: [] }, msg: "" } };
        };
        await expect(resolveInspirationFavorites(ids)).rejects.toThrow("Second batch unavailable");
        expect(calls).toBe(2);
    });
    test("撤销详情和cursor失效保持业务错误，不变成空成功", async () => {
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 40901, data: null, msg: "目录已变化", reason: "library_cursor_stale" } });
        try {
            await getZzaiGalleryPrompts();
            throw new Error("Expected error");
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect((error as ApiError).reason).toBe("library_cursor_stale");
        }
    });
    test("取消保留AbortError语义", async () => {
        apiClient.defaults.adapter = async () => {
            throw new axios.CanceledError();
        };
        await expect(getZzaiGalleryPrompts({}, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    });
});

test("公共端不直连聚合站，授权notice由真实卡片保留", () => {
    const gallery = readFileSync(new URL("../src/pages/inspirations/zzai-gallery.tsx", import.meta.url), "utf8");
    const showcase = readFileSync(new URL("../src/pages/create/creation-showcase-band.tsx", import.meta.url), "utf8");
    const dialog = readFileSync(new URL("../src/pages/create/creation-inspiration-dialog.tsx", import.meta.url), "utf8");
    const card = readFileSync(new URL("../src/pages/create/creation-showcase-card.tsx", import.meta.url), "utf8");
    expect(gallery).toContain("resolveInspirationFavorites(authorizedFavorites, signal)");
    expect(dialog).toContain("getInspirationPrompt(pending.id");
    expect(gallery).toContain('refetchOnWindowFocus: "always"');
    expect(showcase).toContain("refetchInterval: 60_000");
    expect(showcase).not.toContain("detailCache");
    expect(card).toContain("<InspirationAuthorizationNotice item={entry} />");
    expect(gallery + showcase + dialog).not.toContain("https://api.seedance.nz/");
});
