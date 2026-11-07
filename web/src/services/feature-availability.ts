import { getFeatureAvailability, invalidateAuthSessionCache } from "@/services/api/auth";
import { defaultFeatureAvailability, useUserStore, type FeatureAvailability, type FeatureAvailabilityKey } from "@/stores/use-user-store";

const featureKeys = Object.keys(defaultFeatureAvailability) as FeatureAvailabilityKey[];
export const FEATURE_AVAILABILITY_CHANNEL = "canvas-feature-availability";
let generation = 0;
let pending: Promise<FeatureAvailability> | null = null;

export function parseFeatureAvailability(value: unknown): FeatureAvailability {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("功能开放配置响应格式无效");
    const record = value as Record<string, unknown>;
    for (const key of featureKeys) {
        if (typeof record[key] !== "boolean") throw new Error(`功能开放配置缺少有效状态：${key}`);
    }
    // Preserve server-owned flags outside this page's editable catalog.
    return { ...record } as FeatureAvailability;
}

export function applyFeatureAvailability(value: FeatureAvailability) {
    generation += 1;
    pending = null;
    useUserStore.getState().setFeatures(value);
}

export function notifyFeatureAvailabilityChanged() {
    invalidateAuthSessionCache();
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    try {
        const channel = new BroadcastChannel(FEATURE_AVAILABILITY_CHANNEL);
        try {
            channel.postMessage("changed");
        } finally {
            channel.close();
        }
    } catch (error) {
        console.warn("功能配置已保存，跨标签通知失败", error);
    }
}

export function refreshFeatureAvailability({ force = false }: { force?: boolean } = {}): Promise<FeatureAvailability> {
    // A change notification describes a write after any in-flight read began.
    if (force) {
        generation += 1;
        pending = null;
    }
    if (pending) return pending;
    const requestGeneration = generation;
    const request = getFeatureAvailability()
        .then(({ features }) => {
            const value = parseFeatureAvailability(features);
            // A successful write or session replacement invalidates earlier reads.
            if (requestGeneration !== generation) return useUserStore.getState().features;
            useUserStore.getState().setFeatures(value);
            return value;
        })
        .finally(() => {
            if (pending === request) pending = null;
        });
    pending = request;
    return request;
}
