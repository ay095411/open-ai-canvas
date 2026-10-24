/**
 * 需要登录才能看的工作台路径。
 *
 * 与 `router.tsx` 里包了 `<RequireAuth>` 的路由一一对应，改动路由时两边要一起改。
 * 只列「工作台内」的路径：`/`、`/create`、三个登录深链是游客可看的，`/share/canvas/:token`
 * 走的是独立布局、也不在这里。
 */
const PROTECTED_WORKSPACE_PREFIXES = [
    "/toolbox",
    "/toolbox/image",
    "/toolbox/video",
    "/tasks",
    "/projects",
    "/assets",
    "/skills",
    "/plugins",
    "/wallet",
    "/settings",
    "/canvas",
    "/admin",
    "/test-voice-recording",
];

/**
 * 段级前缀匹配：`/tasks` 命中 `/tasks/abc`，但不命中 `/tasks-archive`。
 *
 * 用途是「点击还没发生前就问一句」——见 `WorkspaceAuthHost` 的全局点击拦截：
 * 命中它就直接弹登录框，把导航掐掉，避免先跳过去再被 `RequireAuth` 弹回来的
 * 「URL 三连跳 + 整棵页面树重建」。
 */
export function isProtectedWorkspacePath(pathname: string) {
    return PROTECTED_WORKSPACE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isGuestWorkspacePath(pathname: string) {
    // `/login` `/register` `/forgot-password` 是登录弹窗的深链空壳，不放行的话 RequireAuth 会把
    // `/login` 再重定向成 `/login?next=/login`，变成自跳死循环（构建期不报错）。
    return pathname === "/" || pathname === "/create" || pathname === "/login" || pathname === "/register" || pathname === "/forgot-password";
}
