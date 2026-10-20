import { App } from "antd";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { WorkspaceCreditMark } from "@/components/layout/workspace-credit-mark";
import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "@/lib/sidebar-checkin";
import { ApiError } from "@/services/api/request";
import { checkinCredits } from "@/services/api/wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 顶栏「每日签到」按钮。
 *
 * 这个入口原本挂在侧栏底部（`WorkspaceSidebarCheckin`：卡片态 + 折叠态两套渲染），
 * 侧栏整站移除后它是**唯一**还能发起 `checkinCredits()` 的地方，所以必须保留 ——
 * 它不是装饰，是真的往账户里发积分。
 *
 * 领取逻辑整段沿用原实现（含 409 已领过的静默处理），只是把卡片换成顶栏图标按钮：
 * 点一下即领，语义与原来的折叠态一致。按钮只在「积分开启 + 有签到奖励 + 今天没领」时出现，
 * 领完当次由 `refresh()` 触发 `visible` 变 false 自动消失。
 */
export function WorkspaceTopBarCheckin() {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { policy, refresh } = useWalletBalance(user?.id, Boolean(user) && creditsEnabled);
    const { message } = App.useApp();
    const [claiming, setClaiming] = useState(false);

    const visible = shouldShowSidebarCheckin({
        creditsEnabled,
        checkinBonusMicrocredits: policy?.checkinBonusMicrocredits,
        checkedInToday: policy?.checkedInToday,
    });
    if (!user || !visible || !policy) return null;

    const amount = formatCredits(policy.checkinBonusMicrocredits, 2);
    const title = sidebarCheckinTitle(brandName);

    const claim = async () => {
        if (claiming) return;
        setClaiming(true);
        try {
            await checkinCredits();
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            message.success("签到成功，积分已到账");
        } catch (error) {
            const alreadyClaimed = error instanceof ApiError && error.status === 409;
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            if (alreadyClaimed) return;
            message.error(error instanceof Error ? error.message : "领取失败");
        } finally {
            setClaiming(false);
        }
    };

    return (
        <button
            type="button"
            className="app-workspace-topbar-checkin"
            title={`${title}：今日可领 ${amount} 积分，点击领取`}
            aria-label={`${title}，立即领取今日 ${amount} 积分`}
            disabled={claiming}
            data-claiming={claiming ? "true" : undefined}
            onClick={() => void claim()}
        >
            {claiming ? <LoaderCircle className="animate-spin" aria-hidden /> : <WorkspaceCreditMark className="is-compact" />}
        </button>
    );
}
