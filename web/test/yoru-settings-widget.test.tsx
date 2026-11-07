import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("小夜管理配置与功能开关的真实组件交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/yoru-settings-widget.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("13 pass");
    expect(output).toContain("0 fail");
}, 65_000);
