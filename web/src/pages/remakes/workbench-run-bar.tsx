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
    /** 跳转到审核分镜；已在该阶段时不传，隐藏按钮 */
    onReview?: () => void;
};

/** 运行条：一行展示阶段、进度、费用与操作；awaiting_review 时追加审核提示。 */
export function WorkbenchRunBar({ run, selectedCount = 0, selectableCount = 0, actionPending, selectionPending, onAction, onReview }: WorkbenchRunBarProps) {
    const running = ["queued", "running", "analyzing", "rendering"].includes(run.status);
    const canContinue = ["paused", "needs_attention"].includes(run.status);
    const canCancel = !["completed", "cancelled", "failed", "cancelling"].includes(run.status);
    const reviewSelectionDone = selectableCount === 0 || selectedCount >= selectableCount;
    const percent = run.totalSteps ? Math.round((run.completedSteps / run.totalSteps) * 100) : 0;
    return (
        <section className="rk-runbar" aria-label="运行进度">
            <div className="rk-runbar-row">
                <div className="rk-runbar-info">
                    <span className="rk-runbar-stage">{remakeStageLabel(run.stage)}</span>
                    <span className="rk-runbar-status">{remakeStatusLabel(run.status)}</span>
                </div>
                <div className="rk-runbar-progress">
                    {run.totalSteps ? (
                        <>
                            <Progress percent={percent} size="small" showInfo={false} aria-label="运行进度百分比" />
                            <span className="tabular-nums">
                                {run.completedSteps}/{run.totalSteps}
                            </span>
                        </>
                    ) : null}
                </div>
                <span className="rk-runbar-cost tabular-nums">
                    {remakeCredits(run.spentMicrocredits)} 积分{run.budgetMicrocredits > 0 ? ` / 预算 ${remakeCredits(run.budgetMicrocredits)}` : ""}
                </span>
                <div className="rk-runbar-actions">
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
                        <Button size="small" type="text" danger icon={<X size={14} />} onClick={() => onAction("cancel")} loading={actionPending}>
                            取消
                        </Button>
                    ) : null}
                </div>
            </div>
            {run.error ? <p className="rk-runbar-error">{run.error}</p> : null}
            {run.status === "awaiting_review" ? (
                <div className="rk-runbar-review">
                    <p className="min-w-0">
                        <strong>关键帧已生成</strong>，请为每个镜头选定一张（已选 {selectedCount}/{selectableCount}），全部选定后继续生成视频。
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {onReview ? (
                            <Button size="small" onClick={onReview}>
                                去挑选
                            </Button>
                        ) : null}
                        <Button type="primary" size="small" icon={<Check size={14} />} disabled={!reviewSelectionDone} loading={actionPending || selectionPending} onClick={() => onAction("approve_and_continue")}>
                            确认并继续生成视频
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
