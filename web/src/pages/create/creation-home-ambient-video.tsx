import { useReducedMotion } from "motion/react";

import { useAmbientVideoPlayback } from "@/hooks/use-ambient-video-playback";

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
 *
 * 播放 / 视口暂停的生命周期在 `useAmbientVideoPlayback` 里，与大卡底片共用。
 */
const AMBIENT_VIDEO_SRC = "/create/hero-ambient.mp4";
const AMBIENT_POSTER_SRC = "/create/hero-ambient-poster.jpg";

export function CreationHomeAmbientVideo() {
    const reducedMotion = useReducedMotion();
    const videoRef = useAmbientVideoPlayback(Boolean(reducedMotion));

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
