import { isIgnoredOnlineInspiration, isIgnoredOnlineModel, normalizeOnlineFavorite, normalizeOnlineSummary, type OnlineInspirationDetail, type OnlineInspirationSummary } from "@/lib/inspirations/external-favorites";
import { compactApiParams, http } from "./request";
import { getZzaiGalleryPrompt, type ZzaiGalleryDetail, type ZzaiGalleryFacets, type ZzaiGalleryPage, type ZzaiGalleryQuery, type ZzaiGallerySummary } from "./zzai-gallery";

export type OnlineGallerySummary = OnlineInspirationSummary;
export type OnlineGalleryDetail = OnlineInspirationDetail;
export type OnlineGalleryPage = { items: OnlineGallerySummary[]; total: number; nextCursor?: string };
export type OnlineGalleryFacets = { categories: string[]; models: string[]; tags: string[]; total: number };
export type InspirationGallerySummary = ZzaiGallerySummary | OnlineGallerySummary;
export type InspirationGalleryDetail = ZzaiGalleryDetail | OnlineGalleryDetail;
export type InspirationGalleryPage = ZzaiGalleryPage | OnlineGalleryPage;
export type InspirationGalleryFacets = ZzaiGalleryFacets | OnlineGalleryFacets;

const galleryPath = "/public/inspirations/zzai-gallery";
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/;

function validSlug(slug: string) {
    if (typeof slug !== "string" || !slugPattern.test(slug)) throw new Error("在线示例条目标识无效");
    return slug;
}

function onlinePage(value: OnlineGalleryPage): OnlineGalleryPage {
    if (
        !value ||
        !Array.isArray(value.items) ||
        value.items.length > 50 ||
        !Number.isSafeInteger(value.total) ||
        value.total < 0 ||
        (value.nextCursor !== undefined && (typeof value.nextCursor !== "string" || value.nextCursor.length > 2048 || (value.nextCursor !== "" && !/^[A-Za-z0-9_+/=-]+$/.test(value.nextCursor))))
    )
        throw new Error("在线示例分页格式不正确");
    const normalized = value.items.map(normalizeOnlineSummary);
    const items = normalized.filter((item) => !isIgnoredOnlineInspiration(item));
    const dropped = normalized.length - items.length;
    const total = Math.max(items.length, value.total - dropped);
    return { items, total: items.length === 0 && !value.nextCursor ? 0 : total, ...(value.nextCursor !== undefined ? { nextCursor: value.nextCursor } : {}) };
}

export function getOnlineGalleryPrompts(query: ZzaiGalleryQuery = {}, signal?: AbortSignal) {
    return http
        .get<OnlineGalleryPage>(`${galleryPath}/prompts`, {
            params: compactApiParams({ search: query.search?.trim(), media_type: query.mediaType, category: query.category, model: query.model, sort: query.sort, cursor: query.cursor, limit: query.limit }),
            signal,
        })
        .then(onlinePage);
}

export function getOnlineGalleryPrompt(slug: string, signal?: AbortSignal) {
    validSlug(slug);
    return http.get<OnlineGalleryDetail>(`${galleryPath}/prompts/${encodeURIComponent(slug)}`, { signal }).then((value) => {
        const detail = normalizeOnlineFavorite(value);
        if (detail.slug !== slug) throw new Error("在线示例与所选条目不一致");
        if (isIgnoredOnlineInspiration(detail)) throw new Error("当前在线示例暂不展示");
        return detail;
    });
}

export function getOnlineGalleryFacets(mediaType?: "image" | "video", signal?: AbortSignal) {
    return http.get<OnlineGalleryFacets>(`${galleryPath}/facets`, { params: compactApiParams({ media_type: mediaType }), signal }).then((value) => {
        if (!value || !Number.isSafeInteger(value.total) || value.total < 0) throw new Error("在线示例筛选格式不正确");
        for (const [name, count, length] of [
            ["categories", 200, 128],
            ["models", 500, 128],
            ["tags", 1000, 128],
        ] as const) {
            if (!Array.isArray(value[name]) || value[name].length > count || value[name].some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > length)) throw new Error("在线示例筛选格式不正确");
        }
        return { categories: value.categories, models: value.models.filter((model) => !isIgnoredOnlineModel(model)), tags: value.tags, total: value.total };
    });
}

/** 稳定 ID 决定详情端点；在线数据和人工授权库绝不互相兜底。 */
export function getInspirationPrompt(id: string, signal?: AbortSignal): Promise<InspirationGalleryDetail> {
    if (typeof id !== "string") throw new Error("素材条目标识无效");
    if (id.startsWith("zzai-gallery:")) return getOnlineGalleryPrompt(validSlug(id.slice("zzai-gallery:".length)), signal);
    if (id.startsWith("authorized-library:")) return getZzaiGalleryPrompt(validSlug(id.slice("authorized-library:".length)), signal);
    throw new Error("素材来源不受支持");
}
