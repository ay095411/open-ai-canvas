import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { invalidateInspirationCatalog } from "@/services/inspiration-catalog";
import { authorizedEntry } from "./fixtures/authorized-inspirations";
const dom = new Window({ url: "http://localhost/create" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, Event: dom.Event })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { getActiveUserScope, setActiveUserScope } = await import("@/lib/user-scope");
const { default: localforage } = await import("localforage");
const { useInspirationStore } = await import("@/stores/use-inspiration-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { apiClient } = await import("@/services/api/request");
const originalState = useInspirationStore.getState();
const originalStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState();
const originalScope = getActiveUserScope();
const originalAdapter = apiClient.defaults.adapter;
const originalFetch = globalThis.fetch;
let staticEntries: unknown[];
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let records: Map<string, string>;
let writes: Array<{ key: string; value: string }>;
let failWrite = false;
let detailRequests: string[];
let readSpy: ReturnType<typeof spyOn<typeof localforage, "getItem">>;
let writeSpy: ReturnType<typeof spyOn<typeof localforage, "setItem">>;
let warningSpy: ReturnType<typeof spyOn<typeof console, "warn">>;
const keyFor = (scope = "current-user") => `open_ai_canvas:inspirations:user:${scope}`;
const archive = (state: Record<string, unknown> = {}, version = 1) => JSON.stringify({ state: { favorites: [], externalFavorites: [], ...state }, version });
function onlineEntry(slug: string): CreationInspiration & { id: string; slug: string } {
    return {
        id: `seedance:${slug}`,
        slug,
        sourceId: "seedance",
        title: `社区示例 ${slug}`,
        description: "在线详情收藏测试",
        image: `https://cdn.example.com/${slug}.webp`,
        width: 800,
        height: 600,
        mode: "image",
        model: "社区标注模型",
        prompt: `Current online prompt for ${slug}.`,
        promptZh: `${slug} 的当前在线中文提示词。`,
        credit: `在线作者 ${slug}`,
        sourceUrl: `https://example.com/works/${slug}`,
        galleryUrl: `https://example.com/works/${slug}`,
        category: "portrait",
    };
}
const favoriteSources = ["authorized-library", "seedance"] as const;
const entryFor = (source: (typeof favoriteSources)[number], slug: string) => (source === "authorized-library" ? authorizedEntry(slug) : onlineEntry(slug));
function signIn(id: string) {
    setActiveUserScope(id);
    useUserStore.setState({ user: { id, username: id, displayName: id, role: "user", status: "active" }, hydrated: true });
}
beforeEach(async () => {
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    signIn("current-user");
    await useInspirationStore.persist.rehydrate();
    records = new Map([[keyFor(), archive()]]);
    writes = [];
    failWrite = false;
    detailRequests = [];
    invalidateInspirationCatalog();
    staticEntries = ["fresh-online", "removable", "invalid-online", "different-online", "first", "retry", "late", "old-write"].map((slug) => onlineEntry(slug));
    globalThis.fetch = (async (input) => new Response(JSON.stringify(String(input).includes("manifest") ? { sources: {} } : { entries: String(input).includes("/seedance.json") ? staticEntries : [] }))) as typeof globalThis.fetch;
    readSpy = spyOn(localforage, "getItem").mockImplementation(async <T,>(key: string) => (records.get(key) ?? null) as T | null);
    writeSpy = spyOn(localforage, "setItem").mockImplementation(async <T,>(key: string, value: T) => {
        writes.push({ key, value: value as string });
        if (failWrite) throw new Error("Quota exceeded");
        records.set(key, value as string);
        return value;
    });
    warningSpy = spyOn(console, "warn").mockImplementation(() => {});
    apiClient.defaults.adapter = async (config) => {
        detailRequests.push(config.url!);
        const slug = decodeURIComponent(config.url!.split("/").at(-1)!);
        const data = config.url === "/public/inspirations/feed" ? { enabled: false, entries: [] } : config.url!.startsWith("/public/inspirations/library/prompts/") ? authorizedEntry(slug) : undefined;
        if (!data) throw new Error(`Unexpected detail request: ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
    useInspirationStore.persist.setOptions({ storage: originalStorage });
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
    warningSpy.mockRestore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("真实版本0归档读取零写盘，旧ID/快照/附加字段原样保存", async () => {
    const raw = archive(
        {
            favorites: ["zzai-gallery:old", "youmind:old", "custom:old"],
            externalFavorites: [{ id: "zzai-gallery:old", prompt: "旧正文" }, { unknown: "legacy" }, null],
            custom: [{ id: "custom:old" }],
            overrides: { legacy: "original" },
            hidden: ["seedance:old"],
            futureField: { nested: true },
        },
        0,
    );
    records.set(keyFor(), raw);
    await useInspirationStore.persist.rehydrate();
    expect(useInspirationStore.getState().hydrated).toBe(true);
    expect(useInspirationStore.getState().favorites).toEqual(["zzai-gallery:old", "youmind:old", "custom:old"]);
    expect(useInspirationStore.getState().externalFavorites).toEqual(JSON.parse(raw).state.externalFavorites);
    expect(writes).toEqual([]);
    expect(records.get(keyFor())).toBe(raw);
});
test("新增收藏GET当前服务而非信任传入快照，写回保留归档附加字段", async () => {
    const legacy = { id: "zzai-gallery:old", prompt: "旧正文" };
    records.set(keyFor(), archive({ favorites: [legacy.id], externalFavorites: [legacy], custom: [{ title: "原自建" }], futureField: { keep: true } }, 0));
    await useInspirationStore.persist.rehydrate();
    const item = authorizedEntry("current");
    await useInspirationStore.getState().toggleFavorite(item.id, { ...item, prompt: "FORGED" });
    expect(writes).toHaveLength(1);
    const saved = JSON.parse(records.get(keyFor())!);
    expect(saved.state.custom).toEqual([{ title: "原自建" }]);
    expect(saved.state.futureField).toEqual({ keep: true });
    expect(saved.state.favorites).toEqual([item.id, legacy.id]);
    expect(saved.state.externalFavorites[0].prompt).toBe(item.prompt);
    expect(saved.state.externalFavorites[1]).toEqual(legacy);
    await useInspirationStore.persist.rehydrate();
    expect(writes).toHaveLength(1);
});
test("取消旧收藏无需详情，不删除其余未知归档或项目字段", async () => {
    const unknown = { arbitrary: "keep" };
    records.set(keyFor(), archive({ favorites: ["zzai-gallery:old", "custom:other"], externalFavorites: [{ id: "zzai-gallery:old" }, unknown, null], custom: [{ id: "custom:other" }] }, 0));
    await useInspirationStore.persist.rehydrate();
    apiClient.defaults.adapter = async () => {
        throw new Error("No GET allowed");
    };
    await useInspirationStore.getState().toggleFavorite("zzai-gallery:old");
    const saved = JSON.parse(records.get(keyFor())!);
    expect(saved.state.favorites).toEqual(["custom:other"]);
    expect(saved.state.externalFavorites).toEqual([unknown, null]);
    expect(saved.state.custom).toEqual([{ id: "custom:other" }]);
});
test("伪造本地authorization不能绕过授权库撤销或在线详情读取失败", async () => {
    await useInspirationStore.persist.rehydrate();
    const item = authorizedEntry("revoked");
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 40401, data: null, msg: "未发布", reason: "not_found" } });
    await expect(useInspirationStore.getState().toggleFavorite(item.id, item)).rejects.toThrow();
    await expect(useInspirationStore.getState().toggleFavorite("zzai-gallery:old", item)).rejects.toThrow();
    expect(writes).toEqual([]);
    expect(useInspirationStore.getState().favorites).toEqual([]);
});
test("社区收藏实时读取真实来源并保留无授权声明的完整快照，重新读取归档不写盘", async () => {
    const unknown = { future: "keep" };
    const raw = archive({ favorites: ["custom:legacy"], externalFavorites: [unknown, null], custom: [{ title: "旧草稿" }], futureField: { keep: true } }, 0);
    records.set(keyFor(), raw);
    await useInspirationStore.persist.rehydrate();
    const item = onlineEntry("fresh-online");
    await useInspirationStore.getState().toggleFavorite(item.id, { ...item, prompt: "FORGED", sourceUrl: "https://forged.example.com" });
    expect(detailRequests).toEqual(["/public/inspirations/feed"]);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe(keyFor());
    const saved = JSON.parse(records.get(keyFor())!);
    expect(saved.state.favorites).toEqual([item.id, "custom:legacy"]);
    expect(saved.state.externalFavorites[0]).toMatchObject({ id: item.id, sourceId: "seedance", prompt: item.prompt, promptZh: item.promptZh, sourceUrl: item.sourceUrl, galleryUrl: item.galleryUrl });
    expect(saved.state.externalFavorites[0].authorization).toBeUndefined();
    expect(saved.state.externalFavorites.slice(1)).toEqual([unknown, null]);
    expect(saved.state.custom).toEqual([{ title: "旧草稿" }]);
    expect(saved.state.futureField).toEqual({ keep: true });
    await useInspirationStore.persist.rehydrate();
    expect(writes).toHaveLength(1);
    expect(detailRequests).toHaveLength(1);
    expect(useInspirationStore.getState().externalFavorites[0]).toMatchObject({ id: item.id, prompt: item.prompt });
});

test("新收藏的社区示例取消无需访问上游，保留其他来源与未知记录", async () => {
    const unknown = { unknown: "preserve" };
    const licensed = authorizedEntry("existing-approved");
    records.set(keyFor(), archive({ favorites: [licensed.id], externalFavorites: [licensed, unknown], projectMetadata: { keep: true } }));
    await useInspirationStore.persist.rehydrate();
    await useInspirationStore.getState().toggleFavorite("seedance:removable");
    expect(detailRequests).toHaveLength(1);
    apiClient.defaults.adapter = async () => {
        throw new Error("Offline: no request should be needed to remove a favorite");
    };
    await useInspirationStore.getState().toggleFavorite("seedance:removable");
    expect(writes).toHaveLength(2);
    const saved = JSON.parse(records.get(keyFor())!);
    expect(saved.state.favorites).toEqual([licensed.id]);
    expect(saved.state.externalFavorites).toEqual([licensed, unknown]);
    expect(saved.state.projectMetadata).toEqual({ keep: true });
});

test("官方目录缺正文、危险媒体或身份混淆不能被传入快照替代，也不能伪装授权库", async () => {
    await useInspirationStore.persist.rehydrate();
    const item = onlineEntry("invalid-online");
    for (const data of [{ ...item, prompt: "", promptZh: "" }, { ...item, image: "javascript:alert(1)" }, { ...item, authorization: authorizedEntry("proof").authorization }, onlineEntry("different-online"), authorizedEntry("invalid-online")]) {
        staticEntries = [data];
        invalidateInspirationCatalog();
        await expect(useInspirationStore.getState().toggleFavorite(item.id, item)).rejects.toThrow();
    }
    invalidateInspirationCatalog();
    globalThis.fetch = (async () => new Response("Unavailable", { status: 503 })) as typeof globalThis.fetch;
    await expect(useInspirationStore.getState().toggleFavorite(item.id, item)).rejects.toThrow("HTTP 503");
    expect(writes).toEqual([]);
    expect(useInspirationStore.getState().favorites).toEqual([]);
    expect(useInspirationStore.getState().externalFavorites).toEqual([]);
});

test("旧ZZAI来源新增拒绝且零网络请求，原归档保留不改来源身份", async () => {
    const raw = archive({ favorites: ["zzai-gallery:old"], externalFavorites: [{ id: "zzai-gallery:old", sourceId: "zzai-gallery", prompt: "旧正文" }], extra: { keep: true } }, 0);
    records.set(keyFor(), raw);
    await useInspirationStore.persist.rehydrate();
    await expect(useInspirationStore.getState().toggleFavorite("zzai-gallery:new", onlineEntry("fresh-online"))).rejects.toThrow("停用");
    expect(detailRequests).toEqual([]);
    expect(writes).toEqual([]);
    expect(records.get(keyFor())).toBe(raw);
});

test("未知收藏来源新增被拒绝，但读取和移除历史未知ID仍受支持", async () => {
    records.set(keyFor(), archive({ favorites: ["custom:legacy"], externalFavorites: [{ id: "custom:legacy" }, { other: "keep" }] }));
    await useInspirationStore.persist.rehydrate();
    await expect(useInspirationStore.getState().toggleFavorite("custom:new", onlineEntry("forged"))).rejects.toThrow("仅支持收藏");
    expect(detailRequests).toEqual([]);
    expect(writes).toEqual([]);
    await useInspirationStore.getState().toggleFavorite("custom:legacy");
    expect(detailRequests).toEqual([]);
    expect(useInspirationStore.getState().favorites).toEqual([]);
    expect(useInspirationStore.getState().externalFavorites).toEqual([{ other: "keep" }]);
});

test("当前服务无完整正文、媒体热链或返回别的ID均不落盘", async () => {
    await useInspirationStore.persist.rehydrate();
    const item = authorizedEntry("invalid");
    for (const data of [{ ...item, prompt: "", promptZh: "" }, { ...item, image: "https://example.com/image.webp" }, authorizedEntry("other")]) {
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } });
        await expect(useInspirationStore.getState().toggleFavorite(item.id, item)).rejects.toThrow();
    }
    expect(writes).toEqual([]);
});
test.each(favoriteSources)("%s GET阶段即锁定并发收藏，无乱序写入", async (source) => {
    await useInspirationStore.persist.rehydrate();
    let release!: () => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        start();
        await gate;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: config.url === "/public/inspirations/feed" ? { enabled: false, entries: [] } : entryFor(source, "first"), msg: "" } };
    };
    const pending = useInspirationStore.getState().toggleFavorite(`${source}:first`);
    await started;
    await expect(useInspirationStore.getState().toggleFavorite("authorized-library:second")).rejects.toThrow("收藏操作正在保存");
    expect(writes).toEqual([]);
    release();
    await pending;
    expect(writes).toHaveLength(1);
    expect(useInspirationStore.getState().favorites).toEqual([`${source}:first`]);
});
test.each(favoriteSources)("%s 写入失败撤销书签与快照，不重复写盘；可再次核验重试", async (source) => {
    await useInspirationStore.persist.rehydrate();
    failWrite = true;
    await expect(useInspirationStore.getState().toggleFavorite(`${source}:retry`)).rejects.toThrow("Quota exceeded");
    expect(writes).toHaveLength(1);
    expect(useInspirationStore.getState().favorites).toEqual([]);
    expect(useInspirationStore.getState().externalFavorites).toEqual([]);
    failWrite = false;
    await useInspirationStore.getState().toggleFavorite(`${source}:retry`);
    expect(writes).toHaveLength(2);
    expect(detailRequests).toHaveLength(source === "authorized-library" ? 2 : 1);
});
test.each(favoriteSources)("%s 详情GET期间切账号，旧响应不写给新账号", async (source) => {
    await useInspirationStore.persist.rehydrate();
    let release!: () => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        start();
        await gate;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: config.url === "/public/inspirations/feed" ? { enabled: false, entries: [] } : entryFor(source, "late"), msg: "" } };
    };
    const pending = useInspirationStore
        .getState()
        .toggleFavorite(`${source}:late`)
        .catch((error: Error) => error);
    await started;
    signIn("next-user");
    await useInspirationStore.persist.rehydrate();
    release();
    expect(await pending).toBeInstanceOf(Error);
    expect(writes).toEqual([]);
    expect(useInspirationStore.getState().hydrationScope).toBe("next-user");
    expect(useInspirationStore.getState().favorites).toEqual([]);
});
test("真实旧账号迟到读取不能覆盖新账号已恢复的归档", async () => {
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
        release = resolve;
    });
    readSpy.mockImplementation(<T,>(key: string) => (key === keyFor() ? (gate as unknown as Promise<T | null>) : Promise.resolve(records.get(key) as T | null)));
    records.set(keyFor("next-user"), archive({ favorites: ["zzai-gallery:next"], custom: ["keep-next"] }, 0));
    const old = useInspirationStore.persist.rehydrate();
    signIn("next-user");
    await useInspirationStore.persist.rehydrate();
    release(archive({ favorites: ["zzai-gallery:old"] }, 0));
    await old;
    expect(useInspirationStore.getState().hydrationScope).toBe("next-user");
    expect(useInspirationStore.getState().favorites).toEqual(["zzai-gallery:next"]);
    expect(writes).toEqual([]);
});

test.each(favoriteSources)("%s 写盘等待期间切scope，迟到写入只落原scope且不回滚新账号", async (source) => {
    await useInspirationStore.persist.rehydrate();
    let release!: () => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
        start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    writeSpy.mockImplementation(async <T,>(key: string, value: T) => {
        writes.push({ key, value: value as string });
        start();
        await gate;
        records.set(key, value as string);
        return value;
    });
    records.set(keyFor("next-user"), archive({ favorites: ["zzai-gallery:next"], custom: ["next-project-data"] }, 0));
    const pending = useInspirationStore
        .getState()
        .toggleFavorite(`${source}:old-write`)
        .catch((error: Error) => error);
    await started;
    signIn("next-user");
    await useInspirationStore.persist.rehydrate();
    release();
    expect(await pending).toBeInstanceOf(Error);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe(keyFor());
    expect(useInspirationStore.getState().hydrationScope).toBe("next-user");
    expect(useInspirationStore.getState().favorites).toEqual(["zzai-gallery:next"]);
    expect(JSON.parse(records.get(keyFor("next-user"))!).state.custom).toEqual(["next-project-data"]);
});

test("账号切走再切回同ID，未重新读取的旧会话不能写盘", async () => {
    await useInspirationStore.persist.rehydrate();
    signIn("next-user");
    signIn("current-user");
    await expect(useInspirationStore.getState().toggleFavorite("authorized-library:same-id")).rejects.toMatchObject({ name: "AbortError" });
    expect(writes).toEqual([]);
    expect(useInspirationStore.getState().favorites).toEqual([]);
    await useInspirationStore.persist.rehydrate();
    await useInspirationStore.getState().toggleFavorite("authorized-library:same-id");
    expect(writes).toHaveLength(1);
});

test("收藏内存更新的同步订阅切scope后，固定会话阻止写盘", async () => {
    await useInspirationStore.persist.rehydrate();
    let switched = false;
    const unsubscribe = useInspirationStore.subscribe((state) => {
        if (!switched && state.favorites.includes("authorized-library:sync-switch")) {
            switched = true;
            signIn("next-user");
        }
    });
    try {
        await expect(useInspirationStore.getState().toggleFavorite("authorized-library:sync-switch")).rejects.toMatchObject({ name: "AbortError" });
        expect(switched).toBe(true);
        expect(writes).toEqual([]);
        await useInspirationStore.persist.rehydrate();
        expect(useInspirationStore.getState().hydrationScope).toBe("next-user");
        expect(useInspirationStore.getState().favorites).toEqual([]);
    } finally {
        unsubscribe();
    }
});
test("读取错误清除旧scope内存但不改写存储；未知版本诚实失败", async () => {
    records.set(keyFor(), archive({ favorites: ["zzai-gallery:keep"] }, 999));
    await useInspirationStore.persist.rehydrate();
    expect(useInspirationStore.getState().hydrated).toBe(false);
    expect(useInspirationStore.getState().hydrationError).not.toBe("");
    expect(writes).toEqual([]);
    readSpy.mockImplementation(async () => {
        throw new Error("IndexedDB unavailable");
    });
    await useInspirationStore.persist.rehydrate();
    expect(useInspirationStore.getState().favorites).toEqual([]);
    expect(useInspirationStore.getState().externalFavorites).toEqual([]);
    expect(writes).toEqual([]);
});
test("归档正文损坏仍保留原始字段，新增内容必须实时核验", async () => {
    const old = { id: "zzai-gallery:broken", prompt: "", authorization: { forged: true } };
    records.set(keyFor(), archive({ favorites: [old.id], externalFavorites: [old] }));
    await useInspirationStore.persist.rehydrate();
    expect(useInspirationStore.getState().hydrated).toBe(true);
    expect(useInspirationStore.getState().externalFavorites).toEqual([old]);
    expect(writes).toEqual([]);
});
