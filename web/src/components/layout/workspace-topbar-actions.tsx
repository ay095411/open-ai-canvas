import { LoaderCircle } from "lucide-react";

import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 顶栏右侧操作区：可用积分与深色模式切换。
 *
 * 这两个入口此前只存在于侧栏底部账户弹窗内，顶栏被清空为「移动端侧栏开关 + 扩展槽」。
 * 余额复用 useWalletBalance 的共享 Query（非轮询，5 分钟 stale），主题走 useThemeStore，
 * 两者都不新增本地状态，账户弹窗内的同名入口继续保留。
 */
export function WorkspaceTopBarActions() {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    // 未登录不请求余额、不显示积分；主题切换不依赖登录，游客也保留。
    const { availableMicrocredits, refreshing } = useWalletBalance(user?.id, creditsEnabled && Boolean(user));
    // 必须在 themeToggler 之前声明：JSX 的属性在 `const themeToggler = (...)` 求值时就会读取
    // nextTheme，此时若它还在下面的 TDZ 里，整个顶栏会抛 ReferenceError 并把外壳整块打挂。
    const nextTheme = theme === "dark" ? "light" : "dark";

    const themeToggler = (
        <AnimatedThemeToggler
            className="app-workspace-topbar-icon-button app-workspace-topbar-theme"
            theme={theme}
            targetTheme={nextTheme}
            onThemeChange={setTheme}
            aria-label={nextTheme === "dark" ? "切换到深色模式" : "切换到浅色模式"}
        />
    );

    if (!user) return <div className="app-workspace-topbar-actions">{themeToggler}</div>;

    const balanceLabel = availableMicrocredits === null ? "加载中" : formatCredits(availableMicrocredits, 2);

    return (
        <div className="app-workspace-topbar-actions">
            {creditsEnabled ? (
                <button
                    type="button"
                    className="app-workspace-topbar-credit"
                    title="可用积分 · 打开积分中心"
                    aria-label={`可用积分 ${balanceLabel}，打开积分中心`}
                    onClick={() => openWorkspaceWallet()}
                >
                    {refreshing && availableMicrocredits === null ? <LoaderCircle className="app-workspace-topbar-credit-spinner" aria-hidden="true" /> : <WorkspaceCreditGiftMark className="is-compact" />}
                    <span className="app-workspace-topbar-credit-value" aria-hidden="true">{availableMicrocredits === null ? "--" : formatCredits(availableMicrocredits, 2)}</span>
                </button>
            ) : null}
            {themeToggler}
        </div>
    );
}
