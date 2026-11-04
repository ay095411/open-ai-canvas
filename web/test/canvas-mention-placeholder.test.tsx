import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("引用编辑器删空、占位、输入法及文本粘贴的真实组件交互", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-mention-placeholder.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
}, 35_000);
