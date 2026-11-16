import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 空态横幅（.creation-empty-art / CreationEmptyBanner）已随旧空态一起删掉，
// 这条只守还在的那两块：文案区和输入区仍走文档流，不靠 margin: auto 顶位置。
test("create empty state keeps the intro and composer in document flow", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const layoutStart = styles.indexOf("/* 空态布局收敛：保持文案和输入区的文档流顺序");
    const layoutEnd = styles.indexOf("/* ===== 素材库", layoutStart);
    const layout = styles.slice(layoutStart, layoutEnd);

    expect(layoutStart).toBeGreaterThanOrEqual(0);
    expect(layoutEnd).toBeGreaterThan(layoutStart);
    expect(layout).toContain("justify-content: flex-start;");
    expect(layout).toContain("flex: 0 0 auto;");
    expect(layout).toContain("margin: 0 auto 18px;");
    expect(layout).not.toContain("margin: auto auto 18px;");
    expect(layout).not.toContain("margin: 26px auto auto;");
    expect(layout).not.toContain(".creation-empty-art");
});

test("home scroll viewport covers the side gutters without widening its content", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const viewport = styles.match(/\.app-user-workspace \.creation-home > \.creation-empty-workspace\s*\{([^}]+)\}/)?.[1];

    expect(viewport).toBeDefined();
    expect(viewport).toMatch(/^\s*width:\s*100%\s*!important;/m);
    expect(viewport).toMatch(/box-sizing:\s*border-box;/);
    expect(viewport).toMatch(/overflow-y:\s*auto\s*!important;/);
    expect(viewport).toMatch(/overflow-x:\s*hidden\s*!important;/);
    expect(viewport).toContain("max(var(--space-5), calc((100% - 1440px) / 2))");
    expect(viewport).toContain("scroll-padding-top: var(--workspace-topbar-clearance, 0px);");
});

test.each([
    [1100, "--space-4"],
    [680, "--space-3"],
] as const)("home keeps the scroll viewport full width below %ipx", (breakpoint, gutter) => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const mediaStart = styles.lastIndexOf(`@media (max-width: ${breakpoint}px) {`);
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const responsive = styles.slice(mediaStart);
    const viewport = responsive.match(/\.app-user-workspace \.creation-home > \.creation-empty-workspace\s*\{([^}]+)\}/)?.[1];

    expect(viewport).toBeDefined();
    expect(viewport).toContain(`padding-inline: var(${gutter}) !important;`);
    expect(viewport).not.toMatch(/\b(?:width|max-width):/);
});

test("home retains its native scroll owner for the floating composer and scroll-to-top actions", () => {
    const page = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
    const viewport = page.match(/<main\b[^>]*className="creation-empty-workspace creation-scrollbar"[^>]*>/)?.[0];

    expect(viewport).toBeDefined();
    expect(viewport).toContain("ref={threadScrollRef}");
    expect(viewport).toContain("onScroll={handleThreadScroll}");
    expect(viewport).not.toContain("onWheel");
});
