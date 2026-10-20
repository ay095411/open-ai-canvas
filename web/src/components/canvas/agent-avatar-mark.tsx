import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Agent 默认形象：品牌 N 徽标。
 *
 * 取代原来的 FluidOrb（WebGL 着色器 + 常驻 rAF）：画布本身已有一个持续渲染的上下文，
 * 悬浮入口再挂一个 shader 循环会白烧 GPU。这里用纯 SVG 画品牌字形——
 * 一条圆头「N」波纹 + 左下、右上两个点，取自 /logo 的同一套蓝→紫渐变。
 *
 * 组件不依赖外部 CSS，自带尺寸；容器（悬浮球的毛玻璃圆底、后台预览框）负责背景与阴影。
 */
export function AgentAvatarMark({ size = 56, className }: { size?: number; className?: string }) {
    const uid = useId().replace(/:/g, "");
    const stroke = `${uid}-stroke`;

    return (
        <svg
            className={cn("agent-avatar-mark block shrink-0", className)}
            width={size}
            height={size}
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id={stroke} x1="12" y1="44" x2="54" y2="15" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#2D7BF4" />
                    <stop offset=".55" stopColor="#5C66F7" />
                    <stop offset="1" stopColor="#8A5CF6" />
                </linearGradient>
            </defs>
            {/* 圆头粗描边的 N 形波纹：起笔左下、顶峰偏左、谷底偏右，收笔右上。
                两个点分别落在起笔的左下与收笔的右上，与描边留出 2 个以上单位的空隙，
                避免小尺寸下和笔画黏成一团。 */}
            <path
                d="M14 36C14 26 19.5 18 27.5 17.5C35 17 38.5 23.5 40.5 29.5C42.5 35.5 47 35.5 52 28.5"
                stroke={`url(#${stroke})`}
                strokeWidth="10.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="10" cy="48.5" r="4.6" fill="#2D7BF4" />
            <circle cx="53.5" cy="14.5" r="5" fill="#8A5CF6" />
        </svg>
    );
}
