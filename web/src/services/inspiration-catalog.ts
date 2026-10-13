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
import { curatedInspirations, type CreationInspiration, type InspirationCategoryLabels, type InspirationSourceId } from "@/lib/inspirations/catalog";

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

async function buildCatalog(): Promise<InspirationCatalog> {
    const [manifest, ...packs] = await Promise.all([
        fetchJson<CatalogManifest>("/inspirations/manifest.json").catch(() => ({ sources: {} }) as CatalogManifest),
        ...CATALOG_SOURCES.map((source) => fetchJson<unknown>(source.file).then((payload) => readEntries(payload, source.file))),
    ]);

    const entriesBySource = new Map<InspirationSourceId, CreationInspiration[]>();
    CATALOG_SOURCES.forEach((source, index) => entriesBySource.set(source.key, packs[index]));
    entriesBySource.set("original", curatedInspirations);

    const categoriesBySource = {} as Record<InspirationSourceId, InspirationCategoryOption[]>;
    const revisions: Record<string, string> = {};
    for (const [sourceId, sourceEntries] of entriesBySource) {
        if (manifest.sources?.[sourceId]?.revision) revisions[sourceId] = manifest.sources[sourceId]!.revision!;
        const labels = manifest.sources?.[sourceId]?.categories ?? {};
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
