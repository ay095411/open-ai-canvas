import type { Plugin } from "vite";

export function resilientPreload(): Plugin {
    return {
        name: "canvas-resilient-preload",
        apply: "build",
        enforce: "post",
        transform(code, id) {
            if (id !== "\0vite/preload-helper.js") return;
            const matchOnce = (pattern: RegExp) => {
                const matches = code.match(pattern);
                return matches?.length === 1 ? matches[0] : undefined;
            };
            // Vite serializes functions with toString; Bun rewrites whitespace and pure Error constructors.
            const entry = matchOnce(/function\s+preload\s*\(\s*baseModule\s*,\s*deps\s*,\s*importerUrl\s*\)\s*\{/g);
            if (!entry) throw new Error("Vite preload helper changed; update the resource preload adapter");
            const seenCheck = matchOnce(/if\s*\(\s*dep\s+in\s+seen\s*\)\s*return\s*;/g);
            const preloadOnceCall = matchOnce(/return\s+preloadOnce\s*\(\s*seen\s*,\s*dep\.href\s*,\s*\(\s*\)\s*=>\s*\{/g);
            const cssErrorPattern = /link\.addEventListener\(\s*["']error["']\s*,\s*\(\s*\)\s*=>\s*rej\(\s*(?:\/\*\s*@__PURE__\s*\*\/\s*)?(?:new\s+)?Error\(`Unable to preload CSS for \$\{dep\}`\)\s*\)\s*\)\s*;/g;
            const cssErrorCall = matchOnce(cssErrorPattern);
            const cssBlock = matchOnce(
                new RegExp(
                    `if\\s*\\(\\s*isCss\\s*\\)\\s*return\\s+new\\s+Promise\\s*\\(\\s*\\(\\s*res\\s*,\\s*rej\\s*\\)\\s*=>\\s*\\{\\s*(?:link\\.addEventListener\\(\\s*["']load["']\\s*,\\s*res\\s*\\);\\s*)?${cssErrorPattern.source}\\s*\\}\\s*\\)\\s*;`,
                    "g",
                ),
            );
            const preloadOnceReject = matchOnce(/\},\s*\(\s*err\s*\)\s*=>\s*\{\s*seen\[href\]\s*=\s*void\s+0;\s*throw\s+err;\s*\}\s*\);/g);
            const legacyHelper = seenCheck && cssBlock && !preloadOnceCall && !preloadOnceReject;
            const preloadOnceHelper = preloadOnceCall && cssBlock && cssErrorCall && preloadOnceReject && !seenCheck;
            let transformed =
                'import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";\n' +
                code.replace(
                    entry,
                    "async function preload(baseModule, deps, importerUrl) {\n" +
                        "try {\n" +
                        "await warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n" +
                        "} catch (error) { return handlePreloadError(error); }\n",
                );
            if (legacyHelper && seenCheck && cssBlock) {
                // Old Vite helpers must share the CSS promise, not merely mark a link as seen.
                transformed = transformed
                    .replace(seenCheck, "if (dep in seen) return seen[dep] === true ? undefined : seen[dep];")
                    .replace(
                        cssBlock,
                        'if (isCss) return (seen[dep] = new Promise((res, rej) => {\nlink.addEventListener("load", res);\nlink.addEventListener("error", () => { delete seen[dep]; link.remove(); rej(new PageResourceError(dep, "页面样式加载失败")); });\n}));',
                    );
            } else if (preloadOnceHelper && preloadOnceReject && cssErrorCall) {
                // Vite 8.3+ already deduplicates concurrent CSS loads via preloadOnce; clear seen and remove the failed link so retries can recreate it.
                transformed = transformed
                    .replace(preloadOnceReject, "}, (err) => {\n\t\tdelete seen[href];\n\t\tthrow err;\n\t});")
                    .replace(cssErrorCall, 'link.addEventListener("error", () => { delete seen[dep.href]; link.remove(); rej(new PageResourceError(dep.href, "页面样式加载失败")); });');
            } else {
                // Keep unknown CSS implementations untouched; partial rewriting could suppress real failures.
                this?.warn("Vite preload CSS helper changed; keeping native CSS preload behavior with resource prewarming.");
            }
            return {
                code: transformed,
                map: null,
            };
        },
    };
}
