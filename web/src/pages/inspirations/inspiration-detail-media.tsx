import { useState } from "react";
import { Button } from "antd";

import type { CreationInspiration } from "@/lib/inspirations/catalog";

type MediaItem = Pick<CreationInspiration, "title" | "image" | "width" | "height" | "mode" | "sourceUrl">;

function videoFailure(error: MediaError | null): string {
    const reason = error?.code === 1 ? "媒体请求已中止" : error?.code === 2 ? "网络读取失败" : error?.code === 3 ? "浏览器无法解码视频" : error?.code === 4 ? "视频地址或格式不可用" : "浏览器未能加载视频";
    return `视频加载失败：${reason}${error?.code ? `（错误码 ${error.code}）` : ""}。`;
}

/** Public video links remain optional; a media error never removes the prompt or its source. */
export function InspirationDetailMedia({ item, videoUrl }: { item: MediaItem; videoUrl?: string }) {
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    return (
        <div className="inspiration-detail-media" style={{ flexDirection: "column", gap: "var(--space-3)" }}>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                {videoUrl && !error ? (
                    <video key={attempt} src={videoUrl} poster={item.image} controls playsInline preload="metadata" aria-label={`视频示例：${item.title}`} onError={(event) => setError(videoFailure(event.currentTarget.error))} />
                ) : (
                    <img src={item.image} alt={item.title} width={item.width} height={item.height} referrerPolicy="no-referrer" />
                )}
            </div>
            {error ? (
                <div className="flex shrink-0 flex-col items-center gap-2 text-center text-xs leading-5 text-muted-foreground">
                    <p role="alert">{error}</p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Button
                            size="small"
                            onClick={() => {
                                setError(null);
                                setAttempt((previous) => previous + 1);
                            }}
                        >
                            重新加载视频
                        </Button>
                    </div>
                    {item.sourceUrl ? <p>原始出处请查看右侧“原页”。</p> : null}
                </div>
            ) : item.mode === "video" && !videoUrl ? (
                <div className="flex shrink-0 flex-col items-center gap-2 text-center text-xs leading-5 text-muted-foreground">
                    <p role="status">此条目仅提供封面和提示词，未提供可播放的视频地址。</p>
                    {item.sourceUrl ? <p>原始出处请查看右侧“原页”。</p> : null}
                </div>
            ) : null}
        </div>
    );
}
