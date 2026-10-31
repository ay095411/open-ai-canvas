import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Progress, Segmented, Select, Spin, Switch, Tag, message } from "antd";
import { ArrowLeft, Check, Download, Pause, Play, RefreshCw, Save, Upload, X } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { isRemakeRunActive, remakeCredits, remakeStageLabel, remakeStatusLabel, remakeTime, validateRemakeShots } from "@/lib/remake/presentation";
import { actOnRemakeRun, getRemake, selectRemakeTakes, startRemakeRun, updateRemake, type RemakeAction, type RemakeDetail, type RemakeGoal, type RemakeSelection, type RemakeSettings, type RemakeShot } from "@/services/api/remakes";
import { getResourceAccess, resourceFileUrl, resourceStorageKey, resolveResourceAccessURL, uploadResourceFile } from "@/services/api/resources";

type DraftSnapshot = { projectId: string; version: number; stamp: string; title: string; settings: RemakeSettings; shots: RemakeShot[] };

function detailStamp(detail: RemakeDetail) {
    return JSON.stringify([detail.project.draftVersion, detail.project.updatedAt, detail.shots]);
}

function unitKeys(run: NonNullable<RemakeDetail["activeRun"]>) {
    return [...new Set(run.steps.map((step) => step.unitId).filter((unitId): unitId is string => Boolean(unitId)))];
}

function stageIndex(stage: string) {
    if (["complete", "completed", "done"].includes(stage)) return 3;
    if (["video", "videos", "render", "rendering"].includes(stage)) return 2;
    if (["keyframes", "image", "review"].includes(stage)) return 1;
    return 0;
}

export default function RemakeWorkbenchPage() {
    const { remakeId = "" } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const targetInput = useRef<HTMLInputElement>(null);
    const detailQuery = useQuery({
        queryKey: ["remakes", remakeId],
        queryFn: ({ signal }) => getRemake(remakeId, signal),
        enabled: Boolean(remakeId),
        refetchInterval: (query) => (isRemakeRunActive(query.state.data?.activeRun) ? 3000 : false),
    });
    const detail = detailQuery.data;
    const [baseline, setBaseline] = useState<DraftSnapshot | null>(null);
    const [title, setTitle] = useState("");
    const [settings, setSettings] = useState<RemakeSettings | null>(null);
    const [shots, setShots] = useState<RemakeShot[]>([]);
    const [mediaTab, setMediaTab] = useState("source");
    const [targetUploading, setTargetUploading] = useState(false);

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
        queryClient.setQueryData(["remakes", remakeId], next);
        const snapshot = { projectId: remakeId, version: next.project.draftVersion, stamp: detailStamp(next), title: next.project.title, settings: next.project.settings, shots: next.shots };
        setBaseline(snapshot);
        setTitle(snapshot.title);
        setSettings(snapshot.settings);
        setShots(snapshot.shots);
    };

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!baseline || !settings) throw new Error("项目还没有加载完成");
            const validation = shots.length ? validateRemakeShots(shots, settings.sourceInMs, settings.sourceOutMs || detail?.analysis?.sourceOutMs || 0) : "";
            if (validation) throw new Error(validation);
            return updateRemake(remakeId, { expectedVersion: baseline.version, title, settings, shots: shots.length ? shots : undefined });
        },
        onSuccess: (next) => {
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
                current = await updateRemake(remakeId, { expectedVersion: baseline.version, title, settings, shots: shots.length ? shots : undefined });
                applyDetail(current);
            }
            return startRemakeRun(remakeId, { expectedVersion: current.project.draftVersion, idempotencyKey: crypto.randomUUID(), goal, mode: settings.mode });
        },
        onSuccess: (next) => applyDetail(next),
        onError: (error) => message.error(error instanceof Error ? error.message : "启动复刻任务失败"),
    });

    const actionMutation = useMutation({
        mutationFn: ({ action, runId, selectionVersion }: { action: RemakeAction; runId: string; selectionVersion: number }) => actOnRemakeRun(remakeId, runId, { action, expectedSelectionVersion: selectionVersion }),
        onSuccess: applyDetail,
        onError: (error) => message.error(error instanceof Error ? error.message : "运行操作失败"),
    });

    const selectionMutation = useMutation({
        mutationFn: ({ runId, selectionVersion, selections }: { runId: string; selectionVersion: number; selections: Record<string, RemakeSelection> }) => selectRemakeTakes(remakeId, runId, { expectedSelectionVersion: selectionVersion, selections }),
        onSuccess: applyDetail,
        onError: (error) => message.error(error instanceof Error ? error.message : "关键帧选择失败"),
    });

    const run = detail?.activeRun || detail?.runs[0] || null;
    const latestExport = run ? detail?.exports.find((item) => item.runId === run.id) || detail?.exports[0] : detail?.exports[0];
    const exportAccessQuery = useQuery({
        queryKey: ["remakes", remakeId, "export-access", latestExport?.resourceId],
        queryFn: () => {
            if (!latestExport?.resourceId) throw new Error("成片资源不存在");
            return getResourceAccess(resourceStorageKey(latestExport.resourceId), "download", "original", `${detail?.project.title || "复刻成片"}.mp4`);
        },
        enabled: Boolean(latestExport?.resourceId),
        staleTime: 5 * 60_000,
    });
    const runUnits = run?.steps.some((step) => step.unitId) ? unitKeys(run) : [];
    const selectedCount = runUnits.filter((unitId) => Boolean(run?.selections[unitId]?.imageTakeId)).length;
    const shotValidation = settings && shots.length ? validateRemakeShots(shots, settings.sourceInMs, settings.sourceOutMs || detail?.analysis?.sourceOutMs || 0) : "";
    const active = Boolean(detail?.activeRun && !["completed", "succeeded", "cancelled", "failed"].includes(detail.activeRun.status));
    const running = isRemakeRunActive(detail?.activeRun);
    const needsReview = run?.status === "awaiting_review";
    const runCanContinue = Boolean(run && ["paused", "needs_attention"].includes(run.status));

    const updateShot = (shotId: string, patch: Partial<RemakeShot>) => setShots((current) => current.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));

    const addTargetImages = async (files: FileList | null) => {
        if (!files?.length || !settings) return;
        const remaining = 4 - settings.targetResourceIds.length;
        if (remaining <= 0) {
            message.warning("一个主体最多选择四张参考图");
            return;
        }
        setTargetUploading(true);
        try {
            const added: string[] = [];
            for (const file of Array.from(files).slice(0, remaining)) {
                if (!file.type.startsWith("image/")) throw new Error("主体参考素材必须是图片");
                added.push((await uploadResourceFile(file, "image", { fileName: file.name })).id);
            }
            setSettings((current) => (current ? { ...current, targetResourceIds: [...current.targetResourceIds, ...added] } : current));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "主体参考图上传失败");
        } finally {
            setTargetUploading(false);
        }
    };

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

    const currentStage = stageIndex(run?.stage || detail.project.stage);

    return (
        <WorkspacePage>
            <PageHeader
                title={title || detail.project.title}
                meta={
                    <Tag bordered={false} color={run?.status === "completed" ? "success" : run?.status === "partial_failed" || run?.status === "failed" ? "error" : "default"}>
                        {remakeStatusLabel(run?.status || detail.project.status)}
                    </Tag>
                }
                actions={
                    <Button icon={<ArrowLeft size={15} />} onClick={() => navigate("/remakes")}>
                        返回项目库
                    </Button>
                }
            />

            <nav className="mt-4 grid grid-cols-2 gap-2 border-y border-border/70 py-3 sm:grid-cols-4" aria-label="复刻阶段">
                {["参考片", "复刻方案", "分镜制作", "成片"].map((label, index) => (
                    <div key={label} className={`flex items-center gap-2 text-xs ${index <= currentStage ? "text-foreground" : "text-foreground/40"}`}>
                        <span
                            className={`grid size-6 shrink-0 place-items-center border ${index < currentStage ? "border-emerald-600 bg-emerald-600 text-white" : index === currentStage ? "border-primary text-primary" : "border-border text-foreground/45"}`}
                        >
                            {index < currentStage ? <Check size={13} /> : index + 1}
                        </span>
                        <span>{label}</span>
                    </div>
                ))}
            </nav>

            {run ? (
                <section className="mt-4 border-b border-border/70 pb-4" aria-label="运行进度">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-medium">
                                {remakeStageLabel(run.stage)}
                                {run.totalSteps ? ` · ${run.completedSteps}/${run.totalSteps} 项完成` : ""}
                            </div>
                            {run.error ? <p className="mt-1 text-xs text-red-500">{run.error}</p> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-foreground/55">本次 {remakeCredits(run.spentMicrocredits)} 积分</span>
                            {running && run?.status !== "cancelling" ? (
                                <Button size="small" icon={<Pause size={14} />} onClick={() => onAction("pause")} loading={actionMutation.isPending}>
                                    暂停
                                </Button>
                            ) : null}
                            {runCanContinue ? (
                                <Button size="small" type="primary" icon={<Play size={14} />} onClick={() => onAction("resume")} loading={actionMutation.isPending}>
                                    继续
                                </Button>
                            ) : null}
                            {run.status === "partial_failed" ? (
                                <Button size="small" icon={<RefreshCw size={14} />} onClick={() => onAction("retry_failed")} loading={actionMutation.isPending}>
                                    重试失败项
                                </Button>
                            ) : null}
                            {run && !["completed", "cancelled", "failed", "cancelling"].includes(run.status) ? (
                                <Button size="small" danger icon={<X size={14} />} onClick={() => onAction("cancel")} loading={actionMutation.isPending}>
                                    取消
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    {run.totalSteps ? <Progress className="mt-2 max-w-2xl" percent={Math.round((run.completedSteps / run.totalSteps) * 100)} size="small" showInfo /> : null}
                    {needsReview ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-500 pl-3">
                            <div>
                                <strong className="text-sm">检查新主体关键帧</strong>
                                <p className="mt-1 text-xs text-foreground/55">
                                    已选择 {selectedCount}/{runUnits.length} 个生成单元
                                </p>
                            </div>
                            <Button type="primary" icon={<Check size={15} />} disabled={selectedCount !== runUnits.length} loading={actionMutation.isPending || selectionMutation.isPending} onClick={() => onAction("approve_and_continue")}>
                                确认并继续生成视频
                            </Button>
                        </div>
                    ) : null}
                </section>
            ) : null}

            <section className="mt-4 grid grid-cols-1 gap-5 2xl:grid-cols-2">
                <div className={`min-w-0 ${mediaTab === "result" ? "hidden 2xl:block" : ""}`}>
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-semibold">参考视频</h2>
                        <span className="text-xs text-foreground/50">{detail.analysis ? `${detail.analysis.width}×${detail.analysis.height} · ${detail.analysis.fps.toFixed(2)} fps` : "等待分析"}</span>
                    </div>
                    <video className="aspect-video w-full bg-black object-contain" src={resourceFileUrl(detail.project.sourceResourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                    {detail.analysis ? (
                        <p className="mt-2 text-xs text-foreground/50">
                            分析区间 {remakeTime(detail.analysis.sourceInMs)}–{remakeTime(detail.analysis.sourceOutMs)} · {detail.analysis.shots.length} 个镜头 · {detail.analysis.hasAudio ? "含音轨" : "无音轨"}
                        </p>
                    ) : null}
                </div>
                <div className={`min-w-0 ${mediaTab === "source" ? "hidden 2xl:block" : ""}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">当前成片</h2>
                        {latestExport ? (
                            <a
                                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                href={exportAccessQuery.data ? resolveResourceAccessURL(exportAccessQuery.data.url) : undefined}
                                download={`${detail.project.title}.mp4`}
                                aria-disabled={!exportAccessQuery.data || exportAccessQuery.isFetching}
                                onClick={(event) => {
                                    if (!exportAccessQuery.data || exportAccessQuery.isFetching) event.preventDefault();
                                }}
                            >
                                <Download size={14} />
                                {exportAccessQuery.isError ? "下载地址读取失败" : exportAccessQuery.isFetching ? "准备下载" : "下载 MP4"}
                            </a>
                        ) : (
                            <span className="text-xs text-foreground/45">完整运行后生成</span>
                        )}
                    </div>
                    {latestExport ? (
                        <>
                            <video className="aspect-video w-full bg-black object-contain" src={resourceFileUrl(latestExport.resourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                            <p className="mt-2 text-xs text-foreground/50">
                                成片 {remakeTime(latestExport.durationMs)} · {new Date(latestExport.createdAt).toLocaleString("zh-CN")}
                            </p>
                        </>
                    ) : (
                        <div className="grid aspect-video w-full place-items-center border border-dashed border-border/70 bg-surface/40 text-center">
                            <div>
                                <Play className="mx-auto size-7 text-foreground/30" />
                                <p className="mt-2 text-xs text-foreground/45">等待所有镜头完成并合成</p>
                            </div>
                        </div>
                    )}
                </div>
                <div className="2xl:hidden">
                    <Segmented
                        block
                        value={mediaTab}
                        options={[
                            { label: "参考片", value: "source" },
                            { label: "成片", value: "result" },
                        ]}
                        onChange={(value) => setMediaTab(String(value))}
                    />
                </div>
            </section>

            {detail.analysis?.warnings?.length ? <Alert className="mt-4" type="warning" showIcon message="分析提示" description={detail.analysis.warnings.join("；")} /> : null}

            <section className="mt-6 border-t border-border/70 pt-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold">主体替换与分镜</h2>
                        <p className="mt-1 text-xs text-foreground/50">镜头区间保持完整覆盖；描述和提示词保存到项目草稿。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<Save size={14} />} disabled={!dirty || saveMutation.isPending} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                            保存草稿
                        </Button>
                        <Button icon={<RefreshCw size={14} />} disabled={active || runMutation.isPending} loading={runMutation.isPending} onClick={() => onRun("analysis")}>
                            {detail.analysis ? "重新分析" : "分析参考片"}
                        </Button>
                        <Button disabled={!detail.analysis || active || runMutation.isPending || !settings.targetResourceIds.length || !settings.targetDescription.trim()} loading={runMutation.isPending} onClick={() => onRun("keyframes")}>
                            生成关键帧
                        </Button>
                        <Button
                            type="primary"
                            icon={<Play size={14} />}
                            disabled={active || runMutation.isPending || !settings.targetResourceIds.length || !settings.targetDescription.trim()}
                            loading={runMutation.isPending}
                            onClick={() => onRun("complete")}
                        >
                            一键复刻
                        </Button>
                    </div>
                </div>
                {shotValidation ? <Alert className="mt-3" type="error" showIcon message={shotValidation} /> : null}
                {!detail.analysis ? <div className="mt-4 border-y border-border/60 py-5 text-sm text-foreground/55">完成参考片分析后，这里会显示镜头时间轴、关键帧和主体替换方案。</div> : null}

                {detail.analysis ? (
                    <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
                        <aside className="min-w-0 border-b border-border/70 pb-4 xl:border-b-0 xl:border-r xl:pr-5">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-medium">替换主体</h3>
                                <Tag>{settings.targetResourceIds.length}/4</Tag>
                            </div>
                            <label className="mt-3 block text-xs text-foreground/65">
                                新主体描述
                                <Input.TextArea className="mt-1" rows={3} maxLength={2000} value={settings.targetDescription} onChange={(event) => setSettings((current) => (current ? { ...current, targetDescription: event.target.value } : current))} />
                            </label>
                            <label className="mt-3 block text-xs text-foreground/65">
                                整体风格
                                <Input.TextArea className="mt-1" rows={2} maxLength={2000} value={settings.style} onChange={(event) => setSettings((current) => (current ? { ...current, style: event.target.value } : current))} />
                            </label>
                            <div className="mt-3 flex items-center justify-between gap-2">
                                <span className="text-xs text-foreground/65">主体参考图</span>
                                <input
                                    ref={targetInput}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="sr-only"
                                    onChange={(event) => {
                                        void addTargetImages(event.target.files);
                                        event.currentTarget.value = "";
                                    }}
                                />
                                <Button size="small" icon={<Upload size={13} />} disabled={targetUploading || settings.targetResourceIds.length >= 4} loading={targetUploading} onClick={() => targetInput.current?.click()}>
                                    上传图片
                                </Button>
                            </div>
                            {settings.targetResourceIds.length ? (
                                <div className="mt-2 grid grid-cols-4 gap-2">
                                    {settings.targetResourceIds.map((resourceId) => (
                                        <div className="group relative" key={resourceId}>
                                            <img className="aspect-square w-full bg-surface object-cover" src={resourceFileUrl(resourceId)} alt="主体参考图" crossOrigin="use-credentials" />
                                            <button
                                                type="button"
                                                aria-label="移除主体参考图"
                                                className="absolute right-1 top-1 grid size-6 place-items-center bg-black/65 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                onClick={() => setSettings((current) => (current ? { ...current, targetResourceIds: current.targetResourceIds.filter((id) => id !== resourceId) } : current))}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-2 text-xs text-amber-600">上传至少一张新主体图片后才能生成。</p>
                            )}
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <label className="min-w-0 text-xs text-foreground/65">
                                    画幅
                                    <Select
                                        className="mt-1 w-full"
                                        value={settings.aspectRatio}
                                        options={[
                                            { value: "9:16", label: "9:16 竖屏" },
                                            { value: "16:9", label: "16:9 横屏" },
                                            { value: "1:1", label: "1:1 方形" },
                                        ]}
                                        onChange={(value) => setSettings((current) => (current ? { ...current, aspectRatio: value as RemakeSettings["aspectRatio"] } : current))}
                                    />
                                </label>
                                <label className="min-w-0 text-xs text-foreground/65">
                                    执行模式
                                    <Select
                                        className="mt-1 w-full"
                                        value={settings.mode}
                                        options={[
                                            { value: "review", label: "精修审核" },
                                            { value: "quick", label: "快速执行" },
                                        ]}
                                        onChange={(value) => setSettings((current) => (current ? { ...current, mode: value as RemakeSettings["mode"] } : current))}
                                    />
                                </label>
                            </div>
                            <label className="mt-3 block text-xs text-foreground/65">
                                预算上限（积分）
                                <InputNumber
                                    className="mt-1 w-full"
                                    min={0}
                                    max={1_000_000}
                                    step={10}
                                    value={settings.budgetMicrocredits / 1_000_000}
                                    onChange={(value) => setSettings((current) => (current ? { ...current, budgetMicrocredits: Math.round((value || 0) * 1_000_000) } : current))}
                                />
                            </label>
                            <p className="mt-1 text-xs leading-5 text-foreground/50">单项任务完成结算后才累计费用；若该笔超过剩余额度，费用仍会计入，之后停止派发。已提交任务可能继续完成。</p>
                        </aside>

                        <div className="min-w-0 space-y-5">
                            {shots.map((shot, index) => {
                                const units = runUnits.filter((unitId) => run?.steps.some((step) => step.unitId === unitId && step.shotId === shot.id));
                                const shotTakes = detail.takes.filter((take) => take.runId === run?.id && take.shotId === shot.id);
                                return (
                                    <article className="min-w-0 border-b border-border/70 pb-5" key={shot.id}>
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-medium">镜头 {index + 1}</h3>
                                                <p className="mt-1 text-xs text-foreground/50">
                                                    {remakeTime(shot.sourceInMs)}–{remakeTime(shot.sourceOutMs)} · {remakeTime(shot.sourceOutMs - shot.sourceInMs)} · {shot.shotSize || "未标景别"}
                                                </p>
                                            </div>
                                            <label className="flex items-center gap-2 text-xs text-foreground/60">
                                                需要替换的主体
                                                <Switch size="small" checked={shot.subjectPresent} onChange={(checked) => updateShot(shot.id, { subjectPresent: checked })} />
                                            </label>
                                        </div>
                                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[160px_minmax(0,1fr)]">
                                            <div className="min-w-0">
                                                <img className="aspect-video w-full bg-surface object-cover" src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${index + 1} 原始关键帧`} crossOrigin="use-credentials" />
                                                <span className="mt-1 block text-[11px] text-foreground/45">原始关键帧 · {remakeTime(shot.keyframeMs)}</span>
                                            </div>
                                            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                                                <label className="min-w-0 text-xs text-foreground/60">
                                                    画面描述
                                                    <Input.TextArea className="mt-1" rows={3} value={shot.description} onChange={(event) => updateShot(shot.id, { description: event.target.value })} />
                                                </label>
                                                <label className="min-w-0 text-xs text-foreground/60">
                                                    原主体描述
                                                    <Input.TextArea className="mt-1" rows={3} value={shot.subjectDescription || ""} onChange={(event) => updateShot(shot.id, { subjectDescription: event.target.value })} />
                                                </label>
                                                <label className="min-w-0 text-xs text-foreground/60">
                                                    关键帧提示词
                                                    <Input.TextArea className="mt-1" rows={4} value={shot.imagePrompt} onChange={(event) => updateShot(shot.id, { imagePrompt: event.target.value })} />
                                                </label>
                                                <label className="min-w-0 text-xs text-foreground/60">
                                                    视频提示词
                                                    <Input.TextArea className="mt-1" rows={4} value={shot.videoPrompt} onChange={(event) => updateShot(shot.id, { videoPrompt: event.target.value })} />
                                                </label>
                                            </div>
                                        </div>
                                        {shot.warnings?.length ? <p className="mt-2 text-xs text-amber-600">{shot.warnings.join("；")}</p> : null}
                                        {units.length ? (
                                            <div className="mt-4 space-y-3">
                                                {units.map((unitId) => {
                                                    const chosen = run?.selections[unitId]?.imageTakeId;
                                                    const candidates = detail.takes.filter((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "image");
                                                    const videoTake =
                                                        detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video" && take.id === run?.selections[unitId]?.videoTakeId) ||
                                                        detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video");
                                                    return (
                                                        <div className="min-w-0 border-l-2 border-border/80 pl-3" key={unitId}>
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <span className="text-xs font-medium">关键帧候选 · {unitId}</span>
                                                                {videoTake ? <Tag color="success">视频已生成 · {Math.ceil(videoTake.durationMs / 1000)} 秒</Tag> : null}
                                                            </div>
                                                            {candidates.length ? (
                                                                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                                    {candidates.map((take) => (
                                                                        <button
                                                                            type="button"
                                                                            key={take.id}
                                                                            disabled={!needsReview || selectionMutation.isPending}
                                                                            className={`min-w-0 border text-left transition-colors ${chosen === take.id ? "border-primary ring-1 ring-primary" : "border-border/60 hover:border-primary/50"}`}
                                                                            onClick={() => selectImageTake(unitId, take.id)}
                                                                        >
                                                                            <img className="aspect-square w-full bg-surface object-cover" src={resourceFileUrl(take.resourceId)} alt="生成的关键帧候选" crossOrigin="use-credentials" />
                                                                            <span className="flex items-center gap-1 p-1.5 text-[11px] text-foreground/55">
                                                                                {chosen === take.id ? <Check size={12} className="text-primary" /> : null}
                                                                                {chosen === take.id ? "已采用" : "候选"}
                                                                            </span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="mt-2 flex items-center gap-2 text-xs text-foreground/45">
                                                                    <span className="size-1.5 rounded-full bg-foreground/30" />
                                                                    {shotTakes.some((take) => take.unitId === unitId) ? "关键帧已就绪" : "等待生成"}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                ) : null}
            </section>

            {dirty ? (
                <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
                    <span className="text-xs text-amber-600">有未保存的修改</span>
                    <div className="flex gap-2">
                        <Button
                            icon={<X size={14} />}
                            onClick={() => {
                                setTitle(baseline.title);
                                setSettings(baseline.settings);
                                setShots(baseline.shots);
                            }}
                        >
                            放弃修改
                        </Button>
                        <Button type="primary" icon={<Save size={14} />} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                            保存草稿
                        </Button>
                    </div>
                </div>
            ) : null}
        </WorkspacePage>
    );
}
