export const WORKSPACE_AUTH_OPEN_EVENT = "workspace-auth:open";

export type WorkspaceAuthMode = "login" | "register" | "recovery";

export type WorkspaceAuthOpenDetail = {
    /** 打开后停在哪个表单；不传按登录处理。 */
    mode?: WorkspaceAuthMode;
    /** 登录 / 注册成功后要去的地址；不传则回到打开弹窗时所在的那一页。 */
    next?: string;
};

/**
 * 工作台任意入口打开登录弹窗，不再跳 `/login` 独立页。
 *
 * 与积分中心（`openWorkspaceWallet`）、账户设置（`openWorkspaceSettings`）同一套约定：
 * 入口只负责派发事件，弹窗状态由宿主（`WorkspaceAuthHost`）统一持有。
 * 之所以不在这里自己 `navigate`：调用方（顶栏按钮、创作页登录门、命令面板）大多拿不到
 * 「打开前那一页」，而宿主一直在路由里，天然知道。
 */
export function openWorkspaceAuth(detail: WorkspaceAuthOpenDetail = {}) {
    window.dispatchEvent(new CustomEvent<WorkspaceAuthOpenDetail>(WORKSPACE_AUTH_OPEN_EVENT, { detail }));
}

/**
 * 站内指向 `/login`、`/register`、`/forgot-password` 的链接不该真的跳转。
 *
 * 这三个地址只渲染一个空壳（`AuthRouteShell`），宿主接住地址后再把 URL 换回来；
 * 这一来一回会把**整棵页面树卸载重建**（实测首页有 4 帧主内容缺失、~50ms），
 * 观感就是「打开登录弹窗时页面闪一下」。所以左键点击就地派发事件打开弹窗，
 * 同时保留 `href` —— 中键 / ⌘+点击 / 新标签页仍然走深链，那是它该有的用途。
 */
export function interceptAuthLink(
    event: { defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void },
    detail: WorkspaceAuthOpenDetail = {},
) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openWorkspaceAuth(detail);
}

/**
 * `next` 参数只接受站内相对路径。
 * 必须挡掉 `//evil.com`（协议相对 URL，浏览器会当成外站）与 `http(s)://`，
 * 否则 `/login?next=https://evil.com` 就成了一条开放重定向。
 */
export function safeAuthNext(value: string | null | undefined) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
    return value;
}
