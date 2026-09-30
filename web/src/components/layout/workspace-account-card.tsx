import { Button } from "antd";
import { ArrowUpRight, LogOut, Moon, RefreshCw, Settings, ShieldCheck, Sun } from "lucide-react";
import { Link } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { Switch } from "@/components/ui/base/switch";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { openWorkspaceSettings } from "@/lib/workspace-settings";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import "./workspace-account-card.css";

/**
 * 更新日志入口暂时下线（用户要求隐藏，代码保留以方便恢复）。
 * 恢复方式：把下面这个开关改回 true 即可，样式与组件都还在。
 * 只影响用户端弹窗这一处；后台外壳 admin-shell 的同名入口不受影响。
 */
const SHOW_CHANGELOG_ENTRY = false;

/**
 * 侧栏账户弹窗的内容：身份、积分、主题偏好、账户操作（更新日志入口当前关闭，见上）。
 * 主题切换与积分入口原先在顶栏操作区，顶栏清空后集中到这里；
 * 余额与退出均复用真实服务。
 */
export function WorkspaceAccountCard({ onWallet, onNavigate }: { onWallet: () => void; onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing, refresh } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    if (!user) return null;
    const accountEmail = user.email?.trim() || "";
    return <section className="workspace-account-card" aria-label="我的账户">
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            {/* 副标题从「@用户名」换成绑定邮箱：账号标识对用户没有信息量，邮箱才是他要核对的东西。
                没绑邮箱的账号（如第三方登录）不占位 —— 回退成 @username 就退回了这次要去掉的那行。 */}
            <div><strong>{user.displayName || user.username}</strong>{accountEmail ? <span title={accountEmail}>{accountEmail}</span> : null}</div>
            <em>{user.role === "admin" ? "管理员" : "创作者"}</em>
        </header>
        {creditsEnabled ? <div className="workspace-account-card-wallet">
            <div className="workspace-account-card-balance"><span><WorkspaceCreditGiftMark className="is-compact" />可用积分</span><strong>{availableMicrocredits === null ? "—" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></div>
            {availableMicrocredits === null ? <Button size="small" loading={refreshing} icon={<RefreshCw />} onClick={() => void refresh()}>刷新余额</Button> : <button type="button" onClick={onWallet}>充值 / 兑换<ArrowUpRight /></button>}
        </div> : null}
        <div className="workspace-account-card-preferences">
            <div className="workspace-account-card-theme">
                {theme === "dark" ? <Moon /> : <Sun />}
                <span>深色模式</span>
                <Switch size="sm" checked={theme === "dark"} onChange={(checked) => setTheme(checked ? "dark" : "light")} aria-label="深色模式" />
            </div>
            {SHOW_CHANGELOG_ENTRY ? <AppChangelogButton className="workspace-account-card-changelog" showLabel showVersion versionClassName="workspace-account-card-changelog-version" /> : null}
        </div>
        <nav className="workspace-account-card-actions" aria-label="账户操作">
            {/* 账户与设置改成原地打开弹窗，不再跳转 /settings 页面；图标仍是斜箭头 ArrowUpRight
                （和「管理员后台」同一枚），只有入口行为变了，观感不变。 */}
            <button type="button" className="workspace-account-card-entry" onClick={() => { onNavigate(); openWorkspaceSettings(); }}><Settings /><span>账户与设置</span><ArrowUpRight /></button>
            {user.role === "admin" ? <Link to="/admin" onClick={onNavigate}><ShieldCheck /><span>管理员后台</span><ArrowUpRight /></Link> : null}
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>退出登录</Button>
        </nav>
    </section>;
}
