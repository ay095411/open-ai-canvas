export function isGuestWorkspacePath(pathname: string) {
    // `/login` `/register` `/forgot-password` 是登录弹窗的深链空壳，不放行的话 RequireAuth 会把
    // `/login` 再重定向成 `/login?next=/login`，变成自跳死循环（构建期不报错）。
    return pathname === "/" || pathname === "/create" || pathname === "/login" || pathname === "/register" || pathname === "/forgot-password";
}
