import { create, type StoreApi } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { catalogIdOf, isOfficialInspirationId, type CreationInspiration } from "@/lib/inspirations/catalog";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { assertCurrentUserSession, captureUserSession, getActiveUserScope, isUserScopedPersistenceSuppressed, type UserSessionSnapshot } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { getInspirationPrompt, normalizeInspirationDetail } from "@/services/api/online-gallery";

export const INSPIRATION_STORE_KEY = "open_ai_canvas:inspirations";
/** 写入版本 1；旧版本只在内存适配，历史记录不因读取被改写或删除。 */
export const INSPIRATION_STORE_VERSION = 1;

type OnlineFavorites = {
    favorites: string[];
    externalFavorites: CreationInspiration[];
    preservedData?: Record<string, unknown>;
};

type InspirationStore = OnlineFavorites & {
    hydrated: boolean;
    hydrationScope: string | null;
    hydrationError: string;
    toggleFavorite: (id: string, item?: CreationInspiration) => Promise<void>;
};

function onlineFavorites(input: unknown): OnlineFavorites {
    if (input === undefined) return { favorites: [], externalFavorites: [] };
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("本地在线收藏格式不正确");
    const raw = input as Record<string, unknown>;
    const ids = raw.favorites ?? [];
    const entries = raw.externalFavorites ?? [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || !Array.isArray(entries)) throw new Error("本地在线收藏格式不正确");
    // 历史正文只保留，不作为展示或操作来源；任何未知记录也不因授权切换被删除。
    return { favorites: [...new Set(ids as string[])], externalFavorites: entries as CreationInspiration[], preservedData: raw };
}

let setInspirationMemory: StoreApi<InspirationStore>["setState"];
const favoriteWrites = new Set<string>();
let hydrationSession: UserSessionSnapshot | undefined;

function inspirationScopedStorage(): StateStorage {
    let completedReadSession: UserSessionSnapshot | undefined;
    return {
        getItem: async (name) => {
            const session = captureUserSession(true);
            const value = await localForageStorageForScope(session.scope).getItem(name);
            assertCurrentUserSession(session, true);
            completedReadSession = session;
            if (!value) return value;
            const archive = JSON.parse(value) as { state?: unknown; version?: number };
            if (archive.version !== undefined && archive.version !== 0 && archive.version !== INSPIRATION_STORE_VERSION) throw new Error("本地收藏版本不受支持");
            // 仅调整内存读取信封，避免 Zustand 的 migrate 在 hydration 时自动写回。
            return JSON.stringify({ ...archive, version: INSPIRATION_STORE_VERSION });
        },
        setItem: async (name, value) => {
            if (isUserScopedPersistenceSuppressed()) return;
            const session = completedReadSession;
            if (!session) throw new Error("请等待当前账号的本地收藏读取完成");
            // 写盘使用已完成读取的会话与固定 scope，不能在 await 或同步订阅回调后重算账号。
            assertCurrentUserSession(session);
            await localForageStorageForScope(session.scope).setItem(name, value);
            assertCurrentUserSession(session);
        },
        removeItem: async (name) => {
            if (isUserScopedPersistenceSuppressed()) return;
            const session = completedReadSession;
            if (!session) throw new Error("请等待当前账号的本地收藏读取完成");
            assertCurrentUserSession(session);
            await localForageStorageForScope(session.scope).removeItem(name);
            assertCurrentUserSession(session);
        },
    };
}

function currentInspirationScope(): string | null {
    try {
        return getActiveUserScope();
    } catch {
        return null;
    }
}

/** 读取/迁移失败不能覆盖原记录，也不能把旧账号状态写给新账号。 */
function clearInspirationMemory(hydrationError = "") {
    setInspirationMemory({ hydrated: false, hydrationScope: null, hydrationError, favorites: [], externalFavorites: [], preservedData: undefined });
}

const createPersistedInspirationStore = persist<InspirationStore, [], [], OnlineFavorites>(
    (set, get) => ({
        hydrated: false,
        hydrationScope: null,
        hydrationError: "",
        favorites: [],
        externalFavorites: [],

        toggleFavorite: async (id) => {
            const session = captureUserSession();
            const scope = get().hydrationScope;
            if (!get().hydrated || !scope || session.scope !== scope || useUserStore.getState().user?.id !== scope) throw new Error("请登录并等待当前账号的本地收藏读取完成");
            if (favoriteWrites.has(scope)) throw new Error("收藏操作正在保存，请稍后重试");
            const previous = get().favorites;
            const previousExternal = get().externalFavorites;
            const removing = previous.includes(id);
            if (!removing && !isOfficialInspirationId(id) && !id.startsWith("authorized-library:")) throw new Error("仅支持收藏官方目录或已核验授权素材；旧在线来源已停用");
            favoriteWrites.add(scope);
            let next: string[] | undefined;
            let nextExternal: CreationInspiration[] | undefined;
            try {
                // Official IDs resolve from the current pinned catalog; licensed IDs still require server verification.
                const snapshot = removing ? undefined : normalizeInspirationDetail(await getInspirationPrompt(id, session.signal));
                if (snapshot && catalogIdOf(snapshot) !== id) throw new Error("收藏条目与 ID 不一致");
                assertCurrentUserSession(session);
                next = removing ? previous.filter((value) => value !== id) : [id, ...previous];
                const withoutCurrent = previousExternal.filter((entry) => !entry || typeof entry !== "object" || entry.id !== id);
                nextExternal = removing ? withoutCurrent : [snapshot!, ...withoutCurrent];
                await set({ favorites: next, externalFavorites: nextExternal });
                assertCurrentUserSession(session);
            } catch (error) {
                if (get().hydrationScope === scope && get().favorites === next && get().externalFavorites === nextExternal) setInspirationMemory({ favorites: previous, externalFavorites: previousExternal });
                throw error;
            } finally {
                favoriteWrites.delete(scope);
            }
        },
    }),
    {
        name: INSPIRATION_STORE_KEY,
        version: INSPIRATION_STORE_VERSION,
        storage: createJSONStorage(inspirationScopedStorage),
        partialize: (state) => ({ ...state.preservedData, favorites: state.favorites, externalFavorites: state.externalFavorites }),
        migrate: () => {
            throw new Error("本地收藏版本不受支持");
        },
        merge: (persisted, current) => {
            // 合并前复核读取会话，避免已失效账号的归档进入当前内存。
            if (!hydrationSession) throw new Error("本地收藏会话尚未就绪");
            assertCurrentUserSession(hydrationSession, true);
            return { ...current, ...onlineFavorites(persisted) };
        },
        onRehydrateStorage: () => {
            const scope = currentInspirationScope();
            hydrationSession = captureUserSession(true);
            clearInspirationMemory();
            return (state, error) => {
                if (error || !state || !scope || currentInspirationScope() !== scope) {
                    clearInspirationMemory("本地收藏记录暂不可用，收藏操作已暂停，原记录未删除。请重试读取。");
                    if (error) console.warn("本地灵感记录读取或清理失败", error);
                    return;
                }
                setInspirationMemory({ hydrated: true, hydrationScope: scope, hydrationError: "" });
            };
        },
    },
);

const initializeInspirationStore: typeof createPersistedInspirationStore = (set, get, api) => {
    setInspirationMemory = set;
    return createPersistedInspirationStore(set, get, api);
};

export const useInspirationStore = create<InspirationStore>()(initializeInspirationStore);
