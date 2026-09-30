import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { WorkspaceTopBarActions } from "@/components/layout/workspace-topbar-actions";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";

/**
 * 用户端顶栏。三处职责都有别处无法替代的用途：
 * - 移动端侧栏开关：桌面端由侧栏自身的折叠按钮承担，窄屏顶栏是唯一入口。
 * - 扩展槽：创作页挂载会话工具栏，其它页面不挂载内容。
 * - 右侧操作区：可用积分与深色模式切换（用户要求常驻右上角）。
 *
 * 账户信息与消息通知仍在侧栏底部账户行/弹窗；「品牌名 / 当前页」面包屑已移除，
 * 当前页由侧栏选中态表达。
 */
export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    return (
        <header className="app-workspace-topbar">
            <button type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <WorkspaceTopBarExtensionSlot />
            <WorkspaceTopBarActions />
        </header>
    );
}
