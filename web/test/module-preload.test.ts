import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { resilientPreload } from "../build/resilient-preload";
import { PageResourceError, prioritizeModuleLoad, warmPreloadResources, withModuleLoadPriority } from "../src/lib/module-preload";

test("有效的资源下载不受前端总时限中止", async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = (async (_input, init) => {
            expect(init?.signal).toBeUndefined();
            return new Response("export default 1", { headers: { "Content-Type": "application/javascript" } });
        }) as typeof fetch;
        await warmPreloadResources(["https://assets.example/slow.js"]);
    } finally {
        globalThis.fetch = original;
    }
});

test("预热合并并发请求，最多四路下载，503 重试后完成正文读取", async () => {
    const original = globalThis.fetch;
    let active = 0;
    let peak = 0;
    const attempts = new Map<string, number>();
    globalThis.fetch = (async (input) => {
        const url = String(input);
        const count = (attempts.get(url) || 0) + 1;
        attempts.set(url, count);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (url.endsWith("/0.js") && count === 1) return new Response("unavailable", { status: 503 });
        return new Response("export default 1", { headers: { "Content-Type": "application/javascript" } });
    }) as typeof fetch;
    try {
        const urls = Array.from({ length: 8 }, (_, i) => `https://assets.example/${i}.js`);
        await Promise.all([warmPreloadResources(urls), warmPreloadResources(urls)]);
        expect(peak).toBeLessThanOrEqual(4);
        expect(attempts.get(urls[0])).toBe(2);
        expect([...attempts.values()].reduce((a, b) => a + b)).toBe(9);
    } finally {
        globalThis.fetch = original;
    }
});

test("404 与 HTML 响应立即失败，失败请求不会永久缓存", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls += 1;
        return calls === 1 ? new Response("missing", { status: 404 }) : new Response("<html/>", { headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
    try {
        const urls = ["https://assets.example/missing.js"];
        await expect(warmPreloadResources(urls)).rejects.toThrow("404");
        await expect(warmPreloadResources(urls)).rejects.toThrow("错误的脚本或样式类型");
        expect(calls).toBe(2);
    } finally {
        globalThis.fetch = original;
    }
});

test("后台最多三路，打开预取中的页面时提升排队资源优先级且复用请求", async () => {
    const original = globalThis.fetch;
    const downloads = new Map<string, () => void>();
    globalThis.fetch = ((input) =>
        new Promise<Response>((resolve) => {
            downloads.set(String(input), () => resolve(new Response("export default 1", { headers: { "Content-Type": "application/javascript" } })));
        })) as typeof fetch;
    const files = Array.from({ length: 6 }, (_, index) => `https://assets.example/priority-${index}.js`);
    try {
        const first = withModuleLoadPriority({ foreground: false }, () => warmPreloadResources(files.slice(0, 4)));
        const priority = { foreground: false };
        const second = withModuleLoadPriority(priority, () => warmPreloadResources([files[0], files[4]]));
        expect([...downloads.keys()]).toEqual(files.slice(0, 3));
        prioritizeModuleLoad(priority);
        expect([...downloads.keys()]).toEqual([files[0], files[1], files[2], files[4]]);
        const foreground = warmPreloadResources([files[5]]);
        expect(downloads.size).toBe(4);
        downloads.get(files[4])!();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(downloads.has(files[5])).toBe(true);
        expect(downloads.has(files[3])).toBe(false);
        for (const finish of downloads.values()) finish();
        await new Promise((resolve) => setTimeout(resolve, 0));
        downloads.get(files[3])!();
        await Promise.all([first, second, foreground]);
    } finally {
        globalThis.fetch = original;
    }
});

test("真实 Vite helper 的预热失败沿用可取消的恢复事件，不执行原生 import", async () => {
    const transform = resilientPreload().transform as Function;
    const transformed = transform(installedVitePreloadHelper(), "\0vite/preload-helper.js").code.replace('import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";', "").replaceAll("import.meta", "importMeta");
    const events: Event[] = [];
    const failure = new Error("asset 404");
    let cancel = true;
    let imported = false;
    const preload = runInNewContext(`${transformed}; preload`, {
        Event,
        PageResourceError,
        URL,
        importMeta: { url: "https://assets.example/entry.js" },
        assetsURL: (dep: string) => dep,
        warmPreloadResources: async () => {
            throw failure;
        },
        window: {
            dispatchEvent: (event: Event) => {
                events.push(event);
                if (cancel) event.preventDefault();
            },
        },
    });
    const nativeImport = async () => {
        imported = true;
    };
    await preload(nativeImport, ["./missing.js"]);
    expect(events[0].type).toBe("vite:preloadError");
    expect((events[0] as Event & { payload: unknown }).payload).toBe(failure);
    expect(imported).toBe(false);
    cancel = false;
    await expect(preload(nativeImport, ["./missing.js"])).rejects.toThrow("asset 404");
    expect(imported).toBe(false);
});

function installedVitePreloadHelper() {
    const vite = readFileSync(resolve(import.meta.dir, "../node_modules/vite/dist/node/chunks/node.js"), "utf8");
    const start = vite.indexOf("function preloadOnce(seen, href, preload) {");
    const end = vite.indexOf("\nfunction getPreloadCode", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return vite.slice(start, end);
}

for (const runtime of ["Node", "Bun", "Unknown CSS"] as const) {
    test(runtime === "Unknown CSS" ? "未知 CSS helper 告警并保留预热与原生失败事件" : `${runtime} 序列化的真实 Vite helper 合并 CSS 等待，失败移除链接后允许重试`, async () => {
        const original = installedVitePreloadHelper();
        const source = runtime === "Bun" ? new Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(original) : runtime === "Unknown CSS" ? original.replace("Unable to preload CSS for", "Unknown CSS error for") : original;
        const warnings: string[] = [];
        const transform = resilientPreload().transform as Function;
        const transformed = transform
            .call({ warn: (message: string) => warnings.push(message) }, source, "\0vite/preload-helper.js")
            .code.replace('import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";', "")
            .replaceAll("import.meta", "importMeta");
        const links: { href: string; rel: string; removed: boolean; handlers: Map<string, () => void> }[] = [];
        const seen: Record<string, unknown> = {};
        const events: Event[] = [];
        const warmed: string[][] = [];
        const preload = runInNewContext(`${transformed}; preload`, {
            Event,
            Error,
            Promise,
            PageResourceError,
            URL,
            seen,
            scriptRel: "modulepreload",
            __VITE_IS_MODERN__: true,
            importMeta: { url: "https://assets.example/entry.js" },
            assetsURL: (dep: string) => dep,
            isCssPreloadUrl: (dep: URL) => dep.pathname.endsWith(".css"),
            warmPreloadResources: async (urls: string[]) => warmed.push([...urls]),
            document: {
                querySelector: () => null,
                getElementsByTagName: () => links.filter((link) => !link.removed),
                createElement: () => {
                    const link = { href: "", rel: "", removed: false, handlers: new Map<string, () => void>() };
                    return Object.assign(link, {
                        addEventListener: (name: string, handler: () => void) => link.handlers.set(name, handler),
                        remove: () => {
                            link.removed = true;
                        },
                    });
                },
                head: { appendChild: (link: (typeof links)[number]) => links.push(link) },
            },
            window: { dispatchEvent: (event: Event) => events.push(event) },
        });
        let imported = 0;
        const nativeImport = async () => {
            imported += 1;
        };
        const dependencies = ["./retry.css"];
        const failed = Promise.all([preload(nativeImport, dependencies), preload(nativeImport, dependencies)]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(links).toHaveLength(1);
        links[0].handlers.get("error")!();
        if (runtime === "Unknown CSS") {
            await expect(failed).rejects.toThrow("Unknown CSS error for");
            expect(warnings).toEqual(["Vite preload CSS helper changed; keeping native CSS preload behavior with resource prewarming."]);
            expect(links[0].removed).toBe(false);
            expect(imported).toBe(0);
            expect(events).toHaveLength(2);
            expect(events.every((event) => event.type === "vite:preloadError")).toBe(true);
            expect(warmed).toEqual(Array.from({ length: 2 }, () => ["https://assets.example/retry.css"]));
            return;
        }
        expect(warnings).toHaveLength(0);
        await expect(failed).rejects.toBeInstanceOf(PageResourceError);
        expect(links[0].removed).toBe(true);
        expect(Object.hasOwn(seen, "https://assets.example/retry.css")).toBe(false);
        expect(imported).toBe(0);
        expect(events).toHaveLength(2);
        expect(events.every((event) => event.type === "vite:preloadError")).toBe(true);
        const retried = preload(nativeImport, dependencies);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(links).toHaveLength(2);
        links[1].handlers.get("load")!();
        await retried;
        expect(imported).toBe(1);
        expect(warmed).toEqual(Array.from({ length: 3 }, () => ["https://assets.example/retry.css"]));
    });
}

test("Vite helper 的未知 CSS 或失败清理结构不作部分改写", () => {
    const source = installedVitePreloadHelper();
    const transform = resilientPreload().transform as Function;
    for (const changed of [
        source.replace("seen[href] = void 0;\n\t\tthrow err;", "seen[href] = true;\n\t\tthrow err;"),
        source.replace("Unable to preload CSS for", "Unknown CSS error for"),
        source.replace("if (isCss) return new Promise", "if (isCss) return anotherPromise"),
    ]) {
        expect(changed).not.toBe(source);
        const warnings: string[] = [];
        const result = transform.call({ warn: (message: string) => warnings.push(message) }, changed, "\0vite/preload-helper.js");
        expect(warnings).toHaveLength(1);
        const entry = "function preload(baseModule, deps, importerUrl) {";
        const warmedEntry =
            "async function preload(baseModule, deps, importerUrl) {\ntry {\nawait warmPreloadResources((deps || []).map(dep => new URL(assetsURL(dep, importerUrl), importerUrl || import.meta.url).href));\n} catch (error) { return handlePreloadError(error); }\n";
        expect(result.code).toBe('import { PageResourceError, warmPreloadResources } from "@/lib/module-preload";\n' + changed.replace(entry, warmedEntry));
    }
    expect(transform(source, "unrelated-module.js")).toBeUndefined();
});

test("Vite helper 的缺失或重复入口仍拒绝不安全注入", () => {
    const source = installedVitePreloadHelper();
    const transform = resilientPreload().transform as Function;
    for (const changed of [source.replace("function preload(baseModule", "function anotherPreload(baseModule"), source + source])
        expect(() => transform(changed, "\0vite/preload-helper.js")).toThrow("Vite preload helper changed; update the resource preload adapter");
});

for (const hasLoadListener of [false, true]) {
    test(`旧 Vite ${hasLoadListener ? "包含" : "省略"} load 监听时仍生成完整 CSS 重试分支`, () => {
        const source = [
            "function preload ( baseModule , deps , importerUrl ) {",
            "if ( dep in seen ) return;",
            "if ( isCss ) return new Promise ( ( res , rej ) => {",
            hasLoadListener ? "link.addEventListener('load',res);" : "",
            "link.addEventListener('error',()=>rej(Error(`Unable to preload CSS for ${dep}`)));",
            "} );",
            "}",
        ].join("\n");
        const warnings: string[] = [];
        const transform = resilientPreload().transform as Function;
        const result = transform.call({ warn: (message: string) => warnings.push(message) }, source, "\0vite/preload-helper.js");
        expect(warnings).toHaveLength(0);
        expect(result.code).toContain("if (dep in seen) return seen[dep] === true ? undefined : seen[dep];");
        expect(result.code).toContain("if (isCss) return (seen[dep] = new Promise");
        expect(result.code.match(/link\.addEventListener\("load", res\);/g)).toHaveLength(1);
        expect(result.code).toContain("delete seen[dep]; link.remove(); rej(new PageResourceError");
        expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(result.code)).not.toThrow();
    });
}
