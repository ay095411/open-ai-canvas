import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { candidateOf, emptyLibraryCandidate, libraryApprovalIssues, parseLibraryCandidateJson } from "../src/pages/admin/inspiration-library/candidate-import";
import type { InspirationLibraryRecord, LibraryCandidate } from "../src/services/api/inspiration-library-admin";

function candidate(): LibraryCandidate {
    const value = emptyLibraryCandidate();
    const license = { name: "独立书面许可", url: "https://rights.example.com/license", rightsholder: "测试权利人", attribution: "署名测试权利人", evidence: "本测试明确允许指定平台商用展示与转载。", commercialUse: false, redistribution: false };
    return { ...value, slug: "licensed-test", title: "授权测试候选", prompt: "测试提示词", image: "resource:local-image", sourceUrl: "https://rights.example.com/source", author: "测试作者", promptLicense: { ...license }, mediaLicense: { ...license } };
}

test("填空模板没有许可证明、权利人或任何预填批准", () => {
    const template = emptyLibraryCandidate();
    expect(template.promptLicense.rightsholder).toBe("");
    expect(template.mediaLicense.evidence).toBe("");
    expect(template.promptLicense.commercialUse).toBe(false);
    expect(template.mediaLicense.redistribution).toBe(false);
    expect(template.competitorException).toBe(false);
    expect(template.mediaReviewed).toBe(false);
    expect(template).not.toHaveProperty("status");
    expect(() => parseLibraryCandidateJson(JSON.stringify({ items: [template] }))).toThrow();
});

test("合法候选可保持false待审，必须分别显式声明两份许可", () => {
    const input = candidate();
    expect(parseLibraryCandidateJson(JSON.stringify({ items: [input] }))).toEqual([input]);
    expect(libraryApprovalIssues(input)).not.toHaveLength(0);
    const incomplete = structuredClone(input) as unknown as Record<string, unknown>;
    delete (incomplete.mediaLicense as Record<string, unknown>).redistribution;
    expect(() => parseLibraryCandidateJson(JSON.stringify([incomplete]))).toThrow("必须显式");
    expect(() => parseLibraryCandidateJson(JSON.stringify([{ ...input, status: "approved" }]))).toThrow("批准状态");
    expect(() => parseLibraryCandidateJson(JSON.stringify({ items: [input], approved: true }))).toThrow("批准状态");
});

test("导入拒绝远程热链、无效字段、重复slug、过量和带凭据证据", () => {
    const input = candidate();
    for (const patch of [{ image: "https://images.example.com/test.png" }, { mode: "video", videoUrl: "" }, { videoUrl: "resource:video" }, { tags: [1] }, { featured: "true" }, { width: -1 }, { sourceUrl: "https://rights.example.com/?token=secret" }])
        expect(() => parseLibraryCandidateJson(JSON.stringify([{ ...input, ...patch }]))).toThrow();
    expect(() => parseLibraryCandidateJson(JSON.stringify([input, input]))).toThrow("重复");
    expect(() => parseLibraryCandidateJson(JSON.stringify(Array.from({ length: 101 }, () => input)))).toThrow("1–100");
    expect(() => parseLibraryCandidateJson("x".repeat(2 * 1024 * 1024 + 1))).toThrow("2 MiB");
});

test("批准须两份商用转载许可、真实证据、媒体已审以及竞争例外依据", () => {
    const input = candidate();
    for (const license of [input.promptLicense, input.mediaLicense]) {
        license.commercialUse = true;
        license.redistribution = true;
    }
    input.mediaReviewed = true;
    expect(libraryApprovalIssues(input)).toEqual([]);
    expect(libraryApprovalIssues({ ...input, mediaReviewed: false })).toContain("请先审查当前固定版本的展示媒体");
    expect(libraryApprovalIssues({ ...input, competitorAssociation: true })).not.toHaveLength(0);
    expect(libraryApprovalIssues({ ...input, competitorAssociation: true, competitorException: true, competitorEvidence: "允许" })).not.toHaveLength(0);
    expect(libraryApprovalIssues({ ...input, competitorAssociation: true, competitorException: true, competitorEvidence: "权利人书面授权本平台展示指定竞争关联素材。" })).toEqual([]);
    const record = { ...input, revision: 4, status: "approved", contentHash: "hash", imageHash: "imagehash", reviewReason: "approved", reviewedBy: "admin", createdAt: "now", updatedAt: "now" } as InspirationLibraryRecord;
    expect(candidateOf(record)).toEqual(input);
    expect(candidateOf(record)).not.toHaveProperty("revision");
});

test("后台独立注册素材授权审核入口", async () => {
    const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
    const shell = await Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text();
    expect(router).toContain('{ path: "inspiration-library", element: <InspirationLibraryAdminPage /> }');
    expect(shell).toContain('path: "/admin/inspiration-library"');
    expect(shell).toContain('label: "素材授权审核"');
});

test("管理端真实组件验证分页、许可编辑、revision审核、主动预览和强错误", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "15000", "./test/fixtures/admin-inspiration-library.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), env: process.env, timeout: 120000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 125000);
