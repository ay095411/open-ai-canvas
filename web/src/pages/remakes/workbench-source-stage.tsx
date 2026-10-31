import { useEffect, useMemo, useRef, useState } from "react";
import { Button, InputNumber } from "antd";
import { Clapperboard, RefreshCw, ScanLine } from "lucide-react";

import { Callout } from "@/components/ui/product/callout/callout";
import { remakeDuration, remakeTime } from "@/lib/remake/presentation";
import type { RemakeDetail, RemakeSettings, RemakeShot } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

import { WorkbenchShotStrip } from "./workbench-shot-strip";

const MAX_RANGE_MS = 60_000;

export type SourceStageProps = {
    detail: RemakeDetail;
    settings: RemakeSettings;
    shots: RemakeShot[];
    updateSettings: (patch: Partial<RemakeSettings>) => void;
    analysisBusy: boolean;
    analyzePending: boolean;
    canLaunch: boolean;
    onAnalyze: () => void;
};

/** 阶段① 参考片：大播放器 + 镜头时间条联动 + 分析信息与截取区间。 */
export function WorkbenchSourceStage({ detail, settings, shots, updateSettings, analysisBusy, analyzePending, canLaunch, onAnalyze }: SourceStageProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const analysis = detail.analysis;
    const rangeIn = analysis ? analysis.sourceInMs : settings.sourceInMs;
    const rangeOut = analysis ? analysis.sourceOutMs : settings.sourceOutMs;
    const rangeMs = Math.max(0, rangeOut - rangeIn);

    const playingShot = useMemo(() => shots.find((shot) => currentMs >= shot.sourceInMs && currentMs < shot.sourceOutMs) || null, [shots, currentMs]);
    const aspect = analysis && analysis.width > 0 && analysis.height > 0 ? `${analysis.width} / ${analysis.height}` : undefined;
    const rangeChanged = Boolean(analysis && (settings.sourceInMs !== analysis.sourceInMs || settings.sourceOutMs !== analysis.sourceOutMs));
    const overLimit = settings.sourceOutMs > settings.sourceInMs && settings.sourceOutMs - settings.sourceInMs > MAX_RANGE_MS;

    useEffect(() => {
        setSelectedId((current) => (current && shots.some((shot) => shot.id === current) ? current : null));
    }, [shots]);

    const seekTo = (ms: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, ms) / 1000;
        void video.play().catch(() => undefined);
    };

    const onStripSelect = (shotId: string) => {
        setSelectedId(shotId);
        const shot = shots.find((item) => item.id === shotId);
        if (shot) seekTo(shot.sourceInMs);
    };

    return (
        <div className="rk-stage">
            <div className="rk-stage-scroll">
                <div className="rk-stage-source-grid">
                    <div className="rk-panel min-w-0">
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
                        {shots.length ? (
                            <div className="mt-3">
                                <WorkbenchShotStrip shots={shots} selectedId={selectedId} playingId={playingShot?.id || null} playheadRatio={rangeMs ? (currentMs - rangeIn) / rangeMs : null} onSelect={onStripSelect} ariaLabel="参考片镜头时间条" />
                                <p className="mt-2 text-xs text-[var(--rk-text-muted)]">
                                    {playingShot ? `正在播放镜头 ${shots.indexOf(playingShot) + 1} · ${remakeTime(playingShot.sourceInMs)}–${remakeTime(playingShot.sourceOutMs)}` : "点击镜头块可定位播放；进入「分镜制作」可校正镜头边界。"}
                                </p>
                            </div>
                        ) : (
                            <p className="mt-3 text-xs text-[var(--rk-text-muted)]">分析完成后，这里会显示按镜头切分的时间条，可与播放器联动定位。</p>
                        )}
                    </div>

                    <div className="flex min-w-0 flex-col gap-3">
                        <section className="rk-panel">
                            <div className="rk-panel-title">
                                <h2 className="rk-panel-heading">
                                    <ScanLine size={15} aria-hidden />
                                    参考片分析
                                </h2>
                            </div>
                            {analysis ? (
                                <>
                                    <div className="rk-info-grid mt-3">
                                        <div className="rk-info-cell">
                                            <div className="rk-info-label">分辨率</div>
                                            <div className="rk-info-value">
                                                {analysis.width}×{analysis.height}
                                            </div>
                                        </div>
                                        <div className="rk-info-cell">
                                            <div className="rk-info-label">帧率</div>
                                            <div className="rk-info-value">{analysis.fps.toFixed(2)} fps</div>
                                        </div>
                                        <div className="rk-info-cell">
                                            <div className="rk-info-label">分析区间</div>
                                            <div className="rk-info-value">{remakeDuration(analysis.sourceOutMs - analysis.sourceInMs)}</div>
                                        </div>
                                        <div className="rk-info-cell">
                                            <div className="rk-info-label">镜头数</div>
                                            <div className="rk-info-value">{analysis.shots.length}</div>
                                        </div>
                                        <div className="rk-info-cell">
                                            <div className="rk-info-label">音轨</div>
                                            <div className="rk-info-value">{analysis.hasAudio ? "含音轨" : "无音轨"}</div>
                                        </div>
                                    </div>
                                    {analysis.warnings?.length ? (
                                        <Callout className="mt-3" tone="warning" title="分析提示">
                                            {analysis.warnings.join("；")}
                                        </Callout>
                                    ) : null}
                                    <div className="mt-3 flex items-center justify-between gap-2">
                                        <span className="rk-panel-hint">重新分析会生成新的镜头方案，并替换当前分镜草稿。</span>
                                        <Button size="small" icon={<RefreshCw size={13} />} disabled={!canLaunch || analysisBusy} loading={analyzePending} onClick={onAnalyze}>
                                            重新分析
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="rk-panel-hint mt-2">系统将探测视频规格、按场景切分镜头，并为每个镜头生成代表帧、景别、运镜与画面描述，作为复刻方案的基础。</p>
                                    <Button className="mt-3" type="primary" block icon={<Clapperboard size={15} />} disabled={!canLaunch || analysisBusy} loading={analyzePending} onClick={onAnalyze}>
                                        {analysisBusy ? "分析进行中…" : "分析参考片"}
                                    </Button>
                                    <p className="mt-2 rk-panel-hint">首版支持 60 秒以内、最多 20 个镜头的片段；分析期间可离开页面，进度在顶部展示。</p>
                                </>
                            )}
                        </section>

                        <section className="rk-panel">
                            <h2 className="rk-panel-heading">截取区间</h2>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                    开始（秒）
                                    <InputNumber className="mt-1 w-full" size="small" min={0} step={0.1} value={settings.sourceInMs / 1000} onChange={(value) => updateSettings({ sourceInMs: Math.max(0, Math.round((value || 0) * 1000)) })} />
                                </label>
                                <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                    结束（秒）
                                    <InputNumber
                                        className="mt-1 w-full"
                                        size="small"
                                        min={0}
                                        step={0.1}
                                        value={settings.sourceOutMs ? settings.sourceOutMs / 1000 : null}
                                        placeholder="完整视频"
                                        onChange={(value) => updateSettings({ sourceOutMs: Math.max(0, Math.round((value || 0) * 1000)) })}
                                    />
                                </label>
                            </div>
                            <p className="mt-2 rk-panel-hint">
                                当前区间 {remakeDuration(Math.max(0, settings.sourceOutMs - settings.sourceInMs))}
                                {analysis ? (rangeChanged ? " · 已修改，保存草稿后重新分析以应用" : " · 与当前分析一致") : ""}
                            </p>
                            {overLimit ? <Callout className="mt-2" tone="error" title="复刻区间不能超过 60 秒，请先缩短片段。" /> : null}
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
