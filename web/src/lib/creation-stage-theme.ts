import { useSyncExternalStore } from "react";

/**
 * 「恒定深色舞台」路由标记。
 *
 * 创作首页参考站（PiXTV 那一类）的底色接近纯黑，与站点主题无关 —— 首页要有主体性。
 * 但深色不是只换一批 token 就够：全站大量组件样式是挂在 `html.dark` 上的
 * （`.dark .app-user-workspace …`），只下发 token 会让这些覆盖整片失效，
 * 于是出现「深底 + 浅色态控件」的脏组合。
 *
 * 所以真正的做法是让主题源头知道「当前路由要深色」：
 * - `AppProviders` 是 `<html>` 上 `dark` 类的唯一落点，它在 Router 之上、拿不到 pathname；
 * - 路由层（`AppWorkspaceShell`）知道 pathname，但它在 `AppProviders` 之下。
 *
 * 两边用一个极小的外部 store 对接：路由层写、主题层读。这样不必把 Router 塞进
 * AppProviders 的上下文，也不必在 AppProviders 里监听 history。
 *
 * 默认 false（浅色/跟随主题）。非首页路由会在挂载时显式写回 false。
 */
let darkStage = false;
const listeners = new Set<() => void>();

export function setDarkStageRoute(active: boolean) {
    if (active === darkStage) return;
    darkStage = active;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot() {
    return darkStage;
}

/** 服务端/首次渲染统一返回 false：深色舞台是客户端路由状态，不在 HTML 里预置。 */
function getServerSnapshot() {
    return false;
}

export function useDarkStageRoute() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
