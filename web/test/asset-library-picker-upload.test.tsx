import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("素材上传持久化、分页刷新与插件隔离的真实组件交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/asset-library-picker-upload.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("7 pass");
    expect(output).toContain("0 fail");
}, 65_000);
