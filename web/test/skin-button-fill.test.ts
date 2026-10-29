import { describe, expect, test } from "bun:test";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";

describe("theme primary button fills", () => {
    test("classic follows the skin primary in both modes without changing selection colors", () => {
        for (const mode of ["light", "dark"] as const) {
            expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, mode)).toEqual({
                background: DEFAULT_CLASSIC_SKIN.tokens[mode].primary,
                hover: DEFAULT_CLASSIC_SKIN.tokens[mode].primaryHover,
                active: DEFAULT_CLASSIC_SKIN.tokens[mode].primaryActive, foreground: DEFAULT_CLASSIC_SKIN.tokens[mode].primaryForeground,
            });
        }
        // 项目默认不用蓝色做主题：classic 的主按钮是近黑 / 近白，不是渐变。
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.mode).toBe("solid");
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.primary).toBe("#171717");
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.selected).toBe("#e8e8e8");
        expect(DEFAULT_CLASSIC_SKIN.tokens.dark.selected).toBe("#2b2b2b");
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "light")).toEqual({ background: "#171717", hover: "#303030", active: "#404040", foreground: "#ffffff" });
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "dark")).toEqual({ background: "#f5f5f5", hover: "#ffffff", active: "#e5e5e5", foreground: "#171717" });
        for (const mode of ["light", "dark"] as const) {
            expect(DEFAULT_CLASSIC_SKIN.tokens.buttons[mode]).toEqual({
                mode: "solid", angle: 115, start: "#171717", end: "#171717",
                hoverStart: "#303030", hoverEnd: "#303030",
                activeStart: "#404040", activeEnd: "#404040", foreground: "#ffffff",
            });
            expect(DEFAULT_CLASSIC_SKIN.tokens[mode].switchChecked).not.toBe(DEFAULT_CLASSIC_SKIN.tokens[mode].primary);
            expect(DEFAULT_CLASSIC_SKIN.tokens[mode].selected).not.toBe(DEFAULT_CLASSIC_SKIN.tokens[mode].primary);
        }
    });

    test("classic leaves primary button variables to globals.css", () => {
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        values.set("--button-primary-bg", "stale");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.size).toBe(0);
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.mode = "gradient";
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        skin.tokens.buttons.light.end = "#386fbc";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(115);
        expect(skin.tokens.buttons.dark.angle).toBe(115);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #386fbc)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("linear-gradient(45deg, #123456, #386fbc)");
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.has("--background")).toBe(false);
        expect(values.has("--button-primary-fg")).toBe(false);
    });

    test("legacy themes without a button block fall back to the project default solid fill", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            const normalized = normalizeSkinDefinition(legacy);
            expect(normalized.tokens.buttons.light.mode).toBe("solid");
            expect(normalized.tokens.buttons.dark.mode).toBe("solid");
        }
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, { mode: "gradient" }, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
