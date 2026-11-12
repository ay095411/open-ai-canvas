import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("首页作品带、灵感大厅与分页的真实组件交互", () => {
    // React DOM 的事件能力探测需与本组 Happy DOM 同时初始化，避免其他测试的全局环境影响输入事件。
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-showcase-feed.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("17 pass");
    expect(output).toContain("0 fail");
}, 65_000);
