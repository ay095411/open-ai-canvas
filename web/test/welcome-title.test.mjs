import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("welcome entry loads configured appearance", async () => {
    let calls = 0;
    const imports = [];
    // 只剥掉真正的 import 语句，不能用宽松的 `/^import .*;\n/`：
    // 注释里出现 `"@fontsource-variable/fredoka/standard.css"` 这类带分号的路径会被误当 import
    // 截断，残片落到下一行就成了语法错误；仓库是 CRLF，换行必须写 `\r?\n`。
    const importPattern = /^import\s+(?:"[^"\n]*"|\{[^}\n]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+"[^"\n]*"\s*;\r?\n|^import\s+"[^"\n]*"\s*;\r?\n/gm;
    const main = source("../src/main.tsx")
        .replace(importPattern, "")
        .replace(/import\.meta\.env\.DEV/g, "false")
        .replace(/import\(/g, "loadModule(");
    vm.runInNewContext(main, {
        window: { location: { pathname: "/welcome" } },
        installChunkRecovery() {},
        isIsolatedPrevisRepro: () => false,
        bootstrapAppearance: async () => { calls++; },
        loadModule: async (name) => { imports.push(name); },
    });
    await Promise.resolve();
    assert.equal(calls, 1, "welcome entry must bootstrap appearance");
    assert.deepEqual(imports, ["./welcome-application"]);
});

test("welcome effects preserve configured SEO title", () => {
    const page = source("../src/pages/welcome/index.tsx");
    // Run the actual mount effects with inert motion/scroll listeners.
    const effects = [...page.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n    \}, \[([^\]]*)\]\);/g)].filter((match) => match[2] === "");
    assert.ok(effects.length > 0);
    for (const title of ["Custom SEO Title", "Custom Site Name"]) {
        const document = { title };
        for (const [, body] of effects) {
            vm.runInNewContext(`(() => {${body}\n})()`, {
                document,
                window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
                storyRef: { current: null }, restorePickerFocus: { current: false },
                setReduced() {}, setLook() {}, getWelcomeLook() {},
            });
        }
        assert.equal(document.title, title, "welcome must preserve appearance metadata title");
    }
});
