import type { ZzaiGalleryDetail, ZzaiGallerySummary } from "@/services/api/zzai-gallery";

export const policyVersion = "licensed-v1" as const;
export function authorizedMedia(slug: string, kind: "image" | "video" = "image", revision = 1) {
    return `/api/public/inspirations/library/prompts/${encodeURIComponent(slug)}/media?kind=${kind}&hash=${(kind === "image" ? "b" : "c").repeat(64)}&revision=${revision}`;
}
export function authorizedEntry(slug: string, patch: Partial<ZzaiGalleryDetail> = {}): ZzaiGalleryDetail {
    return {
        id: `authorized-library:${slug}`,
        slug,
        sourceId: "authorized-library",
        title: `已核验 ${slug}`,
        description: "授权发布库本地测试素材",
        image: authorizedMedia(slug),
        width: 800,
        height: 600,
        mode: "image",
        model: "测试模型",
        prompt: `Original prompt for ${slug}.`,
        promptZh: `为 ${slug} 创作一张电影画面，保留原始镜头和光线描述。`,
        credit: `作者 ${slug}`,
        sourceUrl: `https://example.com/works/${slug}`,
        galleryUrl: `https://example.com/works/${slug}`,
        category: "portrait",
        publishedAt: "2026-11-15T01:00:00Z",
        authorization: {
            policyVersion,
            contentHash: "a".repeat(64),
            revision: 1,
            promptLicense: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: `提示词作者 ${slug}` },
            mediaLicense: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: `媒体作者 ${slug}` },
        },
        ...patch,
    };
}
export function authorizedSummary(item: ZzaiGalleryDetail): ZzaiGallerySummary {
    const { prompt: _, promptZh: __, ...summary } = item;
    return summary;
}
