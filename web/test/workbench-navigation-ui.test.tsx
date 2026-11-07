import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("studio and ecommerce navigation use independent feature gates and destinations", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workbench-navigation.test-case.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("11 pass");
    expect(output).toContain("0 fail");
}, 65_000);
