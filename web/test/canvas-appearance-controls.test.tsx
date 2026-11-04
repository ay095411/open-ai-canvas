import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAppearanceControls } from "../src/components/canvas/canvas-appearance-controls";
import { canvasThemes } from "../src/lib/canvas-theme";
import { canvasAppearanceBaseTheme, canvasAppearanceForPreset, canvasAppearanceForTheme, updateCustomCanvasAppearance, type CanvasAppearance } from "../src/lib/canvas/canvas-appearance";

function render(appearance: CanvasAppearance, appearanceFollowsWorkspace = false) {
    const theme = canvasAppearanceBaseTheme(appearance, "light");
    return renderToStaticMarkup(
        <CanvasAppearanceControls
            appearance={appearance}
            appearanceFollowsWorkspace={appearanceFollowsWorkspace}
            backgroundMode="lines"
            colorTheme={theme}
            theme={canvasThemes[theme]}
            onAppearanceChange={() => {}}
            onAppearanceFollowWorkspaceChange={() => {}}
            onSaveAppearanceDefault={() => {}}
            onBackgroundModeChange={() => {}}
        />,
    );
}

describe("canvas appearance hierarchy", () => {
    test("fixed themes expose four explicit modes without custom tuning fields", () => {
        for (const mode of ["light", "dark"] as const) {
            const markup = render(canvasAppearanceForTheme(mode));
            expect(markup).toContain('aria-label="跟随工作台主题（不单独设置）" aria-pressed="false"');
            expect(markup).toContain(`aria-label="切换到浅色主题" aria-pressed="${mode === "light"}"`);
            expect(markup).toContain(`aria-label="切换到黑色主题" aria-pressed="${mode === "dark"}"`);
            expect(markup).toContain('aria-label="切换到自定义主题" aria-pressed="false"');
            expect(markup).not.toContain("明亮度");
            expect(markup).not.toContain("保存为默认");
            expect(markup).toContain("空间网格");
        }
    });

    test("workspace-following appearance has only the follow mode selected", () => {
        const markup = render(canvasAppearanceForTheme("light"), true);
        expect(markup).toContain('aria-label="跟随工作台主题（不单独设置）" aria-pressed="true"');
        for (const label of ["浅色", "黑色", "自定义"]) expect(markup).toContain(`aria-label="切换到${label}主题" aria-pressed="false"`);
    });

    test("saved custom appearances expose their colors and keep fixed themes unselected", () => {
        for (const appearance of [updateCustomCanvasAppearance(canvasAppearanceForPreset("pink"), { gridOpacity: 21 }, "light"), updateCustomCanvasAppearance(canvasAppearanceForPreset("slate"), { backgroundBrightness: 2 }, "dark")]) {
            const markup = render(appearance);
            expect(markup).toContain('aria-label="切换到浅色主题" aria-pressed="false"');
            expect(markup).toContain('aria-label="切换到黑色主题" aria-pressed="false"');
            expect(markup).toContain('aria-label="切换到自定义主题" aria-pressed="true"');
            expect(markup).toContain('aria-label="画布背景色码"');
            expect(markup).toContain(`value="${appearance.custom!.backgroundColor}"`);
            expect(markup).toContain("明亮度");
            expect(markup).toContain("保存为默认");
        }
    });
});
