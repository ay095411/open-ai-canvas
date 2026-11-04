import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { Asset, AssetCategory } from "@/stores/use-asset-store";

// 独立进程中先安装 DOM，再加载 ReactDOM，避免全量测试先前的环境探测缓存影响输入事件。
const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const { AssetLibraryPickerModal } = await import("@/components/assets/asset-library-picker-modal");

type PickerProps = ComponentProps<typeof AssetLibraryPickerModal>;
type RequestRecord = { page: number; pageSize: number; status?: string; kind?: string; category?: string; q?: string };
const originalAdapter = apiClient.defaults.adapter;
const originalUser = useUserStore.getState();
const requests: RequestRecord[] = [];
let remoteAssets: Asset[] = [];
let failSummary = false;
let currentView: Awaited<ReturnType<typeof mount>> | undefined;

apiClient.defaults.adapter = async (config) => {
    if (config.url !== "/assets") throw new Error(`Unexpected request: ${config.url}`);
    const params = config.params as RequestRecord;
    requests.push({ ...params });
    if (failSummary && Number(params.pageSize) === 1) throw new Error("统计暂时不可用");
    const scope = remoteAssets.filter((asset) => (asset.status === "archived") === (params.status === "archived"));
    const assets = scope.filter((asset) => (!params.kind || asset.kind === params.kind) && (!params.category || asset.category === params.category) && (!params.q || asset.title.includes(params.q)));
    const countBy = (key: "kind" | "category") =>
        scope.reduce<Record<string, number>>((counts, asset) => {
            const value = asset[key] || "other";
            counts[value] = (counts[value] || 0) + 1;
            return counts;
        }, {});
    const page = Number(params.page || 1);
    const pageSize = Number(params.pageSize || 40);
    return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: {
            code: 0,
            data: { assets: assets.slice((page - 1) * pageSize, page * pageSize), total: assets.length, page, pageSize, hasMore: page * pageSize < assets.length, kindCounts: countBy("kind"), categoryCounts: countBy("category"), folderCounts: {} },
        },
    };
};

function asset(id: string, kind: "image" | "video", category: AssetCategory, archived = false): Asset {
    const base = { id, title: id, kind, category, status: archived ? ("archived" as const) : ("confirmed" as const), coverUrl: "", tags: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    return kind === "image"
        ? { ...base, kind, data: { dataUrl: "data:image/png;base64,AAAA", width: 100, height: 100, bytes: 1, mimeType: "image/png" } }
        : { ...base, kind, data: { url: "data:video/mp4;base64,AAAA", width: 100, height: 100, bytes: 1, mimeType: "video/mp4" } };
}

const localItems: AssetLibraryPickerItem[] = [
    { id: "image-a", title: "道具图片一", category: "prop", kindLabel: "图片", mediaKind: "image" },
    { id: "image-b", title: "道具图片二", category: "prop", kindLabel: "图片", mediaKind: "image" },
    { id: "video-a", title: "素材视频", category: "material", kindLabel: "视频", mediaKind: "video" },
    { id: "text-a", title: "素材文本", category: "other", kindLabel: "文本", mediaKind: "text" },
    { id: "archived-image", title: "归档图片", category: "prop", kindLabel: "图片", mediaKind: "image", archived: true },
    { id: "archived-video", title: "归档视频", category: "material", kindLabel: "视频", mediaKind: "video", archived: true },
];

async function settle(ms = 40) {
    await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

async function mount(overrides: Partial<PickerProps> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
    const onConfirm = mock(() => {});
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <AssetLibraryPickerModal
                            open
                            items={localItems}
                            categoryLabels={{ all: "全部素材", prop: "道具", material: "素材", other: "其他", archived: "回收站" }}
                            mediaKinds={["image", "video", "text"]}
                            onClose={() => {}}
                            onConfirm={onConfirm}
                            {...overrides}
                        />
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
    return {
        client,
        onConfirm,
        unmount: async () => {
            await act(() => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

function sidebarButton(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".asset-picker-categories button")].find((element) => element.querySelector(".assets-filter-item-label")?.textContent === label);
    expect(button).toBeDefined();
    return button!;
}

function badge(label: string) {
    return sidebarButton(label).querySelector(".assets-filter-count")?.textContent;
}

function displayedTitles() {
    return [...document.querySelectorAll(".asset-picker-card-copy strong")].map((element) => element.textContent);
}

function header() {
    return document.querySelector(".asset-picker-count")?.textContent;
}
function searchInput() {
    return document.querySelector<HTMLInputElement>('input[aria-label="搜索素材"]')!;
}

async function choose(label: string) {
    await act(async () => sidebarButton(label).click());
    await settle();
}

async function search(value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(searchInput(), value);
        searchInput().dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    await settle(300);
}

async function selectCard(title: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".asset-picker-card-action")].find((element) => element.title === title);
    expect(button).toBeDefined();
    await act(async () => button!.click());
}

beforeEach(() => {
    requests.length = 0;
    failSummary = false;
    remoteAssets = [
        ...Array.from({ length: 45 }, (_, index) => asset(`图片${String(index + 1).padStart(2, "0")}`, "image", "prop")),
        ...Array.from({ length: 45 }, (_, index) => asset(`视频${index + 1}`, "video", "material")),
        ...Array.from({ length: 40 }, (_, index) => asset(`归档视频${index + 1}`, "video", "material", true)),
        ...Array.from({ length: 3 }, (_, index) => asset(`归档图片${index + 1}`, "image", "prop", true)),
    ];
    useUserStore.setState({ user: { id: "picker-test-user", username: "picker-test-user", displayName: "Picker", role: "user", status: "active" }, hydrated: true });
});

afterEach(async () => {
    await currentView?.unmount();
    currentView = undefined;
});
afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState(originalUser);
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("素材库选择器筛选与统计", () => {
    test("本地侧栏统计不受类型、分类和搜索组合影响", async () => {
        currentView = await mount();
        await choose("图片");
        await choose("道具");
        await search("图片一");
        expect(displayedTitles()).toEqual(["道具图片一"]);
        expect(header()).toContain("1 个素材");
        expect(badge("全部类型")).toBe("4");
        expect(badge("全部素材")).toBe("4");
        expect(badge("图片")).toBe("2");
        expect(badge("视频")).toBe("1");
        expect(badge("道具")).toBe("2");
        expect(badge("回收站")).toBe("2");
    });

    test("回收站清除隐藏筛选，侧栏稳定且归档选择不会带回正常库", async () => {
        currentView = await mount();
        await choose("图片");
        await choose("道具");
        await search("图片一");
        await selectCard("道具图片一");
        await choose("回收站");
        expect(searchInput().value).toBe("");
        expect(displayedTitles()).toEqual(["归档图片", "归档视频"]);
        expect(header()).toContain("已选 0");
        expect(sidebarButton("全部类型").getAttribute("aria-pressed")).toBe("false");
        expect(sidebarButton("全部素材").getAttribute("aria-pressed")).toBe("false");
        expect(sidebarButton("回收站").getAttribute("aria-pressed")).toBe("true");
        expect(badge("全部素材")).toBe("4");
        expect(badge("道具")).toBe("2");
        await selectCard("归档视频");
        await choose("道具");
        expect(displayedTitles()).toEqual(["道具图片一", "道具图片二"]);
        expect(header()).toContain("已选 0");
        expect(sidebarButton("全部类型").getAttribute("aria-pressed")).toBe("true");
        expect(sidebarButton("道具").getAttribute("aria-pressed")).toBe("true");
        expect(sidebarButton("回收站").getAttribute("aria-pressed")).toBe("false");
    });

    test("远端分页总数仅用于结果，侧栏使用独立完整计数", async () => {
        currentView = await mount({ remoteLibrary: true, acceptRemoteItems: true, items: [] });
        expect(displayedTitles()).toHaveLength(40);
        expect(badge("全部素材")).toBe("90");
        expect(badge("回收站")).toBe("43");
        const next = document.querySelector<HTMLButtonElement>('[title="下一页"] button, button[aria-label="下一页"], button[aria-label="Next Page"]');
        expect(next).not.toBeNull();
        await act(async () => next!.click());
        await settle();
        expect(requests.some((request) => request.page === 2 && request.pageSize === 40)).toBe(true);
        expect(badge("全部类型")).toBe("90");
        await choose("图片");
        await choose("道具");
        await search("图片01");
        expect(displayedTitles()).toEqual(["图片01"]);
        expect(header()).toContain("1 个素材");
        expect(badge("全部类型")).toBe("90");
        expect(badge("全部素材")).toBe("90");
        expect(badge("道具")).toBe("45");
        await choose("回收站");
        expect(displayedTitles()).toHaveLength(40);
        expect(header()).toContain("43 个素材");
        expect(badge("回收站")).toBe("43");
        expect(badge("全部素材")).toBe("90");
        expect(badge("视频")).toBe("45");
        const archivedRequest = requests.findLast((request) => request.status === "archived" && request.pageSize === 40)!;
        expect(archivedRequest.page).toBe(1);
        expect(archivedRequest.kind).toBeUndefined();
        expect(archivedRequest.category).toBeUndefined();
        expect(archivedRequest.q || "").toBe("");
        await search("不存在的素材");
        expect(displayedTitles()).toHaveLength(0);
        expect(document.querySelector(".asset-picker-empty strong")?.textContent).toBe("没有匹配的素材");
        expect(badge("回收站")).toBe("43");
        const deletePage = [...document.querySelectorAll<HTMLButtonElement>(".asset-picker-actions button")].find((button) => button.textContent === "删除当前页");
        expect(deletePage).toBeDefined();
        expect(deletePage!.disabled).toBe(true);
    });

    test("空回收站不会让媒体和分类导航消失或重置计数", async () => {
        remoteAssets = remoteAssets.filter((item) => item.status !== "archived");
        currentView = await mount({ remoteLibrary: true, acceptRemoteItems: true, items: [] });
        await choose("视频");
        await choose("回收站");
        expect(document.querySelector(".asset-picker-empty strong")?.textContent).toBe("回收站是空的");
        expect(badge("回收站")).toBe("0");
        expect(badge("全部素材")).toBe("90");
        expect(badge("视频")).toBe("45");
        await choose("图片");
        expect(displayedTitles()).toHaveLength(40);
        expect(sidebarButton("图片").getAttribute("aria-pressed")).toBe("true");
        expect(header()).toContain("45 个素材");
    });

    test("固定媒体类型的总量正确且不伪造分类交叉统计", async () => {
        currentView = await mount({ remoteLibrary: true, acceptRemoteItems: true, remoteKind: "image", mediaKinds: ["image"], items: [] });
        expect(badge("全部素材")).toBe("45");
        expect(badge("道具")).toBeUndefined();
        expect(badge("回收站")).toBe("3");
        await choose("道具");
        await search("图片01");
        expect(header()).toContain("1 个素材");
        expect(badge("全部素材")).toBe("45");
        await choose("回收站");
        expect(displayedTitles()).toHaveLength(3);
        expect(requests.findLast((request) => request.status === "archived" && request.pageSize === 40)?.kind).toBe("image");
    });

    test("回收站末页数量减少后回到有效页，仍显示剩余素材", async () => {
        currentView = await mount({ remoteLibrary: true, acceptRemoteItems: true, items: [] });
        await choose("回收站");
        const next = document.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!;
        await act(async () => next.click());
        await settle();
        expect(displayedTitles()).toEqual(["归档图片1", "归档图片2", "归档图片3"]);

        const remaining = remoteAssets.filter((item) => item.status === "archived").slice(0, 10);
        remoteAssets = [...remoteAssets.filter((item) => item.status !== "archived"), ...remaining];
        const requestsBeforeRefresh = requests.length;
        await act(async () => currentView!.client.invalidateQueries({ queryKey: ["asset-picker"] }));
        await settle();

        expect(displayedTitles()).toEqual(remaining.map((item) => item.title));
        expect(header()).toContain("10 个素材");
        expect(badge("回收站")).toBe("10");
        expect(document.querySelector(".asset-picker-empty")).toBeNull();
        expect(requests.slice(requestsBeforeRefresh).some((request) => request.status === "archived" && request.pageSize === 40 && request.page === 1)).toBe(true);
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')!.disabled).toBe(true);
    });

    test("独立统计失败时不把少量本地缓存冒充全库总数", async () => {
        failSummary = true;
        currentView = await mount({ remoteLibrary: true, acceptRemoteItems: true, items: localItems });
        expect(displayedTitles()).toHaveLength(40);
        expect(header()).toContain("90 个素材");
        expect(requests.filter((request) => request.pageSize === 1)).toHaveLength(2);
        expect(badge("全部类型")).toBe("");
        expect(badge("全部素材")).toBeUndefined();
        expect(badge("回收站")).toBe("");

        await choose("图片");
        expect(header()).toContain("45 个素材");
        expect(badge("全部类型")).toBe("");
        expect(badge("全部素材")).toBeUndefined();
        expect(badge("道具")).toBeUndefined();
    });
});
