import type { CreationMode } from "@/lib/creation-mode";
import { catalogIdOf, curatedInspirations, inspirationSources, isOfficialInspirationSource, OFFICIAL_INSPIRATION_SOURCES, type CreationInspiration, type OfficialInspirationSourceId } from "./catalog";
import { localDayKey, orderInspirationsByLatest } from "./daily-order";
import { enrichInspirationVideos, readInspirationVideoLinks, type InspirationVideoLinks, type InspirationVideoLinksPayload } from "./video-enrichment";

export type OfficialCatalogEntry = Omit<CreationInspiration, "sourceId" | "authorization"> & { id: string; slug: string; sourceId: OfficialInspirationSourceId; model: string; galleryUrl: string; authorization?: never };
export type OfficialCatalogQuery = {
    search?: string;
    mediaType?: CreationMode;
    mediaTypes?: readonly CreationMode[];
    sourceId?: OfficialInspirationSourceId;
    category?: string;
    model?: string;
    sort?: "latest" | "featured";
    cursor?: string;
    limit?: number;
};
export type OfficialCatalogManifest = { sources?: Record<string, { revision?: string; categories?: Record<string, string> }> };
export type OfficialCatalogFeed = { enabled: boolean; entries: CreationInspiration[]; categories?: Record<string, Record<string, string>>; syncedAt?: string; videoLinks?: InspirationVideoLinksPayload };
export type InspirationCatalog = { entries: OfficialCatalogEntry[]; categoriesBySource: Record<OfficialInspirationSourceId, { id: string; label: string; count: number }[]>; revisions: Record<string, string>; loadedAt: number };
export const OFFICIAL_CATALOG_FILES = [
    { key: "seedance", file: "/inspirations/seedance.json" },
    { key: "haohaoxue", file: "/inspirations/haohaoxue.json" },
    { key: "youmind", file: "/inspirations/youmind.json" },
] as const;

function webLink(value: string | undefined, httpsOnly = false): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return !url.username && !url.password && (url.protocol === "https:" || (!httpsOnly && url.protocol === "http:"));
    } catch {
        return false;
    }
}

/** Official source identity and required content are checked independently of licensed records. */
export function normalizeOfficialInspiration(input: unknown): OfficialCatalogEntry {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("官方目录条目格式不正确");
    const { authorization, ...raw } = input as CreationInspiration;
    const sourceId = raw.sourceId ?? "original";
    if (!isOfficialInspirationSource(sourceId) || authorization !== undefined) throw new Error("官方目录来源不一致，不能视为本站审核授权");
    if (typeof raw.title !== "string" || !raw.title.trim() || typeof raw.prompt !== "string" || !raw.prompt.trim() || typeof raw.description !== "string") throw new Error("官方目录条目缺少标题或提示词");
    if (!["image", "video", "text"].includes(raw.mode)) throw new Error("官方目录创作类型无效");
    if (typeof raw.image !== "string" || (!(raw.image.startsWith("/") && !raw.image.startsWith("//")) && !webLink(raw.image))) throw new Error("官方目录封面地址无效");
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== "string"))) throw new Error("官方目录标签格式不正确");
    for (const field of ["model", "promptZh", "category", "credit", "ratio", "addedAt", "publishedAt"] as const) {
        if (raw[field] !== undefined && typeof raw[field] !== "string") throw new Error("官方目录元数据格式不正确");
    }
    if (raw.featured !== undefined && typeof raw.featured !== "boolean") throw new Error("官方目录精选标记格式不正确");
    for (const value of [raw.width, raw.height]) {
        if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 20000)) throw new Error("官方目录媒体尺寸无效");
    }
    if (raw.videoUrl !== undefined && !webLink(raw.videoUrl, true)) throw new Error("官方目录视频地址无效");
    const id = catalogIdOf({ ...raw, sourceId });
    if (typeof id !== "string" || !id.startsWith(`${sourceId}:`) || id.length <= sourceId.length + 1) throw new Error("官方目录稳定 ID 与来源不一致");
    if (raw.sourceUrl !== undefined && !webLink(raw.sourceUrl)) throw new Error("官方目录原始出处无效");
    return { ...raw, id, slug: id.slice(sourceId.length + 1), sourceId, model: raw.model ?? "", galleryUrl: raw.sourceUrl || inspirationSources[sourceId].repository || "" };
}

export function readOfficialCatalogPack(payload: unknown, expectedSource: OfficialInspirationSourceId, file: string): OfficialCatalogEntry[] {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray((payload as { entries?: unknown }).entries)) throw new Error(`${file} 缺少 entries 列表`);
    const entries = (payload as { entries: unknown[] }).entries.map(normalizeOfficialInspiration);
    if (entries.some((item) => item.sourceId !== expectedSource)) throw new Error(`${file} 官方目录来源不一致`);
    return entries;
}

/** Static content wins: the optional feed can only add previously unknown Seedance/YouMind IDs. */
export function buildOfficialCatalog(packs: readonly OfficialCatalogEntry[][], manifest: OfficialCatalogManifest = {}, feed: OfficialCatalogFeed | null = null, videos: InspirationVideoLinks | null = null): InspirationCatalog {
    if (packs.length !== OFFICIAL_CATALOG_FILES.length) throw new Error("官方静态目录数量不完整");
    const entries = [...packs.flat(), ...curatedInspirations.map(normalizeOfficialInspiration)];
    const known = new Set(entries.map((item) => item.id));
    const labelsOf = (sourceId: OfficialInspirationSourceId) => ({ ...(feed?.categories?.[sourceId] ?? {}), ...(manifest.sources?.[sourceId]?.categories ?? {}) });
    if (feed?.enabled) {
        for (const candidate of feed.entries) {
            if ((candidate.sourceId !== "seedance" && candidate.sourceId !== "youmind") || !candidate.id || known.has(candidate.id) || !webLink(candidate.image, true)) continue;
            try {
                const item = normalizeOfficialInspiration({ ...candidate, description: candidate.description || (candidate.category ? (labelsOf(candidate.sourceId)[candidate.category] ?? "") : "") });
                known.add(item.id);
                entries.push(item);
            } catch {
                // Optional upstream additions cannot turn malformed data into usable content.
            }
        }
    }
    const categoriesBySource = {} as InspirationCatalog["categoriesBySource"];
    const revisions: Record<string, string> = {};
    for (const sourceId of OFFICIAL_INSPIRATION_SOURCES) {
        const counts = new Map<string, number>();
        for (const item of entries) {
            if (item.sourceId === sourceId && item.category?.trim()) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
        }
        const labels = labelsOf(sourceId);
        categoriesBySource[sourceId] = [...counts].map(([id, count]) => ({ id, label: labels[id] ?? id, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-Hans-CN"));
        const revision = manifest.sources?.[sourceId]?.revision || inspirationSources[sourceId].revision;
        if (revision) revisions[sourceId] = revision;
    }
    let syncedVideos: InspirationVideoLinks | null = null;
    if (feed?.enabled && feed.videoLinks) {
        try {
            syncedVideos = readInspirationVideoLinks(feed.videoLinks);
        } catch {
            // The API logs malformed optional metadata; direct callers also keep static videos.
        }
    }
    return { entries: enrichInspirationVideos(entries, videos, syncedVideos), categoriesBySource, revisions, loadedAt: Date.now() };
}

export function officialCategoryLabel(catalog: InspirationCatalog, category?: string, sourceId?: OfficialInspirationSourceId): string {
    if (!category) return "未分类";
    const sources = sourceId ? [sourceId] : OFFICIAL_INSPIRATION_SOURCES;
    for (const source of sources) {
        const found = catalog.categoriesBySource[source].find((entry) => entry.id === category);
        if (found) return found.label;
    }
    return category;
}

export function filterOfficialCatalog(catalog: InspirationCatalog, query: OfficialCatalogQuery = {}): OfficialCatalogEntry[] {
    const keyword = query.search?.trim().toLocaleLowerCase();
    const items = catalog.entries.filter((item) => {
        if (query.sourceId && item.sourceId !== query.sourceId) return false;
        if (query.mediaType && item.mode !== query.mediaType) return false;
        if (query.mediaTypes && !query.mediaTypes.includes(item.mode)) return false;
        if (query.category && item.category !== query.category) return false;
        if (query.model && item.model !== query.model) return false;
        if (query.sort === "featured" && !item.featured) return false;
        return !keyword || [item.title, item.description, item.credit, item.model, item.category, officialCategoryLabel(catalog, item.category, item.sourceId), ...(item.tags ?? [])].join(" ").toLocaleLowerCase().includes(keyword);
    });
    return orderInspirationsByLatest(items, localDayKey()) as OfficialCatalogEntry[];
}

export function pageOfficialCatalog(catalog: InspirationCatalog, query: OfficialCatalogQuery = {}) {
    const filtered = filterOfficialCatalog(catalog, query);
    const limit = query.limit ?? 24;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("官方目录分页数量无效");
    if (query.cursor && !/^catalog_(0|[1-9]\d{0,6})$/.test(query.cursor)) throw new Error("官方目录分页游标无效");
    const offset = query.cursor ? Number(query.cursor.slice("catalog_".length)) : 0;
    if (offset > filtered.length) throw new Error("官方目录分页游标超出当前筛选");
    const items = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? `catalog_${offset + limit}` : undefined;
    return { items, total: filtered.length, ...(nextCursor ? { nextCursor } : {}) };
}
