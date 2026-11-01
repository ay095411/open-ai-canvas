import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "antd";
import { ArrowRight, CircleCheck, Clapperboard, RefreshCw, ScanLine } from "lucide-react";

import { Callout } from "@/components/ui/product/callout";
import { remakeDuration, remakeTime } from "@/lib/remake/presentation";
import type { RemakeDetail, RemakeSettings, RemakeShot } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

import { REMAKE_MAX_RANGE_MS, RemakeDisclosure, RemakeRangeFields } from "./remake-settings-fields";
import { WorkbenchShotStrip } from "./workbench-shot-strip";

export type SourceStageProps = {
    detail: RemakeDetail;
    settings: RemakeSettings;
    shots: RemakeShot[];
    updateSettings: (patch: Partial<RemakeSettings>) => void;
    analysisBusy: boolean;
    analyzePending: boolean;
    canLaunch: boolean;
    onAnalyze: () => void;
    /** 分析完成后进入下一阶段 */
    onNext: () => void;
};

/** 阶段① 分析参考片：左侧播放器与镜头条联动；右侧只放当前该做的一件事。 */
export function WorkbenchSourceStage({ detail, settings, shots, updateSettings, analysisBusy, analyzePending, canLaunch, onAnalyze, onNext }: SourceStageProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [rangeOpen, setRangeOpen] = useState(false);
    const analysis = detail.analysis;
    const rangeIn = analysis ? analysis.sourceInMs : settings.sourceInMs;
    const rangeOut = analysis ? analysis.sourceOutMs : settings.sourceOutMs;
    const rangeMs = Math.max(0, rangeOut - rangeIn);

    const playingShot = useMemo(() => shots.find((shot) => currentMs >= shot.sourceInMs && currentMs < shot.sourceOutMs) || null, [shots, currentMs]);
    const aspect = analysis && analysis.width > 0 && analysis.height > 0 ? `${analysis.width} / ${analysis.height}` : undefined;
    const rangeChanged = Boolean(analysis && (settings.sourceInMs !== analysis.sourceInMs || settings.sourceOutMs !== analysis.sourceOutMs));
    const overLimit = settings.sourceOutMs > settings.sourceInMs && settings.sourceOutMs - settings.sourceInMs > REMAKE_MAX_RANGE_MS;
    const showRange = rangeOpen || rangeChanged || overLimit;

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

    const rangeFields = <RemakeRangeFields label="分析区间" inMs={settings.sourceInMs} outMs={settings.sourceOutMs} durationMs={analysis?.sourceDurationMs || undefined} overLimit={overLimit} onChange={updateSettings} />;

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
                            <div className="mt-4">
                                <WorkbenchShotStrip shots={shots} selectedId={selectedId} playingId={playingShot?.id || null} playheadRatio={rangeMs ? (currentMs - rangeIn) / rangeMs : null} onSelect={onStripSelect} ariaLabel="参考片镜头时间条" />
                                <p className="rk-caption mt-2">{playingShot ? `镜头 ${shots.indexOf(playingShot) + 1} · ${remakeTime(playingShot.sourceInMs)}–${remakeTime(playingShot.sourceOutMs)}` : `${shots.length} 个镜头，点击色块定位播放`}</p>
                            </div>
                        ) : null}
                    </div>

                    <aside className="rk-panel rk-source-side">
                        {analysis ? (
                            <>
                                <h2 className="rk-panel-heading">
                                    <CircleCheck size={16} className="text-[var(--rk-success)]" aria-hidden />
                                    分析完成
                                </h2>
                                <p className="rk-source-count">
                                    <strong className="tabular-nums">{analysis.shots.length}</strong> 个镜头
                                </p>
                                <ul className="rk-meta-list" aria-label="参考片规格">
                                    <li className="tabular-nums">{remakeDuration(analysis.sourceOutMs - analysis.sourceInMs)}</li>
                                    <li className="tabular-nums">
                                        {analysis.width}×{analysis.height}
                                    </li>
                                    <li className="tabular-nums">{Number(analysis.fps.toFixed(2))} fps</li>
                                    <li>{analysis.hasAudio ? "含音轨" : "无音轨"}</li>
                                </ul>
                                {analysis.warnings?.length ? (
                                    <Callout tone="warning" title="分析提示">
                                        {analysis.warnings.join("；")}
                                    </Callout>
                                ) : null}
                                <Button type="primary" size="large" block icon={<ArrowRight size={16} />} iconPlacement="end" onClick={onNext}>
                                    下一步：设定新主体
                                </Button>
                                <RemakeDisclosure variant="inline" title="调整区间并重新分析" open={showRange} onToggle={() => setRangeOpen((open) => !open)}>
                                    <div className="grid gap-3">
                                        {rangeFields}
                                        {overLimit ? <p className="rk-error-text">区间不能超过 60 秒，请先缩短。</p> : null}
                                        <p className="rk-caption">{rangeChanged ? "区间已修改，重新分析后生效。" : "重新分析会替换当前分镜草稿。"}</p>
                                        <Button icon={<RefreshCw size={14} />} disabled={!canLaunch || analysisBusy} loading={analyzePending} onClick={onAnalyze}>
                                            重新分析
                                        </Button>
                                    </div>
                                </RemakeDisclosure>
                            </>
                        ) : (
                            <>
                                <h2 className="rk-panel-heading">
                                    <ScanLine size={16} aria-hidden />
                                    分析参考片
                                </h2>
                                <p className="rk-panel-hint">自动切分镜头，识别景别、运镜和画面内容。</p>
                                {rangeFields}
                                {overLimit ? <p className="rk-error-text">区间不能超过 60 秒，请先缩短。</p> : null}
                                <Button type="primary" size="large" block icon={<Clapperboard size={16} />} disabled={!canLaunch || analysisBusy} loading={analyzePending} onClick={onAnalyze}>
                                    {analysisBusy ? "分析进行中…" : "开始分析"}
                                </Button>
                                <p className="rk-caption">60 秒以内、最多 20 个镜头；分析期间可以离开页面。</p>
                            </>
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}
