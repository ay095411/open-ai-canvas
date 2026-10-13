import type { ReactNode } from "react";

type SidebarIconProps = { className?: string; strokeWidth?: number };

function IconFrame({ children, className, strokeWidth = 1.8 }: SidebarIconProps & { children: ReactNode }) {
    return (
        <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

export function CreateNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="m4 19 4.7-.9 9.1-9.1-2.8-2.8-9.1 9.1L4 19Z" />
        <path d="m12.8 8.4 2.8 2.8M18.5 2.5v3M17 4h3" />
    </IconFrame>;
}

export function InspirationNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="M8.5 15.5c-.5-1.7-2.7-2.9-2.7-5.6a6.2 6.2 0 0 1 12.4 0c0 2.7-2.2 3.9-2.7 5.6" />
        <path d="M9 18h6m-5 3h4m-2-14v5m-2.5-2.5h5" />
    </IconFrame>;
}

export function ProjectNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M7 4v16m10-16v16M3 9h4m10 0h4M3 15h4m10 0h4" />
        <path d="M10 9v6l4-3-4-3Z" />
    </IconFrame>;
}

export function CanvasNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3" />
        <path d="M7 15c3-6 6 1 10-6" />
        <circle cx="7" cy="15" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="17" cy="9" r="1.25" fill="currentColor" stroke="none" />
    </IconFrame>;
}

export function AssetsNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="M7 5h12a2 2 0 0 1 2 2v9M5 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
        <circle cx="8" cy="12" r="1" />
        <path d="m4 18 4.5-3.5 2.5 2 3-3 4 4" />
    </IconFrame>;
}

export function SkillsNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z" />
        <path d="m12 7 .9 3.1L16 11l-3.1.9L12 15l-.9-3.1L8 11l3.1-.9L12 7Z" />
    </IconFrame>;
}

export function PluginsNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="M8 3v4m8-4v4M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4M9 11h6" />
    </IconFrame>;
}

export function HistoryNavIcon(props: SidebarIconProps) {
    return <IconFrame {...props}>
        <path d="M4 8a8 8 0 1 1-1 6M4 4v4h4" />
        <path d="m11 8 4 4-4 4V8Z" />
    </IconFrame>;
}
