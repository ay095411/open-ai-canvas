import type { RemakeRun, RemakeSettings, RemakeShot, RemakeTake } from "@/services/api/remakes";

export const REMAKE_STATUS_LABELS: Record<string, string> = {
    draft: "草稿",
    queued: "排队中",
    running: "制作中",
    analyzing: "分析中",
    awaiting_review: "等待审核",
    needs_attention: "需要处理",
    paused: "已暂停",
    partial_failed: "部分失败",
    rendering: "合成中",
    completed: "已完成",
    succeeded: "已完成",
    failed: "失败",
    cancelling: "取消中",
    cancelled: "已取消",
    pending: "待执行",
    superseded: "已更新",
};
export const REMAKE_STAGE_LABELS: Record<string, string> = {
    prepare: "准备素材",
    preprocess: "准备素材",
    analysis: "分析参考片",
    analyze: "分析参考片",
    planning: "编排镜头",
    keyframes: "生成关键帧",
    image: "生成关键帧",
    review: "检查关键帧",
    video: "生成镜头视频",
    videos: "生成镜头视频",
    render: "合成成片",
    rendering: "合成成片",
    complete: "制作完成",
    completed: "制作完成",
    done: "制作完成",
};
export const remakeStatusLabel = (status: string) => REMAKE_STATUS_LABELS[status] || status || "草稿";
export const remakeStageLabel = (stage: string) => REMAKE_STAGE_LABELS[stage] || stage || "等待开始";
export function remakeTime(ms: number) {
    const total = Math.max(0, ms) / 1000;
    return `${Math.floor(total / 60)
        .toString()
        .padStart(2, "0")}:${(total % 60).toFixed(1).padStart(4, "0")}`;
}
export const remakeCredits = (amount: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format((amount || 0) / 1_000_000);
export function isRemakeRunActive(run: Pick<RemakeRun, "status"> | null | undefined) {
    return Boolean(run && ["queued", "running", "analyzing", "rendering", "cancelling"].includes(run.status));
}
export function isRemakeRunEditable(run: Pick<RemakeRun, "status"> | null | undefined) {
    return !run || ["completed", "succeeded", "cancelled", "failed", "partial_failed"].includes(run.status);
}
export function selectedRemakeTake(takes: RemakeTake[], run: RemakeRun | null | undefined, shotId: string, kind: "image" | "video") {
    const candidates = takes.filter((take) => take.shotId === shotId && take.kind === kind);
    const key = kind === "image" ? "imageTakeId" : "videoTakeId";
    const selectedIds = new Set(Object.values(run?.selections || {}).map((selection) => selection[key]));
    return candidates.find((take) => selectedIds.has(take.id));
}
export function validateRemakeShots(shots: RemakeShot[], sourceInMs: number, sourceOutMs: number) {
    if (!shots.length || shots.length > 20) return "分镜数量应为 1–20 个";
    let cursor = sourceInMs;
    for (const [index, shot] of shots.entries()) {
        if (!Number.isFinite(shot.sourceInMs) || !Number.isFinite(shot.sourceOutMs) || shot.sourceOutMs <= shot.sourceInMs) return `镜头 ${index + 1} 的结束时间必须晚于开始时间`;
        if (Math.abs(shot.sourceInMs - cursor) > 1) return `镜头 ${index + 1} 与上一镜头之间存在空隙或重叠`;
        if (shot.keyframeMs < shot.sourceInMs || shot.keyframeMs >= shot.sourceOutMs) return `镜头 ${index + 1} 的关键帧必须位于镜头区间内`;
        if (!shot.description.trim()) return `请填写镜头 ${index + 1} 的画面描述`;
        cursor = shot.sourceOutMs;
    }
    if (sourceOutMs > 0 && Math.abs(cursor - sourceOutMs) > 1) return "分镜必须完整覆盖所选参考片区间";
    return "";
}
export function initialRemakeSettings(): RemakeSettings {
    return { sourceInMs: 0, sourceOutMs: 0, targetDescription: "", targetResourceIds: [], style: "", aspectRatio: "9:16", audioMode: "original", mode: "review", budgetMicrocredits: 0, models: { text: {}, image: {}, video: {} } };
}
