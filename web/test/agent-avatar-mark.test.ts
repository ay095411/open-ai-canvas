import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8");

describe("agent avatar mark", () => {
    test("悬浮入口、欢迎页与后台预览统一使用品牌徽标", () => {
        const parts = read("../src/components/canvas/canvas-cloud-agent-panel-parts.tsx");
        const welcome = read("../src/components/canvas/canvas-agent-welcome.tsx");
        const editor = read("../src/pages/admin/settings/components/canvas-appearance-editor.tsx");

        expect(parts).toContain("<AgentAvatarMark size={54} />");
        expect(parts).not.toContain("FluidOrb");
        expect(welcome).toContain("<AgentAvatarMark size={40} />");
        expect(editor).toContain("<AgentAvatarMark size={60} />");
        expect(editor).not.toContain("FluidOrb");
    });

    test("徽标是品牌 N：一个圆头描边加两个点，沿用蓝紫渐变", () => {
        const mark = read("../src/components/canvas/agent-avatar-mark.tsx");

        expect(mark).toContain('viewBox="0 0 64 64"');
        expect(mark).toContain("strokeLinecap=\"round\"");
        expect((mark.match(/<circle/g) ?? []).length).toBe(2);
        expect(mark).toContain("#2D7BF4");
        expect(mark).toContain("#8A5CF6");
        // 纯 SVG：不再引入 WebGL 球体。
        expect(mark).not.toContain("canvas");
        expect(mark).not.toContain("requestAnimationFrame");
    });
});
