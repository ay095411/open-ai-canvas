import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { ChannelOrderItem } from "@/services/api/channel-order";

// 在独立进程中先安装 DOM，再加载 ReactDOM，避免输入事件与全局 adapter 污染其它页面测试。
const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { ChannelOrderDialog } = await import("@/pages/admin/components/channel-order-dialog");

type DialogProps = ComponentProps<typeof ChannelOrderDialog>;
type SaveRequest = { ids: string[]; expectedIds: string[] };
type RequestRecord = { method: string; url: string; data?: SaveRequest };
const modelEndpoint = "/admin/channels/channel-a/models/order";
const channelEndpoint = "/admin/channels/order";
const requests: RequestRecord[] = [];
const originalAdapter = apiClient.defaults.adapter;
let serverItems: ChannelOrderItem[] = [];
let failSave = false;
let activeView: Awaited<ReturnType<typeof mount>> | undefined;

apiClient.defaults.adapter = async (config) => {
    if (config.url !== modelEndpoint && config.url !== channelEndpoint) throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    const data = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    requests.push({ method: config.method || "", url: config.url, ...(data ? { data } : {}) });
    if (config.method === "get") return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: structuredClone(serverItems) }, msg: "" } };
    if (config.method !== "put") throw new Error(`Unexpected method: ${config.method}`);
    if (failSave) return { config, status: 200, statusText: "OK", headers: {}, data: { code: 409, data: null, msg: "排序列表已更新，请重新打开", reason: "order_changed" } };
    serverItems = data.ids.map((id: string) => {
        const item = serverItems.find((entry) => entry.id === id);
        if (!item) throw new Error(`Unknown saved item: ${id}`);
        return item;
    });
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { saved: true }, msg: "" } };
};

function modelItems(): ChannelOrderItem[] {
    return [
        { id: "model-a", name: "视觉模型", enabled: true, modelKey: "vision-v1", providerModelKey: "upstream/vision-standard", capability: "image", protocol: "partner-image", channelLabel: "标准线路" },
        { id: "model-b", name: "视觉模型", enabled: true, modelKey: "vision-v2", providerModelKey: "upstream/vision-fast", capability: "image", protocol: "partner-image", channelLabel: "高速线路" },
        { id: "model-c", name: "动态镜头", enabled: false, modelKey: "motion-v3", providerModelKey: "upstream/motion", capability: "video", protocol: "partner-video" },
    ];
}

async function settle(ms = 30) {
    await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
}

async function mount(overrides: Partial<DialogProps> = {}) {
    const host = document.createElement("div");
    host.setAttribute("data-admin-root", "");
    document.body.append(host);
    const root = createRoot(host);
    const onSaved = mock(async () => {});
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <ChannelOrderDialog
                        channelId="channel-a"
                        channelName="主创作渠道"
                        protocols={[
                            { value: "partner-image", label: "合作方图片协议", capability: "image", create: "POST /images", contentType: "application/json", media: "image" },
                            { value: "partner-video", label: "合作方视频协议", capability: "video", create: "POST /videos", contentType: "application/json", media: "video" },
                        ]}
                        onSaved={onSaved}
                        {...overrides}
                    />
                </App>
            </ConfigProvider>,
        );
    });
    await settle();
    return {
        onSaved,
        unmount: async () => {
            await act(() => root.unmount());
            host.remove();
        },
    };
}

function button(text: string) {
    const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.replace(/\s+/g, "") === text.replace(/\s+/g, ""));
    expect(element, `Missing button: ${text}`).toBeDefined();
    return element!;
}

async function click(element: HTMLElement) {
    await act(async () => element.click());
    await settle();
}

async function open(channel = false) {
    await click(button(channel ? "设置排序" : "自定义排序"));
    expect(document.querySelector('[role="list"][aria-label="展示顺序"]')).not.toBeNull();
}

function row(id: string) {
    const element = [...document.querySelectorAll<HTMLElement>("[data-order-id]")].find((entry) => entry.dataset.orderId === id);
    expect(element, `Missing order row: ${id}`).toBeDefined();
    return element!;
}

function rowOrder() {
    return [...document.querySelectorAll<HTMLElement>('[role="list"][aria-label="展示顺序"] [data-order-id]')].map((element) => element.dataset.orderId);
}

function chooseButton(id: string) {
    const element = row(id).querySelector<HTMLButtonElement>("button[aria-pressed]");
    expect(element).not.toBeNull();
    return element!;
}

function rowArrow(id: string, direction: "上移" | "下移") {
    const element = [...row(id).querySelectorAll<HTMLButtonElement>("button[aria-label]")].find((entry) => entry.getAttribute("aria-label")?.startsWith(direction));
    expect(element).toBeDefined();
    return element!;
}

function selected(id: string, key: string, position: number) {
    expect(chooseButton(id).getAttribute("aria-pressed")).toBe("true");
    const selection = document.querySelector('[role="status"].admin-order-selection');
    expect(selection?.textContent).toContain(key);
    expect(selection?.textContent).toMatch(new RegExp(`第\\s*${position}\\s*位`));
}

async function inputValue(element: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    await settle();
}

beforeEach(() => {
    requests.length = 0;
    serverItems = modelItems();
    failSave = false;
});

afterEach(async () => {
    await activeView?.unmount();
    activeView = undefined;
});

afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("同展示名模型保留独立标识、上游、渠道展示名、能力和协议信息", async () => {
    activeView = await mount();
    await open();
    expect(requests).toEqual([{ method: "get", url: modelEndpoint }]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("主创作渠道");
    for (const [id, key, upstream, alias] of [
        ["model-a", "vision-v1", "upstream/vision-standard", "标准线路"],
        ["model-b", "vision-v2", "upstream/vision-fast", "高速线路"],
    ]) {
        const entry = row(id!);
        for (const value of ["视觉模型", key, upstream, alias, "图片", "合作方图片协议"]) expect(entry.textContent).toContain(value!);
        expect(chooseButton(id!).getAttribute("aria-label")).toContain(key!);
    }
    expect(row("model-c").textContent).toContain("已停用");
    expect(button("保存排序").disabled).toBe(true);
});

test("点击选择及上下移动保持选中身份，并更新当前位置和边界按钮", async () => {
    activeView = await mount();
    await open();
    await click(chooseButton("model-b"));
    selected("model-b", "vision-v2", 2);
    expect(chooseButton("model-a").getAttribute("aria-pressed")).toBe("false");
    const up = rowArrow("model-b", "上移");
    expect(up.tagName).toBe("BUTTON");
    expect(up.getAttribute("aria-label")).toContain("vision-v2");
    await click(up);
    expect(rowOrder()).toEqual(["model-b", "model-a", "model-c"]);
    selected("model-b", "vision-v2", 1);
    expect(rowArrow("model-b", "上移").disabled).toBe(true);
    await click(rowArrow("model-b", "下移"));
    selected("model-b", "vision-v2", 2);
    expect(rowOrder()).toEqual(["model-a", "model-b", "model-c"]);
});

test("按上游标识搜索下拉选项不会筛掉完整排序列表，选中后展示对应详情", async () => {
    activeView = await mount();
    await open();
    const search = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="选择要排序的模型"]');
    expect(search).not.toBeNull();
    await click(search!);
    await inputValue(search!, "upstream/vision-fast");
    const options = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")];
    expect(options.length).toBe(1);
    expect(options[0]!.textContent).toContain("vision-v2");
    expect(options[0]!.textContent).toContain("视觉模型");
    expect(rowOrder()).toEqual(["model-a", "model-b", "model-c"]);
    await click(options[0]!);
    selected("model-b", "vision-v2", 2);
});

test("输入目标位置保存完整 ID 快照，停用模型及其识别信息不丢失", async () => {
    activeView = await mount();
    await open();
    const original = structuredClone(serverItems);
    await click(chooseButton("model-c"));
    const position = document.querySelector<HTMLInputElement>('input[aria-label="目标位置"]');
    expect(position).not.toBeNull();
    await inputValue(position!, "1");
    await click(button("移动到此位置"));
    expect(rowOrder()).toEqual(["model-c", "model-a", "model-b"]);
    selected("model-c", "motion-v3", 1);
    expect(row("model-c").textContent).toContain("upstream/motion");
    expect(row("model-c").textContent).toContain("已停用");
    await click(button("保存排序"));
    expect(requests.filter((request) => request.method === "put")).toEqual([{ method: "put", url: modelEndpoint, data: { ids: ["model-c", "model-a", "model-b"], expectedIds: ["model-a", "model-b", "model-c"] } }]);
    expect(serverItems).toEqual([original[2]!, original[0]!, original[1]!]);
    expect(activeView.onSaved).toHaveBeenCalledTimes(1);
});

test("拖动指定模型后选中跟随到新位置，不误用同名模型", async () => {
    activeView = await mount();
    await open();
    const data = new Map<string, string>();
    const transfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) || "" };
    await act(async () => {
        const start = new dom.Event("dragstart", { bubbles: true, cancelable: true });
        Object.defineProperty(start, "dataTransfer", { value: transfer });
        row("model-b").dispatchEvent(start as unknown as Event);
        const drop = new dom.Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", { value: transfer });
        row("model-a").dispatchEvent(drop as unknown as Event);
    });
    await settle();
    expect(rowOrder()).toEqual(["model-b", "model-a", "model-c"]);
    selected("model-b", "vision-v2", 1);
});

test("取消不写入排序，重新打开读取服务端最新顺序与模型信息", async () => {
    activeView = await mount();
    await open();
    await click(rowArrow("model-b", "上移"));
    await click(button("取消"));
    expect(requests.filter((request) => request.method === "put")).toEqual([]);
    serverItems[0] = { ...serverItems[0]!, name: "新版视觉模型", providerModelKey: "upstream/vision-current" };
    await open();
    expect(rowOrder()).toEqual(["model-a", "model-b", "model-c"]);
    expect(row("model-a").textContent).toContain("新版视觉模型");
    expect(row("model-a").textContent).toContain("upstream/vision-current");
    expect(requests.filter((request) => request.method === "get")).toHaveLength(2);
    expect(button("保存排序").disabled).toBe(true);
});

test("保存业务失败保留草稿和选中信息，不误报成功或刷新列表", async () => {
    activeView = await mount();
    await open();
    await click(rowArrow("model-b", "上移"));
    failSave = true;
    await click(button("保存排序"));
    expect(activeView.onSaved).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(["model-b", "model-a", "model-c"]);
    selected("model-b", "vision-v2", 1);
    expect(button("保存排序").disabled).toBe(false);
    expect(document.body.textContent).toContain("排序列表已更新，请重新打开");
    expect(serverItems.map((item) => item.id)).toEqual(["model-a", "model-b", "model-c"]);
});

test("渠道排序继续使用渠道端点和完整快照，不显示模型专有字段", async () => {
    serverItems = [
        { id: "channel-a", name: "主渠道", enabled: true },
        { id: "channel-b", name: "备用渠道", enabled: false },
    ];
    activeView = await mount({ channelId: undefined, channelName: undefined });
    await open(true);
    expect(row("channel-a").textContent).toContain("主渠道");
    expect(row("channel-b").textContent).toContain("已停用");
    expect(row("channel-a").textContent).not.toContain("模型标识");
    await click(rowArrow("channel-b", "上移"));
    expect(rowOrder()).toEqual(["channel-b", "channel-a"]);
    await click(button("保存排序"));
    expect(requests).toEqual([
        { method: "get", url: channelEndpoint },
        { method: "put", url: channelEndpoint, data: { ids: ["channel-b", "channel-a"], expectedIds: ["channel-a", "channel-b"] } },
    ]);
    expect(activeView.onSaved).toHaveBeenCalledTimes(1);
});
