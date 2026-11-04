import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("settings route delegates to the shared workbench and preferences retain only canvas defaults", () => {
    const page = readFileSync(resolve(import.meta.dir, "../src/pages/settings/index.tsx"), "utf8");
    expect(page).toContain("<SettingsWorkbench");
    expect(page).toContain('variant="page"');
    expect(page).toContain("initialSection={isSettingsSection(requestedSection) ? requestedSection : undefined}");
    const source = readFileSync(resolve(import.meta.dir, "../src/pages/settings/settings-workbench.tsx"), "utf8");
    expect(source).not.toContain("创作偏好");
    expect(source).not.toContain("配置默认模型、生成参数和素材存储。");
    expect(source).not.toContain("音频默认值");
    expect(source).not.toContain("音频指令");
    expect(source).not.toContain("默认音频指令");
    expect(source).toContain('t("settings.preferences.imageCount")');
    expect(source).toContain("settings-preference-heading");
});

test("wallet tabs and preference blocks keep a visible gap from neighboring surfaces", () => {
    const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const rule = (selector: string) =>
        rules
            .filter(([, selectors]) => selectors.split(",").some((value) => value.trim() === selector))
            .map(([, , declarations]) => declarations)
            .join("\n");
    const box = (selector: string, property: string) => {
        const value = rule(selector).match(new RegExp(`\\b${property}:\\s*([^;]+);`))?.[1] || "";
        expect(value).toMatch(/^(?:\d+(?:\.\d+)?px|0)(?:\s+(?:\d+(?:\.\d+)?px|0)){0,3}$/);
        const [top, right = top, bottom = top, left = right] = value.split(/\s+/).map(parseFloat);
        return { top, right, bottom, left };
    };
    const header = box(".workspace-wallet-header", "padding");
    const tabs = box(".workspace-wallet-tabs", "margin");
    const content = box(".workspace-wallet-content", "margin");
    expect(header.top).toBeGreaterThan(0);
    expect(header.bottom).toBeGreaterThan(0);
    expect(header.right).toBeGreaterThan(header.left);
    expect(tabs.top).toBeGreaterThan(0);
    expect(content.top).toBeGreaterThan(0);
    expect(content.bottom).toBeGreaterThan(0);
    expect(tabs.left).toBe(header.left);
    expect(content.left).toBe(tabs.left);
    expect(content.right).toBe(tabs.right);
    expect(rule(".workspace-wallet-content")).toMatch(/overflow:\s*auto;/);
    expect(rule(".settings-preference-heading")).toContain("margin-bottom: var(--space-5);");
    const preference = box(".app-user-workspace.settings-page .settings-preference-block", "padding");
    expect(preference.top).toBeGreaterThan(0);
    expect(preference.bottom).toBeGreaterThan(0);
    expect(preference.left).toBe(preference.right);
});
