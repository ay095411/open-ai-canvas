import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getWorkspaceAntThemeConfig } from "../src/lib/app-theme";
describe("asset library header buttons", () => {
    test("user pages share control geometry without a light-only outline override", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const theme = getWorkspaceAntThemeConfig();
        // 用户工作台唯一按钮尺度：34px 常规 / 28px 紧凑，按钮与输入控件共用 8px 圆角。
        expect(theme.token?.controlHeight).toBe(34);
        expect(theme.token?.controlHeightSM).toBe(28);
        expect(theme.components?.Button?.borderRadius).toBe(theme.token?.borderRadius);
        expect(theme.components?.Input?.borderRadius).toBe(theme.token?.borderRadius);
        expect(theme.components?.Select?.borderRadius).toBe(theme.token?.borderRadius);
        expect(css).toContain("--user-control-height: 34px;");
        expect(css).toContain("--user-radius-button: 8px;");
        // 次要按钮是透明底细边框，明暗共用工作台语义变量；hover/active 保留独立的表面反馈。
        expect(theme.components?.Button?.defaultBg).toBe("transparent");
        expect(theme.components?.Button?.defaultBorderColor).toBe("var(--user-border)");
        expect(theme.components?.Button?.textTextColor).toBe("var(--user-ink-muted)");
        expect(theme.components?.Button?.defaultHoverBg).toBe("var(--user-surface-muted)");
        expect(theme.components?.Button?.defaultActiveBg).toBe("var(--user-surface-hover)");
        expect(css).not.toContain("html:not(.dark) .library-page .app-page-header .ant-btn");
        expect(css).not.toContain("html .assets-library-page .app-page-header .assets-header-action-buttons .ant-btn");
    });
});
