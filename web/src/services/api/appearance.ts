import { http } from "@/services/api/request";
import type { SkinDefinition } from "@/lib/skin-themes";
import type { AgentAvatarBundleManifest, CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { apiBaseURL } from "@/services/api/request";
import type { UpdateAnnouncement } from "@/lib/update-announcement";

export type PublicAppearance = {
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoUrl: string;
    darkLogoUrl: string;
    logoFrameEnabled: boolean;
    authVideoUrl: string;
    authVideoPosterUrl: string;
    authVideoAutoplay: boolean;
    /** 登录弹窗左侧轮播；为空时前端回退到 authVideoUrl / authVideoPosterUrl 那一张。 */
    authCarousel?: PublicAppearanceCarouselItem[];
    skinId: string;
    activeSkin: SkinDefinition;
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
    redeemPurchaseUrl: string;
    qqGroupNumber?: string;
    qqGroupQrcodeUrl?: string;
    qqGroupLink?: string;
    logoConfigured: boolean;
    darkLogoConfigured: boolean;
    authVideoConfigured: boolean;
    authVideoPosterConfigured: boolean;
    configured: boolean;
    revision: string;
    updatedAt?: string;
};

export type AppearanceCarouselKind = "image" | "video";

/** 下发给访客的轮播条目：地址已经是可直接播放/展示的 URL。 */
export type PublicAppearanceCarouselItem = {
    id: string;
    kind: AppearanceCarouselKind;
    url: string;
    posterUrl: string;
    title: string;
    subtitle: string;
};

/** 后台编辑用的轮播条目：持有资源 ID，媒体通过 carousel-<id>-<kind> 槽位上传。 */
export type AdminAppearanceCarouselItem = {
    id: string;
    kind: AppearanceCarouselKind;
    mediaResourceId: string;
    posterResourceId: string;
    title: string;
    subtitle: string;
};

export type AdminAppearance = {
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoResourceId: string;
    darkLogoResourceId: string;
    logoFrameEnabled: boolean;
    authVideoResourceId: string;
    authVideoPosterResourceId: string;
    authVideoAutoplay: boolean;
    authCarousel: AdminAppearanceCarouselItem[];
    skinId: string;
    skinThemes: SkinDefinition[];
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
    redeemPurchaseUrl: string;
    qqGroupNumber?: string;
    qqGroupQrcodeResourceId?: string;
    qqGroupLink?: string;
    public: PublicAppearance;
    configured: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type AppearanceAssetSlot = "logo" | "logo-dark" | "video" | "poster" | "qq-group-qrcode";
export type AppearanceAssetUploadSlot = AppearanceAssetSlot;

export type AppearanceResource = {
    id: string;
    kind: string;
    status: string;
    mimeType: string;
    size: number;
};

export type AgentAvatarBundleImport = {
    resourceId: string;
    manifest: AgentAvatarBundleManifest;
};

export async function getPublicAppearance(signal?: AbortSignal) {
    const result = await http.get<{ appearance: PublicAppearance }>("/public/appearance", { signal });
    return result.appearance;
}

export async function getAdminAppearance(signal?: AbortSignal) {
    const result = await http.get<{ setting: AdminAppearance }>("/admin/settings/appearance", { signal });
    return result.setting;
}

export async function updateAdminAppearance(
    input: Pick<
        AdminAppearance,
        | "brandName"
        | "canvas"
        | "updates"
        | "brandSlug"
        | "authHeroTitle"
        | "authHeroDescription"
        | "logoResourceId"
        | "darkLogoResourceId"
        | "logoFrameEnabled"
        | "authVideoResourceId"
        | "authVideoPosterResourceId"
        | "authVideoAutoplay"
        | "authCarousel"
        | "skinId"
        | "skinThemes"
        | "seoTitle"
        | "seoDescription"
        | "seoKeywords"
        | "footerCopyright"
        | "icpFilingEnabled"
        | "icpFilingNumber"
        | "redeemPurchaseUrl"
        | "qqGroupNumber"
        | "qqGroupQrcodeResourceId"
        | "qqGroupLink"
    >,
) {
    const result = await http.patch<{ setting: AdminAppearance }>("/admin/settings/appearance", input);
    return result.setting;
}

export async function resetAdminAppearance() {
    const result = await http.delete<{ setting: AdminAppearance }>("/admin/settings/appearance");
    return result.setting;
}

export async function uploadAppearanceAsset(slot: AppearanceAssetUploadSlot | "update-image" | "update-video" | string, file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ resource: AppearanceResource }>(`/admin/settings/appearance/assets/${slot}`, body);
    return result.resource;
}

export function appearanceAssetURL(slot: AppearanceAssetUploadSlot, revision = "") {
    const query = revision ? `?v=${encodeURIComponent(revision)}` : "";
    return `${apiBaseURL.replace(/\/$/, "")}/public/appearance/assets/${encodeURIComponent(slot)}${query}`;
}

export function updateAnnouncementPreviewURL(resourceId: string) {
    return `${apiBaseURL.replace(/\/$/, "")}/admin/settings/appearance/updates/${encodeURIComponent(resourceId)}`;
}

export async function uploadLive2D(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ model: { resourceId: string; entry: string } }>("/admin/settings/appearance/live2d", body);
    return result.model;
}

export async function uploadAgentAvatarBundle(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ bundle: AgentAvatarBundleImport }>("/admin/settings/appearance/avatar-bundles", body);
    return result.bundle;
}

export function agentAvatarBundleFileURL(resourceId: string, file: string, preview = false, revision = "") {
    const endpoint = preview ? "admin/settings" : "public";
    const query = !preview && revision ? `?v=${encodeURIComponent(revision)}` : "";
    return `${apiBaseURL.replace(/\/$/, "")}/${endpoint}/appearance/avatar/${encodeURIComponent(resourceId)}/${encodeURIComponent(file)}${query}`;
}

export function live2DModelURL(resourceId: string, entry: string, preview = false) {
    return `${apiBaseURL.replace(/\/$/, "")}/${preview ? "admin/settings" : "public"}/appearance/live2d/${encodeURIComponent(resourceId)}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}
