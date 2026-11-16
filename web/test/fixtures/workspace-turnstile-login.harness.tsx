import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AuthSessionPayload, AuthSettings } from "@/services/api/auth";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
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
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

// 只隔离会话水合与 HTTP/Cloudflare 边界；真实 LoginForm、Widget、验证字段和 Router 均参与测试。
const appliedSessions: AuthSessionPayload[] = [];
mock.module("@/lib/user-session", () => ({
    applyUserSession: async (payload: AuthSessionPayload) => {
        appliedSessions.push(payload);
    },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { invalidateAuthSessionCache } = await import("@/services/api/auth");
const { LoginForm } = await import("@/components/auth/login-form");

const baseSettings: AuthSettings = {
    firstUser: false,
    registrationEnabled: true,
    linuxdoEnabled: false,
    wechatEnabled: false,
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
    turnstileEnabled: true,
    turnstileSiteKey: "controlled-site-key",
    agreementTitle: "测试服务协议",
};
const user = { id: "captcha-user", username: "creator", displayName: "创作者", role: "user" as const, status: "active" as const, createdAt: "", updatedAt: "" };
const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
const challenges: Record<string, unknown>[] = [];
const removedChallenges: Array<string | number> = [];
const unexpectedRequests: string[] = [];
const originalAdapter = apiClient.defaults.adapter;
let settings = baseSettings;
let loginOutcome: "success" | "not-registered" | "error" = "success";
let successCount = 0;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    dom.localStorage.clear();
    dom.sessionStorage.clear();
    requests.length = 0;
    challenges.length = 0;
    removedChallenges.length = 0;
    unexpectedRequests.length = 0;
    appliedSessions.length = 0;
    settings = baseSettings;
    loginOutcome = "success";
    successCount = 0;
    invalidateAuthSessionCache();
    window.turnstile = {
        render: (_container, options) => {
            challenges.push(options);
            return challenges.length;
        },
        reset: () => {},
        remove: (id) => removedChallenges.push(id),
    };
    apiClient.defaults.adapter = async (config) => {
        const method = config.method || "get";
        const path = config.url || "";
        requests.push({ method, path, body: typeof config.data === "string" ? JSON.parse(config.data) : config.data });
        let data: unknown;
        if (method === "get" && path === "/auth/settings") data = settings;
        else if (method === "get" && path === "/auth/session") data = { user };
        else if (method === "post" && path === "/auth/verification") data = { ticket: "controlled-ticket", expiresIn: 600, retryAfter: 60 };
        else if (method === "post" && path === "/auth/login") {
            if (loginOutcome !== "success") {
                return {
                    config,
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    data: { code: 400, msg: loginOutcome === "error" ? "受控登录失败" : "账号未注册", reason: loginOutcome === "not-registered" ? "account_not_registered" : "invalid_credentials", details: { accountKind: "username" } },
                };
            }
            data = { user };
        } else if (method === "post" && (path === "/auth/register" || path === "/auth/verification/login")) data = { user };
        else {
            unexpectedRequests.push(`${method} ${path}`);
            throw new Error(`Unexpected request: ${method} ${path}`);
        }
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
    delete window.turnstile;
    expect(unexpectedRequests).toEqual([]);
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
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

function Location() {
    const { pathname, search } = useLocation();
    return <output data-location>{pathname + search}</output>;
}

async function render() {
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <MemoryRouter initialEntries={["/inspirations?view=mine"]}>
                        <Location />
                        <LoginForm next="/projects" onSuccess={() => (successCount += 1)} />
                    </MemoryRouter>
                </App>
            </ConfigProvider>,
        );
    });
    await eventually(() => expect(host.querySelector('input[type="checkbox"]')).not.toBeNull());
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}

async function fill(label: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input!.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

async function credentials() {
    await fill("用户名或邮箱", "creator");
    await fill("密码", "test-password-123");
}

function submitButton() {
    return host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

async function submitForm() {
    await act(async () => {
        host.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
    });
}

async function token(value: string) {
    await act(async () => (challenges.at(-1)!.callback as (token: string) => void)(value));
}

function writes(path?: string) {
    return requests.filter((item) => item.method === "post" && (!path || item.path === path));
}

test("机器人保护启用时无令牌既阻止按钮也阻止直接提交表单", async () => {
    await render();
    await credentials();
    await eventually(() => expect(challenges).toHaveLength(1));
    expect(challenges[0].sitekey).toBe("controlled-site-key");
    expect(submitButton().disabled).toBe(true);
    await submitForm();
    expect(writes()).toHaveLength(0);
    expect(successCount).toBe(0);
});

test("真实密码登录传递令牌并等待会话恢复后回调，不自行改路由", async () => {
    await render();
    await credentials();
    await token("password-token");
    expect(submitButton().disabled).toBe(false);
    await submitForm();
    await eventually(() => expect(successCount).toBe(1));
    expect(writes("/auth/login")[0].body).toEqual({ username: "creator", password: "test-password-123", autoRegister: true, turnstileToken: "password-token" });
    expect(appliedSessions).toEqual([{ user }]);
    expect(host.querySelector("[data-location]")?.textContent).toBe("/inspirations?view=mine");
});

test("账号未注册就地切换后旧令牌失效，补注册必须取得新令牌", async () => {
    loginOutcome = "not-registered";
    await render();
    await credentials();
    await token("lookup-token");
    await submitForm();
    await eventually(() => expect(challenges).toHaveLength(2));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("该账号还不存在");
    expect(removedChallenges).toContain(1);
    await fill("确认密码", "test-password-123");
    expect(submitButton().disabled).toBe(true);
    await submitForm();
    expect(writes("/auth/register")).toHaveLength(0);
    await token("registration-token");
    await submitForm();
    await eventually(() => expect(successCount).toBe(1));
    expect(writes("/auth/login")[0].body.turnstileToken).toBe("lookup-token");
    expect(writes("/auth/register")[0].body).toMatchObject({ username: "creator", password: "test-password-123", acceptedTerms: true, turnstileToken: "registration-token" });
    expect(host.querySelector("[data-location]")?.textContent).toBe("/inspirations?view=mine");
});

test("登录失败重置挑战，令牌过期或组件错误都重新禁止提交", async () => {
    loginOutcome = "error";
    await render();
    await credentials();
    await token("failed-token");
    await submitForm();
    await eventually(() => expect(challenges).toHaveLength(2));
    expect(removedChallenges).toContain(1);
    expect(submitButton().disabled).toBe(true);
    await token("expired-token");
    await act(async () => (challenges.at(-1)!["expired-callback"] as () => void)());
    expect(submitButton().disabled).toBe(true);
    await submitForm();
    expect(writes("/auth/login")).toHaveLength(1);
    await token("error-token");
    await act(async () => (challenges.at(-1)!["error-callback"] as () => void)());
    expect(submitButton().disabled).toBe(true);
    loginOutcome = "success";
    await token("retry-token");
    await submitForm();
    await eventually(() => expect(successCount).toBe(1));
    expect(writes("/auth/login").map((item) => item.body.turnstileToken)).toEqual(["failed-token", "retry-token"]);
});

test("邮件验证码登录沿真实验证字段获取票据并传递机器人令牌", async () => {
    settings = { ...baseSettings, emailLogin: true };
    await render();
    const method = [...host.querySelectorAll<HTMLElement>(".ant-segmented-item")].find((item) => item.textContent === "邮件验证码")!;
    expect(method).toBeDefined();
    await act(async () => method.click());
    await fill("邮箱", "creator@example.com");
    await act(async () => host.querySelector<HTMLButtonElement>(".auth-code-send")!.click());
    await eventually(() => expect(writes("/auth/verification")).toHaveLength(1));
    await fill("邮件验证码", "123456");
    await token("verification-token");
    await submitForm();
    await eventually(() => expect(successCount).toBe(1));
    expect(writes("/auth/verification/login")[0].body).toMatchObject({ ticket: "controlled-ticket", email: "creator@example.com", emailCode: "123456", turnstileToken: "verification-token" });
    expect(writes("/auth/login")).toHaveLength(0);
});

test("关闭机器人保护保留原密码登录合同且不加载挑战", async () => {
    settings = { ...baseSettings, turnstileEnabled: false, turnstileSiteKey: "" };
    await render();
    await credentials();
    expect(challenges).toHaveLength(0);
    expect(host.querySelector(".auth-turnstile")).toBeNull();
    expect(submitButton().disabled).toBe(false);
    await submitForm();
    await eventually(() => expect(successCount).toBe(1));
    expect(writes("/auth/login")[0].body).toEqual({ username: "creator", password: "test-password-123", autoRegister: true });
});
