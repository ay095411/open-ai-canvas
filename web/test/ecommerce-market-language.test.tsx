import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    DOMParser: dom.DOMParser,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CommerceMarketPicker } = await import("@/pages/ecommerce/market-picker");

let host: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    host = undefined;
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onLanguage = mock((_value: string) => {});
    const onPlatform = mock((_value: string) => {});
    const onRegion = mock((_value: string) => {});
    const onClose = mock(() => {});
    const draw = async (language: string) => act(async () => root!.render(<CommerceMarketPicker platform="taobao" language={language} region="" onPlatform={onPlatform} onLanguage={onLanguage} onRegion={onRegion} onClose={onClose} />));
    await draw("zh-CN");
    return { onLanguage, draw };
}

const trigger = () => document.querySelector<HTMLButtonElement>(".commerce-language-trigger")!;
const options = () => document.querySelector(".commerce-language-options");
async function click(node: Element | null) {
    await act(async () => node?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true })));
}

test("语言选项挂在触发器锚点上，展开不挤进弹窗正文流", async () => {
    await render();
    expect(options()).toBe(null);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await click(trigger());
    const list = options()!;
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    // 选项列表必须是锚点的子节点：放在 .commerce-market-body 里会变成 grid 行，被压成一条缝。
    expect(list).not.toBe(null);
    expect(list.parentElement?.classList.contains("commerce-language-anchor")).toBe(true);
    expect(list.closest(".commerce-market-body")).not.toBe(null);
    expect(list.querySelectorAll("button").length).toBe(12);
    expect(list.querySelector('button[aria-selected="true"] strong')?.textContent).toBe("中文简体（推荐）");

    await click(trigger());
    expect(options()).toBe(null);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

test("选中语言后回传并收起，点击浮层外也会收起", async () => {
    const { onLanguage, draw } = await render();
    await click(trigger());
    await click([...options()!.querySelectorAll("button")].find((node) => node.querySelector("strong")?.textContent === "英文") ?? null);
    expect(onLanguage).toHaveBeenCalledTimes(1);
    expect(onLanguage.mock.calls[0][0]).toBe("en");
    expect(options()).toBe(null);

    await draw("en");
    expect(trigger().querySelector("strong")?.textContent).toBe("英文");
    await click(trigger());
    expect(options()).not.toBe(null);
    await act(async () => document.querySelector(".commerce-market-grid > button")!.dispatchEvent(new dom.Event("pointerdown", { bubbles: true })));
    expect(options()).toBe(null);
});

test("语言浮层是贴着触发器的绝对定位单列，尺寸由可用空间限制", () => {
    const css = readFileSync(new URL("../src/pages/ecommerce/market-picker.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf(".commerce-market .commerce-language-options {"), css.indexOf(".commerce-market .commerce-language-options button {"));
    expect(block).toContain("position: absolute");
    expect(block).toContain("max-height: var(--commerce-language-max");
    expect(block).toContain("overflow-y: auto");
    expect(block).not.toContain("grid-template-columns");
    // 翻到上方时必须换掉 top，否则会同时受 top/bottom 约束被拉伸。
    const up = css.slice(css.indexOf('.commerce-language-options[data-placement="up"]'));
    expect(up.slice(0, 160)).toContain("top: auto");
    expect(up.slice(0, 160)).toContain("bottom: calc(100% + 6px)");
    // 锚点必须能定位，否则浮层会跑到弹窗左上角。
    const anchor = css.slice(css.indexOf(".commerce-market-field--language,"));
    expect(anchor.slice(0, 120)).toContain("position: relative");
});
