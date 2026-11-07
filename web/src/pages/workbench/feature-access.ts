import { getActiveUserScope } from "@/lib/user-scope";
import { refreshFeatureAvailability } from "@/services/feature-availability";
import type { WorkbenchKind } from "@/services/api/workbench";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";

export function workbenchFeatureBlockedReason(kind: WorkbenchKind, features: FeatureAvailability) {
    const enabled = kind === "video" ? features.videoWorkbenchEnabled : features.imageWorkbenchEnabled;
    return enabled ? "" : `创作影棚的${kind === "video" ? "视频" : "图片"}生成暂未开放，历史任务和作品仍可查看；暂不能提交新生成或重试任务。`;
}

export function assertWorkbenchFeatureAccess(kind: WorkbenchKind) {
    const reason = workbenchFeatureBlockedReason(kind, useUserStore.getState().features);
    if (reason) throw new Error(reason);
}

export async function refreshWorkbenchFeatureAccess(kind: WorkbenchKind, scope: string) {
    if (getActiveUserScope() !== scope) throw new Error("登录账号已切换，已停止提交");
    assertWorkbenchFeatureAccess(kind);
    try {
        await refreshFeatureAvailability({ force: true });
    } catch {
        throw new Error("无法确认创作影棚开放状态，请稍后重试");
    }
    if (getActiveUserScope() !== scope) throw new Error("登录账号已切换，已停止提交");
    assertWorkbenchFeatureAccess(kind);
}
