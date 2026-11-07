import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, skinCSSVariables } from "../src/lib/skin-themes";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("authentication follows the application theme", () => {
    test("classic login surfaces have distinct light and dark palettes", () => {
        // globals.css 在不同平台上可能是 LF 或 CRLF；先归一化再分段，
        // 否则按字面换行查找 .dark 段会返回 -1，把断言变成永远失败。
        const css = source("styles/globals.css").replace(/\r\n/g, "\n");
        const dark = css.slice(css.indexOf(".dark {\n    --background:"));
        for (const [mode, background, panel, card] of [
            ["light", "#ffffff", "#f7f7f7", "#ffffff"],
            ["dark", "#08090c", "#0b0c10", "#121318"],
        ] as const) {
            const variables = skinCSSVariables(DEFAULT_CLASSIC_SKIN, mode);
            const modeCSS = mode === "dark" ? dark : css.slice(0, css.indexOf(".auth-scene {"));
            expect(variables["--auth-page-bg"]).toBe(background);
            expect(variables["--auth-panel-bg"]).toBe(panel);
            expect(variables["--auth-card-bg"]).toBe(card);
            for (const key of ["--auth-page-bg", "--auth-panel-bg", "--auth-card-bg", "--auth-accent", "--auth-muted"]) {
                expect(modeCSS).toContain(`${key}: ${variables[key]};`);
            }
        }
    });

    test("auth inherits the global Ant Design provider instead of forcing dark controls", () => {
        const scene = source("pages/auth/auth-scene.tsx");
        expect(scene).not.toContain("ConfigProvider");
        expect(scene).not.toContain("getAntThemeConfig");
        expect(scene).not.toContain("auth-card-dark");
        expect(scene.match(/<main className="([^"]+)"/)?.[1]).not.toContain("text-white");
        expect(scene).toContain("auth-scene-hero");
        expect(scene).toContain('className="auth-scene-brand-logo"');
        expect(scene).toContain('className="auth-scene-muted');
        expect(source("components/layout/app-providers.tsx")).toContain("getAntThemeConfig(dark, appearance.activeSkin)");
    });

    test("merged login/register form keeps theme-aware text and inline signup", () => {
        // 登录与注册已是同一张表单（上游 v1.8.2），register-form.tsx 随之删除；
        // 这里同时守住「就地建号」的三个关键点：autoRegister、account_not_registered、协议勾选。
        for (const path of ["components/auth/login-form.tsx", "pages/auth/forgot-password.tsx"]) {
            const form = source(path);
            const classes = Array.from(form.matchAll(/className="([^"]*)"/g), (match) => match[1]).join(" ");
            expect(classes).not.toMatch(/(?:text|border|bg)-white/);
            expect(classes).not.toMatch(/text-(?:blue|amber)-[123]00/);
            expect(form).toContain("auth-scene-icon");
        }
        const login = source("components/auth/login-form.tsx");
        expect(login).toContain('aria-label="用户名或邮箱"');
        expect(login).toContain('aria-label="密码"');
        expect(login).toContain("auth-scene-notice");
        expect(login).toContain("autoRegister");
        expect(login).toContain('"account_not_registered"');
        expect(login).toContain("auth-agreement-row");
        expect(source("components/auth/agreement-dialog.tsx")).toContain("auth-agreement-body");
        expect(source("pages/auth/forgot-password.tsx")).toContain("auth-scene-label");
        expect(source("pages/auth/forgot-password.tsx")).toContain("auth-scene-notice");
    });

    test("focus and autofill keep theme-aware foregrounds and visible focus", () => {
        const css = source("styles/globals.css");
        const panel = source("components/auth/auth-panel.css");
        expect(css).not.toContain(".auth-card-dark");
        expect(css).toContain(".auth-scene-card input:-webkit-autofill");
        expect(css).toContain("-webkit-text-fill-color: var(--foreground) !important");
        expect(css).toContain("box-shadow: 0 0 0 1000px var(--auth-card-bg) inset !important");
        expect(css).toContain(".auth-scene-link:focus-visible");
        expect(css).toContain("box-shadow: 0 0 0 var(--focus-ring-width) color-mix(in srgb, var(--ring) 16%, transparent)");
    });

    test("custom auth palettes are preserved per mode", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.light.authPanel = "#f6ebe3";
        skin.tokens.light.authCard = "#fffdf9";
        skin.tokens.dark.authPanel = "#21120e";
        skin.tokens.dark.authCard = "#361f17";
        expect(skinCSSVariables(skin, "light")["--auth-panel-bg"]).toBe("#f6ebe3");
        expect(skinCSSVariables(skin, "light")["--auth-card-bg"]).toBe("#fffdf9");
        expect(skinCSSVariables(skin, "dark")["--auth-panel-bg"]).toBe("#21120e");
        expect(skinCSSVariables(skin, "dark")["--auth-card-bg"]).toBe("#361f17");
    });
});
