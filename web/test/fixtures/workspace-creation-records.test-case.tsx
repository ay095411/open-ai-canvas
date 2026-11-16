import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasLibrarySummary } from "@/services/api/user-data";
import type { DramaListItem } from "@/services/api/drama";

const dom = new Window({ url: "http://localhost/" });
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    CustomEvent: dom.CustomEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

// 只替换 HTTP adapter；组件、状态、缓存、时间渲染与 Router 均使用真实实现。
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, keepPreviousData } = await import("@tanstack/react-query");
const { MemoryRouter, useLocation } = await import("react-router");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const { WorkspaceCreationRecords } = await import("@/components/layout/workspace-creation-records");

type Kind = "canvas" | "drama";
type RequestRecord = { url: string; userId?: string; params: Record<string, unknown>; signal?: { readonly aborted: boolean } };
const originalAdapter = apiClient.defaults.adapter;
const originalStore = useUserStore.getState();
let requests: RequestRecord[] = [];
let canvasData: CanvasLibrarySummary[] = [];
let dramaData: DramaListItem[] = [];
let failures: Partial<Record<Kind, boolean>> = {};
let pending: Partial<Record<Kind, Promise<void>>> = {};
let view: Awaited<ReturnType<typeof mount>> | undefined;

function session(id: string | null, { hydrated = true, shortDramaEnabled = true } = {}) {
    useUserStore.setState({
        user: id ? { id, username: id, displayName: id, role: "user", status: "active" } : null,
        hydrated,
        features: { ...originalStore.features, shortDramaEnabled },
    });
}

function canvas(id: string): CanvasLibrarySummary {
    return { id, title: `服务端画布 ${id}`, revision: 1, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2026-10-20T08:30:00Z", nodeCount: 3, previewNodes: [] };
}

function drama(id: string, patch: Partial<DramaListItem> = {}): DramaListItem {
    return {
        project: {
            id,
            userId: "user-a",
            name: `服务端短剧 ${id}`,
            type: "drama",
            aspectRatio: "9:16",
            sourceType: "text",
            description: "",
            stylePresetId: "",
            status: "active",
            revision: 1,
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2026-10-19T08:30:00Z",
        },
        status: "running",
        stage: "produce",
        pauseReason: "",
        episodeCount: 7,
        doneCount: 2,
        aspectRatio: "9:16",
        spentMicrocredits: 0,
        heldMicrocredits: 0,
        updatedAt: "2026-10-20T09:30:00Z",
        ...patch,
    };
}

function defer(kind: Kind) {
    let release = () => {};
    pending[kind] = new Promise<void>((resolve) => {
        release = resolve;
    });
    return release;
}

beforeEach(() => {
    requests = [];
    canvasData = [];
    dramaData = [];
    failures = {};
    pending = {};
    session("user-a");
    apiClient.defaults.adapter = async (config) => {
        if (config.url !== "/canvas-projects" && config.url !== "/dramas") throw new Error(`Unexpected request: ${config.url}`);
        const kind = config.url === "/canvas-projects" ? "canvas" : "drama";
        requests.push({ url: config.url, userId: useUserStore.getState().user?.id, params: config.params, signal: config.signal });
        const items = kind === "canvas" ? [...canvasData] : [...dramaData];
        const failed = failures[kind];
        const data = { ...(kind === "canvas" ? { projects: items } : { items, statusCounts: {} }), page: 1, pageSize: 3, total: items.length, hasMore: false };
        if (pending[kind]) await pending[kind];
        if (failed) throw new Error(`离线：${kind}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState(originalStore);
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function settle() {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 15)));
}

async function until(check: () => boolean) {
    for (let index = 0; index < 40; index += 1) {
        if (check()) return;
        await settle();
    }
    expect(check()).toBe(true);
}

function CurrentLocation() {
    const { pathname, search } = useLocation();
    return (
        <output data-current-location>
            {pathname}
            {search}
        </output>
    );
}

async function mount({ collapsed = false } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0, placeholderData: keepPreviousData } } });
    const callbacks = { expand: 0, navigate: 0 };
    const render = async (nextCollapsed: boolean) => {
        await act(async () =>
            root.render(
                <MemoryRouter initialEntries={["/"]}>
                    <QueryClientProvider client={client}>
                        <WorkspaceCreationRecords collapsed={nextCollapsed} onExpand={() => (callbacks.expand += 1)} onNavigate={() => (callbacks.navigate += 1)} />
                        <CurrentLocation />
                    </QueryClientProvider>
                </MemoryRouter>,
            ),
        );
        await settle();
    };
    await render(collapsed);
    return {
        host,
        client,
        callbacks,
        setCollapsed: render,
        async dispose() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

function group(kind: Kind) {
    return view!.host.querySelector<HTMLElement>(`[aria-label="${kind === "canvas" ? "画布" : "短剧"}创作记录"]`)!;
}

function records(kind: Kind) {
    return [...group(kind).querySelectorAll<HTMLAnchorElement>(".workspace-creation-records-link")];
}

async function click(element: HTMLElement) {
    await act(async () => element.click());
    await settle();
}

test("guest records retain guidance without a duplicate login control and unhydrated sessions never query records", async () => {
    session(null);
    view = await mount();
    expect(view.host.textContent).toContain("创作记录");
    expect(view.host.textContent).toContain("登录后查看已有画布与短剧记录");
    const guest = view.host.querySelector(".workspace-creation-records-guest")!;
    expect(guest.querySelector("strong")?.textContent).toBe("继续上次的创作");
    expect(guest.querySelector("button, a, [role='button'], [role='link']")).toBeNull();
    expect(guest.querySelector(".workspace-creation-records-login")).toBeNull();
    expect(requests).toHaveLength(0);
    expect(view.callbacks.navigate).toBe(0);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/");
    await act(async () => session("user-a", { hydrated: false }));
    await settle();
    expect(view.host.textContent).toContain("正在读取登录状态");
    expect(requests).toHaveLength(0);
    await act(async () => session("user-a"));
    await until(() => requests.length === 2);
});

test("collapsed records offer an expand action and do not fetch until expanded", async () => {
    canvasData = [canvas("collapsed")];
    view = await mount({ collapsed: true });
    expect(requests).toHaveLength(0);
    expect(view.host.querySelector("h2")).toBeNull();
    await click(view.host.querySelector('[aria-label="展开创作记录"]')!);
    expect(view.callbacks.expand).toBe(1);
    expect(requests).toHaveLength(0);
    await view.setCollapsed(false);
    await until(() => records("canvas").length === 1);
    expect(requests).toHaveLength(2);
    expect(view.host.textContent).toContain(canvasData[0].title);
    await view.setCollapsed(true);
    expect(view.host.textContent).not.toContain(canvasData[0].title);
});

test("both groups show actual API titles and update times, and rows navigate to their real detail routes", async () => {
    canvasData = [canvas("canvas-a")];
    dramaData = [drama("drama-a")];
    view = await mount();
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    expect(requests.map(({ url, params }) => ({ url, params }))).toEqual([
        { url: "/canvas-projects", params: { page: 1, pageSize: 3, sort: "updated" } },
        { url: "/dramas", params: { page: 1, pageSize: 3 } },
    ]);
    for (const [kind, icon] of [
        ["canvas", "lucide-panels-top-left"],
        ["drama", "lucide-clapperboard"],
    ] as const) {
        expect(group(kind).querySelector(`header h3 .${icon}`)?.getAttribute("aria-hidden")).toBe("true");
        const row = records(kind)[0];
        const name = row.querySelector(".workspace-creation-records-copy strong")!;
        expect(name.getAttribute("title")).toBe(name.textContent);
        expect(row.querySelector("time.workspace-creation-records-time")).not.toBeNull();
        expect(row.querySelector(".workspace-creation-records-marker")?.getAttribute("aria-hidden")).toBe("true");
        expect(row.querySelector(".lucide-panels-top-left, .lucide-clapperboard")).toBeNull();
        expect(row.querySelectorAll("svg")).toHaveLength(1);
        expect(row.querySelector(".workspace-creation-records-open.lucide-chevron-right")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(records("canvas")[0].textContent).toContain(canvasData[0].title);
    expect(records("drama")[0].textContent).toContain(dramaData[0].project.name);
    expect(records("canvas")[0].querySelector("time")?.dateTime).toBe("2026-10-20T08:30:00.000Z");
    expect(records("drama")[0].querySelector("time")?.dateTime).toBe("2026-10-20T09:30:00.000Z");
    expect(records("canvas")[0].getAttribute("href")).toBe("/canvas/canvas-a");
    expect(records("drama")[0].getAttribute("href")).toBe("/projects/drama-a");
    await click(records("canvas")[0]);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/canvas/canvas-a");
    expect(records("canvas")[0].getAttribute("aria-current")).toBe("page");
    await click(records("drama")[0]);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/projects/drama-a");
    expect(view.callbacks.navigate).toBe(2);
    expect(view.host.querySelector("img, video")).toBeNull();
});

test("long record names retain their full title and unknown times use the dedicated time styling", async () => {
    const longName = "《长镜头与跨城追逐：第一季的未完成分镜》".repeat(12);
    canvasData = [{ ...canvas("long-canvas"), title: longName, updatedAt: "not-a-date" }];
    const longDrama = drama("long-drama", { updatedAt: "" });
    dramaData = [{ ...longDrama, project: { ...longDrama.project, name: longName, updatedAt: "" } }];
    view = await mount();
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    for (const kind of ["canvas", "drama"] as const) {
        const row = records(kind)[0];
        const name = row.querySelector(".workspace-creation-records-copy strong")!;
        expect(name.textContent).toBe(longName);
        expect(name.getAttribute("title")).toBe(longName);
        expect(row.getAttribute("aria-label")).toBe(`打开${kind === "canvas" ? "画布" : "短剧"}：${longName}`);
        expect(row.querySelector("time")).toBeNull();
        const unknownTime = row.querySelector("span.workspace-creation-records-time")!;
        expect(unknownTime).not.toBeNull();
        expect(unknownTime.classList.contains("tabular-nums")).toBe(true);
        expect(unknownTime.textContent?.trim()).toBeTruthy();
    }
});

test("each group shows only the first three records from overfull API responses", async () => {
    canvasData = Array.from({ length: 8 }, (_, n) => canvas(`limited-${n}`));
    dramaData = Array.from({ length: 8 }, (_, n) => drama(`limited-${n}`));
    view = await mount();
    await until(() => records("canvas").length === 3 && records("drama").length === 3);
    expect(records("canvas").map((link) => link.querySelector("strong")?.textContent)).toEqual(canvasData.slice(0, 3).map((item) => item.title));
    expect(records("drama").map((link) => link.querySelector("strong")?.textContent)).toEqual(dramaData.slice(0, 3).map((item) => item.project.name));
    for (let n = 3; n < 8; n += 1) expect(view.host.textContent).not.toContain(`limited-${n}`);
});

test("unfinished drama forms open the encoded draft URL and time falls back to the project summary", async () => {
    dramaData = [drama("draft / a?", { hasDraftForm: true, updatedAt: "" })];
    view = await mount();
    await until(() => records("drama").length === 1);
    const link = records("drama")[0];
    expect(link.getAttribute("href")).toBe("/projects/new?draft=draft%20%2F%20a%3F");
    expect(link.querySelector("time")?.dateTime).toBe("2026-10-19T08:30:00.000Z");
    await click(link);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/projects/new?draft=draft%20%2F%20a%3F");
    expect(link.getAttribute("aria-current")).toBe("page");
});

test("view-all links preserve each existing library route and notify the sidebar", async () => {
    view = await mount();
    const canvasAll = view.host.querySelector<HTMLAnchorElement>('[aria-label="查看全部画布"]')!;
    const dramaAll = view.host.querySelector<HTMLAnchorElement>('[aria-label="查看全部短剧"]')!;
    expect(canvasAll.getAttribute("href")).toBe("/canvas");
    expect(dramaAll.getAttribute("href")).toBe("/projects");
    for (const link of [canvasAll, dramaAll]) {
        expect(link.classList.contains("workspace-creation-records-all")).toBe(true);
        expect(link.querySelector("span")?.textContent).toBe("全部");
        expect(link.querySelector(".lucide-chevron-right")?.getAttribute("aria-hidden")).toBe("true");
    }
    await click(canvasAll);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/canvas");
    await click(dramaAll);
    expect(view.host.querySelector("[data-current-location]")?.textContent).toBe("/projects");
    expect(view.callbacks.navigate).toBe(2);
});

test("a disabled drama feature neither requests nor renders drama records, including runtime changes", async () => {
    session("user-a", { shortDramaEnabled: false });
    view = await mount();
    expect(requests.map((request) => request.url)).toEqual(["/canvas-projects"]);
    expect(group("drama")).toBeNull();
    dramaData = [drama("enabled")];
    await act(async () => session("user-a"));
    await until(() => records("drama").length === 1);
    await act(async () => session("user-a", { shortDramaEnabled: false }));
    await settle();
    expect(group("drama")).toBeNull();
    expect(requests.filter((request) => request.url === "/dramas")).toHaveLength(1);
});

test("errors retry independently and are never presented as empty history", async () => {
    failures.canvas = true;
    dramaData = [drama("still-visible")];
    view = await mount();
    await until(() => Boolean(group("canvas").querySelector('[role="alert"]')));
    expect(group("canvas").textContent).not.toContain("还没有画布记录");
    expect(records("drama")).toHaveLength(1);
    failures.canvas = false;
    canvasData = [canvas("recovered")];
    await click(group("canvas").querySelector("button")!);
    await until(() => records("canvas").length === 1);
    expect(requests.filter((request) => request.url === "/dramas")).toHaveLength(1);
    failures.drama = true;
    await act(async () => view!.client.invalidateQueries({ queryKey: ["my-dramas-recent"] }));
    await until(() => Boolean(group("drama").querySelector('[role="alert"]')));
    expect(records("canvas")[0].textContent).toContain("recovered");
    expect(records("drama")[0].textContent).toContain("still-visible");
    failures.drama = false;
    dramaData = [drama("recovered")];
    await click(group("drama").querySelector("button")!);
    await until(() => records("drama")[0].textContent!.includes("recovered"));
    expect(group("drama").querySelector('[role="alert"]')).toBeNull();
});

test("successful empty responses show both honest empty states", async () => {
    view = await mount();
    await until(() => Boolean(group("canvas").textContent?.includes("还没有画布记录")));
    expect(group("drama").textContent).toContain("还没有短剧记录");
    expect(view.host.querySelectorAll(".workspace-creation-records-link")).toHaveLength(0);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
});

test("existing invalidation prefixes refresh the mounted canvas and drama groups", async () => {
    canvasData = [canvas("before")];
    dramaData = [drama("before")];
    view = await mount();
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    canvasData = [canvas("after")];
    dramaData = [drama("after")];
    await act(async () => Promise.all([view!.client.invalidateQueries({ queryKey: ["canvas-library"] }), view!.client.invalidateQueries({ queryKey: ["my-dramas-recent"] })]));
    await until(() => records("canvas")[0].textContent!.includes("after") && records("drama")[0].textContent!.includes("after"));
    expect(view.host.textContent).not.toContain("before");
    expect(requests).toHaveLength(4);
});

test("account switching aborts both old requests and drops late responses", async () => {
    canvasData = [canvas("old-account")];
    dramaData = [drama("old-account")];
    const releaseCanvas = defer("canvas");
    const releaseDrama = defer("drama");
    view = await mount();
    await until(() => requests.length === 2);
    const oldRequests = [...requests];
    pending = {};
    canvasData = [canvas("new-account")];
    dramaData = [drama("new-account")];
    await act(async () => session("user-b"));
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    expect(oldRequests.every((request) => request.signal?.aborted)).toBe(true);
    expect(requests.slice(2).every((request) => request.userId === "user-b")).toBe(true);
    await act(async () => {
        releaseCanvas();
        releaseDrama();
    });
    await settle();
    expect(view.host.textContent).not.toContain("old-account");
    expect(records("canvas")[0].textContent).toContain("new-account");
    expect(records("drama")[0].textContent).toContain("new-account");
});

test("visible records disappear during session hydration and never leak through keepPreviousData", async () => {
    canvasData = [canvas("visible-user-a")];
    dramaData = [drama("visible-user-a")];
    view = await mount();
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    await act(async () => session("user-b", { hydrated: false }));
    expect(view.host.textContent).not.toContain("visible-user-a");
    expect(view.host.textContent).toContain("正在读取登录状态");
    const releaseCanvas = defer("canvas");
    const releaseDrama = defer("drama");
    canvasData = [canvas("visible-user-b")];
    dramaData = [drama("visible-user-b")];
    await act(async () => session("user-b"));
    await settle();
    expect(view.host.textContent).not.toContain("visible-user-a");
    expect(view.host.querySelectorAll(".workspace-creation-records-link")).toHaveLength(0);
    await act(async () => {
        releaseCanvas();
        releaseDrama();
    });
    await until(() => records("canvas").length === 1 && records("drama").length === 1);
    expect(view.host.textContent).toContain("visible-user-b");
    await act(async () => session(null));
    expect(view.host.textContent).not.toContain("visible-user-b");
    expect(view.host.querySelectorAll(".workspace-creation-records-link")).toHaveLength(0);
});
