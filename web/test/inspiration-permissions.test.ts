import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CreationInspiration } from "../src/lib/inspirations/catalog";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { useInspirationStore } from "../src/stores/use-inspiration-store";
import { useUserStore } from "../src/stores/use-user-store";

const originalState = useInspirationStore.getState();
const originalStorage = useInspirationStore.persist.getOptions().storage;
const originalUser = useUserStore.getState();
const originalScope = getActiveUserScope();
const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const item: CreationInspiration = {
    id: "zzai-gallery:permission-probe",
    sourceId: "zzai-gallery",
    title: "权限探针",
    description: "",
    image: "https://example.com/cover.png",
    mode: "image",
    prompt: "A complete original prompt for permission checks.",
    galleryUrl: "https://api.seedance.nz/prompt-gallery/permission-probe",
};

function signIn(role: "user" | "admin", id = "current-user") {
    setActiveUserScope(id);
    useUserStore.setState({ user: { id, username: id, displayName: id, role, status: "active" }, hydrated: true });
}

beforeEach(async () => {
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    signIn("user");
    await useInspirationStore.persist.rehydrate();
});

afterEach(async () => {
    useInspirationStore.persist.setOptions({ storage: emptyStorage });
    await useInspirationStore.persist.rehydrate();
    useInspirationStore.setState(originalState);
    useInspirationStore.persist.setOptions({ storage: originalStorage });
    useUserStore.setState(originalUser);
    setActiveUserScope(originalScope);
});

describe("仅在线画廊的个人收藏权限", () => {
    test("已登录普通用户能收藏完整在线详情", async () => {
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

    test("旧精选来源以及自建ID都不能再收藏", async () => {
        for (const id of ["seedance:probe", "youmind:probe", "original:probe", "custom:probe", ""]) await expect(useInspirationStore.getState().toggleFavorite(id, item)).rejects.toThrow();
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
