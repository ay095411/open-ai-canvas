import { describe, expect, test } from "bun:test";

(globalThis as Record<string, unknown>).__APP_VERSION__ ??= "0.0.0";

/**
 * 「创作影棚」入口契约。
 *
 * 旧 /toolbox/image、/toolbox/video 的生图 / 视频工作台已下线，能力并入 /ecommerce。
 * 侧栏 nav id 仍保留 toolbox（角标、折叠态两字标题、命令面板都按它登记），
 * 因此 /ecommerce 与三个 /toolbox 路径都必须高亮同一项 —— 否则用户从
 * 旧收藏或重定向链进来时，侧栏会没有任何选中项。
 *
 * 侧栏模块会连带拉起 app-changelog 等依赖 __APP_VERSION__ 的模块，
 * 所以用动态 import：上面的 globalThis 赋值必须先于模块求值。
 */
const loadNavActiveId = async () => (await import("../src/components/layout/workspace-sidebar-nav")).workspaceNavActiveId;

describe("workspaceNavActiveId for the 创作影棚 entry", () => {
    test("highlights the single 创作影棚 entry for /ecommerce and every retired /toolbox route", async () => {
        const workspaceNavActiveId = await loadNavActiveId();
        expect(workspaceNavActiveId("/ecommerce")).toBe("toolbox");
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
