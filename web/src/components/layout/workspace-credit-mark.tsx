import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * 可用积分的产品标记：一枚正面金币。
 *
 * 图形在 32×32 视口里以 (16,16) 为圆心画成上下左右对称：图标中心与行高中心重合，
 * 放进顶栏胶囊、账户卡或画布顶栏时不需要再靠 transform 补偿视觉重心。
 */
export function WorkspaceCreditMark({ className }: { className?: string }) {
    const uid = useId().replace(/:/g, "");
    const face = `${uid}-face`;
    const rim = `${uid}-rim`;

    return (
        <span className={cn("app-workspace-credit-mark", className)} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
                <defs>
                    <linearGradient id={face} x1="8" y1="7" x2="24" y2="26" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#FFD772" />
                        <stop offset=".55" stopColor="#FBB03B" />
                        <stop offset="1" stopColor="#F08A12" />
                    </linearGradient>
                    <linearGradient id={rim} x1="10" y1="6" x2="22" y2="27" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#FFEAB0" />
                        <stop offset="1" stopColor="#E07E09" />
                    </linearGradient>
                </defs>
                <circle cx="16" cy="16" r="11" fill={`url(#${face})`} />
                <circle cx="16" cy="16" r="11" stroke={`url(#${rim})`} strokeWidth="1.4" />
                <circle cx="16" cy="16" r="8.4" stroke="#FFF4CE" strokeOpacity=".46" strokeWidth="1.2" />
                <path d="M16 11C16.7 14 18 15.3 21 16 18 16.7 16.7 18 16 21 15.3 18 14 16.7 11 16 14 15.3 15.3 14 16 11Z" fill="#FFF7DC" />
            </svg>
        </span>
    );
}
