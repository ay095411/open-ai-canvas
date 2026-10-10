/**
 * 灵感库的管理权限。
 *
 * 背景：灵感库没有服务端接口。目录本身是构建期产物（`web/public/inspirations/*.json`
 * 与 `lib/inspirations/catalog.ts` 里的原创条目），用户的增删改写进浏览器本地
 * （localforage，key 按 userId 分作用域，见 `lib/user-scope.ts`）。所以这里不是
 * 「服务端越权」的防线——它拦的是**界面上不该出现的入口**，以及 store 上的写操作。
 *
 * 普通用户对灵感库是「只读 + 收藏」：
 *   - 可以：浏览、搜索、筛选、复制提示词、一键带去创作、收藏（个人书签，不改库内容）
 *   - 不可以：新建、导入、导出、编辑、删除 / 隐藏、恢复显示
 *
 * 管理员沿用仓库既有的判定口径 `user.role === "admin"`（与 pages/skills、pages/plugins 一致）。
 *
 * ⚠️ 纯前端门禁绕得过（devtools 直接调 store），但绕过的后果只落在**他自己浏览器里那份
 * 本地叠加层**上：改不到静态目录，也传不上服务器，切账号还不串数据。真要防的是「入口摆错」，
 * 不是「有人硬闯」。
 */
export type InspirationViewer = { role?: string } | null | undefined;

export function canManageInspirations(user: InspirationViewer): boolean {
    return user?.role === "admin";
}
