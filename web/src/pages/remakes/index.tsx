import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { Clapperboard, Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { PageHeader, ListToolbar, CollectionGrid, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { Select } from "@/components/ui/base/select";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { remakeDuration, remakeStageLabel, remakeStatusLabel, remakeStatusTone } from "@/lib/remake/presentation";
import { listRemakes } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

const ACTIVE_STATUSES = ["queued", "running", "analyzing", "rendering"];

const statusFilterOptions = [
    { value: "draft", label: "草稿" },
    { value: "running", label: "制作中" },
    { value: "awaiting_review", label: "等待审核" },
    { value: "needs_attention", label: "需要处理" },
    { value: "paused", label: "已暂停" },
    { value: "completed", label: "已完成" },
    { value: "partial_failed", label: "部分失败" },
    { value: "failed", label: "失败" },
    { value: "cancelled", label: "已取消" },
];

export default function RemakesPage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<string | undefined>(undefined);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const listQuery = useQuery({
        queryKey: ["remakes", page, pageSize, query, status],
        queryFn: ({ signal }) => listRemakes({ page, pageSize, query: query || undefined, status, signal }),
        placeholderData: (previous) => previous,
        refetchInterval: (current) => (current.state.data?.items.some((item) => ACTIVE_STATUSES.includes(item.status)) ? 5000 : false),
    });
    const items = useMemo(() => listQuery.data?.items || [], [listQuery.data]);
    const total = listQuery.data?.total ?? 0;
    const filtered = Boolean(query || status);

    const resetPaging = () => {
        setPage(1);
    };

    return (
        <WorkspacePage>
            <PageHeader
                title="一键复刻"
                description="上传一条参考视频，系统拆镜分析后替换主体并重新生成，保留镜头顺序与节奏。"
                actions={
                    <Button type="primary" icon={<Plus size={16} />} onClick={() => navigate("/remakes/new")}>
                        新建复刻
                    </Button>
                }
            />
            <ListToolbar
                active={filtered}
                onReset={() => {
                    setQuery("");
                    setStatus(undefined);
                    resetPaging();
                }}
            >
                <Input
                    allowClear
                    className="max-w-xs"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        resetPaging();
                    }}
                    prefix={<Search size={15} className="text-foreground/40" />}
                    placeholder="搜索复刻项目"
                    aria-label="搜索复刻项目"
                />
                <Select
                    className="min-w-32"
                    allowClear
                    placeholder="全部状态"
                    ariaLabel="按状态筛选"
                    value={status}
                    options={statusFilterOptions}
                    onChange={(value) => {
                        setStatus(value || undefined);
                        resetPaging();
                    }}
                />
            </ListToolbar>
            {listQuery.isPending ? <WorkspaceLoadingState label="正在加载复刻项目" rows={3} /> : null}
            {listQuery.isError ? <WorkspaceErrorState description={listQuery.error.message || "复刻项目加载失败"} onRetry={() => void listQuery.refetch()} /> : null}
            {!listQuery.isPending && !listQuery.isError && items.length === 0 ? (
                filtered ? (
                    <WorkspaceNoResultsState
                        query={query}
                        onClear={() => {
                            setQuery("");
                            setStatus(undefined);
                            resetPaging();
                        }}
                    />
                ) : (
                    <WorkspaceState
                        title="还没有复刻项目"
                        description="从一条参考视频开始：上传片段、绑定新主体素材，系统会拆镜、生成关键帧并逐镜重拍。"
                        action={
                            <Button type="primary" icon={<Plus size={15} />} onClick={() => navigate("/remakes/new")}>
                                新建复刻
                            </Button>
                        }
                    />
                )
            ) : null}
            {items.length > 0 ? (
                <>
                    <CollectionGrid>
                        {items.map((item) => {
                            const durationMs = Math.max(0, item.settings.sourceOutMs - item.settings.sourceInMs);
                            return (
                                <Link
                                    key={item.id}
                                    to={`/remakes/${encodeURIComponent(item.id)}`}
                                    className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-surface transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                    <div className="relative aspect-video w-full overflow-hidden bg-black">
                                        <video
                                            src={`${resourceFileUrl(item.sourceResourceId)}#t=0.1`}
                                            preload="metadata"
                                            muted
                                            playsInline
                                            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                                            crossOrigin="use-credentials"
                                        />
                                        <span className="absolute left-2 top-2">
                                            <StatusBadge variant="filled" size="sm" tone={remakeStatusTone(item.status)} label={remakeStatusLabel(item.status)} />
                                        </span>
                                        {durationMs > 0 ? <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-px text-[var(--fs-label)] tabular-nums text-white">{remakeDuration(durationMs)}</span> : null}
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                                        <h2 className="truncate text-sm font-semibold text-foreground">{item.title}</h2>
                                        <p className="flex items-center gap-1.5 text-xs text-foreground/55">
                                            <Clapperboard size={12} className="shrink-0 opacity-60" aria-hidden />
                                            {remakeStageLabel(item.stage)}
                                            <span aria-hidden>·</span>
                                            <RelativeTime value={item.updatedAt} suffix="更新" />
                                        </p>
                                        {item.error ? <p className="line-clamp-2 text-xs text-red-500">{item.error}</p> : null}
                                    </div>
                                </Link>
                            );
                        })}
                    </CollectionGrid>
                    <PaginationBar
                        className="mt-4"
                        current={page}
                        pageSize={pageSize}
                        total={total}
                        onChange={(nextPage, nextSize) => {
                            setPage(nextPage);
                            setPageSize(nextSize);
                        }}
                        itemLabel="个项目"
                    />
                </>
            ) : null}
        </WorkspacePage>
    );
}
