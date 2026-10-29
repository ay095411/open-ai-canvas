import { Button, Skeleton } from "antd";
import { CircleAlert, LoaderCircle, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceSignalIconVariant } from "@/components/ui/aceternity/workspace-signal-icon";
import { cn } from "@/lib/utils";

/**
 * 空态四种场景各有固定的文案结构与操作，页面不要再各自拼一套：
 * - first-use：说明这里会放什么 + 一个主按钮（可再加一个次要链接或 2–3 个示例模板）。
 * - no-results：显示用户搜了什么 + 「清除筛选」。用 WorkspaceNoResultsState。
 * - error：说明加载失败 + 重试。用 WorkspaceErrorState。
 * - forbidden：说明没有权限 + 返回或申请入口。用 WorkspaceForbiddenState。
 *
 * 版式：页面级空态落在内容区约 40% 高度处（上 2 份、下 3 份留白），大屏上不显得偏低；
 * compact 用于面板、抽屉内的局部空态，保持居中。普通空态以文案和操作为主，
 * 仅错误、权限和加载状态保留有明确含义的图标，不为缺少内容添加装饰底板。
 */
export type WorkspaceStateKind = "first-use" | "no-results" | "error" | "forbidden";

export function WorkspaceState({
    icon = "empty",
    kind = "first-use",
    title,
    description,
    action,
    secondaryAction,
    compact = false,
    className,
}: {
    icon?: WorkspaceSignalIconVariant;
    kind?: WorkspaceStateKind;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    secondaryAction?: ReactNode;
    compact?: boolean;
    className?: string;
}) {
    const isError = kind === "error" || icon === "error";
    const isLoading = icon === "loading";
    const StatusIcon = isError ? CircleAlert : kind === "forbidden" ? LockKeyhole : isLoading ? LoaderCircle : null;

    return (
        <section
            data-kind={kind}
            role={isError ? "alert" : isLoading ? "status" : undefined}
            aria-busy={isLoading || undefined}
            className={cn(
                "workspace-state grid w-full justify-items-center text-center",
                compact ? "min-h-44 content-center py-8" : "min-h-[360px] grid-rows-[2fr_auto_3fr] py-12",
                className,
            )}
        >
            {compact ? null : <span aria-hidden />}
            <div className="workspace-state-copy flex w-full max-w-[48ch] flex-col items-center px-4">
                {StatusIcon ? <StatusIcon aria-hidden className={cn("mb-3 size-5 text-muted-foreground", isLoading && "motion-safe:animate-spin")} strokeWidth={1.75} /> : null}
                <h2 className={cn("workspace-state-title", compact && "is-compact")}>{title}</h2>
                {description ? <p className="workspace-state-description">{description}</p> : null}
                {action || secondaryAction ? (
                    <div className="workspace-state-actions mt-5 flex flex-wrap items-center justify-center gap-3">
                        {action}
                        {secondaryAction}
                    </div>
                ) : null}
            </div>
            {compact ? null : <span aria-hidden />}
        </section>
    );
}

/** 搜索或筛选无结果：回显关键词，提供「清除筛选」。 */
export function WorkspaceNoResultsState({
    query,
    onClear,
    icon = "empty",
    title,
    description,
    clearLabel = "清除筛选",
    compact = false,
}: {
    query?: string;
    onClear?: () => void;
    icon?: WorkspaceSignalIconVariant;
    title?: string;
    description?: ReactNode;
    clearLabel?: string;
    compact?: boolean;
}) {
    const keyword = query?.trim();
    return (
        <WorkspaceState
            kind="no-results"
            icon={icon}
            compact={compact}
            title={title || (keyword ? `没有找到与“${keyword}”相关的内容` : "没有符合筛选条件的内容")}
            description={description ?? "换一个关键词，或清除筛选后查看全部。"}
            action={onClear ? <Button onClick={onClear}>{clearLabel}</Button> : undefined}
        />
    );
}

export function WorkspaceErrorState({ title = "暂时无法加载", description, actionLabel = "重新加载", onRetry, compact = false }: { title?: string; description?: string; actionLabel?: string; onRetry?: () => void; compact?: boolean }) {
    return <WorkspaceState kind="error" icon="error" title={title} description={description || "请检查网络连接后重试，当前内容不会被覆盖。"} compact={compact} action={onRetry ? <Button onClick={onRetry}>{actionLabel}</Button> : undefined} />;
}

/** 没有权限：说明原因，给出返回或申请的出口，不展示内容结构。 */
export function WorkspaceForbiddenState({ title = "没有访问权限", description = "当前账号无法查看这里的内容。如需使用，请联系管理员开通。", action, compact = false }: { title?: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
    return <WorkspaceState kind="forbidden" icon="settings" title={title} description={description} compact={compact} action={action} />;
}

export function WorkspaceLoadingState({ label = "正在加载内容", detail, rows = 3, className }: { label?: string; detail?: string; rows?: number; className?: string }) {
    return (
        <section className={cn("workspace-loading-state py-8", className)} aria-busy="true" aria-live="polite">
            <div className="mb-5 flex items-center gap-3">
                <LoaderCircle aria-hidden className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" strokeWidth={1.75} />
                <div>
                    <div className="text-sm font-medium">{label}</div>
                    {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="rounded-md bg-surface-active p-4">
                        <Skeleton active title={{ width: `${48 + index * 8}%` }} paragraph={{ rows: 3 }} />
                    </div>
                ))}
            </div>
        </section>
    );
}
