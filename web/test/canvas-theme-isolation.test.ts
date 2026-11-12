import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, type CanvasAppearance } from "../src/lib/canvas/canvas-appearance";
import { rebaseCanvasLocalEdits } from "../src/lib/canvas/canvas-sync-rebase";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import { currentWorkspaceTheme, useCanvasThemeStore } from "../src/stores/canvas/use-canvas-theme-store";

const workspaceBefore = useThemeStore.getState().theme;
const canvasBefore = useCanvasThemeStore.getState();
afterEach(() => {
    useThemeStore.setState({ theme: workspaceBefore });
    useCanvasThemeStore.setState({ theme: canvasBefore.theme, followWorkspace: canvasBefore.followWorkspace, active: false });
});

describe("canvas theme ownership", () => {
    test("画布外观没设置过时默认跟随工作台主题", () => {
        expect(useCanvasThemeStore.getInitialState().followWorkspace).toBe(true);
        useCanvasThemeStore.setState({ followWorkspace: true });
        useThemeStore.setState({ theme: "dark" });
        useCanvasThemeStore.getState().followWorkspaceTheme();
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
        useThemeStore.setState({ theme: "light" });
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("跟随期间工作台切换深浅，画布同步跟着变", () => {
        useCanvasThemeStore.setState({ followWorkspace: true });
        useThemeStore.getState().setTheme("dark");
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
        useThemeStore.getState().setTheme("light");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("在画布外观里显式选过之后，就与工作台解耦", () => {
        useCanvasThemeStore.getState().setTheme("dark");
        expect(useCanvasThemeStore.getState().followWorkspace).toBe(false);
        useThemeStore.getState().setTheme("light");
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
    });
    test("「跟随工作台」能把画布切回来，并同步当前工作台主题", () => {
        useThemeStore.getState().setTheme("dark");
        useCanvasThemeStore.getState().setTheme("light");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
        useCanvasThemeStore.getState().followWorkspaceTheme();
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
        expect(useCanvasThemeStore.getState().followWorkspace).toBe(true);
        useThemeStore.getState().setTheme("light");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("editing the canvas theme never mutates the workspace preference", () => {
        useThemeStore.setState({ theme: "light" });
        useCanvasThemeStore.setState({ active: true });
        useCanvasThemeStore.getState().setTheme("dark");
        expect(useThemeStore.getState().theme).toBe("light");
        expect(useCanvasThemeStore.getState().theme).toBe("dark");
        useCanvasThemeStore.setState({ active: false });
        expect(useThemeStore.getState().theme).toBe("light");
    });
    test("rejects malformed canvas themes", () => {
        useCanvasThemeStore.setState({ theme: "light", active: true });
        useCanvasThemeStore.getState().setTheme("invalid" as "light");
        expect(useCanvasThemeStore.getState().theme).toBe("light");
    });
    test("persistence source contract keeps the follow flag but drops transient route state", async () => {
        const source = await Bun.file(new URL("../src/stores/canvas/use-canvas-theme-store.ts", import.meta.url)).text();
        expect(source).toContain("partialize: ({ theme, followWorkspace }) => ({ theme, followWorkspace })");
    });
});

function syncCanvasAppearance(previous: CanvasProject, project: CanvasProject, appearance: CanvasAppearance, customized: boolean) {
    const source = readFileSync(new URL("../src/pages/canvas/use-canvas-project-lifecycle.ts", import.meta.url), "utf8");
    const callback = source.match(/subscribeAgentCanvasRefresh\((\(project, previous, source\) => \{[\s\S]*?)\),\s*\[/)?.[1];
    if (!callback) throw new Error("Missing canvas refresh callback");
    const applied = { appearance, customized };
    const scope = {
        projectLoaded: true,
        projectId: project.id,
        useCanvasThemeStore,
        currentWorkspaceTheme,
        normalizeCanvasAppearance,
        canvasAppearanceForTheme,
        canvasAppearanceBaseTheme,
        rebaseCanvasLocalEdits,
        DEFAULT_CANVAS_BACKGROUND_MODE,
        nodesRef: { current: previous.nodes },
        connectionsRef: { current: previous.connections },
        chatSessionsRef: { current: [] },
        activeChatIdRef: { current: null },
        canvasAppearance: appearance,
        appearanceCustomized: customized,
        backgroundMode: "dots",
        showImageInfo: false,
        observedContentRef: { current: null },
        setNodes: () => {},
        setConnections: () => {},
        setChatSessions: () => {},
        setActiveChatId: () => {},
        setCanvasAppearance: (value: CanvasAppearance) => {
            applied.appearance = value;
        },
        setAppearanceCustomized: (value: boolean) => {
            applied.customized = value;
        },
        setBackgroundMode: () => {},
        setShowImageInfo: () => {},
        setLoadError: () => {},
    };
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`const listener = ${callback};`);
    const listener = new Function(...Object.keys(scope), `${js}; return listener;`)(...Object.values(scope));
    listener(project, previous, "sync");
    return applied;
}

describe("canvas theme remote refresh", () => {
    const project = (): CanvasProject => ({ id: "theme-sync", title: "Canvas", nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" });

    test("未设置的画布接收远端显式外观时，渲染缓存不会覆盖远端选择", () => {
        useThemeStore.setState({ theme: "light" });
        useCanvasThemeStore.getState().followWorkspaceTheme();
        const before = project();
        const applied = syncCanvasAppearance(before, { ...before, appearance: { mode: "dark" }, appearanceCustomized: true }, { mode: "light" }, false);
        expect(applied).toEqual({ appearance: { mode: "dark" }, customized: true });
        expect(useCanvasThemeStore.getState()).toMatchObject({ theme: "dark", followWorkspace: false });
        expect(useThemeStore.getState().theme).toBe("light");
    });

    test("远端切回跟随时，更新标记并采用当前工作台主题", () => {
        useThemeStore.setState({ theme: "light" });
        useCanvasThemeStore.getState().setTheme("dark");
        const before = { ...project(), appearance: { mode: "dark" as const }, appearanceCustomized: true };
        const applied = syncCanvasAppearance(before, { ...before, appearanceCustomized: false }, { mode: "dark" }, true);
        expect(applied).toEqual({ appearance: { mode: "light" }, customized: false });
        expect(useCanvasThemeStore.getState()).toMatchObject({ theme: "light", followWorkspace: true });
    });

    test("远端刷新保留尚未保存的本地显式外观选择", () => {
        useThemeStore.setState({ theme: "light" });
        useCanvasThemeStore.getState().setTheme("dark");
        const before = project();
        const applied = syncCanvasAppearance(before, { ...before, title: "Cloud title" }, { mode: "dark" }, true);
        expect(applied).toEqual({ appearance: { mode: "dark" }, customized: true });
        expect(useCanvasThemeStore.getState()).toMatchObject({ theme: "dark", followWorkspace: false });
    });
});
