import { useMemo, useRef, useState } from "react";
import { Button } from "antd";
import { Download, FileText, Film, Play } from "lucide-react";
import { message } from "antd";

import { remakeDuration, remakeTime } from "@/lib/remake/presentation";
import { remakeResultOffsets } from "@/lib/remake/shots";
import type { RemakeDetail, RemakeRun, RemakeShot } from "@/services/api/remakes";
import { getResourceAccess, resourceFileUrl, resourceStorageKey, resolveResourceAccessURL } from "@/services/api/resources";

import { WorkbenchShotStrip } from "./workbench-shot-strip";

async function downloadResource(resourceId: string, fileName: string) {
    const access = await getResourceAccess(resourceStorageKey(resourceId), "download", "original", fileName);
    const url = resolveResourceAccessURL(access.url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function downloadTextFile(text: string, fileName: string) {
    const blob = new Blob([text], { type: "application/x-subrip;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export type ExportStageProps = {
    detail: RemakeDetail;
    run: RemakeRun | null;
    shots: RemakeShot[];
    exportPending: boolean;
    canExport: boolean;
    onExport: () => void;
};

/** 阶段④ 成片：参考片/成片双播放器对照、按镜头映射定位、MP4 与 SRT 下载、导出历史。 */
export function WorkbenchExportStage({ detail, run, shots, exportPending, canExport, onExport }: ExportStageProps) {
    const sourceRef = useRef<HTMLVideoElement | null>(null);
    const resultRef = useRef<HTMLVideoElement | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [downloading, setDownloading] = useState(false);

    const analysis = detail.analysis;
    const aspect = analysis && analysis.width > 0 && analysis.height > 0 ? `${analysis.width} / ${analysis.height}` : undefined;
    const latestExport = run ? detail.exports.find((item) => item.runId === run.id) || detail.exports[0] : detail.exports[0];
    const offsets = useMemo(() => remakeResultOffsets(shots, run, detail.takes), [shots, run, detail.takes]);
    const videoReadyIds = useMemo(() => {
        const ready = new Set<string>();
        if (!run) return ready;
        for (const take of detail.takes) {
            if (take.runId === run.id && take.kind === "video") {
                const step = run.steps.find((item) => item.unitId === take.unitId);
                if (step?.shotId) ready.add(step.shotId);
            }
        }
        return ready;
    }, [detail.takes, run]);
    const playingShot = useMemo(() => shots.find((shot) => currentMs >= shot.sourceInMs && currentMs < shot.sourceOutMs) || null, [shots, currentMs]);

    const seekBoth = (index: number) => {
        const shot = shots[index];
        if (!shot) return;
        setSelectedId(shot.id);
        if (sourceRef.current) {
            sourceRef.current.currentTime = shot.sourceInMs / 1000;
            void sourceRef.current.play().catch(() => undefined);
        }
        if (resultRef.current && offsets[index] > 0) {
            resultRef.current.currentTime = offsets[index] / 1000;
        }
    };

    const onDownload = async () => {
        if (!latestExport) return;
        setDownloading(true);
        try {
            await downloadResource(latestExport.resourceId, `${detail.project.title || "复刻成片"}.mp4`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载地址读取失败");
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="rk-stage">
            <div className="rk-stage-scroll">
                <section className="rk-panel">
                    <div className="rk-panel-title">
                        <h2 className="rk-panel-heading">
                            <Film size={15} aria-hidden />
                            原片 / 成片对照
                        </h2>
                        {latestExport ? <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">成片 {remakeDuration(latestExport.durationMs)}</span> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div className="min-w-0">
                            <p className="mb-1.5 text-xs font-medium text-[var(--rk-text-muted)]">参考片</p>
                            <div className="rk-player" style={aspect ? { aspectRatio: aspect } : undefined}>
                                <video
                                    ref={sourceRef}
                                    className={!aspect ? "aspect-video" : undefined}
                                    src={resourceFileUrl(detail.project.sourceResourceId)}
                                    controls
                                    preload="metadata"
                                    crossOrigin="use-credentials"
                                    onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
                                />
                            </div>
                        </div>
                        <div className="min-w-0">
                            <p className="mb-1.5 text-xs font-medium text-[var(--rk-text-muted)]">当前成片</p>
                            {latestExport ? (
                                <div className="rk-player" style={aspect ? { aspectRatio: aspect } : undefined}>
                                    <video ref={resultRef} className={!aspect ? "aspect-video" : undefined} src={resourceFileUrl(latestExport.resourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                                </div>
                            ) : (
                                <div className="rk-player-empty">
                                    <Play className="size-6 opacity-50" aria-hidden />
                                    <span>等待所有镜头完成并合成</span>
                                    <span className="text-[var(--fs-label)]">成片按当前选用的候选镜头拼接</span>
                                </div>
                            )}
                        </div>
                    </div>
                    {shots.length ? (
                        <div className="mt-3">
                            <WorkbenchShotStrip shots={shots} selectedId={selectedId} playingId={playingShot?.id || null} videoReadyIds={videoReadyIds} onSelect={(_, index) => seekBoth(index)} ariaLabel="成片镜头映射条" />
                            <p className="mt-2 text-xs text-[var(--rk-text-muted)]">点击镜头块：参考片定位到镜头起点，成片定位到对应画面的估算位置；绿点表示该镜头已有视频产出。</p>
                        </div>
                    ) : null}
                </section>

                <section className="rk-panel">
                    <div className="rk-panel-title">
                        <h2 className="rk-panel-heading">导出与下载</h2>
                        {canExport ? (
                            <Button size="small" loading={exportPending} onClick={onExport}>
                                重新合成成片
                            </Button>
                        ) : null}
                    </div>
                    {latestExport ? (
                        <>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button type="primary" icon={<Download size={14} />} loading={downloading} onClick={onDownload}>
                                    下载 MP4
                                </Button>
                                {latestExport.subtitleSrt ? (
                                    <Button icon={<FileText size={14} />} onClick={() => downloadTextFile(latestExport.subtitleSrt, `${detail.project.title || "复刻成片"}.srt`)}>
                                        下载字幕 SRT
                                    </Button>
                                ) : null}
                            </div>
                            <ul className="mt-3 flex flex-col divide-y divide-[var(--rk-edge-soft)]">
                                {detail.exports.map((item) => (
                                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                                        <span className="tabular-nums text-[var(--rk-text-muted)]">
                                            {new Date(item.createdAt).toLocaleString("zh-CN")} · {remakeTime(item.durationMs)}
                                            {run && item.runId === run.id ? " · 当前运行" : ""}
                                        </span>
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 bg-transparent text-xs text-[var(--rk-accent)] hover:underline"
                                            onClick={() => {
                                                void downloadResource(item.resourceId, `${detail.project.title || "复刻成片"}-${item.id}.mp4`).catch((error: unknown) => message.error(error instanceof Error ? error.message : "下载地址读取失败"));
                                            }}
                                        >
                                            <Download size={12} aria-hidden />
                                            下载
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <p className="rk-panel-hint mt-2">还没有成片。完整运行（或所有镜头视频就绪后）会自动合成；也可以在上一次运行完成后点「重新合成成片」。</p>
                    )}
                </section>
            </div>
        </div>
    );
}
