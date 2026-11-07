import { refreshFeatureAvailability } from "@/lib/user-session";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";

export function commerceFeatureBlockedReason(features: Pick<FeatureAvailability, "ecommerceEnabled">) {
    if (!features.ecommerceEnabled) return "电商Agent暂未开放，历史作品可查看、下载。";
    return "";
}

export class CommerceFeatureUnavailableError extends Error {}

export function assertCommerceFeatureAccess() {
    const reason = commerceFeatureBlockedReason(useUserStore.getState().features);
    if (reason) throw new CommerceFeatureUnavailableError(reason);
}

// 只用于新操作；已受理任务的查询、回执保存与媒体恢复不经过此门控。
export async function refreshCommerceFeatureAccess() {
    const scope = getActiveUserScope();
    assertCommerceFeatureAccess();
    try {
        await refreshFeatureAvailability();
    } catch {
        throw new CommerceFeatureUnavailableError("无法确认电商Agent开放状态，请稍后重试。");
    }
    if (getActiveUserScope() !== scope) throw new CommerceFeatureUnavailableError("登录账号已切换，已停止提交。");
    assertCommerceFeatureAccess();
}
