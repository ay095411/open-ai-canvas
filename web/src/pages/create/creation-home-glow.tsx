import "./creation-home-glow.css";

/**
 * 创作首页的氛围光层。
 *
 * 参考站（PiXTV 那一类）的首页是**恒定深色舞台**：底色接近纯黑，视觉冲击来自一层很淡、
 * 位置偏上的柔光，而不是图片或动效。这里只做这件事 —— 纯 CSS 渐变，没有视频、没有动画、
 * 没有 canvas，所以既不耗电也不会在低端设备上掉帧。
 *
 * 只负责渲染；几何与配色在 `creation-home-glow.css` 里，颜色走 `--creation-glow-*`
 * 两个 token，改观感不用动这个文件。
 *
 * ⚠️ 首页的深色不跟随工作台主题（见 globals.css 里 `is-creation-workspace` 的 token 覆盖）：
 * 参考站就是这么做的，浅色主题下把这块舞台变白会让它失去主体性。
 */
export function CreationHomeGlow() {
    return <div className="creation-home-glow" aria-hidden="true" />;
}
