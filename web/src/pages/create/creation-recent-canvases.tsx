import { useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, LoaderCircle, PanelsTopLeft, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { getActiveUserScope } from "@/lib/user-scope";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

const RECENT_COUNT = 4;
const createdFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 每张卡上的时间取建立时间；老数据没有 createdAt 时退回最后编辑时间，不让格子空着。
function canvasTimeLabel(project: CanvasLibrarySummary) {
    const created = Date.parse(project.createdAt);
    if (Number.isFinite(created)) return { label: createdFormatter.format(new Date(created)), dateTime: project.createdAt };
    const updated = Date.parse(project.updatedAt);
    if (Number.isFinite(updated)) return { label: createdFormatter.format(new Date(updated)), dateTime: project.updatedAt };
    return { label: "时间未知", dateTime: undefined };
}

// 本地（未登录）画布只有串行化过的时间戳：建立时间缺失时退回最后编辑时间，
// 避免 Date.parse 得到 NaN 让比较函数退化成不稳定的 0。
function localCanvasCreatedAt(project: { createdAt: string; updatedAt: string }) {
    const created = Date.parse(project.createdAt);
    if (Number.isFinite(created)) return created;
    const updated = Date.parse(project.updatedAt);
    return Number.isFinite(updated) ? updated : 0;
}

export function CreationRecentCanvases({ onRequireLogin }: { onRequireLogin: () => void }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const recentQuery = useQuery({
        queryKey: ["canvas-library", userId, "recent-created"],
        // 这里要的是「最近创建」而不是「最近更新」，所以显式带上 created 排序。
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "created", signal }),
        enabled: Boolean(userId) && sessionHydrated,
    });
    const recentProjects = useMemo<CanvasLibrarySummary[]>(
        () =>
            userId
                ? recentQuery.data?.projects || []
                : [...localProjects]
                      .sort((left, right) => localCanvasCreatedAt(right) - localCanvasCreatedAt(left))
                      .slice(0, RECENT_COUNT)
                      .map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: project.nodes.slice(0, 4) })),
        [localProjects, recentQuery.data, userId],
    );
    const loading = !sessionHydrated || !canvasHydrated || Boolean(userId && recentQuery.isPending);
    const preload = () => {
        void loadCanvasProjectPage();
    };
    const createCanvas = async () => {
        if (!userId) {
            onRequireLogin();
            return;
        }
        if (!canvasHydrated || creatingRef.current) return;
        const scope = getActiveUserScope();
        creatingRef.current = true;
        setCreating(true);
        try {
            const { id, syncError } = await createCanvasProjectWithRemoteSync("未命名画布");
            await flushCanvasStorePersistence();
            if (getActiveUserScope() !== scope || useUserStore.getState().user?.id !== userId) return;
            if (syncError) message.warning("画布已保存在本机，云端同步尚未完成，将自动重试。");
            navigate(`/canvas/${id}`);
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : "创建画布失败，请重试");
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    };

    return (
        <section className="creation-recent-canvases" aria-labelledby="creation-recent-title">
            <header className="creation-section-heading">
                <h2 id="creation-recent-title">
                    <Clock3 aria-hidden="true" />
                    最近创建的画布
                </h2>
                <Link to="/canvas" className="creation-section-link">
                    查看全部
                    <ArrowUpRight aria-hidden="true" />
                </Link>
            </header>
            <div className="creation-canvas-strip creation-scrollbar" role="list" aria-label="最近创建的画布" aria-busy={loading}>
                <div className="creation-canvas-strip-item" role="listitem">
                    <button type="button" className="creation-canvas-tile is-create" disabled={!sessionHydrated || !canvasHydrated || creating} onClick={() => void createCanvas()} onPointerEnter={preload} onFocus={preload}>
                        <span className="creation-canvas-thumbnail is-create">{creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}</span>
                        <span className="creation-canvas-copy">
                            <strong>{creating ? "正在创建…" : "创建画布"}</strong>
                            <small>从空白开始</small>
                        </span>
                    </button>
                </div>
                {loading ? (
                    Array.from({ length: RECENT_COUNT }, (_, index) => (
                        <div key={index} className="creation-canvas-strip-item creation-canvas-skeleton" role="listitem" aria-label="正在读取画布">
                            <span />
                            <span />
                        </div>
                    ))
                ) : userId && recentQuery.isError ? (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <span role="alert">最近创建的画布暂时无法读取</span>
                        <button type="button" onClick={() => void recentQuery.refetch()} disabled={recentQuery.isFetching}>
                            {recentQuery.isFetching ? "重试中…" : "重试"}
                        </button>
                    </div>
                ) : recentProjects.length ? (
                    recentProjects.map((project) => {
                        const time = canvasTimeLabel(project);
                        return (
                            <div className="creation-canvas-strip-item" role="listitem" key={project.id}>
                                <Link to={`/canvas/${project.id}`} className="creation-canvas-tile" onPointerEnter={preload} onFocus={preload} title={project.title}>
                                    <span className="creation-canvas-thumbnail" aria-hidden="true">
                                        <ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage />
                                    </span>
                                    <span className="creation-canvas-copy">
                                        <strong>{project.title || "未命名画布"}</strong>
                                        <small>
                                            {project.nodeCount} 个节点 · 创建于 <time dateTime={time.dateTime}>{time.label}</time>
                                        </small>
                                    </span>
                                </Link>
                            </div>
                        );
                    })
                ) : (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <PanelsTopLeft aria-hidden="true" />
                        <span>{userId ? "还没有画布，把第一个想法留在这里。" : "登录后，最近创建的画布会显示在这里。"}</span>
                        {!userId ? (
                            <button type="button" onClick={onRequireLogin}>
                                登录
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
