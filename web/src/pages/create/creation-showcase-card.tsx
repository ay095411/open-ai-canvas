import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ImageOff, Play } from "lucide-react";

import { inspirationCoverRatio } from "@/lib/inspirations/masonry";
import { zzaiCategoryLabel } from "@/lib/inspirations/zzai-gallery";
import { InspirationAuthorizationNotice } from "@/pages/inspirations/inspiration-authorization-notice";
import type { InspirationGallerySummary } from "@/services/api/online-gallery";

/** 封面常驻；只有用户仍在预览且媒体实际播放时才显示视频。 */
export function CreationShowcaseCard({ entry, onPreview, disabled, reducedMotion }: { entry: InspirationGallerySummary; onPreview: () => void; disabled: boolean; reducedMotion: boolean }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const previewRequested = useRef(false);
    const playAttempt = useRef(0);
    const failedVideo = useRef<string | null>(null);
    const [playing, setPlaying] = useState(false);
    const [failedPoster, setFailedPoster] = useState<string | null>(null);
    const videoUrl = entry.mode === "video" ? entry.videoUrl : undefined;
    const metadata = [entry.mode === "video" ? "视频" : "图片", zzaiCategoryLabel(entry.category), entry.model].filter(Boolean).join(" · ");

    const stop = useCallback(() => {
        previewRequested.current = false;
        playAttempt.current += 1;
        setPlaying(false);
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    }, []);

    useEffect(() => {
        if (disabled || reducedMotion) stop();
    }, [disabled, reducedMotion, stop]);

    useEffect(() => {
        const video = videoRef.current;
        stop();
        return () => {
            previewRequested.current = false;
            playAttempt.current += 1;
            video?.pause();
        };
    }, [videoUrl, stop]);

    const start = () => {
        const video = videoRef.current;
        if (!video || disabled || reducedMotion || failedVideo.current === videoUrl || previewRequested.current) return;
        previewRequested.current = true;
        const attempt = ++playAttempt.current;
        video.currentTime = 0;
        void video.play().catch(() => {
            // 自动播放被拦或请求被暂停时保留封面，不影响详情入口。
            if (playAttempt.current === attempt) stop();
        });
    };

    return (
        <div className="creation-showcase-item">
            <button
                type="button"
                className="creation-showcase-card"
                aria-label={`预览灵感：${entry.title}`}
                disabled={disabled}
                onClick={onPreview}
                onPointerEnter={(event) => {
                    if (event.pointerType !== "touch") start();
                }}
                onPointerLeave={stop}
                onFocus={start}
                onBlur={stop}
            >
                <span className="creation-showcase-cover" style={{ aspectRatio: inspirationCoverRatio(entry) }}>
                    {failedPoster === entry.image ? (
                        <span className="creation-showcase-unavailable">
                            <ImageOff size={22} aria-hidden="true" />
                            封面暂不可用
                        </span>
                    ) : (
                        <img src={entry.image} alt="" width={entry.width} height={entry.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailedPoster(entry.image)} />
                    )}
                    {videoUrl ? (
                        <video
                            ref={videoRef}
                            className="creation-showcase-video"
                            data-playing={playing}
                            src={videoUrl}
                            muted
                            loop
                            playsInline
                            preload="none"
                            aria-hidden="true"
                            tabIndex={-1}
                            onPlaying={() => {
                                if (!previewRequested.current || disabled || reducedMotion) {
                                    stop();
                                    return;
                                }
                                setPlaying(true);
                            }}
                            onPause={() => setPlaying(false)}
                            onError={() => {
                                failedVideo.current = videoUrl;
                                stop();
                            }}
                        />
                    ) : null}
                    {entry.mode === "video" ? (
                        <span className="creation-showcase-badge">
                            <Play size={11} aria-hidden="true" />
                            示例片段
                        </span>
                    ) : null}
                    <span className="creation-showcase-preview-hint" aria-hidden="true">
                        查看提示词 <ArrowUpRight size={14} />
                    </span>
                </span>
                <span className="creation-showcase-copy">
                    <strong title={entry.title}>{entry.title}</strong>
                    <span title={metadata}>{metadata}</span>
                </span>
            </button>
            <InspirationAuthorizationNotice item={entry} />
        </div>
    );
}
