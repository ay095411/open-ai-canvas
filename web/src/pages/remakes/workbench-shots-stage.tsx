import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Input, InputNumber, Switch, Tag } from "antd";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clapperboard, Merge, Scissors } from "lucide-react";

import { Callout } from "@/components/ui/product/callout";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { isRemakeRunActive, remakeTime } from "@/lib/remake/presentation";
import { clampRemakeShotBoundaries, mergeRemakeShotWithPrevious, splitRemakeShot } from "@/lib/remake/shots";
import type { RemakeDetail, RemakeRun, RemakeShot } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

import { RemakeDisclosure } from "./remake-settings-fields";
import { WorkbenchShotStrip } from "./workbench-shot-strip";

export type ShotsStageProps = {
    detail: RemakeDetail;
    run: RemakeRun | null;
    shots: RemakeShot[];
    updateShot: (shotId: string, patch: Partial<RemakeShot>) => void;
    setShots: (updater: (current: RemakeShot[]) => RemakeShot[]) => void;
    selectedShotId: string | null;
    onSelectShot: (shotId: string) => void;
    /** 无活跃运行时才允许拆分/合并/边界校正 */
    editable: boolean;
    /** awaiting_review 时可点选关键帧候选 */
    needsReview: boolean;
    selectionPending: boolean;
    onSelectImageTake: (unitId: string, takeId: string) => void;
    onGoSource: () => void;
    onGoPlan: () => void;
    sourceRange: { inMs: number; outMs: number };
};

function unitIdsOfShot(run: RemakeRun | null, shotId: string) {
    return [...new Set((run?.steps || []).filter((step) => step.shotId === shotId && step.unitId).map((step) => step.unitId as string))];
}

/** 阶段③ 审核分镜：左侧参考片与镜头条，右侧是当前镜头的原片 / 新主体对照；编辑项收在「调整镜头」里。 */
export function WorkbenchShotsStage({ detail, run, shots, updateShot, setShots, selectedShotId, onSelectShot, editable, needsReview, selectionPending, onSelectImageTake, onGoSource, onGoPlan, sourceRange }: ShotsStageProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [editOpen, setEditOpen] = useState(false);
    const analysis = detail.analysis;
    const selectedIndex = Math.max(
        0,
        shots.findIndex((shot) => shot.id === selectedShotId),
    );
    const shot = shots[selectedIndex];
    const aspect = analysis && analysis.width > 0 && analysis.height > 0 ? `${analysis.width} / ${analysis.height}` : undefined;
    const playingShot = useMemo(() => shots.find((item) => currentMs >= item.sourceInMs && currentMs < item.sourceOutMs) || null, [shots, currentMs]);

    useEffect(() => {
        if (shot && videoRef.current) {
            videoRef.current.currentTime = shot.sourceInMs / 1000;
            setCurrentMs(shot.sourceInMs);
        }
        // 选中镜头变化时把播放器定位到镜头起点
    }, [selectedShotId]);

    const seekTo = (ms: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, ms) / 1000;
        setCurrentMs(Math.max(0, ms));
    };

    const goShot = (index: number) => {
        const target = shots[Math.min(shots.length - 1, Math.max(0, index))];
        if (target) onSelectShot(target.id);
    };

    if (!shots.length) {
        return (
            <div className="rk-stage">
                <div className="rk-stage-scroll">
                    <div className="rk-panel">
                        <EmptyState
                            icon={Clapperboard}
                            title="还没有分镜"
                            description="先分析参考片，系统会按镜头切分并列在这里。"
                            action={
                                <Button type="primary" onClick={onGoSource}>
                                    去分析参考片
                                </Button>
                            }
                        />
                    </div>
                </div>
            </div>
        );
    }

    const units = run ? unitIdsOfShot(run, shot.id) : [];
    const shotTakes = run ? detail.takes.filter((take) => take.runId === run.id && take.shotId === shot.id) : [];
    const generationStarted = Boolean(run && run.goal !== "analysis");
    const takeAspect = { "--rk-take-ar": (detail.project.settings.aspectRatio || "1:1").replace(":", " / ") } as CSSProperties;
    const shotMeta = [`${remakeTime(shot.sourceInMs)}–${remakeTime(shot.sourceOutMs)}`, `${((shot.sourceOutMs - shot.sourceInMs) / 1000).toFixed(1)} 秒`, shot.shotSize, shot.camera, shot.motion].filter(Boolean).join(" · ");

    return (
        <div className="rk-stage">
            <div className="rk-shots-grid">
                <aside className="rk-shots-side">
                    <div className="rk-panel">
                        <div className="rk-player" style={aspect ? { aspectRatio: aspect } : undefined}>
                            <video
                                ref={videoRef}
                                className={!aspect ? "aspect-video" : undefined}
                                src={resourceFileUrl(detail.project.sourceResourceId)}
                                controls
                                preload="metadata"
                                crossOrigin="use-credentials"
                                onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
                            />
                        </div>
                        <div className="rk-shots-nav">
                            <span className="rk-caption tabular-nums">
                                镜头 {selectedIndex + 1} / {shots.length}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button size="small" type="text" aria-label="上一镜" disabled={selectedIndex <= 0} onClick={() => goShot(selectedIndex - 1)}>
                                    <ChevronLeft size={15} />
                                </Button>
                                <Button size="small" type="text" aria-label="下一镜" disabled={selectedIndex >= shots.length - 1} onClick={() => goShot(selectedIndex + 1)}>
                                    <ChevronRight size={15} />
                                </Button>
                            </div>
                        </div>
                        <WorkbenchShotStrip
                            compact
                            shots={shots}
                            selectedId={shot?.id || null}
                            playingId={playingShot?.id || null}
                            playheadRatio={sourceRange.outMs > sourceRange.inMs ? (currentMs - sourceRange.inMs) / (sourceRange.outMs - sourceRange.inMs) : null}
                            onSelect={(shotId) => {
                                onSelectShot(shotId);
                                const target = shots.find((item) => item.id === shotId);
                                if (target) seekTo(target.sourceInMs);
                            }}
                            ariaLabel="分镜镜头时间条"
                        />
                    </div>
                </aside>

                <div className="rk-shots-editor">
                    <article className="rk-shot-card" key={shot.id}>
                        <div className="rk-shot-head">
                            <div className="min-w-0">
                                <h2 className="rk-shot-title">镜头 {selectedIndex + 1}</h2>
                                <p className="rk-shot-sub">{shotMeta}</p>
                            </div>
                            <label className="rk-shot-switch">
                                替换主体
                                <Switch size="small" checked={shot.subjectPresent} onChange={(checked) => updateShot(shot.id, { subjectPresent: checked })} />
                            </label>
                        </div>

                        <div className="rk-shot-compare">
                            <div className="rk-shot-col">
                                <span className="rk-shot-col-label">原片</span>
                                <button type="button" className="rk-tile rk-tile-media" style={aspect ? ({ "--rk-frame-ar": aspect } as CSSProperties) : undefined} title="点击跳到关键帧时刻" onClick={() => seekTo(shot.keyframeMs)}>
                                    <img src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${selectedIndex + 1} 原始关键帧`} crossOrigin="use-credentials" />
                                    <span className="rk-tile-label">关键帧 · {remakeTime(shot.keyframeMs)}</span>
                                </button>
                            </div>
                            <div className="rk-shot-col">
                                {units.length ? (
                                    units.map((unitId) => {
                                        const candidates = detail.takes.filter((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "image");
                                        const chosen = run?.selections[unitId]?.imageTakeId;
                                        const videoTake =
                                            detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video" && take.id === run?.selections[unitId]?.videoTakeId) ||
                                            detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video");
                                        return (
                                            <div key={unitId} className="rk-shot-unit">
                                                <div className="rk-shot-col-head">
                                                    <span className="rk-shot-col-label">新主体</span>
                                                    {videoTake ? (
                                                        <Tag color="success" bordered={false}>
                                                            视频已生成 · {Math.ceil(videoTake.durationMs / 1000)} 秒
                                                        </Tag>
                                                    ) : shotTakes.some((take) => take.unitId === unitId) ? (
                                                        <Tag bordered={false}>{needsReview ? "请选定一张" : "关键帧已就绪"}</Tag>
                                                    ) : (
                                                        <Tag bordered={false}>等待生成</Tag>
                                                    )}
                                                </div>
                                                {candidates.length ? (
                                                    <div className="rk-take-grid" style={takeAspect}>
                                                        {candidates.map((take) => (
                                                            <button
                                                                type="button"
                                                                key={take.id}
                                                                className={`rk-tile${chosen === take.id ? " is-active" : ""}`}
                                                                disabled={!needsReview || selectionPending}
                                                                aria-pressed={chosen === take.id}
                                                                title={needsReview ? "选用此关键帧" : "审核阶段才能更换关键帧"}
                                                                onClick={() => onSelectImageTake(unitId, take.id)}
                                                            >
                                                                <img src={resourceFileUrl(take.resourceId)} alt="生成的新主体关键帧候选" crossOrigin="use-credentials" />
                                                                {chosen === take.id ? (
                                                                    <span className="rk-tile-flag" aria-hidden>
                                                                        <Check size={12} />
                                                                    </span>
                                                                ) : null}
                                                                <span className="rk-tile-label">{chosen === take.id ? "已采用" : needsReview ? "点击采用" : "候选"}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="rk-caption">关键帧生成中，完成后显示在这里。</p>
                                                )}
                                            </div>
                                        );
                                    })
                                ) : generationStarted ? (
                                    <div className="rk-shot-pending">
                                        <span className="rk-shot-col-label">新主体</span>
                                        <p className="rk-caption">{isRemakeRunActive(run) ? "正在准备生成…" : "本次运行没有这个镜头的生成结果。"}</p>
                                    </div>
                                ) : (
                                    <div className="rk-shot-pending">
                                        <span className="rk-shot-col-label">新主体</span>
                                        <p className="rk-caption">设定新主体并启动复刻后，每个镜头的新关键帧会出现在这里。</p>
                                        <Button size="small" icon={<ArrowRight size={14} />} iconPlacement="end" onClick={onGoPlan}>
                                            去设定新主体
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {shot.warnings?.length ? (
                            <Callout className="mt-4" tone="warning">
                                {shot.warnings.join("；")}
                            </Callout>
                        ) : null}

                        <RemakeDisclosure className="rk-shot-edit" variant="inline" title="调整镜头" summary={editable ? "区间、拆分合并与提示词" : "运行中只能修改提示词"} open={editOpen} onToggle={() => setEditOpen((open) => !open)}>
                            {editable ? (
                                <div className="rk-shot-tools">
                                    <div className="rk-shot-range">
                                        <label className="remake-field is-compact">
                                            <span className="remake-field-sublabel">开始（秒）</span>
                                            <InputNumber
                                                className="w-full"
                                                size="small"
                                                step={0.1}
                                                value={shot.sourceInMs / 1000}
                                                onChange={(value) => setShots((current) => clampRemakeShotBoundaries(current, selectedIndex, (value || 0) * 1000, shot.sourceOutMs, sourceRange.inMs, sourceRange.outMs))}
                                            />
                                        </label>
                                        <label className="remake-field is-compact">
                                            <span className="remake-field-sublabel">结束（秒）</span>
                                            <InputNumber
                                                className="w-full"
                                                size="small"
                                                step={0.1}
                                                value={shot.sourceOutMs / 1000}
                                                onChange={(value) => setShots((current) => clampRemakeShotBoundaries(current, selectedIndex, shot.sourceInMs, (value || 0) * 1000, sourceRange.inMs, sourceRange.outMs))}
                                            />
                                        </label>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="small"
                                            icon={<Scissors size={13} />}
                                            disabled={shot.sourceOutMs - shot.sourceInMs < 2 || shots.length >= 20}
                                            onClick={() => setShots((current) => splitRemakeShot(current, selectedIndex, { newId: crypto.randomUUID() }))}
                                        >
                                            拆分
                                        </Button>
                                        <Button size="small" icon={<Merge size={13} />} disabled={selectedIndex <= 0 || shots.length <= 1} onClick={() => setShots((current) => mergeRemakeShotWithPrevious(current, selectedIndex))}>
                                            合并到上一镜
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                            <div className="rk-prompt-grid">
                                <label className="remake-field is-compact">
                                    <span className="remake-field-sublabel">画面描述</span>
                                    <Input.TextArea rows={3} value={shot.description} onChange={(event) => updateShot(shot.id, { description: event.target.value })} />
                                </label>
                                <label className="remake-field is-compact">
                                    <span className="remake-field-sublabel">原主体描述</span>
                                    <Input.TextArea rows={3} value={shot.subjectDescription || ""} onChange={(event) => updateShot(shot.id, { subjectDescription: event.target.value })} />
                                </label>
                                <label className="remake-field is-compact">
                                    <span className="remake-field-sublabel">关键帧提示词</span>
                                    <Input.TextArea rows={4} value={shot.imagePrompt} onChange={(event) => updateShot(shot.id, { imagePrompt: event.target.value })} />
                                </label>
                                <label className="remake-field is-compact">
                                    <span className="remake-field-sublabel">视频提示词</span>
                                    <Input.TextArea rows={4} value={shot.videoPrompt} onChange={(event) => updateShot(shot.id, { videoPrompt: event.target.value })} />
                                </label>
                            </div>
                        </RemakeDisclosure>
                    </article>
                </div>
            </div>
        </div>
    );
}
