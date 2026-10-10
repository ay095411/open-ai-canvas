/**
 * 「画布外观没设置 → 默认与外面的主题保持一致」这条规则的落点测试。
 *
 * 拆成两半：
 *  1. 项目侧：新画布 / 老画布都不带「已显式设置」标记，只有真的存过默认外观或导入过新文件才带。
 *  2. 源码契约：加载画布、跟随同步、外观面板的「跟随」档都还在（这些是全局副作用，不好直接跑）。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { customCanvasAppearanceFromTheme, readCanvasAppearanceDefault, writeCanvasAppearanceDefault } from "../src/lib/canvas/canvas-appearance";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";

const values = new Map<string, string>();
let originalWindow: PropertyDescriptor | undefined;
const createdIds: string[] = [];

beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    values.clear();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    values.set(key, value);
                },
                removeItem: (key: string) => {
                    values.delete(key);
                },
            },
        },
    });
    window.localStorage.setItem("yingce:active-user-scope", "account-under-test");
});

afterEach(() => {
    if (createdIds.length) {
        useCanvasStore.getState().deleteProjects(createdIds.splice(0));
    }
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function projectById(id: string) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project) throw new Error(`project ${id} not found`);
    return project;
}

describe("新画布的外观默认值", () => {
    test("账号没保存过默认外观时，新画布不带外观 —— 加载时会跟随工作台主题", () => {
        const id = useCanvasStore.getState().createProject("跟随测试");
        createdIds.push(id);
        const project = projectById(id);
        expect(project.appearance).toBeUndefined();
        expect(project.appearanceCustomized ?? false).toBe(false);
    });

    test("保存过「新建默认外观」时，新画布带上它并标记为已显式设置", () => {
        const saved = { appearance: customCanvasAppearanceFromTheme("light"), backgroundMode: "lines" as const };
        writeCanvasAppearanceDefault(saved);
        expect(readCanvasAppearanceDefault()).toEqual(saved);

        const id = useCanvasStore.getState().createProject("显式测试");
        createdIds.push(id);
        const project = projectById(id);
        expect(project.appearance).toEqual(saved.appearance);
        expect(project.appearanceCustomized).toBe(true);
        expect(project.backgroundMode).toBe("lines");
    });
});

describe("导入画布的外观标记", () => {
    test("老文件只有写死的 appearance、没有标记 → 不算已设置", () => {
        const id = useCanvasStore.getState().importProject({ title: "老文件", appearance: { mode: "dark" } });
        createdIds.push(id);
        const project = projectById(id);
        expect(project.appearance).toEqual({ mode: "dark" });
        expect(project.appearanceCustomized ?? false).toBe(false);
    });

    test("带标记的新文件保留标记", () => {
        const id = useCanvasStore.getState().importProject({ title: "新文件", appearance: { mode: "dark" }, appearanceCustomized: true });
        createdIds.push(id);
        expect(projectById(id).appearanceCustomized).toBe(true);
    });
});

describe("跟随规则的源码契约", () => {
    test("加载画布时以「是否已设置」决定：用项目外观还是跟随工作台", async () => {
        const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-project-lifecycle.ts", import.meta.url)).text();
        expect(source).toContain("const restoredCustomized = Boolean(targetProject.appearance) && targetProject.appearanceCustomized === true;");
        expect(source).toContain("if (!restoredCustomized) useCanvasThemeStore.getState().followWorkspaceTheme();");
    });

    test("跟随期间工作台换主题会把画布外观同步过去", async () => {
        const source = await Bun.file(new URL("../src/pages/canvas/project.tsx", import.meta.url)).text();
        expect(source).toContain("setCanvasAppearance((current) => (current.mode === colorTheme ? current : canvasAppearanceForTheme(colorTheme)))");
    });

    test("画布外观面板提供「跟随」档，且跟随态下不再高亮浅色 / 黑色", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(source).toContain('label="跟随"');
        expect(source).toContain('active={appearanceFollowsWorkspace}');
        expect(source).toContain('active={!appearanceFollowsWorkspace && draft.mode === "light"}');
        expect(source).toContain('active={!appearanceFollowsWorkspace && draft.mode === "dark"}');
    });

    test("分享页看完记得还原跟随状态", async () => {
        const source = await Bun.file(new URL("../src/pages/canvas/shared.tsx", import.meta.url)).text();
        expect(source).toContain("const followBeforeShare = useCanvasThemeStore.getState().followWorkspace;");
        expect(source).toContain("if (followBeforeShare) useCanvasThemeStore.getState().followWorkspaceTheme();");
        // 分享页要和主编辑页同一套判定：老画布那个写死的 `{ mode: "dark" }` 不算设置，
        // 分享者没显式设置过外观时，访客看到的是自己的工作台主题。
        expect(source).toContain("const shareCustomized = Boolean(project.appearance) && project.appearanceCustomized === true;");
        expect(source).toContain("if (shareCustomized) useCanvasThemeStore.getState().setTheme(appliedShareTheme);");
    });
});
