import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Spin, Tag } from "antd";
import { Clapperboard, Plus, Search, Video } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { listRemakes } from "@/services/api/remakes";
import { remakeStageLabel, remakeStatusLabel } from "@/lib/remake/presentation";

export default function RemakesPage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const listQuery = useQuery({
        queryKey: ["remakes", query],
        queryFn: ({ signal }) => listRemakes({ page: 1, pageSize: 100, query: query || undefined, signal }),
    });
    const items = listQuery.data?.items || [];

    return (
        <WorkspacePage>
            <PageHeader
                title="一键复刻"
                actions={
                    <Button type="primary" icon={<Plus size={16} />} onClick={() => navigate("/remakes/new")}>
                        新建复刻
                    </Button>
                }
            />
            <div className="mt-4 flex max-w-xl items-center gap-2">
                <Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search size={15} />} placeholder="搜索复刻项目" aria-label="搜索复刻项目" />
            </div>
            {listQuery.isPending ? (
                <div className="flex justify-center py-16">
                    <Spin />
                </div>
            ) : null}
            {listQuery.isError ? (
                <div className="mt-8 flex flex-col items-center gap-3 py-12 text-center">
                    <p className="text-sm text-foreground/65">{listQuery.error.message || "复刻项目加载失败"}</p>
                    <Button onClick={() => void listQuery.refetch()}>重试</Button>
                </div>
            ) : null}
            {!listQuery.isPending && !listQuery.isError && items.length === 0 ? (
                <div className="mt-10 flex flex-col items-center gap-3 py-16 text-center">
                    <Clapperboard className="size-8 text-foreground/35" strokeWidth={1.5} />
                    <strong className="text-sm font-medium">{query ? "没有匹配的项目" : "还没有复刻项目"}</strong>
                    {!query ? (
                        <Button type="default" icon={<Plus size={15} />} onClick={() => navigate("/remakes/new")}>
                            新建复刻
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {items.length > 0 ? (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => (
                        <Link
                            key={item.id}
                            to={`/remakes/${encodeURIComponent(item.id)}`}
                            className="group min-w-0 rounded-md border border-border/70 bg-surface p-4 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="grid size-10 shrink-0 place-items-center rounded bg-foreground/5 text-foreground/60">
                                        <Video size={18} />
                                    </span>
                                    <div className="min-w-0">
                                        <h2 className="truncate text-sm font-semibold text-foreground">{item.title}</h2>
                                        <p className="mt-1 truncate text-xs text-foreground/50">
                                            {remakeStageLabel(item.stage)} · 更新于 {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                                        </p>
                                    </div>
                                </div>
                                <Tag bordered={false} color={item.status === "completed" ? "success" : item.status === "partial_failed" || item.status === "failed" ? "error" : "default"}>
                                    {remakeStatusLabel(item.status)}
                                </Tag>
                            </div>
                            {item.error ? <p className="mt-3 line-clamp-2 text-xs text-red-500">{item.error}</p> : null}
                        </Link>
                    ))}
                </div>
            ) : null}
        </WorkspacePage>
    );
}
