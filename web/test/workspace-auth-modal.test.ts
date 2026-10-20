import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { safeAuthNext } from "../src/lib/workspace-auth";

const source = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

/**
 * 登录 / 注册 / 找回密码弹窗化（2026-10-20）。
 *
 * 拆掉的核心契约与拆掉它的典型方式：
 * - 路由不能再渲染登录页，`/login` `/register` `/forgot-password` 只是空壳深链，
 *   界面由 `WorkspaceAuthHost` 顶成弹窗；
 * - 三条深链必须放在 WorkspaceLayout 分支里（宿主挂在工作台外壳上），且必须是游客路径 ——
 *   漏掉后者时 RequireAuth 会把 `/login` 再重定向到 `/login?next=/login`，
 *   变成自跳死循环（构建期不报错，只有跑起来才炸）；
 * - `next` 参数必须只放行站内相对路径，否则 `/login?next=https://evil.com` 是开放重定向；
 * - 弹窗高度固定，不跟表单内容走：登录 / 注册 / 找回密码三张表单高度差很多，
 *   跟着内容走弹窗会一跳一跳的。
 */
describe("登录 / 注册 / 找回密码弹窗", () => {
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

    test("宿主挂在工作台外壳里，并拦截三条深链", () => {
        const shell = source("components/layout/app-top-nav.tsx");
        expect(shell).toContain("<WorkspaceAuthHost />");
        // 必须排在内核浮层宿主那一组里：弹窗要用 .app-user-overlays 提供的 --user-* token。
        expect(shell).toContain("<WorkspaceWalletHost />");
        expect(shell).toContain("<WorkspaceSettingsHost />");

        const host = source("components/layout/workspace-auth-modal.tsx");
        expect(host).toContain("WORKSPACE_AUTH_OPEN_EVENT");
        expect(host).toContain('const AUTH_ROUTES = new Set(["/login", "/register", "/forgot-password"]);');
        expect(host).toContain("navigate(returnToRef.current, { replace: true })");
        // 已登录时不该再看登录表单（Linux.do 回调返回、另一个标签页登录完成）。
        expect(host).toContain("if (!state.open || !hydrated || !user) return;");
        // 关闭按钮必须是 frame 的第一个子节点：AntD 打开弹窗时把焦点给第一个可聚焦元素，
        // 若让轮播指示条先拿到焦点，onFocusCapture 会把自动播放永久按停。
        expect(host.indexOf("workspace-auth-close")).toBeLessThan(host.indexOf("workspace-auth-media"));
    });

    test("路由不再渲染登录页，三条深链都是空壳且游客可达", () => {
        const router = source("router.tsx");
        expect(router).not.toContain("LoginPage");
        expect(router).not.toContain("RegisterPage");
        expect(router).not.toContain("AuthScene");
        for (const path of ["/login", "/register", "/forgot-password"]) {
            expect(router).toContain(`{ path: "${path}", element: <AuthRouteShell /> }`);
        }
        const guest = source("lib/guest-workspace.ts");
        for (const path of ["/login", "/register", "/forgot-password"]) {
            expect(guest).toContain(`pathname === "${path}"`);
        }
    });

    test("登录入口走 /login 深链，由宿主接住变成弹窗", () => {
        // 侧栏与创作页都跳 /login?next=…；分享画布在路由器顶层，同样跳 /login，
        // 落进 WorkspaceLayout 分支后被宿主接住。任何一处改成直接渲染登录页都会让弹窗失效。
        expect(source("components/layout/workspace-sidebar-footer.tsx")).toContain('"/login"');
        expect(source("pages/create/index.tsx")).toContain("navigate(`/login?next=");
        const logout = source("hooks/use-workspace-logout.ts");
        expect(logout).toContain('navigate("/login", { replace: true })');
        expect(logout).not.toContain('navigate("/", { replace: true })');
        expect(source("pages/canvas/shared.tsx")).toContain('to="/login"');
    });

    test("弹窗尺寸固定、三种模式共用一个外框", () => {
        const css = source("components/layout/workspace-auth-modal.css");
        // 高度写死在 frame 上，而不是 min-height：跟内容走会让弹窗一跳一跳。
        const frameStart = css.indexOf(".workspace-auth-frame {");
        const frameBlock = css.slice(frameStart, css.indexOf("}", frameStart));
        expect(frameBlock).toContain("height: min(620px, calc(100dvh - 48px))");
        expect(frameBlock).not.toContain("min-height");
        // 样式跟着组件模块走（弹窗是跨路由浮层，不进 globals.css）。
        const modal = source("components/layout/workspace-auth-modal.tsx");
        expect(modal).toContain('import "./workspace-auth-modal.css"');
        expect(modal).toContain("workspace-auth-modal");
        expect(modal).toContain("auth-scene-card");
        expect(modal).toContain("closable={false}");
        expect(modal).toContain("<LoginForm");
        expect(modal).toContain("<RegisterForm");
        // 找回密码整页组件直接嵌进弹窗；它成功后自己跳 /login，宿主接住就回到登录表单。
        expect(modal).toContain("<ForgotPasswordPage />");
        expect(source("pages/auth/forgot-password.tsx")).not.toContain("BackToLogin");
    });

    test("左侧轮播读后台配置，视频只在当前一张挂载", () => {
        const modal = source("components/layout/workspace-auth-modal.tsx");
        expect(modal).toContain("appearance.authCarousel");
        // 没配置时回退到内置登录影片，弹窗左侧不能空着。
        expect(modal).toContain("authVideoUrl");
        expect(modal).toContain('slide.kind === "video"');
        expect(modal).toContain("SLIDE_INTERVAL_MS");
    });
});
