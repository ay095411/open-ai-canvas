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
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        skin.tokens.buttons.light.end = "#386fbc";
        // 默认已是 solid，这里显式切回渐变，验证渐变参数原样生效。
        skin.tokens.buttons.light.mode = "gradient";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(115);
        expect(skin.tokens.buttons.dark.angle).toBe(115);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #386fbc)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.has("--background")).toBe(false);
        // solid 模式的前景来自皮肤 token：classic 深色主按钮是近白底 + 近黑字。
        expect(values.get("--button-primary-fg")).toBe("#171717");
    });

    test("legacy themes without a button block fall back to the project default solid fill", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            expect(normalizeSkinDefinition(legacy).tokens.buttons.light.mode).toBe("solid");
        }
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
