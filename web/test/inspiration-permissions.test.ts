import { beforeEach, describe, expect, test } from "bun:test";

import { canManageInspirations } from "../src/lib/inspirations/permissions";
import { useInspirationStore } from "../src/stores/use-inspiration-store";
import { useUserStore } from "../src/stores/use-user-store";

const admin = { id: "u-admin", username: "admin", displayName: "管理员", role: "admin", status: "active" } as const;
const normal = { id: "u-normal", username: "creator", displayName: "创作者", role: "user", status: "active" } as const;

const draft = { title: "探针条目", description: "", image: "/inspirations/probe.webp", mode: "text" as const, prompt: "这是一条用于验证权限守卫的探针提示词，长度足够通过校验。" };

const payload = JSON.stringify({
    version: 1,
    exportedAt: "2026-10-10T00:00:00.000Z",
    custom: [{ title: "导入探针", image: "/x.webp", mode: "text", prompt: "导入探针的提示词正文，长度足够通过校验。" }],
    overrides: {},
    hidden: [],
    favorites: [],
});

/** 直接把用户塞进 store，绕开真实的会话拉取。 */
function signIn(user: unknown) {
    useUserStore.setState({ user: user as never, hydrated: true });
}

describe("灵感库权限判定", () => {
    test("只有管理员能改库", () => {
        expect(canManageInspirations(admin)).toBe(true);
        expect(canManageInspirations(normal)).toBe(false);
    });

    test("游客 / 未 hydrate 出用户时按不允许处理", () => {
        expect(canManageInspirations(null)).toBe(false);
        expect(canManageInspirations(undefined)).toBe(false);
        expect(canManageInspirations({})).toBe(false);
    });
});

describe("灵感库写操作守卫", () => {
    beforeEach(() => {
        useInspirationStore.setState({ custom: [], overrides: {}, hidden: [], favorites: [] });
    });

    test("普通用户的新建 / 编辑 / 删除 / 导入一律不生效", () => {
        signIn(normal);
        const state = () => useInspirationStore.getState();

        expect(state().createEntry(draft)).toBe("");
        expect(state().custom).toHaveLength(0);

        expect(state().importPayload(payload).created).toBe(0);
        expect(state().custom).toHaveLength(0);

        state().removeEntry("seedance:probe");
        expect(state().hidden).toHaveLength(0);

        state().updateEntry("seedance:probe", { title: "改过的标题" });
        expect(state().overrides).toEqual({});

        state().restoreEntry("seedance:probe");
        expect(state().hidden).toHaveLength(0);
    });

    test("普通用户仍然可以收藏 —— 收藏是个人书签，不改库内容", () => {
        signIn(normal);
        useInspirationStore.getState().toggleFavorite("seedance:probe");
        expect(useInspirationStore.getState().favorites).toEqual(["seedance:probe"]);
    });

    test("管理员的新建 / 导入仍然生效", () => {
        signIn(admin);
        const state = () => useInspirationStore.getState();

        const id = state().createEntry(draft);
        expect(id.startsWith("custom:")).toBe(true);
        expect(state().custom).toHaveLength(1);

        expect(state().importPayload(payload)).toEqual({ created: 1, updated: 0, skipped: 0 });
        expect(state().custom).toHaveLength(2);
    });

    test("未登录时写操作同样被拦住", () => {
        signIn(null);
        expect(useInspirationStore.getState().createEntry(draft)).toBe("");
        expect(useInspirationStore.getState().custom).toHaveLength(0);
    });
});
