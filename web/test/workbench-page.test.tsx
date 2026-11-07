import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("创作影棚真实页面的双模式与提交门控通过", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "./test/fixtures/workbench-page.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 120000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 120000);
