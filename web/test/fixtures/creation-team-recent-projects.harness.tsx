import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/teams/creation-team" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

mock.module("@/components/canvas/canvas-project-card", () => ({ ProjectPreview: () => <span data-preview /> }));
mock.module("@/components/cached-resource-image", () => ({ CachedResourceImage: () => <span /> }));
mock.module("@/lib/workspace-route-modules", () => ({ loadCanvasProjectPage: () => Promise.resolve() }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { useUserStore } = await import("@/stores/use-user-store");
const { apiClient } = await import("@/services/api/request");
const { CreationRecentProjects } = await import("@/pages/create/creation-recent-canvases");
const oldAdapter = apiClient.defaults.adapter;
const initialStore = useUserStore.getState();

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

test("团队空间仅加载自己的画布，不调用短剧接口或跳回个人库", async () => {
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url || "");
        if (config.url !== "/teams/creation-team/workspace/canvas-projects") throw new Error(`Unexpected request: ${config.url}`);
        return {
            config,
            status: 200,
            statusText: "OK",
            headers: {},
            data: {
                code: 0,
                data: { projects: [{ id: "shared-canvas", title: "团队画布", revision: 1, updatedAt: "2026-10-20T08:30:00Z", nodeCount: 1, previewNodes: [] }], page: 1, pageSize: 6, total: 1, hasMore: false },
            },
        };
    };
    useUserStore.setState({ user: { id: "member", username: "member", displayName: "Member", role: "user", status: "active" }, hydrated: true, features: { ...initialStore.features, shortDramaEnabled: true } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <MemoryRouter initialEntries={["/teams/creation-team"]}>
                        <CreationRecentProjects />
                    </MemoryRouter>
                </QueryClientProvider>,
            ),
        );
        for (let index = 0; index < 4; index += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
        expect(requests).toEqual(["/teams/creation-team/workspace/canvas-projects"]);
        expect(host.querySelector('[role="tablist"]')).toBeNull();
        expect(host.querySelector('a[href="/teams/creation-team/canvas"]')?.textContent).toBe("查看全部");
        expect(host.querySelector('a[href="/teams/creation-team/canvas/shared-canvas"]')).not.toBeNull();
        expect(host.querySelector('a[href="/canvas"]')).toBeNull();
        expect(host.textContent).not.toContain("短剧");
        expect(client.getQueryData(["canvas-library", "creation-team", "member", "recent-updated", 6])).toBeDefined();
        expect(client.getQueryData(["canvas-library", "personal", "member", "recent-updated", 6])).toBeUndefined();
    } finally {
        await act(() => root.unmount());
        client.clear();
        host.remove();
    }
});
