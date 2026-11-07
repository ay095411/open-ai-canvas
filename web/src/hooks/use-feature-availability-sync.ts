import { useEffect } from "react";
import { FEATURE_AVAILABILITY_CHANNEL, refreshFeatureAvailability } from "@/services/feature-availability";
import { useUserStore } from "@/stores/use-user-store";

export function useFeatureAvailabilitySync() {
    const hydrated = useUserStore((state) => state.hydrated);
    useEffect(() => {
        if (!hydrated) return;
        const refresh = () => {
            if (document.visibilityState === "hidden") return;
            void refreshFeatureAvailability().catch((error) => console.warn("刷新功能开放状态失败，保留当前显示状态", error instanceof Error ? error.message : "未知错误"));
        };
        const refreshAfterChange = () => {
            void refreshFeatureAvailability({ force: true }).catch((error) => console.warn("更新功能开放状态失败", error instanceof Error ? error.message : "未知错误"));
        };
        let channel: BroadcastChannel | null = null;
        try {
            if (typeof BroadcastChannel !== "undefined") {
                channel = new BroadcastChannel(FEATURE_AVAILABILITY_CHANNEL);
                channel.onmessage = refreshAfterChange;
            }
        } catch (error) {
            console.warn("无法订阅跨标签功能状态，仍会在页面重新激活时刷新", error instanceof Error ? error.message : "未知错误");
        }
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            channel?.close();
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [hydrated]);
}
