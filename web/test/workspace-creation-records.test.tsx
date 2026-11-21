import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(new URL("../src/components/layout/workspace-creation-records.css", import.meta.url), "utf8");

function rule(selector: string, source = css) {
    const bodies = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        .filter(([, selectors]) => selectors.split(",").some((part) => part.trim() === selector))
        .map(([, , body]) => body);
    expect(bodies.length, selector).toBeGreaterThan(0);
    return bodies.join("\n");
}

test("侧栏创作记录的真实查询、打开路径与账号隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-creation-records.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("13 pass");
    expect(output).toContain("0 fail");
}, 65_000);

test("创作记录列表不再设置内部滚动或限高", () => {
    expect(css).toContain(".workspace-creation-records");
    expect(css).not.toMatch(/overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/);
    expect(css).not.toMatch(/max-height\s*:/);
    expect(css).not.toMatch(/overscroll-behavior(?:-[xy])?\s*:/);
});

test("创作记录文字层级与游客卡片沿用侧栏主题，长标题截断不挤压时间", () => {
    expect(rule(".workspace-creation-records")).toMatch(/color:\s*var\(--workspace-sidebar-ink\)/);
    expect(rule(".workspace-creation-records-heading")).toMatch(/font-size:\s*var\(--fs-label\)/);
    const subheading = rule(".workspace-creation-records h3");
    expect(subheading).toMatch(/font-size:\s*var\(--fs-caption\)/);
    expect(subheading).toMatch(/font-weight:\s*500/);
    expect(subheading).toMatch(/color:\s*var\(--workspace-sidebar-muted\)/);
    const name = rule(".workspace-creation-records-copy strong");
    expect(name).toMatch(/font-size:\s*var\(--fs-caption\)/);
    expect(name).toMatch(/font-weight:\s*400/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(rule(".workspace-creation-records-copy")).toMatch(/min-width:\s*0/);
    const link = rule(".workspace-creation-records-link");
    expect(link).toContain("minmax(0, 1fr)");
    expect(link).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--workspace-sidebar-ink\)/);
    const time = rule(".workspace-creation-records-time");
    expect(time).toMatch(/font-size:\s*var\(--fs-label\)/);
    expect(time).toMatch(/color:\s*var\(--workspace-sidebar-muted\)/);
    expect(rule(".workspace-creation-records-guest")).toContain("var(--workspace-sidebar-border)");
    expect(rule(".workspace-creation-records-guest")).toMatch(/background:\s*var\(--workspace-sidebar-hover\)/);
    expect(css).not.toContain(".workspace-creation-records-login");
});

test("创作记录区分悬停与当前项，并保留键盘焦点和减少动效支持", () => {
    expect(rule(".workspace-creation-records-link:hover")).toMatch(/background:\s*var\(--workspace-sidebar-hover\)/);
    expect(rule('.workspace-creation-records-link[aria-current="page"]')).toMatch(/background:\s*var\(--workspace-sidebar-selected\)/);
    for (const selector of [".workspace-creation-records a:focus-visible", ".workspace-creation-records button:focus-visible > span"]) {
        expect(rule(selector)).toMatch(/outline:\s*var\(--focus-ring-width\) solid var\(--control-focus-ring\)/);
    }
    expect(rule(".workspace-creation-records-link:focus-visible > .workspace-creation-records-open")).toMatch(/opacity:\s*1/);
    const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(reducedMotion).toBeDefined();
    for (const selector of [".workspace-creation-records-link", ".workspace-creation-records-link > .workspace-creation-records-open"]) {
        expect(rule(selector, reducedMotion)).toMatch(/transition:\s*none/);
    }
});
