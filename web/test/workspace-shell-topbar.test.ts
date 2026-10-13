import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = (name: string) => resolve(import.meta.dir, `../src/components/layout/${name}`);
const read = (name: string) => readFileSync(layout(name), "utf8");

describe("workspace shell has no persistent sidebar", () => {
    test("drops the sidebar source files entirely", () => {
        for (const name of ["workspace-sidebar-nav.tsx", "workspace-sidebar-checkin.tsx", "workspace-sidebar-footer.tsx"]) {
            expect(existsSync(layout(name))).toBe(false);
        }
    });

    test("shell renders only the topbar, banner, palette and the two global hosts", () => {
        const shell = read("app-top-nav.tsx");

        expect(shell).toContain("<WorkspaceTopBar />");
        expect(shell).not.toContain("WorkspaceSidebarNav");
        expect(shell).not.toContain("app-workspace-sidebar-scrim");
        expect(shell).not.toContain("sidebarOpen");
        expect(shell).toContain("<WorkspaceWalletHost />");
        expect(shell).toContain("<WorkspaceSettingsHost />");
    });

    test("topbar needs no sidebar props and hosts brand + extension + actions", () => {
        const topbar = read("workspace-top-bar.tsx");

        expect(topbar).toContain("export function WorkspaceTopBar()");
        expect(topbar).not.toContain("sidebarOpen");
        expect(topbar).not.toContain("onToggleSidebar");
        expect(topbar).not.toContain("PanelLeft");
        // 品牌是侧栏下线后「回首页枢纽」的唯一常驻入口。
        expect(topbar).toContain('className="app-workspace-topbar-brand"');
        expect(topbar).toContain("<WorkspaceTopBarExtensionSlot />");
        expect(topbar).toContain("<WorkspaceTopBarActions />");
    });

    test("topbar actions carry the two sidebar-only features", () => {
        const actions = read("workspace-topbar-actions.tsx");

        expect(actions).toContain("<WorkspaceTopBarCheckin />");
        expect(actions).toContain("SystemAnnouncementCenter");
        // 游客也要能读公告：不带 userId（只读、不标记已读、不自动浮出）。
        expect(actions).toContain('<SystemAnnouncementCenter className="app-workspace-topbar-icon-button" />');
        // 登录态保留「未读自动浮出」的投递行为，它不该因为换位置而消失。
        expect(actions).toContain("autoOpen");
    });

    test("signin entry is no longer a white-on-white invisible pill", () => {
        const actions = read("workspace-topbar-actions.tsx");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(actions).toContain('className="app-workspace-topbar-signin"');
        expect(actions).not.toContain("bg-white/10 hover:bg-white/20 text-white rounded-full text-sm font-medium");
        expect(css).toContain(".app-user-workspace .app-workspace-topbar-signin {");
    });
});
