import { useId, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clapperboard, History, Layers3, PanelsTopLeft } from "lucide-react";
import { Link } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { DRAMA_STATUS_LABEL } from "@/lib/drama/drama-format";
import { progressFillStyle } from "@/lib/progress-fill";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { openWorkspaceAuth } from "@/lib/workspace-auth";
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
    // 未登录也保留这一块：藏起来会让首页少一整段、登录前后高度差很大；
    // 而且对游客来说「这里以后会有你的作品」比凭空少一块更能说明产品在干什么。
    if (!hydrated) return null;

    // 会话变化时卸载旧查询与媒体，既不读取本地画布，也不保留上一账号的卡片或选中项。
    return <RecentProjects key={userId ?? "guest"} userId={userId} shortDramaEnabled={shortDramaEnabled} onOpenHistory={onOpenHistory} />;
}

function RecentProjects({ userId, shortDramaEnabled, onOpenHistory }: CreationRecentProjectsProps & { userId?: string; shortDramaEnabled: boolean }) {
    const guest = !userId;
    const [selectedTab, setSelectedTab] = useState<RecentTab>("canvas");
    const tab = shortDramaEnabled && !guest ? selectedTab : "canvas";
    const id = useId();
    const canvasQuery = useQuery({
        queryKey: ["canvas-library", userId, "recent-updated", RECENT_COUNT],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "updated", signal }),
        // 游客没有会话，请求只会拿到 401，直接不发起。
        enabled: !guest && tab === "canvas",
        placeholderData: undefined,
    });
    const dramaQuery = useQuery({
        queryKey: ["my-dramas-recent", userId, "home", RECENT_COUNT],
        // DramaProjectsPage 默认按 projects.updated_at desc 排序，摘要接口无需逐项加载详情。
        queryFn: ({ signal }) => listDramas({ page: 1, pageSize: RECENT_COUNT }, signal),
        enabled: !guest && shortDramaEnabled && tab === "drama",
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
                    {/* 游客不给「查看全部」：列表页要登录，点过去只会被弹回来，下面那块里已经有登录入口。 */}
                    {guest ? null : <Link to={tab === "canvas" ? "/canvas" : "/projects"}>查看全部<ArrowUpRight aria-hidden="true" /></Link>}
                </div>
            </header>
            {shortDramaEnabled && !guest ? (
                <div className="creation-recent-projects-tabs" role="tablist" aria-label="继续创作类型">
                    {(["canvas", "drama"] as const).map((value) => (
                        <button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${id}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={onTabKeyDown}>
                            {value === "canvas" ? "画布" : "短剧"}
                        </button>
                    ))}
                </div>
            ) : null}
            <div id={`${id}-panel`} role={shortDramaEnabled && !guest ? "tabpanel" : undefined} aria-labelledby={shortDramaEnabled && !guest ? `${id}-${tab}` : undefined} aria-busy={query.isFetching} className="creation-recent-projects-panel">
                {guest ? (
                    <div className="creation-recent-projects-state is-guest">
                        <span>登录后这里会显示你最近更新的画布与短剧。</span>
                        <button type="button" onClick={() => openWorkspaceAuth()}>登录 / 注册</button>
                    </div>
                ) : query.isPending ? (
                    <div className={`creation-recent-projects-grid${tab === "drama" ? " is-drama" : ""}`} role="status" aria-label={`正在读取最近更新的${label}`}>
                        {Array.from({ length: RECENT_COUNT }, (_, index) => <div className="creation-recent-projects-skeleton" key={index} aria-hidden="true"><span /><span /></div>)}
                    </div>
                ) : query.isError ? (
                    <div className="creation-recent-projects-state">
                        <span role="alert">最近更新的{label}暂时无法读取</span>
                        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "重试中…" : "重试"}</button>
                    </div>
                ) : count ? (
                    <ul className={`creation-recent-projects-grid${tab === "drama" ? " is-drama" : ""}`} aria-label={`最近更新的${label}`}>
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
    // 与短剧 Agent 页「我的短剧作品」的卡片（pages/projects/create.tsx: DramaHubCard）同一套视觉：
    // 横版拼图封面 + 状态角标 + 进度条。封面最多 4 张，按张数平均分栏。
    const covers = (item.coverResourceIds?.length ? item.coverResourceIds : item.coverResourceId ? [item.coverResourceId] : []).slice(0, 4);
    const progress = item.episodeCount ? Math.round((item.doneCount / item.episodeCount) * 100) : 0;
    const stage = item.episodeCount ? `${item.doneCount}/${item.episodeCount} 集成片` : item.status === "running" ? "正在改编" : "准备中";
    const fallback = <Clapperboard className="creation-recent-drama-empty-icon" aria-hidden="true" />;
    return (
        <li>
            <Link
                to={`/projects/${item.project.id}`}
                className={`creation-recent-drama-card is-${item.status}`}
                aria-label={`打开《${item.project.name}》，${DRAMA_STATUS_LABEL[item.status]}，${stage}`}
            >
                <span className={`creation-recent-drama-cover${covers.length ? ` is-${covers.length}` : " is-empty"}`} aria-hidden="true">
                    {covers.length
                        ? covers.map((resourceId) => (
                            <span key={resourceId}>
                                <CachedResourceImage storageKey={`resource:${resourceId}`} alt="" variant="thumbnail" fallback={fallback} loadingFallback={fallback} draggable={false} />
                            </span>
                        ))
                        : <>
                            <span className="creation-recent-drama-glyph">{item.project.name.slice(0, 1)}</span>
                            {fallback}
                        </>}
                </span>
                <span className="creation-recent-drama-badge"><span className="creation-recent-drama-dot" aria-hidden="true" />{DRAMA_STATUS_LABEL[item.status]}</span>
                <span className="creation-recent-drama-body">
                    <strong title={item.project.name}>{item.project.name}</strong>
                    <span className="creation-recent-drama-meta">
                        {item.styleName ? <span>{item.styleName}</span> : null}
                        <span>{item.aspectRatio}</span>
                        <RelativeTime value={item.updatedAt || item.project.updatedAt} />
                    </span>
                    <span className="creation-recent-drama-progress">
                        <span className="creation-recent-drama-track"><span style={progressFillStyle(Math.max(progress, 2))} /></span>
                        <b>{stage}</b>
                    </span>
                </span>
            </Link>
        </li>
    );
}
