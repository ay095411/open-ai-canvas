import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// workspace-shell-design.mdx：卡片、行、激活项不用装饰性强调条；
// Markdown 引用线表达内容层级，允许保留，也允许 1px 的栏间分隔线。
const root = resolve(import.meta.dir, "../src");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(css|tsx)$/.test(name) ? [path] : [];
    });
}

const stripePatterns: Array<[string, RegExp]> = [
    ["border-left 2px+", /border-(?:left|inline-start)(?:-width)?\s*:\s*(?:[2-9]|\d{2,})(?:\.\d+)?px/],
    ["inset left shadow", /inset\s+[1-9]\d*(?:\.\d+)?px\s+0(?:px)?\s+0/],
    ["tailwind border-l-N", /(?:^|[\s"'`:])border-[ls]-(?:[2-9]|\[)/],
    ["tailwind inset left shadow", /shadow-\[inset_[1-9]/],
];

function decorativeSource(source: string, css: boolean) {
    const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, "");
    if (!css) return uncommented.replace(/\[&_blockquote\]:border-l-\d+/g, "");
    return uncommented.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string) => (selector.split(",").every((part) => /(?:^|[\s>+~])(?:blockquote|\.ai-message-markdown-blockquote)\s*$/.test(part)) ? "" : rule));
}

test("引用线豁免不隐藏装饰卡片或引用内的其它控件", () => {
    const border = " { border-left: 3px solid red; }";
    for (const selector of [".blockquote-card", ".not-blockquote", "blockquote .badge", "blockquote, .card"]) {
        expect(decorativeSource(selector + border, true)).toMatch(stripePatterns[0][1]);
    }
    for (const selector of [".markdown blockquote", ".ai-message-markdown-blockquote"]) {
        expect(decorativeSource(selector + border, true)).not.toMatch(stripePatterns[0][1]);
    }
});

test("组件左侧不使用竖向强调条", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
        const rel = relative(root, file).replaceAll("\\", "/");
        const source = decorativeSource(readFileSync(file, "utf8"), file.endsWith(".css"));
        for (const [label, pattern] of stripePatterns) if (pattern.test(source)) offenders.push(`${rel}: ${label}`);
    }
    expect(offenders).toEqual([]);
});

test("用户工作台卡片 hover 只换表面，不位移", () => {
    const globals = readFileSync(resolve(root, "styles/globals.css"), "utf8");
    const product = readFileSync(resolve(root, "styles/workspace-product.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(globals).toContain("--library-hover-offset: 0px;");
    const cardHover = [...product.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /product-collection-card:hover|task-record-row:hover/.test(selector));
    expect(cardHover.length).toBeGreaterThan(0);
    for (const [, selector, body] of cardHover) if (!selector.includes("prefers-reduced-motion")) expect(body).not.toMatch(/translate(?:X|Y)?\(\s*-?[1-9]/);
});
