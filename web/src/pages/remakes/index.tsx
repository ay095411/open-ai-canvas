import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { PageHeader, ListToolbar, CollectionGrid, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { Select } from "@/components/ui/base/select";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { remakeDuration, remakeStageLabel, remakeStatusLabel, remakeStatusTone } from "@/lib/remake/presentation";
import { listRemakes } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

import "./remake-pages.css";

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
    // 确认是空库时只保留引导，不显示无事可筛的搜索与筛选。
    const showToolbar = listQuery.isPending || filtered || items.length > 0 || total > 0;

    const resetPaging = () => {
        setPage(1);
    };

    return (
        <WorkspacePage grid className="library-page remake-library-page">
            <div className="studio-band">
                <PageHeader
                    title="一键复刻"
                    description="上传参考视频，换上你的人物或产品，按原片镜头节奏重新生成。"
                    actions={
                        <Button type="primary" icon={<Plus size={16} />} onClick={() => navigate("/remakes/new")}>
                            新建复刻
                        </Button>
                    }
                />
            </div>
            {showToolbar ? (
                <ListToolbar
                    className="remake-library-toolbar"
                    active={filtered}
                    onReset={() => {
                        setQuery("");
                        setStatus(undefined);
                        resetPaging();
                    }}
                >
                    <Input
                        allowClear
                        className="remake-library-search"
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
                        className="remake-library-status"
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
            ) : null}
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
                        description="从一条参考视频开始，系统会拆镜并用新主体逐镜重新生成。"
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
                    <CollectionGrid className="project-library-grid remake-library-grid">
                        {items.map((item) => {
                            const durationMs = Math.max(0, item.settings.sourceOutMs - item.settings.sourceInMs);
                            return (
                                <Link
                                    key={item.id}
                                    to={`/remakes/${encodeURIComponent(item.id)}`}
                                    className="product-collection-card remake-project-card group flex min-w-0 flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                    <div className="remake-project-media relative aspect-video w-full overflow-hidden bg-black">
                                        <video
                                            src={`${resourceFileUrl(item.sourceResourceId)}#t=0.1`}
                                            preload="metadata"
                                            muted
                                            playsInline
                                            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                                            crossOrigin="use-credentials"
                                        />
                                        <span className="remake-project-status absolute left-3 top-3">
                                            <StatusBadge variant="filled" size="sm" tone={remakeStatusTone(item.status)} label={remakeStatusLabel(item.status)} />
                                        </span>
                                        {durationMs > 0 ? <span className="remake-duration-chip absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-xs tabular-nums text-white backdrop-blur-sm">{remakeDuration(durationMs)}</span> : null}
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-5 py-4">
                                        <h2 className="remake-project-title truncate font-semibold text-foreground">{item.title}</h2>
                                        <p className="remake-project-meta flex items-center gap-2 text-foreground/55">
                                            {remakeStageLabel(item.stage)}
                                            <span aria-hidden>·</span>
                                            <RelativeTime value={item.updatedAt} suffix="更新" />
                                        </p>
                                        {item.error ? <p className="line-clamp-2 text-[13px] leading-5 text-red-500">{item.error}</p> : null}
                                    </div>
                                </Link>
                            );
                        })}
                    </CollectionGrid>
                    <PaginationBar
                        className="mt-6"
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
