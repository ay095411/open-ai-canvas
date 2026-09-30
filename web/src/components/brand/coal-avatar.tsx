import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * 用户默认头像：品牌角色「黑煤球」。
 *
 * 与创作模式切换里的 `.creation-mode-coal` 是同一张脸，但**不共用实现**：
 * 那一版是「扶住激活胶囊」的交互态（手扶胶囊、眼睛跟随指针、切换时落地回弹，
 * 几何全部挂在 `--creation-tab-*` 的测量值上），而头像要在 24~44px 任意尺寸下
 * 独立自洽。因此这里用一块单文件 SVG 重画，比例沿用参考稿原型（记身位直径 D）：
 *
 *   viewBox 48×48；球心 (22.5, 25)、半径 17（即 D = 34），球左上角在 (5.5, 8)
 *   眼心横坐标 = 球左缘 + 0.3017D / 0.6121D，纵坐标 = 球顶 + 0.4655D
 *   眼半轴 = 0.0603D × 0.0862D         → 眼距 = 0.3103D
 *   嘴：左起 0.3793D、上缘 0.6552D、宽 0.1207D、高 0.069D
 *   眼睛**没有瞳孔**，整张脸基本居中（脸心比球心偏左 0.043D）
 *
 * ⚠️ 这三个数字曾经是错的，2026-09-29 随 tab 一起重新标定：早先版本把眼睛钳在
 * 0.4475D / 0.7475D（脸心偏右 0.1D）并给眼睛加了瞳孔 —— 那组值是从低分辨率的
 * 效果图里估出来的，与参考稿原型（`navoai_tab_v3_click_only.html`）实跑出来的
 * 位置差 0.14D，脸看起来是歪的；加了瞳孔之后跟随指针时整颗眼白会一起滑，也读不出
 * 「瞟一眼」。原型里眼睛就是两颗纯色奶油椭圆，位移时整体轻移 2px。
 *
 * 形状在 viewBox 内留有约 11% 内边距：一来小尺寸下不至于顶满容器，二来深色主题里
 * 容器自身的浅色底能透出来充当煤球的衬底（近黑的球落在近黑的页面上会糊在一起）。
 *
 * 尺寸恒由容器决定（SVG 永远 100%），所以用 inline style 而不是 class ——
 * 仓库里存在 `.xxx svg { width: 18px }` 这类祖先选择器（如侧栏账户头像），
 * 走 class 会被它们按特异性/级联层压住。
 */
export function CoalAvatar({ className }: { className?: string }) {
    const gradientId = `coal-avatar-body-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    return (
        <svg
            className={cn(className)}
            viewBox="0 0 48 48"
            aria-hidden="true"
            focusable="false"
            style={{ display: "block", width: "100%", height: "100%" }}
        >
            <defs>
                <radialGradient id={gradientId} cx="34%" cy="25%" r="76%">
                    <stop offset="0%" stopColor="#505159" />
                    <stop offset="22%" stopColor="#2b2d33" />
                    <stop offset="64%" stopColor="#15161a" />
                    <stop offset="100%" stopColor="#08090b" />
                </radialGradient>
            </defs>
            {/* 轮廓线与线宽一律走 inline style：SVG 的 presentation attribute（stroke-width="1"）
                优先级低于任何 CSS 规则，而仓库里 `.workspace-account-card svg { stroke-width: 1.7 }`
                这类祖先选择器会连带改到这块图 —— 头像恰好就落在该卡片里。
                `width/height: 100%`（见上方 style）同理。 */}
            {/* 轮廓线：煤球本体是近黑渐变，落在深色主题的深色底上会糊掉。
                白色描边在浅底上等于隐形（浅灰底 + 白描边看不出），所以可以放心给足 ——
                实测 0.18 深度仍然分不出边界，0.34 才立得住。 */}
            <circle cx="22.5" cy="25" r="17" fill={`url(#${gradientId})`} stroke="rgb(255 255 255 / .34)" style={{ strokeWidth: 1.5 }} />
            {/* 眼睛：纯色奶油椭圆，没有瞳孔（原型如此，小尺寸下也更清楚）。 */}
            <ellipse cx="15.76" cy="23.83" rx="2.05" ry="2.93" fill="#f4f0df" />
            <ellipse cx="26.31" cy="23.83" rx="2.05" ry="2.93" fill="#f4f0df" />
            {/* 嘴只有下缘一道弧，原稿是 border-bottom + 圆角。 */}
            <path d="M18.4 30.9q2.05 2.2 4.1 0" fill="none" stroke="#f4f0df" strokeLinecap="round" opacity=".9" style={{ strokeWidth: 1.5 }} />
            {/* 兴奋星：tab 里是球右上外侧一颗 5×5 的圆点，这里改成四角星 ——
                圆点缩到 24px 头像只剩 1.5px，会糊成一个脏点，四角星还有形状可读。
                这是全图唯一一处有意偏离原型的细节。 */}
            <path d="M41 7.5c.6 2.4 1.6 3.4 4 4-2.4.6-3.4 1.6-4 4-.6-2.4-1.6-3.4-4-4 2.4-.6 3.4-1.6 4-4Z" fill="#8b77ff" />
        </svg>
    );
}
