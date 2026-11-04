import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildWorkspaceModules } from "../src/lib/workspace-modules";

const source = (rel: string) => readFileSync(resolve(import.meta.dir, `../src/${rel}`), "utf8");

describe("workspace module entries", () => {
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

    test("workspace sidebar owns navigation and preloads its targets", () => {
        const home = source("pages/create/index.tsx");
        const shell = source("components/layout/app-top-nav.tsx");
        const nav = source("components/layout/workspace-sidebar-nav.tsx");

        expect(home).not.toContain("<CreationModuleNav");
        expect(shell).toContain("<WorkspaceSidebarNav");
        for (const event of ["onPointerEnter", "onPointerDown", "onFocus"]) expect(nav).toContain(`${event}={() => preloadWorkspaceRoute(linkTo)}`);
        expect(nav).toContain('aria-current={isActive ? "page" : undefined}');
        expect(nav).toContain("aria-label={collapsed ? collapsedHint : undefined}");
        expect(nav).toContain("features.taskCenterEnabled");
        expect(nav).toContain("features.pluginCenterEnabled");
    });
});
