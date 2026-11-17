import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import type { OnlineGalleryDetail, OnlineGallerySummary } from "@/services/api/online-gallery";
import type { ZzaiGalleryDetail, ZzaiGalleryPage, ZzaiGallerySummary } from "@/services/api/zzai-gallery";
import { authorizedEntry, authorizedMedia, authorizedSummary, policyVersion } from "./fixtures/authorized-inspirations";

const dom = new Window({ url: "http://localhost/create" });
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
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
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { getActiveUserScope, setActiveUserScope } = await import("@/lib/user-scope");
const { useInspirationStore } = await import("@/stores/use-inspiration-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { ZzaiGallery } = await import("@/pages/inspirations/zzai-gallery");

const originalAdapter = apiClient.defaults.adapter;
const originalStore = useInspirationStore.getState();
const originalStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState();
const originalScope = getActiveUserScope();
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let view: Awaited<ReturnType<typeof mount>> | undefined;
let calls: Array<{ url: string; cursor?: string; mediaType?: string; scope?: string; ids?: string[] }> = [];
let measurements: ReturnType<typeof installMasonryMeasurements> | undefined;
let onlineDetails: OnlineGalleryDetail[];
let failResolve = false;

function cssAspectRatio(value?: string): number {
    const [width, height = 1] = (value || "1").split("/").map(Number);
    return width > 0 && height > 0 ? width / height : 1;
}

/** Happy DOM 没有浏览器排版；此夹具仅提供确定性的 DOM 测量/观察回调，验证真实组件状态和定位样式。 */
function installMasonryMeasurements(initialWidth = 900) {
    let containerWidth = initialWidth;
    let notificationCount = 0;
    const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
    const originalComputedStyle = globalThis.getComputedStyle;
    const originalComputedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
    const originalMetrics = new Map<string, PropertyDescriptor | undefined>();
    const observers = new Set<ControlledResizeObserver>();

    const layoutSize = (element: HTMLElement) => {
        if (element.classList.contains("inspiration-gallery")) return { width: containerWidth, height: Number.parseFloat(element.style.height) || 0 };
        if (element.classList.contains("inspiration-masonry-cell")) {
            if (containerWidth <= 0) return { width: 0, height: 0 };
            const width = element.style.width.endsWith("%") ? containerWidth : Number.parseFloat(element.style.width) || containerWidth;
            const cover = element.querySelector<HTMLElement>(".inspiration-card-cover");
            const descriptionLength = element.querySelector(".inspiration-card-desc")?.textContent?.length ?? 0;
            return { width, height: width / cssAspectRatio(cover?.style.aspectRatio) + 180 + (descriptionLength > 100 ? 100 : 0) };
        }
        return undefined;
    };
    const transformScale = (element: HTMLElement) => {
        let scale = 1;
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
            const match = /^scale\(([\d.]+)\)$/.exec(ancestor.style.transform);
            if (match) scale *= Number(match[1]);
        }
        return scale;
    };

    class ControlledResizeObserver {
        targets = new Set<Element>();
        constructor(readonly callback: ResizeObserverCallback) {
            observers.add(this);
        }
        observe(target: Element) {
            this.targets.add(target);
        }
        unobserve(target: Element) {
            this.targets.delete(target);
        }
        disconnect() {
            this.targets.clear();
            observers.delete(this);
        }
    }

    dom.HTMLElement.prototype.getBoundingClientRect = function () {
        const size = layoutSize(this);
        if (size) {
            const scale = transformScale(this);
            return new dom.DOMRect((Number.parseFloat(this.style.left) || 0) * scale, (Number.parseFloat(this.style.top) || 0) * scale, size.width * scale, size.height * scale);
        }
        return originalRect.call(this);
    };
    for (const property of ["clientWidth", "offsetWidth", "offsetHeight"] as const) {
        originalMetrics.set(property, Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, property));
        let prototype: object | null = dom.HTMLElement.prototype;
        let inheritedDescriptor: PropertyDescriptor | undefined;
        while (prototype && !inheritedDescriptor) {
            inheritedDescriptor = Object.getOwnPropertyDescriptor(prototype, property);
            prototype = Object.getPrototypeOf(prototype);
        }
        Object.defineProperty(dom.HTMLElement.prototype, property, {
            configurable: true,
            get() {
                const size = layoutSize(this);
                if (size) return Math.round(property === "offsetHeight" ? size.height : size.width);
                return inheritedDescriptor?.get?.call(this) ?? inheritedDescriptor?.value ?? 0;
            },
        });
    }
    Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        writable: true,
        value: (element: Element, pseudo?: string | null) => {
            const style = originalComputedStyle(element, pseudo);
            const size = layoutSize(element as HTMLElement);
            if (!size) return style;
            // 布局尺寸不读取 rect，后者独立模拟祖先 transform 后的视觉边界。
            return new Proxy(style, {
                get(target, property) {
                    if (property === "width" || property === "height") return `${size[property]}px`;
                    if (property === "getPropertyValue") return (name: string) => (name === "width" || name === "height" ? `${size[name]}px` : target.getPropertyValue(name));
                    const value = Reflect.get(target, property, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        },
    });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ControlledResizeObserver });

    return {
        setWidth(width: number) {
            containerWidth = width;
        },
        notify() {
            for (const observer of [...observers]) {
                if (!observer.targets.size) continue;
                notificationCount += 1;
                observer.callback([], observer as unknown as ResizeObserver);
            }
        },
        get notificationCount() {
            return notificationCount;
        },
        dispose() {
            dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
            for (const [property, descriptor] of originalMetrics) {
                if (descriptor) Object.defineProperty(dom.HTMLElement.prototype, property, descriptor);
                else Reflect.deleteProperty(dom.HTMLElement.prototype, property);
            }
            if (originalComputedDescriptor) Object.defineProperty(globalThis, "getComputedStyle", originalComputedDescriptor);
            else Reflect.deleteProperty(globalThis, "getComputedStyle");
            if (originalObserver) Object.defineProperty(globalThis, "ResizeObserver", originalObserver);
            else Reflect.deleteProperty(globalThis, "ResizeObserver");
            observers.clear();
        },
    };
}

function detail(slug = "sample"): ZzaiGalleryDetail {
    return authorizedEntry(slug, {
        title: `画廊测试-${slug}`,
        description: "本地测试夹具",
        mode: "video",
        model: "测试视频模型",
        prompt: "请让镜头缓慢经过树林。",
        promptZh: undefined,
        videoUrl: authorizedMedia(slug, "video"),
        category: "story",
        credit: "原作者测试署名",
        sourceUrl: "https://example.com/original-source",
    });
}

function summary(slug = "sample"): ZzaiGallerySummary {
    return authorizedSummary(detail(slug));
}

function onlineDetail(slug = "sample"): OnlineGalleryDetail {
    return {
        id: `zzai-gallery:${slug}`,
        slug,
        sourceId: "zzai-gallery",
        title: `社区画廊-${slug}`,
        description: "在线来源协议测试",
        mode: "video",
        model: "社区视频模型",
        category: "story",
        width: 800,
        height: 600,
        image: `https://cdn.example.com/${slug}.webp`,
        videoUrl: `https://cdn.example.com/${slug}.mp4`,
        credit: `社区作者 ${slug}`,
        sourceUrl: `https://example.com/works/${slug}`,
        galleryUrl: `https://api.seedance.nz/prompt-gallery/${slug}`,
        prompt: `Current online prompt for ${slug}.`,
        promptZh: `${slug} 的当前在线提示词。`,
    };
}

function onlineSummary(item: OnlineGalleryDetail): OnlineGallerySummary {
    const { prompt: _prompt, promptZh: _promptZh, ...result } = item;
    return result;
}

function signIn(scope: string) {
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: scope, displayName: scope, role: "user", status: "active" }, hydrated: true });
    useInspirationStore.setState({ hydrated: true, hydrationScope: scope, hydrationError: "", favorites: [], externalFavorites: [] });
}

beforeEach(async () => {
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    signIn("gallery-user-a");
    calls = [];
    onlineDetails = [onlineDetail(), onlineDetail("next")];
    failResolve = false;
    apiClient.defaults.adapter = async (config) => {
        calls.push({ url: config.url!, cursor: config.params?.cursor, ...(config.url?.endsWith("/resolve") ? { ids: JSON.parse(config.data).ids } : {}) });
        if (config.url?.includes("/zzai-gallery/")) {
            const selected = onlineDetails.filter((item) => !config.params?.media_type || item.mode === config.params.media_type);
            const payload = config.url.endsWith("/facets")
                ? { categories: [...new Set(selected.map((item) => item.category))], models: [...new Set(selected.map((item) => item.model))], tags: [], total: selected.length }
                : config.url.endsWith("/prompts")
                  ? { items: (config.params?.cursor ? selected.slice(1) : selected.slice(0, 1)).map(onlineSummary), total: selected.length, nextCursor: config.params?.cursor || selected.length <= 1 ? "" : "next-page" }
                  : onlineDetails.find((item) => item.slug === config.url!.split("/").at(-1));
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: payload, msg: "" } };
        }
        if (failResolve && config.url?.endsWith("/resolve")) throw new Error("Approved library resolution unavailable");
        const payload = config.url?.endsWith("resolve")
            ? { policyVersion, items: (JSON.parse(config.data).ids as string[]).filter((id) => id.startsWith("authorized-library:")).map((id) => summary(id.slice("authorized-library:".length))) }
            : config.url?.endsWith("facets")
              ? { policyVersion, categories: ["story"], models: ["测试视频模型"], tags: [], total: 2 }
              : config.url?.endsWith("/prompts")
                ? { policyVersion, items: [summary(config.params?.cursor ? "next" : "sample")], total: 2, nextCursor: config.params?.cursor ? "" : "next-page" }
                : detail(config.url!.split("/").at(-1));
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: payload, msg: "" } };
    };
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    measurements?.dispose();
    measurements = undefined;
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState(originalStore);
    useInspirationStore.persist.setOptions({ storage: originalStorage });
    useUserStore.setState(originalUser);
    setActiveUserScope(originalScope);
    apiClient.defaults.adapter = originalAdapter;
    dom.document.querySelectorAll(".ant-message").forEach((node) => node.remove());
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function settleUntil(check: () => boolean) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (check()) return;
        await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    expect(check()).toBe(true);
}

async function mount(props: { onUse?: (item: any) => void; onPreview?: (item: any) => void; ancestorScale?: number; cachedPages?: ZzaiGalleryPage[]; onlineSource?: boolean; gcTime?: number } = {}) {
    const host = dom.document.createElement("div");
    if (props.ancestorScale !== undefined) host.style.transform = `scale(${props.ancestorScale})`;
    dom.document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: props.gcTime ?? 0 } } });
    if (props.cachedPages) {
        client.setQueryData(["public", "inspirations", "authorized-library", policyVersion, useUserStore.getState().user?.id ?? "guest", { search: "", sort: "latest", limit: 24 }], {
            pages: props.cachedPages,
            pageParams: props.cachedPages.map((_page, index) => (index ? `cached-page-${index}` : "")),
        });
    }
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <ZzaiGallery initialSource={props.onlineSource ? undefined : "authorized-library"} onUse={props.onUse ?? (() => {})} onPreview={props.onPreview ?? (() => {})} />
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        );
    });
    await settleUntil(() => Boolean(host.querySelector(".inspiration-card")));
    return {
        host,
        client,
        async dispose() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

async function click(node: Element | null | undefined) {
    expect(node).toBeTruthy();
    await act(async () => {
        (node as HTMLElement).click();
    });
}

const buttonByText = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(text));

async function chooseGallerySelect(label: string, optionText: string) {
    const input = view!.host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    await act(async () => input!.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    await settleUntil(() => [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].some((node) => node.textContent?.trim() === optionText));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((node) => node.textContent?.trim() === optionText);
    await click(option);
}

const masonryCells = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".inspiration-masonry-cell")];
const cellIds = (host: HTMLElement) => masonryCells(host).map((cell) => cell.dataset.inspirationId);
const cellPlacement = (cell: HTMLElement) => ({ width: cell.style.width, left: cell.style.left, top: cell.style.top });

function measuredSummary(slug: string, width = 900, height = 900, extra: Partial<ZzaiGallerySummary> = {}): ZzaiGallerySummary {
    return { ...summary(slug), width, height, ...extra };
}

function galleryResponse(config: InternalAxiosRequestConfig, payload: unknown) {
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { policyVersion, ...(payload as object) }, msg: "" } };
}

test("the hall defaults to the online source and retains independent approved browsing after pagination and preview", async () => {
    const previewed: OnlineGalleryDetail[] = [];
    view = await mount({ onlineSource: true, onPreview: (item) => previewed.push(item) });
    expect(calls.every((call) => call.url.includes("/zzai-gallery/"))).toBe(true);
    expect(view.host.querySelector('[aria-label="画廊素材来源"]')?.closest(".ant-select")?.textContent).toContain("在线图库");
    expect(view.host.textContent).toContain("本站未核验其转载或商用授权");
    expect(view.host.querySelector('[aria-label="素材署名与许可"]')).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/prompts/sample"))).toBe(false);
    await click(buttonByText(view.host, "加载更多"));
    await settleUntil(() => view!.host.querySelectorAll(".inspiration-card").length === 2);
    expect(calls.some((call) => call.url === "/public/inspirations/zzai-gallery/prompts" && call.cursor === "next-page")).toBe(true);
    await click(view.host.querySelector('.inspiration-card[aria-label="预览画廊提示词：社区画廊-sample"]'));
    await settleUntil(() => previewed.length === 1);
    expect(previewed[0]).toMatchObject({ id: "zzai-gallery:sample", sourceId: "zzai-gallery", prompt: onlineDetails[0].prompt, galleryUrl: onlineDetails[0].galleryUrl });
    expect("authorization" in previewed[0]).toBe(false);
    await chooseGallerySelect("画廊素材来源", "本站审核库");
    await settleUntil(() => Boolean(view!.host.querySelector('[data-inspiration-id="authorized-library:sample"]')));
    expect(view.host.querySelector('[data-inspiration-id^="zzai-gallery:"]')).toBeNull();
    expect(view.host.textContent).toContain("提示词许可：CC BY 4.0");
    expect(calls.filter((call) => call.url === "/public/inspirations/library/prompts").map((call) => call.cursor)).toEqual([undefined]);
    await chooseGallerySelect("画廊素材来源", "在线图库");
    await settleUntil(() => Boolean(view!.host.querySelector('[data-inspiration-id="zzai-gallery:sample"]')));
    expect(view.host.querySelector('[data-inspiration-id^="authorized-library:"]')).toBeNull();
});

test("online favorites render local snapshots without resolve and copy or use only freshly loaded source details", async () => {
    const saved = { ...onlineDetail(), prompt: "旧本地英文正文", promptZh: "旧本地中文正文" };
    useInspirationStore.setState({ favorites: [saved.id], externalFavorites: [saved] });
    const used: OnlineGalleryDetail[] = [];
    view = await mount({ onlineSource: true, onUse: (item) => used.push(item) });
    const requestsBefore = calls.length;
    await click(buttonByText(view.host, "本地收藏"));
    await settleUntil(() => Boolean(view!.host.querySelector('[data-inspiration-id="zzai-gallery:sample"]')));
    expect(calls).toHaveLength(requestsBefore);
    expect(calls.some((call) => call.url.endsWith("/resolve"))).toBe(false);
    expect(view.host.textContent).toContain("外部收藏为本地快照");
    const copied: string[] = [];
    const originalCopy = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (text) => {
        copied.push(text);
    };
    try {
        onlineDetails[0] = { ...onlineDetails[0], promptZh: "复制前在线重新读取的正文。" };
        await click(buttonByText(view.host, "复制提示词"));
        await settleUntil(() => copied.length === 1);
        expect(copied).toEqual([onlineDetails[0].promptZh!]);
        onlineDetails[0] = { ...onlineDetails[0], promptZh: "带入前在线重新读取的正文。" };
        await click(buttonByText(view.host, "带入创作"));
        await settleUntil(() => used.length === 1);
        expect(used[0].promptZh).toBe(onlineDetails[0].promptZh);
        expect(calls.filter((call) => call.url === "/public/inspirations/zzai-gallery/prompts/sample")).toHaveLength(2);
        apiClient.defaults.adapter = async () => {
            throw new Error("Online detail unavailable");
        };
        await click(buttonByText(view.host, "带入创作"));
        await settleUntil(() => !view!.host.querySelector(".inspiration-card-new"));
        expect(used).toHaveLength(1);
        expect(useInspirationStore.getState().externalFavorites[0]).toEqual(saved);
        expect(view.host.querySelector('[data-inspiration-id="zzai-gallery:sample"]')).not.toBeNull();
    } finally {
        navigator.clipboard.writeText = originalCopy;
    }
});

test("mixed favorites resolve only approved IDs and a library outage does not hide valid online snapshots", async () => {
    const online = onlineDetail();
    const approved = detail();
    useInspirationStore.setState({ favorites: [online.id, approved.id], externalFavorites: [online, { ...approved, prompt: "不可信的授权库缓存正文" }] });
    view = await mount({ onlineSource: true });
    await click(buttonByText(view.host, "本地收藏"));
    await settleUntil(() => view!.host.querySelectorAll(".inspiration-card").length === 2);
    expect(calls.filter((call) => call.url.endsWith("/resolve")).every((call) => JSON.stringify(call.ids) === JSON.stringify([approved.id]))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/resolve"))).toBe(true);
    expect(view.host.querySelectorAll('[aria-label="素材署名与许可"]')).toHaveLength(1);
    expect(view.host.querySelectorAll('[aria-label="示例来源与授权提示"]')).toHaveLength(1);
    failResolve = true;
    await act(async () => {
        await view!.client.refetchQueries({ queryKey: ["public", "inspirations", "authorized-library"] });
    });
    await settleUntil(() => view!.host.querySelectorAll(".inspiration-card").length === 1);
    expect(view.host.querySelector('[data-inspiration-id="zzai-gallery:sample"]')).not.toBeNull();
    expect(view.host.querySelector('[data-inspiration-id="authorized-library:sample"]')).toBeNull();
    expect(view.host.textContent).toContain("当前无法复核本站审核库收藏");
    expect(view.host.textContent).not.toContain("不可信的授权库缓存正文");
    expect(useInspirationStore.getState().favorites).toEqual([online.id, approved.id]);
    expect(useInspirationStore.getState().externalFavorites).toHaveLength(2);
});

test.each(["source", "media"] as const)("hall cached %s revisit fetches again and hides previous cards while verification is pending", async (dimension) => {
    const onlineSource = dimension === "media";
    const source = onlineSource ? "zzai-gallery" : "authorized-library";
    const endpoint = `/public/inspirations/${onlineSource ? "zzai-gallery" : "library"}/prompts`;
    view = await mount({ onlineSource, gcTime: 60_000 });
    const originalQuery = view.client
        .getQueryCache()
        .getAll()
        .find((query) => query.queryKey[2] === source && !query.queryKey.includes("favorites"))!;
    expect(originalQuery.state.data).toBeDefined();
    const originalTitle = view.host.querySelector(".inspiration-card-title")!.textContent!;
    if (dimension === "source") await chooseGallerySelect("画廊素材来源", "在线图库");
    else await click(buttonByText(view.host.querySelector<HTMLElement>('[aria-label="画廊媒体类型"]')!, "视频"));
    await settleUntil(() => view!.client.isFetching() === 0);
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
            response.data.data.items = response.data.data.items.map((item: ZzaiGallerySummary | OnlineGallerySummary) => ({ ...item, title: "回访核验后的大厅作品" }));
            await pending;
        }
        return response;
    };
    try {
        if (dimension === "source") await chooseGallerySelect("画廊素材来源", "本站审核库");
        else await click(buttonByText(view.host.querySelector<HTMLElement>('[aria-label="画廊媒体类型"]')!, "全部类型"));
        await settleUntil(() => requested);
        expect(view.host.querySelector(".inspiration-card")).toBeNull();
        expect(view.host.textContent).not.toContain(originalTitle);
        expect(view.host.textContent).toContain("正在加载在线画廊");
        expect(view.host.textContent).not.toContain("在线图库暂未返回示例");
        expect(view.host.textContent).not.toContain("尚未发布已核验素材");
        expect(view.client.isFetching()).toBeGreaterThan(0);
        await act(async () => release());
        await settleUntil(() => view!.host.querySelector(".inspiration-card-title")?.textContent === "回访核验后的大厅作品");
        expect(view.client.getQueryData(originalQuery.queryKey)).toBeDefined();
    } finally {
        release();
    }
});

test("online browsing requests summaries only, then loads the next cursor and full detail on preview", async () => {
    const previewed: ZzaiGalleryDetail[] = [];
    view = await mount({ onPreview: (item) => previewed.push(item) });
    expect(calls.some((call) => call.url.endsWith("/prompts/sample"))).toBe(false);
    expect(view.host.textContent).toContain("当前筛选共 2 条，已加载 1 条");
    expect(view.host.querySelector('[aria-label="在线提示词画廊"]')).toBeTruthy();
    expect(view.host.textContent).not.toContain("ZZAI");
    expect(view.host.textContent).toContain("原作者测试署名");
    expect(view.host.querySelector('a[href="https://example.com/original-source"]')?.textContent).toContain("查看原始出处");
    expect(view.host.querySelector('a[href^="https://api.seedance.nz/prompt-gallery"]')).toBeNull();
    await click(buttonByText(view.host, "加载更多"));
    await settleUntil(() => view!.host.querySelectorAll(".inspiration-card").length === 2);
    expect(calls.some((call) => call.cursor === "next-page")).toBe(true);
    await click(view.host.querySelector('.inspiration-card[aria-label="预览画廊提示词：画廊测试-sample"]'));
    await settleUntil(() => previewed.length === 1);
    expect(previewed[0].prompt).toBe(detail().prompt);
    expect(previewed[0].videoUrl).toBe(detail().videoUrl);
});

test("收藏仅显示resolve当前摘要，使用重新请求授权详情", async () => {
    const used: ZzaiGalleryDetail[] = [];
    view = await mount({ onUse: (item) => used.push(item) });
    await click(view.host.querySelector('button[aria-label="收藏：画廊测试-sample"]'));
    await settleUntil(() => useInspirationStore.getState().externalFavorites.length === 1);
    expect(useInspirationStore.getState().externalFavorites[0].prompt).toBe(detail().prompt);
    await click(buttonByText(view.host, "本地收藏"));
    await settleUntil(() => Boolean(view!.host.querySelector(".inspiration-card")));
    const requestsBefore = calls.length;
    await click(buttonByText(view.host, "带入创作"));
    await settleUntil(() => used.length === 1);
    expect(calls.length).toBeGreaterThan(requestsBefore);
    expect(used[0].prompt).toBe(detail().prompt);
    expect(view.host.textContent).toContain("当前筛选显示 1 条收藏");
    expect(view.host.textContent).toContain("审核库素材经当前服务复核");
});

test("empty detail prompts are not passed into creation or saved as favorites", async () => {
    let used = 0;
    view = await mount({
        onUse: () => {
            used += 1;
        },
    });
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { ...detail(), prompt: " " }, msg: "" } });
    await click(buttonByText(view.host, "带入创作"));
    await settleUntil(() => !view!.host.querySelector(".inspiration-card-new"));
    expect(used).toBe(0);
    expect(useInspirationStore.getState().externalFavorites).toEqual([]);
});

test("favorite controls remain disabled while the local snapshot write is awaiting persistence", async () => {
    view = await mount();
    let release = () => {};
    let notifyWrite = () => {};
    const writing = new Promise<void>((resolve) => {
        notifyWrite = resolve;
    });
    useInspirationStore.persist.setOptions({
        storage: {
            getItem: () => null,
            removeItem: () => {},
            setItem: () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                    notifyWrite();
                }),
        },
    });
    await click(view.host.querySelector('button[aria-label="收藏：画廊测试-sample"]'));
    await writing;
    expect(view.host.querySelector<HTMLButtonElement>('button[aria-label="取消收藏：画廊测试-sample"]')?.disabled).toBe(true);
    await act(async () => {
        release();
    });
    await settleUntil(() => view!.host.querySelector<HTMLButtonElement>('button[aria-label="取消收藏：画廊测试-sample"]')?.disabled === false);
    expect(useInspirationStore.getState().externalFavorites[0].prompt).toBe(detail().prompt);
});

test("an account switch cancels an old detail response and hides the previous account's snapshots", async () => {
    let previewed = 0;
    view = await mount({
        onPreview: () => {
            previewed += 1;
        },
    });
    let release = () => {};
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
    });
    apiClient.defaults.adapter = (config) => {
        if (config.url?.endsWith("/sample"))
            return new Promise((resolve) => {
                release = () => resolve({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: detail(), msg: "" } });
                notifyStarted();
            });
        return Promise.resolve(galleryResponse(config, config.url?.endsWith("facets") ? { categories: [], models: [], tags: [], total: 0 } : { items: [], total: 0, nextCursor: "" }));
    };
    await click(view.host.querySelector(".inspiration-card"));
    await started;
    await act(async () => {
        signIn("gallery-user-b");
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await settleUntil(() => !view!.host.querySelector(".inspiration-card"));
    expect(previewed).toBe(0);
    expect(useInspirationStore.getState().externalFavorites).toEqual([]);
});

test("旧收藏身份或授权字段不合法时只显示隐藏数量，不展示正文媒体且保留原记录", async () => {
    const archived = { ...detail(), id: "zzai-gallery:old", sourceId: "zzai-gallery", title: "不能展示的旧标题", prompt: "不能复制的旧正文", image: "https://example.com/legacy-secret.png" };
    useInspirationStore.setState({ favorites: [archived.id], externalFavorites: [archived as never] });
    view = await mount();
    await click(buttonByText(view.host, "本地收藏"));
    await settleUntil(() => !view!.host.querySelector(".inspiration-card"));
    expect(view.host.textContent).toContain("部分历史收藏暂不可展示，已隐藏，原记录未删除（1 条）");
    expect(view.host.textContent).not.toContain(archived.title);
    expect(view.host.textContent).not.toContain(archived.prompt);
    expect(view.host.querySelector(`img[src="${archived.image}"]`)).toBeNull();
    expect(useInspirationStore.getState().externalFavorites[0]).toEqual(archived);
});

test("当前收藏resolve失败后隐藏已展示条目，不回退本地快照", async () => {
    useInspirationStore.setState({ favorites: [detail().id], externalFavorites: [{ ...detail(), prompt: "不可信本地快照" }] });
    view = await mount();
    await click(buttonByText(view.host, "本地收藏"));
    await settleUntil(() => Boolean(view!.host.querySelector(".inspiration-card")));
    apiClient.defaults.adapter = async () => {
        throw new Error("Authorization service unavailable");
    };
    await act(async () => {
        await view!.client.invalidateQueries({ queryKey: ["public", "inspirations"] });
    });
    await settleUntil(() => !view!.host.querySelector(".inspiration-card"));
    expect(view.host.textContent).toContain("当前无法复核本站审核库收藏，相关内容已隐藏，原记录未删除");
    expect(view.host.textContent).not.toContain("不可信本地快照");
    expect(useInspirationStore.getState().favorites).toEqual([detail().id]);
});

test("已批准收藏下架后不能使用、复制或新增收藏；每次动作重新GET", async () => {
    let used = 0;
    view = await mount({
        onUse: () => {
            used += 1;
        },
    });
    const copied: string[] = [];
    const originalCopy = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (text) => {
        copied.push(text);
    };
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 40401, data: null, msg: "已下架", reason: "not_found" } });
    try {
        await click(buttonByText(view.host, "带入创作"));
        await settleUntil(() => !view!.host.querySelector(".inspiration-card-new"));
        await click(buttonByText(view.host, "复制提示词"));
        await settleUntil(() => !view!.host.querySelector(".inspiration-card-new"));
        await click(view.host.querySelector('button[aria-label="收藏：画廊测试-sample"]'));
        await settleUntil(() => !view!.host.querySelector(".inspiration-card-new"));
        expect(used).toBe(0);
        expect(copied).toEqual([]);
        expect(useInspirationStore.getState().favorites).toEqual([]);
    } finally {
        navigator.clipboard.writeText = originalCopy;
    }
});

test("授权列表重新核验失败即隐藏缓存，署名和两项许可始终可见", async () => {
    view = await mount();
    expect(view.host.querySelectorAll('[aria-label="素材署名与许可"]')).toHaveLength(1);
    expect(view.host.textContent).toContain("提示词许可：CC BY 4.0");
    expect(view.host.textContent).toContain("媒体许可：CC BY 4.0");
    apiClient.defaults.adapter = async () => {
        throw new Error("Authorization service unavailable");
    };
    await act(async () => {
        await view!.client.invalidateQueries({ queryKey: ["public", "inspirations"] });
    });
    await settleUntil(() => !view!.host.querySelector(".inspiration-card"));
    expect(view.host.textContent).toContain("在线画廊暂不可用");
});

test("three cursor pages keep first-seen duplicate metadata, old DOM nodes and measured prefix positions", async () => {
    measurements = installMasonryMeasurements();
    const firstPage = [measuredSummary("alpha", 600, 1200), measuredSummary("beta", 1200, 800), measuredSummary("gamma"), measuredSummary("delta", 1600, 900), measuredSummary("epsilon", 800, 1000), measuredSummary("zeta")];
    const conflictingBeta = { ...firstPage[1], title: "重复页不得覆盖的标题", description: "更长的重复页内容。".repeat(30), width: 400, height: 1600, image: authorizedMedia("beta").replace("b".repeat(64), "d".repeat(64)) };
    const secondPage = [conflictingBeta, measuredSummary("eta", 600, 900), measuredSummary("theta"), measuredSummary("iota", 1000, 600)];
    const thirdPage = [{ ...firstPage[0], title: "第三页重复alpha", width: 2000, height: 300 }, { ...secondPage[2], title: "第三页重复theta" }, measuredSummary("kappa", 600, 1200)];
    apiClient.defaults.adapter = async (config) => {
        calls.push({ url: config.url!, cursor: config.params?.cursor });
        if (config.url?.endsWith("facets")) return galleryResponse(config, { categories: [], models: [], tags: [], total: 10 });
        const cursor = config.params?.cursor;
        return galleryResponse(config, { items: cursor === "page-three" ? thirdPage : cursor === "page-two" ? secondPage : firstPage, total: 10, nextCursor: cursor === "page-three" ? "" : cursor === "page-two" ? "page-three" : "page-two" });
    };
    view = await mount();
    const gallery = view.host.querySelector<HTMLElement>(".inspiration-gallery")!;
    expect(gallery.dataset.columnCount).toBe("3");
    const originalCells = masonryCells(view.host);
    const originalArticles = originalCells.map((cell) => cell.querySelector(".inspiration-card"));
    const originalPositions = originalCells.map(cellPlacement);
    const originalHeight = Number.parseFloat(gallery.style.height);
    expect(new Set(originalPositions.map((position) => position.left)).size).toBe(3);
    expect(originalPositions.some((position) => Number.parseFloat(position.top) > 0)).toBe(true);

    await click(buttonByText(view.host, "加载更多"));
    await settleUntil(() => masonryCells(view!.host).length === 9);
    await act(async () => measurements!.notify());
    expect(view.host.querySelector(".inspiration-gallery")).toBe(gallery);
    expect(cellIds(view.host)).toEqual([...firstPage, ...secondPage.slice(1)].map((item) => item.id));
    for (const [index, cell] of originalCells.entries()) {
        expect(masonryCells(view.host)[index]).toBe(cell);
        expect(cell.querySelector(".inspiration-card")).toBe(originalArticles[index]);
        expect(cellPlacement(cell)).toEqual(originalPositions[index]);
    }
    const beta = originalCells[1];
    expect(beta.querySelector(".inspiration-card-title")?.textContent).toBe(firstPage[1].title);
    expect(beta.querySelector("img")?.getAttribute("src")).toBe(firstPage[1].image);
    expect(cssAspectRatio(beta.querySelector<HTMLElement>(".inspiration-card-cover")?.style.aspectRatio)).toBe(1.5);
    expect(Number.parseFloat(gallery.style.height)).toBeGreaterThan(originalHeight);
    const secondPageCells = masonryCells(view.host);
    const secondPagePositions = secondPageCells.map(cellPlacement);

    await click(buttonByText(view.host, "加载更多"));
    await settleUntil(() => masonryCells(view!.host).length === 10);
    await act(async () => measurements!.notify());
    expect(gallery.dataset.columnCount).toBe("3");
    expect(cellIds(view.host)).toEqual([...firstPage, ...secondPage.slice(1), thirdPage[2]].map((item) => item.id));
    for (const [index, cell] of secondPageCells.entries()) {
        expect(masonryCells(view.host)[index]).toBe(cell);
        expect(cellPlacement(cell)).toEqual(secondPagePositions[index]);
    }
    expect(calls.filter((call) => call.url.endsWith("/prompts")).map((call) => call.cursor)).toEqual([undefined, "page-two", "page-three"]);
    expect(calls.some((call) => /\/prompts\//.test(call.url))).toBe(false);
    expect(buttonByText(view.host, "加载更多")).toBeUndefined();
});

test("a media filter starts a fresh measured dataset and never mixes a late old cursor page", async () => {
    measurements = installMasonryMeasurements();
    const oldItems = [measuredSummary("shared", 1200, 600), measuredSummary("old-only"), measuredSummary("old-third")];
    const filteredItems = [measuredSummary("shared", 400, 1000, { title: "筛选后的shared", mode: "image" }), measuredSummary("filtered-only", 900, 900, { mode: "image" })];
    let releaseOldPage = () => {};
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
    });
    apiClient.defaults.adapter = (config) => {
        calls.push({ url: config.url!, cursor: config.params?.cursor, mediaType: config.params?.media_type });
        if (config.url?.endsWith("facets")) return Promise.resolve(galleryResponse(config, { categories: [], models: [], tags: [], total: 2 }));
        if (config.params?.cursor === "old-cursor") {
            notifyStarted();
            return new Promise((resolve) => {
                releaseOldPage = () => resolve(galleryResponse(config, { items: [measuredSummary("late-old-page")], total: 4, nextCursor: "" }));
            });
        }
        return Promise.resolve(
            galleryResponse(config, { items: config.params?.media_type === "image" ? filteredItems : oldItems, total: config.params?.media_type === "image" ? 2 : 4, nextCursor: config.params?.media_type === "image" ? "" : "old-cursor" }),
        );
    };
    view = await mount();
    const oldGallery = view.host.querySelector(".inspiration-gallery");
    const oldSharedCell = masonryCells(view.host)[0];
    await click(buttonByText(view.host, "加载更多"));
    await started;
    await click(buttonByText(view.host.querySelector<HTMLElement>('[aria-label="画廊媒体类型"]')!, "图片"));
    await settleUntil(() => view!.host.textContent?.includes("筛选后的shared") === true);
    await act(async () => {
        releaseOldPage();
        await new Promise((resolve) => setTimeout(resolve, 20));
        measurements!.notify();
    });
    expect(view.host.querySelector(".inspiration-gallery")).not.toBe(oldGallery);
    expect(masonryCells(view.host)[0]).not.toBe(oldSharedCell);
    expect(cellIds(view.host)).toEqual(filteredItems.map((item) => item.id));
    expect(masonryCells(view.host)[0].style.top).toBe("0px");
    expect(cssAspectRatio(masonryCells(view.host)[0].querySelector<HTMLElement>(".inspiration-card-cover")?.style.aspectRatio)).toBe(0.4);
    expect(view.host.textContent).not.toContain("late-old-page");
    expect(view.host.textContent).not.toContain("画廊测试-old-only");
    expect(calls.filter((call) => call.url.endsWith("/prompts") && call.mediaType === "image").map((call) => call.cursor)).toEqual([undefined]);
});

test("an account change resets loaded pages and same-ID DOM measurements instead of reusing previous account data", async () => {
    measurements = installMasonryMeasurements();
    const oldItems = [measuredSummary("shared", 1200, 600), measuredSummary("account-a-only")];
    const nextItems = [measuredSummary("shared", 600, 1200, { title: "账号B的shared" }), measuredSummary("account-b-only")];
    apiClient.defaults.adapter = async (config) => {
        const scope = getActiveUserScope();
        calls.push({ url: config.url!, cursor: config.params?.cursor, scope });
        if (config.url?.endsWith("facets")) return galleryResponse(config, { categories: [], models: [], tags: [], total: 2 });
        return galleryResponse(config, {
            items: scope === "gallery-user-b" ? nextItems : config.params?.cursor ? [measuredSummary("account-a-page-two")] : oldItems,
            total: scope === "gallery-user-b" ? 2 : 3,
            nextCursor: scope === "gallery-user-b" || config.params?.cursor ? "" : "account-a-cursor",
        });
    };
    view = await mount();
    await click(buttonByText(view.host, "加载更多"));
    await settleUntil(() => masonryCells(view!.host).length === 3);
    const oldGallery = view.host.querySelector(".inspiration-gallery");
    const oldSharedCell = masonryCells(view.host)[0];
    await act(async () => signIn("gallery-user-b"));
    await settleUntil(() => view!.host.textContent?.includes("账号B的shared") === true);
    await act(async () => measurements!.notify());
    expect(view.host.querySelector(".inspiration-gallery")).not.toBe(oldGallery);
    expect(masonryCells(view.host)[0]).not.toBe(oldSharedCell);
    expect(cellIds(view.host)).toEqual(nextItems.map((item) => item.id));
    expect(masonryCells(view.host)[0].style.top).toBe("0px");
    expect(cssAspectRatio(masonryCells(view.host)[0].querySelector<HTMLElement>(".inspiration-card-cover")?.style.aspectRatio)).toBe(0.5);
    expect(view.host.textContent).not.toContain("account-a-page-two");
    expect(view.host.textContent).not.toContain("account-a-only");
    expect(calls.filter((call) => call.url.endsWith("/prompts") && call.scope === "gallery-user-b").map((call) => call.cursor)).toEqual([undefined]);
});

test("hidden zero-width observations preserve measured masonry positions and restore them when visible", async () => {
    measurements = installMasonryMeasurements();
    apiClient.defaults.adapter = async (config) =>
        galleryResponse(
            config,
            config.url?.endsWith("facets")
                ? { categories: [], models: [], tags: [], total: 5 }
                : { items: [measuredSummary("portrait", 600, 1200), measuredSummary("landscape", 1200, 600), measuredSummary("square"), measuredSummary("fourth"), measuredSummary("fifth")], total: 5, nextCursor: "" },
        );
    view = await mount();
    const gallery = view.host.querySelector<HTMLElement>(".inspiration-gallery")!;
    const cells = masonryCells(view.host);
    const placements = cells.map(cellPlacement);
    const height = gallery.style.height;
    expect(gallery.dataset.columnCount).toBe("3");
    await act(async () => {
        view!.host.hidden = true;
        measurements!.setWidth(0);
        measurements!.notify();
    });
    expect(measurements.notificationCount).toBeGreaterThan(0);
    expect(gallery.dataset.columnCount).toBe("3");
    expect(gallery.style.height).toBe(height);
    expect(masonryCells(view.host).map(cellPlacement)).toEqual(placements);
    await act(async () => {
        view!.host.hidden = false;
        measurements!.setWidth(900);
        measurements!.notify();
    });
    expect(gallery.style.height).toBe(height);
    for (const [index, cell] of cells.entries()) expect(masonryCells(view.host)[index]).toBe(cell);
    expect(masonryCells(view.host).map(cellPlacement)).toEqual(placements);
});

test("a cached gallery mounts under scale animation with four untransformed columns without a transform-end resize callback", async () => {
    measurements = installMasonryMeasurements(1080);
    const cachedItems = [
        measuredSummary("cached-square-1"),
        measuredSummary("cached-landscape-1", 1200, 600),
        measuredSummary("cached-portrait-1", 600, 1200),
        measuredSummary("cached-square-2"),
        measuredSummary("cached-square-3"),
        measuredSummary("cached-landscape-2", 1200, 600),
        measuredSummary("cached-portrait-2", 600, 1200),
        measuredSummary("cached-square-4"),
    ];
    apiClient.defaults.adapter = async (config) => {
        calls.push({ url: config.url! });
        return galleryResponse(config, config.url?.endsWith("facets") ? { categories: [], models: [], tags: [], total: 8 } : { items: cachedItems, total: 8, nextCursor: "" });
    };
    view = await mount({ ancestorScale: 0.2, cachedPages: [{ policyVersion, items: cachedItems, total: 8, nextCursor: "" }] });
    const gallery = view.host.querySelector<HTMLElement>(".inspiration-gallery")!;
    const cells = masonryCells(view.host);
    expect(calls.filter((call) => call.url.endsWith("/prompts"))).toHaveLength(1);
    expect(gallery.getBoundingClientRect().width).toBeCloseTo(216);
    expect(Number.parseFloat(getComputedStyle(gallery).width)).toBe(1080);
    expect(gallery.clientWidth).toBe(1080);
    expect(gallery.dataset.columnCount).toBe("4");
    expect(cells[0].getBoundingClientRect().width).toBeCloseTo(51.6);
    expect(Number.parseFloat(getComputedStyle(cells[0]).width)).toBe(258);
    expect(cells[0].offsetWidth).toBe(258);
    const placements = cells.map(cellPlacement);
    expect(placements).toEqual([
        { width: "258px", left: "0px", top: "0px" },
        { width: "258px", left: "274px", top: "0px" },
        { width: "258px", left: "548px", top: "0px" },
        { width: "258px", left: "822px", top: "0px" },
        { width: "258px", left: "274px", top: "325px" },
        { width: "258px", left: "0px", top: "454px" },
        { width: "258px", left: "822px", top: "454px" },
        { width: "258px", left: "548px", top: "712px" },
    ]);
    expect(gallery.style.height).toBe("1150px");
    expect(measurements.notificationCount).toBe(0);
    await act(async () => {
        view!.host.style.transform = "scale(1)";
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(measurements.notificationCount).toBe(0);
    expect(gallery.getBoundingClientRect().width).toBe(1080);
    expect(gallery.dataset.columnCount).toBe("4");
    expect(gallery.style.height).toBe("1150px");
    for (const [index, cell] of cells.entries()) expect(masonryCells(view.host)[index]).toBe(cell);
    expect(masonryCells(view.host).map(cellPlacement)).toEqual(placements);
});

test("remote image load and error events do not replace fixed cover ratios or measured prefix positions", async () => {
    measurements = installMasonryMeasurements();
    apiClient.defaults.adapter = async (config) =>
        galleryResponse(
            config,
            config.url?.endsWith("facets")
                ? { categories: [], models: [], tags: [], total: 4 }
                : {
                      items: [
                          measuredSummary("portrait", 600, 1200),
                          measuredSummary("ratio-only", 0, 0, { ratio: "4:3" }),
                          { ...summary("fallback-video"), width: undefined, height: undefined },
                          { ...summary("fallback-image"), mode: "image", width: undefined, height: undefined },
                      ],
                      total: 4,
                      nextCursor: "",
                  },
        );
    view = await mount();
    const cells = masonryCells(view.host);
    const covers = cells.map((cell) => cell.querySelector<HTMLElement>(".inspiration-card-cover")!);
    const ratios = covers.map((cover) => cover.style.aspectRatio);
    const placements = cells.map(cellPlacement);
    expect(ratios.map(cssAspectRatio)).toEqual([0.5, 4 / 3, 16 / 9, 1]);
    await act(async () => {
        for (const cell of cells) {
            const image = cell.querySelector("img")!;
            Object.defineProperty(image, "naturalWidth", { configurable: true, value: 4000 });
            Object.defineProperty(image, "naturalHeight", { configurable: true, value: 100 });
            image.dispatchEvent(new dom.Event("load"));
        }
        measurements!.notify();
    });
    expect(covers.map((cover) => cover.style.aspectRatio)).toEqual(ratios);
    expect(masonryCells(view.host).map(cellPlacement)).toEqual(placements);
    await act(async () => {
        for (const cell of cells) cell.querySelector("img")!.dispatchEvent(new dom.Event("error"));
        measurements!.notify();
    });
    expect(covers.map((cover) => cover.style.aspectRatio)).toEqual(ratios);
    expect(masonryCells(view.host).map(cellPlacement)).toEqual(placements);
});
