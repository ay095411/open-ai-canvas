import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { authDialogLanding, authPageURL, authViewFromPath, resolveLoginMode, safeAuthNext } from "../src/lib/auth-entry";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
/** 去掉注释后再断言：注释里解释「不要 navigate("/login")」不该算成违规。 */
const codeOnly = (path: string) => source(path).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("登录入口打开方式", () => {
    test("后台未配置或旧服务端未返回时默认弹窗", () => {
        expect(resolveLoginMode(undefined)).toBe("modal");
        expect(resolveLoginMode(null)).toBe("modal");
        expect(resolveLoginMode({ loginMode: "modal" })).toBe("modal");
        expect(resolveLoginMode({ loginMode: "page" })).toBe("page");
        expect(resolveLoginMode({ loginMode: "popup" as never })).toBe("modal");
    });

    test("独立页面地址只携带站内 next，回首页时省略", () => {
        expect(authPageURL("login", "/")).toBe("/login");
        expect(authPageURL("login", null)).toBe("/login");
        expect(authPageURL("register", "/canvas/abc?tab=1")).toBe("/register?next=%2Fcanvas%2Fabc%3Ftab%3D1");
        expect(authPageURL("recovery", "/settings")).toBe("/forgot-password?next=%2Fsettings");
        // 外站和协议相对地址不能成为登录后的跳转目标。
        expect(authPageURL("login", "https://evil.example")).toBe("/login");
        expect(authPageURL("login", "//evil.example")).toBe("/login");
        expect(safeAuthNext("/projects")).toBe("/projects");
        expect(safeAuthNext("projects")).toBe("/");
    });

    test("直达 /login 时弹窗叠在可公开访问的页面上，受保护页面先回首页", () => {
        expect(authViewFromPath("/login")).toBe("login");
        expect(authViewFromPath("/register")).toBe("register");
        expect(authViewFromPath("/forgot-password")).toBe("recovery");
        expect(authViewFromPath("/canvas")).toBeNull();
        expect(authDialogLanding("/create")).toBe("/create");
        expect(authDialogLanding("/share/canvas/token?x=1")).toBe("/share/canvas/token?x=1");
        expect(authDialogLanding("/canvas/abc")).toBe("/");
        expect(authDialogLanding("//evil.example")).toBe("/");
    });

    test("站内入口统一经由登录入口分发，不再硬编码 /login", () => {
        const requireAuth = source("components/auth/require-auth.tsx");
        expect(requireAuth).toContain('openDialog("login", next)');
        expect(requireAuth).toContain('authPageURL("login", next)');
        // 侧栏两处登录入口保留 `/login` 深链（中键 / 新标签页仍要能用），
        // 但左键必须被 interceptAuthLink 截成就地开弹窗——真跳会让整页卸载重建、闪一下。
        for (const file of ["components/layout/workspace-sidebar-nav.tsx", "components/layout/workspace-sidebar-footer.tsx"]) {
            const code = source(file);
            expect(code, file).toContain('to="/login"');
            expect(code, file).toContain("interceptAuthLink");
        }
        // 退出登录、设置页、账号卡与画布分享不再用导航到 /login 的方式开登录。
        for (const file of ["hooks/use-workspace-logout.ts", "pages/settings/profile-pane.tsx", "components/layout/workspace-account-card.tsx", "pages/canvas/shared.tsx"]) {
            const code = codeOnly(file);
            expect(code, file).not.toMatch(/navigate\(\s*["`]\/login/);
            expect(code, file).not.toMatch(/href=["`]\/login/);
        }
        // 首页创作输入框的未发送内容只在内存里，所以登录一律走弹窗事件。
        expect(source("pages/create/index.tsx")).toContain("openWorkspaceAuth(");
        expect(source("components/layout/app-top-nav.tsx")).toContain("<WorkspaceAuthHost />");
        // 上面这些入口写的是 useAuthDialogStore，本地没有 AuthDialogHost：
        // 宿主必须自己订阅它，否则点了既不弹窗也不跳转（受保护页面只会被踢回首页）。
        expect(source("components/layout/workspace-auth-modal.tsx")).toContain("useAuthDialogStore((state) => state.open)");
    });

    test("后台登录与注册页提供打开方式选择并保留原有分区", () => {
        const panel = source("pages/admin/components/access-settings-panel.tsx");
        expect(panel).toContain('title="4. 登录与注册的打开方式"');
        expect(panel).toContain("updateAdminRegistrationSetting({ enabled: registration.enabled, loginMode })");
        expect(panel).toContain('role="radiogroup"');
        expect(source("services/api/wallet.ts")).toContain("loginMode?: AuthLoginMode");
        expect(source("services/api/auth.ts")).toContain("loginMode: AuthLoginMode;");
    });
});
