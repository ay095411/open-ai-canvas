import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationMode } from "@/lib/creation-mode";
import type { CreationInspiration } from "@/lib/inspirations/catalog";
import type { InspirationFeed, InspirationFeedEntry } from "@/services/api/inspiration-feed";

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
const { MemoryRouter, useLocation } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { inspirationFeedEntries, invalidateInspirationCatalog } = await import("@/services/inspiration-catalog");
const { curatedInspirations } = await import("@/lib/inspirations/catalog");
const { useInspirationStore } = await import("@/stores/use-inspiration-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { CreationShowcaseBand } = await import("@/pages/create/creation-showcase-band");
const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
const originalInspirationState = useInspirationStore.getState();
const originalInspirationStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState().user;
let feed: InspirationFeed;
let failRequest = false;
let requests: string[] = [];
let catalogEntries: Record<string, CreationInspiration[]> = {};
let catalogRequests: string[] = [];
let copied: string[] = [];
let failCopy = false;
let clipboardSpy: ReturnType<typeof spyOn<typeof navigator.clipboard, "writeText">> | undefined;
let view: Awaited<ReturnType<typeof mount>> | undefined;

function entry(id: string, patch: Partial<InspirationFeedEntry> = {}): InspirationFeedEntry {
    return {
        id: `youmind:${id}`,
        title: `灵感 ${id}`,
        description: "",
        image: `https://images.example.com/${id}.webp`,
        mode: "image",
        prompt: `为 ${id} 创作一张电影画面。\n保留原始镜头和光线描述。`,
        sourceId: "youmind",
        credit: `作者 ${id}`,
        sourceUrl: `https://example.com/works/${id}`,
        addedAt: "2026-11-06T01:00:00Z",
        publishedAt: "2026-11-05T01:00:00Z",
        ...patch,
    };
}

function catalogEntry(id: string, mode: CreationMode, patch: Partial<CreationInspiration> = {}): CreationInspiration {
    return {
        id: `catalog:${id}`,
        title: `目录 ${id}`,
        description: "来自完整目录的测试素材",
        image: `https://images.example.com/catalog-${id}.webp`,
        mode,
        prompt: `Original prompt for ${id}.`,
        sourceId: "youmind",
        ...patch,
    };
}

beforeEach(() => {
    feed = { enabled: true, entries: [], categories: {} };
    failRequest = false;
    requests = [];
    catalogEntries = { seedance: [], haohaoxue: [], youmind: [] };
    catalogRequests = [];
    copied = [];
    failCopy = false;
    invalidateInspirationCatalog();
    useInspirationStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
    useInspirationStore.setState({ hydrated: true, custom: [], overrides: {}, hidden: [], favorites: [] });
    useUserStore.setState({ user: null });
    clipboardSpy = spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
        if (failCopy) throw new Error("Clipboard access denied");
        copied.push(text);
    });
    globalThis.fetch = (async (input) => {
        const url = String(input);
        catalogRequests.push(url);
        if (url === "/inspirations/manifest.json") return new Response(JSON.stringify({ sources: {} }));
        const source = /^\/inspirations\/(seedance|haohaoxue|youmind)\.json$/.exec(url)?.[1];
        if (!source) throw new Error(`Unexpected fetch: ${url}`);
        return new Response(JSON.stringify({ entries: catalogEntries[source] }));
    }) as typeof fetch;
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url || "");
        if (config.url !== "/public/inspirations/feed" || config.method !== "get") throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        if (failRequest) throw new Error("feed temporarily unavailable");
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: feed, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    clipboardSpy?.mockRestore();
    clipboardSpy = undefined;
    invalidateInspirationCatalog();
    useInspirationStore.setState(originalInspirationState);
    useInspirationStore.persist.setOptions({ storage: originalInspirationStorage });
    useUserStore.setState({ user: originalUser });
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

async function mount(mode: CreationMode = "image", sourcesVisible = true) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const started: { mode: string; prompt: string }[] = [];
    const startedWithOpenDialog: boolean[] = [];
    const startPrompt = (mode: CreationMode, prompt: string) => {
        startedWithOpenDialog.push(visibleDialogs().length > 0);
        started.push({ mode, prompt });
        host.querySelector<HTMLTextAreaElement>("[data-creation-prompt]")?.focus();
    };
    function LocationProbe() {
        const location = useLocation();
        return (
            <output data-location>
                {location.pathname}
                {JSON.stringify(location.state)}
            </output>
        );
    }
    const render = async (currentMode: CreationMode) => {
        await act(async () => {
            root.render(
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <MemoryRouter initialEntries={["/create"]}>
                            <QueryClientProvider client={client}>
                                <textarea data-creation-prompt aria-label="创作提示词" />
                                <LocationProbe />
                                <CreationShowcaseBand mode={currentMode} sourcesVisible={sourcesVisible} onStartPrompt={startPrompt} />
                            </QueryClientProvider>
                        </MemoryRouter>
                    </App>
                </ConfigProvider>,
            );
        });
    };
    await render(mode);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await settle();
        if (!client.isFetching()) break;
    }
    return {
        host,
        started,
        startedWithOpenDialog,
        async setMode(nextMode: CreationMode) {
            await render(nextMode);
            await settle();
        },
        async dispose() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

function cards() {
    return Array.from(view!.host.querySelectorAll<HTMLButtonElement>('.creation-showcase-set:not([aria-hidden="true"]) .creation-showcase-card'));
}

function visibleDialogs() {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((dialog) => dialog.style.display !== "none" && dialog.closest<HTMLElement>(".ant-modal-wrap")?.style.display !== "none");
}

function dialog() {
    expect(visibleDialogs()).toHaveLength(1);
    return visibleDialogs()[0];
}

function buttonNamed(container: ParentNode, name: string) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
        for (let ancestor: HTMLElement | null = item; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.hidden || ancestor.style.display === "none") return false;
        }
        return item.getAttribute("aria-label") === name || item.textContent?.replace(/\s/g, "") === name;
    });
    expect(button).toBeDefined();
    return button!;
}

async function click(button: HTMLElement) {
    await act(async () => button.click());
    await settle();
}

async function openHall() {
    await click(buttonNamed(view!.host, "灵感大厅"));
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (dialog().querySelector(".inspiration-gallery")) break;
        await settle();
    }
    expect(dialog().querySelector(".inspiration-gallery")).not.toBeNull();
}

async function usePreview() {
    await click(buttonNamed(dialog().querySelector(".inspiration-detail")!, "带进创作区"));
    for (let attempt = 0; attempt < 30 && visibleDialogs().length; attempt += 1) await settle();
    expect(visibleDialogs()).toHaveLength(0);
    expect(view!.startedWithOpenDialog.every((open) => !open)).toBe(true);
    expect(document.activeElement).toBe(view!.host.querySelector("[data-creation-prompt]"));
}

function modeOption(label: string) {
    const option = Array.from(dialog().querySelectorAll<HTMLButtonElement>('[aria-label="按创作类型筛选"] [role="radio"]')).find((item) => item.textContent?.startsWith(label));
    expect(option).toBeDefined();
    return option!;
}

function galleryCard(title: string) {
    const card = Array.from(dialog().querySelectorAll<HTMLElement>(".inspiration-gallery article")).find((item) => item.getAttribute("aria-label") === `预览灵感：${title}`);
    expect(card).toBeDefined();
    return card!;
}

test("matching feed cards keep two copy lines and preview before using the original mode and prompt", async () => {
    const earlier = entry("earlier", { addedAt: "2026-11-04T01:00:00Z" });
    const sameBatch = entry("same-batch", { publishedAt: "2026-11-03T01:00:00Z" });
    const latest = entry("latest", { category: "cinema" });
    feed.categories = { youmind: { cinema: "电影镜头" } };
    feed.entries = [earlier, sameBatch, latest];
    view = await mount();

    expect(requests).toEqual(["/public/inspirations/feed"]);
    expect(cards().length).toBeGreaterThanOrEqual(3);
    expect(cards().length).toBeLessThanOrEqual(21);
    expect(
        cards()
            .slice(0, 3)
            .map((card) => card.querySelector("strong")?.textContent),
    ).toEqual([latest.title, sameBatch.title, earlier.title]);
    const firstItem = cards()[0].closest("li")!;
    expect(firstItem.textContent).not.toContain(latest.credit!);
    expect(firstItem.querySelector("a")).toBeNull();
    const copy = cards()[0].querySelector(".creation-showcase-copy")!;
    expect(copy.children).toHaveLength(2);
    expect(copy.children[0].textContent).toBe(latest.title);
    expect(copy.children[1].textContent).toContain("图片");
    expect(copy.children[1].textContent).toContain("电影镜头");
    expect(cards()[0].querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    act(() => cards()[0].click());
    expect(view.host.textContent).not.toContain("正在打开灵感");
    expect(dialog().querySelector(".inspiration-detail")).not.toBeNull();
    expect(view.started).toEqual([]);
    expect(dialog().textContent).toContain(latest.title);
    expect(dialog().textContent).toContain(latest.prompt);
    expect(dialog().textContent).toContain(latest.credit!);
    expect(dialog().querySelector(`a[href="${latest.sourceUrl}"]`)).not.toBeNull();
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(copied).toEqual([latest.prompt]);
    expect(view.started).toEqual([]);
    await usePreview();
    expect(view.started).toEqual([{ mode: latest.mode, prompt: latest.prompt }]);
    await settle();
    expect(view.started).toHaveLength(1);
});

test.each(["disabled", "empty", "failed"])("%s feed retains usable image examples", async (state) => {
    feed.enabled = state !== "disabled";
    feed.entries = state === "empty" ? [] : [entry("remote")];
    failRequest = state === "failed";
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
        view = await mount();
        expect(requests).toEqual(["/public/inspirations/feed"]);
        expect(cards().length).toBeGreaterThan(0);
        expect(cards().length).toBeLessThanOrEqual(21);
        expect(cards()[0].textContent).toContain("雨巷旗袍");
        expect(view.host.textContent).not.toContain("灵感 remote");
        await click(cards()[0]);
        expect(view.started).toEqual([]);
        await usePreview();
        expect(view.started[0]?.mode).toBe("image");
        expect(view.started[0]?.prompt).toContain("民国时期雨后的青石板巷子");
    } finally {
        warning.mockRestore();
    }
});

test("the source-panel switch hides its entry while cards remain compact and duplicates unfocusable", async () => {
    feed.entries = [entry("credited")];
    view = await mount("image", false);
    expect(view.host.querySelector(".creation-showcase-head")?.textContent).not.toContain("素材来源");
    expect(cards()[0].closest("li")?.textContent).not.toContain("作者 credited");
    expect(cards()[0].closest("li")?.querySelector("a")).toBeNull();
    const clonedControls = view.host.querySelectorAll<HTMLElement>('.creation-showcase-set[aria-hidden="true"] button, .creation-showcase-set[aria-hidden="true"] a');
    expect(clonedControls.length).toBeGreaterThan(0);
    for (const control of clonedControls) expect(control.tabIndex).toBe(-1);
});

function sourceButton() {
    const button = Array.from(view!.host.querySelectorAll<HTMLButtonElement>(".creation-showcase-head button")).find((item) => item.textContent === "素材来源");
    expect(button).toBeDefined();
    return button!;
}

function visiblePopover() {
    return Array.from(document.querySelectorAll<HTMLElement>(".ant-popover")).find((item) => !item.classList.contains("ant-popover-hidden") && item.style.display !== "none");
}

test("the source popover lists current cards' authors and original links and closes on Escape", async () => {
    feed.entries = [entry("credited"), entry("other-mode", { mode: "video", sourceId: "seedance", id: "seedance:other-mode" })];
    view = await mount();
    expect(visiblePopover()).toBeUndefined();
    await act(async () => sourceButton().click());
    await settle();
    const popup = visiblePopover();
    expect(popup).toBeDefined();
    expect(popup?.textContent).toContain("作者 credited");
    expect(popup?.textContent).not.toContain("作者 other-mode");
    const link = popup!.querySelector<HTMLAnchorElement>('a[href="https://example.com/works/credited"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(popup?.textContent).toContain("CC BY 4.0");
    await act(async () => popup!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(visiblePopover()).toBeUndefined();
});

test("mode filtering precedes the limit and switching mode updates immediately without another request", async () => {
    const image = entry("matching-image", { addedAt: "2026-11-01T00:00:00Z" });
    feed.entries = [...Array.from({ length: 25 }, (_, index) => entry(`video-${index}`, { id: `seedance:video-${index}`, sourceId: "seedance", mode: "video", addedAt: new Date(Date.UTC(2026, 10, 5, index)).toISOString() })), image];
    view = await mount("image");
    expect(cards()[0].querySelector("strong")?.textContent).toBe(image.title);
    expect(cards().some((card) => card.textContent?.includes("灵感 video-"))).toBe(false);

    await view.setMode("video");
    expect(cards()).toHaveLength(21);
    expect(cards()[0].querySelector("strong")?.textContent).toBe("灵感 video-24");
    expect(cards().some((card) => card.textContent?.includes(image.title))).toBe(false);
    await click(cards()[0]);
    expect(view.started).toEqual([]);
    await usePreview();
    expect(view.started[0]).toEqual({ mode: "video", prompt: feed.entries[24].prompt });

    await view.setMode("text");
    expect(cards().length).toBeGreaterThan(0);
    expect(cards().some((card) => card.textContent?.includes("灵感 video-"))).toBe(false);
    await click(cards()[0]);
    expect(view.started).toHaveLength(1);
    await usePreview();
    expect(view.started[1]?.mode).toBe("text");
    expect(view.started[1]?.prompt.length).toBeGreaterThan(0);
    expect(requests).toEqual(["/public/inspirations/feed"]);
});

test("the feed is bounded to 21 newest cards without built-in filler when full", async () => {
    feed.entries = Array.from({ length: 25 }, (_, index) => entry(String(index), { addedAt: new Date(Date.UTC(2026, 10, 1, index)).toISOString() }));
    view = await mount();
    expect(cards()).toHaveLength(21);
    expect(cards()[0].querySelector("strong")?.textContent).toBe("灵感 24");
    expect(cards()[20].querySelector("strong")?.textContent).toBe("灵感 4");
    expect(view.host.textContent).not.toContain("雨巷旗袍");
});

test("closing a homepage preview leaves the prompt unchanged and clipboard failures remain visible", async () => {
    feed.entries = [entry("cancel")];
    view = await mount();
    await click(cards()[0]);
    failCopy = true;
    await click(buttonNamed(dialog(), "复制提示词"));
    expect(copied).toEqual([]);
    expect(document.body.textContent).toContain("复制失败");
    expect(view.started).toEqual([]);
    await click(buttonNamed(dialog(), "关闭"));
    expect(visibleDialogs()).toHaveLength(0);
    expect(view.started).toEqual([]);
    expect(catalogRequests).toEqual([]);
});

test("built-in video examples open a playable detail before applying their prompt", async () => {
    view = await mount("video");
    const first = cards()[0];
    expect(first.textContent).toContain("雨后的电车");
    await click(first);
    const video = dialog().querySelector<HTMLVideoElement>(".inspiration-detail-media video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/showcase/ghibli-tram.mp4");
    expect(video?.controls).toBe(true);
    expect(view.started).toEqual([]);
    await usePreview();
    expect(view.started).toHaveLength(1);
    expect(view.started[0].mode).toBe("video");
});

test("the hall opens the complete catalog across types and sources beyond the homepage limit", async () => {
    feed.entries = Array.from({ length: 25 }, (_, index) => entry(`hall-${index}`));
    const video = catalogEntry("静态视频", "video", { sourceId: "seedance" });
    const image = catalogEntry("静态图片", "image", { sourceId: "haohaoxue" });
    const text = catalogEntry("静态文本", "text");
    catalogEntries = { seedance: [video], haohaoxue: [image], youmind: [text] };
    view = await mount("image");
    expect(cards()).toHaveLength(21);
    expect(view.host.textContent).not.toContain("点一张把提示词带进创作区");
    await openHall();
    expect(modeOption("全部").getAttribute("aria-checked")).toBe("true");
    expect(dialog().textContent).toContain(`共 ${curatedInspirations.length + 28} 条灵感`);
    expect(catalogRequests.sort()).toEqual(["/inspirations/haohaoxue.json", "/inspirations/manifest.json", "/inspirations/seedance.json", "/inspirations/youmind.json"]);
    expect(dialog().querySelectorAll(".inspiration-gallery article")).toHaveLength(24);
    await click(modeOption("视频"));
    expect(galleryCard(video.title)).toBeDefined();
    expect(dialog().querySelector(".inspiration-gallery")?.textContent).not.toContain(text.title);
    await click(modeOption("文本"));
    expect(galleryCard(text.title)).toBeDefined();
    expect(dialog().querySelector(".inspiration-gallery")?.textContent).not.toContain(video.title);
    expect(view.started).toEqual([]);
    expect(view.host.querySelector("[data-location]")?.textContent).toBe("/createnull");
});

test("hall pagination resets only the library scroll for pages, jumps, and page sizes", async () => {
    catalogEntries.youmind = Array.from({ length: 200 }, (_, index) => catalogEntry(`分页-${index}`, "image"));
    view = await mount();
    await openHall();
    const library = dialog().querySelector<HTMLElement>(".creation-inspiration-dialog-library .app-workspace-scroll")!;
    const pagination = dialog().querySelector<HTMLElement>(".app-pagination-bar")!;
    const homepageScroll = window.scrollY;
    window.scrollTo({ top: 320 });

    const expectPage = (page: number, pageSize = 24) => {
        expect(pagination.querySelector('[aria-current="page"]')?.textContent).toBe(String(page));
        expect(dialog().querySelectorAll(".inspiration-gallery article")).toHaveLength(pageSize);
        expect(library.scrollTop).toBe(0);
        expect(window.scrollY).toBe(320);
    };

    try {
        expect(dialog().querySelectorAll(".inspiration-gallery article")).toHaveLength(24);
        const firstPage = dialog().querySelector(".inspiration-gallery")!.textContent;
        library.scrollTop = 360;
        await click(buttonNamed(pagination, "第 2 页"));
        expectPage(2);
        expect(dialog().querySelector(".inspiration-gallery")!.textContent).not.toBe(firstPage);

        library.scrollTop = 360;
        await click(buttonNamed(pagination, "下一页"));
        expectPage(3);

        const jump = pagination.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!;
        expect(jump).not.toBeNull();
        library.scrollTop = 360;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(jump, "8");
            jump.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        await act(async () => jump.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        await settle();
        expectPage(8);

        for (const size of [48, 96, 24]) {
            library.scrollTop = 360;
            const select = pagination.querySelector<HTMLElement>('[aria-label="每页数量"]')!;
            await act(async () => select.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
            await settle();
            const options = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"));
            expect(options.map((option) => option.textContent?.trim())).toEqual(["24 条/页", "48 条/页", "96 条/页"]);
            const option = options.find((item) => item.textContent?.trim() === `${size} 条/页`)!;
            await click(option);
            expectPage(1, size);
        }
    } finally {
        window.scrollTo({ top: homepageScroll });
    }
});

test("hall previews preserve the selected filter and copy or use the Chinese prompt without navigating", async () => {
    const item = catalogEntry("双语视频", "video", {
        sourceId: "seedance",
        promptZh: "中文提示词：镜头沿雨后的街道缓慢前移。",
        category: "cinema",
        tags: ["镜头语言", "雨夜"],
        credit: "目录作者",
        sourceUrl: "https://example.com/catalog/video",
    });
    catalogEntries.seedance = [item];
    view = await mount("image");
    await openHall();
    await click(modeOption("视频"));
    await click(galleryCard(item.title));
    expect(visibleDialogs()).toHaveLength(1);
    const preview = dialog().querySelector(".inspiration-detail")!;
    expect(preview.textContent).toContain(item.title);
    expect(preview.textContent).toContain(item.promptZh!);
    expect(preview.textContent).toContain(item.prompt);
    expect(preview.textContent).toContain(item.credit!);
    expect(preview.textContent).toContain("镜头语言");
    await click(buttonNamed(preview, "复制提示词"));
    expect(copied).toEqual([item.promptZh!]);
    expect(view.started).toEqual([]);
    await click(buttonNamed(dialog(), "返回灵感大厅"));
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(modeOption("视频").getAttribute("aria-checked")).toBe("true");
    await click(galleryCard(item.title));
    await usePreview();
    expect(view.started).toEqual([{ mode: "video", prompt: item.promptZh! }]);
    expect(view.host.querySelector("[data-location]")?.textContent).toBe("/createnull");
});

test.each(["Enter", " "])("keyboard %j moves focus into the preview and returns to the same filtered card", async (key) => {
    const item = catalogEntry("键盘预览", "video", { sourceId: "seedance" });
    catalogEntries.seedance = [item];
    view = await mount("image");
    await openHall();
    await click(modeOption("视频"));
    const card = galleryCard(item.title);
    const library = dialog().querySelector<HTMLElement>(".creation-inspiration-dialog-library")!;
    const list = library.querySelector<HTMLElement>(".app-workspace-scroll")!;
    library.scrollTop = 180;
    list.scrollTop = 180;
    await act(async () => {
        card.focus();
        card.dispatchEvent(new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    await settle();
    const title = dialog().querySelector<HTMLElement>(".creation-inspiration-dialog-header h2")!;
    expect(title.textContent).toBe("灵感详情");
    expect(title.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(title);
    expect(library.hidden).toBe(true);
    expect(view.started).toEqual([]);

    await click(buttonNamed(dialog(), "返回灵感大厅"));
    expect(library.hidden).toBe(false);
    expect(modeOption("视频").getAttribute("aria-checked")).toBe("true");
    expect(galleryCard(item.title)).toBe(card);
    expect(document.activeElement).toBe(card);
    expect(library.scrollTop).toBe(180);
    expect(list.scrollTop).toBe(180);
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(view.started).toEqual([]);
});

test("hall card shortcuts do not open a preview and apply the selected item only once", async () => {
    const item = catalogEntry("快捷文本", "text", { promptZh: "中文提示词：写一段悬疑故事的开场。" });
    catalogEntries.youmind = [item];
    view = await mount();
    await openHall();
    await click(modeOption("文本"));
    const card = galleryCard(item.title);
    const copy = buttonNamed(card, `复制提示词：${item.title}`);
    await act(async () => copy.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    await click(copy);
    expect(copied).toEqual([item.promptZh!]);
    expect(dialog().querySelector(".inspiration-detail")).toBeNull();
    expect(view.started).toEqual([]);
    await click(buttonNamed(card, `带进创作区：${item.title}`));
    expect(visibleDialogs()).toHaveLength(0);
    expect(view.started).toEqual([{ mode: "text", prompt: item.promptZh! }]);
    expect(view.startedWithOpenDialog).toEqual([false]);
    expect(document.activeElement).toBe(view.host.querySelector("[data-creation-prompt]"));
    await settle();
    expect(view.started).toHaveLength(1);
    expect(view.host.querySelector("[data-location]")?.textContent).toBe("/createnull");
});

test("feed normalization rejects unusable entries and deduplicates IDs without losing attribution", () => {
    const accepted = entry("accepted", { category: "cinema", tags: ["电影"] });
    feed.categories = { youmind: { cinema: "电影镜头" } };
    feed.entries = [
        accepted,
        { ...accepted, title: "重复条目" },
        entry("source", { sourceId: "unknown" }),
        entry("id", { id: "" }),
        entry("title", { title: "" }),
        entry("prompt", { prompt: "" }),
        entry("mode", { mode: "audio" as InspirationFeedEntry["mode"] }),
        entry("http", { image: "http://images.example.com/plain.webp" }),
        entry("image", { image: "javascript:alert(1)" }),
        entry("unsafe-link", { sourceUrl: "javascript:alert(1)" }),
    ];

    const entries = inspirationFeedEntries(feed);
    expect(entries.map((item) => item.id)).toEqual(["youmind:accepted", "youmind:unsafe-link"]);
    expect(entries[0]).toMatchObject({
        title: accepted.title,
        description: "电影镜头",
        mode: accepted.mode,
        prompt: accepted.prompt,
        credit: accepted.credit,
        sourceUrl: accepted.sourceUrl,
        addedAt: accepted.addedAt,
        publishedAt: accepted.publishedAt,
        category: "cinema",
        tags: ["电影"],
    });
    expect(entries[1].sourceUrl).toBeUndefined();
    expect(inspirationFeedEntries({ ...feed, enabled: false })).toEqual([]);
    expect(inspirationFeedEntries(null)).toEqual([]);
});
