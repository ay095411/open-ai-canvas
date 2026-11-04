import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import type { Asset, ImageAsset } from "@/stores/use-asset-store";

// DOM 必须先于 ReactDOM 初始化；独立进程避免模块替身影响其它素材测试。
const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
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
const { CanceledError } = await import("axios");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const assetStoreModule = await import("@/stores/use-asset-store");
const syncModule = await import("@/services/user-data-sync");
const { useAssetStore, withAssetStorePersistenceSuppressed } = assetStoreModule;
const originalStoreExports = { ...assetStoreModule };
const originalSyncExports = { ...syncModule };
const originalAdapter = apiClient.defaults.adapter;
const originalUser = useUserStore.getState();
const originalAssets = useAssetStore.getState().assets;
const userId = "picker-upload-user";
const otherUserId = "another-user";
const events: string[] = [];
const requests: { page: number; pageSize: number; status?: string }[] = [];
let remoteAssets: Asset[] = [];
let failRefresh = false;
let localPersistence = Promise.resolve();
let remotePersistence = Promise.resolve();
let remoteSaveError: Error | undefined;
let blockedRead: ReturnType<typeof deferred> | undefined;
let cancelledReads = 0;

const flushPersistence = mock(async () => {
    events.push("flush:start");
    await localPersistence;
    events.push("flush:done");
});
const saveRemote = mock(async (input?: string | readonly string[]) => {
    expect(input).toEqual([]);
    events.push("save:start");
    await remotePersistence;
    if (remoteSaveError) throw remoteSaveError;
    const local = useAssetStore.getState().assets;
    const known = new Set(local.map((entry) => entry.id));
    remoteAssets = [...local, ...remoteAssets.filter((entry) => !known.has(entry.id))];
    events.push("save:done");
});
mock.module("@/stores/use-asset-store", () => ({ ...originalStoreExports, flushAssetStorePersistence: flushPersistence }));
mock.module("@/services/user-data-sync", () => ({ ...originalSyncExports, saveRemoteUserDataNow: saveRemote }));
const { AssetLibraryPickerModal } = await import("@/components/assets/asset-library-picker-modal");
type PickerProps = ComponentProps<typeof AssetLibraryPickerModal>;
let currentView: Awaited<ReturnType<typeof mount>> | undefined;

apiClient.defaults.adapter = async (config) => {
    if (config.url !== "/assets") throw new Error(`Unexpected request: ${config.url}`);
    const params = config.params as { page?: number; pageSize?: number; status?: string; kind?: string; category?: string; q?: string };
    const page = Number(params.page || 1);
    const pageSize = Number(params.pageSize || 40);
    requests.push({ page, pageSize, status: params.status });
    events.push(`read:${page}`);
    if (failRefresh) throw new Error("列表刷新暂时不可用");
    const assets = remoteAssets.filter(
        (entry) => (entry.status === "archived") === (params.status === "archived") && (!params.kind || entry.kind === params.kind) && (!params.category || entry.category === params.category) && (!params.q || entry.title.includes(params.q)),
    );
    // 请求开始时冻结响应，模拟上传前发出的慢 GET；取消信号与 Axios adapter 一致。
    const pendingRead = pageSize === 40 ? blockedRead : undefined;
    if (pendingRead) blockedRead = undefined;
    if (pendingRead) {
        const signal = config.signal as AbortSignal | undefined;
        await new Promise<void>((resolve, reject) => {
            const abort = () => {
                cancelledReads += 1;
                signal?.removeEventListener("abort", abort);
                reject(new CanceledError("列表请求已取消"));
            };
            if (signal?.aborted) return abort();
            signal?.addEventListener("abort", abort, { once: true });
            void pendingRead.promise.then(() => {
                signal?.removeEventListener("abort", abort);
                resolve();
            });
        });
    }
    return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: {
            code: 0,
            data: {
                assets: assets.slice((page - 1) * pageSize, page * pageSize),
                total: assets.length,
                page,
                pageSize,
                hasMore: page * pageSize < assets.length,
                kindCounts: { image: assets.length },
                categoryCounts: { material: assets.length },
                folderCounts: {},
            },
        },
    };
};

function imageAsset(id: string): ImageAsset {
    return {
        id,
        title: id,
        kind: "image",
        category: "material",
        status: "confirmed",
        coverUrl: "",
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: { dataUrl: "data:image/png;base64,AAAA", width: 100, height: 100, bytes: 1, mimeType: "image/png" },
    };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

async function settle(ms = 40) {
    await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

async function mount(overrides: Partial<PickerProps> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    const onConfirm = mock((..._args: Parameters<PickerProps["onConfirm"]>) => {});
    const uploadedIds: string[] = [];
    const onUpload = mock(async () => {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...entry } = imageAsset("新增图片");
        const id = withAssetStorePersistenceSuppressed(() => useAssetStore.getState().addAsset(entry));
        uploadedIds.push(id);
        events.push("upload:done");
        return [id];
    });
    function Picker() {
        const assets = useAssetStore((state) => state.assets);
        const items = assets.map((asset): AssetLibraryPickerItem => ({ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: "图片", asset }));
        return (
            <AssetLibraryPickerModal
                remoteLibrary
                acceptRemoteItems
                open
                items={items}
                categoryLabels={{ all: "全部素材", material: "素材", other: "其他", archived: "回收站" }}
                onClose={() => {}}
                onConfirm={onConfirm}
                upload={{ accept: "image/*", description: "上传图片", onUpload }}
                {...overrides}
            />
        );
    }
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <Picker />
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
    return {
        client,
        onUpload,
        onConfirm,
        uploadedIds,
        unmount: async () => {
            await act(() => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

async function uploadFile() {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const files = [new dom.File(["image"], "upload.png", { type: "image/png" })];
    Object.defineProperty(input!, "files", { configurable: true, value: Object.assign(files, { item: (index: number) => files[index] || null }) });
    await act(async () => input!.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event));
    await settle();
}

function displayedTitles() {
    return [...document.querySelectorAll(".asset-picker-card-copy strong")].map((entry) => entry.textContent);
}

function selectedCard() {
    return document.querySelector<HTMLButtonElement>('.asset-picker-card-action[aria-pressed="true"]');
}

beforeEach(() => {
    events.length = 0;
    requests.length = 0;
    failRefresh = false;
    remoteSaveError = undefined;
    blockedRead = undefined;
    cancelledReads = 0;
    localPersistence = Promise.resolve();
    remotePersistence = Promise.resolve();
    flushPersistence.mockClear();
    saveRemote.mockClear();
    remoteAssets = Array.from({ length: 41 }, (_, index) => imageAsset(`已有图片${index + 1}`));
    withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [] }));
    useUserStore.setState({ user: { id: userId, username: userId, displayName: "Picker", role: "user", status: "active" }, hydrated: true });
});

afterEach(async () => {
    await currentView?.unmount();
    currentView = undefined;
});

afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState(originalUser);
    withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: originalAssets }));
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("素材库选择器上传同步", () => {
    test("首屏旧查询未完成时先取消再刷新，迟到的旧响应不能覆盖上传结果", async () => {
        const oldResponse = deferred();
        blockedRead = oldResponse;
        currentView = await mount();
        expect(requests.filter((request) => request.pageSize === 40)).toHaveLength(1);
        const firstQuery = currentView.client.getQueryCache().find({ queryKey: ["asset-picker", userId, "active", 1, 40], exact: false });
        expect(firstQuery).toBeDefined();
        expect(firstQuery!.state.data).toBeUndefined();

        await uploadFile();
        expect(events).toContain("save:done");
        expect(cancelledReads).toBe(1);
        expect(requests.filter((request) => request.pageSize === 40).length).toBeGreaterThan(1);
        expect(displayedTitles()[0]).toBe("新增图片");
        expect(selectedCard()?.title).toBe("新增图片");
        expect(document.querySelector(".asset-picker-count")?.textContent).toContain("42 个素材");

        await act(async () => oldResponse.resolve());
        await settle();
        expect(displayedTitles()[0]).toBe("新增图片");
        expect(selectedCard()?.title).toBe("新增图片");
        expect(document.querySelector(".asset-picker-count")?.textContent).toContain("已选 1 · 42 个素材");
        expect(currentView.onUpload).toHaveBeenCalledTimes(1);
    });

    test("本地与远端保存完成后才刷新、回第一页并选中新素材，缓存失效按账号隔离", async () => {
        const local = deferred();
        const remote = deferred();
        localPersistence = local.promise;
        remotePersistence = remote.promise;
        currentView = await mount();
        const next = document.querySelector<HTMLButtonElement>('button[aria-label="下一页"]');
        expect(next).not.toBeNull();
        await act(async () => next!.click());
        await settle();
        expect(displayedTitles()).toEqual(["已有图片41"]);
        const ownLibraryKey = ["asset-library", userId, 1];
        const otherKeys = [
            ["asset-library", otherUserId, 1],
            ["asset-picker", otherUserId, 1],
        ];
        currentView.client.setQueryData(ownLibraryKey, { marker: "owned" });
        for (const key of otherKeys) currentView.client.setQueryData(key, { marker: "other" });
        const readsBefore = requests.length;

        await uploadFile();
        expect(events).toContain("flush:start");
        expect(saveRemote).not.toHaveBeenCalled();
        expect(requests).toHaveLength(readsBefore);
        expect(document.querySelector(".ant-message-success")).toBeNull();
        await act(async () => local.resolve());
        await settle();
        expect(saveRemote).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(readsBefore);
        expect(document.querySelector(".ant-message-success")).toBeNull();
        await act(async () => remote.resolve());
        await settle();

        expect(events.indexOf("flush:done")).toBeLessThan(events.indexOf("save:start"));
        expect(events.findIndex((entry, index) => index > events.indexOf("save:done") && entry.startsWith("read:"))).toBeGreaterThan(events.indexOf("save:done"));
        expect(displayedTitles()[0]).toBe("新增图片");
        expect(selectedCard()?.title).toBe("新增图片");
        expect(document.querySelector(".asset-picker-count")?.textContent).toContain("已选 1");
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')?.disabled).toBe(true);
        expect(currentView.client.getQueryState(ownLibraryKey)?.isInvalidated).toBe(true);
        expect(currentView.client.getQueryData<{ total: number }>(["asset-picker", userId, "stats", "active"])?.total).toBe(42);
        expect(currentView.client.getQueryData<{ total: number }>(["asset-picker", userId, "stats", "archived"])?.total).toBe(0);
        expect(requests.filter((request) => request.pageSize === 1 && request.status === "active")).toHaveLength(2);
        expect(requests.filter((request) => request.pageSize === 1 && request.status === "archived")).toHaveLength(2);
        for (const key of otherKeys) expect(currentView.client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(document.querySelector(".ant-message-success")?.textContent).toContain("保存到素材库");
    });

    test("服务端保存失败时保留本地素材，明确提示未同步且不冒充成功", async () => {
        remoteSaveError = new Error("服务端拒绝保存");
        currentView = await mount();
        const readsBefore = requests.length;
        await uploadFile();
        expect(useAssetStore.getState().assets.map((entry) => entry.title)).toEqual(["新增图片"]);
        expect(saveRemote).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(readsBefore);
        expect(document.querySelector(".ant-message-success")).toBeNull();
        expect(document.body.textContent).toContain("服务端拒绝保存");
        expect(document.body.textContent).toContain("保存在本机，但云端保存失败");
        expect(document.querySelector<HTMLButtonElement>(".asset-picker-upload")?.disabled).toBe(false);
    });

    test("刷新失败与上传失败区分，已保存的选择仍可确认且不会重新上传", async () => {
        currentView = await mount();
        failRefresh = true;
        await uploadFile();
        expect(events).toContain("save:done");
        expect(currentView.onUpload).toHaveBeenCalledTimes(1);
        expect(saveRemote).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).toContain("已保存");
        expect(document.body.textContent).toContain("刷新");
        expect(document.body.textContent).not.toContain("素材上传失败");
        const confirm = [...document.querySelectorAll<HTMLButtonElement>(".asset-picker-actions button")].find((entry) => entry.textContent?.includes("使用已选素材"));
        expect(confirm?.disabled).toBe(false);
        await act(async () => confirm!.click());
        expect(currentView.onConfirm).toHaveBeenCalledTimes(1);
        expect(currentView.onConfirm.mock.calls[0]?.[0]).toEqual(currentView.uploadedIds);
    });

    test("插件上传只更新插件条目和选择，不触发本地持久化或本地素材查询", async () => {
        const pluginItem: AssetLibraryPickerItem = {
            id: "external:eagle:new",
            title: "插件新素材",
            category: "external:eagle",
            kindLabel: "图片",
            imageUrl: "data:image/png;base64,AAAA",
            external: { sourceId: "eagle", sourceName: "Eagle", item: { id: "new", title: "插件新素材", kind: "image", fileUrl: "https://example.com/image.png" } },
        };
        const externalUpload = mock(async () => [pluginItem]);
        const localUpload = mock(async () => []);
        currentView = await mount({
            categoryLabels: { all: "全部素材", material: "素材", "external:eagle": "Eagle" },
            upload: { accept: "image/*", description: "本地上传", onUpload: localUpload, external: { accept: "image/*", description: "插件上传", onUpload: externalUpload } },
        });
        const ownLibraryKey = ["asset-library", userId, 1];
        currentView.client.setQueryData(ownLibraryKey, { marker: "owned" });
        await act(async () => document.querySelector<HTMLButtonElement>(".asset-picker-title-trigger")!.click());
        await settle();
        const pluginSource = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) => entry.textContent?.includes("插件来源"));
        expect(pluginSource).toBeDefined();
        await act(async () => pluginSource!.click());
        await settle();
        const readsBefore = requests.length;
        await uploadFile();

        expect(externalUpload).toHaveBeenCalledTimes(1);
        expect(localUpload).not.toHaveBeenCalled();
        expect(flushPersistence).not.toHaveBeenCalled();
        expect(saveRemote).not.toHaveBeenCalled();
        expect(requests).toHaveLength(readsBefore);
        expect(currentView.client.getQueryState(ownLibraryKey)?.isInvalidated).toBe(false);
        expect(displayedTitles()).toEqual(["插件新素材"]);
        expect(selectedCard()?.title).toBe("插件新素材");
        expect(document.querySelector('img[alt="插件新素材"]')?.classList.contains("is-contain")).toBe(true);
    });

    test("上传期间切换账号会中止旧回调，旧上传不会触发新账号保存或选择", async () => {
        const pending = deferred();
        let signal: AbortSignal | undefined;
        const delayedUpload = mock(async (_files: FileList, uploadSignal: AbortSignal) => {
            signal = uploadSignal;
            await pending.promise;
            uploadSignal.throwIfAborted();
            return ["old-account-upload"];
        });
        currentView = await mount({ upload: { accept: "image/*", description: "延迟上传", onUpload: delayedUpload } });
        await uploadFile();
        expect(signal?.aborted).toBe(false);
        await act(async () => useUserStore.setState({ user: { id: otherUserId, username: otherUserId, displayName: "Other", role: "user", status: "active" } }));
        await act(async () => pending.resolve());
        await settle();
        expect(signal?.aborted).toBe(true);
        expect(flushPersistence).not.toHaveBeenCalled();
        expect(saveRemote).not.toHaveBeenCalled();
        expect(document.querySelector(".asset-picker-count")?.textContent).toContain("已选 0");
        expect(document.querySelector(".ant-message-success")).toBeNull();
    });

    test("本地图片和视频预览默认完整展示，显式封面裁切仍可保留", async () => {
        const image = imageAsset("长图");
        const video: Asset = { ...imageAsset("视频"), kind: "video", data: { url: "data:video/mp4;base64,AAAA", width: 100, height: 200, bytes: 1, mimeType: "video/mp4" } };
        currentView = await mount({
            remoteLibrary: false,
            items: [
                { id: image.id, title: image.title, category: "material", kindLabel: "图片", asset: image },
                { id: video.id, title: video.title, category: "material", kindLabel: "视频", asset: video },
                { id: "cover", title: "裁切封面", category: "material", kindLabel: "图片", imageUrl: image.data.dataUrl, imageFit: "cover" },
            ],
        });
        expect(document.querySelector('img[alt="长图"]')?.classList.contains("is-contain")).toBe(true);
        expect(document.querySelector('video[aria-label="视频"]')?.classList.contains("is-contain")).toBe(true);
        const cover = document.querySelector('img[alt="裁切封面"]');
        expect(cover).not.toBeNull();
        expect(cover!.classList.contains("is-contain")).toBe(false);
    });
});
