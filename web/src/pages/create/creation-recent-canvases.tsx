import { useId, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clapperboard, History, Layers3, PanelsTopLeft } from "lucide-react";
import { Link } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { DRAMA_STATUS_LABEL } from "@/lib/drama/drama-format";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listDramas, type DramaListItem } from "@/services/api/drama";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { useUserStore } from "@/stores/use-user-store";

import "./creation-recent-projects.css";

const RECENT_COUNT = 6;
const updatedFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
type RecentTab = "canvas" | "drama";

export type CreationRecentProjectsProps = { onOpenHistory: () => void };

export function CreationRecentProjects({ onOpenHistory }: CreationRecentProjectsProps) {
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    if (!hydrated || !userId) return null;

    // 会话变化时卸载旧查询与媒体，既不读取本地画布，也不保留上一账号的卡片或选中项。
    return <RecentProjects key={userId} userId={userId} shortDramaEnabled={shortDramaEnabled} onOpenHistory={onOpenHistory} />;
}

function RecentProjects({ userId, shortDramaEnabled, onOpenHistory }: CreationRecentProjectsProps & { userId: string; shortDramaEnabled: boolean }) {
    const [selectedTab, setSelectedTab] = useState<RecentTab>("canvas");
    const tab = shortDramaEnabled ? selectedTab : "canvas";
    const id = useId();
    const canvasQuery = useQuery({
        queryKey: ["canvas-library", userId, "recent-updated", RECENT_COUNT],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "updated", signal }),
        enabled: tab === "canvas",
        placeholderData: undefined,
    });
    const dramaQuery = useQuery({
        queryKey: ["my-dramas-recent", userId, "home", RECENT_COUNT],
        // DramaProjectsPage 默认按 projects.updated_at desc 排序，摘要接口无需逐项加载详情。
        queryFn: ({ signal }) => listDramas({ page: 1, pageSize: RECENT_COUNT }, signal),
        enabled: shortDramaEnabled && tab === "drama",
        placeholderData: undefined,
    });
    const query = tab === "canvas" ? canvasQuery : dramaQuery;
    const label = tab === "canvas" ? "画布" : "短剧";
    const canvases = (canvasQuery.data?.projects ?? []).slice(0, RECENT_COUNT);
    const dramas = (dramaQuery.data?.items ?? []).slice(0, RECENT_COUNT);
    const count = tab === "canvas" ? canvases.length : dramas.length;
    const selectTab = (next: RecentTab) => setSelectedTab(next);
    const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "canvas" : event.key === "End" ? "drama" : tab === "canvas" ? "drama" : "canvas";
        selectTab(next);
        document.getElementById(`${id}-${next}`)?.focus();
    };

    return (
        <section className="creation-recent-projects" aria-labelledby={`${id}-title`}>
            <header className="creation-recent-projects-heading">
                <h2 id={`${id}-title`}>继续创作</h2>
                <div className="creation-recent-projects-actions">
                    <button type="button" onClick={onOpenHistory}><History aria-hidden="true" />历史对话</button>
                    <Link to={tab === "canvas" ? "/canvas" : "/projects"}>查看全部<ArrowUpRight aria-hidden="true" /></Link>
                </div>
            </header>
            {shortDramaEnabled ? (
                <div className="creation-recent-projects-tabs" role="tablist" aria-label="继续创作类型">
                    {(["canvas", "drama"] as const).map((value) => (
                        <button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={onTabKeyDown}>
                            {value === "canvas" ? "画布" : "短剧"}
                        </button>
                    ))}
                </div>
            ) : null}
            <div id={`${id}-panel`} role={shortDramaEnabled ? "tabpanel" : undefined} aria-labelledby={shortDramaEnabled ? `${id}-${tab}` : undefined} aria-busy={query.isFetching} className="creation-recent-projects-panel">
                {query.isPending ? (
                    <div className="creation-recent-projects-grid" role="status" aria-label={`正在读取最近更新的${label}`}>
                        {Array.from({ length: RECENT_COUNT }, (_, index) => <div className="creation-recent-projects-skeleton" key={index} aria-hidden="true"><span /><span /></div>)}
                    </div>
                ) : query.isError ? (
                    <div className="creation-recent-projects-state">
                        <span role="alert">最近更新的{label}暂时无法读取</span>
                        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "重试中…" : "重试"}</button>
                    </div>
                ) : count ? (
                    <ul className="creation-recent-projects-grid" aria-label={`最近更新的${label}`}>
                        {tab === "canvas" ? canvases.map((project) => <RecentCanvasCard key={project.id} project={project} />) : dramas.map((item) => <RecentDramaCard key={item.project.id} item={item} />)}
                    </ul>
                ) : (
                    <div className="creation-recent-projects-state">
                        {tab === "canvas" ? <PanelsTopLeft aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}
                        <span>还没有{label}，从上方开始你的第一个创作。</span>
                    </div>
                )}
            </div>
        </section>
    );
}

function UpdatedTime({ value }: { value: string }) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? <span>更新于 <time dateTime={value}>{updatedFormatter.format(new Date(timestamp))}</time></span> : <span>更新时间未知</span>;
}

function RecentCanvasCard({ project }: { project: CanvasLibrarySummary }) {
    const preload = () => { void loadCanvasProjectPage(); };
    return (
        <li>
            <Link to={`/canvas/${project.id}`} className="creation-recent-project-card" onPointerEnter={preload} onFocus={preload}>
                <div className="creation-recent-project-cover canvas-collection-preview">
                    <div className="canvas-collection-preview-media" aria-hidden="true"><ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage quiet mosaic /></div>
                    <span className="canvas-collection-badge" title={`${project.nodeCount} 个节点`}><Layers3 aria-hidden="true" /><span>{project.nodeCount}</span><span className="sr-only">个节点</span></span>
                </div>
                <span className="creation-recent-project-copy">
                    <strong title={project.title || "未命名画布"}>{project.title || "未命名画布"}</strong>
                    <span className="creation-recent-project-time"><UpdatedTime value={project.updatedAt} /></span>
                </span>
            </Link>
        </li>
    );
}

function RecentDramaCard({ item }: { item: DramaListItem }) {
    const cover = item.coverResourceIds?.[0] || item.coverResourceId;
    const fallback = <Clapperboard className="creation-recent-project-cover-icon" aria-hidden="true" />;
    return (
        <li>
            <Link to={`/projects/${item.project.id}`} className="creation-recent-project-card">
                <span className="creation-recent-project-cover" aria-hidden="true">
                    {cover ? <CachedResourceImage storageKey={`resource:${cover}`} alt="" variant="thumbnail" fallback={fallback} loadingFallback={fallback} draggable={false} /> : fallback}
                </span>
                <span className="creation-recent-project-copy">
                    <strong title={item.project.name}>{item.project.name}</strong>
                    <span className="creation-recent-project-facts"><span>{DRAMA_STATUS_LABEL[item.status]}</span><span>{item.doneCount}/{item.episodeCount} 集成片</span></span>
                    <span className="creation-recent-project-time"><UpdatedTime value={item.updatedAt || item.project.updatedAt} /></span>
                </span>
            </Link>
        </li>
    );
}
