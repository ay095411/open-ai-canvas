import { useEffect, useMemo, useState } from "react";

import type { RemakeDetail, RemakeSettings, RemakeShot } from "@/services/api/remakes";

type DraftSnapshot = { projectId: string; version: number; stamp: string; title: string; settings: RemakeSettings; shots: RemakeShot[] };

function detailStamp(detail: RemakeDetail) {
    return JSON.stringify([detail.project.draftVersion, detail.project.updatedAt, detail.shots]);
}

/**
 * 复刻项目草稿状态：以服务端 Detail 为基线快照，标题/设置/分镜三份可编辑草稿。
 * 服务端 draftVersion 变化或本地无修改时自动跟随服务端；写入仍靠 expectedVersion 乐观锁。
 */
export function useRemakeDraft(remakeId: string, detail: RemakeDetail | undefined) {
    const [baseline, setBaseline] = useState<DraftSnapshot | null>(null);
    const [title, setTitle] = useState("");
    const [settings, setSettings] = useState<RemakeSettings | null>(null);
    const [shots, setShots] = useState<RemakeShot[]>([]);

    const dirty = useMemo(() => Boolean(baseline && settings && (title !== baseline.title || JSON.stringify(settings) !== JSON.stringify(baseline.settings) || JSON.stringify(shots) !== JSON.stringify(baseline.shots))), [baseline, settings, shots, title]);

    useEffect(() => {
        if (!detail) return;
        const incomingStamp = detailStamp(detail);
        if (!baseline || baseline.projectId !== remakeId || baseline.version !== detail.project.draftVersion || (!dirty && baseline.stamp !== incomingStamp)) {
            const next = { projectId: remakeId, version: detail.project.draftVersion, stamp: incomingStamp, title: detail.project.title, settings: detail.project.settings, shots: detail.shots };
            setBaseline(next);
            setTitle(next.title);
            setSettings(next.settings);
            setShots(next.shots);
        }
    }, [baseline, detail, dirty, remakeId, settings]);

    const applyDetail = (next: RemakeDetail) => {
        const snapshot = { projectId: remakeId, version: next.project.draftVersion, stamp: detailStamp(next), title: next.project.title, settings: next.project.settings, shots: next.shots };
        setBaseline(snapshot);
        setTitle(snapshot.title);
        setSettings(snapshot.settings);
        setShots(snapshot.shots);
        return snapshot;
    };

    const resetDraft = () => {
        if (!baseline) return;
        setTitle(baseline.title);
        setSettings(baseline.settings);
        setShots(baseline.shots);
    };

    return { baseline, title, setTitle, settings, setSettings, shots, setShots, dirty, applyDetail, resetDraft };
}
