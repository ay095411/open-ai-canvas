import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AuthSessionPayload, AuthSettings } from "@/services/api/auth";

const dom = new Window({ url: "http://localhost/", settings: { device: { prefersReducedMotion: "reduce" } } });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    DocumentFragment: dom.DocumentFragment,
    Event: dom.Event,
    InputEvent: dom.InputEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

// 会话缓存水合另有专项；此处保留真实宿主、表单、Router、Zustand 和 HTTP 信封。
let applySession: (payload: AuthSessionPayload) => Promise<void> = async () => {};
const appliedSessions: AuthSessionPayload[] = [];
mock.module("@/lib/user-session", () => ({
    applyUserSession: async (payload: AuthSessionPayload) => {
        appliedSessions.push(payload);
        await applySession(payload);
    },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { createInstance } = await import("i18next");
const { I18nextProvider } = await import("react-i18next");
const { apiClient } = await import("@/services/api/request");
const { invalidateAuthSessionCache } = await import("@/services/api/auth");
const { useUserStore } = await import("@/stores/use-user-store");
const { useAuthSettingsStore } = await import("@/stores/use-auth-settings-store");
const { useAuthDialogStore } = await import("@/stores/use-auth-dialog-store");
const { WorkspaceAuthHost } = await import("@/components/layout/workspace-auth-modal");
const i18n = createInstance();
await i18n.init({ lng: "zh-CN", fallbackLng: "zh-CN", resources: { "zh-CN": { translation: {} } }, interpolation: { escapeValue: false } });

const settings: AuthSettings = {
    firstUser: false,
    registrationEnabled: true,
    linuxdoEnabled: false,
    wechatEnabled: true,
    emailEnabled: false,
    emailCodeRequired: false,
    emailRequired: false,
    emailVerificationRequired: false,
    smsBindingAvailable: false,
    emailBindingAvailable: false,
    smsLogin: false,
    emailLogin: false,
    smsRegistration: false,
    emailRegistration: false,
    smsAndEmailRegistration: false,
    loginMode: "modal",
    agreementTitle: "测试服务协议",
};
const user = { id: "wechat-user", username: "wechat-user", displayName: "微信创作者", role: "user" as const, status: "active" as const, createdAt: "", updatedAt: "" };
const next = "/projects?view=mine";
const callbackURL = `/login?wechat_register=1&next=${encodeURIComponent(next)}`;
const requests: Array<{ method: string; path: string; body: unknown }> = [];
const originalAdapter = apiClient.defaults.adapter;
let cancelRegistration: () => Promise<void>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Location() {
    const location = useLocation();
    return <output data-location>{location.pathname + location.search}</output>;
}

beforeEach(() => {
    dom.localStorage.clear();
    dom.sessionStorage.clear();
    requests.length = 0;
    appliedSessions.length = 0;
    applySession = async () => {};
    cancelRegistration = async () => {};
    invalidateAuthSessionCache();
    useUserStore.setState({ user: null, hydrated: true });
    useAuthDialogStore.getState().closeDialog();
    useAuthSettingsStore.setState({ settings: null, status: "idle", loadedAt: 0 });
    apiClient.defaults.adapter = async (config) => {
        const method = config.method || "get";
        const path = config.url || "";
        requests.push({ method, path, body: typeof config.data === "string" ? JSON.parse(config.data) : config.data });
        let data: unknown;
        if (method === "get" && path === "/auth/settings") data = settings;
        else if (method === "get" && path === "/auth/wechat/registration") data = { displayName: user.displayName, next, acceptedTerms: true };
        else if (method === "delete" && path === "/auth/wechat/registration") {
            await cancelRegistration();
            data = { cleared: true };
        } else if (method === "post" && path === "/auth/wechat/registration") data = { user, next };
        else if (method === "get" && path === "/auth/session") data = { user };
        else throw new Error(`Unexpected request: ${method} ${path}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } };
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    apiClient.defaults.adapter = originalAdapter;
    invalidateAuthSessionCache();
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function eventually(check: () => void) {
    const deadline = Date.now() + 3000;
    let failure: unknown;
    do {
        try {
            check();
            return;
        } catch (error) {
            failure = error;
        }
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    } while (Date.now() < deadline);
    throw failure;
}

async function render(initial = callbackURL) {
    await act(async () => {
        root.render(
            <I18nextProvider i18n={i18n}>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <MemoryRouter initialEntries={[initial]}>
                            <Location />
                            <WorkspaceAuthHost />
                        </MemoryRouter>
                    </App>
                </ConfigProvider>
            </I18nextProvider>,
        );
    });
    await eventually(() => expect(document.querySelector('[role="dialog"] form')).not.toBeNull());
}

function button(label: string) {
    const target = [...document.querySelectorAll("button")].find((item) => item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    expect(target).toBeDefined();
    return target!;
}

function location() {
    return host.querySelector("[data-location]")?.textContent;
}

test("微信回调深链替换背景 URL 后继续呈现补注册表单", async () => {
    await render();
    expect(location()).toBe("/");
    expect(document.querySelector('section[aria-label="完成微信注册"]')).not.toBeNull();
    expect(document.body.textContent).toContain(user.displayName);
    expect(button("完成注册并登录").disabled).toBe(false);
    expect(document.querySelector(".workspace-auth-title")?.textContent).toBe("Navo AI");
    expect(document.querySelector('[role="tablist"][aria-label="登录页轮播"]')).not.toBeNull();
});

test("取消确认完成后才回普通登录并保留目标页面", async () => {
    let complete!: () => void;
    cancelRegistration = () =>
        new Promise<void>((resolve) => {
            complete = resolve;
        });
    await render();
    await act(async () => button("使用已有账号登录").click());
    expect(document.querySelector('section[aria-label="完成微信注册"]')).not.toBeNull();
    expect(button("使用已有账号登录").disabled).toBe(true);
    await act(async () => complete());
    await eventually(() => expect(document.querySelector('section[aria-label="登录或注册"]')).not.toBeNull());
    expect(location()).toBe("/");
    expect(button("登录并进入创作")).toBeDefined();
    await eventually(() => expect(document.querySelector('a[href*="/auth/wechat/start"]')).not.toBeNull());
    expect(new URL(document.querySelector<HTMLAnchorElement>('a[href*="/auth/wechat/start"]')!.href).searchParams.get("next")).toBe(next);
});

test("取消失败保留补注册表单与错误并允许重试", async () => {
    cancelRegistration = async () => {
        throw new Error("取消失败，请重试");
    };
    await render();
    await act(async () => button("使用已有账号登录").click());
    await eventually(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe("取消失败，请重试"));
    expect(document.querySelector('section[aria-label="完成微信注册"]')).not.toBeNull();
    expect(location()).toBe("/");
    expect(button("使用已有账号登录").disabled).toBe(false);
    expect(appliedSessions).toHaveLength(0);
    cancelRegistration = async () => {};
    await act(async () => button("使用已有账号登录").click());
    await eventually(() => expect(document.querySelector('section[aria-label="登录或注册"]')).not.toBeNull());
    expect(requests.filter((item) => item.method === "delete")).toHaveLength(2);
});

test("补注册等待会话恢复后关闭弹窗并回跳 next", async () => {
    let complete!: () => void;
    applySession = () =>
        new Promise<void>((resolve) => {
            complete = resolve;
        });
    await render();
    const email = document.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(email, "creator@example.com");
        email.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
    await act(async () => button("完成注册并登录").click());
    await eventually(() => expect(appliedSessions).toEqual([{ user }]));
    expect(location()).toBe("/");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(requests.find((item) => item.method === "post")?.body).toEqual({ email: "creator@example.com", acceptedTerms: true });
    await act(async () => complete());
    await eventually(() => {
        expect(location()).toBe(next);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});

test("普通登录的微信入口携带 next 与用户实际同意状态", async () => {
    await render(`/login?next=${encodeURIComponent(next)}`);
    await eventually(() => expect(document.querySelector('a[href*="/auth/wechat/start"]')).not.toBeNull());
    const link = () => document.querySelector<HTMLAnchorElement>('a[href*="/auth/wechat/start"]')!;
    expect(link().textContent).toContain("使用微信登录");
    expect(new URL(link().href).searchParams.get("next")).toBe(next);
    expect(new URL(link().href).searchParams.get("acceptedTerms")).toBe("false");
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(new URL(link().href).searchParams.get("acceptedTerms")).toBe("true");
    expect(requests.some((item) => item.path === "/auth/wechat/registration")).toBe(false);
});
