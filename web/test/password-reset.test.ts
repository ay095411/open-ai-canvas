import { expect, test } from "bun:test";

test("password recovery keeps the approved login placement and dedicated route", async () => {
    const [loginSource, recoverySource, routerSource, sceneSource, authAPISource, emailSettingsSource] = await Promise.all([
        Bun.file(new URL("../src/pages/auth/login.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/auth/forgot-password.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/router.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/auth/auth-scene.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/email-settings-panel.tsx", import.meta.url)).text(),
    ]);

    expect(loginSource).toContain('label="密码"');
    expect(loginSource).toContain("忘记密码？");
    expect(loginSource).toContain("forgotPasswordURL");
    expect(routerSource).toContain('{ path: "/forgot-password"');
    // 2026-10-15：本地 UI 改版（e6ea201a）移除了 auth-scene 的 eyebrow 文案，
    // 改用路由判定 + 专属标题表达找回密码页，断言随之更新。
    expect(sceneSource).toContain('location.pathname === "/forgot-password"');
    expect(sceneSource).toContain('recovery: { title: "重新设置密码" }');
    expect(recoverySource).toContain("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱");
    expect(recoverySource).toContain('autoComplete="one-time-code"');
    expect(recoverySource).toContain('autoComplete="new-password"');
    expect(authAPISource).toContain('http.post<{ sent: boolean }>("/auth/password-reset-code"');
    expect(authAPISource).toContain('http.post<{ reset: boolean }>("/auth/password-reset"');
    expect(emailSettingsSource).toContain("发送注册与密码找回验证码");
});
