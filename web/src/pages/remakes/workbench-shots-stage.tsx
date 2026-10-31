import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, InputNumber, Switch, Tag } from "antd";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Merge, Scissors } from "lucide-react";

import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { remakeTime } from "@/lib/remake/presentation";
import { clampRemakeShotBoundaries, mergeRemakeShotWithPrevious, splitRemakeShot } from "@/lib/remake/shots";
import type { RemakeDetail, RemakeRun, RemakeSettings, RemakeShot } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

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
    sourceRange: { inMs: number; outMs: number };
};

function unitIdsOfShot(run: RemakeRun | null, shotId: string) {
    return [...new Set((run?.steps || []).filter((step) => step.shotId === shotId && step.unitId).map((step) => step.unitId as string))];
}

/** 阶段③ 分镜制作：左侧参考片播放器与镜头条联动，右侧选中镜头的对照编辑器。 */
export function WorkbenchShotsStage({ detail, run, shots, updateShot, setShots, selectedShotId, onSelectShot, editable, needsReview, selectionPending, onSelectImageTake, onGoSource, sourceRange }: ShotsStageProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [promptsOpen, setPromptsOpen] = useState(false);
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
                            description="完成参考片分析后，这里会列出每个镜头：原关键帧与新主体关键帧对照、提示词编辑与镜头校正。"
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
                        <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">
                                镜头 {selectedIndex + 1}/{shots.length} · {playingShot ? `正在播放第 ${shots.indexOf(playingShot) + 1} 镜` : "参考片"}
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
                        <div className="mt-2">
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
                    </div>
                    <div className="rk-panel">
                        <p className="rk-panel-hint">点击镜头条或使用上一镜/下一镜切换镜头；点击原关键帧可跳到该帧时刻。区间与提示词的修改会进入项目草稿，由顶部「保存草稿」提交。</p>
                    </div>
                </aside>

                <div className="rk-shots-editor">
                    <article className="rk-shot-card" key={shot.id}>
                        <div className="rk-shot-head">
                            <div className="rk-shot-title">
                                <span>镜头 {selectedIndex + 1}</span>
                                <span className="rk-shot-sub">
                                    {remakeTime(shot.sourceInMs)}–{remakeTime(shot.sourceOutMs)} · {((shot.sourceOutMs - shot.sourceInMs) / 1000).toFixed(1)}s · {shot.shotSize || "未标景别"}
                                </span>
                            </div>
                            <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--rk-text-muted)]">
                                需要替换的主体
                                <Switch size="small" checked={shot.subjectPresent} onChange={(checked) => updateShot(shot.id, { subjectPresent: checked })} />
                            </label>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Tag bordered={false}>{shot.camera || "运镜未标注"}</Tag>
                            <Tag bordered={false}>{shot.motion || "动作未标注"}</Tag>
                            {editable ? (
                                <>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<Scissors size={13} />}
                                        disabled={shot.sourceOutMs - shot.sourceInMs < 2 || shots.length >= 20}
                                        onClick={() => setShots((current) => splitRemakeShot(current, selectedIndex, { newId: crypto.randomUUID() }))}
                                    >
                                        拆分
                                    </Button>
                                    <Button size="small" type="text" icon={<Merge size={13} />} disabled={selectedIndex <= 0 || shots.length <= 1} onClick={() => setShots((current) => mergeRemakeShotWithPrevious(current, selectedIndex))}>
                                        合并到上一镜
                                    </Button>
                                </>
                            ) : null}
                        </div>

                        {editable ? (
                            <div className="mt-3 grid max-w-[320px] grid-cols-2 gap-2">
                                <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                    开始（秒）
                                    <InputNumber
                                        className="mt-1 w-full"
                                        size="small"
                                        step={0.1}
                                        value={shot.sourceInMs / 1000}
                                        onChange={(value) => setShots((current) => clampRemakeShotBoundaries(current, selectedIndex, (value || 0) * 1000, shot.sourceOutMs, sourceRange.inMs, sourceRange.outMs))}
                                    />
                                </label>
                                <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                    结束（秒）
                                    <InputNumber
                                        className="mt-1 w-full"
                                        size="small"
                                        step={0.1}
                                        value={shot.sourceOutMs / 1000}
                                        onChange={(value) => setShots((current) => clampRemakeShotBoundaries(current, selectedIndex, shot.sourceInMs, (value || 0) * 1000, sourceRange.inMs, sourceRange.outMs))}
                                    />
                                </label>
                            </div>
                        ) : null}

                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(140px,180px)_minmax(0,1fr)]">
                            <button type="button" className="rk-tile rk-tile-media" style={aspect ? ({ "--rk-frame-ar": aspect } as React.CSSProperties) : undefined} title="点击跳到关键帧时刻" onClick={() => seekTo(shot.keyframeMs)}>
                                <img src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${selectedIndex + 1} 原始关键帧`} crossOrigin="use-credentials" />
                                <span className="rk-tile-label">原关键帧 · {remakeTime(shot.keyframeMs)}</span>
                            </button>
                            <div className="min-w-0">
                                {units.length ? (
                                    units.map((unitId) => {
                                        const candidates = detail.takes.filter((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "image");
                                        const chosen = run?.selections[unitId]?.imageTakeId;
                                        const videoTake =
                                            detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video" && take.id === run?.selections[unitId]?.videoTakeId) ||
                                            detail.takes.find((take) => take.runId === run?.id && take.unitId === unitId && take.kind === "video");
                                        return (
                                            <div key={unitId} className="min-w-0">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <span className="text-xs font-medium text-[var(--rk-text)]">新主体关键帧</span>
                                                    {videoTake ? (
                                                        <Tag color="success" bordered={false}>
                                                            视频已生成 · {Math.ceil(videoTake.durationMs / 1000)} 秒
                                                        </Tag>
                                                    ) : shotTakes.some((take) => take.unitId === unitId) ? (
                                                        <Tag bordered={false}>关键帧已就绪</Tag>
                                                    ) : (
                                                        <Tag bordered={false}>{run ? "等待生成" : "未启动生成"}</Tag>
                                                    )}
                                                </div>
                                                {candidates.length ? (
                                                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                                                        {candidates.map((take) => (
                                                            <button
                                                                type="button"
                                                                key={take.id}
                                                                className={`rk-tile${chosen === take.id ? " is-active" : ""}`}
                                                                disabled={!needsReview || selectionPending}
                                                                title={needsReview ? "选用此关键帧" : "运行审核阶段才能更换关键帧"}
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
                                                    <p className="mt-2 text-xs text-[var(--rk-text-muted)]">该镜头的生成单元还没有关键帧候选。</p>
                                                )}
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-xs leading-5 text-[var(--rk-text-muted)]">在「复刻方案」完成主体绑定后启动生成；每个镜头的新主体关键帧与视频会出现在这里供对照和选用。</p>
                                )}
                            </div>
                        </div>

                        {shot.warnings?.length ? <p className="mt-3 text-xs text-[var(--rk-warning)]">{shot.warnings.join("；")}</p> : null}

                        <div className="mt-3 border-t border-[var(--rk-edge-soft)] pt-2">
                            <button type="button" className="flex items-center gap-1 bg-transparent text-xs font-medium text-[var(--rk-text-muted)]" aria-expanded={promptsOpen} onClick={() => setPromptsOpen((open) => !open)}>
                                <ChevronDown size={14} className={`transition-transform${promptsOpen ? " rotate-180" : ""}`} aria-hidden />
                                提示词编辑
                            </button>
                            {promptsOpen ? (
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                        画面描述
                                        <Input.TextArea className="mt-1" rows={3} value={shot.description} onChange={(event) => updateShot(shot.id, { description: event.target.value })} />
                                    </label>
                                    <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                        原主体描述
                                        <Input.TextArea className="mt-1" rows={3} value={shot.subjectDescription || ""} onChange={(event) => updateShot(shot.id, { subjectDescription: event.target.value })} />
                                    </label>
                                    <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                        关键帧提示词
                                        <Input.TextArea className="mt-1" rows={4} value={shot.imagePrompt} onChange={(event) => updateShot(shot.id, { imagePrompt: event.target.value })} />
                                    </label>
                                    <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                        视频提示词
                                        <Input.TextArea className="mt-1" rows={4} value={shot.videoPrompt} onChange={(event) => updateShot(shot.id, { videoPrompt: event.target.value })} />
                                    </label>
                                </div>
                            ) : null}
                        </div>
                    </article>
                </div>
            </div>
        </div>
    );
}
