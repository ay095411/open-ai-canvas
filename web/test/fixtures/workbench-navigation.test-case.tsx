import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { FeatureAvailability } from "@/stores/use-user-store";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    MouseEvent: dom.MouseEvent,
    CustomEvent: dom.CustomEvent,
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
const { App, ConfigProvider } = await import("antd");
const { MemoryRouter, useLocation } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { createInstance } = await import("i18next");
const { I18nextProvider } = await import("react-i18next");
const { apiClient } = await import("@/services/api/request");
const { defaultFeatureAvailability, useUserStore } = await import("@/stores/use-user-store");
const { WorkspaceSidebarNav } = await import("@/components/layout/workspace-sidebar-nav");
const { WorkspaceCommandPalette } = await import("@/components/layout/workspace-command-palette");
const i18n = createInstance();
await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: {} } }, fallbackLng: false });
const originalAdapter = apiClient.defaults.adapter;
const originalUser = useUserStore.getState();
let view: Awaited<ReturnType<typeof mount>> | undefined;
let closeCount = 0;
const unexpectedRequests: string[] = [];

beforeEach(() => {
    closeCount = 0;
    unexpectedRequests.length = 0;
    useUserStore.setState({
        hydrated: true,
        user: { id: "navigation-user", username: "navigation-user", displayName: "导航验证用户", role: "user", status: "active" },
        features: { ...defaultFeatureAvailability, creditsEnabled: false },
    });
    apiClient.defaults.adapter = async (config) => {
        if (config.url !== "/announcements" || config.method !== "get") {
            unexpectedRequests.push(`${config.method} ${config.url}`);
            throw new Error(`Unexpected navigation request: ${config.url}`);
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { announcements: [], unreadCount: 0 } } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState(originalUser);
    expect(unexpectedRequests).toEqual([]);
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function settle() {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
}

async function mount(features: Partial<FeatureAvailability>, { path = "/", collapsed = false } = {}) {
    useUserStore.setState({ features: { ...useUserStore.getState().features, ...features } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    function Location() {
        return <output data-current-route>{useLocation().pathname}</output>;
    }
    await act(async () => {
        root.render(
            <I18nextProvider i18n={i18n}>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <MemoryRouter initialEntries={[path]}>
                            <QueryClientProvider client={client}>
                                <section data-sidebar>
                                    <WorkspaceSidebarNav collapsed={collapsed} onNavigate={() => {}} onOpenSearch={() => {}} onExpand={() => {}} onCollapse={() => {}} />
                                </section>
                                <section data-palette>
                                    <WorkspaceCommandPalette
                                        open
                                        onClose={() => {
                                            closeCount += 1;
                                        }}
                                    />
                                </section>
                                <Location />
                            </QueryClientProvider>
                        </MemoryRouter>
                    </App>
                </ConfigProvider>
            </I18nextProvider>,
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

function sidebarLink(id: string) {
    return view!.host.querySelector<HTMLAnchorElement>(`[data-sidebar] a[data-nav-id="${id}"]`);
}

function paletteButton(title: string) {
    return Array.from(view!.host.querySelectorAll<HTMLButtonElement>("[data-palette] li button")).find((button) => button.textContent === title);
}

function assertRoute(path: string, id: string) {
    expect(view!.host.querySelector("[data-current-route]")?.textContent).toBe(path);
    expect(Array.from(view!.host.querySelectorAll('[data-sidebar] a[aria-current="page"]'), (link) => link.getAttribute("data-nav-id"))).toEqual([id]);
}

for (const imageWorkbenchEnabled of [false, true]) {
    for (const videoWorkbenchEnabled of [false, true]) {
        for (const ecommerceEnabled of [false, true]) {
            test(`navigation matrix I=${imageWorkbenchEnabled} V=${videoWorkbenchEnabled} E=${ecommerceEnabled}`, async () => {
                view = await mount({ imageWorkbenchEnabled, videoWorkbenchEnabled, ecommerceEnabled });
                const hasStudio = imageWorkbenchEnabled || videoWorkbenchEnabled;
                const studioPath = imageWorkbenchEnabled ? "/toolbox/image" : "/toolbox/video";
                const expectedIds = ["home", ...(hasStudio ? ["toolbox"] : []), "canvas", "projects", ...(ecommerceEnabled ? ["ecommerce"] : [])];
                expect(Array.from(view.host.querySelectorAll('[data-nav-group-heading=""] [data-nav-id]'), (link) => link.getAttribute("data-nav-id"))).toEqual(expectedIds);
                expect(Array.from(view.host.querySelectorAll("[data-palette] li button"), (button) => button.textContent).slice(0, expectedIds.length)).toEqual([
                    "首页",
                    ...(hasStudio ? ["创作影棚"] : []),
                    "画布",
                    "短剧 Agent",
                    ...(ecommerceEnabled ? ["电商Agent"] : []),
                ]);
                expect(Boolean(sidebarLink("toolbox"))).toBe(hasStudio);
                expect(Boolean(paletteButton("创作影棚"))).toBe(hasStudio);
                expect(Boolean(sidebarLink("ecommerce"))).toBe(ecommerceEnabled);
                expect(Boolean(paletteButton("电商Agent"))).toBe(ecommerceEnabled);

                if (hasStudio) {
                    expect(sidebarLink("toolbox")?.getAttribute("href")).toBe(studioPath);
                    expect(sidebarLink("toolbox")?.textContent).toContain("创作影棚");
                    await act(async () => sidebarLink("toolbox")!.click());
                    assertRoute(studioPath, "toolbox");
                    await act(async () => sidebarLink("home")!.click());
                    await act(async () => paletteButton("创作影棚")!.click());
                    assertRoute(studioPath, "toolbox");
                }
                if (ecommerceEnabled) {
                    expect(sidebarLink("ecommerce")?.getAttribute("href")).toBe("/ecommerce");
                    expect(sidebarLink("ecommerce")?.textContent).toContain("电商Agent");
                    expect(sidebarLink("ecommerce")?.querySelector(".app-workspace-nav-badge.is-new")?.textContent).toBe("NEW");
                    expect(sidebarLink("ecommerce")?.querySelector(".app-workspace-nav-badge")?.getAttribute("title")).toBe("电商Agent · 新上线");
                    await act(async () => sidebarLink("ecommerce")!.click());
                    assertRoute("/ecommerce", "ecommerce");
                    await act(async () => sidebarLink("home")!.click());
                    await act(async () => paletteButton("电商Agent")!.click());
                    assertRoute("/ecommerce", "ecommerce");
                }
                expect(closeCount).toBe(Number(hasStudio) + Number(ecommerceEnabled));
            });
        }
    }
}

test("feature refresh changes the studio destination and leaves ecommerce available", async () => {
    view = await mount({ imageWorkbenchEnabled: true, videoWorkbenchEnabled: true, ecommerceEnabled: true });
    await act(async () => useUserStore.setState({ features: { ...useUserStore.getState().features, imageWorkbenchEnabled: false } }));
    expect(sidebarLink("toolbox")?.getAttribute("href")).toBe("/toolbox/video");
    await act(async () => paletteButton("创作影棚")!.click());
    assertRoute("/toolbox/video", "toolbox");
    await act(async () => useUserStore.setState({ features: { ...useUserStore.getState().features, videoWorkbenchEnabled: false } }));
    expect(sidebarLink("toolbox")).toBeNull();
    expect(paletteButton("创作影棚")).toBeUndefined();
    expect(sidebarLink("ecommerce")).not.toBeNull();
    await act(async () => paletteButton("电商Agent")!.click());
    assertRoute("/ecommerce", "ecommerce");
});

test("collapsed navigation keeps independent studio and ecommerce labels and highlights", async () => {
    view = await mount({ imageWorkbenchEnabled: true, videoWorkbenchEnabled: true, ecommerceEnabled: true }, { path: "/toolbox/video", collapsed: true });
    assertRoute("/toolbox/video", "toolbox");
    expect(sidebarLink("toolbox")?.textContent).toContain("影棚");
    expect(sidebarLink("toolbox")?.getAttribute("aria-label")).toContain("创作影棚");
    expect(sidebarLink("ecommerce")?.textContent).toContain("电商");
    expect(sidebarLink("ecommerce")?.getAttribute("aria-label")).toContain("电商Agent");
    expect(sidebarLink("ecommerce")?.getAttribute("aria-label")).toContain("新上线");
    expect(sidebarLink("ecommerce")?.querySelector(".app-workspace-nav-badge-dot.is-new")).not.toBeNull();
    expect(sidebarLink("ecommerce")?.querySelector(".app-workspace-nav-badge")).toBeNull();
    await act(async () => sidebarLink("ecommerce")!.click());
    assertRoute("/ecommerce", "ecommerce");
});

test("short drama visibility stays consistent across the sidebar and command palette", async () => {
    view = await mount({ imageWorkbenchEnabled: true, videoWorkbenchEnabled: false, ecommerceEnabled: true, shortDramaEnabled: false });
    expect(sidebarLink("projects")).toBeNull();
    expect(paletteButton("短剧 Agent")).toBeUndefined();
    expect(Array.from(view.host.querySelectorAll('[data-nav-group-heading=""] [data-nav-id]'), (link) => link.getAttribute("data-nav-id"))).toEqual(["home", "toolbox", "canvas", "ecommerce"]);
    await act(async () => useUserStore.setState({ features: { ...useUserStore.getState().features, shortDramaEnabled: true } }));
    expect(sidebarLink("projects")).not.toBeNull();
    expect(paletteButton("短剧 Agent")).toBeDefined();
    await act(async () => paletteButton("短剧 Agent")!.click());
    assertRoute("/projects", "projects");
});
