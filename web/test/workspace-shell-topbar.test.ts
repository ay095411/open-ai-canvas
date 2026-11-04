import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = (name: string) => resolve(import.meta.dir, `../src/components/layout/${name}`);
const read = (name: string) => readFileSync(layout(name), "utf8");

describe("responsive workspace shell", () => {
    test("persists desktop collapse independently of the mobile drawer", () => {
        const shell = read("app-top-nav.tsx");
        expect(shell).toContain("useState(readWorkspaceSidebarCollapsed)");
        expect(shell).toContain("writeWorkspaceSidebarCollapsed(next)");
        expect(shell).toContain("setMobileSidebarExpanded((current) => !current)");
        expect(shell).toContain("if (isMobileViewport()) setMobileSidebarExpanded(false)");
        expect(shell).toContain('aria-label="收起侧栏" onClick={() => setMobileSidebarExpanded(false)}');
    });

    test("shell keeps navigation and overlay hosts mounted with the page stage", () => {
        const shell = read("app-top-nav.tsx");

        expect(shell).toContain("<WorkspaceTopBar sidebarOpen=");
        expect(shell).toContain("<WorkspaceSidebarNav");
        expect(shell).toContain("onNavigate={handleNavClick}");
        expect(shell).toContain("<WorkspaceTopBarExtensionProvider>");
        expect(shell).toContain("<WorkspaceAuthHost />");
        expect(shell).toContain("<WorkspaceWalletHost />");
        expect(shell).toContain("<WorkspaceSettingsHost />");
        expect(shell).toContain("<WorkspaceStorageLimitNotice />");
        expect(shell.indexOf("<WorkspaceAuthHost />")).toBeGreaterThan(shell.indexOf("</WorkspaceTopBarExtensionProvider>"));
    });

    test("topbar exposes the mobile sidebar control, extension and actions", () => {
        const topbar = read("workspace-top-bar.tsx");

        expect(topbar).toContain('aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}');
        expect(topbar).toContain("onClick={onToggleSidebar}");
        expect(topbar).toContain("<WorkspaceTopBarExtensionSlot />");
        expect(topbar).toContain("<WorkspaceTopBarActions />");
        expect(read("workspace-sidebar-nav.tsx")).toContain('className="app-workspace-sidebar-brand-button group"');
    });

    test("sidebar account area keeps checkin and both public and signed-in announcements reachable", () => {
        const sidebar = read("workspace-sidebar-nav.tsx");
        const actions = read("workspace-topbar-actions.tsx");

        expect(sidebar).toContain("<WorkspaceSidebarCheckin collapsed={collapsed} />");
        expect(sidebar).toContain('<SystemAnnouncementCenter className="app-workspace-sidebar-notification" />');
        expect(sidebar).toContain('<SystemAnnouncementCenter userId={user.id} className="app-workspace-sidebar-notification" autoOpen />');
        expect(actions).toContain("creditsEnabled && Boolean(user)");
        expect(actions).toContain("onClick={() => openWorkspaceWallet()}");
        expect(actions).toContain("<AnimatedThemeToggler");
    });

    test("guest sidebar login retains an accessible entry in both widths", () => {
        const sidebar = read("workspace-sidebar-nav.tsx");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(sidebar).toContain('to="/login" onClick={(event) => interceptAuthLink(event)}');
        expect(sidebar).toContain('aria-label="登录" title="登录"');
        expect(sidebar).toMatch(/className="app-workspace-sidebar-profile-avatar">\s*<CoalAvatar/);
        expect(sidebar).toMatch(/!collapsed\s*\?\s*\(?\s*<span className="app-workspace-sidebar-profile-copy"/);
        expect(css).toContain(".app-workspace-sidebar-profile");
    });
});
