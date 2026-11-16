import type { InspirationLibraryLicense, InspirationLibraryRecord, LibraryCandidate } from "@/services/api/inspiration-library-admin";

export const LIBRARY_IMPORT_LIMIT = 100;
export const LIBRARY_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const candidateKeys = [
    "slug",
    "title",
    "description",
    "prompt",
    "promptZh",
    "image",
    "mode",
    "videoUrl",
    "sourceUrl",
    "author",
    "category",
    "tags",
    "model",
    "width",
    "height",
    "featured",
    "promptLicense",
    "mediaLicense",
    "competitorAssociation",
    "competitorException",
    "competitorEvidence",
    "mediaReviewed",
] as const;
const licenseStrings = ["name", "url", "rightsholder", "attribution", "evidence"] as const;
const licenseFlags = ["commercialUse", "redistribution"] as const;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isPublicEvidenceUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !Array.from(url.searchParams.keys()).some((key) => /^(token|api_key|apikey|password|secret|signature|access_token)$/i.test(key));
    } catch {
        return false;
    }
};

export function emptyLibraryCandidate(): LibraryCandidate {
    const license = (): InspirationLibraryLicense => ({ name: "", url: "", rightsholder: "", attribution: "", evidence: "", commercialUse: false, redistribution: false });
    return {
        slug: "",
        title: "",
        description: "",
        prompt: "",
        image: "",
        mode: "image",
        sourceUrl: "",
        author: "",
        promptLicense: license(),
        mediaLicense: license(),
        competitorAssociation: false,
        competitorException: false,
        competitorEvidence: "",
        mediaReviewed: false,
    };
}

export function candidateOf(record: InspirationLibraryRecord): LibraryCandidate {
    return Object.fromEntries(candidateKeys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])) as LibraryCandidate;
}

export function parseLibraryCandidateJson(text: string): LibraryCandidate[] {
    if (new TextEncoder().encode(text).byteLength > LIBRARY_IMPORT_MAX_BYTES) throw new Error("候选 JSON 超过 2 MiB，请拆分导入");
    let decoded: unknown;
    try {
        decoded = JSON.parse(text);
    } catch {
        throw new Error("候选 JSON 无法解析，请检查语法");
    }
    if (isObject(decoded) && Object.keys(decoded).some((key) => key !== "items")) throw new Error("导入对象只接受 items；批准状态与审核记录不能从 JSON 导入");
    const items = Array.isArray(decoded) ? decoded : isObject(decoded) ? decoded.items : undefined;
    if (!Array.isArray(items) || !items.length || items.length > LIBRARY_IMPORT_LIMIT) throw new Error(`请提供 1–${LIBRARY_IMPORT_LIMIT} 条候选 items`);
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
        const label = `第 ${index + 1} 条`;
        if (!isObject(item) || Object.keys(item).some((key) => !(candidateKeys as readonly string[]).includes(key))) throw new Error(`${label}含未知字段；请使用候选模板，不能导入批准状态`);
        for (const key of ["slug", "title", "description", "prompt", "image", "sourceUrl", "author"]) if (typeof item[key] !== "string") throw new Error(`${label}缺少文本字段 ${key}`);
        if (!String(item.slug).trim() || !String(item.title).trim() || !String(item.prompt).trim()) throw new Error(`${label}必须填写 slug、标题与提示词`);
        if (!String(item.author).trim() || !isPublicEvidenceUrl(String(item.sourceUrl))) throw new Error(`${label}必须填写作者与不含凭据的 HTTPS 来源地址`);
        if (seen.has(String(item.slug))) throw new Error(`${label}的 slug 在本批重复`);
        seen.add(String(item.slug));
        if (item.mode !== "image" && item.mode !== "video") throw new Error(`${label}的 mode 必须是 image 或 video`);
        if (
            !/^resource:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(String(item.image)) ||
            (item.mode === "video" && (typeof item.videoUrl !== "string" || !/^resource:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.videoUrl))) ||
            (item.mode === "image" && item.videoUrl)
        )
            throw new Error(`${label}的媒体必须填写已上传的本地 ready 资源 resource:<id>，不接受远程热链`);
        for (const key of ["promptZh", "videoUrl", "category", "model", "competitorEvidence"]) if (item[key] !== undefined && typeof item[key] !== "string") throw new Error(`${label}的 ${key} 必须是文本`);
        for (const key of ["featured", "competitorAssociation"]) if (item[key] !== undefined && typeof item[key] !== "boolean") throw new Error(`${label}的 ${key} 必须是布尔值`);
        for (const key of ["width", "height"]) if (item[key] !== undefined && (typeof item[key] !== "number" || !Number.isSafeInteger(item[key]) || item[key] < 0 || item[key] > 20000)) throw new Error(`${label}的 ${key} 尺寸无效`);
        if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 50 || item.tags.some((tag) => typeof tag !== "string"))) throw new Error(`${label}的 tags 必须是最多 50 项的文本数组`);
        for (const key of ["promptLicense", "mediaLicense"]) {
            const license = item[key];
            if (!isObject(license) || Object.keys(license).some((key) => !([...licenseStrings, ...licenseFlags] as readonly string[]).includes(key))) throw new Error(`${label}的 ${key} 必须使用完整许可模板`);
            for (const field of licenseStrings) if (typeof license[field] !== "string") throw new Error(`${label}的 ${key} 缺少 ${field}`);
            for (const field of ["name", "url", "rightsholder", "attribution"]) if (!String(license[field]).trim()) throw new Error(`${label}的 ${key} 必须填写许可、证据地址、权利人与署名`);
            if (!isPublicEvidenceUrl(String(license.url))) throw new Error(`${label}的 ${key} 证据地址必须是不含凭据的 HTTPS 链接`);
            for (const field of licenseFlags) if (typeof license[field] !== "boolean") throw new Error(`${label}的 ${key}.${field} 必须显式填写 true 或 false`);
        }
        for (const key of ["competitorException", "mediaReviewed"]) if (typeof item[key] !== "boolean") throw new Error(`${label}的 ${key} 必须显式填写 true 或 false`);
    }
    return items as LibraryCandidate[];
}

export function libraryApprovalIssues(record: LibraryCandidate): string[] {
    const issues: string[] = [];
    for (const [label, license] of [
        ["提示词", record.promptLicense],
        ["展示媒体", record.mediaLicense],
    ] as const) {
        if (licenseStrings.some((key) => !license[key].trim())) issues.push(`${label}许可、权利人、证据地址、证据正文与署名必须完整`);
        else if ([...license.evidence.trim()].length < 12) issues.push(`${label}需至少 12 字的具体授权证据`);
        if (!license.commercialUse || !license.redistribution) issues.push(`${label}必须明确允许商用展示与转载/再分发`);
    }
    if (!record.mediaReviewed) issues.push("请先审查当前固定版本的展示媒体");
    if (record.competitorAssociation && (!record.competitorException || !record.competitorEvidence?.trim())) issues.push("竞争关联素材需明确例外依据，否则不能批准");
    if (record.competitorException && [...(record.competitorEvidence?.trim() || "")].length < 12) issues.push("竞争关联例外需至少 12 字的具体证据");
    return issues;
}
