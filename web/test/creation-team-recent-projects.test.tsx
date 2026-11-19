import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("团队首页最近画布沿用当前空间接口、链接和缓存边界", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-team-recent-projects.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
}, 35_000);
