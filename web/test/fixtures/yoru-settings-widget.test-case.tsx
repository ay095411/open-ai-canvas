import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { AdminYoruSettings } from "@/services/api/yoru";
import type { AdminLogicalModel, PublicChannelCatalog } from "@/services/api/logical-models";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __APP_VERSION__: "0.0.0-test",
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { useUserStore, defaultFeatureAvailability } = await import("@/stores/use-user-store");
const { default: YoruSettingsPage } = await import("@/pages/admin/settings/yoru-settings-page");
const { YoruWidget } = await import("@/components/layout/yoru-widget");
const { YORU_SETTINGS_CHANNEL, YORU_SETTINGS_CHANGED, notifyYoruSettingsChanged } = await import("@/lib/yoru-events");
const originalAdapter = apiClient.defaults.adapter;
const originalUser = useUserStore.getState();
const saved: AdminYoruSettings[] = [];
const publicRequests: Array<{ signal: AbortSignal; resolve?: () => void }> = [];
let setting: AdminYoruSettings;
let channels: PublicChannelCatalog[];
let logicalModels: AdminLogicalModel[];
let failConfig = false;
let notifications = 0;
let deferPublic = false;
let deferSave = false;
let resolveSave: (() => void) | undefined;
let pendingChat: { signal: AbortSignal; resolve: () => void } | undefined;
let unmount: (() => Promise<void>) | undefined;
window.addEventListener(YORU_SETTINGS_CHANGED, () => {
    notifications += 1;
});

apiClient.defaults.adapter = async (config) => {
    let data: unknown;
    if (config.url === "/admin/settings/yoru") {
        if (failConfig) throw new Error("小夜配置读取失败");
        if (config.method === "put") {
            setting = JSON.parse(String(config.data));
            saved.push(setting);
            if (deferSave)
                await new Promise<void>((resolve) => {
                    resolveSave = resolve;
                });
        }
        data = { ...setting };
    } else if (config.url === "/admin/settings/features") data = { features: useUserStore.getState().features };
    else if (config.url === "/model-catalog") data = { source: "system", channels };
    else if (config.url === "/admin/logical-models") data = { models: logicalModels };
    else if (config.url === "/public/yoru") {
        data = { ...setting };
        const request: (typeof publicRequests)[number] = { signal: config.signal as AbortSignal };
        publicRequests.push(request);
        if (deferPublic)
            await new Promise<void>((resolve) => {
                request.resolve = resolve;
            });
    } else if (config.url === "/yoru/messages") {
        await new Promise<void>((resolve) => {
            pendingChat = { signal: config.signal as AbortSignal, resolve };
        });
        data = { id: "chat-task", status: "succeeded", resultJson: JSON.stringify({ text: "迟到的回复" }) };
    } else throw new Error(`Unexpected request: ${config.url}`);
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
};

async function settle() {
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
}
async function mount(child: ReactNode, route = "/admin/settings/yoru") {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <MemoryRouter initialEntries={[route]}>
                        {child}
                        <CurrentLocation />
                    </MemoryRouter>
                </App>
            </ConfigProvider>,
        ),
    );
    unmount = async () => {
        await act(() => root.unmount());
        host.remove();
    };
    await settle();
}
function CurrentLocation() {
    return <output data-yoru-route>{useLocation().pathname}</output>;
}
function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
    expect(found, label).toBeDefined();
    return found!;
}
async function click(label: string) {
    await act(async () => button(label).click());
    await settle();
}
async function input(label: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
}
async function features(patch: Partial<typeof defaultFeatureAvailability>) {
    await act(async () => useUserStore.getState().setFeatures({ ...useUserStore.getState().features, ...patch }));
    await settle();
}
async function openChat() {
    await act(async () => button("打开小夜对话").dispatchEvent(new dom.PointerEvent("pointerup", { bubbles: true }) as unknown as Event));
    await settle();
}

beforeEach(() => {
    setting = {
        enabled: false,
        audience: "admin",
        name: "小夜",
        welcome: "欢迎创作",
        modelMode: "direct",
        channelModelId: "",
        logicalModelId: "",
        systemPrompt: "帮助创作",
        knowledge: "创作影棚 /toolbox；电商Agent /ecommerce",
        questions: ["怎么生成图片？"],
        navigation: ["创作影棚", "电商Agent"],
        dailyCalls: 0,
        maxDailyMicrocredits: 0,
        maxChargeMicrocredits: 0,
        maxOutputTokens: 1024,
        allowGuests: false,
        saveHistory: false,
        voiceEnabled: false,
        motionEnabled: false,
        avatarSize: 180,
        defaultRight: 16,
        defaultBottom: 24,
    };
    channels = [
        {
            id: "channel",
            name: "文本渠道",
            displayName: "文本渠道",
            models: [
                {
                    id: "text-model",
                    modelKey: "gpt-text",
                    displayName: "测试文本模型",
                    icon: "",
                    capability: "text",
                    priceTiers: [{ id: "tier", resolution: "*", videoSeconds: 0, billingMode: "fixed_request", unitPriceMicrocredits: 100, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
                    pricingMode: "channel",
                    priceLabel: "0.0001 积分/次",
                    available: true,
                },
            ],
        },
    ];
    saved.length = 0;
    logicalModels = [];
    publicRequests.length = 0;
    failConfig = false;
    notifications = 0;
    deferPublic = false;
    deferSave = false;
    resolveSave = undefined;
    pendingChat = undefined;
    localStorage.clear();
    useUserStore.setState({ user: { id: "yoru-admin", username: "admin", displayName: "Admin", role: "admin", status: "active" }, features: { ...defaultFeatureAvailability, siteAssistantEnabled: true, creditsEnabled: true }, hydrated: true });
});
afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    pendingChat?.resolve();
    resolveSave?.();
    publicRequests.forEach((request) => request.resolve?.());
    await settle();
});
afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState(originalUser);
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("管理页不自动选择模型，缺模型不能启用，关闭配置仍可保存", async () => {
    await mount(<YoruSettingsPage />);
    expect(button("启用小夜助手").disabled).toBe(true);
    expect(button("选择小夜文本模型").textContent).toContain("选择小夜文本模型");
    await input("小夜角色名称", "创作小夜");
    await click("保存设置");
    expect(saved).toHaveLength(1);
    expect(saved[0].channelModelId).toBe("");
    expect(saved[0].enabled).toBe(false);
    expect(notifications).toBe(1);
});

test("管理页通过真实模型选择器启用并保存，明确提示积分依赖", async () => {
    useUserStore.setState({ features: { ...useUserStore.getState().features, creditsEnabled: false } });
    await mount(<YoruSettingsPage />);
    expect(document.body.textContent).toContain("积分计费：未开启");
    expect(document.querySelector('a[href="/admin/settings/features"]')).not.toBeNull();
    await click("选择小夜文本模型");
    const brand = document.querySelector<HTMLButtonElement>(".canvas-model-picker-brand");
    if (brand) {
        await act(async () => brand.click());
        await settle();
    }
    const option = document.querySelector<HTMLButtonElement>('.canvas-model-picker-option[role="option"]');
    expect(option).not.toBeNull();
    await act(async () => option!.click());
    await settle();
    await click("启用小夜助手");
    await click("保存设置");
    expect(saved).toHaveLength(1);
    expect(saved[0].channelModelId).toBe("text-model");
    expect(saved[0].enabled).toBe(true);
    expect(saved[0].navigation).toEqual(["创作影棚", "电商Agent"]);
    expect(document.body.textContent).toContain("尚未满足开放条件");
});

test("停用模型不被清空，管理员仍能关闭已经启用的小夜", async () => {
    setting.enabled = true;
    setting.channelModelId = "removed-model";
    await mount(<YoruSettingsPage />);
    expect(document.body.textContent).toContain("已保存的文本模型当前不可用");
    await click("启用小夜助手");
    await click("保存设置");
    expect(saved[0].enabled).toBe(false);
    expect(saved[0].channelModelId).toBe("removed-model");
});

test("配置读取失败显示错误且不能保存伪造默认值", async () => {
    failConfig = true;
    await mount(<YoruSettingsPage />);
    expect(document.body.textContent).toContain("读取小夜配置失败");
    expect(document.querySelector('input[aria-label="小夜角色名称"]')).toBeNull();
    expect(button("保存设置").disabled).toBe(true);
    expect(saved).toHaveLength(0);
});

test("慢保存期间同步拦截重复提交、输入和已打开的模型弹层选择", async () => {
    deferSave = true;
    await mount(<YoruSettingsPage />);
    await input("小夜角色名称", "准备保存的小夜");
    await click("选择小夜文本模型");
    const brand = document.querySelector<HTMLButtonElement>(".canvas-model-picker-brand");
    if (brand) {
        await act(async () => brand.click());
        await settle();
    }
    const option = document.querySelector<HTMLButtonElement>('.canvas-model-picker-option[role="option"]');
    expect(option).not.toBeNull();
    const saveButton = button("保存设置");
    await act(async () => {
        saveButton.click();
        option!.click();
        saveButton.click();
    });
    await settle();
    expect(saved).toHaveLength(1);
    expect(resolveSave).toBeDefined();
    expect(saved[0].channelModelId).toBe("");
    expect(button("选择小夜文本模型").textContent).toContain("选择小夜文本模型");
    await input("小夜角色名称", "保存中不应接受的修改");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="小夜角色名称"]')!.value).toBe("准备保存的小夜");
    await act(async () => resolveSave!());
    await settle();
    expect(saved[0].name).toBe("准备保存的小夜");
    expect(button("保存设置").disabled).toBe(true);
    await input("小夜角色名称", "保存完成后的修改");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="小夜角色名称"]')!.value).toBe("保存完成后的修改");
    expect(button("保存设置").disabled).toBe(false);
});

test("保存已有智能路由配置不会切换为直连或丢失逻辑模型", async () => {
    setting.modelMode = "smart_route";
    setting.logicalModelId = "logical-text";
    setting.enabled = true;
    logicalModels = [{ id: "logical-text", code: "yoru-text", name: "小夜文本路由", capability: "text", enabled: true, available: true } as AdminLogicalModel];
    await mount(<YoruSettingsPage />);
    expect(document.body.textContent).toContain("文本模型已就绪");
    await input("小夜角色名称", "路由小夜");
    await click("保存设置");
    expect(saved[0].modelMode).toBe("smart_route");
    expect(saved[0].logicalModelId).toBe("logical-text");
    expect(saved[0].channelModelId).toBe("");
});

test("功能和积分开关变化会重新读取配置，关闭期间不请求", async () => {
    setting.enabled = true;
    useUserStore.setState({ features: { ...useUserStore.getState().features, siteAssistantEnabled: false } });
    await mount(<YoruWidget />, "/create");
    expect(publicRequests).toHaveLength(0);
    await features({ siteAssistantEnabled: true });
    expect(publicRequests).toHaveLength(1);
    await openChat();
    await input("发送给小夜", "尚未发送的草稿");
    await features({ creditsEnabled: false });
    expect(document.querySelector(".yoru-root")).toBeNull();
    expect(publicRequests).toHaveLength(1);
    await features({ creditsEnabled: true });
    expect(publicRequests).toHaveLength(2);
    expect(document.querySelector(".yoru-panel")).toBeNull();
    await openChat();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="发送给小夜"]')!.value).toBe("");
    expect(document.querySelector(".yoru-navigation")?.textContent || document.body.textContent).toContain("创作影棚");
});

test("开关关闭会取消配置请求，迟到响应不能覆盖新配置", async () => {
    setting.enabled = true;
    deferPublic = true;
    await mount(<YoruWidget />, "/create");
    await features({ siteAssistantEnabled: false });
    expect(publicRequests[0].signal.aborted).toBe(true);
    setting = { ...setting, name: "新小夜" };
    await features({ siteAssistantEnabled: true });
    await act(async () => publicRequests[1].resolve?.());
    await settle();
    await act(async () => publicRequests[0].resolve?.());
    await settle();
    await openChat();
    expect(document.querySelector(".yoru-header-identity strong")?.textContent).toBe("新小夜");
});

test("小夜分别导航到独立创作影棚和电商Agent", async () => {
    setting.enabled = true;
    await mount(<YoruWidget />, "/create");
    await openChat();
    await click("电商Agent");
    expect(document.querySelector("[data-yoru-route]")?.textContent).toBe("/ecommerce");
    await openChat();
    await click("创作影棚");
    expect(document.querySelector("[data-yoru-route]")?.textContent).toBe("/toolbox");
});

test("关闭积分会取消正在发送的聊天，并清除会话和迟到回复", async () => {
    setting.enabled = true;
    await mount(<YoruWidget />, "/create");
    await openChat();
    await click("怎么生成图片？");
    expect(pendingChat).toBeDefined();
    await features({ creditsEnabled: false });
    expect(pendingChat!.signal.aborted).toBe(true);
    await act(async () => pendingChat!.resolve());
    await settle();
    await features({ creditsEnabled: true });
    await openChat();
    expect(document.querySelectorAll(".yoru-bubble")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("迟到的回复");
});

test("相同配置的焦点刷新保留聊天，其他标签关闭小夜后取消正在发送的请求", async () => {
    setting.enabled = true;
    await mount(<YoruWidget />, "/create");
    await openChat();
    await click("怎么生成图片？");
    await act(async () => window.dispatchEvent(new dom.Event("focus") as unknown as Event));
    await settle();
    expect(publicRequests).toHaveLength(2);
    expect(pendingChat!.signal.aborted).toBe(false);
    expect(document.querySelectorAll(".yoru-bubble")).toHaveLength(2);
    setting = { ...setting, enabled: false };
    const channel = new BroadcastChannel(YORU_SETTINGS_CHANNEL);
    try {
        await act(async () => {
            channel.postMessage("changed");
            await new Promise((resolve) => setTimeout(resolve, 40));
        });
        await settle();
        expect(pendingChat!.signal.aborted).toBe(true);
        expect(document.querySelector(".yoru-root")).toBeNull();
    } finally {
        channel.close();
    }
});

test("自身启用配置在功能开关不变时也能通过保存通知和可见性恢复生效", async () => {
    await mount(<YoruWidget />, "/create");
    expect(document.querySelector(".yoru-root")).toBeNull();
    setting = { ...setting, enabled: true };
    await act(async () => notifyYoruSettingsChanged());
    await settle();
    expect(document.querySelector(".yoru-root")).not.toBeNull();
    const requestsBeforeHidden = publicRequests.length;
    const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    try {
        setting = { ...setting, enabled: false };
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        await act(async () => document.dispatchEvent(new dom.Event("visibilitychange") as unknown as Event));
        await settle();
        expect(publicRequests).toHaveLength(requestsBeforeHidden);
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        await act(async () => document.dispatchEvent(new dom.Event("visibilitychange") as unknown as Event));
        await settle();
        expect(publicRequests).toHaveLength(requestsBeforeHidden + 1);
        expect(document.querySelector(".yoru-root")).toBeNull();
    } finally {
        if (descriptor) Object.defineProperty(document, "visibilityState", descriptor);
        else Reflect.deleteProperty(document, "visibilityState");
    }
});

test("浏览器拒绝跨标签通道时保存仍成功，助手继续使用焦点刷新", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
    Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        value: class {
            constructor() {
                throw new Error("当前浏览器禁用跨标签通道");
            }
        },
    });
    try {
        await mount(<YoruSettingsPage />);
        await input("小夜角色名称", "已保存的小夜");
        await click("保存设置");
        expect(saved).toHaveLength(1);
        expect(document.body.textContent).toContain("小夜助手配置已保存");
        await unmount?.();
        unmount = undefined;
        setting.enabled = true;
        await mount(<YoruWidget />, "/create");
        expect(document.querySelector(".yoru-root")).not.toBeNull();
        setting = { ...setting, enabled: false };
        await act(async () => window.dispatchEvent(new dom.Event("focus") as unknown as Event));
        await settle();
        expect(document.querySelector(".yoru-root")).toBeNull();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "BroadcastChannel", descriptor);
        else Reflect.deleteProperty(globalThis, "BroadcastChannel");
    }
});
