import type { OfficialCatalogFeed } from "@/lib/inspirations/official-catalog";
import { readInspirationVideoLinks } from "@/lib/inspirations/video-enrichment";
import { http } from "./request";

export type InspirationFeed = OfficialCatalogFeed;
/** Optional official upstream additions; static packs remain the primary source. */
export function getPublicInspirationFeed(signal?: AbortSignal) {
    return http.get<InspirationFeed>("/public/inspirations/feed", { signal }).then((feed) => {
        if (!feed || typeof feed.enabled !== "boolean" || !Array.isArray(feed.entries)) throw new Error("灵感上新接口格式不正确");
        if (feed.videoLinks === undefined) return feed;
        if (!feed.enabled) return { ...feed, videoLinks: undefined };
        try {
            const links = readInspirationVideoLinks(feed.videoLinks);
            if (links.rejectedCount) console.warn(`灵感视频同步有 ${links.rejectedCount} 条无效地址，已忽略`);
            return { ...feed, videoLinks: { version: 1 as const, entries: links.entries, syncedAt: typeof feed.videoLinks?.syncedAt === "string" ? feed.videoLinks.syncedAt : undefined } };
        } catch (error) {
            console.warn("灵感视频同步数据无效，保留静态视频地址", error);
            return { ...feed, videoLinks: undefined };
        }
    });
}
