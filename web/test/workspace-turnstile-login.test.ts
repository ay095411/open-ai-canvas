import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("工作台真实登录表单覆盖机器人令牌、自动注册与验证码登录", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-turnstile-login.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
    expect(output).toContain("0 fail");
}, 65000);

test("机器人验证组件自行加载样式，不依赖旧认证面板", () => {
    const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    expect(read("components/auth/turnstile-widget.tsx")).toContain('import "./turnstile-widget.css"');
    expect(read("components/auth/turnstile-widget.css")).toContain(".auth-turnstile {");
    expect(read("components/auth/auth-panel.css")).not.toContain(".auth-turnstile");
});

test("站点外观合并保留本地轮播和 QQ 交流群，同时呈现机器人保护", () => {
    const source = readFileSync(new URL("../src/pages/admin/settings/appearance-settings-page.tsx", import.meta.url), "utf8");
    expect(source).toContain("<AuthCarouselEditor");
    expect(source).toContain('label: "QQ交流群"');
    expect(source).toContain("children: <TurnstileProtectionPanel />");
    expect(source).toContain('label: "机器人保护"');
});
