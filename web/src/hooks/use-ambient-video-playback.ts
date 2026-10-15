import { useEffect, useRef } from "react";

/**
 * 循环氛围视频的播放生命周期。
 *
 * 静音、无控件的循环视频要在两处出现（首页大卡底片、旧的舞台底片），
 * 规则一致，所以抽到这里，避免两份「play / pause + 视口暂停」逻辑各自漂移：
 *
 *  1. 不用 autoPlay 属性而是显式 play()：开启「降低动态效果」的用户不被自动播放劫持，
 *     停在 poster 上也成立（poster 与视频同色调）。播放被策略拦截时静默忽略。
 *  2. 滚出视口就暂停：这类视频是循环的，不暂停会在用户往下浏览时一直解码，白烧 CPU / 电量。
 *
 * 返回值直接挂到 <video ref> 上；其余属性（muted / loop / playsInline / poster）
 * 由调用方写在 JSX 里，这里不代管。
 */
export function useAmbientVideoPlayback(reducedMotion: boolean) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (reducedMotion) {
            video.pause();
            return;
        }
        const play = () => {
            void video.play().catch(() => {});
        };
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) play();
        else video.addEventListener("loadeddata", play, { once: true });
        return () => video.removeEventListener("loadeddata", play);
    }, [reducedMotion]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || reducedMotion) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) void video.play().catch(() => {});
                    else video.pause();
                }
            },
            { threshold: 0 },
        );
        observer.observe(video);
        return () => observer.disconnect();
    }, [reducedMotion]);

    return videoRef;
}
