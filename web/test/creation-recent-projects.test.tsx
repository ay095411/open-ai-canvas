import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 独立进程隔离 DOM、API adapter 和模块 mock，避免影响其它页面的路由预加载。
test("首页继续创作查询、账号隔离与交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-recent-projects.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("10 pass");
    expect(output).toContain("0 fail");
}, 65_000);
