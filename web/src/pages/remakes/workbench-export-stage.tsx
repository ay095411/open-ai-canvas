import { useMemo, useRef, useState } from "react";
import { Button, message } from "antd";
import { Download, FileText, Film, Play, RefreshCw } from "lucide-react";

import { isRemakeRunActive, remakeCredits, remakeDuration, remakeTime } from "@/lib/remake/presentation";
import { remakeResultOffsets } from "@/lib/remake/shots";
import type { RemakeDetail, RemakeRun, RemakeShot } from "@/services/api/remakes";
import { getResourceAccess, resourceFileUrl, resourceStorageKey, resolveResourceAccessURL } from "@/services/api/resources";

import { RemakeDisclosure } from "./remake-settings-fields";
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

/** 阶段④ 导出成片：标题行即下载入口；原片 / 成片并排对照；历史版本默认收起。 */
export function WorkbenchExportStage({ detail, run, shots, exportPending, canExport, onExport }: ExportStageProps) {
    const sourceRef = useRef<HTMLVideoElement | null>(null);
    const resultRef = useRef<HTMLVideoElement | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [currentMs, setCurrentMs] = useState(0);
    const [downloading, setDownloading] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

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
    const projectTitle = detail.project.title || "复刻成片";

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
            await downloadResource(latestExport.resourceId, `${projectTitle}.mp4`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载地址读取失败");
        } finally {
            setDownloading(false);
        }
    };

    const meta = [latestExport ? `时长 ${remakeDuration(latestExport.durationMs)}` : "", run && run.spentMicrocredits > 0 ? `本次消耗 ${remakeCredits(run.spentMicrocredits)} 积分` : ""].filter(Boolean).join(" · ");

    return (
        <div className="rk-stage">
            <div className="rk-stage-scroll">
                <section className="rk-panel">
                    <div className="rk-export-head">
                        <div className="min-w-0">
                            <h2 className="rk-panel-heading">
                                <Film size={16} aria-hidden />
                                成片
                            </h2>
                            {meta ? <p className="rk-caption mt-1">{meta}</p> : null}
                        </div>
                        {latestExport ? (
                            <div className="rk-export-actions">
                                {canExport ? (
                                    <Button type="text" icon={<RefreshCw size={14} />} loading={exportPending} onClick={onExport}>
                                        重新合成
                                    </Button>
                                ) : null}
                                {latestExport.subtitleSrt ? (
                                    <Button icon={<FileText size={14} />} onClick={() => downloadTextFile(latestExport.subtitleSrt, `${projectTitle}.srt`)}>
                                        字幕 SRT
                                    </Button>
                                ) : null}
                                <Button type="primary" size="large" icon={<Download size={15} />} loading={downloading} onClick={onDownload}>
                                    下载 MP4
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    <div className="rk-export-compare">
                        <figure className="rk-export-figure">
                            <figcaption>参考片</figcaption>
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
                        </figure>
                        <figure className="rk-export-figure">
                            <figcaption>成片</figcaption>
                            {latestExport ? (
                                <div className="rk-player" style={aspect ? { aspectRatio: aspect } : undefined}>
                                    <video ref={resultRef} className={!aspect ? "aspect-video" : undefined} src={resourceFileUrl(latestExport.resourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                                </div>
                            ) : (
                                <div className="rk-player-empty">
                                    <Play className="size-6 opacity-50" aria-hidden />
                                    {canExport ? (
                                        <>
                                            <span>镜头视频已就绪</span>
                                            <Button type="primary" loading={exportPending} onClick={onExport}>
                                                合成成片
                                            </Button>
                                        </>
                                    ) : (
                                        <span>{isRemakeRunActive(run) ? "镜头视频生成中，完成后自动合成" : "所有镜头视频完成后自动合成"}</span>
                                    )}
                                </div>
                            )}
                        </figure>
                    </div>

                    {shots.length ? (
                        <div className="mt-5">
                            <WorkbenchShotStrip shots={shots} selectedId={selectedId} playingId={playingShot?.id || null} videoReadyIds={videoReadyIds} onSelect={(_, index) => seekBoth(index)} ariaLabel="成片镜头映射条" />
                            <p className="rk-caption mt-2">点击镜头，两侧同时定位；绿点表示已有视频。</p>
                        </div>
                    ) : null}

                    {detail.exports.length > 1 ? (
                        <RemakeDisclosure className="rk-export-history" variant="inline" title={`历史版本（${detail.exports.length}）`} open={historyOpen} onToggle={() => setHistoryOpen((open) => !open)}>
                            <ul className="rk-export-list">
                                {detail.exports.map((item) => (
                                    <li key={item.id}>
                                        <span className="tabular-nums">
                                            {new Date(item.createdAt).toLocaleString("zh-CN")} · {remakeTime(item.durationMs)}
                                            {run && item.runId === run.id ? " · 当前运行" : ""}
                                        </span>
                                        <button
                                            type="button"
                                            className="remake-link inline-flex items-center gap-1"
                                            onClick={() => {
                                                void downloadResource(item.resourceId, `${projectTitle}-${item.id}.mp4`).catch((error: unknown) => message.error(error instanceof Error ? error.message : "下载地址读取失败"));
                                            }}
                                        >
                                            <Download size={12} aria-hidden />
                                            下载
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </RemakeDisclosure>
                    ) : null}
                </section>
            </div>
        </div>
    );
}
