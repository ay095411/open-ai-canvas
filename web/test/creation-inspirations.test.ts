import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CreationInspiration } from "../src/lib/inspirations/catalog";
import { fillablePrompt } from "../src/lib/inspirations/resolve";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("官方上游目录是默认灵感数据源", () => {
    test("大厅保留真实画廊外壳，使用官方来源且不恢复旧改库管理入口", () => {
        const page = source("pages/inspirations/index.tsx");
        expect(page).toContain("<ZzaiGallery");
        for (const retired of ["精选与收藏", "loadInspirationCatalog", "InspirationEditorModal", "createEntry", "importPayload", "exportPayload"]) expect(page).not.toContain(retired);
        expect(page).toContain('initialSource = "official-catalog"');
        expect(source("lib/inspirations/catalog.ts")).toContain("curatedWorks");
        expect(source("lib/inspirations/catalog.ts")).toContain("c8262a2594277f1d75fe300e5aeac698ee8bdb6e");
    });

    test("官方静态目录及本地缩略图随产品发布，旧改库组件不恢复", () => {
        for (const path of ["public/inspirations", "public/inspiration-thumbs", "src/services/inspiration-catalog.ts", "src/services/api/inspiration-feed.ts"]) expect(existsSync(resolve(import.meta.dir, "..", path))).toBe(true);
        for (const path of [
            "public/showcase",
            "src/pages/create/creation-inspirations.ts",
            "src/pages/create/creation-inspiration-waterfall.tsx",
            "src/pages/inspirations/inspiration-editor-modal.tsx",
            "src/pages/admin/components/inspiration-feed-row.tsx",
            "scripts/import-inspirations.mjs",
            "scripts/data/inspiration-prompts-zh.json",
        ])
            expect(existsSync(resolve(import.meta.dir, "..", path))).toBe(false);
        expect(source("pages/admin/components/feature-availability-panel.tsx")).not.toContain("InspirationFeedRow");
    });

    test("保留共有风格和欢迎媒体，不影响其他创作功能", () => {
        expect(existsSync(resolve(import.meta.dir, "../public/short-drama-styles"))).toBe(true);
        expect(existsSync(resolve(import.meta.dir, "../public/welcome/wing-it/barn.webp"))).toBe(true);
    });

    test("填词优先上游中文版本，无中文则保留原文，不编造翻译", () => {
        const item: CreationInspiration = { id: "zzai-gallery:probe", sourceId: "zzai-gallery", title: "probe", description: "", image: "https://example.com/image.png", mode: "image", prompt: " Original prompt " };
        expect(fillablePrompt(item)).toBe("Original prompt");
        expect(fillablePrompt({ ...item, promptZh: " 中文正文 " })).toBe("中文正文");
        expect(fillablePrompt({ ...item, prompt: "" })).toBe("");
    });
});
