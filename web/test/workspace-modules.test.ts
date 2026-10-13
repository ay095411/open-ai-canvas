import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildWorkspaceModules } from "../src/lib/workspace-modules";

const source = (rel: string) => readFileSync(resolve(import.meta.dir, `../src/${rel}`), "utf8");

describe("workspace module entries", () => {
    // 侧栏下线后，首页模块入口条是页面之间唯一的常驻导航 —— 它的每一条都必须真能到达。
    test("lists only reachable routes and never links back to the creation page itself", () => {
        const modules = buildWorkspaceModules({ pluginCenterEnabled: true, taskCenterEnabled: true });
        const paths = modules.map((module) => module.to);

        expect(paths).toEqual(["/inspirations", "/projects", "/canvas", "/assets", "/skills", "/plugins", "/tasks"]);
        expect(paths).not.toContain("/");
        expect(paths).not.toContain("/create");
        expect(paths).not.toContain("/home");
        expect(modules.every((module) => module.title && module.hint && module.icon)).toBe(true);
    });

    test("follows the feature switches so no entry points at a disabled page", () => {
        const off = buildWorkspaceModules({ pluginCenterEnabled: false, taskCenterEnabled: false });

        expect(off.map((module) => module.to)).toEqual(["/inspirations", "/projects", "/canvas", "/assets", "/skills"]);
    });

    test("is mounted on the creation home and preloads its targets", () => {
        const home = source("pages/create/index.tsx");
        const nav = source("pages/create/creation-module-nav.tsx");
        const css = source("pages/create/creation-module-nav.css");

        expect(home).toContain("<CreationModuleNav />");
        expect(nav).toContain("preloadWorkspaceRoute(module.to)");
        // 入口条必须带可访问名，且样式跟着组件模块走（懒加载路由不会漏样式）。
        expect(nav).toContain('aria-label="工作台模块"');
        expect(nav).toContain('import "./creation-module-nav.css"');
        expect(css).toContain(".creation-module-chip:focus-visible");
        expect(css).toContain(".creation-module-chip:active");
    });
});
