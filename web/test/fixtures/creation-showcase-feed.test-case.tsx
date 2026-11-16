import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { AxiosAdapter } from "axios";
import type { CreationMode } from "@/lib/creation-mode";
import type { OnlineGalleryDetail, OnlineGallerySummary } from "@/services/api/online-gallery";
import type { ZzaiGalleryDetail, ZzaiGalleryPage, ZzaiGallerySummary } from "@/services/api/zzai-gallery";
import { authorizedEntry, authorizedMedia, authorizedSummary, policyVersion } from "./authorized-inspirations";

const dom = new Window({ url: "http://localhost/create" });
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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient, ApiError } = await import("@/services/api/request");
const { useInspirationStore } = await import("@/stores/use-inspiration-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { getActiveUserScope, setActiveUserScope } = await import("@/lib/user-scope");
const { CreationShowcaseBand } = await import("@/pages/create/creation-showcase-band");
const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
const originalStore = useInspirationStore.getState();
const originalStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState().user;
const originalScope = getActiveUserScope();
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let items: ZzaiGalleryDetail[];
let onlineItems: OnlineGalleryDetail[];
let listPages: Record<string, ZzaiGalleryPage> | undefined;
let failList = false;
let listFailure: Error | undefined;
let failFacets = false;
let failDetail = false;
let failCopy = false;
let copied: string[] = [];
let calls: Array<{ url: string; mediaType?: string; category?: string; model?: string; sort?: string; search?: string; cursor?: string; limit?: number }>;
let staticRequests: string[];
let clipboardSpy: ReturnType<typeof spyOn<typeof navigator.clipboard, "writeText">> | undefined;
let view: Awaited<ReturnType<typeof mount>> | undefined;
const previewCleanups: Array<() => void> = [];

function entry(slug: string, patch: Partial<ZzaiGalleryDetail> = {}): ZzaiGalleryDetail {
    return authorizedEntry(slug, {
        title: `在线 ${slug}`,
        ...patch,
    });
}

function summary(item: ZzaiGalleryDetail): ZzaiGallerySummary {
    return authorizedSummary(item);
}

function onlineEntry(slug: string, patch: Partial<OnlineGalleryDetail> = {}): OnlineGalleryDetail {
    return {
        id: `zzai-gallery:${slug}`,
        slug,
        sourceId: "zzai-gallery",
        title: `社区 ${slug}`,
        description: "真实在线协议测试条目",
        mode: "image",
        image: `https://cdn.example.com/${slug}.webp`,
        width: 800,
        height: 600,
        model: "社区图片模型",
        category: "portrait",
        credit: `社区作者 ${slug}`,
        sourceUrl: `https://example.com/works/${slug}`,
        galleryUrl: `https://api.seedance.nz/prompt-gallery/${slug}`,
        prompt: `Current online prompt for ${slug}.`,
        promptZh: `${slug} 的在线中文提示词。`,
        ...patch,
    };
}

function onlineSummary(item: OnlineGalleryDetail): OnlineGallerySummary {
    const { prompt: _prompt, promptZh: _promptZh, ...result } = item;
    return result;
}

function signIn(scope: string) {
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: scope, displayName: scope, role: "user", status: "active" } });
    useInspirationStore.setState({ hydrated: true, hydrationScope: scope, hydrationError: "", favorites: [], externalFavorites: [] });
}

beforeEach(async () => {
    items = [entry("latest")];
    onlineItems = [onlineEntry("community-latest")];
    listPages = undefined;
    failList = false;
    listFailure = undefined;
    failFacets = false;
    failDetail = false;
    failCopy = false;
    copied = [];
    calls = [];
    staticRequests = [];
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    signIn("showcase-user");
    clipboardSpy = spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
        if (failCopy) throw new Error("Clipboard access denied");
        copied.push(text);
    });
    globalThis.fetch = (async (input) => {
        staticRequests.push(String(input));
        throw new Error("Legacy static catalogs must not load");
    }) as typeof fetch;
    apiClient.defaults.adapter = async (config) => {
        calls.push({
            url: config.url!,
            mediaType: config.params?.media_type,
            category: config.params?.category,
            model: config.params?.model,
            sort: config.params?.sort,
            search: config.params?.search,
            cursor: config.params?.cursor,
            limit: config.params?.limit,
        });
        let data: unknown;
        if (config.url?.includes("/zzai-gallery/")) {
            if (config.url.endsWith("/facets")) {
                if (failFacets) throw new Error("Online facets unavailable");
                const selected = onlineItems.filter((item) => !config.params?.media_type || item.mode === config.params.media_type);
                data = { categories: [...new Set(selected.map((item) => item.category).filter(Boolean))], models: [...new Set(selected.map((item) => item.model).filter(Boolean))], tags: [], total: selected.length };
            } else if (config.url.endsWith("/prompts")) {
                if (failList) throw listFailure ?? new Error("Online list unavailable");
                const selected = onlineItems.filter(
                    (item) =>
                        (!config.params?.media_type || item.mode === config.params.media_type) &&
                        (!config.params?.category || item.category === config.params.category) &&
                        (!config.params?.model || item.model === config.params.model) &&
                        (!config.params?.search || [item.title, item.description, item.prompt, item.promptZh].join(" ").toLowerCase().includes(String(config.params.search).toLowerCase())),
                );
                const offset = Number(config.params?.cursor || 0);
                const limit = config.params?.limit ?? 24;
                data = { items: selected.slice(offset, offset + limit).map(onlineSummary), total: selected.length, nextCursor: offset + limit < selected.length ? String(offset + limit) : "" };
            } else {
                if (failDetail) throw new Error("Online detail unavailable");
                data = onlineItems.find((item) => item.slug === config.url!.split("/").at(-1));
            }
        } else if (config.url?.endsWith("/library/facets")) {
            if (failFacets) throw new Error("Online facets unavailable");
            const selected = items.filter((item) => !config.params?.media_type || item.mode === config.params.media_type);
            data = { policyVersion, categories: [...new Set(selected.map((item) => item.category).filter(Boolean))], models: [...new Set(selected.map((item) => item.model).filter(Boolean))], tags: [], total: selected.length };
        } else if (config.url?.endsWith("/library/prompts")) {
            if (failList) throw listFailure ?? new Error("Online list unavailable");
            const selected = items.filter(
                (item) =>
                    (!config.params?.media_type || item.mode === config.params.media_type) &&
                    (!config.params?.category || item.category === config.params.category) &&
                    (!config.params?.model || item.model === config.params.model) &&
                    (!config.params?.search || [item.title, item.description, item.prompt, item.promptZh].join(" ").toLowerCase().includes(String(config.params.search).toLowerCase())),
            );
            const cursor = config.params?.cursor ?? "";
            const offset = Number(cursor || 0);
            const limit = config.params?.limit ?? 24;
            data = listPages ? listPages[cursor] : { policyVersion, items: selected.slice(offset, offset + limit).map(summary), total: selected.length, nextCursor: offset + limit < selected.length ? String(offset + limit) : "" };
            if (!data) throw new Error(`Unexpected page cursor: ${cursor}`);
        } else if (config.url?.includes("/library/prompts/")) {
            if (failDetail) throw new Error("Online detail unavailable");
            data = items.find((item) => item.slug === config.url!.split("/").at(-1));
        } else if (config.url?.endsWith("/library/resolve")) {
            const ids = (JSON.parse(config.data) as { ids: string[] }).ids;
            data = { policyVersion, items: items.filter((item) => ids.includes(item.id)).map(summary) };
        } else throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    for (const restore of previewCleanups.splice(0).reverse()) restore();
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    clipboardSpy?.mockRestore();
    clipboardSpy = undefined;
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState(originalStore);
    useInspirationStore.persist.setOptions({ storage: originalStorage });
    useUserStore.setState({ user: originalUser });
    setActiveUserScope(originalScope);
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});
async function settle() {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function until(check: () => boolean) {
    for (let n = 0; n < 40; n += 1) {
        if (check()) return;
        await settle();
    }
    expect(check()).toBe(true);
}

async function mount(mode: CreationMode = "image", sourcesVisible = true, onlineSource = false, gcTime = 0) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime } } });
    const started: { mode: string; prompt: string }[] = [];
    const startedWithOpenDialog: boolean[] = [];
    let mountKey = 0;
    const startPrompt = (mode: CreationMode, prompt: string) => {
        startedWithOpenDialog.push(visibleDialogs().length > 0);
        started.push({ mode, prompt });
        host.querySelector<HTMLTextAreaElement>("[data-creation-prompt]")?.focus();
    };
    const render = async (currentMode: CreationMode) => {
        await act(async () => {
            root.render(
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <MemoryRouter initialEntries={["/create"]}>
                            <QueryClientProvider client={client}>
                                <textarea data-creation-prompt data-creation-mode={currentMode} aria-label="创作提示词" />
                                <CreationShowcaseBand key={mountKey} initialSource={onlineSource ? undefined : "authorized-library"} sourcesVisible={sourcesVisible} onStartPrompt={startPrompt} />
                            </QueryClientProvider>
                        </MemoryRouter>
                    </App>
                </ConfigProvider>,
            );
        });
    };
    await render(mode);
    await settle();
    await until(() => client.isFetching() === 0 && !host.textContent?.includes("正在加载在线提示词示例…"));
    return {
        host,
        client,
        started,
        startedWithOpenDialog,
        async remount() {
            mountKey += 1;
            await render(mode);
        },
        async setMode(next: CreationMode) {
            await render(next);
            await settle();
            await until(() => client.isFetching() === 0 && !host.textContent?.includes("正在加载在线提示词示例…"));
        },
        async dispose() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

function cards() {
    return [...view!.host.querySelectorAll<HTMLButtonElement>(".creation-showcase-waterfall .creation-showcase-card")];
}
function visibleDialogs() {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((node) => node.style.display !== "none" && node.closest<HTMLElement>(".ant-modal-wrap")?.style.display !== "none");
}
function dialog() {
    expect(visibleDialogs()).toHaveLength(1);
    return visibleDialogs()[0];
}
function buttonNamed(container: ParentNode, name: string) {
    const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => {
        for (let p: HTMLElement | null = node; p; p = p.parentElement) if (p.hidden || p.style.display === "none") return false;
        return node.getAttribute("aria-label") === name || node.textContent?.replace(/\s/g, "") === name;
    });
    expect(result).toBeDefined();
    return result!;
}
async function click(node: HTMLElement) {
    await act(async () => node.click());
    await settle();
}
async function previewFirst() {
    await click(cards()[0]);
    await until(() => visibleDialogs().length === 1 && Boolean(visibleDialogs()[0].querySelector(".inspiration-detail")));
}
async function usePreview() {
    const startedCount = view!.started.length;
    await click(buttonNamed(dialog().querySelector(".inspiration-detail")!, "带进创作区"));
    await until(() => visibleDialogs().length === 0);
    await until(() => view!.started.length === startedCount + 1);
    expect(view!.startedWithOpenDialog.every((open) => !open)).toBe(true);
    expect(document.activeElement).toBe(view!.host.querySelector("[data-creation-prompt]"));
}
async function openHall() {
    await click(buttonNamed(view!.host, "灵感大厅"));
    await until(() => Boolean(visibleDialogs()[0]?.querySelector(".inspiration-gallery article")));
}

const listCalls = () => calls.filter((call) => call.url.endsWith("/library/prompts"));
const facetCalls = () => calls.filter((call) => call.url.endsWith("/library/facets"));
function lastListCall() {
    const request = listCalls().at(-1);
    expect(request).toBeDefined();
    return request!;
}
async function chooseMedia(label: "全部" | "图片" | "视频") {
    const group = view!.host.querySelector<HTMLElement>('[aria-label="首页示例媒体类型"]');
    expect(group).not.toBeNull();
    await click(buttonNamed(group!, label));
}
async function chooseSelect(label: string, optionText: string) {
    const input = view!.host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    await act(async () => input!.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    await until(() => [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].some((node) => node.textContent?.trim() === optionText));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((node) => node.textContent?.trim() === optionText);
    expect(option).toBeDefined();
    await click(option!);
}
async function enterSearch(value: string) {
    const input = view!.host.querySelector<HTMLInputElement>('input[aria-label="搜索首页在线示例"]');
    expect(input).not.toBeNull();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input!.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

function controlMotionPreference(initial: boolean) {
    const originalMatchMedia = window.matchMedia.bind(window);
    const query = originalMatchMedia("(prefers-reduced-motion: reduce)");
    let matches = initial;
    Object.defineProperty(query, "matches", { configurable: true, get: () => matches });
    const matchMedia = spyOn(window, "matchMedia").mockImplementation((value) => (value.includes("prefers-reduced-motion") ? query : originalMatchMedia(value)));
    previewCleanups.push(() => matchMedia.mockRestore());
    return async (reduced: boolean) => {
        await act(async () => {
            matches = reduced;
            const event = new dom.Event("change");
            Object.defineProperties(event, { matches: { value: reduced }, media: { value: query.media } });
            query.dispatchEvent(event);
        });
    };
}

function controlVideo(card: HTMLButtonElement, playImplementation: () => Promise<void> = async () => {}) {
    const video = card.querySelector<HTMLVideoElement>("video.creation-showcase-video");
    expect(video).not.toBeNull();
    const play = spyOn(video!, "play").mockImplementation(playImplementation);
    const pause = spyOn(video!, "pause").mockImplementation(() => {});
    previewCleanups.push(
        () => play.mockRestore(),
        () => pause.mockRestore(),
    );
    return { video: video!, play, pause };
}

async function hoverCard(card: HTMLButtonElement) {
    await act(async () => card.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
}

async function leaveCard(card: HTMLButtonElement) {
    await act(async () => card.dispatchEvent(new dom.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body })));
}

async function videoEvent(video: HTMLVideoElement, type: "playing" | "error") {
    await act(async () => video.dispatchEvent(new dom.Event(type)));
}

test("the default homepage browses the live online source with real filter parameters and cursor pagination", async () => {
    onlineItems = [
        ...Array.from({ length: 24 }, (_, index) => onlineEntry(`community-video-${index}`, { title: `电影关键词 ${index}`, mode: "video", category: "story", model: "社区视频模型", videoUrl: `https://cdn.example.com/community-video-${index}.mp4` })),
        onlineEntry("excluded-image"),
    ];
    view = await mount("image", false, true);
    expect(cards()).toHaveLength(21);
    expect(calls.every((call) => call.url.includes("/zzai-gallery/"))).toBe(true);
    expect(view.host.querySelector('[aria-label="首页示例来源"]')?.closest(".ant-select")?.textContent).toContain("在线图库");
    expect(view.host.querySelectorAll('[aria-label="示例来源与授权提示"]')).toHaveLength(21);
    expect(view.host.querySelector('[aria-label="素材署名与许可"]')).toBeNull();
    expect(view.host.textContent).toContain("本站未核验其转载或商用授权");
    await chooseMedia("视频");
    await chooseSelect("首页示例分类", "故事");
    await chooseSelect("首页示例模型标注", "社区视频模型");
    await chooseSelect("首页示例排序", "精选");
    await enterSearch("  电影关键词  ");
    expect(cards().every((card) => card.disabled)).toBe(true);
    await until(() => calls.at(-1)?.search === "电影关键词" && cards().length === 21);
    const expected = { url: "/public/inspirations/zzai-gallery/prompts", mediaType: "video", category: "story", model: "社区视频模型", sort: "featured", search: "电影关键词", limit: 21 };
    expect(calls.at(-1)).toMatchObject(expected);
    const firstPage = cards();
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 24);
    expect(calls.at(-1)).toMatchObject({ ...expected, cursor: "21" });
    expect(cards().slice(0, 21)).toEqual(firstPage);
    expect(view.host.textContent).not.toContain("excluded-image");
    expect(view.host.textContent).toContain("已展示 24 个示例");
    expect(staticRequests).toEqual([]);
});

test("default online preview preserves provenance and copies then uses freshly fetched details", async () => {
    onlineItems = [onlineEntry("online-preview", { mode: "video", videoUrl: "https://cdn.example.com/online-preview.mp4" })];
    view = await mount("image", false, true);
    const detailRequests = () => calls.filter((call) => call.url === "/public/inspirations/zzai-gallery/prompts/online-preview");
    expect(detailRequests()).toHaveLength(0);
    await previewFirst();
    expect(detailRequests()).toHaveLength(1);
    expect(dialog().textContent).toContain(onlineItems[0].promptZh!);
    expect(dialog().textContent).toContain("授权未核验");
    expect(dialog().querySelector(`a[href="${onlineItems[0].sourceUrl}"]`)).not.toBeNull();
    expect(dialog().querySelector("video")?.getAttribute("src")).toBe(onlineItems[0].videoUrl!);
    onlineItems[0] = { ...onlineItems[0], promptZh: "复制时重新读取的在线版本。" };
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(detailRequests()).toHaveLength(2);
    expect(copied).toEqual(["复制时重新读取的在线版本。"]);
    onlineItems[0] = { ...onlineItems[0], promptZh: "弹窗关闭后重新读取的带入版本。" };
    await usePreview();
    expect(detailRequests()).toHaveLength(3);
    expect(view.started).toEqual([{ mode: "video", prompt: onlineItems[0].promptZh! }]);
    expect(calls.some((call) => call.url.includes("/library/"))).toBe(false);
});

test("switching homepage sources keeps the approved library available without mixing identities or old cursors", async () => {
    onlineItems = Array.from({ length: 24 }, (_, index) => onlineEntry(`same-slug-${index}`));
    items = [entry("same-slug-0", { title: "本站核验作品" })];
    view = await mount("image", false, true);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 24);
    await chooseSelect("首页示例来源", "本站审核库");
    await until(() => cards().length === 1 && Boolean(cards()[0].textContent?.includes("本站核验作品")));
    expect(lastListCall().cursor).toBeUndefined();
    expect(view.host.querySelector('[data-inspiration-id="authorized-library:same-slug-0"]')).not.toBeNull();
    expect(view.host.querySelector('[data-inspiration-id^="zzai-gallery:"]')).toBeNull();
    expect(view.host.textContent).toContain("CC BY 4.0");
    await previewFirst();
    expect(calls.some((call) => call.url === "/public/inspirations/library/prompts/same-slug-0")).toBe(true);
    await click(buttonNamed(dialog(), "关闭灵感弹窗"));
    await until(() => visibleDialogs().length === 0);
    await chooseSelect("首页示例来源", "在线图库");
    await until(() => cards().length > 0 && Boolean(view!.host.querySelector('[data-inspiration-id="zzai-gallery:same-slug-0"]')));
    expect(view.host.querySelector('[data-inspiration-id^="authorized-library:"]')).toBeNull();
    expect(view.host.querySelector('[aria-label="素材署名与许可"]')).toBeNull();
    expect(view.host.textContent).toContain("授权未核验");
});

test.each(["source", "media"] as const)("homepage cached %s revisit fetches again and hides the previous revision until verification finishes", async (dimension) => {
    items = [entry("cached-source-image"), entry("cached-source-video", { mode: "video", videoUrl: authorizedMedia("cached-source-video", "video") })];
    onlineItems = [onlineEntry("cached-online-image"), onlineEntry("cached-online-video", { mode: "video", videoUrl: "https://cdn.example.com/cached-online-video.mp4" })];
    const onlineSource = dimension === "media";
    const endpoint = `/public/inspirations/${onlineSource ? "zzai-gallery" : "library"}/prompts`;
    view = await mount("image", false, onlineSource, 60_000);
    const originalQuery = view.client
        .getQueryCache()
        .getAll()
        .find((query) => query.queryKey.includes("showcase"))!;
    expect(originalQuery.state.data).toBeDefined();
    const originalTitle = cards()[0].querySelector("strong")!.textContent!;
    if (dimension === "source") await chooseSelect("首页示例来源", "在线图库");
    else await chooseMedia("视频");
    await until(() => view!.client.isFetching() === 0);
    expect(view.client.getQueryData(originalQuery.queryKey)).toBeDefined();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    let requested = false;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url === endpoint && !config.params?.media_type) {
            requested = true;
            response.data.data.items = response.data.data.items.map((item: ZzaiGallerySummary | OnlineGallerySummary, index: number) => (index === 0 ? { ...item, title: "回访核验后的首页作品" } : item));
            await pending;
        }
        return response;
    };
    try {
        if (dimension === "source") await chooseSelect("首页示例来源", "本站审核库");
        else await chooseMedia("全部");
        await until(() => requested);
        expect(cards()).toHaveLength(0);
        expect(view.host.textContent).not.toContain(originalTitle);
        expect(view.host.textContent).toContain("正在核验在线示例");
        expect(view.client.isFetching()).toBeGreaterThan(0);
        await act(async () => release());
        await until(() => cards().length === 2 && Boolean(cards()[0].textContent?.includes("回访核验后的首页作品")));
        expect(view.client.getQueryData(originalQuery.queryKey)).toBeDefined();
        expect(calls.filter((call) => call.url === endpoint && !call.mediaType && !call.cursor)).toHaveLength(2);
    } finally {
        release();
    }
});

test("video preview keeps its poster until playback starts and restores it on keyboard blur", async () => {
    controlMotionPreference(false);
    items = [entry("keyboard-video", { mode: "video", videoUrl: authorizedMedia("keyboard-video", "video") })];
    view = await mount();
    const card = cards()[0];
    const poster = card.querySelector("img");
    expect(poster?.getAttribute("src")).toBe(items[0].image);
    const { video, play, pause } = controlVideo(card);
    expect(video.getAttribute("preload")).toBe("none");
    await act(async () => card.focus());
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.getAttribute("data-playing")).not.toBe("true");
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("true");
    expect(card.querySelector("img")).toBe(poster);
    await act(async () => card.blur());
    expect(pause).toHaveBeenCalled();
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    expect(card.querySelector("img")).toBe(poster);
});

test("a verified media revision resets active playback when the same card receives a new video source", async () => {
    controlMotionPreference(false);
    items = [entry("revised-video", { mode: "video", videoUrl: authorizedMedia("revised-video", "video") })];
    view = await mount();
    const card = cards()[0];
    const poster = card.querySelector("img");
    const { video, play, pause } = controlVideo(card);
    await hoverCard(card);
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("true");
    const previousPauses = pause.mock.calls.length;
    items[0] = {
        ...items[0],
        image: authorizedMedia("revised-video", "image", 2),
        videoUrl: authorizedMedia("revised-video", "video", 2),
        authorization: { ...items[0].authorization, revision: 2, contentHash: "d".repeat(64) },
    };
    await act(async () => {
        await view!.client.refetchQueries({ predicate: (query) => query.queryKey.includes("showcase") });
    });
    await until(() => video.getAttribute("src") === items[0].videoUrl);
    expect(cards()[0]).toBe(card);
    expect(card.querySelector("video")).toBe(video);
    expect(pause.mock.calls.length).toBeGreaterThan(previousPauses);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.getAttribute("data-playing")).toBe("false");
    expect(card.querySelector("img")).toBe(poster);
    expect(poster?.getAttribute("src")).toBe(items[0].image);
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("false");
});

test("video decode failure falls back to the poster and unavailable media never disables detail access", async () => {
    controlMotionPreference(false);
    items = [entry("broken-video", { mode: "video", videoUrl: authorizedMedia("broken-video", "video") })];
    view = await mount();
    const card = cards()[0];
    const { video } = controlVideo(card);
    await hoverCard(card);
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("true");
    await videoEvent(video, "error");
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    const poster = card.querySelector("img");
    expect(poster?.getAttribute("src")).toBe(items[0].image);
    await act(async () => poster!.dispatchEvent(new dom.Event("error")));
    expect(card.textContent).toContain("封面暂不可用");
    expect(card.disabled).toBe(false);
    await previewFirst();
    expect(dialog().textContent).toContain(items[0].promptZh!);
});

test("a rejected autoplay request leaves the original poster and detail action usable", async () => {
    controlMotionPreference(false);
    items = [entry("autoplay-denied", { mode: "video", videoUrl: authorizedMedia("autoplay-denied", "video") })];
    view = await mount();
    const card = cards()[0];
    const { play } = controlVideo(card, async () => {
        throw new Error("Autoplay permission denied");
    });
    await hoverCard(card);
    expect(play).toHaveBeenCalledTimes(1);
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(items[0].image);
    expect(card.disabled).toBe(false);
    await previewFirst();
    expect(dialog().textContent).toContain(items[0].promptZh!);
});

test("reduced motion prevents hover and focus autoplay and a live preference change stops playback", async () => {
    const setReducedMotion = controlMotionPreference(true);
    items = [entry("motion-video", { mode: "video", videoUrl: authorizedMedia("motion-video", "video") })];
    view = await mount();
    const card = cards()[0];
    const { video, play, pause } = controlVideo(card);
    await hoverCard(card);
    await act(async () => card.focus());
    expect(play).not.toHaveBeenCalled();
    await leaveCard(card);
    await act(async () => card.blur());
    await setReducedMotion(false);
    await hoverCard(card);
    expect(play).toHaveBeenCalledTimes(1);
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("true");
    const previousPauses = pause.mock.calls.length;
    await setReducedMotion(true);
    expect(pause.mock.calls.length).toBeGreaterThan(previousPauses);
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(items[0].image);
});

test("late playback after pointer leave cannot reveal or restart an abandoned video preview", async () => {
    controlMotionPreference(false);
    items = [entry("late-video", { mode: "video", videoUrl: authorizedMedia("late-video", "video") })];
    view = await mount();
    const card = cards()[0];
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const { video, play, pause } = controlVideo(card, () => pending);
    await hoverCard(card);
    expect(play).toHaveBeenCalledTimes(1);
    await leaveCard(card);
    const previousPauses = pause.mock.calls.length;
    await act(async () => release());
    await videoEvent(video, "playing");
    expect(pause.mock.calls.length).toBeGreaterThan(previousPauses);
    expect(play).toHaveBeenCalledTimes(1);
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    expect(card.querySelector("img")?.getAttribute("src")).toBe(items[0].image);
});

test("pending keyword filtering stops an active video and prevents opening the stale card", async () => {
    controlMotionPreference(false);
    items = [entry("search-video", { mode: "video", videoUrl: authorizedMedia("search-video", "video") })];
    view = await mount();
    const card = cards()[0];
    const { video, pause } = controlVideo(card);
    await hoverCard(card);
    await videoEvent(video, "playing");
    expect(video.getAttribute("data-playing")).toBe("true");
    const previousPauses = pause.mock.calls.length;
    await enterSearch("尚未应用的搜索条件");
    expect(card.disabled).toBe(true);
    expect(pause.mock.calls.length).toBeGreaterThan(previousPauses);
    expect(card.querySelector('.creation-showcase-video[data-playing="true"]')).toBeNull();
    await click(card);
    expect(visibleDialogs()).toHaveLength(0);
    expect(calls.some((call) => call.url.endsWith("/prompts/search-video"))).toBe(false);
});

test("primary browsing and secondary refinements retain accessible controls and visible model context", async () => {
    const title = "完整保留供详情和辅助技术读取的超长在线示例标题";
    items = [entry("hierarchy-image", { title, model: "示例图片模型" })];
    view = await mount();
    const primary = view.host.querySelector(".creation-showcase-filter-primary");
    const secondary = view.host.querySelector(".creation-showcase-filter-secondary");
    expect(primary?.querySelector('[aria-label="首页示例媒体类型"]')).not.toBeNull();
    expect(primary?.querySelector('[aria-label="搜索首页在线示例"]')).not.toBeNull();
    for (const label of ["首页示例分类", "首页示例模型标注", "首页示例排序"]) expect(secondary?.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    expect(cards()[0].getAttribute("aria-label")).toBe(`预览灵感：${title}`);
    expect(cards()[0].querySelector(".creation-showcase-copy strong")?.textContent).toBe(title);
    expect(cards()[0].querySelector(".creation-showcase-copy")?.children).toHaveLength(2);
    expect(cards()[0].querySelector(".creation-showcase-copy")?.textContent).toContain("示例图片模型");
    await chooseSelect("首页示例模型标注", "示例图片模型");
    expect(lastListCall().model).toBe("示例图片模型");
    await click(buttonNamed(secondary!, "清除筛选"));
    await until(() => lastListCall().model === undefined && cards().length === 1);
    expect(lastListCall().cursor).toBeUndefined();
});

test("homepage reads only bounded online summaries, preserving compact cards and detail-first creation", async () => {
    view = await mount();
    expect(listCalls()).toEqual([{ url: "/public/inspirations/library/prompts", mediaType: undefined, category: undefined, model: undefined, sort: "latest", search: undefined, cursor: undefined, limit: 21 }]);
    expect(facetCalls()).toHaveLength(1);
    expect(facetCalls()[0].mediaType).toBeUndefined();
    expect(staticRequests).toEqual([]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector(".creation-showcase-copy")?.children).toHaveLength(2);
    expect(cards()[0].textContent).toContain("图片 · 人物肖像");
    expect(cards()[0].querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(view.host.textContent).not.toContain("雨巷旗袍");
    await previewFirst();
    expect(calls.filter((call) => call.url.endsWith("/prompts/latest"))).toHaveLength(1);
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(dialog().querySelector(`a[href="${items[0].sourceUrl}"]`)).not.toBeNull();
    expect(view.started).toEqual([]);
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(copied).toEqual([items[0].promptZh!]);
    await usePreview();
    expect(view.started).toEqual([{ mode: "image", prompt: items[0].promptZh! }]);
});

test("empty online data shows an honest empty state rather than legacy filler", async () => {
    items = [];
    view = await mount();
    expect(cards()).toHaveLength(0);
    expect(view.host.textContent).toContain("尚未发布已核验素材");
    expect(view.host.textContent).not.toContain("内置示例");
    expect(buttonNamed(view.host, "灵感大厅")).toBeDefined();
    expect(staticRequests).toEqual([]);
});

test("upstream list failure has no old fallback and retry loads genuine online entries", async () => {
    failList = true;
    view = await mount();
    expect(cards()).toHaveLength(0);
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.host.textContent).not.toContain("尚未发布已核验素材");
    failList = false;
    await click(buttonNamed(view.host, "重新加载"));
    await until(() => cards().length === 1);
    expect(cards()[0].textContent).toContain("在线 latest");
    expect(staticRequests).toEqual([]);
});

test.each([
    { name: "missing backend route", error: new ApiError("请求不存在", { status: 404, code: 404, reason: "not_found" }), message: "在线示例接口尚未就绪" },
    { name: "network interruption", error: new ApiError("Network Error", { retryable: true }), message: "暂时无法连接在线示例服务" },
    { name: "unavailable backend", error: new ApiError("Bad Gateway", { status: 502, code: 502 }), message: "暂时无法连接在线示例服务" },
])("$name shows an actionable service error rather than a false authorization verdict", async ({ error, message }) => {
    failList = true;
    listFailure = error;
    view = await mount();
    expect(cards()).toHaveLength(0);
    expect(view.host.textContent).toContain(message);
    expect(view.host.textContent).not.toContain("授权核验失败");
    expect(view.host.textContent).not.toContain("尚未发布已核验素材");
    expect(view.host.querySelector(".creation-showcase-pagination")).toBeNull();
    expect(buttonNamed(view.host, "重新加载").disabled).toBe(false);
});

test("cached homepage reentry waits for a fresh verification without a false empty state", async () => {
    view = await mount();
    expect(cards()).toHaveLength(1);
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url?.endsWith("/library/prompts")) await pending;
        return response;
    };
    await view.remount();
    expect(cards()).toHaveLength(0);
    expect(view.host.textContent).toContain("正在核验在线示例");
    expect(view.host.textContent).not.toContain("尚未发布已核验素材");
    expect(view.host.textContent).not.toContain("已展示 0 个示例");
    expect(view.host.querySelector(".creation-showcase-pagination")).toBeNull();
    await act(async () => release());
    await until(() => cards().length === 1);
    expect(listCalls()).toHaveLength(2);
});

test("failed background authorization refresh hides the previous cards until a successful verification", async () => {
    view = await mount();
    failList = true;
    await act(async () => {
        await view!.client.refetchQueries({ predicate: (query) => query.queryKey.includes("showcase") });
    });
    await until(() => cards().length === 0);
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.host.querySelector(".creation-showcase-pagination")).toBeNull();
    failList = false;
    await click(buttonNamed(view.host, "重新加载"));
    await until(() => cards().length === 1);
});

test("the source-panel setting is honored and the waterfall renders each card only once", async () => {
    view = await mount("image", false);
    expect(view.host.querySelector(".creation-showcase-head")?.textContent).not.toContain("素材来源");
    expect(view.host.querySelectorAll(".creation-showcase-card")).toHaveLength(1);
    expect(view.host.querySelector(".creation-showcase-track")).toBeNull();
    expect(cards()[0].tabIndex).toBe(0);
    expect(view.host.textContent).toContain("提示词与展示媒体分别经过发布授权核验");
    expect(view.host.textContent).toContain("CC BY 4.0");
});

test("source popover lists original authors and links without claiming old library licenses", async () => {
    items = [entry("credited"), entry("unmarked", { credit: undefined, sourceUrl: undefined })];
    view = await mount();
    await click(buttonNamed(view.host, "素材来源"));
    const popup = [...document.querySelectorAll<HTMLElement>(".ant-popover")].find((node) => !node.classList.contains("ant-popover-hidden"));
    expect(popup?.textContent).toContain("作者 credited");
    expect(popup?.textContent).toContain("原始出处未标注");
    expect(popup?.querySelector('a[href="https://example.com/works/credited"]')).not.toBeNull();
    expect(popup?.textContent).not.toContain("CC BY 4.0");
    expect(popup?.textContent).not.toContain("ZZAI");
    await act(async () => popup!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(view.host.querySelector('[aria-expanded="true"]')).toBeNull();
});

test("creation mode changes preserve the mixed waterfall without refetching or remounting cards", async () => {
    items = [entry("image"), entry("video", { mode: "video", videoUrl: authorizedMedia("video", "video") })];
    view = await mount();
    expect(cards()).toHaveLength(2);
    const originalCards = cards();
    await view.setMode("video");
    expect(cards()).toEqual(originalCards);
    expect(cards()[1].textContent).toContain("在线 video");
    expect(cards()[1].querySelector("video")?.getAttribute("preload")).toBe("none");
    await click(cards()[1]);
    await until(() => visibleDialogs().length === 1);
    expect(dialog().querySelector("video")?.getAttribute("src")).toBe(items[1].videoUrl!);
    await usePreview();
    expect(view.started[0]).toEqual({ mode: "video", prompt: items[1].promptZh! });
    await view.setMode("text");
    expect(cards()).toEqual(originalCards);
    expect(view.host.querySelector('[aria-label="图片与视频在线灵感作品"]')).not.toBeNull();
    expect(calls.filter((call) => call.url.endsWith("/prompts")).map((call) => call.mediaType)).toEqual([undefined]);
});

test("creation mode changes do not close an open inspiration preview", async () => {
    view = await mount();
    await previewFirst();
    const preview = dialog();
    await view.setMode("video");
    expect(dialog()).toBe(preview);
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(calls.filter((call) => call.url.endsWith("/prompts"))).toHaveLength(1);
    await usePreview();
    expect(view.started).toEqual([{ mode: "image", prompt: items[0].promptZh! }]);
});

test("waterfall covers reserve their own dimensions and keep the frame after an image error", async () => {
    items = [entry("portrait", { width: 600, height: 900 }), entry("landscape", { width: 1200, height: 800 }), entry("ratio", { width: undefined, height: undefined, ratio: "3:4" }), entry("video", { width: undefined, height: undefined, mode: "video" })];
    view = await mount();
    const covers = cards().map((card) => card.querySelector<HTMLElement>(".creation-showcase-cover")!);
    expect(covers.map((cover) => Number.parseFloat(cover.style.aspectRatio))).toEqual([600 / 900, 1200 / 800, 3 / 4, 16 / 9]);
    await act(async () => covers[0].querySelector("img")!.dispatchEvent(new dom.Event("error")));
    expect(covers[0].textContent).toContain("封面暂不可用");
    expect(Number.parseFloat(covers[0].style.aspectRatio)).toBe(600 / 900);
    expect(cards()).toHaveLength(4);
});

test("the homepage loads bounded pages and deduplicates online cards without built-in filler", async () => {
    items = [entry("same"), entry("same"), ...Array.from({ length: 25 }, (_, n) => entry(`remote-${n}`))];
    view = await mount();
    expect(cards()).toHaveLength(20);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 26);
    expect(new Set(cards().map((card) => card.getAttribute("aria-label"))).size).toBe(26);
    expect(view.host.textContent).not.toContain("雨巷旗袍");
});

test("homepage load more appends multiple cursor pages, retains existing cards and ends honestly", async () => {
    items = Array.from({ length: 45 }, (_, n) => entry(`paged-${n}`));
    view = await mount();
    const firstCards = cards();
    expect(firstCards).toHaveLength(21);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 42);
    expect(cards().slice(0, 21)).toEqual(firstCards);
    await view.setMode("video");
    expect(cards()).toHaveLength(42);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 45);
    expect(cards().slice(0, 21)).toEqual(firstCards);
    expect(calls.filter((call) => call.url.endsWith("/prompts")).map((call) => call.cursor)).toEqual([undefined, "21", "42"]);
    expect(view.host.textContent).toContain("已展示全部示例");
    expect(view.host.textContent).toContain("已展示 45 个示例");
    expect(view.host.querySelector(".creation-showcase-load-more")).toBeNull();
});

test("failed next pages hide unverified cards and retry from the first page", async () => {
    items = Array.from({ length: 45 }, (_, n) => entry(`retry-${n}`));
    view = await mount();
    expect(cards()).toHaveLength(21);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 42);
    failList = true;
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => Boolean(view!.host.querySelector('[role="alert"]')));
    expect(cards()).toHaveLength(0);
    expect(view.host.textContent).not.toContain("没有可展示的在线示例");
    expect(view.host.textContent).not.toContain("已展示全部示例");
    failList = false;
    await click(buttonNamed(view.host, "重新加载"));
    await until(() => cards().length === 21);
    expect(listCalls().map((call) => call.cursor)).toEqual([undefined, "21", "42", undefined]);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 42);
    expect(listCalls().map((call) => call.cursor)).toEqual([undefined, "21", "42", undefined, "21"]);
});

test("a stale library cursor requires a first-page refresh instead of retrying the rejected cursor", async () => {
    items = Array.from({ length: 24 }, (_, n) => entry(`stale-${n}`));
    view = await mount();
    failList = true;
    listFailure = new ApiError("素材已更新", { status: 409, code: 409, reason: "library_cursor_stale" });
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => Boolean(view!.host.textContent?.includes("素材目录已更新")));
    expect(cards()).toHaveLength(0);
    expect(view.host.textContent).not.toContain("已展示全部示例");
    expect(view.host.querySelector(".creation-showcase-load-more")).toBeNull();
    failList = false;
    await click(buttonNamed(view.host, "重新加载"));
    await until(() => cards().length === 21);
    expect(listCalls().map((call) => call.cursor)).toEqual([undefined, "21", undefined]);
});

test("repeated load-more clicks do not start concurrent cursor requests", async () => {
    items = Array.from({ length: 24 }, (_, n) => entry(`busy-${n}`));
    view = await mount();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    let nextRequests = 0;
    apiClient.defaults.adapter = async (config) => {
        if (config.params?.cursor) {
            nextRequests += 1;
            await wait;
        }
        return adapter(config);
    };
    const loadMore = buttonNamed(view.host, "加载更多");
    await act(async () => {
        loadMore.click();
        loadMore.click();
    });
    await settle();
    expect(nextRequests).toBe(1);
    expect(loadMore.disabled).toBe(true);
    expect(loadMore.textContent).toContain("正在加载更多");
    expect(cards()).toHaveLength(21);
    await act(async () => release());
    await until(() => cards().length === 24);
});

test("an old account's late cursor response cannot enter the new account's homepage", async () => {
    items = Array.from({ length: 24 }, (_, n) => entry(`old-${n}`));
    view = await mount();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.params?.cursor) await wait;
        return response;
    };
    await click(buttonNamed(view.host, "加载更多"));
    items = [entry("new-user")];
    await act(async () => signIn("new-account"));
    await until(() => cards().length === 1 && Boolean(cards()[0].textContent?.includes("new-user")));
    await act(async () => release());
    await settle();
    expect(cards()).toHaveLength(1);
    expect(view.host.textContent).not.toContain("在线 old-");
});

test("overlapping pages keep first-seen covers and a repeated cursor never claims the end", async () => {
    const original = summary(entry("same", { width: 500, height: 900 }));
    listPages = {
        "": { policyVersion, items: [original], total: 3, nextCursor: "next" },
        next: { policyVersion, items: [{ ...original, title: "Changed duplicate", width: 900, height: 500 }, summary(entry("new"))], total: 3, nextCursor: "next" },
    };
    view = await mount();
    const first = cards()[0];
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 2);
    expect(cards()[0]).toBe(first);
    expect(first.textContent).not.toContain("Changed duplicate");
    expect(Number.parseFloat(first.querySelector<HTMLElement>(".creation-showcase-cover")!.style.aspectRatio)).toBe(500 / 900);
    expect(view.host.textContent).toContain("已停止重复加载");
    expect(view.host.textContent).not.toContain("已展示全部示例");
    expect(view.host.querySelector(".creation-showcase-load-more")).toBeNull();
});

test("empty intermediate pages keep the next-cursor action available", async () => {
    listPages = {
        "": { policyVersion, items: [], total: 1, nextCursor: "next" },
        next: { policyVersion, items: [summary(entry("after-empty"))], total: 1, nextCursor: "" },
    };
    view = await mount();
    expect(cards()).toHaveLength(0);
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 1);
    expect(view.host.textContent).toContain("已展示全部示例");
});

test("closing a preview does not mutate the creation prompt and clipboard failure stays visible", async () => {
    view = await mount();
    await previewFirst();
    failCopy = true;
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(copied).toEqual([]);
    expect(document.body.textContent).toContain("复制失败");
    expect(dialog().querySelector(".inspiration-detail")).not.toBeNull();
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(dialog().textContent).not.toContain("正文和媒体已隐藏");
    await click(buttonNamed(dialog(), "关闭"));
    await until(() => visibleDialogs().length === 0);
    expect(view.started).toEqual([]);
});

test("copy revalidates authorization and hides content if the verification fails", async () => {
    view = await mount();
    await previewFirst();
    failDetail = true;
    await click(buttonNamed(dialog(), "复制提示词"));
    await until(() => !dialog().querySelector(".inspiration-detail"));
    expect(copied).toEqual([]);
    expect(dialog().textContent).toContain("正文和媒体已隐藏");
    expect(view.started).toEqual([]);
    failDetail = false;
    await click(buttonNamed(dialog(), "重试核验"));
    await until(() => Boolean(dialog().querySelector(".inspiration-detail")));
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(copied).toEqual([items[0].promptZh!]);
});

test("detail failure cannot open an empty-prompt preview and exposes a working retry", async () => {
    view = await mount();
    failDetail = true;
    await click(cards()[0]);
    expect(visibleDialogs()).toHaveLength(1);
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(view.started).toEqual([]);
    expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    failDetail = false;
    await click(buttonNamed(dialog(), "重试核验"));
    await until(() => Boolean(dialog().querySelector(".inspiration-detail")));
    expect(dialog().textContent).toContain(items[0].promptZh!);
});

test("unsafe or incomplete detail data cannot become a usable homepage inspiration", async () => {
    view = await mount();
    items[0] = { ...items[0], prompt: "", promptZh: undefined };
    await click(cards()[0]);
    expect(visibleDialogs()).toHaveLength(1);
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(view.started).toEqual([]);
    expect(dialog().textContent).toContain("正文和媒体已隐藏");
});

test("an account switch cancels an old detail request before its content can appear", async () => {
    view = await mount();
    let release = () => {};
    let ready = () => {};
    const started = new Promise<void>((resolve) => {
        ready = resolve;
    });
    const adapter = apiClient.defaults.adapter as Exclude<typeof apiClient.defaults.adapter, undefined | string | string[]>;
    apiClient.defaults.adapter = (config) =>
        config.url?.endsWith("/prompts/latest")
            ? new Promise((resolve) => {
                  release = () => resolve({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: items[0], msg: "" } });
                  ready();
              })
            : (adapter as any)(config);
    await click(cards()[0]);
    await started;
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(dialog().textContent).toContain("正在核验授权素材");
    await act(async () => {
        signIn("different-user");
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(visibleDialogs()).toHaveLength(0);
    expect(view.started).toEqual([]);
});

test("switching account with a preview open closes it and discards any pending use", async () => {
    view = await mount();
    await previewFirst();
    await act(async () => {
        signIn("different-user");
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await until(() => visibleDialogs().length === 0);
    expect(view.started).toEqual([]);
});

test("reopening a homepage preview reads the current revision instead of the previous detail", async () => {
    view = await mount();
    await previewFirst();
    const previousPrompt = items[0].promptZh!;
    const previousCalls = calls.filter((call) => call.url.endsWith("/prompts/latest")).length;
    await click(buttonNamed(dialog(), "关闭"));
    await until(() => visibleDialogs().length === 0);
    items[0] = {
        ...items[0],
        promptZh: "这是重新审批后当前版本的电影镜头提示词。",
        image: authorizedMedia("latest", "image", 2),
        authorization: { ...items[0].authorization, revision: 2, contentHash: "d".repeat(64) },
    };
    await previewFirst();
    expect(calls.filter((call) => call.url.endsWith("/prompts/latest"))).toHaveLength(previousCalls + 1);
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(dialog().textContent).not.toContain(previousPrompt);
    expect(dialog().querySelector(".inspiration-detail img")?.getAttribute("src")).toBe(items[0].image);
    expect(view.started).toEqual([]);
});

test("withdrawal after preview prevents creation handoff following dialog close", async () => {
    view = await mount();
    await previewFirst();
    const previousCalls = calls.filter((call) => call.url.endsWith("/prompts/latest")).length;
    failDetail = true;
    await click(buttonNamed(dialog(), "带进创作区"));
    await until(() => visibleDialogs().length === 0);
    await until(() => calls.filter((call) => call.url.endsWith("/prompts/latest")).length === previousCalls + 1);
    await until(() => Boolean(document.body.textContent?.includes("Online detail unavailable")));
    expect(view.started).toEqual([]);
    expect(copied).toEqual([]);
});

test("account switch during post-close authorization recheck cancels creation handoff", async () => {
    view = await mount();
    await previewFirst();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    let notifyStarted = () => {};
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url?.endsWith("/prompts/latest")) {
            oldSignal = config.signal as AbortSignal;
            notifyStarted();
            await pending;
        }
        return response;
    };
    await click(buttonNamed(dialog(), "带进创作区"));
    await started;
    expect(visibleDialogs()).toHaveLength(0);
    expect(view.started).toEqual([]);
    await act(async () => {
        signIn("post-close-account");
        release();
    });
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(view.started).toEqual([]);
});

test("the hall uses the same online source and previews within one modal before returning focus", async () => {
    view = await mount();
    await openHall();
    expect(staticRequests).toEqual([]);
    expect(dialog().textContent).not.toContain("本地精选");
    const card = dialog().querySelector<HTMLElement>('.inspiration-gallery [aria-label="预览画廊提示词：在线 latest"]')!;
    await act(async () => card.focus());
    await click(card);
    expect(dialog().querySelector(".inspiration-detail")).not.toBeNull();
    expect(visibleDialogs()).toHaveLength(1);
    await click(buttonNamed(dialog(), "返回灵感大厅"));
    expect(dialog().querySelector(".inspiration-gallery")).not.toBeNull();
    expect(document.activeElement).toBe(card);
});

test("hall online video details preserve provenance and save only the selected complete snapshot", async () => {
    items = [entry("video", { mode: "video", featured: true, videoUrl: authorizedMedia("video", "video") })];
    view = await mount("video");
    await openHall();
    expect(calls.some((call) => call.url.endsWith("/prompts/video"))).toBe(false);
    await click(dialog().querySelector<HTMLElement>('[aria-label="预览画廊提示词：在线 video"]')!);
    const preview = dialog().querySelector<HTMLElement>(".inspiration-detail")!;
    expect(preview.querySelector("video")?.getAttribute("src")).toBe(items[0].videoUrl!);
    expect(preview.textContent).not.toContain("ZZAI");
    await click(buttonNamed(preview, "收藏"));
    expect(useInspirationStore.getState().externalFavorites[0]).toMatchObject({ id: items[0].id, prompt: items[0].prompt, promptZh: items[0].promptZh, featured: true, sourceUrl: items[0].sourceUrl });
    await click(buttonNamed(preview, "复制提示词"));
    expect(copied).toEqual([items[0].promptZh!]);
    await usePreview();
    expect(view.started).toEqual([{ mode: "video", prompt: items[0].promptZh! }]);
});

test("homepage independent filters serialize real upstream params and preserve them across cursor pages and preview use", async () => {
    items = [...Array.from({ length: 24 }, (_, n) => entry(`filtered-video-${n}`, { title: `电影关键词 ${n}`, mode: "video", category: "story", model: "筛选视频模型", videoUrl: authorizedMedia(`filtered-video-${n}`, "video") })), entry("image-excluded")];
    view = await mount("image");
    await chooseMedia("视频");
    await chooseSelect("首页示例分类", "故事");
    await chooseSelect("首页示例模型标注", "筛选视频模型");
    await chooseSelect("首页示例排序", "精选");
    await enterSearch("  电影关键词  ");
    expect(cards().every((card) => card.disabled)).toBe(true);
    expect(buttonNamed(view.host, "加载更多").disabled).toBe(true);
    await until(() => lastListCall().search === "电影关键词" && cards().length === 21);
    const expectedFilters = { mediaType: "video", category: "story", model: "筛选视频模型", sort: "featured", search: "电影关键词", limit: 21 };
    expect(lastListCall()).toMatchObject(expectedFilters);
    expect(lastListCall().cursor).toBeUndefined();
    const firstPageCards = cards();
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 24);
    expect(lastListCall()).toMatchObject({ ...expectedFilters, cursor: "21" });
    expect(cards().slice(0, 21)).toEqual(firstPageCards);
    expect(view.host.textContent).not.toContain("在线 image-excluded");
    const requestsBeforeModeChange = calls.length;
    await view.setMode("text");
    expect(calls).toHaveLength(requestsBeforeModeChange);
    expect(cards().slice(0, 21)).toEqual(firstPageCards);
    await previewFirst();
    expect(dialog().textContent).toContain(items[0].promptZh!);
    await usePreview();
    expect(view.started).toEqual([{ mode: "video", prompt: items[0].promptZh! }]);
});

test("homepage media changes clear category and model while facet requests follow only the example media", async () => {
    items = [entry("image-selection", { category: "portrait", model: "图片模型" }), entry("video-selection", { category: "story", model: "视频模型", mode: "video" })];
    view = await mount();
    await chooseSelect("首页示例分类", "人物肖像");
    await chooseSelect("首页示例模型标注", "图片模型");
    expect(lastListCall()).toMatchObject({ category: "portrait", model: "图片模型" });
    await chooseMedia("视频");
    await until(() => cards().length === 1 && Boolean(cards()[0].textContent?.includes("video-selection")));
    expect(lastListCall()).toMatchObject({ mediaType: "video", sort: "latest", limit: 21 });
    expect(lastListCall().category).toBeUndefined();
    expect(lastListCall().model).toBeUndefined();
    expect(lastListCall().cursor).toBeUndefined();
    expect(view.host.querySelector('[aria-label="首页示例分类"]')?.closest(".ant-select")?.textContent).toContain("全部分类");
    expect(view.host.querySelector('[aria-label="首页示例模型标注"]')?.closest(".ant-select")?.textContent).toContain("全部模型标注");
    expect(facetCalls().map((call) => call.mediaType)).toEqual([undefined, "video"]);
    await chooseMedia("图片");
    await until(() => cards().length === 1 && Boolean(cards()[0].textContent?.includes("image-selection")));
    expect(facetCalls().map((call) => call.mediaType)).toEqual([undefined, "video", "image"]);
    expect(lastListCall().mediaType).toBe("image");
});

test("homepage nonempty search is debounced and trimmed while clearing it resets immediately", async () => {
    items = [entry("alpha", { title: "Alpha电影" }), entry("beta", { title: "Beta电影" })];
    view = await mount();
    const initialRequests = listCalls().length;
    await enterSearch("Alpha");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(listCalls()).toHaveLength(initialRequests);
    await enterSearch("  Beta  ");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(listCalls()).toHaveLength(initialRequests);
    await until(() => lastListCall().search === "Beta" && cards().length === 1);
    expect(listCalls()).toHaveLength(initialRequests + 1);
    expect(listCalls().some((call) => call.search === "Alpha")).toBe(false);
    expect(cards()[0].textContent).toContain("Beta电影");
    expect(lastListCall().cursor).toBeUndefined();
    await enterSearch("");
    await settle();
    expect(lastListCall().search).toBeUndefined();
    expect(cards()).toHaveLength(2);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(cards()).toHaveLength(2);
    expect(lastListCall().search).toBeUndefined();
});

test("a late homepage cursor response cannot mix old examples into a new filter dataset", async () => {
    items = Array.from({ length: 24 }, (_, n) => entry(`old-filter-${n}`));
    view = await mount();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    let notifyStarted = () => {};
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.params?.cursor) {
            oldSignal = config.signal as AbortSignal;
            notifyStarted();
            await pending;
        }
        return response;
    };
    await click(buttonNamed(view.host, "加载更多"));
    await started;
    items = [entry("new-filter-video", { mode: "video", category: "story", model: "新筛选模型" })];
    await chooseMedia("视频");
    await until(() => cards().length === 1 && Boolean(cards()[0].textContent?.includes("new-filter-video")));
    await act(async () => release());
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(cards()).toHaveLength(1);
    expect(view.host.textContent).not.toContain("old-filter-");
    expect(
        listCalls()
            .filter((call) => call.mediaType === "video")
            .map((call) => call.cursor),
    ).toEqual([undefined]);
    expect(view.host.querySelector(".creation-showcase-load-more")).toBeNull();
});

test("homepage no-results clear action resets every filter and starts again without the old cursor", async () => {
    items = [entry("reset-image", { model: "图片模型" }), entry("reset-video", { mode: "video", category: "story", model: "视频模型", featured: true })];
    view = await mount();
    await chooseMedia("视频");
    await chooseSelect("首页示例分类", "故事");
    await chooseSelect("首页示例模型标注", "视频模型");
    await chooseSelect("首页示例排序", "精选");
    await enterSearch("没有匹配的示例");
    await until(() => lastListCall().search === "没有匹配的示例" && cards().length === 0 && Boolean(view!.host.textContent?.includes("没有符合当前筛选的已核验素材")));
    expect(view.host.textContent).toContain("没有符合当前筛选的已核验素材");
    expect(view.host.textContent).not.toContain("内置示例");
    await click(buttonNamed(view.host, "清除筛选"));
    expect(lastListCall()).toMatchObject({ mediaType: undefined, category: undefined, model: undefined, sort: "latest", search: undefined, cursor: undefined, limit: 21 });
    await until(() => cards().length === 2);
    expect(view.host.querySelector<HTMLInputElement>('[aria-label="搜索首页在线示例"]')?.value).toBe("");
    expect(buttonNamed(view.host.querySelector('[aria-label="首页示例媒体类型"]')!, "全部").getAttribute("aria-checked")).toBe("true");
    expect(view.host.querySelector('[aria-label="首页示例分类"]')?.closest(".ant-select")?.textContent).toContain("全部分类");
    expect(view.host.querySelector('[aria-label="首页示例模型标注"]')?.closest(".ant-select")?.textContent).toContain("全部模型标注");
    expect(view.host.querySelector('[aria-label="首页示例排序"]')?.closest(".ant-select")?.textContent).toContain("最新发布");
    expect(staticRequests).toEqual([]);
});

test("homepage facet failure does not erase real examples and exposes a working retry", async () => {
    failFacets = true;
    view = await mount();
    expect(cards()).toHaveLength(1);
    expect(view.host.textContent).toContain("分类与模型");
    expect(facetCalls()).toHaveLength(1);
    failFacets = false;
    await click(buttonNamed(view.host, "重试筛选选项"));
    await until(() => facetCalls().length === 2 && !view!.host.textContent?.includes("重试筛选选项"));
    expect(cards()).toHaveLength(1);
    await chooseSelect("首页示例分类", "人物肖像");
    expect(lastListCall().category).toBe("portrait");
    await previewFirst();
    expect(dialog().textContent).toContain(items[0].promptZh!);
    await usePreview();
    expect(view.started).toEqual([{ mode: "image", prompt: items[0].promptZh! }]);
    expect(staticRequests).toEqual([]);
});

test("closing a pending detail cancels it before filtering, while a loaded preview keeps its creation handoff", async () => {
    items = [entry("cancel-detail-image"), entry("new-detail-video", { mode: "video", category: "story", videoUrl: authorizedMedia("new-detail-video", "video") })];
    view = await mount();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    let notifyStarted = () => {};
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url?.endsWith("/prompts/cancel-detail-image")) {
            oldSignal = config.signal as AbortSignal;
            notifyStarted();
            await pending;
        }
        return response;
    };
    await click(cards()[0]);
    await started;
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    await click(buttonNamed(dialog(), "关闭灵感弹窗"));
    await until(() => visibleDialogs().length === 0);
    await enterSearch("new-detail-video");
    expect(oldSignal?.aborted).toBe(true);
    expect(lastListCall().search).toBeUndefined();
    expect(cards().every((card) => card.disabled)).toBe(true);
    await act(async () => release());
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(visibleDialogs()).toHaveLength(0);
    expect(view.started).toEqual([]);
    await until(() => lastListCall().search === "new-detail-video" && cards().length === 1);
    await previewFirst();
    const openedPreview = dialog();
    await chooseSelect("首页示例排序", "精选");
    await until(() => lastListCall().sort === "featured");
    expect(dialog()).toBe(openedPreview);
    expect(dialog().textContent).toContain(items[1].promptZh!);
    await usePreview();
    expect(view.started).toEqual([{ mode: "video", prompt: items[1].promptZh! }]);
});

test("a cached homepage can recover from a later pagination failure with a verified first page", async () => {
    items = Array.from({ length: 24 }, (_, n) => entry(`cached-retry-${n}`));
    view = await mount();
    await view.remount();
    await until(() => view!.client.isFetching() === 0 && cards().length === 21);
    expect(listCalls()).toHaveLength(2);
    failList = true;
    await click(buttonNamed(view.host, "加载更多"));
    await until(() => cards().length === 0 && Boolean(view!.host.querySelector('[role="alert"]')));
    failList = false;
    await click(buttonNamed(view.host, "重新加载"));
    await until(() => view!.client.isFetching() === 0);
    expect(cards()).toHaveLength(21);
    expect(view.host.textContent).not.toContain("正在核验在线示例");
    expect(view.host.textContent).toContain("已展示 21 个示例");
    expect(listCalls().map((call) => call.cursor)).toEqual([undefined, undefined, "21", undefined]);
});

test("reopening a cached detail shows verification progress without exposing the previous revision", async () => {
    view = await mount();
    const detailKey = ["public", "inspirations", "authorized-library", policyVersion, "detail", "showcase-user", items[0].id];
    view.client.setQueryDefaults(detailKey, { gcTime: 60_000 });
    await previewFirst();
    const previousPrompt = items[0].promptZh!;
    await click(buttonNamed(dialog(), "关闭"));
    await until(() => visibleDialogs().length === 0);
    expect(view.client.getQueryData(detailKey)).toBeDefined();
    items[0] = {
        ...items[0],
        promptZh: "等待重新核验后才能展示的新版提示词。",
        image: authorizedMedia("latest", "image", 2),
        authorization: { ...items[0].authorization, revision: 2, contentHash: "e".repeat(64) },
    };
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url?.endsWith("/prompts/latest")) await pending;
        return response;
    };
    await click(cards()[0]);
    expect(dialog().textContent).toContain("正在核验授权素材");
    expect(dialog().textContent).not.toContain(previousPrompt);
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    await act(async () => release());
    await until(() => Boolean(dialog().querySelector(".inspiration-detail")));
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(dialog().textContent).not.toContain(previousPrompt);
});

test("retrying failed detail authorization keeps the previous content hidden until verification succeeds", async () => {
    view = await mount();
    await previewFirst();
    failDetail = true;
    await click(buttonNamed(dialog(), "复制提示词"));
    await until(() => !dialog().querySelector(".inspiration-detail"));
    failDetail = false;
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        const response = await adapter(config);
        if (config.url?.endsWith("/prompts/latest")) await pending;
        return response;
    };
    await click(buttonNamed(dialog(), "重试核验"));
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(dialog().textContent).not.toContain(items[0].promptZh!);
    expect(copied).toEqual([]);
    await act(async () => release());
    await until(() => Boolean(dialog().querySelector(".inspiration-detail")));
    expect(dialog().textContent).toContain(items[0].promptZh!);
    expect(view.started).toEqual([]);
});
