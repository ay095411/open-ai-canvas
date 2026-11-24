import { OFFICIAL_CATALOG_FILES, buildOfficialCatalog, readOfficialCatalogPack, type InspirationCatalog, type OfficialCatalogManifest } from "@/lib/inspirations/official-catalog";
import { getPublicInspirationFeed } from "@/services/api/inspiration-feed";
import { readInspirationVideoLinks } from "@/lib/inspirations/video-enrichment";
export type { InspirationCatalog } from "@/lib/inspirations/official-catalog";

let pending: Promise<InspirationCatalog> | null = null;
let loaded: InspirationCatalog | null = null;
let generation = 0;
export const INSPIRATION_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`加载官方灵感目录失败：${url} 返回 HTTP ${response.status}`);
    return response.json();
}

async function buildCatalog(): Promise<InspirationCatalog> {
    const [manifest, feed, videos, ...packs] = await Promise.all([
        fetchJson("/inspirations/manifest.json").catch(() => ({ sources: {} })),
        getPublicInspirationFeed().catch((error) => {
            console.warn("灵感上新加载失败，只展示官方静态目录", error);
            return null;
        }),
        fetchJson("/inspiration-video-urls.json")
            .then((payload) => {
                const links = readInspirationVideoLinks(payload);
                if (links.rejectedCount) console.warn(`视频补充目录有 ${links.rejectedCount} 条无效地址，已忽略`);
                return links;
            })
            .catch((error) => {
                console.warn("视频地址暂不可用，仍可浏览官方封面和提示词", error);
                return null;
            }),
        ...OFFICIAL_CATALOG_FILES.map(({ file, key }) => fetchJson(file).then((payload) => readOfficialCatalogPack(payload, key, file))),
    ]);
    const catalog = buildOfficialCatalog(packs as Awaited<ReturnType<typeof readOfficialCatalogPack>>[], manifest as OfficialCatalogManifest, feed as Awaited<ReturnType<typeof getPublicInspirationFeed>> | null, videos);
    return catalog;
}

export function invalidateInspirationCatalog() {
    generation += 1;
    pending = null;
    loaded = null;
}

export function loadedInspirationCatalog(): InspirationCatalog | null {
    if (!loaded) return null;
    const age = Date.now() - loaded.loadedAt;
    return age >= 0 && age < INSPIRATION_CATALOG_CACHE_TTL_MS ? loaded : null;
}

/** Match the public feed's five-minute cache; concurrent reads still share one request. */
export function loadInspirationCatalog(): Promise<InspirationCatalog> {
    const cached = loadedInspirationCatalog();
    if (cached) return Promise.resolve(cached);
    if (pending) return pending;
    const startedGeneration = generation;
    const request: Promise<InspirationCatalog> = buildCatalog()
        .then((catalog) => {
            if (generation === startedGeneration && pending === request) loaded = catalog;
            return catalog;
        })
        .finally(() => {
            if (pending === request) pending = null;
        });
    pending = request;
    return request;
}

export async function inspirationCatalogForSignal(signal?: AbortSignal): Promise<InspirationCatalog> {
    signal?.throwIfAborted();
    if (!signal) return loadInspirationCatalog();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("请求已取消", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        loadInspirationCatalog().then(
            (catalog) => {
                signal.removeEventListener("abort", abort);
                if (signal.aborted) abort();
                else resolve(catalog);
            },
            (error) => {
                signal.removeEventListener("abort", abort);
                reject(error);
            },
        );
    });
}
