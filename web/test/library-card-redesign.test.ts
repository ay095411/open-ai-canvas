import { describe, expect, test } from "bun:test";
import { zhCN as canvasBZh } from "../src/i18n/messages/areas/canvasB/zh-CN";
import { readFileSync } from "node:fs";

import { formatAbsoluteDateTime, formatRelativeTime } from "../src/lib/relative-time";
import { skillAccent, skillAccentNames, skillGlyph } from "../src/pages/skills/skill-catalog";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/workspace-product.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("relative time", () => {
    const now = Date.parse("2026-10-24T12:00:00+08:00");
    test("formats recent times relatively and older ones as dates", () => {
        expect(formatRelativeTime(now - 20_000, now)).toBe("刚刚");
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
        expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
        expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
        expect(formatRelativeTime(now - 30 * 86_400_000, now)).not.toContain("前");
        expect(formatRelativeTime("", now)).toBe("时间未知");
        expect(formatAbsoluteDateTime("not-a-date")).toBe("时间未知");
    });
});

describe("skill identity", () => {
    test("glyph uses the first grapheme of the name", () => {
        expect(skillGlyph("分镜大师")).toBe("分");
        expect(skillGlyph("  storyboard")).toBe("S");
        expect(skillGlyph("")).toBe("技");
    });
    test("accent is fixed for built-in categories and stable for custom ones", () => {
        expect(skillAccent("drama")).toBe("blue");
        expect(skillAccent("custom-root")).toBe(skillAccent("custom-root"));
        expect(skillAccentNames).toContain(skillAccent("custom-root"));
        for (const name of skillAccentNames) expect(css).toContain(`.skill-tile[data-accent="${name}"]`);
    });
});

describe("canvas library card", () => {
    const card = read("../src/components/canvas/canvas-folder-card.tsx");
    const page = read("../src/pages/canvas/index.tsx");
    test("footer shows project ownership (or free canvas) with relative update time", () => {
        expect(card).toContain("formatRelativeTime(project.updatedAt)");
        expect(card).toContain("title={updatedTitle}");
        expect(card).toContain('{projectName || t("canvasB.folderCard.freeCanvas")}');
        expect(canvasBZh.folderCard.freeCanvas).toBe("自由画布");
        expect(card).toContain("canvas-collection-badge");
        expect(page).toContain('projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined}');
        expect(page).not.toContain("已加载全部");
        expect(page).toContain('aria-label="正在加载更多画布"');
    });
    test("page header no longer offers deleting every loaded canvas", () => {
        expect(page).not.toContain("删除当前已加载画布");
        expect(page).not.toContain("更多画布操作");
    });
    test("grid caps at five columns and cover uses a 4:3 media mosaic", () => {
        expect(card).toContain("quiet mosaic");
        expect(css).toMatch(/\.canvas-collection-grid \{[^}]*calc\(\(100% - 4 \* var\(--canvas-card-gap-x\)\) \/ 5\)/);
        expect(css).toMatch(/\.canvas-collection-preview \{[^}]*aspect-ratio: 4 \/ 3;/);
        expect(css).toMatch(/\.canvas-project-mosaic\[data-count="3"\]\s*>\s*:first-child\s*\{\s*grid-row:\s*span 2;\s*\}/);
    });
    test("secondary actions are revealed on hover/focus and always visible without hover", () => {
        expect(card).toContain("canvas-collection-rename");
        expect(css).toMatch(/\.canvas-collection-card:is\(:hover,\s*:focus-within\)\s*:is\(\s*\.canvas-collection-select,\s*\.canvas-collection-rename,\s*\.canvas-collection-actions\s*\)/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*\{\s*:is\(\s*\.canvas-collection-select,\s*\.canvas-collection-rename,\s*\.canvas-collection-actions\s*\)\s*\{\s*opacity:\s*1;\s*\}\s*\}/);
    });
});

describe("skills library", () => {
    const page = read("../src/pages/skills/index.tsx");
    const card = read("../src/pages/skills/skill-card.tsx");
    const skillStyles = read("../src/pages/skills/skills-page.css");
    test("separates exploration categories from personal library scopes with discoverable navigation", () => {
        expect(page).toContain('aria-label="探索技能分类"');
        expect(page).toContain('aria-label="我的技能范围"');
        expect(page).toContain('aria-label="我的技能分类"');
        expect(page).toContain("aria-pressed={scope === option.value}");
        expect(page).toContain('selectScope("mine")');
        expect(page).toContain('selectScope("public")');
        expect(page).toContain("<SkillCurationBrowser");
        expect(page).toContain('import "./skills-page.css"');
    });
    test("shared cards label their stats, expose add state and keep secondary actions accessible", () => {
        expect(page).toContain("<SkillCard");
        expect(card).toContain("title={`${skill.addedCount} 人已加入`}");
        expect(card).toContain("aria-pressed={skill.isAdded}");
        expect(card).toContain('skill.isLike ? "取消收藏" : "收藏技能"');
        expect(card).toContain('if (key === "like") onLike()');
        expect(card).toContain("aria-label={`${skill.skillName}的更多操作`}");
        expect(page).toContain("/skills/${encodeURIComponent(skill.skillId)}/edit");
        expect(page).toContain("onOpenWorkbench={openWorkbench}");
        expect(skillStyles).toMatch(/\.skills-market-page :is\(button, a\):focus-visible\s*\{[^}]*outline:/);
        expect(card).toContain("title={skill.skillName}");
        expect(skillStyles).toMatch(/\.skills-catalog-card-title h3\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
        expect(skillStyles).toMatch(/\.skills-catalog-card-description p\s*\{[^}]*-webkit-line-clamp: 2;/);
    });
});
