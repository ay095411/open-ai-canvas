import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("摄影机标签在 StrictMode、投影更新及删除时保持正确生命周期", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/previs-camera-label.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
}, 65_000);
