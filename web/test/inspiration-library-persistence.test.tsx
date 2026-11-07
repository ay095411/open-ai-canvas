import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationInspiration } from "@/lib/inspirations/catalog";

const dom = new Window({ url: "http://localhost/inspirations" });
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
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
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
const { MemoryRouter } = await import("react-router");
const { getActiveUserScope, setActiveUserScope } = await import("@/lib/user-scope");
const { apiClient } = await import("@/services/api/request");
const { invalidateInspirationCatalog } = await import("@/services/inspiration-catalog");
const { useInspirationStore } = await import("@/stores/use-inspiration-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: InspirationsPage } = await import("@/pages/inspirations");
const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
const originalInspirationState = useInspirationStore.getState();
const originalInspirationStorage = useInspirationStore.persist.getOptions().storage;
const originalUserState = useUserStore.getState();
const originalScope = getActiveUserScope();
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
type Records = Pick<typeof originalInspirationState, "custom" | "overrides" | "hidden" | "favorites">;
type Snapshot = { state: Records; version: number } | null;
const emptyRecords = (): Records => ({ custom: [], overrides: {}, hidden: [], favorites: [] });
let view: Awaited<ReturnType<typeof mount>> | undefined;
let warningSpy: ReturnType<typeof spyOn<typeof console, "warn">> | undefined;

function inspiration(id: string, title: string): CreationInspiration {
    return { id, title, description: "目录读取探针", image: "https://example.com/probe.webp", mode: "image", prompt: "测试提示词", sourceId: "youmind", addedAt: new Date().toISOString() };
}

const publicId = "youmind:persistence-public";
const hiddenId = "youmind:persistence-hidden";
const snapshot = (patch: Partial<Records> = {}): Snapshot => ({ state: { ...emptyRecords(), ...patch }, version: 0 });

function signIn(id: string) {
    setActiveUserScope(id);
    useUserStore.setState({ user: { id, username: id, displayName: id, role: "user", status: "active" }, hydrated: true });
}

beforeEach(async () => {
    warningSpy = spyOn(console, "warn").mockImplementation(() => {});
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState({ ...emptyRecords(), hydrated: false, hydrationScope: null, hydrationError: "" });
    signIn("current-user");
    invalidateInspirationCatalog();
    globalThis.fetch = (async (input) => {
        const url = String(input);
        if (url === "/inspirations/manifest.json") return new Response(JSON.stringify({ sources: {} }));
        if (!/^\/inspirations\/(seedance|haohaoxue|youmind)\.json$/.test(url)) throw new Error(`Unexpected fetch: ${url}`);
        return new Response(JSON.stringify({ entries: url.includes("youmind") ? [inspiration(publicId, "公共原始标题"), inspiration(hiddenId, "公共可见条目")] : [] }));
    }) as typeof fetch;
    apiClient.defaults.adapter = async (config) => {
        if (config.url !== "/public/inspirations/feed") throw new Error(`Unexpected request: ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { enabled: false, entries: [], categories: {} }, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState(originalInspirationState);
    useInspirationStore.persist.setOptions({ storage: originalInspirationStorage });
    useUserStore.setState(originalUserState);
    setActiveUserScope(originalScope);
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    invalidateInspirationCatalog();
    warningSpy?.mockRestore();
    warningSpy = undefined;
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

async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <MemoryRouter>
                        <InspirationsPage embedded />
                    </MemoryRouter>
                </App>
            </ConfigProvider>,
        );
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await settle();
        if (host.querySelector(".inspiration-gallery")) break;
    }
    expect(host.querySelector(".inspiration-gallery")).not.toBeNull();
    return {
        host,
        async dispose() {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function buttonNamed(name: string) {
    const button = Array.from(view!.host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === name || item.textContent?.replace(/\s/g, "") === name);
    expect(button).toBeDefined();
    return button!;
}

async function click(button: HTMLButtonElement) {
    await act(async () => button.click());
    await settle();
}

test("本地读取失败时展示公共目录，旧账号覆盖、隐藏和收藏不进入页面", async () => {
    useInspirationStore.setState({
        hydrated: true,
        hydrationScope: "previous-user",
        custom: [inspiration("custom:private", "旧账号私有条目")],
        overrides: { [publicId]: { title: "旧账号覆盖标题" } },
        hidden: [hiddenId],
        favorites: [publicId],
    });
    let writes = 0;
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: async () => {
                throw new Error("IndexedDB unavailable");
            },
            setItem: () => {
                writes += 1;
            },
            removeItem: () => {},
        },
    });
    view = await mount();
    expect(view.host.textContent).toContain("公共原始标题");
    expect(view.host.textContent).toContain("公共可见条目");
    expect(view.host.textContent).not.toContain("旧账号");
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("当前仅展示公共目录");
    expect(buttonNamed("收藏：公共原始标题").disabled).toBe(true);
    expect(buttonNamed("收藏：公共原始标题").getAttribute("aria-pressed")).toBe("false");
    expect(useInspirationStore.getState().custom).toEqual([]);
    expect(useInspirationStore.getState().hydrated).toBe(false);
    expect(writes).toBe(0);
    expect(warningSpy).toHaveBeenCalled();
});

test("重试恢复当前账号记录，收藏和个人覆盖重新生效", async () => {
    let failRead = true;
    let writes = 0;
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: async () => {
                if (failRead) throw new Error("IndexedDB temporarily unavailable");
                return snapshot({ custom: [inspiration("custom:current", "当前账号自建条目")], overrides: { [publicId]: { title: "当前账号覆盖标题" } }, hidden: [hiddenId], favorites: [publicId] });
            },
            setItem: () => {
                writes += 1;
            },
            removeItem: () => {},
        },
    });
    view = await mount();
    failRead = false;
    await click(buttonNamed("重试本地记录"));
    expect(view.host.textContent).toContain("当前账号自建条目");
    expect(view.host.textContent).toContain("当前账号覆盖标题");
    expect(view.host.textContent).not.toContain("公共可见条目");
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    expect(buttonNamed("取消收藏：当前账号覆盖标题").disabled).toBe(false);
    expect(buttonNamed("取消收藏：当前账号覆盖标题").getAttribute("aria-pressed")).toBe("true");
    expect(useInspirationStore.getState().hydrationScope).toBe("current-user");
    expect(writes).toBe(0);
});

test("切到没有本地记录的账号时清空旧记录，不向新账号写入旧叠加层", async () => {
    let writes = 0;
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: async () =>
                getActiveUserScope() === "current-user" ? snapshot({ custom: [inspiration("custom:previous", "旧账号自建条目")], overrides: { [publicId]: { title: "旧账号覆盖标题" } }, hidden: [hiddenId], favorites: [publicId] }) : null,
            setItem: () => {
                writes += 1;
            },
            removeItem: () => {},
        },
    });
    view = await mount();
    expect(view.host.textContent).toContain("旧账号自建条目");
    await act(async () => signIn("next-user"));
    await settle();
    expect(view.host.textContent).not.toContain("旧账号");
    expect(view.host.textContent).toContain("公共原始标题");
    expect(view.host.textContent).toContain("公共可见条目");
    const state = useInspirationStore.getState();
    expect({ custom: state.custom, overrides: state.overrides, hidden: state.hidden, favorites: state.favorites }).toEqual(emptyRecords());
    expect(state.hydrationScope).toBe("next-user");
    expect(buttonNamed("收藏：公共原始标题").disabled).toBe(false);
    expect(writes).toBe(0);
});

test("上个账号的延迟读取不会覆盖新账号已经恢复的记录", async () => {
    let resolvePrevious!: (value: Snapshot) => void;
    const delayed = new Promise<Snapshot>((resolve) => {
        resolvePrevious = resolve;
    });
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: () => (getActiveUserScope() === "current-user" ? delayed : Promise.resolve(snapshot({ custom: [inspiration("custom:next", "新账号自建条目")], favorites: [publicId] }))),
            setItem: () => {},
            removeItem: () => {},
        },
    });
    view = await mount();
    expect(view.host.textContent).toContain("当前先展示公共目录");
    expect(buttonNamed("收藏：公共原始标题").disabled).toBe(true);
    await act(async () => signIn("next-user"));
    await settle();
    await act(async () => resolvePrevious(snapshot({ custom: [inspiration("custom:previous", "迟到的旧账号条目")] })));
    await settle();
    expect(view.host.textContent).toContain("新账号自建条目");
    expect(view.host.textContent).not.toContain("迟到的旧账号条目");
    expect(useInspirationStore.getState().hydrationScope).toBe("next-user");
    expect(useInspirationStore.getState().favorites).toEqual([publicId]);
    expect(useInspirationStore.getState().hydrationError).toBe("");
});

test("收藏写入失败会撤销选中并显示错误，不因回滚再次尝试写入", async () => {
    let writes = 0;
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: async () => snapshot(),
            setItem: async () => {
                writes += 1;
                throw new Error("Storage quota exceeded");
            },
            removeItem: () => {},
        },
    });
    view = await mount();
    await click(buttonNamed("收藏：公共原始标题"));
    expect(useInspirationStore.getState().favorites).toEqual([]);
    expect(buttonNamed("收藏：公共原始标题").getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed("收藏：公共原始标题").disabled).toBe(false);
    expect(document.body.textContent).toContain("收藏修改未保存，请重试");
    expect(writes).toBe(1);
});

test("收藏成功只持久化个人记录，不保存读取状态标记", async () => {
    const writes: unknown[] = [];
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: async () => snapshot(),
            setItem: async (_name, value) => {
                writes.push(value);
            },
            removeItem: () => {},
        },
    });
    view = await mount();
    await click(buttonNamed("收藏：公共原始标题"));
    expect(buttonNamed("取消收藏：公共原始标题").getAttribute("aria-pressed")).toBe("true");
    expect(writes).toEqual([snapshot({ favorites: [publicId] })]);
});
