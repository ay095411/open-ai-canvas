import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";

import { RequireAuth } from "@/components/auth/require-auth";
import { FullScreenLoader, WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { loadAssetsPage, loadCanvasPage, loadCanvasProjectPage, loadCreatePage, loadProjectCreatePage, loadProjectDetailPage, loadProjectsPage, loadSkillWorkbenchPage } from "@/lib/workspace-route-modules";
import { CanvasRefreshShell } from "@/pages/canvas/canvas-refresh-shell";
import RouteErrorPage from "@/pages/route-error";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";

const AdminPage = lazy(() => import("@/pages/admin"));
const AnalyticsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnalyticsPage })));
const AnnouncementsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnnouncementsPage })));
const BannerAnnouncementsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.BannerAnnouncementsPage })));
const StorageResourcesPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.StorageResourcesPage })));
const CreditOperationsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.CreditOperationsPage })));
const AccessSettingsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AccessSettingsPage })));
const EmailSettingsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.EmailSettingsPage })));
const FeatureAvailabilityPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.FeatureAvailabilityPage })));
const AgentLessonsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AgentLessonsPage })));
const ChannelsPage = lazy(() => import("@/pages/admin/channels/channels-page"));
const LogicalModelsPage = lazy(() => import("@/pages/admin/logical-models/logical-models-page"));
const AdminPluginsPage = lazy(() => import("@/pages/admin/plugins/plugins-page"));
const SkillCurationPage = lazy(() => import("@/pages/admin/skill-curation-page"));
const AdminPaymentsPage = lazy(() => import("@/pages/admin/payments/payments-page"));
const LogsPage = lazy(() => import("@/pages/admin/logs/logs-page"));
const LoginLogsPage = lazy(() => import("@/pages/admin/login-logs/login-logs-page"));
const RedemptionCodesPage = lazy(() => import("@/pages/admin/redemption-codes/redemption-codes-page"));
const RuntimePolicySettingsPage = lazy(() => import("@/pages/admin/settings/runtime-policy-settings-page"));
const AppearanceSettingsPage = lazy(() => import("@/pages/admin/settings/appearance-settings-page"));
const DrawingEngineSettingsPage = lazy(() => import("@/pages/admin/settings/drawing-engine-settings-page"));
const StorageSettingsPage = lazy(() => import("@/pages/admin/settings/storage-settings-page"));
const ArkPrivateAssetsSettingsPage = lazy(() => import("@/pages/admin/settings/ark-private-assets-settings-page"));
const ResponseInterceptionSettingsPage = lazy(() => import("@/pages/admin/settings/response-interception-settings-page"));
const ThirdPartySettingsPage = lazy(() => import("@/pages/admin/settings/libtv-settings-page"));
const WorkbenchToolsPage = lazy(() => import("@/pages/admin/workbench-tools/workbench-tools-page"));
const SystemUpdatePage = lazy(() => import("@/pages/admin/settings/system-update-page"));
const SystemPerformancePage = lazy(() => import("@/pages/admin/settings/system-performance-page"));
const StoryboardPromptsPage = lazy(() => import("@/pages/admin/storyboard-prompts/storyboard-prompts-page"));
const AdminFeedbacksPage = lazy(() => import("@/pages/admin/feedbacks/feedbacks-page"));
const UsersPage = lazy(() => import("@/pages/admin/users/users-page"));
const UserGroupsPage = lazy(() => import("@/pages/admin/user-groups/user-groups-page"));
const AssetsPage = lazy(loadAssetsPage);
const CanvasPage = lazy(loadCanvasPage);
const CanvasProjectPage = lazy(loadCanvasProjectPage);
const SharedCanvasPage = lazy(() => import("@/pages/canvas/shared"));
const CreatePage = lazy(loadCreatePage);
const ImageWorkbenchPage = lazy(() => import("@/pages/workbench/image-workbench-route"));
const VideoWorkbenchPage = lazy(() => import("@/pages/workbench/video-workbench-page"));
const NotFound = lazy(() => import("@/pages/not-found"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const SkillWorkbenchPage = lazy(loadSkillWorkbenchPage);
const PluginsPage = lazy(() => import("@/pages/plugins"));
const EagleLibraryPage = lazy(() => import("@/pages/plugins/eagle"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const ProjectsPage = lazy(loadProjectCreatePage);
const ProjectDetailPage = lazy(loadProjectDetailPage);
const ProjectCreatePage = lazy(loadProjectCreatePage);
const SettingsPage = lazy(() => import("@/pages/settings"));
const ReferralPage = lazy(() => import("@/pages/referral"));
const AdminReferralPage = lazy(() => import("@/pages/admin/referral/referral-admin-page"));
const TestVoiceRecording = lazy(() => import("@/pages/test-voice-recording"));
const UserLayout = lazy(() => import("@/layouts/user-layout"));
const RequireFeature = lazy(() => import("@/components/auth/require-feature").then((module) => ({ default: module.RequireFeature })));

function deferred(element: ReactNode) {
    return <Suspense fallback={<WorkspaceRouteLoader />}>{element}</Suspense>;
}

function fullScreenDeferred(element: ReactNode) {
    return <Suspense fallback={<FullScreenLoader label="正在打开创作空间" detail="准备当前页面" />}>{element}</Suspense>;
}

/**
 * 工作区布局壳：只负责 Suspense 边界 + UserLayout，不再强制登录。
 * 登录墙由每条路由自己的 RequireAuth 承担；`/` 与 `/create`（创作首页）对游客开放。
 */
function WorkspaceLayout() {
    const { pathname } = useLocation();
    const isCanvasProjectRoute = pathname.startsWith("/canvas/");
    const fallback = isCanvasProjectRoute ? <CanvasRefreshShell /> : <FullScreenLoader label="正在打开创作空间" detail="准备当前页面" />;
    return (
        <RequireAuth allowAnonymous={isGuestWorkspacePath(pathname)}>
            <Suspense fallback={fallback}>
                <UserLayout>
                    <Outlet />
                </UserLayout>
            </Suspense>
        </RequireAuth>
    );
}

/**
 * DEV 专用实验室路由。
 *
 * lazy(() => import(...)) 写在函数体内，而不是模块顶层常量：
 * 生产构建时 import.meta.env.DEV 被替换为 false，本函数随之不可达，
 * 摇树会连同其中的动态 import 一起删除，实验室代码不进入生产依赖图。
 * 若把 lazy 提到模块顶层，动态 import 会被静态分析成真实 chunk 并打进 dist。
 */
function devRoutes() {
    const FolderPreviewLab = lazy(() => import("@/pages/dev/folder-preview-lab"));
    const PrevisReproLab = lazy(() => import("@/pages/dev/previs-repro-lab"));
    return [
        { path: "/dev/folders", element: fullScreenDeferred(<FolderPreviewLab />), errorElement: <RouteErrorPage /> },
        { path: "/dev/previs-repro", element: fullScreenDeferred(<PrevisReproLab />), errorElement: <RouteErrorPage /> },
    ];
}

/** 登录 / 注册不再是页面：这里只留空壳，界面由 `WorkspaceAuthHost` 顶成全局弹窗。 */
function AuthRouteShell() {
    return null;
}

export const router = createBrowserRouter([
    { path: "/share/canvas/:token", element: fullScreenDeferred(<SharedCanvasPage />), errorElement: <RouteErrorPage /> },
    ...(import.meta.env.DEV ? devRoutes() : []),
    {
        element: <WorkspaceLayout />,
        errorElement: <RouteErrorPage />,
        children: [
            // `/login` `/register` 只是「把登录弹窗顶起来」的深链：渲染空壳，由
            // `WorkspaceAuthHost` 接住地址、开弹窗，再把 URL 换回打开前那一页。
            // 必须放在 WorkspaceLayout 分支里——弹窗宿主挂在工作台外壳上。
            { path: "/login", element: <AuthRouteShell /> },
            { path: "/register", element: <AuthRouteShell /> },
            { path: "/forgot-password", element: <AuthRouteShell /> },
            // 创作首页对游客开放：可看模型目录、常驻通知与公告；
            // 页面内的创作 / Agent / 参考内容 / 历史对话动作在组件内做登录门。
            { path: "/", element: deferred(<CreatePage />) },
            { path: "/create", element: deferred(<CreatePage />) },
            {
                path: "/toolbox",
                element: <Navigate to="/toolbox/image" replace />,
            },
            {
                path: "/toolbox/image",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="imageWorkbenchEnabled">{deferred(<ImageWorkbenchPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/toolbox/video",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="videoWorkbenchEnabled">{deferred(<VideoWorkbenchPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/tasks",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="taskCenterEnabled">{deferred(<TasksPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/assets", element: <RequireAuth>{deferred(<AssetsPage />)}</RequireAuth> },
            { path: "/skills", element: <RequireAuth>{deferred(<SkillsPage />)}</RequireAuth> },
            { path: "/skills/:skillId/edit", element: <RequireAuth>{deferred(<SkillWorkbenchPage />)}</RequireAuth> },
            {
                path: "/plugins",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="pluginCenterEnabled">{deferred(<PluginsPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/plugins/eagle",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="pluginCenterEnabled">{deferred(<EagleLibraryPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/wallet",
                element: <RequireAuth>{null}</RequireAuth>,
            },
            { path: "/settings", element: <RequireAuth>{deferred(<SettingsPage />)}</RequireAuth> },
            { path: "/referral", element: <RequireAuth>{deferred(<ReferralPage />)}</RequireAuth> },
            { path: "/test-voice-recording", element: <RequireAuth>{deferred(<TestVoiceRecording />)}</RequireAuth> },
            {
                path: "/projects",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectsPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/new",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectCreatePage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId/e/:episodeId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/projects/:projectId/*", element: <Navigate to=".." relative="path" replace /> },
            { path: "/canvas", element: <RequireAuth>{deferred(<CanvasPage />)}</RequireAuth> },
            {
                path: "/canvas/:id",
                element: (
                    <RequireAuth>
                        <CanvasProjectPage />
                    </RequireAuth>
                ),
            },
            {
                path: "/admin",
                element: <RequireAuth>{deferred(<AdminPage />)}</RequireAuth>,
                children: [
                    { index: true, element: <AnalyticsPage /> },
                    { path: "users", element: <UsersPage /> },
                    { path: "user-groups", element: <UserGroupsPage /> },
                    { path: "login-logs", element: <LoginLogsPage /> },
                    { path: "feedbacks", element: <AdminFeedbacksPage /> },
                    { path: "channels", element: <ChannelsPage /> },
                    {
                        path: "models",
                        element: (
                            <RequireFeature feature="frontendModelsEnabled">
                                <LogicalModelsPage />
                            </RequireFeature>
                        ),
                    },
                    { path: "plugins", element: <AdminPluginsPage /> },
                    { path: "workbench-tools", element: <WorkbenchToolsPage /> },
                    { path: "skill-curation", element: <SkillCurationPage /> },
                    { path: "payments", element: <AdminPaymentsPage /> },
                    { path: "prompt-templates", element: <StoryboardPromptsPage /> },
                    { path: "storyboard-prompts", element: <Navigate to="/admin/prompt-templates" replace /> },
                    { path: "announcements", element: <AnnouncementsPage /> },
                    { path: "banner-announcements", element: <BannerAnnouncementsPage /> },
                    { path: "agent-lessons", element: <AgentLessonsPage /> },
                    { path: "resources", element: <StorageResourcesPage /> },
                    { path: "credit-operations", element: <CreditOperationsPage /> },
                    { path: "redemption-codes", element: <RedemptionCodesPage /> },
                    { path: "referral", element: <AdminReferralPage /> },
                    { path: "logs", element: <LogsPage /> },
                    { path: "settings", element: <Navigate to="runtime-policy" replace /> },
                    { path: "settings/appearance", element: <AppearanceSettingsPage /> },
                    { path: "settings/drawing-engine", element: <DrawingEngineSettingsPage /> },
                    { path: "settings/concurrency", element: <Navigate to="/admin/settings/runtime-policy" replace /> },
                    { path: "settings/runtime-policy", element: <RuntimePolicySettingsPage /> },
                    { path: "settings/features", element: <FeatureAvailabilityPage /> },
                    { path: "settings/access", element: <AccessSettingsPage /> },
                    { path: "settings/email", element: <EmailSettingsPage /> },
                    { path: "settings/storage", element: <StorageSettingsPage /> },
                    { path: "settings/ark-private-assets", element: <ArkPrivateAssetsSettingsPage /> },
                    { path: "settings/response-interception", element: <ResponseInterceptionSettingsPage /> },
                    { path: "settings/third-party", element: <ThirdPartySettingsPage /> },
                    { path: "settings/system-update", element: <SystemUpdatePage /> },
                    { path: "settings/system-performance", element: <SystemPerformancePage /> },
                    { path: "settings/libtv", element: <Navigate to="/admin/settings/third-party" replace /> },
                ],
            },
        ],
    },
    { path: "*", element: fullScreenDeferred(<NotFound />) },
]);
