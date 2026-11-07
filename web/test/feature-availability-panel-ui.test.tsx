import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { FeatureAvailability, FeatureAvailabilityKey } from "@/stores/use-user-store";
import type { CommerceAgentSetting } from "@/services/api/ecommerce-knowledge";

const dom = new Window({ url: "http://localhost/admin/settings/features" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    MouseEvent: dom.MouseEvent,
    BroadcastChannel: class {
        onmessage: (() => void) | null = null;
        postMessage() {}
        close() {}
    },
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __APP_VERSION__: "test",
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { MemoryRouter, useLocation } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { defaultFeatureAvailability, useUserStore } = await import("@/stores/use-user-store");
const { default: FeatureAvailabilityPanel } = await import("@/pages/admin/components/feature-availability-panel");
const { default: EcommerceAgentConfigPage } = await import("@/pages/admin/ecommerce-agent-config-page");
const stageModels = await import("@/pages/admin/ecommerce-stage-models");
const { useFeatureAvailabilitySync } = await import("@/hooks/use-feature-availability-sync");
const originalAdapter = apiClient.defaults.adapter;
const originalFeatures = useUserStore.getState().features;
const originalHydrated = useUserStore.getState().hydrated;
const requests: { url: string; method: string; body: unknown }[] = [];
let serverFeatures: FeatureAvailability;
let serverAgentSetting: CommerceAgentSetting;
let view: Awaited<ReturnType<typeof mount>> | undefined;

beforeEach(() => {
    useUserStore.setState({ hydrated: true });
    requests.length = 0;
    serverFeatures = { ...defaultFeatureAvailability, ecommerceEnabled: false, imageWorkbenchEnabled: true, siteAssistantEnabled: true, configured: true };
    serverAgentSetting = { logicalModelId: "planning-model", vision: { logicalModelId: "vision-model" } };
    apiClient.defaults.adapter = async (config) => {
        const request = { url: config.url || "", method: config.method || "get", body: config.data ? JSON.parse(String(config.data)) : undefined };
        requests.push(request);
        let data: unknown;
        if (request.url === "/admin/settings/features" || request.url === "/features") {
            if (request.method === "patch") serverFeatures = { ...serverFeatures, ...(request.body as Partial<FeatureAvailability>) };
            else if (request.method !== "get") throw new Error(`Unexpected features method: ${request.method}`);
            data = { features: { ...serverFeatures } };
        } else if (request.url === "/admin/settings/inspiration-feed" && request.method === "get") {
            data = { status: { enabled: false, intervalHours: 6, sources: [], total: 3, bySource: {} } };
        } else if (request.url === "/ecommerce/agent-setting" && request.method === "get") {
            data = serverAgentSetting;
        } else throw new Error(`Unexpected request: ${request.method} ${request.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState({ features: originalFeatures, hydrated: originalHydrated });
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function settle() {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}

async function mount(page: "features" | "ecommerce" = "features") {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    function Location() {
        useFeatureAvailabilitySync();
        return <output data-current-route>{useLocation().pathname}</output>;
    }
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App message={{ duration: 0 }}>
                    <MemoryRouter initialEntries={[page === "ecommerce" ? "/admin/ecommerce/agent" : "/admin/settings/features"]}>
                        <QueryClientProvider client={client}>
                            {page === "ecommerce" ? <EcommerceAgentConfigPage /> : <FeatureAvailabilityPanel />}
                            <Location />
                        </QueryClientProvider>
                    </MemoryRouter>
                </App>
            </ConfigProvider>,
        );
    });
    await settle();
    return {
        host,
        async dispose() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

function row(key: FeatureAvailabilityKey) {
    const element = view!.host.querySelector<HTMLElement>(`#admin-feature-${key}`);
    expect(element).not.toBeNull();
    return element!;
}

test("feature sync survives unavailable cross-tab transport and still refreshes on focus", async () => {
    const previous = globalThis.BroadcastChannel;
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(globalThis, "BroadcastChannel", {
        configurable: true,
        writable: true,
        value: class {
            constructor() {
                throw new Error("transport blocked");
            }
        },
    });
    try {
        view = await mount();
        expect(view.host.textContent).toContain("创作功能");
        expect(warning).toHaveBeenCalled();
        serverFeatures = { ...serverFeatures, ecommerceEnabled: true };
        await act(async () => window.dispatchEvent(new dom.Event("focus")));
        expect(requests.filter((request) => request.url === "/features")).toHaveLength(1);
        expect(useUserStore.getState().features.ecommerceEnabled).toBe(true);
    } finally {
        Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, writable: true, value: previous });
        warning.mockRestore();
    }
});

function toggle(key: FeatureAvailabilityKey) {
    const button = row(key).querySelector<HTMLButtonElement>('[role="switch"]');
    expect(button).not.toBeNull();
    return button!;
}

function writes() {
    return requests.filter((request) => request.method === "patch");
}

function dialogButton(text: string) {
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const button = Array.from(dialog!.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.replace(/\s/g, "") === text);
    expect(button).toBeDefined();
    return button!;
}

test("the panel exposes both studio switches independently and only collapses ecommerce video admission", async () => {
    view = await mount();
    expect(Array.from(view.host.querySelectorAll(".afp-group-header h2"), (item) => item.textContent)).toEqual(["创作功能", "插件与记录", "模型与计费", "页面辅助"]);
    const image = toggle("imageWorkbenchEnabled");
    expect(image.disabled).toBe(false);
    expect(image.getAttribute("aria-checked")).toBe("true");
    expect(row("imageWorkbenchEnabled").textContent).not.toContain("依赖未满足");
    expect(toggle("videoWorkbenchEnabled").disabled).toBe(false);
    expect(row("imageWorkbenchEnabled").classList.contains("is-nested")).toBe(false);
    expect(row("videoWorkbenchEnabled").classList.contains("is-nested")).toBe(false);
    expect(writes()).toEqual([]);
    const details = view.host.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("其他任务控制");
    expect(row("videoWorkbenchEnabled").closest("details")).toBeNull();
    expect(row("ecommerceVideoEnabled").closest("details")).toBe(details);
    expect(Array.from(details.querySelectorAll("article"))).toHaveLength(1);
    expect(row("ecommerceVideoEnabled").textContent).toContain("与影棚视频开关无关");
    expect(toggle("ecommerceVideoEnabled").disabled).toBe(true);
    expect(view.host.textContent).toContain("创作影棚与电商Agent是独立入口");
    expect(view.host.textContent).not.toContain("已下线");
    expect(view.host.querySelector("#admin-feature-inspirationFeed")?.textContent).toContain("已收录 3 条");
    expect(requests.some((request) => request.url === "/admin/settings/inspiration-feed")).toBe(true);
});

test("studio tabs can toggle while ecommerce is off and each write only updates its own switch", async () => {
    view = await mount();
    await act(async () => toggle("imageWorkbenchEnabled").click());
    await settle();
    expect(serverFeatures.ecommerceEnabled).toBe(false);
    expect(writes().map((request) => request.body)).toEqual([{ imageWorkbenchEnabled: false }]);
    await act(async () => toggle("videoWorkbenchEnabled").click());
    await settle();
    expect(serverFeatures.ecommerceEnabled).toBe(false);
    expect(writes().map((request) => request.body)).toEqual([{ imageWorkbenchEnabled: false }, { videoWorkbenchEnabled: true }]);
    await act(async () => toggle("ecommerceEnabled").click());
    await settle();
    expect(writes().map((request) => request.body)).toEqual([{ imageWorkbenchEnabled: false }, { videoWorkbenchEnabled: true }, { ecommerceEnabled: true }]);
    expect(toggle("imageWorkbenchEnabled").getAttribute("aria-checked")).toBe("false");
    expect(toggle("videoWorkbenchEnabled").getAttribute("aria-checked")).toBe("true");
    expect(serverFeatures.ecommerceEnabled).toBe(true);
});

test("ecommerce video can toggle with both studio switches off and only requires ecommerce", async () => {
    serverFeatures = { ...serverFeatures, ecommerceEnabled: true, imageWorkbenchEnabled: false, videoWorkbenchEnabled: false, ecommerceVideoEnabled: false };
    view = await mount();
    expect(toggle("ecommerceVideoEnabled").disabled).toBe(false);
    await act(async () => toggle("ecommerceVideoEnabled").click());
    await settle();
    expect(writes().map((request) => request.body)).toEqual([{ ecommerceVideoEnabled: true }]);
    expect(serverFeatures.imageWorkbenchEnabled).toBe(false);
    expect(serverFeatures.videoWorkbenchEnabled).toBe(false);
    await act(async () => toggle("ecommerceEnabled").click());
    await settle();
    expect(toggle("ecommerceVideoEnabled").disabled).toBe(true);
    expect(row("ecommerceVideoEnabled").textContent).toContain("需先开启电商Agent");
    expect(serverFeatures.ecommerceVideoEnabled).toBe(true);
});

test("ecommerce readiness is complete when studio is closed and product models are configured", async () => {
    serverFeatures = { ...serverFeatures, ecommerceEnabled: true, imageWorkbenchEnabled: false, videoWorkbenchEnabled: false };
    const stage = spyOn(stageModels, "EcommerceStageModels").mockImplementation(() => <div>阶段模型表单</div>);
    try {
        view = await mount("ecommerce");
        expect(view.host.querySelectorAll(".eac-availability > li")).toHaveLength(2);
        expect(view.host.textContent).toContain("配置已齐备");
        expect(view.host.querySelectorAll(".eac-availability .admin-status-badge")).toHaveLength(2);
        expect(view.host.querySelector(".eac-availability")?.textContent).not.toContain("影棚图片生成");
        expect(writes()).toEqual([]);
    } finally {
        stage.mockRestore();
    }
});

test("ecommerce readiness still requires its switch and real stage model configuration", async () => {
    serverFeatures = { ...serverFeatures, ecommerceEnabled: false, imageWorkbenchEnabled: true, videoWorkbenchEnabled: true };
    serverAgentSetting = { logicalModelId: "" };
    const stage = spyOn(stageModels, "EcommerceStageModels").mockImplementation(() => <div>阶段模型表单</div>);
    try {
        view = await mount("ecommerce");
        expect(view.host.textContent).toContain("还差 2 项");
        expect(view.host.querySelector(".eac-availability")?.textContent).toContain("请配置商品识别与整套策划模型");
        const go = Array.from(view.host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("去功能开放"));
        expect(go).toBeDefined();
        await act(async () => go!.click());
        expect(view.host.querySelector("[data-current-route]")?.textContent).toBe("/admin/settings/features");
        expect(writes()).toEqual([]);
    } finally {
        stage.mockRestore();
    }
});

test("the assistant configuration link uses the dedicated settings route", async () => {
    view = await mount();
    const link = row("siteAssistantEnabled").querySelector<HTMLAnchorElement>("a");
    expect(link?.textContent).toBe("配置小夜助手");
    expect(link?.getAttribute("href")).toBe("/admin/settings/yoru");
    await act(async () => link!.click());
    expect(view.host.querySelector("[data-current-route]")?.textContent).toBe("/admin/settings/yoru");
    expect(writes()).toEqual([]);
});

test("disabling credits requires the actual confirmation modal before saving", async () => {
    view = await mount();
    await act(async () => toggle("creditsEnabled").click());
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("关闭用户积分功能？");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("小夜助手也将不可用");
    expect(writes()).toEqual([]);
    expect(toggle("creditsEnabled").getAttribute("aria-checked")).toBe("true");
    await act(async () => dialogButton("取消").click());
    await settle();
    expect(writes()).toEqual([]);
    expect(serverFeatures.creditsEnabled).toBe(true);
    await act(async () => toggle("creditsEnabled").click());
    await settle();
    await act(async () => dialogButton("确认关闭").click());
    await settle();
    expect(writes().map((request) => request.body)).toEqual([{ creditsEnabled: false }]);
    expect(toggle("creditsEnabled").getAttribute("aria-checked")).toBe("false");
    expect(toggle("siteAssistantEnabled").getAttribute("aria-checked")).toBe("true");
    expect(toggle("siteAssistantEnabled").disabled).toBe(true);
    expect(row("siteAssistantEnabled").textContent).toContain("需先开启积分计费");
});
