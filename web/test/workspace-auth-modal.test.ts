import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { safeAuthNext } from "../src/lib/workspace-auth";

const source = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

/**
 * 登录 / 注册弹窗化（2026-10-10）。
 *
 * 拆掉的核心契约与拆掉它的典型方式：
 * - 路由不能再渲染登录页（`LoginPage` / `RegisterPage` 已删除），否则整页与弹窗并存；
 * - `/login` `/register` 必须仍然可达，且必须是游客路径 —— 漏掉后者时 RequireAuth 会把
 *   `/login` 再重定向到 `/login?next=/login`，变成自跳死循环（构建期不报错，只有跑起来才炸）；
 * - `next` 参数必须只放行站内相对路径，否则 `/login?next=https://evil.com` 是开放重定向；
 * - 弹窗是恒深色表面，复用 `.auth-scene-card` 时必须连 `--auth-card-bg` 一起改深，
 *   不然浅色主题下输入框取白底、表单又是白字，得到「白底白字」。
 */
describe("登录 / 注册弹窗", () => {
    test("next 只接受站内相对路径，挡掉协议相对与外链", () => {
        expect(safeAuthNext("/projects")).toBe("/projects");
        expect(safeAuthNext("/canvas/42?view=agent")).toBe("/canvas/42?view=agent");
        expect(safeAuthNext("//evil.com")).toBeNull();
        expect(safeAuthNext("https://evil.com")).toBeNull();
        expect(safeAuthNext("javascript:alert(1)")).toBeNull();
        expect(safeAuthNext("")).toBeNull();
        expect(safeAuthNext(null)).toBeNull();
        expect(safeAuthNext(undefined)).toBeNull();
    });

    test("宿主挂在工作台外壳里，并拦截 /login 与 /register", () => {
        const shell = source("components/layout/app-top-nav.tsx");
        expect(shell).toContain("<WorkspaceAuthHost />");
        // 必须排在内核浮层宿主那一组里：弹窗要用 .app-user-overlays 提供的 --user-* token。
        expect(shell).toContain("<WorkspaceWalletHost />");
        expect(shell).toContain("<WorkspaceSettingsHost />");

        const host = source("components/layout/workspace-auth-modal.tsx");
        expect(host).toContain("WORKSPACE_AUTH_OPEN_EVENT");
        expect(host).toContain('const AUTH_ROUTES = new Set(["/login", "/register"]);');
        expect(host).toContain("navigate(returnToRef.current, { replace: true })");
        // 已登录时不该再看登录表单（Linux.do 回调返回、另一个标签页登录完成）。
        expect(host).toContain("if (!state.open || !hydrated || !user) return;");
    });

    test("路由不再渲染登录页，但保留深链并放行游客", () => {
        const router = source("router.tsx");
        expect(router).not.toContain("LoginPage");
        expect(router).not.toContain("RegisterPage");
        expect(router).toContain('{ path: "/login", element: <AuthRouteShell /> }');
        expect(router).toContain('{ path: "/register", element: <AuthRouteShell /> }');
        // 找回密码按约定仍是独立页，继续挂在 AuthScene 外壳下。
        expect(router).toContain('{ path: "/forgot-password"');
        expect(source("lib/guest-workspace.ts")).toContain('pathname === "/login"');
        expect(source("lib/guest-workspace.ts")).toContain('pathname === "/register"');
    });

    test("所有登录入口改走事件，不再跳登录页", () => {
        expect(source("components/layout/workspace-topbar-actions.tsx")).toContain("openWorkspaceAuth()");
        expect(source("pages/create/index.tsx")).toContain("openWorkspaceAuth({ next:");
        const logout = source("hooks/use-workspace-logout.ts");
        expect(logout).toContain('navigate("/", { replace: true })');
        expect(logout).not.toContain('navigate("/login"');
        // 分享画布在路由器顶层，宿主不在那一支里，所以它仍走 /login 深链。
        expect(source("pages/canvas/shared.tsx")).toContain("`/login?next=${encodeURIComponent(");
    });

    test("弹窗是恒深色表面，token 与 antd 控件都被重新给过一遍", () => {
        const css = source("styles/globals.css");
        expect(css).toContain(".workspace-auth-modal {");
        expect(css).toContain("--auth-card-bg: rgba(255, 255, 255, .05);");
        expect(css).toContain(".workspace-auth-tabs button[aria-selected=\"true\"]");
        // 窄屏直接不渲染品牌舞台。
        expect(css).toContain("@media (max-width: 880px)");

        const modal = source("components/layout/workspace-auth-modal.tsx");
        expect(modal).toContain("workspace-auth-modal");
        expect(modal).toContain("auth-scene-card");
        expect(modal).toContain("closable={false}");
        expect(modal).toContain("<LoginForm");
        expect(modal).toContain("<RegisterForm");
    });
});
