import type { ReactNode } from "react";

type SidebarIconProps = { className?: string; strokeWidth?: number };

function IconFrame({ children, className, strokeWidth = 1.8 }: SidebarIconProps & { children: ReactNode }) {
    return (
        <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

/** 创作（对话与灵感首页）：星芒魔棒 */
export function CreateNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M9.9 3.6 11.4 8l4.4 1.5-4.4 1.5-1.5 4.4-1.5-4.4L4 9.5 8.4 8l1.5-4.4Z" />
            <path d="m17.5 13.5.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
        </IconFrame>
    );
}

/** 灵感：灯泡星芒 */
export function InspirationNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M8.5 15.5c-.5-1.7-2.7-2.9-2.7-5.6a6.2 6.2 0 0 1 12.4 0c0 2.7-2.2 3.9-2.7 5.6" />
            <path d="M9 18h6m-5 3h4m-2-14v5m-2.5-2.5h5" />
        </IconFrame>
    );
}

/** 生成工坊（图片/视频生成）：取景画框 + 镜头播放徽标 */
export function ToolboxNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <rect x="3" y="4" width="14" height="14" rx="3" />
            <circle cx="7.5" cy="8.5" r="1.25" />
            <path d="m3.5 15 3.8-3.5 2.7 2.2 2.5-2.2 4 3.5" />
            <rect x="13" y="12" width="8" height="8" rx="2.2" fill="var(--workspace-sidebar-bg, currentColor)" fillOpacity="0.12" />
            <path d="m16 14.5 2.8 1.5-2.8 1.5v-3Z" fill="currentColor" stroke="none" />
        </IconFrame>
    );
}

/** 自由画布：互联节点工作流 */
export function CanvasNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <rect x="3" y="3.5" width="7" height="7" rx="2" />
            <rect x="14" y="13.5" width="7" height="7" rx="2" />
            <circle cx="17.5" cy="6.5" r="2.5" />
            <circle cx="6.5" cy="17.5" r="2.5" />
            <path d="M10 7h4.5M9 17.5h5M6.5 10.5v4.5" />
        </IconFrame>
    );
}

/** 短剧 Agent：影视场记板 */
export function ProjectNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z" />
            <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4H4V7Z" />
            <path d="m8 5 2.5 6M14 5l2.5 6" />
            <path d="m10.5 14 4 2.2-4 2.3V14Z" fill="currentColor" stroke="none" />
        </IconFrame>
    );
}

/** 资产：层叠媒体画册 */
export function AssetsNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M7 4h11a2.5 2.5 0 0 1 2.5 2.5v10" />
            <rect x="3.5" y="7.5" width="13.5" height="12.5" rx="2.5" />
            <circle cx="8" cy="12" r="1.2" />
            <path d="m4.5 17.5 3.8-3.2 2.4 2 2.6-2.5 3.2 3.7" />
        </IconFrame>
    );
}

/** 创作历史：时钟回溯 */
export function HistoryNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M3.5 12a8.5 8.5 0 1 0 2.3-5.8L3.5 8.5" />
            <path d="M3.5 4v4.5H8" />
            <path d="M12 7.5v4.8l3.2 2" />
        </IconFrame>
    );
}

/** Skills：六边形星芒核心 */
export function SkillsNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <path d="M12 2.8 19.5 7v10L12 21.2 4.5 17V7L12 2.8Z" />
            <path d="m12 7.2 1.1 3.3 3.3 1.1-3.3 1.1L12 16l-1.1-3.3-3.3-1.1 3.3-1.1L12 7.2Z" />
        </IconFrame>
    );
}

/** 插件：模块化扩展积木 */
export function PluginsNavIcon(props: SidebarIconProps) {
    return (
        <IconFrame {...props}>
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
            <path d="M17 3.5v7M13.5 7h7" />
        </IconFrame>
    );
}
