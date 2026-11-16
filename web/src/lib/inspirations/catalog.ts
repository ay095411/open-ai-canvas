import type { CreationMode } from "@/lib/creation-mode";

export type InspirationSourceId = "original" | "zzai-gallery" | "authorized-library";
export type InspirationGallerySource = Exclude<InspirationSourceId, "original">;
export type InspirationLicense = { name: string; url: string; attribution: string; rightsholder?: string };
export type InspirationAuthorization = { policyVersion: "licensed-v1"; contentHash: string; revision: number; promptLicense: InspirationLicense; mediaLicense: InspirationLicense };

export type InspirationSourceInfo = {
    label: string;
    name?: string;
    license?: string;
    notice?: string;
};

export const inspirationSources: Record<InspirationSourceId, InspirationSourceInfo> = {
    original: { label: "原创提示词" },
    "authorized-library": { label: "已核验授权素材", name: "已核验授权素材", notice: "提示词与展示媒体分别经过发布授权核验；使用时请保留以下署名和许可条件。" },
    "zzai-gallery": {
        label: "在线图库",
        name: "在线图库 · Seedance 社区",
        notice: "外部社区示例仅供创作参考，本站未核验其转载或商用授权；使用前请查看原始出处并确认许可，保留作者署名。",
    },
};

export function inspirationSourceOf(item: CreationInspiration): InspirationSourceInfo {
    return inspirationSources[item.sourceId ?? "original"];
}

export type CreationInspiration = {
    id?: string;
    title: string;
    description: string;
    image: string;
    mode: CreationMode;
    prompt: string;
    /** 上游提供的中文正文，不自动翻译。 */
    promptZh?: string;
    /** 上游分类 id。 */
    category?: string;
    tags?: string[];
    /** 画面比例，例如 "4:5"；上游有才带。 */
    ratio?: string;
    featured?: boolean;
    /** 来源归属。 */
    sourceId?: InspirationSourceId;
    /** 署名，例如外部案例的作者或提示词角色名。 */
    credit?: string;
    /** 回到上游原页的链接。 */
    sourceUrl?: string;
    /** 上游提供的媒体像素尺寸，用于稳定封面比例。 */
    width?: number;
    height?: number;
    /** 上游发布时间（ISO），用于最新排序。 */
    publishedAt?: string;
    /** 在线画廊标注的模型，仅供参考，不自动切换本项目的生成渠道。 */
    model?: string;
    /** 聚合站条目页，与 sourceUrl 指向的原始出处分开保留。 */
    galleryUrl?: string;
    videoUrl?: string;
    usageNotes?: string;
    requiresReference?: boolean;
    authorization?: InspirationAuthorization;
};

/** 条目在本地存储里的稳定键。 */
export function catalogIdOf(item: Pick<CreationInspiration, "id" | "title" | "sourceId">): string {
    return item.id ?? `${item.sourceId ?? "original"}:${item.title}`;
}
