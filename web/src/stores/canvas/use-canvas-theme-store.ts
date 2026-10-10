import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeName } from "@/stores/use-theme-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useLayoutEffect } from "react";
import { DEFAULT_CANVAS_COLOR_THEME } from "@/lib/canvas-theme";

type CanvasThemeStore = {
    /** 当前生效的画布主题。跟随工作台时为工作台主题的镜像，见下方订阅。 */
    theme: ThemeName;
    /**
     * 画布外观「没设置」→ 跟随工作台主题。
     *
     * 默认 true：用户没在画布外观里主动选过浅色 / 黑色 / 自定义时，画布用工作台的主题，
     * 不要把工作台切成浅色、进画布又变深。只有显式选择过（`setTheme`）才关掉跟随，
     * 由 `appearanceCustomized` 标记在项目侧记住。
     */
    followWorkspace: boolean;
    active: boolean;
    /** 显式选择画布主题（用户动作）：关闭跟随。 */
    setTheme: (theme: ThemeName) => void;
    /** 回到「跟随工作台主题」：开启跟随并把当前主题同步成工作台主题。 */
    followWorkspaceTheme: () => void;
};

function workspaceTheme(): ThemeName {
    return useThemeStore.getState().theme;
}

/** 工作台当前主题。画布要把主题切回「跟随」时用它做基准值。 */
export function currentWorkspaceTheme(): ThemeName {
    return workspaceTheme();
}

/** 画布外观是编辑器状态，不能写入用户工作台的全局主题。 */
export const useCanvasThemeStore = create<CanvasThemeStore>()(
    persist(
        (set) => ({
            theme: workspaceTheme(),
            followWorkspace: true,
            active: false,
            setTheme: (theme) => {
                if (theme === "light" || theme === "dark") set({ theme, followWorkspace: false });
            },
            followWorkspaceTheme: () => set({ theme: workspaceTheme(), followWorkspace: true }),
        }),
        {
            name: "yingce:canvas-theme",
            partialize: ({ theme, followWorkspace }) => ({ theme, followWorkspace }),
            merge: (persisted, current) => {
                const stored = persisted as Partial<CanvasThemeStore> | null;
                // 旧版本只存了 theme、没有 followWorkspace：那时代码在**建画布时**就把外观写死成
                // 深色，用户实际上从没做过选择，所以缺字段一律按「跟随工作台」处理（见 MEMORY 记录）。
                const followWorkspace = stored?.followWorkspace !== false;
                const theme = stored?.theme === "light" || stored?.theme === "dark" ? stored.theme : DEFAULT_CANVAS_COLOR_THEME;
                return { ...current, followWorkspace, theme: followWorkspace ? workspaceTheme() : theme };
            },
        },
    ),
);

// 跟随期间让画布主题始终等于工作台主题：工作台切换深浅时，画布（只要没被单独设置过）跟着变。
// 订阅放在 store 创建之后，直接用 setState 更新镜像字段，不走 setTheme（那会关掉跟随）。
useThemeStore.subscribe((state, previous) => {
    if (state.theme === previous.theme) return;
    if (useCanvasThemeStore.getState().followWorkspace) useCanvasThemeStore.setState({ theme: state.theme });
});

/** 编辑器卸载后自动恢复工作台的主题偏好；包括 body 上的 AntD 浮层。 */
export function useCanvasThemeScope() {
    useLayoutEffect(() => {
        useCanvasThemeStore.setState({ active: true });
        return () => { useCanvasThemeStore.setState({ active: false }); };
    }, []);
}

export function useActiveTheme() {
    const workspaceThemeValue = useThemeStore((state) => state.theme);
    const canvasTheme = useCanvasThemeStore((state) => state.theme);
    const active = useCanvasThemeStore((state) => state.active);
    return active ? canvasTheme : workspaceThemeValue;
}
