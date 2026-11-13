import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("全局微信登录弹窗通过深链、取消、注册回跳与登录入口回归", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-wechat-auth.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("5 pass");
    expect(output).toContain("0 fail");
}, 60000);
