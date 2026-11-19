import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { BannerAnnouncementsSlider } from "@/components/layout/banner-announcements-slider";
import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WorkspaceSidebarNav } from "@/components/layout/workspace-sidebar-nav";
import { readWorkspaceSidebarCollapsed, writeWorkspaceSidebarCollapsed } from "@/components/layout/workspace-sidebar-state";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { WorkspaceTopBarExtensionProvider } from "@/components/layout/workspace-top-bar-extension";
import { WorkspaceAuthHost } from "@/components/layout/workspace-auth-modal";
import { WorkspaceSettingsHost } from "@/components/layout/workspace-settings-modal";
import { WorkspaceStorageLimitNotice } from "@/components/layout/workspace-storage-limit-notice";
import { WorkspaceWalletHost } from "@/components/layout/workspace-wallet-modal";
import { GenerationSuccessNotifier } from "@/components/layout/generation-success-notifier";
import { useWorkspaceDocumentTitle } from "@/hooks/use-workspace-document-title";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath, workspacePagePath } from "@/lib/workspace-routes";

const WorkspaceCommandPalette = lazy(() => import("@/components/layout/workspace-command-palette").then((module) => ({ default: module.WorkspaceCommandPalette })));
const ShapeGrid = lazy(() => import("@/components/layout/shape-grid"));

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(readWorkspaceSidebarCollapsed);
    const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);
    const [paletteOpen, setPaletteOpen] = useState(false);
    useWorkspaceDocumentTitle();

    const pagePath = workspacePagePath(pathname);
    const hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pagePath);
    const showGlobalTopBar = !hideChrome;
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    // 创作首页与短剧立项页共用舞台背景，团队前缀不改变页面视觉。
    const creationWorkspace = pagePath === "/" || pagePath === "/create" || pagePath === "/projects";
    const teamWorkspace = pathname.startsWith("/teams/");

    const sidebarCollapsed = !isMobileViewport && desktopSidebarCollapsed;

    useEffect(() => {
        const media = window.matchMedia("(max-width: 1023px)");
        const updateViewport = () => setIsMobileViewport(media.matches);
        updateViewport();
        media.addEventListener("change", updateViewport);
        return () => media.removeEventListener("change", updateViewport);
    }, []);

    const toggleSidebar = () => {
        if (isMobileViewport) {
            setMobileSidebarExpanded((current) => !current);
            return;
        }
        setDesktopSidebarCollapsed((current) => {
            const next = !current;
            writeWorkspaceSidebarCollapsed(next);
            return next;
        });
    };

    const expandDesktopSidebar = () => {
        setDesktopSidebarCollapsed(false);
        writeWorkspaceSidebarCollapsed(false);
    };

    const collapseDesktopSidebar = () => {
        setDesktopSidebarCollapsed(true);
        writeWorkspaceSidebarCollapsed(true);
    };

    const handleNavClick = () => {
        if (isMobileViewport) setMobileSidebarExpanded(false);
    };

    // ⌘K / Ctrl+K 全局呼出搜索面板。
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (teamWorkspace) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPaletteOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [teamWorkspace]);

    useEffect(() => {
        const handleWorkspaceNavigation = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{ to?: string }>;
            if (!event.detail?.to) return;
            event.preventDefault();
            navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", handleWorkspaceNavigation);
        return () => window.removeEventListener("workspace:navigate", handleWorkspaceNavigation);
    }, [navigate]);

    return (
        <>
            <WorkspaceTopBarExtensionProvider>
                <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full flex-col overflow-hidden", spatialWorkbench && "is-spatial", creationWorkspace && "is-creation-workspace")}>
                    {!hideChrome && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label={t("shell.collapseSidebar")} onClick={() => setMobileSidebarExpanded(false)} /> : null}

                    {showGlobalTopBar ? <BannerAnnouncementsSlider /> : null}

                    <div className="app-workspace-main-row flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        {!hideChrome ? (
                            <aside className={cn("app-workspace-sidebar flex h-full shrink-0 flex-col overflow-hidden", mobileSidebarExpanded && "is-mobile-expanded", sidebarCollapsed && "is-collapsed")}>
                                <WorkspaceSidebarNav
                                    collapsed={sidebarCollapsed}
                                    onNavigate={handleNavClick}
                                    onOpenSearch={() => setPaletteOpen(true)}
                                    onExpand={expandDesktopSidebar}
                                    onCollapse={isMobileViewport ? () => setMobileSidebarExpanded(false) : collapseDesktopSidebar}
                                />
                            </aside>
                        ) : null}

                        <div className={cn("app-workspace-stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", creationWorkspace && "isolate creation-stage-canvas-ambient")}>
                            {creationWorkspace ? (
                                <div className="home-background" aria-hidden="true">
                                    <Suspense fallback={null}>
                                        <ShapeGrid />
                                    </Suspense>
                                </div>
                            ) : null}
                            {showGlobalTopBar ? <WorkspaceTopBar sidebarOpen={isMobileViewport ? mobileSidebarExpanded : !desktopSidebarCollapsed} onToggleSidebar={toggleSidebar} /> : null}
                            <div className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden", showGlobalTopBar && "workspace-route-content")}>{children}</div>
                        </div>
                    </div>

                    {paletteOpen && !teamWorkspace ? (
                        <Suspense fallback={null}>
                            <WorkspaceCommandPalette open onClose={() => setPaletteOpen(false)} />
                        </Suspense>
                    ) : null}
                </div>
            </WorkspaceTopBarExtensionProvider>
            <WorkspaceAuthHost />
            <WorkspaceWalletHost />
            <WorkspaceSettingsHost />
            <WorkspaceStorageLimitNotice />
            <GenerationSuccessNotifier />
            <ModelSetupGuide hidden={pathname === "/login" || pathname === "/register" || pathname.startsWith("/admin") || pathname.startsWith("/teams")} />
        </>
    );
}
