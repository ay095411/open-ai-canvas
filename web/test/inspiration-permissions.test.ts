import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { OfficialCatalogEntry } from "../src/lib/inspirations/official-catalog";
import { invalidateInspirationCatalog } from "../src/services/inspiration-catalog";

const dom = new Window({ url: "http://localhost/create" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, Event: dom.Event })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
const { default: localforage } = await import("localforage");
const { useInspirationStore } = await import("../src/stores/use-inspiration-store");
const { useUserStore } = await import("../src/stores/use-user-store");
const { apiClient } = await import("../src/services/api/request");

const originalState = useInspirationStore.getState();
const originalStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState();
const originalScope = getActiveUserScope();
const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let records: Map<string, string>;
let readSpy: ReturnType<typeof spyOn<typeof localforage, "getItem">>;
let writeSpy: ReturnType<typeof spyOn<typeof localforage, "setItem">>;
const item: OfficialCatalogEntry = {
    id: "seedance:permission-probe",
    slug: "permission-probe",
    sourceId: "seedance",
    title: "权限探针",
    description: "",
    image: "https://example.com/cover.png",
    mode: "image",
    model: "权限测试模型",
    prompt: "A complete original prompt for permission checks.",
    sourceUrl: "https://example.com/works/permission-probe",
    galleryUrl: "https://example.com/works/permission-probe",
};

function signIn(role: "user" | "admin", id = "current-user") {
    setActiveUserScope(id);
    useUserStore.setState({ user: { id, username: id, displayName: id, role, status: "active" }, hydrated: true });
}

beforeEach(async () => {
    invalidateInspirationCatalog();
    globalThis.fetch = (async (input) => new Response(JSON.stringify(String(input).includes("manifest") ? { sources: {} } : { entries: String(input).includes("/seedance.json") ? [item] : [] }))) as typeof globalThis.fetch;
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    records = new Map();
    readSpy = spyOn(localforage, "getItem").mockImplementation(async <T>(key: string) => (records.get(key) ?? null) as T | null);
    writeSpy = spyOn(localforage, "setItem").mockImplementation(async <T>(key: string, value: T) => {
        records.set(key, value as string);
        return value;
    });
    apiClient.defaults.adapter = async (config) => {
        if (config.method !== "get" || config.url !== "/public/inspirations/feed") throw new Error(`Unexpected detail request: ${config.method} ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { enabled: false, entries: [] }, msg: "" } };
    };
    signIn("user");
    useInspirationStore.persist.setOptions({ storage: originalStorage });
    await useInspirationStore.persist.rehydrate();
});

afterEach(async () => {
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState(originalState);
    useInspirationStore.persist.setOptions({ storage: originalStorage });
    useUserStore.setState(originalUser);
    setActiveUserScope(originalScope);
    apiClient.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    invalidateInspirationCatalog();
    readSpy.mockRestore();
    writeSpy.mockRestore();
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("官方目录的个人收藏权限", () => {
    test("已登录普通用户能收藏完整官方条目", async () => {
        await useInspirationStore.getState().toggleFavorite(item.id!, item);
        expect(useInspirationStore.getState().favorites).toEqual([item.id!]);
        expect(useInspirationStore.getState().externalFavorites).toEqual([item]);
    });

    test("管理员同样只能维护自己的在线收藏，没有旧改库入口", async () => {
        signIn("admin");
        await useInspirationStore.persist.rehydrate();
        await useInspirationStore.getState().toggleFavorite(item.id!, item);
        expect(useInspirationStore.getState().favorites).toEqual([item.id!]);
        for (const key of ["createEntry", "updateEntry", "removeEntry", "restoreEntry", "importPayload", "exportPayload", "resetCustomizations", "custom", "overrides", "hidden"]) expect(useInspirationStore.getState()).not.toHaveProperty(key);
    });

    test("不存在的官方ID、旧ZZAI及自建ID不能凭传入快照收藏", async () => {
        for (const id of ["seedance:probe", "youmind:probe", "original:probe", "zzai-gallery:probe", "custom:probe", ""]) await expect(useInspirationStore.getState().toggleFavorite(id, item)).rejects.toThrow();
        expect(useInspirationStore.getState().favorites).toEqual([]);
    });

    test("游客不能写入在线收藏", async () => {
        setActiveUserScope(null);
        useUserStore.setState({ user: null, hydrated: true });
        await useInspirationStore.persist.rehydrate();
        await expect(useInspirationStore.getState().toggleFavorite(item.id!, item)).rejects.toThrow();
        expect(useInspirationStore.getState().externalFavorites).toEqual([]);
    });

    test("本地未就绪或scope不是当前登录账号时必须拒绝", async () => {
        useInspirationStore.setState({ hydrated: false });
        await expect(useInspirationStore.getState().toggleFavorite(item.id!, item)).rejects.toThrow();
        useInspirationStore.setState({ hydrated: true, hydrationScope: "other-user" });
        await expect(useInspirationStore.getState().toggleFavorite(item.id!, item)).rejects.toThrow();
        expect(useInspirationStore.getState().favorites).toEqual([]);
    });
});
