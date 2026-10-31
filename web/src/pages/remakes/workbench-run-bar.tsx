import { Button, Progress } from "antd";
import { Check, Pause, Play, RefreshCw, X } from "lucide-react";

import { remakeCredits, remakeStageLabel, remakeStatusLabel } from "@/lib/remake/presentation";
import type { RemakeAction, RemakeRun } from "@/services/api/remakes";

export type WorkbenchRunBarProps = {
    run: RemakeRun;
    /** awaiting_review 时的关键帧选用进度 */
    selectedCount?: number;
    selectableCount?: number;
    actionPending?: boolean;
    selectionPending?: boolean;
    onAction: (action: RemakeAction) => void;
    /** 「挑选关键帧」跳转到分镜阶段 */
    onReview: () => void;
};

/** 运行进度条：阶段、完成数、进度、花费与运行操作；awaiting_review 时显示审核横条。 */
export function WorkbenchRunBar({ run, selectedCount = 0, selectableCount = 0, actionPending, selectionPending, onAction, onReview }: WorkbenchRunBarProps) {
    const running = ["queued", "running", "analyzing", "rendering"].includes(run.status);
    const canContinue = ["paused", "needs_attention"].includes(run.status);
    const canCancel = !["completed", "cancelled", "failed", "cancelling"].includes(run.status);
    const reviewSelectionDone = selectableCount === 0 || selectedCount >= selectableCount;
    return (
        <section className="rk-runbar" aria-label="运行进度">
            <div className="rk-runbar-row">
                <div className="rk-runbar-info">
                    <span className="text-sm font-medium">{remakeStageLabel(run.stage)}</span>
                    <span className="text-xs text-[var(--rk-text-muted)]">{remakeStatusLabel(run.status)}</span>
                    {run.totalSteps ? (
                        <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">
                            {run.completedSteps}/{run.totalSteps} 项完成
                        </span>
                    ) : null}
                    <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">本次 {remakeCredits(run.spentMicrocredits)} 积分</span>
                    {run.budgetMicrocredits > 0 ? <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">预算 {remakeCredits(run.budgetMicrocredits)}</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {running && run.status !== "cancelling" ? (
                        <Button size="small" icon={<Pause size={14} />} onClick={() => onAction("pause")} loading={actionPending}>
                            暂停
                        </Button>
                    ) : null}
                    {canContinue ? (
                        <Button size="small" type="primary" icon={<Play size={14} />} onClick={() => onAction("resume")} loading={actionPending}>
                            继续
                        </Button>
                    ) : null}
                    {run.status === "partial_failed" ? (
                        <Button size="small" icon={<RefreshCw size={14} />} onClick={() => onAction("retry_failed")} loading={actionPending}>
                            重试失败项
                        </Button>
                    ) : null}
                    {canCancel ? (
                        <Button size="small" danger icon={<X size={14} />} onClick={() => onAction("cancel")} loading={actionPending}>
                            取消
                        </Button>
                    ) : null}
                </div>
            </div>
            {run.totalSteps ? <Progress percent={Math.round((run.completedSteps / run.totalSteps) * 100)} size="small" showInfo={false} aria-label="运行进度百分比" /> : null}
            {run.error ? <p className="rk-runbar-error">{run.error}</p> : null}
            {run.status === "awaiting_review" ? (
                <div className="rk-runbar-review">
                    <div className="min-w-0">
                        <strong className="text-sm">检查新主体关键帧</strong>
                        <p className="mt-0.5 text-xs text-[var(--rk-text-muted)]">
                            已选择 {selectedCount}/{selectableCount} 个生成单元，全部选用后才能继续生成视频。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="small" onClick={onReview}>
                            挑选关键帧
                        </Button>
                        <Button type="primary" size="small" icon={<Check size={14} />} disabled={!reviewSelectionDone} loading={actionPending || selectionPending} onClick={() => onAction("approve_and_continue")}>
                            确认并继续生成视频
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
