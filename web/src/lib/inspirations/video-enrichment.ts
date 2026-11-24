type VideoCatalogItem = { id: string; sourceId?: string; sourceUrl?: string; mode: string; videoUrl?: string };

export type InspirationVideoLink = { id: string; sourceId: "seedance"; sourceUrl: string; videoUrl: string };
export type InspirationVideoLinks = { entries: InspirationVideoLink[]; rejectedCount: number };
export type InspirationVideoLinksPayload = { version: 1; entries: InspirationVideoLink[]; syncedAt?: string };

export function publicInspirationVideoUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            !url.search &&
            !url.hash &&
            url.hostname === "media.goodcase.ai" &&
            /^(\/media\/(video|goodcase)\/|\/cases\/|\/supabase-legacy\/case-media\/).+\.mp4$/i.test(url.pathname)
        );
    } catch {
        return false;
    }
}

function publicSourceUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
    } catch {
        return false;
    }
}

/** Supplementary media is optional; malformed rows never replace official content. */
export function readInspirationVideoLinks(input: unknown): InspirationVideoLinks {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("视频补充目录格式不正确");
    const payload = input as { version?: unknown; entries?: unknown };
    if (payload.version !== 1 || !Array.isArray(payload.entries) || payload.entries.length > 5000) throw new Error("视频补充目录版本或条目数量不正确");
    const entries = new Map<string, InspirationVideoLink>();
    const conflicts = new Set<string>();
    let rejectedCount = 0;
    for (const value of payload.entries) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            rejectedCount += 1;
            continue;
        }
        const row = value as Record<string, unknown>;
        if (
            row.sourceId !== "seedance" ||
            typeof row.id !== "string" ||
            !/^seedance:[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(row.id) ||
            row.authorization !== undefined ||
            !publicSourceUrl(row.sourceUrl) ||
            !publicInspirationVideoUrl(row.videoUrl) ||
            row.expiresAt !== undefined
        ) {
            rejectedCount += 1;
            continue;
        }
        if (conflicts.has(row.id)) {
            rejectedCount += 1;
            continue;
        }
        const previous = entries.get(row.id);
        if (previous && (previous.sourceUrl !== row.sourceUrl || previous.videoUrl !== row.videoUrl)) {
            entries.delete(row.id);
            conflicts.add(row.id);
            rejectedCount += 2;
            continue;
        }
        entries.set(row.id, { id: row.id, sourceId: "seedance", sourceUrl: row.sourceUrl, videoUrl: row.videoUrl });
    }
    return { entries: [...entries.values()], rejectedCount };
}

/** Only enrich the same case and original source; no title-based matches or content replacement. */
export function enrichInspirationVideos<T extends VideoCatalogItem>(items: readonly T[], links: InspirationVideoLinks | null, syncedLinks: InspirationVideoLinks | null = null): T[] {
    if (!links && !syncedLinks) return [...items];
    const byId = new Map(links?.entries.map((entry) => [entry.id, entry]) ?? []);
    const syncedById = new Map(syncedLinks?.entries.map((entry) => [entry.id, entry]) ?? []);
    return items.map((item) => {
        if (item.videoUrl || item.mode !== "video" || item.sourceId !== "seedance") return item;
        const synced = syncedById.get(item.id);
        const link = synced?.sourceUrl === item.sourceUrl ? synced : byId.get(item.id);
        if (!link || item.sourceId !== link.sourceId || item.sourceUrl !== link.sourceUrl) return item;
        return { ...item, videoUrl: link.videoUrl };
    });
}
