import { useCallback, useEffect, useRef, useState } from "react";

import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { applyFeatureAvailability, notifyFeatureAvailabilityChanged, parseFeatureAvailability } from "@/services/feature-availability";
import type { FeatureAvailability, FeatureAvailabilityKey } from "@/stores/use-user-store";

export type FeatureAvailabilitySaveResult = {
    kind: "saved" | "recovered" | "failed" | "uncertain" | "ignored";
    error?: string;
};

export function useFeatureAvailabilityEditor() {
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingKey, setSavingKey] = useState<FeatureAvailabilityKey | null>(null);
    const [error, setError] = useState("");
    const [uncertain, setUncertain] = useState(false);
    const activeRef = useRef(false);
    const epochRef = useRef(0);
    const featuresRef = useRef<FeatureAvailability | null>(null);
    const savingRef = useRef(false);
    const uncertainRef = useRef(false);

    const accept = useCallback((value: FeatureAvailability) => {
        featuresRef.current = value;
        uncertainRef.current = false;
        setFeatures(value);
        setUncertain(false);
        setError("");
        applyFeatureAvailability(value);
    }, []);

    const load = useCallback(async (): Promise<boolean> => {
        if (!activeRef.current || savingRef.current) return false;
        const epoch = ++epochRef.current;
        const current = () => activeRef.current && epochRef.current === epoch;
        setLoading(featuresRef.current === null);
        setRefreshing(featuresRef.current !== null);
        if (!uncertainRef.current) setError("");
        try {
            const result = await getAdminFeatureAvailability();
            if (!current()) return false;
            accept(parseFeatureAvailability(result.features));
            return true;
        } catch (failure) {
            if (current()) {
                const message = failure instanceof Error ? failure.message : "读取功能开放配置失败";
                setError(uncertainRef.current ? `${message}。保存结果仍无法确认，请重新读取成功后再修改。` : message);
            }
            return false;
        } finally {
            if (current()) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [accept]);

    const save = useCallback(
        async (key: FeatureAvailabilityKey, enabled: boolean): Promise<FeatureAvailabilitySaveResult> => {
            if (!activeRef.current || savingRef.current || uncertainRef.current || !featuresRef.current || featuresRef.current[key] === enabled) return { kind: "ignored" };
            // Acquire synchronously: a second click can precede React's render.
            savingRef.current = true;
            const epoch = ++epochRef.current;
            const current = () => activeRef.current && epochRef.current === epoch;
            setSavingKey(key);
            setLoading(false);
            setRefreshing(false);
            setError("");
            try {
                const result = await updateAdminFeatureAvailability({ [key]: enabled });
                if (!current()) return { kind: "ignored" };
                const value = parseFeatureAvailability(result.features);
                if (value[key] !== enabled) throw new Error("服务端返回的开关状态与本次修改不一致");
                accept(value);
                announceConfirmedChange();
                return { kind: "saved" };
            } catch (failure) {
                if (!current()) return { kind: "ignored" };
                const message = failure instanceof Error ? failure.message : "保存功能开放配置失败";
                // A lost PATCH response does not prove the write failed. Keep
                // the confirmed snapshot until a new read establishes truth.
                try {
                    const result = await getAdminFeatureAvailability();
                    if (!current()) return { kind: "ignored" };
                    const value = parseFeatureAvailability(result.features);
                    accept(value);
                    if (value[key] === enabled) {
                        announceConfirmedChange();
                        return { kind: "recovered" };
                    }
                    const verifiedError = `${message}。已重新读取服务端状态，本次修改未确认生效。`;
                    setError(verifiedError);
                    return { kind: "failed", error: verifiedError };
                } catch (verificationFailure) {
                    if (!current()) return { kind: "ignored" };
                    const verificationMessage = verificationFailure instanceof Error ? verificationFailure.message : "重新读取失败";
                    const uncertainError = `${message}；重新读取也失败：${verificationMessage}。保存结果暂无法确认，页面保留上一次已确认的配置。请重新读取成功后再修改。`;
                    uncertainRef.current = true;
                    setUncertain(true);
                    setError(uncertainError);
                    return { kind: "uncertain", error: uncertainError };
                }
            } finally {
                if (current()) {
                    savingRef.current = false;
                    setSavingKey(null);
                }
            }
        },
        [accept],
    );

    useEffect(() => {
        activeRef.current = true;
        savingRef.current = false;
        setSavingKey(null);
        void load();
        return () => {
            activeRef.current = false;
            epochRef.current += 1;
            savingRef.current = false;
        };
    }, [load]);

    return { features, loading, refreshing, savingKey, error, uncertain, load, save };
}

function announceConfirmedChange() {
    try {
        notifyFeatureAvailabilityChanged();
    } catch (error) {
        // Cross-tab delivery cannot turn an acknowledged save into a failure.
        console.warn("功能状态已确认，但跨标签页通知失败", error);
    }
}
