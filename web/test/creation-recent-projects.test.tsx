import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasLibrarySummary } from "@/services/api/user-data";
import type { DramaListItem } from "@/services/api/drama";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node,
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

// 只隔离媒体与路由预加载；真实组件、Zustand、QueryClient、Router 与 API 信封都参与测试。
mock.module("@/components/canvas/canvas-project-card", () => ({
    ProjectPreview: ({ project, quiet, mosaic }: { project: { id: string }; quiet?: boolean; mosaic?: boolean }) => <span data-preview={project.id} data-quiet={String(quiet)} data-mosaic={String(mosaic)} />,
}));
mock.module("@/components/cached-resource-image", () => ({
    CachedResourceImage: ({ storageKey }: { storageKey: string }) => <img data-resource={storageKey} alt="" />,
}));
mock.module("@/lib/workspace-route-modules", () => ({ loadCanvasProjectPage: () => Promise.resolve() }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, keepPreviousData } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { useUserStore } = await import("@/stores/use-user-store");
const { apiClient } = await import("@/services/api/request");
const { CreationRecentProjects } = await import("@/pages/create/creation-recent-canvases");

type RequestRecord = { url: string; userId?: string; params: Record<string, unknown>; signal?: { readonly aborted: boolean } };
const requests: RequestRecord[] = [];
const oldAdapter = apiClient.defaults.adapter;
const initialStore = useUserStore.getState();
let canvasData: CanvasLibrarySummary[] = [];
let dramaData: DramaListItem[] = [];
let failCanvas = false;
let failDrama = false;
let deferCanvas: ((finish: () => void) => void) | undefined;
let activeView: Awaited<ReturnType<typeof mount>> | undefined;

apiClient.defaults.adapter = async (config) => {
    requests.push({ url: config.url || "", userId: useUserStore.getState().user?.id, params: config.params, signal: config.signal });
    const isCanvas = config.url === "/canvas-projects";
    const items = isCanvas ? [...canvasData] : [...dramaData];
    if (isCanvas && deferCanvas) await new Promise<void>((resolve) => deferCanvas!(resolve));
    if (isCanvas ? failCanvas : failDrama) throw new Error("暂时离线");
    const data = isCanvas ? { projects: items } : { items };
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { ...data, page: 1, pageSize: 6, total: items.length, hasMore: false } } };
};

function session(id: string | null, hydrated = true, shortDramaEnabled = true) {
    const user = id ? { id, username: id, displayName: id, role: "user" as const, status: "active" as const } : null;
    useUserStore.setState({ user, hydrated, features: { ...initialStore.features, shortDramaEnabled } });
}

const settle = async () => {
    for (let index = 0; index < 4; index += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
};

async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const history = mock(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0, placeholderData: keepPreviousData } } });
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><CreationRecentProjects onOpenHistory={history} /></MemoryRouter></QueryClientProvider>));
    await settle();
    return { host, history, client, unmount: async () => { await act(() => root.unmount()); client.clear(); host.remove(); } };
}

async function click(text: string) {
    const button = [...activeView!.host.querySelectorAll("button")].find((element) => element.textContent === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await settle();
}

beforeEach(() => {
    requests.length = 0;
    canvasData = [];
    dramaData = [];
    failCanvas = false;
    failDrama = false;
    deferCanvas = undefined;
    session("user-a");
});

afterEach(async () => { await activeView?.unmount(); activeView = undefined; });
afterAll(() => {
    apiClient.defaults.adapter = oldAdapter;
    useUserStore.setState(initialStore);
    mock.restore();
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function canvas(id: string): CanvasLibrarySummary {
    return { id, title: `画布 ${id}`, revision: 1, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2026-10-20T08:30:00Z", nodeCount: 3, previewNodes: [] };
}

function drama(): DramaListItem {
    return {
        project: { id: "drama-a", name: "真实短剧", updatedAt: "2026-10-19T08:30:00Z" } as DramaListItem["project"],
        status: "running", stage: "produce", pauseReason: "", episodeCount: 7, doneCount: 2,
        coverResourceIds: ["real-cover"], aspectRatio: "9:16", spentMicrocredits: 0, updatedAt: "2026-10-20T08:30:00Z",
    };
}

describe("首页继续创作真实查询与交互", () => {
    test("游客和未恢复会话整区隐藏，不请求或读取本地画布", async () => {
        session(null);
        activeView = await mount();
        expect(activeView.host.textContent).toBe("");
        expect(requests).toHaveLength(0);
        await act(async () => session("user-a", false));
        await settle();
        expect(activeView.host.textContent).toBe("");
        expect(requests).toHaveLength(0);
        await act(async () => session("user-a"));
        await settle();
        expect(requests).toHaveLength(1);
    });

    test("首屏仅请求 updated 排序的六条画布，展示更新时间和原历史回调", async () => {
        canvasData = [canvas("a")];
        activeView = await mount();
        expect(requests).toHaveLength(1);
        expect(requests[0].params).toEqual({ page: 1, pageSize: 6, sort: "updated" });
        expect(activeView.host.querySelector("time")?.getAttribute("datetime")).toBe(canvasData[0].updatedAt);
        expect(activeView.host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("a");
        expect(activeView.host.querySelector("[data-preview]")?.getAttribute("data-quiet")).toBe("true");
        expect(activeView.host.querySelector("[data-preview]")?.getAttribute("data-mosaic")).toBe("true");
        expect(activeView.host.querySelector(".canvas-collection-badge")?.textContent).toBe("3个节点");
        expect(activeView.host.textContent).not.toContain("创建于");
        expect(activeView.host.textContent).not.toContain("创建画布");
        expect(activeView.host.querySelector('a[href="/canvas"]')).not.toBeNull();
        await click("历史对话");
        expect(activeView.history).toHaveBeenCalledTimes(1);
    });

    test("切短剧才加载六条摘要，封面和真实状态计数可见，查看全部随 tab 变化", async () => {
        dramaData = [drama()];
        activeView = await mount();
        await click("短剧");
        expect(requests.map((request) => request.url)).toEqual(["/canvas-projects", "/dramas"]);
        expect(requests[1].params).toEqual({ page: 1, pageSize: 6 });
        expect(activeView.host.querySelector('[data-resource="resource:real-cover"]')).not.toBeNull();
        expect(activeView.host.textContent).toContain("制作中");
        expect(activeView.host.textContent).toContain("2/7 集成片");
        expect(activeView.host.textContent).not.toContain("%");
        expect(activeView.host.querySelector('a[href="/projects"]')).not.toBeNull();
        expect(activeView.host.querySelector('a[href="/projects/drama-a"]')).not.toBeNull();
        await click("画布");
        expect(requests).toHaveLength(2);
        expect(activeView.host.querySelector('a[href="/canvas"]')).not.toBeNull();
    });

    test("短剧功能关闭时无短剧 tab 和请求，运行时关闭会退回画布", async () => {
        session("user-a", true, false);
        activeView = await mount();
        expect(activeView.host.querySelector('[role="tablist"]')).toBeNull();
        expect(requests.map((request) => request.url)).toEqual(["/canvas-projects"]);
        await act(async () => session("user-a", true, true));
        await click("短剧");
        await act(async () => session("user-a", true, false));
        await settle();
        expect(activeView.host.querySelector('[role="tablist"]')).toBeNull();
        expect(activeView.host.querySelector('a[href="/canvas"]')).not.toBeNull();
        expect(requests.filter((request) => request.url === "/dramas")).toHaveLength(1);
    });

    test("两种查询各有空态及错误重试，失败不被错误展示为空", async () => {
        failCanvas = true;
        activeView = await mount();
        expect(activeView.host.querySelector('[role="alert"]')?.textContent).toContain("画布暂时无法读取");
        expect(activeView.host.textContent).not.toContain("还没有画布");
        await click("短剧");
        expect(activeView.host.textContent).toContain("还没有短剧");
        await click("画布");
        failCanvas = false;
        await click("重试");
        expect(activeView.host.textContent).toContain("还没有画布");
        failDrama = true;
        await act(async () => activeView!.client.invalidateQueries({ queryKey: ["my-dramas-recent"] }));
        await click("短剧");
        expect(activeView.host.querySelector('[role="alert"]')?.textContent).toContain("短剧暂时无法读取");
        failDrama = false;
        dramaData = [drama()];
        await click("重试");
        expect(activeView.host.textContent).toContain("真实短剧");
    });

    test("账号切换取消旧请求，晚到结果不会填入新 scope，也不保留跨账号 placeholder", async () => {
        let release!: () => void;
        canvasData = [canvas("old-account")];
        deferCanvas = (finish) => { release = finish; };
        activeView = await mount();
        expect(activeView.host.querySelector('[role="status"]')).not.toBeNull();
        deferCanvas = undefined;
        canvasData = [canvas("new-account")];
        await act(async () => session("user-b"));
        await settle();
        expect(requests[0].signal?.aborted).toBe(true);
        expect(requests[1].userId).toBe("user-b");
        await act(async () => release());
        await settle();
        expect(activeView.host.textContent).toContain("new-account");
        expect(activeView.host.textContent).not.toContain("old-account");
        expect(activeView.client.getQueryData(["canvas-library", "user-b", "recent-updated", 6])).toBeDefined();
        await act(async () => session(null));
        expect(activeView.host.textContent).toBe("");
    });

    test("已有卡片在账号变化时立即撤下，不沿用 QueryClient 全局 keepPreviousData", async () => {
        canvasData = [canvas("visible-user-a")];
        activeView = await mount();
        expect(activeView.host.textContent).toContain("visible-user-a");
        let release!: () => void;
        deferCanvas = (finish) => { release = finish; };
        canvasData = [canvas("visible-user-b")];
        await act(async () => session("user-b"));
        await settle();
        expect(activeView.host.textContent).not.toContain("visible-user-a");
        expect(activeView.host.querySelector('[role="status"]')).not.toBeNull();
        await act(async () => release());
        await settle();
        expect(activeView.host.textContent).toContain("visible-user-b");
    });

    test("两类作品即使接口返回超量也最多展示六项", async () => {
        canvasData = Array.from({ length: 8 }, (_, index) => canvas(`limited-${index}`));
        dramaData = Array.from({ length: 8 }, (_, index) => ({ ...drama(), project: { ...drama().project, id: `drama-${index}` } }));
        activeView = await mount();
        expect(activeView.host.querySelectorAll(".creation-recent-project-card")).toHaveLength(6);
        await click("短剧");
        expect(activeView.host.querySelectorAll(".creation-recent-project-card")).toHaveLength(6);
    });

    test("样式保持父级宽度、6/4/3/2/1 列与键盘/减弱动效合同", async () => {
        const css = await Bun.file(new URL("../src/pages/create/creation-recent-projects.css", import.meta.url)).text();
        expect(css).toContain("width: 100%");
        expect(css).not.toContain("max-width: var(--creation-stage-max-width)");
        expect(css).toContain("repeat(6, minmax(0, 1fr))");
        expect(css).toContain("repeat(4, minmax(0, 1fr))");
        expect(css).toContain("repeat(3, minmax(0, 1fr))");
        expect(css).toContain("aspect-ratio: 4 / 3;");
        expect(css).not.toContain("> :not(.creation-recent-project-cover-icon)");
        expect(css).toContain("repeat(2, minmax(0, 1fr))");
        expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
        expect(css).toContain(":focus-visible");
        expect(css).toContain("prefers-reduced-motion: reduce");
        expect(css).toContain("--recent-project-radius: var(--r-2xl)");
        expect(css).toContain("--recent-project-title-size: var(--fs-body)");
        expect(css).toContain("--recent-project-info-size: var(--typ-caption)");
        expect(css).toContain("--recent-project-surface: var(--user-surface, var(--workspace-surface))");
        expect(css).toContain("--recent-project-muted: var(--user-ink-muted, var(--workspace-text-muted))");
        expect(css).toContain("--recent-project-border: var(--user-border, var(--border))");
    });

    test("方向键切换轻量 tab 并移动焦点", async () => {
        activeView = await mount();
        const first = activeView.host.querySelector('[role="tab"]') as HTMLButtonElement;
        await act(async () => {
            first.focus();
            first.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
        await settle();
        const selected = activeView.host.querySelector('[aria-selected="true"]');
        expect(selected?.textContent).toBe("短剧");
        expect(document.activeElement).toBe(selected);
    });
});
