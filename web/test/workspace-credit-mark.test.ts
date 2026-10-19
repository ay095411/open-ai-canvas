import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8");

describe("workspace credit mark", () => {
    test("top-bar credit entries share one coin mark", () => {
        const topBar = read("../src/components/layout/workspace-top-bar.tsx");
        const actions = read("../src/components/layout/workspace-topbar-actions.tsx");
        const canvas = read("../src/pages/canvas/canvas-project-top-bar.tsx");
        const mark = read("../src/components/layout/workspace-credit-mark.tsx");
        const css = read("../src/styles/globals.css");

        // 顶栏外壳只挂操作区，积分金币由操作区与画布顶栏共用同一枚标记。
        expect(topBar).toContain("<WorkspaceTopBarActions />");
        expect(actions).toContain("<WorkspaceCreditMark className=\"is-compact\" />");
        expect(actions).not.toContain("Coins");
        expect(canvas).toContain("<WorkspaceCreditMark className=\"is-compact\" />");
        expect(canvas).not.toContain("Coins");
        // 金币本色：亮面到侧面的暖金渐变，不再沿用旧的礼盒橙 / 缎带青。
        expect(mark).toContain("#FFD772");
        expect(mark).toContain("#F08A12");
        expect(mark).not.toContain("#12B8A8");
        expect(css).toContain(".app-workspace-credit-mark");
        expect(css).not.toContain(".app-workspace-credit-gift");
    });

    test("credit mark is optically centred instead of nudged into place", () => {
        const css = read("../src/styles/globals.css");
        const mark = read("../src/components/layout/workspace-credit-mark.tsx");

        // 只取金币自己的规则块，避免被页面里其它 rotate/居中规则干扰。
        const block = css.match(/\.app-user-workspace \.app-workspace-credit-mark \{[^}]*\}/)?.[0] ?? "";
        expect(block).toContain("place-items: center;");
        expect(block).toContain("line-height: 0;");
        // 图标本身上下对称，不再用 rotate / 偏移补偿视觉重心；悬停只做轻微放大。
        expect(block).not.toContain("rotate(");
        expect(css).toContain(".canvas-topbar-action:hover:not(:disabled) .app-workspace-credit-mark");
        expect(css).toContain("translateY(-1px) scale(1.05)");
        // 视口 32×32、圆心 (16,16)：上下左右对称，换到任意行高都不会压重心。
        expect(mark).toContain('viewBox="0 0 32 32"');
        expect(mark).toContain('cx="16" cy="16" r="11"');
    });
});
