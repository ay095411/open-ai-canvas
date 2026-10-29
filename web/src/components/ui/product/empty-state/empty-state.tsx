import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * EmptyState — 以标题、说明和操作为主的空态。
 *
 * 用途：列表/面板/画布无数据或零结果时的引导占位；替代 AntD Empty 的使用场景
 *   （搜索零结果、资源为空、列表为空等页面私有实现）。
 * 普通空态不显示默认图标。需要表达特定内容类型时可显式传入 lucide 组件，
 *   仅呈现小尺寸线条，不带圆形底板；尺寸与颜色由本组件控制。
 * token：标题 text-foreground、说明 text-muted-foreground、字号 fs-body/fs-caption。
 * 对标：AntD Empty；形态参考 BoardUI empty-state。
 * 明暗：全部颜色走 token，明暗双主题自动适配。
 */
export const emptyStateVariants = cva("flex flex-col items-center justify-center text-center", {
    variants: {
        size: {
            default: "gap-2 py-12",
            compact: "gap-2 py-6",
        },
    },
    defaultVariants: {
        size: "default",
    },
});

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof emptyStateVariants> & {
        /** 可选的内容类型图标；普通空态无需提供 */
        icon?: LucideIcon;
        title?: ReactNode;
        description?: ReactNode;
        /** 操作区（按钮/链接等），非必须 */
        action?: ReactNode;
    };

export function EmptyState({ size, icon: Icon, title, description, action, className, ...props }: EmptyStateProps) {
    return (
        <div data-slot="empty-state" className={cn(emptyStateVariants({ size }), className)} {...props}>
            {Icon ? <Icon aria-hidden className="mb-1 size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} /> : null}
            {title != null ? <p className="empty-state-title">{title}</p> : null}
            {description != null ? <p className="empty-state-description max-w-sm">{description}</p> : null}
            {action != null ? <div className="mt-3">{action}</div> : null}
        </div>
    );
}
