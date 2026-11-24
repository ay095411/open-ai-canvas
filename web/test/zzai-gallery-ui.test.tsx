import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("官方灵感大厅、审核库、收藏、缓存与瀑布流真实组件交互", () => {
    // Isolate the React/Happy DOM lifecycle from other suites' global window cleanup.
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/zzai-gallery-ui.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toMatch(/\b[1-9]\d* pass\b/);
    expect(output).toContain("0 fail");
}, 65_000);
