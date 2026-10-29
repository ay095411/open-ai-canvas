import { CircleAlert, ClipboardList, FolderOpen, House, Image, Layers, LoaderCircle, Search, Settings2, SquarePen, Wallet, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type WorkspaceSignalIconVariant = "home" | "canvas" | "projects" | "assets" | "skills" | "tasks" | "wallet" | "settings" | "empty" | "error" | "loading";

const signalIcons: Record<WorkspaceSignalIconVariant, LucideIcon> = {
    home: House,
    canvas: SquarePen,
    projects: FolderOpen,
    assets: Image,
    skills: Layers,
    tasks: ClipboardList,
    wallet: Wallet,
    settings: Settings2,
    empty: Search,
    error: CircleAlert,
    loading: LoaderCircle,
};

/** 状态标记只保留语义线条；普通列表空态由 WorkspaceState 直接呈现文案。 */
export function WorkspaceSignalIcon({ variant, size = "md", className }: { variant: WorkspaceSignalIconVariant; size?: "sm" | "md" | "lg"; className?: string }) {
    const Icon = signalIcons[variant];

    return (
        <span
            className={cn("workspace-signal-icon grid shrink-0 place-items-center text-muted-foreground", size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5", className)}
            aria-hidden="true"
        >
            <Icon className={cn("size-full", variant === "loading" && "motion-safe:animate-spin")} strokeWidth={1.75} />
        </span>
    );
}
