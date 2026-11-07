import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("电商作品审阅与交付在独立 DOM 中通过", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "./test/fixtures/ecommerce-output-gallery.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
    expect(output).toContain("0 fail");
}, 60000);
