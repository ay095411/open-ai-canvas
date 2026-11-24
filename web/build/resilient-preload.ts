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
            const entry = matchOnce(/function preload\(baseModule,\s*deps,\s*importerUrl\) \{/g);
            const seenCheck = matchOnce(/if \(dep in seen\)\s*return;/g);
            const preloadOnceCall = matchOnce(/return preloadOnce\(seen,\s*dep\.href,\s*\(\) => \{/g);
            const cssLoad = matchOnce(/if \(isCss\)\s*return new Promise\(\(res,\s*rej\) => \{/g);
            const cssErrorPattern = /link\.addEventListener\("error", \(\) => rej\((?:\/\* @__PURE__ \*\/\s*)?(?:new\s+)?Error\(`Unable to preload CSS for \$\{dep\}`\)\)\);/g;
            const cssErrorCall = matchOnce(cssErrorPattern);
            const cssErrorLegacy = matchOnce(new RegExp(`${cssErrorPattern.source}\\s*\\}\\);`, "g"));
            const preloadOnceReject = matchOnce(/\},\s*\(err\) => \{\s*seen\[href\] = void 0;\s*throw err;\s*\}\);/g);
            const legacyHelper = seenCheck && cssErrorLegacy;
            const preloadOnceHelper = preloadOnceCall && cssErrorCall && preloadOnceReject;
            if (!entry || !cssLoad || (!legacyHelper && !preloadOnceHelper) || (legacyHelper && preloadOnceHelper)) {
                throw new Error("Vite preload helper changed; update the resource preload adapter");
            }
            let transformed =
                'import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";\n' +
                code.replace(
                    entry,
                    "async function preload(baseModule, deps, importerUrl) {\n" +
                        "try {\n" +
                        "await warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n" +
                        "} catch (error) { return handlePreloadError(error); }\n",
                );
            if (seenCheck && cssErrorLegacy) {
                // When two imports need the same CSS, both wait for it. A failed link can be recreated on retry.
                transformed = transformed
                    .replace(seenCheck, "if (dep in seen) return seen[dep] === true ? undefined : seen[dep];")
                    .replace(cssLoad, "if (isCss) return (seen[dep] = new Promise((res, rej) => {")
                    .replace(cssErrorLegacy, 'link.addEventListener("error", () => { delete seen[dep]; link.remove(); rej(new PageResourceError(dep, "页面样式加载失败")); });\n\t\t\t}));');
            } else if (preloadOnceReject && cssErrorCall) {
                // Vite 8.3+ already deduplicates concurrent CSS loads via preloadOnce; clear seen and remove the failed link so retries can recreate it.
                transformed = transformed
                    .replace(preloadOnceReject, "}, (err) => {\n\t\tdelete seen[href];\n\t\tthrow err;\n\t});")
                    .replace(cssErrorCall, 'link.addEventListener("error", () => { delete seen[dep.href]; link.remove(); rej(new PageResourceError(dep.href, "页面样式加载失败")); });');
            }
            return {
                code: transformed,
                map: null,
            };
        },
    };
}
