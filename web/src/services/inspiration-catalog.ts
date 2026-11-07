/**
 * 全量灵感目录的运行时加载。
 *
 * 目录是 3.8MB 量级（原创 + seedance 2.8MB + haohaoxue 0.6MB + youmind 0.5MB），
 * 不能打进主 JS，所以构建期落成 public/inspirations/*.json，运行时拉取；
 * 浏览器 HTTP 缓存之外再做一层内存缓存，同一次会话只请求一遍。
 *
 * ⚠️ 首页瀑布流与 /inspirations 页**共用这一个加载器** —— 两处必须看到同一份目录、
 * 同一套用户叠加层（见 `lib/inspirations/resolve.ts` 的 `resolveInspirations`），
 * 否则「库里隐藏了，首页还在」这类不一致会立刻冒出来。
 */
import { catalogIdOf, curatedInspirations, type CreationInspiration, type InspirationCategoryLabels, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { getPublicInspirationFeed, type InspirationFeed } from "@/services/api/inspiration-feed";

/** manifest.json 里每个来源带的分类码译名表。 */
type SourceManifest = { revision?: string; count?: number; categories?: Record<string, string> };
type CatalogManifest = { generatedAt?: string; sources?: Record<string, SourceManifest> };

export type InspirationCategoryOption = {
    id: string;
    label: string;
    count: number;
};

export type InspirationCatalog = {
    /** 原创 + 全部外部来源，已按来源归并。 */
    entries: CreationInspiration[];
    /** 各来源的分类选项，只保留有条目的那些。 */
    categoriesBySource: Record<InspirationSourceId, InspirationCategoryOption[]>;
    /** 未知分类码的兜底译名表，页面直接用 code 显示。 */
    revisions: Record<string, string>;
    loadedAt: number;
};

const CATALOG_SOURCES: { key: InspirationSourceId; file: string }[] = [
    { key: "seedance", file: "/inspirations/seedance.json" },
    { key: "haohaoxue", file: "/inspirations/haohaoxue.json" },
    { key: "youmind", file: "/inspirations/youmind.json" },
];

let pending: Promise<InspirationCatalog> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`加载灵感目录失败：${url} 返回 HTTP ${response.status}`);
    return (await response.json()) as T;
}

/** 目录文件是构建期生成的，但仍然是外部数据：形状不对就抛错，不能当成空目录糊过去。 */
function readEntries(payload: unknown, file: string): CreationInspiration[] {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${file} 结构不是目录格式`);
    const entries = (payload as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) throw new Error(`${file} 缺少 entries 列表`);
    return entries as CreationInspiration[];
}

/** 后端定时同步的上新条目只来自这两个来源；其他 sourceId 一律忽略。 */
const FEED_SOURCES = new Set<InspirationSourceId>(["seedance", "youmind"]);

/** 上新是静态目录之外的补充：拿不到就只展示静态目录，不影响灵感大厅本身。 */
function loadFeed(): Promise<InspirationFeed | null> {
    return getPublicInspirationFeed().catch((error) => {
        console.warn("灵感上新加载失败，只展示内置目录", error);
        return null;
    });
}

function isWebLink(value: string | undefined, httpsOnly = false) {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (!httpsOnly && url.protocol === "http:");
    } catch {
        return false;
    }
}

/** 首页作品带与全量目录共用上新条目的校验、去重和来源信息。 */
export function inspirationFeedEntries(feed: InspirationFeed | null, labelsOf: (sourceId: InspirationSourceId) => Record<string, string> = (sourceId) => feed?.categories?.[sourceId] ?? {}): CreationInspiration[] {
    if (!feed?.enabled) return [];
    const known = new Set<string>();
    const entries: CreationInspiration[] = [];
    for (const entry of feed.entries) {
        const sourceId = entry.sourceId as InspirationSourceId;
        if (!FEED_SOURCES.has(sourceId) || !entry.id?.trim() || known.has(entry.id) || !entry.title?.trim() || !entry.prompt?.trim() || !["text", "image", "video"].includes(entry.mode) || !isWebLink(entry.image, true)) continue;
        known.add(entry.id);
        entries.push({
            id: entry.id,
            title: entry.title,
            // 与静态目录一致：没有中文摘要时用分类名做描述。
            description: entry.description || (entry.category ? (labelsOf(sourceId)[entry.category] ?? "") : ""),
            image: entry.image,
            mode: entry.mode,
            prompt: entry.prompt,
            sourceId,
            addedAt: entry.addedAt,
            ...(entry.category ? { category: entry.category } : {}),
            ...(entry.tags?.length ? { tags: entry.tags } : {}),
            ...(entry.credit ? { credit: entry.credit } : {}),
            ...(isWebLink(entry.sourceUrl) ? { sourceUrl: entry.sourceUrl } : {}),
            ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
        });
    }
    return entries;
}

/** 静态目录已有的条目以静态目录为准（带人工译审和本地缩略图），上新只补目录里没有的。 */
function mergeFeed(entriesBySource: Map<InspirationSourceId, CreationInspiration[]>, feed: InspirationFeed | null, labelsOf: (sourceId: InspirationSourceId) => Record<string, string>) {
    const known = new Set([...entriesBySource.values()].flat().map(catalogIdOf));
    for (const entry of inspirationFeedEntries(feed, labelsOf)) {
        if (!known.has(catalogIdOf(entry))) entriesBySource.get(entry.sourceId!)?.push(entry);
    }
}

async function buildCatalog(): Promise<InspirationCatalog> {
    const [manifest, feed, ...packs] = await Promise.all([
        fetchJson<CatalogManifest>("/inspirations/manifest.json").catch(() => ({ sources: {} }) as CatalogManifest),
        loadFeed(),
        ...CATALOG_SOURCES.map((source) => fetchJson<unknown>(source.file).then((payload) => readEntries(payload, source.file))),
    ]);

    const entriesBySource = new Map<InspirationSourceId, CreationInspiration[]>();
    CATALOG_SOURCES.forEach((source, index) => entriesBySource.set(source.key, [...packs[index]]));
    entriesBySource.set("original", curatedInspirations);
    // 静态目录的分类名优先，上游新增的分类码再用上新接口带回的名称。
    const labelsOf = (sourceId: InspirationSourceId) => ({ ...(feed?.categories?.[sourceId] ?? {}), ...(manifest.sources?.[sourceId]?.categories ?? {}) });
    mergeFeed(entriesBySource, feed, labelsOf);

    const categoriesBySource = {} as Record<InspirationSourceId, InspirationCategoryOption[]>;
    const revisions: Record<string, string> = {};
    for (const [sourceId, sourceEntries] of entriesBySource) {
        if (manifest.sources?.[sourceId]?.revision) revisions[sourceId] = manifest.sources[sourceId]!.revision!;
        const labels = labelsOf(sourceId);
        const counts = new Map<string, number>();
        for (const entry of sourceEntries) {
            const category = entry.category?.trim();
            if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
        }
        categoriesBySource[sourceId] = [...counts.entries()].map(([id, count]) => ({ id, label: labels[id] ?? id, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-Hans-CN"));
    }

    return {
        entries: [...entriesBySource.values()].flat(),
        categoriesBySource,
        revisions,
        loadedAt: Date.now(),
    };
}

/** 管理员改了上新开关或刚同步完，下次进入灵感大厅重新拉取。 */
export function invalidateInspirationCatalog() {
    pending = null;
}

/** 同一次会话只拉一遍；失败后清空缓存，下次进入页面还能重试。 */
export function loadInspirationCatalog(): Promise<InspirationCatalog> {
    if (!pending) {
        pending = buildCatalog().catch((error) => {
            pending = null;
            throw error;
        });
    }
    return pending;
}

/**
 * `categoriesBySource` 是给筛选器用的有序数组（带条目数）；
 * 而「把条目上的分类码翻成中文」要的是 code → label 的表。
 * 两处都需要，所以在这里一次性转好，避免各调用方各写一遍。
 */
export function categoryLabelsOf(catalog: InspirationCatalog): InspirationCategoryLabels {
    const table: InspirationCategoryLabels = {};
    for (const [sourceId, options] of Object.entries(catalog.categoriesBySource)) {
        table[sourceId] = Object.fromEntries(options.map((option) => [option.id, option.label]));
    }
    return table;
}
