import { describe, expect, test } from "bun:test";

(globalThis as Record<string, unknown>).__APP_VERSION__ ??= "0.0.0";

/**
 * 创作影棚和电商 Agent 的独立入口契约。
 *
 * /toolbox 下的图片和视频共享影棚高亮，/ecommerce 使用电商自己的高亮。
 *
 * 侧栏模块会连带拉起 app-changelog 等依赖 __APP_VERSION__ 的模块，
 * 所以用动态 import：上面的 globalThis 赋值必须先于模块求值。
 */
const loadNavActiveId = async () => (await import("../src/components/layout/workspace-sidebar-nav")).workspaceNavActiveId;

describe("workspaceNavActiveId for independent studio and ecommerce entries", () => {
    test("highlights the corresponding entry for ecommerce and both studio routes", async () => {
        const workspaceNavActiveId = await loadNavActiveId();
        expect(workspaceNavActiveId("/ecommerce")).toBe("ecommerce");
        expect(workspaceNavActiveId("/ecommerce/project-one")).toBe("ecommerce");
        expect(workspaceNavActiveId("/toolbox")).toBe("toolbox");
        expect(workspaceNavActiveId("/toolbox/image")).toBe("toolbox");
        expect(workspaceNavActiveId("/toolbox/video")).toBe("toolbox");
    });

    test("keeps other entries on their own ids", async () => {
        const workspaceNavActiveId = await loadNavActiveId();
        expect(workspaceNavActiveId("/")).toBe("home");
        expect(workspaceNavActiveId("/create")).toBe("home");
        expect(workspaceNavActiveId("/canvas")).toBe("canvas");
        expect(workspaceNavActiveId("/assets")).toBe("assets");
        expect(workspaceNavActiveId("/settings", "appearance")).toBe("settings:appearance");
    });
});
