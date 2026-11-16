import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { normalizeAuthorizedSummary, normalizeExternalFavorite } from "@/lib/inspirations/external-favorites";
import { compactApiParams, http } from "./request";

export const INSPIRATION_POLICY_VERSION = "licensed-v1";
export type ZzaiGallerySort = "latest" | "featured";

/** The upstream list omits prompts; only a detail response can be used in creation. */
export type ZzaiGallerySummary = Omit<CreationInspiration, "prompt" | "promptZh"> & {
    id: string;
    slug: string;
    sourceId: "authorized-library";
    mode: "image" | "video";
    model: string;
    galleryUrl: string;
    authorization: NonNullable<CreationInspiration["authorization"]>;
};

export type ZzaiGalleryDetail = ZzaiGallerySummary & {
    prompt: string;
    promptZh?: string;
};

export type ZzaiGalleryPage = {
    policyVersion: "licensed-v1";
    items: ZzaiGallerySummary[];
    total: number;
    nextCursor?: string;
};

export type ZzaiGalleryFacets = {
    policyVersion: "licensed-v1";
    categories: string[];
    models: string[];
    tags: string[];
    total: number;
};

export type ZzaiGalleryQuery = {
    search?: string;
    mediaType?: "image" | "video";
    category?: string;
    model?: string;
    sort?: ZzaiGallerySort;
    cursor?: string;
    limit?: number;
};

const galleryPath = "/public/inspirations/library";

function currentPolicy<T extends { policyVersion?: string }>(value: T): T {
    if (!value || value.policyVersion !== INSPIRATION_POLICY_VERSION) throw new Error("素材授权策略不匹配，请刷新后重试");
    return value;
}
function currentItems<T extends { policyVersion: "licensed-v1"; items: ZzaiGallerySummary[] }>(value: T): T {
    currentPolicy(value);
    if (!Array.isArray(value.items)) throw new Error("授权素材列表格式不正确");
    return { ...value, items: value.items.map(normalizeAuthorizedSummary) };
}
function currentPage(value: ZzaiGalleryPage): ZzaiGalleryPage {
    const page = currentItems(value);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) throw new Error("授权素材分页格式不正确");
    return page;
}

export function getZzaiGalleryPrompts(query: ZzaiGalleryQuery = {}, signal?: AbortSignal) {
    return http
        .get<ZzaiGalleryPage>(`${galleryPath}/prompts`, {
            params: compactApiParams({ search: query.search?.trim(), media_type: query.mediaType, category: query.category, model: query.model, sort: query.sort, cursor: query.cursor, limit: query.limit }),
            signal,
        })
        .then(currentPage);
}

export function getZzaiGalleryPrompt(slug: string, signal?: AbortSignal) {
    if (!slug.trim()) throw new Error("缺少画廊条目标识");
    return http.get<ZzaiGalleryDetail>(`${galleryPath}/prompts/${encodeURIComponent(slug)}`, { signal }).then((value) => {
        if (value?.slug !== slug) throw new Error("授权素材与所选条目不一致");
        normalizeAuthorizedSummary(value);
        return { ...normalizeExternalFavorite(value), slug } as ZzaiGalleryDetail;
    });
}

export function getZzaiGalleryFacets(mediaType?: "image" | "video", signal?: AbortSignal) {
    return http.get<ZzaiGalleryFacets>(`${galleryPath}/facets`, { params: compactApiParams({ media_type: mediaType }), signal }).then((value) => {
        currentPolicy(value);
        if (!Number.isSafeInteger(value.total) || value.total < 0 || [value.categories, value.models, value.tags].some((list) => !Array.isArray(list) || list.some((entry) => typeof entry !== "string"))) throw new Error("授权素材筛选格式不正确");
        return value;
    });
}

export async function resolveInspirationFavorites(ids: readonly string[], signal?: AbortSignal) {
    const uniqueIds = [...new Set(ids)];
    const current = new Map<string, ZzaiGallerySummary>();
    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const batch = uniqueIds.slice(offset, offset + 100);
        const response = currentItems(await http.post<{ items: ZzaiGallerySummary[]; policyVersion: "licensed-v1" }>(`${galleryPath}/resolve`, { ids: batch }, { signal }));
        for (const item of response.items) if (batch.includes(item.id)) current.set(item.id, item);
    }
    // 任一批失败就拒绝整个读取，不能把部分成功当成当前完整授权库。
    return { policyVersion: INSPIRATION_POLICY_VERSION, items: uniqueIds.flatMap((id) => (current.get(id) ? [current.get(id)!] : [])) };
}
