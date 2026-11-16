import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clapperboard, History, PanelsTopLeft } from "lucide-react";
import { Link, useLocation } from "react-router";

import { RelativeTime } from "@/components/ui/product/relative-time";
import { listDramas } from "@/services/api/drama";
import { listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { useUserStore } from "@/stores/use-user-store";
import "./workspace-creation-records.css";

const RECENT_COUNT = 3;
type CreationRecord = { id: string; title: string; to: string; updatedAt: string };

/** 复用原首页的当前账号服务端历史，不把未同步的本地画布充当已保存记录。 */
export function WorkspaceCreationRecords({ collapsed, onExpand, onNavigate }: { collapsed: boolean; onExpand: () => void; onNavigate: () => void }) {
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const headingId = useId();

    if (collapsed) {
        return (
            <div className="workspace-creation-records is-collapsed">
                <button type="button" className="workspace-creation-records-expand" onClick={onExpand} aria-label="展开创作记录" title="展开创作记录">
                    <History aria-hidden="true" />
                    <span>创作记录</span>
                </button>
            </div>
        );
    }

    return (
        <section className="workspace-creation-records" aria-labelledby={headingId}>
            <h2 id={headingId} className="workspace-creation-records-heading">
                创作记录
            </h2>
            {!hydrated ? (
                <p className="workspace-creation-records-state" role="status">
                    正在读取登录状态…
                </p>
            ) : userId ? (
                <SignedInCreationRecords key={userId} userId={userId} shortDramaEnabled={shortDramaEnabled} onNavigate={onNavigate} />
            ) : (
                <div className="workspace-creation-records-guest">
                    <strong>继续上次的创作</strong>
                    <p>登录后查看已有画布{shortDramaEnabled ? "与短剧" : ""}记录</p>
                </div>
            )}
        </section>
    );
}

function SignedInCreationRecords({ userId, shortDramaEnabled, onNavigate }: { userId: string; shortDramaEnabled: boolean; onNavigate: () => void }) {
    const canvases = useQuery({
        queryKey: ["canvas-library", userId, "recent-updated", RECENT_COUNT],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "updated", signal }),
        placeholderData: undefined,
        retry: false,
    });
    const dramas = useQuery({
        queryKey: ["my-dramas-recent", userId, "sidebar", RECENT_COUNT],
        queryFn: ({ signal }) => listDramas({ page: 1, pageSize: RECENT_COUNT }, signal),
        enabled: shortDramaEnabled,
        placeholderData: undefined,
        retry: false,
    });

    return (
        <div className="workspace-creation-records-groups">
            <RecordGroup
                kind="canvas"
                items={(canvases.data?.projects ?? []).slice(0, RECENT_COUNT).map((project) => ({ id: project.id, title: project.title || "未命名画布", to: `/canvas/${encodeURIComponent(project.id)}`, updatedAt: project.updatedAt }))}
                loading={canvases.isPending}
                error={canvases.isError}
                refreshing={canvases.isFetching}
                onRetry={() => void canvases.refetch()}
                onNavigate={onNavigate}
            />
            {shortDramaEnabled ? (
                <RecordGroup
                    kind="drama"
                    items={(dramas.data?.items ?? []).slice(0, RECENT_COUNT).map((item) => ({
                        id: item.project.id,
                        title: item.project.name || "未命名短剧",
                        to: item.hasDraftForm ? `/projects/new?draft=${encodeURIComponent(item.project.id)}` : `/projects/${encodeURIComponent(item.project.id)}`,
                        updatedAt: item.updatedAt || item.project.updatedAt,
                    }))}
                    loading={dramas.isPending}
                    error={dramas.isError}
                    refreshing={dramas.isFetching}
                    onRetry={() => void dramas.refetch()}
                    onNavigate={onNavigate}
                />
            ) : null}
        </div>
    );
}

function RecordGroup({ kind, items, loading, error, refreshing, onRetry, onNavigate }: { kind: "canvas" | "drama"; items: CreationRecord[]; loading: boolean; error: boolean; refreshing: boolean; onRetry: () => void; onNavigate: () => void }) {
    const { pathname, search } = useLocation();
    const label = kind === "canvas" ? "画布" : "短剧";
    const Icon = kind === "canvas" ? PanelsTopLeft : Clapperboard;
    return (
        <section className="workspace-creation-records-group" aria-label={`${label}创作记录`}>
            <header>
                <h3>
                    <Icon aria-hidden="true" />
                    {label}
                </h3>
                <Link className="workspace-creation-records-all" to={kind === "canvas" ? "/canvas" : "/projects"} onClick={onNavigate} aria-label={`查看全部${label}`}>
                    <span>全部</span>
                    <ChevronRight aria-hidden="true" />
                </Link>
            </header>
            <div className="workspace-creation-records-list" aria-busy={refreshing}>
                {error ? (
                    <div className="workspace-creation-records-state is-error" role="alert">
                        <span>{label}记录暂时无法读取</span>
                        <button type="button" disabled={refreshing} onClick={onRetry} aria-label={`重试读取${label}记录`}>
                            <span>{refreshing ? "重试中…" : "重试"}</span>
                        </button>
                    </div>
                ) : null}
                {loading ? (
                    <p className="workspace-creation-records-state" role="status">
                        正在读取{label}记录…
                    </p>
                ) : items.length ? (
                    <ul aria-label={`最近更新的${label}`}>
                        {items.map((item) => (
                            <li key={item.id}>
                                <Link to={item.to} className="workspace-creation-records-link" onClick={onNavigate} aria-label={`打开${label}：${item.title}`} aria-current={`${pathname}${search}` === item.to ? "page" : undefined}>
                                    <span className="workspace-creation-records-marker" aria-hidden="true" />
                                    <span className="workspace-creation-records-copy">
                                        <strong title={item.title}>{item.title}</strong>
                                        <RelativeTime value={item.updatedAt} className="workspace-creation-records-time" />
                                    </span>
                                    <ChevronRight className="workspace-creation-records-open" aria-hidden="true" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : !error ? (
                    <p className="workspace-creation-records-state is-empty">还没有{label}记录</p>
                ) : null}
            </div>
        </section>
    );
}
