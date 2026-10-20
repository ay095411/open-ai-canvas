import { isProtectedWorkspacePath } from "@/lib/guest-workspace";
import { openWorkspaceAuth } from "@/lib/workspace-auth";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 编程式跳转前的统一闸门。
 *
 * 返回 `true` = 放行；返回 `false` = 当前是游客且目标页要登录，**已经**把登录弹窗
 * 顶起来了，调用方不要再 `navigate`。
 *
 * 为什么需要它：宿主（`WorkspaceAuthHost`）那层拦截是按 `a[href]` 抓的，
 * `<div role="button" onClick={() => navigate("/skills")}>`、命令面板、以及任何
 * `navigate()` 调用都逃得掉。漏掉一个就会出现「先跳到受保护页 → 被 `RequireAuth`
 * 拦下 → replace 到 /login → 宿主再 replace 回 /」，URL 三连跳、整棵页面树重建，
 * 用户看到的就是闪一下。
 */
export function mayNavigateWithAuth(to: string) {
    const { hydrated, user } = useUserStore.getState();
    // 未水合时不抢跑：这时还判断不出登录态，交给 `RequireAuth`（它会先显示 loading）。
    if (!hydrated || user) return true;
    if (!isProtectedWorkspacePath(new URL(to, window.location.origin).pathname)) return true;
    openWorkspaceAuth({ next: to });
    return false;
}
