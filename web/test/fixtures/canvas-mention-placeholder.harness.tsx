import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasResourceReference } from "../../src/lib/canvas/canvas-resource-references";

// 独立进程里先安装 DOM，再加载 ReactDOM，避免输入事件和全局环境污染其它测试。
const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");
const { canvasResourceMentionToken } = await import("../../src/lib/canvas/canvas-resource-references");
const { getEditableSelection, serializeEditableValue, setEditableSelection } = await import("../../src/components/canvas/canvas-mention-editable");

const placeholder = "写下一瞬灵感，让故事从这里开始";
const reference: CanvasResourceReference = { id: "placeholder-image", nodeId: "placeholder-image", kind: "image", label: "图片1", active: true };
let currentView: Awaited<ReturnType<typeof mount>> | undefined;

async function settle() {
    await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
}

async function mount(initial: { value?: string; references?: CanvasResourceReference[] } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const writes: string[] = [];
    let value = initial.value ?? "";
    let references = initial.references ?? [reference];
    const render = () =>
        root.render(
            <CanvasResourceMentionTextarea
                value={value}
                references={references}
                placeholder={placeholder}
                animatedPlaceholder
                className="creation-chat-mention-editor"
                aria-label="测试创作提示词"
                onChange={(next) => {
                    writes.push(next);
                    value = next;
                    render();
                }}
            />,
        );
    await act(async () => render());
    return {
        host,
        writes,
        value: () => value,
        update: async (next: { value?: string; references?: CanvasResourceReference[] }) => {
            if (next.value !== undefined) value = next.value;
            if (next.references !== undefined) references = next.references;
            await act(async () => render());
        },
        unmount: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function richEditor() {
    const editor = currentView!.host.querySelector<HTMLElement>('[role="textbox"]');
    expect(editor).not.toBeNull();
    return editor!;
}

function overlays() {
    return currentView!.host.querySelectorAll<HTMLElement>(".creation-typing-placeholder");
}

async function focus(editor: HTMLElement) {
    await act(async () => editor.focus());
}

function expectEmptyPlaceholder(editor: HTMLElement) {
    expect(currentView!.value()).toBe("");
    expect(serializeEditableValue(editor)).toBe("");
    expect(editor.hasAttribute("data-placeholder")).toBe(false);
    expect(editor.textContent).not.toContain(placeholder);
    expect(overlays()).toHaveLength(1);
    const overlay = overlays()[0]!;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.classList.contains("absolute")).toBe(true);
    expect(overlay.parentElement).toBe(editor.parentElement);
    expect(overlay.textContent).toBe(placeholder);
}

async function typeRich(text: string) {
    const editor = richEditor();
    await act(async () => {
        editor.replaceChildren(document.createTextNode(text));
        setEditableSelection(editor, text.length);
        editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    });
}

async function typePlain(text: string) {
    const editor = currentView!.host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, text);
        editor.setSelectionRange(text.length, text.length);
        editor.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

afterEach(async () => {
    await currentView?.unmount();
    currentView = undefined;
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("富文本初始空值只显示装饰占位层，不启用行内占位", async () => {
    currentView = await mount();
    const editor = richEditor();
    await focus(editor);
    expectEmptyPlaceholder(editor);
    expect(currentView.writes).toEqual([]);
});

for (const markup of ["<br>", "<div><br></div>", "<p><br></p>", "<div></div>", "<p></p>"]) {
    test(`输入后删空留下 ${markup} 时回到空值及首行光标`, async () => {
        currentView = await mount();
        const editor = richEditor();
        await focus(editor);
        await typeRich("镜头缓缓推进");
        expect(currentView.value()).toBe("镜头缓缓推进");
        expect(overlays()).toHaveLength(0);
        await act(async () => {
            editor.innerHTML = markup;
            setEditableSelection(editor, 0);
            editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        });
        expect(currentView.writes.at(-1)).toBe("");
        expect(editor.childNodes).toHaveLength(0);
        expect(getEditableSelection(editor)).toEqual({ start: 0, end: 0 });
        expect(document.activeElement).toBe(editor);
        expectEmptyPlaceholder(editor);
        await typeRich("新的镜头");
        expect(currentView.value()).toBe("新的镜头");
        expect(overlays()).toHaveLength(0);
        expect(editor.hasAttribute("data-placeholder")).toBe(false);
    });
}

test("普通 textarea 与引用编辑器互换时保留受控文本及空值占位", async () => {
    currentView = await mount({ references: [] });
    await focus(currentView.host.querySelector("textarea")!);
    expect(overlays()).toHaveLength(1);
    await typePlain("保留正文");
    expect(currentView.value()).toBe("保留正文");
    await currentView.update({ references: [reference] });
    expect(currentView.host.querySelector("textarea")).toBeNull();
    const editor = richEditor();
    expect(serializeEditableValue(editor)).toBe("保留正文");
    await focus(editor);
    await typeRich("");
    expectEmptyPlaceholder(editor);
    await currentView.update({ references: [] });
    const textarea = currentView.host.querySelector<HTMLTextAreaElement>("textarea")!;
    await focus(textarea);
    expect(textarea.value).toBe("");
    expect(currentView.host.querySelector('[role="textbox"]')).toBeNull();
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0]!.textContent).toBe(placeholder);
    await typePlain("重新输入");
    expect(currentView.value()).toBe("重新输入");
    expect(overlays()).toHaveLength(0);
});

test("IME 组合期间不显示占位、不重写 DOM，提交及取消组合后正确恢复", async () => {
    currentView = await mount();
    const editor = richEditor();
    await focus(editor);
    await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true })));
    expect(overlays()).toHaveLength(0);
    expect(editor.hasAttribute("data-placeholder")).toBe(false);
    await act(async () => {
        editor.textContent = "中文";
        setEditableSelection(editor, 2);
        editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "中文", isComposing: true }));
    });
    expect(currentView.writes).toEqual([]);
    expect(editor.textContent).toBe("中文");
    await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionend", { bubbles: true, data: "中文" })));
    expect(currentView.value()).toBe("中文");
    expect(getEditableSelection(editor)).toEqual({ start: 2, end: 2 });
    await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionstart", { bubbles: true })));
    await act(async () => {
        editor.innerHTML = "<br>";
        setEditableSelection(editor, 0);
        editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "deleteCompositionText", isComposing: true }));
    });
    expect(editor.innerHTML).toBe("<br>");
    expect(currentView.value()).toBe("中文");
    expect(overlays()).toHaveLength(0);
    await act(async () => editor.dispatchEvent(new dom.CompositionEvent("compositionend", { bubbles: true, data: "" })));
    expect(editor.childNodes).toHaveLength(0);
    expectEmptyPlaceholder(editor);
});

test("只有引用胶囊时保留行内提示，粘贴正文保留胶囊和选区", async () => {
    const tokens = `${canvasResourceMentionToken(reference)} `;
    currentView = await mount({ value: tokens });
    const editor = richEditor();
    await focus(editor);
    expect(editor.dataset.placeholder).toBe(placeholder);
    expect(overlays()).toHaveLength(0);
    expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(1);
    expect(serializeEditableValue(editor)).toBe(tokens);
    const body = "第一行\n第二行";
    await act(async () => {
        setEditableSelection(editor, tokens.length);
        const paste = new dom.Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(paste, "clipboardData", { value: { getData: () => body } });
        editor.dispatchEvent(paste);
    });
    await settle();
    expect(currentView.value()).toBe(tokens + body);
    expect(serializeEditableValue(editor)).toBe(tokens + body);
    expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(1);
    expect(getEditableSelection(editor)).toEqual({ start: tokens.length + body.length, end: tokens.length + body.length });
    expect(editor.hasAttribute("data-placeholder")).toBe(false);
    expect(overlays()).toHaveLength(0);
    expect(currentView.writes.some((value) => value.includes(placeholder))).toBe(false);
});

test("实际输入的空格和 Enter 换行保持原值，不冒充空态", async () => {
    currentView = await mount();
    const editor = richEditor();
    await focus(editor);
    await typeRich(" ");
    expect(currentView.value()).toBe(" ");
    expect(overlays()).toHaveLength(0);
    expect(editor.hasAttribute("data-placeholder")).toBe(false);
    await currentView.update({ value: "" });
    await act(async () => {
        setEditableSelection(editor, 0);
        editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    expect(currentView.value()).toBe("\n");
    expect(serializeEditableValue(editor)).toBe("\n");
    await act(async () => editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, inputType: "insertLineBreak" })));
    expect(currentView.value()).toBe("\n");
    expect(overlays()).toHaveLength(0);
    expect(editor.hasAttribute("data-placeholder")).toBe(false);
});
