import { App } from "antd";
import { useState } from "react";

import { applyUserSession } from "@/lib/user-session";
import { openWorkspaceAuth } from "@/lib/workspace-auth";
import { logout } from "@/services/api/auth";

/**
 * 工作区退出登录：供侧栏底部与顶部账户菜单共用。
 * 写路径强校验：失败必须明确提示，不得静默吞错。
 */
export function useWorkspaceLogout() {
    const { message } = App.useApp();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await logout();
            await applyUserSession({ user: null });
            message.success("已退出登录");
            // 走事件而不是 `navigate("/login")`：跳转会让整页卸载重建，空白几帧看得见。
            openWorkspaceAuth();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出失败");
        } finally {
            setLoggingOut(false);
        }
    };

    return { handleLogout, loggingOut };
}
