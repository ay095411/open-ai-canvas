import type { CreationMode } from "@/lib/creation-mode";
import { isOfficialInspirationId, isOfficialInspirationSource, type CreationInspiration, type InspirationGallerySource } from "@/lib/inspirations/catalog";
import { normalizeAuthorizedSummary, normalizeExternalFavorite } from "@/lib/inspirations/external-favorites";
import { filterOfficialCatalog, normalizeOfficialInspiration, officialCategoryLabel, pageOfficialCatalog, type OfficialCatalogEntry, type OfficialCatalogQuery } from "@/lib/inspirations/official-catalog";
import { inspirationCatalogForSignal } from "@/services/inspiration-catalog";
import { getZzaiGalleryFacets, getZzaiGalleryPrompt, getZzaiGalleryPrompts, type ZzaiGalleryDetail, type ZzaiGalleryFacets, type ZzaiGalleryPage, type ZzaiGalleryQuery, type ZzaiGallerySummary } from "./zzai-gallery";

export type InspirationGalleryQuery = OfficialCatalogQuery;
export type InspirationGalleryFacetQuery = Pick<InspirationGalleryQuery, "mediaType" | "mediaTypes">;
export type OnlineGallerySummary = OfficialCatalogEntry;
export type OnlineGalleryDetail = OfficialCatalogEntry;
export type OnlineGalleryPage = { items: OnlineGallerySummary[]; total: number; nextCursor?: string };
export type OnlineGalleryFacets = { categories: string[]; models: string[]; tags: string[]; total: number; categoryLabels?: Record<string, string> };
export type InspirationGallerySummary = ZzaiGallerySummary | OnlineGallerySummary;
export type InspirationGalleryDetail = ZzaiGalleryDetail | OnlineGalleryDetail;
export type InspirationGalleryPage = ZzaiGalleryPage | OnlineGalleryPage;
export type InspirationGalleryFacets = (ZzaiGalleryFacets | OnlineGalleryFacets) & { categoryLabels?: Record<string, string> };

export async function getOnlineGalleryPrompts(query: InspirationGalleryQuery = {}, signal?: AbortSignal): Promise<OnlineGalleryPage> {
    return pageOfficialCatalog(await inspirationCatalogForSignal(signal), query);
}

export async function getOnlineGalleryPrompt(id: string, signal?: AbortSignal): Promise<OnlineGalleryDetail> {
    if (!isOfficialInspirationId(id)) throw new Error("官方目录条目标识无效，旧在线图库已停用");
    const catalog = await inspirationCatalogForSignal(signal);
    const item = catalog.entries.find((entry) => entry.id === id);
    if (!item) throw new Error("官方目录中未找到该条目，原收藏记录保留");
    return item;
}

export async function getOnlineGalleryFacets(query: CreationMode | InspirationGalleryFacetQuery = {}, signal?: AbortSignal): Promise<OnlineGalleryFacets> {
    const catalog = await inspirationCatalogForSignal(signal);
    const items = filterOfficialCatalog(catalog, typeof query === "string" ? { mediaType: query } : query);
    const categories = [...new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value)))];
    return {
        categories,
        models: [...new Set(items.map((item) => item.model).filter(Boolean))],
        tags: [...new Set(items.flatMap((item) => item.tags ?? []))],
        total: items.length,
        categoryLabels: Object.fromEntries(categories.map((category) => [category, officialCategoryLabel(catalog, category)])),
    };
}

function licensedQuery(query: InspirationGalleryQuery): ZzaiGalleryQuery {
    if (query.mediaType === "text") throw new Error("本站审核库不支持文本筛选");
    if (query.mediaTypes !== undefined) throw new Error("本站审核库不支持多类型筛选");
    if (query.sourceId) throw new Error("本站审核库不支持官方目录来源筛选");
    return { ...query, mediaType: query.mediaType };
}

/** Each source owns its contract; a failed licensed read never becomes official data. */
export function getInspirationGalleryPrompts(source: InspirationGallerySource, query: InspirationGalleryQuery = {}, signal?: AbortSignal): Promise<InspirationGalleryPage> {
    if (source === "official-catalog") return getOnlineGalleryPrompts(query, signal);
    if (source === "authorized-library") return getZzaiGalleryPrompts(licensedQuery(query), signal);
    throw new Error("灵感来源已停用");
}

export function getInspirationGalleryFacets(source: InspirationGallerySource, query: CreationMode | InspirationGalleryFacetQuery = {}, signal?: AbortSignal): Promise<InspirationGalleryFacets> {
    if (source === "official-catalog") return getOnlineGalleryFacets(query, signal);
    if (source === "authorized-library") {
        const { mediaType, mediaTypes } = typeof query === "string" ? { mediaType: query } : query;
        if (mediaType === "text") throw new Error("本站审核库不支持文本筛选");
        if (mediaTypes !== undefined) throw new Error("本站审核库不支持多类型筛选");
        return getZzaiGalleryFacets(mediaType, signal);
    }
    throw new Error("灵感来源已停用");
}

/** Stable IDs preserve upstream identity; old ZZAI IDs are archived, never queried or relabeled. */
export function getInspirationPrompt(id: string, signal?: AbortSignal): Promise<InspirationGalleryDetail> {
    if (typeof id !== "string") throw new Error("素材条目标识无效");
    if (isOfficialInspirationId(id)) return getOnlineGalleryPrompt(id, signal);
    if (id.startsWith("authorized-library:")) {
        const slug = id.slice("authorized-library:".length);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(slug)) throw new Error("授权素材条目标识无效");
        return getZzaiGalleryPrompt(slug, signal);
    }
    throw new Error("旧在线图库来源已停用，历史收藏记录保留");
}

export function normalizeInspirationDetail(input: unknown): InspirationGalleryDetail {
    if (input && typeof input === "object" && isOfficialInspirationSource((input as CreationInspiration).sourceId)) return normalizeOfficialInspiration(input);
    const summary = normalizeAuthorizedSummary(input);
    return { ...summary, ...normalizeExternalFavorite(input), slug: summary.slug } as ZzaiGalleryDetail;
}
