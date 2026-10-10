import { afterEach, describe, expect, test } from "bun:test";
import { useThemeStore } from "../src/stores/use-theme-store";
import { useCanvasThemeStore } from "../src/stores/canvas/use-canvas-theme-store";

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
