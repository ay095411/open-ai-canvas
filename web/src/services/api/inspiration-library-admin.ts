import { apiBaseURL, compactApiParams, http } from "./request";

export type InspirationLibraryStatus = "pending" | "approved" | "rejected";

export type InspirationLibraryLicense = {
    name: string;
    url: string;
    rightsholder: string;
    attribution: string;
    evidence: string;
    commercialUse: boolean;
    redistribution: boolean;
};

export type LibraryCandidate = {
    slug: string;
    title: string;
    description: string;
    prompt: string;
    promptZh?: string;
    image: string;
    mode: "image" | "video";
    videoUrl?: string;
    sourceUrl: string;
    author: string;
    category?: string;
    tags?: string[];
    model?: string;
    width?: number;
    height?: number;
    featured?: boolean;
    promptLicense: InspirationLibraryLicense;
    mediaLicense: InspirationLibraryLicense;
    competitorAssociation?: boolean;
    competitorException: boolean;
    competitorEvidence?: string;
    mediaReviewed: boolean;
};

export type InspirationLibraryRecord = LibraryCandidate & {
    contentHash: string;
    imageHash: string;
    videoHash?: string;
    revision: number;
    status: InspirationLibraryStatus;
    reviewReason: string;
    reviewedBy?: string;
    reviewedAt?: string;
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type InspirationLibraryPage = {
    items: InspirationLibraryRecord[];
    total: number;
    page: number;
    limit: number;
};

export type InspirationLibraryImportResult = { created: number; updated: number; unchanged: number };
export type InspirationLibraryReviewInput = { revision: number; action: "approve" | "reject"; reason: string };

const libraryPath = "/admin/inspirations/library";

export function listAdminInspirationLibrary(params: { status: InspirationLibraryStatus; page: number; limit: number }, signal?: AbortSignal) {
    return http.get<InspirationLibraryPage>(libraryPath, { params: compactApiParams(params), signal });
}

export function getAdminInspirationLibraryRecord(slug: string, signal?: AbortSignal) {
    if (!slug.trim()) throw new Error("缺少授权素材标识");
    return http.get<InspirationLibraryRecord>(`${libraryPath}/${encodeURIComponent(slug)}`, { signal });
}

export function importAdminInspirationLibrary(items: LibraryCandidate[], signal?: AbortSignal) {
    if (!items.length || items.length > 100) throw new Error("每批候选必须为 1 到 100 条");
    return http.post<InspirationLibraryImportResult>(`${libraryPath}/import`, { items }, { signal });
}

export function reviewAdminInspirationLibrary(slug: string, input: InspirationLibraryReviewInput, signal?: AbortSignal) {
    if (!slug.trim() || !Number.isSafeInteger(input.revision) || input.revision < 1 || !input.reason.trim()) throw new Error("审核需要素材标识、有效版本和明确原因");
    return http.post<InspirationLibraryRecord>(`${libraryPath}/${encodeURIComponent(slug)}/review`, input, { signal });
}

/** Pending media is never loaded until an administrator explicitly requests this version. */
export function adminInspirationLibraryMediaUrl(record: InspirationLibraryRecord, kind: "image" | "video") {
    const hash = kind === "image" ? record.imageHash : record.videoHash;
    if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(record.revision) || record.revision < 1) return undefined;
    const query = new URLSearchParams({ kind, hash, revision: String(record.revision) });
    return `${String(apiBaseURL).replace(/\/+$/, "")}${libraryPath}/${encodeURIComponent(record.slug)}/media?${query}`;
}
