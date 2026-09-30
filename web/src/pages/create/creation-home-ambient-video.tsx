import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/**
 * 首页舞台的氛围底片。
 *
 * 素材是一段暖白雾气的湖景（1280×720，15s，已去除音轨并做 faststart），
 * 只覆盖「标题 → 模式胶囊」这一段，不做全屏背景 —— 它的作用是把首屏的
 * 纯色留白变成会缓慢呼吸的雾，而不是让用户意识到「这里有个视频」。
 *
 * 三条硬约束（用户明确要求）：静音、无控件、看不出是个矩形。
 *  - 静音：muted 属性 + 素材本身无音轨，两道都上；
 *  - 无控件：不渲染 controls / 不响应指针（pointer-events: none），
 *    并关掉画中画与右键菜单，避免出现任何播放器外壳；
 *  - 看不出边界：由 CSS 的纵横两层遮罩 + 页面底色薄纱完成（见 globals.css
 *    的 .creation-home-ambient 一段），这里只负责给对元素。
 */
const AMBIENT_VIDEO_SRC = "/create/hero-ambient.mp4";
const AMBIENT_POSTER_SRC = "/create/hero-ambient-poster.jpg";

export function CreationHomeAmbientVideo() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const reducedMotion = useReducedMotion();

    // 不用 autoPlay 属性，而是显式 play()：这样「降低动态效果」的用户不会被
    // 自动播放劫持 —— poster 本身就是一张同色调的静态雾景，停下来同样成立。
    // 播放被策略拦截时静默忽略，保留 poster。
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (reducedMotion) {
            video.pause();
            return;
        }
        const play = () => { void video.play().catch(() => { }); };
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) play();
        else video.addEventListener("loadeddata", play, { once: true });
        return () => video.removeEventListener("loadeddata", play);
    }, [reducedMotion]);

    // 舞台滚出视口后暂停：这段视频是循环的，不暂停就会在用户翻到快捷入口、
    // 灵感作品时一直解码，白烧 CPU / 电量。
    useEffect(() => {
        const video = videoRef.current;
        if (!video || reducedMotion) return;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) void video.play().catch(() => { });
                else video.pause();
            }
        }, { threshold: 0 });
        observer.observe(video);
        return () => observer.disconnect();
    }, [reducedMotion]);

    return <div className="creation-home-ambient" aria-hidden="true">
        <video
            ref={videoRef}
            className="creation-home-ambient-video"
            src={AMBIENT_VIDEO_SRC}
            poster={AMBIENT_POSTER_SRC}
            muted
            loop
            playsInline
            preload="auto"
            controls={false}
            disablePictureInPicture
            tabIndex={-1}
            onContextMenu={(event) => event.preventDefault()}
        />
        <span className="creation-home-ambient-veil" />
    </div>;
}
