import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Spin, message } from "antd";
import { ArrowLeft, Pencil, Save, X } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { StatusBadge } from "@/components/ui/base/badges";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { isRemakeRunActive, remakeCredits, remakeStatusLabel, remakeStatusTone, validateRemakeShots } from "@/lib/remake/presentation";
import { actOnRemakeRun, exportRemake, getRemake, selectRemakeTakes, startRemakeRun, updateRemake, type RemakeAction, type RemakeDetail, type RemakeGoal, type RemakeSelection } from "@/services/api/remakes";

import { WorkbenchExportStage } from "./workbench-export-stage";
import { WorkbenchPlanStage } from "./workbench-plan-stage";
import { WorkbenchRunBar } from "./workbench-run-bar";
import { WorkbenchShotsStage } from "./workbench-shots-stage";
import { WorkbenchSourceStage } from "./workbench-source-stage";
import { WorkbenchStageNav, type RemakeStageKey, type RemakeStageStatus } from "./workbench-stage-nav";
import { useRemakeDraft } from "./use-remake-draft";
import "./remake-workbench.css";

function unitKeys(run: NonNullable<RemakeDetail["activeRun"]>) {
    return [...new Set(run.steps.map((step) => step.unitId).filter((unitId): unitId is string => Boolean(unitId)))];
}

/** 依据项目当前状态推断首次进入的阶段；之后由用户点击主导。 */
function initialStage(detail: RemakeDetail): RemakeStageKey {
    if (!detail.analysis) return "source";
    if (!detail.activeRun && detail.exports.length) return "export";
    const stage = detail.activeRun?.stage || "";
    if (["complete", "completed", "done"].includes(stage)) return "export";
    if (["planning", "keyframes", "image", "review", "video", "videos", "render", "rendering"].includes(stage)) return "shots";
    return "plan";
}

export default function RemakeWorkbenchPage() {
    const { remakeId = "" } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const detailQuery = useQuery({
        queryKey: ["remakes", remakeId],
        queryFn: ({ signal }) => getRemake(remakeId, signal),
        enabled: Boolean(remakeId),
        refetchInterval: (query) => (isRemakeRunActive(query.state.data?.activeRun) ? 3000 : false),
    });
    const detail = detailQuery.data;
    const draft = useRemakeDraft(remakeId, detail);
    const { baseline, title, setTitle, settings, setSettings, shots, setShots, dirty, applyDetail, resetDraft } = draft;

    const [stage, setStage] = useState<RemakeStageKey | null>(null);
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState(false);

    useEffect(() => {
        setStage(null);
        setSelectedShotId(null);
        setEditingTitle(false);
    }, [remakeId]);

    useEffect(() => {
        if (detail && stage === null) setStage(initialStage(detail));
    }, [detail, stage]);

    useEffect(() => {
        setSelectedShotId((current) => (current && shots.some((shot) => shot.id === current) ? current : (shots[0]?.id ?? null)));
    }, [shots]);

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!baseline || !settings) throw new Error("项目还没有加载完成");
            const validation = shots.length ? validateRemakeShots(shots, settings.sourceInMs, settings.sourceOutMs || detail?.analysis?.sourceOutMs || 0) : "";
            if (validation) throw new Error(validation);
            return updateRemake(remakeId, { expectedVersion: baseline.version, title, settings, shots: shots.length ? shots : undefined });
        },
        onSuccess: (next) => {
            queryClient.setQueryData(["remakes", remakeId], next);
            applyDetail(next);
            message.success("复刻草稿已保存");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存复刻草稿失败"),
    });

    const runMutation = useMutation({
        mutationFn: async (goal: RemakeGoal) => {
            if (!detail || !baseline || !settings) throw new Error("项目还没有加载完成");
            let current = detail;
            if (dirty) {
                const validation = shots.length ? validateRemakeShots(shots, settings.sourceInMs, settings.sourceOutMs || detail.analysis?.sourceOutMs || 0) : "";
                if (validation) throw new Error(validation);
                current = await updateRemake(remakeId, { expectedVersion: baseline.version, title, settings, shots: shots.length ? shots : undefined });
                queryClient.setQueryData(["remakes", remakeId], current);
                applyDetail(current);
            }
            return startRemakeRun(remakeId, { expectedVersion: current.project.draftVersion, idempotencyKey: crypto.randomUUID(), goal, mode: settings.mode });
        },
        onSuccess: (next) => {
            queryClient.setQueryData(["remakes", remakeId], next);
            applyDetail(next);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "启动复刻任务失败"),
    });

    const actionMutation = useMutation({
        mutationFn: ({ action, runId, selectionVersion }: { action: RemakeAction; runId: string; selectionVersion: number }) => actOnRemakeRun(remakeId, runId, { action, expectedSelectionVersion: selectionVersion }),
        onSuccess: (next) => {
            queryClient.setQueryData(["remakes", remakeId], next);
            applyDetail(next);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "运行操作失败"),
    });

    const selectionMutation = useMutation({
        mutationFn: ({ runId, selectionVersion, selections }: { runId: string; selectionVersion: number; selections: Record<string, RemakeSelection> }) => selectRemakeTakes(remakeId, runId, { expectedSelectionVersion: selectionVersion, selections }),
        onSuccess: (next) => {
            queryClient.setQueryData(["remakes", remakeId], next);
            applyDetail(next);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "关键帧选择失败"),
    });

    const exportMutation = useMutation({
        mutationFn: () => {
            if (!run) throw new Error("还没有可合成的运行");
            return exportRemake(remakeId, run.id);
        },
        onSuccess: (next) => {
            queryClient.setQueryData(["remakes", remakeId], next);
            applyDetail(next);
            message.success("已开始合成成片");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "发起成片合成失败"),
    });

    const run = detail?.activeRun || detail?.runs[0] || null;
    const active = Boolean(detail?.activeRun && !["completed", "succeeded", "cancelled", "failed"].includes(detail.activeRun.status));
    const needsReview = run?.status === "awaiting_review";
    const runUnits = run?.steps.some((step) => step.unitId) ? unitKeys(run) : [];
    const selectedCount = runUnits.filter((unitId) => Boolean(run?.selections[unitId]?.imageTakeId)).length;
    const shotValidation = settings && shots.length ? validateRemakeShots(shots, settings.sourceInMs, settings.sourceOutMs || detail?.analysis?.sourceOutMs || 0) : "";
    const canLaunch = !active && !runMutation.isPending;
    const canExport = Boolean(run && ["completed", "succeeded", "partial_failed"].includes(run.status) && !active);

    const updateSettings = (patch: Partial<NonNullable<typeof settings>>) => setSettings((current) => (current ? { ...current, ...patch } : current));
    const updateShot = (shotId: string, patch: Partial<RemakeDetail["shots"][number]>) => setShots((current) => current.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));

    const selectImageTake = (unitId: string, takeId: string) => {
        if (!run || !needsReview) return;
        selectionMutation.mutate({
            runId: run.id,
            selectionVersion: run.selectionVersion,
            selections: { ...run.selections, [unitId]: { ...run.selections[unitId], imageTakeId: takeId } },
        });
    };

    const onRun = (goal: RemakeGoal) => runMutation.mutate(goal);
    const onAction = (action: RemakeAction) => {
        if (run) actionMutation.mutate({ action, runId: run.id, selectionVersion: run.selectionVersion });
    };

    const sourceRange = useMemo(() => {
        if (detail?.analysis) return { inMs: detail.analysis.sourceInMs, outMs: detail.analysis.sourceOutMs };
        return { inMs: settings?.sourceInMs || 0, outMs: settings?.sourceOutMs || 0 };
    }, [detail?.analysis, settings?.sourceInMs, settings?.sourceOutMs]);

    const stageStatus = useMemo<Record<RemakeStageKey, RemakeStageStatus>>(() => {
        const runGoal = detail?.activeRun && isRemakeRunActive(detail.activeRun) ? detail.activeRun.goal : null;
        const runStage = detail?.activeRun && isRemakeRunActive(detail.activeRun) ? detail.activeRun.stage : "";
        const source: RemakeStageStatus = runGoal === "analysis" ? "busy" : detail?.analysis ? "done" : "idle";
        const hasSubject = Boolean(settings?.targetDescription.trim() && settings?.targetResourceIds.length);
        const plan: RemakeStageStatus = detail?.analysis && !hasSubject ? "warn" : hasSubject ? "done" : "idle";
        const shotsStage: RemakeStageStatus = needsReview && selectedCount < runUnits.length ? "warn" : runGoal && runGoal !== "analysis" ? "busy" : detail?.exports.length ? "done" : "idle";
        const exportStage: RemakeStageStatus = detail?.exports.length ? "done" : ["render", "rendering"].includes(runStage) ? "busy" : "idle";
        return { source, plan, shots: shotsStage, export: exportStage };
    }, [detail, needsReview, selectedCount, runUnits.length, settings?.targetDescription, settings?.targetResourceIds.length]);

    if (detailQuery.isPending)
        return (
            <WorkspacePage>
                <div className="flex justify-center py-24">
                    <Spin />
                </div>
            </WorkspacePage>
        );
    if (detailQuery.isError || !detail)
        return (
            <WorkspacePage>
                <div className="mx-auto max-w-2xl py-12">
                    <Alert type="error" showIcon message="无法加载复刻项目" description={detailQuery.error instanceof Error ? detailQuery.error.message : "项目不存在或已被删除"} action={<Button onClick={() => void detailQuery.refetch()}>重试</Button>} />
                </div>
            </WorkspacePage>
        );
    if (!settings || !baseline)
        return (
            <WorkspacePage>
                <div className="flex justify-center py-24">
                    <Spin />
                </div>
            </WorkspacePage>
        );

    const statusLabel = remakeStatusLabel(run?.status || detail.project.status);

    return (
        <WorkspacePage fluid scroll={false} className="remake-workbench-page">
            <div className="remake-workbench-shell">
                <header className="rk-header">
                    <Button type="text" icon={<ArrowLeft size={16} />} aria-label="返回项目库" onClick={() => navigate("/remakes")} />
                    <div className="rk-header-main">
                        <div className="rk-title-group">
                            {editingTitle ? (
                                <Input
                                    className="rk-title-edit"
                                    value={title}
                                    maxLength={160}
                                    autoFocus
                                    aria-label="项目名称"
                                    onChange={(event) => setTitle(event.target.value)}
                                    onBlur={() => setEditingTitle(false)}
                                    onPressEnter={(event) => event.currentTarget.blur()}
                                />
                            ) : (
                                <div className="rk-title-row">
                                    <h1 className="rk-title">{title || detail.project.title}</h1>
                                    <button
                                        type="button"
                                        className="grid size-6 shrink-0 place-items-center rounded bg-transparent text-[var(--rk-text-muted)] hover:bg-[var(--rk-hover)] focus-visible:outline-2 focus-visible:outline-[var(--rk-accent)]"
                                        aria-label="重命名项目"
                                        onClick={() => setEditingTitle(true)}
                                    >
                                        <Pencil size={13} />
                                    </button>
                                </div>
                            )}
                            <div className="rk-header-meta">
                                <StatusBadge size="sm" tone={remakeStatusTone(run?.status || detail.project.status)} label={statusLabel} />
                                <span>{dirty ? "有未保存修改" : "草稿已同步"}</span>
                                {run ? (
                                    <span className="tabular-nums">
                                        本次 {remakeCredits(run.spentMicrocredits)} 积分{run.budgetMicrocredits > 0 ? ` · 预算 ${remakeCredits(run.budgetMicrocredits)}` : ""}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button icon={<Save size={14} />} disabled={!dirty || saveMutation.isPending} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                            保存草稿
                        </Button>
                    </div>
                </header>

                {run ? (
                    <WorkbenchRunBar
                        run={run}
                        selectedCount={selectedCount}
                        selectableCount={runUnits.length}
                        actionPending={actionMutation.isPending}
                        selectionPending={selectionMutation.isPending}
                        onAction={onAction}
                        onReview={() => setStage("shots")}
                    />
                ) : null}

                <WorkbenchStageNav value={stage ?? "source"} onChange={setStage} status={stageStatus} />

                {stage === "plan" ? (
                    <WorkbenchPlanStage settings={settings} updateSettings={updateSettings} canLaunch={canLaunch} runPending={runMutation.isPending} onKeyframes={() => onRun("keyframes")} onComplete={() => onRun("complete")} />
                ) : stage === "shots" ? (
                    <WorkbenchShotsStage
                        detail={detail}
                        run={run}
                        shots={shots}
                        updateShot={updateShot}
                        setShots={setShots}
                        selectedShotId={selectedShotId}
                        onSelectShot={setSelectedShotId}
                        editable={!active}
                        needsReview={needsReview}
                        selectionPending={selectionMutation.isPending}
                        onSelectImageTake={selectImageTake}
                        onGoSource={() => setStage("source")}
                        sourceRange={sourceRange}
                    />
                ) : stage === "export" ? (
                    <WorkbenchExportStage detail={detail} run={run} shots={shots} exportPending={exportMutation.isPending} canExport={canExport} onExport={() => exportMutation.mutate()} />
                ) : (
                    <WorkbenchSourceStage
                        detail={detail}
                        settings={settings}
                        shots={shots}
                        updateSettings={updateSettings}
                        analysisBusy={Boolean(run && run.goal === "analysis" && isRemakeRunActive(run))}
                        analyzePending={runMutation.isPending}
                        canLaunch={canLaunch}
                        onAnalyze={() => onRun("analysis")}
                    />
                )}

                {dirty ? (
                    <div className="rk-unsaved">
                        <span className={`text-xs${shotValidation ? " text-[var(--rk-error)]" : " text-[var(--rk-warning)]"}`}>{shotValidation || "有未保存的修改，保存后进入后续生成。"}</span>
                        <div className="flex gap-2">
                            <Button icon={<X size={14} />} onClick={resetDraft}>
                                放弃修改
                            </Button>
                            <Button type="primary" icon={<Save size={14} />} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                                保存草稿
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </WorkspacePage>
    );
}
