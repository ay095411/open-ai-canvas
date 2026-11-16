import { type CreationInspiration, type InspirationAuthorization } from "./catalog";

export type AuthorizedInspirationSummary = Omit<CreationInspiration, "prompt" | "promptZh"> & {
    id: string;
    slug: string;
    sourceId: "authorized-library";
    mode: "image" | "video";
    model: string;
    galleryUrl: string;
    authorization: InspirationAuthorization;
};
export type OnlineInspirationSummary = Omit<CreationInspiration, "prompt" | "promptZh" | "authorization"> & {
    id: string;
    slug: string;
    sourceId: "zzai-gallery";
    mode: "image" | "video";
    model: string;
    galleryUrl: string;
    authorization?: never;
};
export type OnlineInspirationDetail = OnlineInspirationSummary & { prompt: string; promptZh?: string };
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/;
const HASH = /^[a-f0-9]{64}$/i;

export function isExternalInspiration(id: string): boolean {
    return id.startsWith("zzai-gallery:") || id.startsWith("authorized-library:");
}
function text(value: unknown, limit: number, required = false): string | undefined {
    if (value === undefined || value === "") {
        if (required) throw new Error("授权素材缺少完整内容");
        return undefined;
    }
    if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error("授权素材内容格式不正确");
    return value.trim() || undefined;
}
function link(value: unknown, required = false): string | undefined {
    const candidate = text(value, 4096, required);
    if (!candidate) return undefined;
    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        throw new Error("授权素材链接格式不正确");
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("授权素材链接格式不正确");
    return url.href;
}
function media(value: unknown, slug: string, revision: number, kind: "image" | "video", required = false): string | undefined {
    const candidate = text(value, 4096, required);
    if (!candidate) return undefined;
    const prefix = `/api/public/inspirations/library/prompts/${encodeURIComponent(slug)}/media`;
    if (!candidate.startsWith(prefix + "?") || candidate.includes("\\")) throw new Error("授权素材只能使用已核验的同源媒体");
    const url = new URL(candidate, "https://library.invalid");
    if (
        url.pathname !== prefix ||
        url.hash ||
        url.searchParams.get("kind") !== kind ||
        !HASH.test(url.searchParams.get("hash") ?? "") ||
        url.searchParams.get("revision") !== String(revision) ||
        [...url.searchParams.keys()].sort().join(",") !== "hash,kind,revision"
    )
        throw new Error("授权素材媒体版本无效");
    return candidate;
}
function authorizationOf(input: unknown): InspirationAuthorization {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("素材授权凭据无效");
    const raw = input as InspirationAuthorization;
    if (raw.policyVersion !== "licensed-v1" || !HASH.test(raw.contentHash) || !Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error("素材授权凭据无效");
    const license = (value: InspirationAuthorization["promptLicense"]) => {
        if (!value || typeof value !== "object") throw new Error("素材缺少署名或许可");
        const rightsholder = text(value.rightsholder, 500);
        return { name: text(value.name, 500, true)!, url: link(value.url, true)!, attribution: text(value.attribution, 2000, true)!, ...(rightsholder ? { rightsholder } : {}) };
    };
    return { policyVersion: "licensed-v1", contentHash: raw.contentHash, revision: raw.revision, promptLicense: license(raw.promptLicense), mediaLicense: license(raw.mediaLicense) };
}

/** 仅验证当前服务响应格式；本地快照不能代替服务端的 approved 状态。 */
export function normalizeAuthorizedSummary(input: unknown): AuthorizedInspirationSummary {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("授权素材内容格式不正确");
    const raw = input as Record<string, unknown>;
    const slug = typeof raw.slug === "string" ? raw.slug : typeof raw.id === "string" ? raw.id.slice("authorized-library:".length) : "";
    if (!SLUG.test(slug) || raw.id !== `authorized-library:${slug}` || raw.sourceId !== "authorized-library" || (raw.mode !== "image" && raw.mode !== "video")) throw new Error("素材未通过发布授权核验");
    const authorization = authorizationOf(raw.authorization);
    const optional = {
        category: text(raw.category, 128),
        ratio: text(raw.ratio, 32),
        credit: text(raw.credit, 500),
        sourceUrl: link(raw.sourceUrl),
        videoUrl: media(raw.videoUrl, slug, authorization.revision, "video"),
        usageNotes: text(raw.usageNotes, 16_384),
        publishedAt: text(raw.publishedAt, 64),
    };
    if (optional.publishedAt && !Number.isFinite(Date.parse(optional.publishedAt))) throw new Error("授权素材发布时间不正确");
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 50 || raw.tags.some((tag) => typeof tag !== "string" || tag.length > 128))) throw new Error("授权素材标签格式不正确");
    for (const key of ["width", "height"] as const) {
        if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0 || raw[key] > 20_000)) throw new Error("授权素材媒体尺寸不正确");
    }
    return {
        id: raw.id,
        slug,
        sourceId: "authorized-library",
        authorization,
        title: text(raw.title, 500, true)!,
        description: text(raw.description, 16_384) || "",
        image: media(raw.image, slug, authorization.revision, "image", true)!,
        mode: raw.mode,
        galleryUrl: link(raw.galleryUrl) || link(raw.sourceUrl, true)!,
        model: text(raw.model, 128) || "",
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
        ...(Array.isArray(raw.tags) ? { tags: raw.tags.map((tag: string) => tag.trim()).filter(Boolean) } : {}),
        ...(typeof raw.width === "number" ? { width: raw.width } : {}),
        ...(typeof raw.height === "number" ? { height: raw.height } : {}),
        ...(typeof raw.featured === "boolean" ? { featured: raw.featured } : {}),
        ...(typeof raw.requiresReference === "boolean" ? { requiresReference: raw.requiresReference } : {}),
    };
}

export function normalizeExternalFavorite(input: unknown): CreationInspiration {
    if (input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>).sourceId === "zzai-gallery") return normalizeOnlineFavorite(input);
    const summary = normalizeAuthorizedSummary(input);
    const raw = input as Record<string, unknown>;
    const promptZh = text(raw.promptZh, 200_000);
    const prompt = text(raw.prompt, 200_000) || promptZh;
    if (!prompt) throw new Error("请先加载完整提示词再收藏");
    return { ...summary, prompt, ...(promptZh ? { promptZh } : {}) };
}

function onlineText(value: unknown, limit: number, required = false): string | undefined {
    if (value === undefined || value === "") {
        if (required) throw new Error("在线示例缺少完整内容");
        return undefined;
    }
    if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error("在线示例内容格式不正确");
    return value.trim() || undefined;
}

function onlineLink(value: unknown, required = false, mediaOnly = false): string | undefined {
    const candidate = onlineText(value, 4096, required);
    if (!candidate) return undefined;
    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        throw new Error("在线示例链接格式不正确");
    }
    if (!(mediaOnly ? url.protocol === "https:" : ["https:", "http:"].includes(url.protocol)) || url.username || url.password || candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error("在线示例链接格式不正确");
    return url.href;
}

/** 在线聚合数据只保留来源元数据，不能冒充本站审核的授权素材。 */
export function normalizeOnlineSummary(input: unknown): OnlineInspirationSummary {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("在线示例内容格式不正确");
    const raw = input as Record<string, unknown>;
    const slug = typeof raw.slug === "string" ? raw.slug : typeof raw.id === "string" && raw.id.startsWith("zzai-gallery:") ? raw.id.slice("zzai-gallery:".length) : "";
    if (!SLUG.test(slug) || raw.id !== `zzai-gallery:${slug}` || raw.sourceId !== "zzai-gallery" || (raw.mode !== "image" && raw.mode !== "video") || raw.authorization !== undefined) throw new Error("在线示例来源与身份不一致");
    const galleryUrl = onlineLink(raw.galleryUrl, true, true)!;
    if (galleryUrl !== `https://api.seedance.nz/prompt-gallery/${encodeURIComponent(slug)}`) throw new Error("在线示例目录地址与条目不一致");
    const optional = {
        category: onlineText(raw.category, 128),
        ratio: onlineText(raw.ratio, 32),
        credit: onlineText(raw.credit, 500),
        sourceUrl: onlineLink(raw.sourceUrl),
        videoUrl: onlineLink(raw.videoUrl, false, true),
        publishedAt: onlineText(raw.publishedAt, 64),
    };
    if (optional.publishedAt && !Number.isFinite(Date.parse(optional.publishedAt))) throw new Error("在线示例发布时间不正确");
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 50 || raw.tags.some((tag) => typeof tag !== "string" || tag.length > 128))) throw new Error("在线示例标签格式不正确");
    for (const key of ["width", "height"] as const) {
        if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0 || raw[key] > 20_000)) throw new Error("在线示例媒体尺寸不正确");
    }
    if (raw.featured !== undefined && typeof raw.featured !== "boolean") throw new Error("在线示例精选标记格式不正确");
    return {
        id: raw.id,
        slug,
        sourceId: "zzai-gallery",
        title: onlineText(raw.title, 500, true)!,
        description: onlineText(raw.description, 16_384) || "",
        image: onlineLink(raw.image, true, true)!,
        mode: raw.mode,
        model: onlineText(raw.model, 128) || "",
        galleryUrl,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
        ...(Array.isArray(raw.tags) ? { tags: raw.tags.map((tag: string) => tag.trim()).filter(Boolean) } : {}),
        ...(typeof raw.width === "number" ? { width: raw.width } : {}),
        ...(typeof raw.height === "number" ? { height: raw.height } : {}),
        ...(typeof raw.featured === "boolean" ? { featured: raw.featured } : {}),
    };
}

export function normalizeOnlineFavorite(input: unknown): OnlineInspirationDetail {
    const summary = normalizeOnlineSummary(input);
    const raw = input as Record<string, unknown>;
    const promptZh = onlineText(raw.promptZh, 512 << 10);
    const prompt = onlineText(raw.prompt, 512 << 10) || promptZh;
    if (!prompt) throw new Error("请先加载完整提示词再收藏");
    const usageNotes = onlineText(raw.usageNotes, 16_384);
    if (raw.requiresReference !== undefined && typeof raw.requiresReference !== "boolean") throw new Error("在线示例参考素材标记格式不正确");
    return { ...summary, prompt, ...(promptZh ? { promptZh } : {}), ...(usageNotes ? { usageNotes } : {}), ...(typeof raw.requiresReference === "boolean" ? { requiresReference: raw.requiresReference } : {}) };
}
