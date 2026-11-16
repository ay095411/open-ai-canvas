import type { CreationInspiration } from "./catalog";
import { normalizeAuthorizedSummary, normalizeExternalFavorite, normalizeOnlineSummary } from "./external-favorites";
import type { InspirationGalleryDetail, InspirationGallerySummary } from "@/services/api/online-gallery";
import type { ZzaiGalleryQuery } from "@/services/api/zzai-gallery";

const categoryLabels: Record<string, string> = {
    character: "角色设定",
    infographic: "信息图",
    interior: "室内空间",
    logo: "标志设计",
    portrait: "人物肖像",
    poster: "海报",
    product: "产品",
    sticker: "贴纸",
    story: "故事",
    "video-ad": "视频广告",
};

export function zzaiCategoryLabel(category?: string): string {
    return category ? (categoryLabels[category] ?? category) : "未分类";
}

/** 游标页重叠时保留首次看到的条目，避免追加页改写旧卡片内容与高度。 */
export function mergeZzaiGalleryPages<T extends InspirationGallerySummary>(pages: readonly { items: readonly T[] }[]): T[] {
    const entries = new Map<string, T>();
    for (const page of pages) {
        for (const item of page.items) {
            if (!entries.has(item.id)) entries.set(item.id, item);
        }
    }
    return [...entries.values()];
}

/** Read summaries never become empty-prompt bookmarks or creation requests. */
export function toZzaiGalleryInspiration(detail: InspirationGalleryDetail): CreationInspiration {
    if (!detail || !detail.slug?.trim() || detail.id !== `${detail.sourceId}:${detail.slug}`) {
        throw new Error("画廊详情不完整，无法收藏或带入创作区");
    }
    return normalizeExternalFavorite(detail);
}

/** 授权收藏来自当前 resolve，在线收藏保留来源身份；正文均不参与摘要筛选。 */
export function filterZzaiGalleryFavorites<T extends InspirationGallerySummary | CreationInspiration>(entries: readonly T[], query: ZzaiGalleryQuery): T[] {
    const keyword = query.search?.trim().toLocaleLowerCase();
    const filtered = entries.filter((item) => {
        try {
            if (item.sourceId === "authorized-library") normalizeAuthorizedSummary(item);
            else if (item.sourceId === "zzai-gallery") normalizeOnlineSummary(item);
            else return false;
        } catch {
            // 本地历史快照可能缺失来源元数据；展示筛选不能将其当作可用条目。
            return false;
        }
        if (query.mediaType && item.mode !== query.mediaType) return false;
        if (query.category && item.category !== query.category) return false;
        if (query.model && item.model !== query.model) return false;
        if (query.sort === "featured" && !item.featured) return false;
        return !keyword || [item.title, item.description, item.credit, item.model, zzaiCategoryLabel(item.category), ...(item.tags ?? [])].join(" ").toLocaleLowerCase().includes(keyword);
    });
    return [...filtered].sort((left, right) => {
        const leftTime = Date.parse(left.publishedAt ?? "") || 0;
        const rightTime = Date.parse(right.publishedAt ?? "") || 0;
        return rightTime - leftTime || (left.id ?? "").localeCompare(right.id ?? "");
    });
}
