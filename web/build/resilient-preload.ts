import type { Plugin } from "vite";

export function resilientPreload(): Plugin {
    return {
        name: "canvas-resilient-preload",
        apply: "build",
        enforce: "post",
        transform(code, id) {
            if (id !== "\0vite/preload-helper.js") return;
            const entry = "function preload(baseModule, deps, importerUrl) {";
            const seenCheck = "if (dep in seen) return;";
            const preloadOnceCall = "return preloadOnce(seen, dep.href, () => {";
            const cssLoad = "if (isCss) return new Promise((res, rej) => {";
            const cssErrorLegacy = 'link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));\n\t\t\t});';
            const cssErrorCall = 'link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));';
            const preloadOnceReject = "}, (err) => {\n\t\tseen[href] = void 0;\n\t\tthrow err;\n\t});";
            const legacyHelper = code.includes(seenCheck) && code.includes(cssErrorLegacy);
            const preloadOnceHelper = code.includes(preloadOnceCall) && code.includes(cssErrorCall);
            if (!code.includes(entry) || !code.includes(cssLoad) || (!legacyHelper && !preloadOnceHelper)) {
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
            if (legacyHelper) {
                // When two imports need the same CSS, both wait for it. A failed link can be recreated on retry.
                transformed = transformed
                    .replace(seenCheck, "if (dep in seen) return seen[dep] === true ? undefined : seen[dep];")
                    .replace(cssLoad, "if (isCss) return (seen[dep] = new Promise((res, rej) => {")
                    .replace(cssErrorLegacy, 'link.addEventListener("error", () => { delete seen[dep]; link.remove(); rej(new PageResourceError(dep, "页面样式加载失败")); });\n\t\t\t}));');
            } else {
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
