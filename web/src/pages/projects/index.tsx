import { useDeferredValue, useEffect, useRef, useState, type DragEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Input } from "antd";
import { BookOpenText, ClipboardPaste, Clapperboard, ExternalLink, FileUp, MoreHorizontal, Plus, Search, Sparkles, Trash2, Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState } from "@/components/layout/workspace-state";
import { deleteDrama, listDramas, type DramaListItem, type DramaStatus } from "@/services/api/drama";

import { formatCredits, MediaThumb, STATUS_LABEL } from "./drama-shared";
import { progressFillStyle } from "@/lib/progress-fill";
import { RelativeTime } from "@/components/ui/product/relative-time";
import "./drama.css";

const PAGE_SIZES = [24, 48, 96];
const PIPELINE = ["解析章节", "建立角色、道具与场景", "分集改编与段提示词", "按剧情段生成视频", "合成成片"];
const STATUS_FILTERS: Array<{ value: DramaStatus | "all"; label: string }> = [
    { value: "all", label: "全部" },
    { value: "running", label: "制作中" },
    { value: "paused", label: "已暂停" },
    { value: "completed", label: "已完成" },
    { value: "draft", label: "未开始" },
];
const ACCEPT = ".txt,.md,.markdown,text/plain,text/markdown";

export default function DramaListPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<DramaStatus | "all">("all");
    const [dragging, setDragging] = useState(false);
    const [promptIdea, setPromptIdea] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const search = useDeferredValue(keyword.trim());
    useEffect(() => setPage(1), [search, status, pageSize]);

    const handleAgentIdeaSubmit = () => {
        const text = promptIdea.trim();
        if (!text) {
            message.warning("请输入你的短剧构想或核心情节");
            return;
        }
        navigate(`/projects/new?idea=${encodeURIComponent(text)}`);
    };

    const query = useQuery({
        queryKey: ["dramas", { page, pageSize, search, status }],
        queryFn: ({ signal }) => listDramas({ page, pageSize, q: search || undefined, status: status === "all" ? undefined : status }, signal),
        placeholderData: keepPreviousData,
        refetchInterval: (state) => (state.state.data?.items.some((item) => item.status === "running") ? 8_000 : false),
    });
    const remove = useMutation({
        mutationFn: deleteDrama,
        onSuccess: () => {
            message.success("作品已删除");
            void queryClient.invalidateQueries({ queryKey: ["dramas"] });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除失败"),
    });
    const data = query.data;
    const counts = data?.statusCounts || {};
    const total = counts.all ?? 0;
    const filtered = Boolean(search || status !== "all");
    const openFile = (file: File) => navigate("/projects/new", { state: { file } });
    const confirmDelete = (item: DramaListItem) => {
        modal.confirm({
            title: `删除《${item.project.name}》？`,
            content: "小说原文、剧本、分镜与成片记录都会删除。此操作无法撤销。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: () => remove.mutateAsync(item.project.id),
        });
    };
    // 整页都能拖入小说：列表页不再单独放一块上传区占位置。
    const dragProps = {
        onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
        onDragLeave: (event: DragEvent) => { if (event.currentTarget === event.target) setDragging(false); },
        onDrop: (event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) openFile(file);
        },
    };

    if (query.isLoading) return <WorkspacePage className="studio-collection-page"><WorkspaceLoadingState label="正在读取作品" /></WorkspacePage>;
    if (query.isError && !data) return <WorkspacePage className="studio-collection-page"><WorkspaceErrorState description="作品列表暂时无法读取。" onRetry={() => void query.refetch()} /></WorkspacePage>;

    const actions = (
        <div className="collection-header-actions">
            <Button icon={<ClipboardPaste />} onClick={() => navigate("/projects/new?paste=1")}>粘贴正文</Button>
            <Button type="primary" icon={<Plus />} onClick={() => fileRef.current?.click()}>上传小说</Button>
        </div>
    );

    return (
        <WorkspacePage className="studio-collection-page drama-library">
            <div className="drama-root" {...dragProps}>
                <div className="studio-band">
                    <PageHeader
                        title="短剧 Agent"
                        description="从灵感构思到自动成片。与短剧 Agent 一起改编小说、设计分镜角色，全自动或精细把控推进成片。"
                        meta={<span className="app-projects-header-meta">{total} 部</span>}
                        actions={actions}
                    />

                    <div className="drama-agent-quick-start">
                        <div className="drama-agent-quick-header">
                            <div className="drama-agent-quick-badge">
                                <Sparkles className="size-3.5" />
                                <span>短剧 Agent 协同创映</span>
                            </div>
                            <span className="text-xs text-muted-foreground">一句话构思 · 自动生成人物与分集大纲</span>
                        </div>
                        <div className="drama-agent-quick-composer">
                            <input
                                className="drama-agent-quick-input"
                                type="text"
                                value={promptIdea}
                                onChange={(event) => setPromptIdea(event.target.value)}
                                onKeyDown={(event) => { if (event.key === "Enter") handleAgentIdeaSubmit(); }}
                                placeholder="输入短剧主线、题材或核心反转，例如：豪门隐姓总裁重返巅峰，首集反转拉满..."
                                aria-label="短剧灵感输入框"
                            />
                            <Button
                                type="primary"
                                icon={<Sparkles className="size-3.5" />}
                                onClick={handleAgentIdeaSubmit}
                            >
                                AI 构思短剧
                            </Button>
                        </div>
                    </div>

                    {total ? (
                        <CollectionToolbar label="短剧浏览工具" active={filtered} onReset={() => { setKeyword(""); setStatus("all"); }}>
                            <Input prefix={<Search />} value={keyword} allowClear placeholder="搜索作品名" aria-label="搜索作品名" onChange={(event) => setKeyword(event.target.value)} />
                            <div className="drama-library-status" role="radiogroup" aria-label="按状态筛选">
                                {STATUS_FILTERS.map((item) => {
                                    const count = item.value === "all" ? total : counts[item.value] || 0;
                                    if (item.value !== "all" && !count && status !== item.value) return null;
                                    return (
                                        <button key={item.value} type="button" role="radio" aria-checked={status === item.value} className={`drama-library-status-item is-${item.value}`} onClick={() => setStatus(item.value)}>
                                            {item.value !== "all" ? <span className="drama-dot" /> : null}{item.label}<b>{count}</b>
                                        </button>
                                    );
                                })}
                            </div>
                        </CollectionToolbar>
                    ) : null}
                </div>

                {!total ? (
                    <UploadHero onPick={() => fileRef.current?.click()} onPaste={() => navigate("/projects/new?paste=1")} />
                ) : data?.items.length ? (
                    <>
                        <div className={`drama-library-grid ${query.isPlaceholderData ? "is-stale" : ""}`}>
                            {data.items.map((item) => <DramaCard key={item.project.id} item={item} onDelete={() => confirmDelete(item)} />)}
                        </div>
                        <PaginationBar current={page} pageSize={pageSize} total={data.total} itemLabel="部" pageSizeOptions={PAGE_SIZES} onChange={(next, size) => { setPage(next); setPageSize(size); }} />
                    </>
                ) : (
                    <WorkspaceNoResultsState icon="projects" query={keyword} description="换一个作品名，或清除状态筛选。" onClear={() => { setKeyword(""); setStatus("all"); }} />
                )}

                {dragging ? (
                    <div className="drama-library-drop" aria-hidden>
                        <div><FileUp className="size-8" /><strong>松开即可开始新短剧</strong><span>TXT / Markdown，自动识别编码与章节</span></div>
                    </div>
                ) : null}
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) openFile(file); event.target.value = ""; }} />
            </div>
        </WorkspacePage>
    );
}

/** 还没有作品时的双轨创作引导（Agent 灵感构思 + 小说批量改编）。 */
function UploadHero({ onPick, onPaste }: { onPick: () => void; onPaste: () => void }) {
    const navigate = useNavigate();
    return (
        <div className="drama-hero-dual-track">
            <div className="drama-hero-track-card">
                <div>
                    <span className="drama-hero-track-icon"><Sparkles className="size-5" /></span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">AI 灵感共创</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">没有现成小说？说出一句剧情设定或爆款梗概，由短剧 Agent 自动生成人物小传、分集大纲与分镜提示词。</p>
                </div>
                <div>
                    <Button type="primary" icon={<Sparkles className="size-4" />} onClick={() => navigate("/projects/new")}>
                        进入短剧向导
                    </Button>
                </div>
            </div>
            <div className="drama-hero-track-card">
                <div>
                    <span className="drama-hero-track-icon"><BookOpenText className="size-5" /></span>
                    <h3 className="mt-4 text-base font-semibold text-foreground">小说批量改编</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">已有小说文稿？支持拖拽 TXT / Markdown（最高 600 万字），自动识别编码、拆解章节与场景，一键推进成片。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button icon={<FileUp className="size-4" />} onClick={onPick}>选择小说</Button>
                    <Button icon={<ClipboardPaste className="size-4" />} onClick={onPaste}>粘贴正文</Button>
                </div>
            </div>
        </div>
    );
}


function DramaCover({ item }: { item: DramaListItem }) {
    const covers = (item.coverResourceIds?.length ? item.coverResourceIds : item.coverResourceId ? [item.coverResourceId] : []).slice(0, 4);
    if (!covers.length) {
        return (
            <div className="drama-library-cover is-empty">
                <span className="drama-library-glyph">{item.project.name.slice(0, 1)}</span>
                <Clapperboard className="drama-library-empty-icon" />
            </div>
        );
    }
    return (
        <div className={`drama-library-cover is-${covers.length}`}>
            {covers.map((id) => <span key={id}><MediaThumb resourceId={id} alt="" /></span>)}
        </div>
    );
}

function DramaCard({ item, onDelete }: { item: DramaListItem; onDelete: () => void }) {
    const progress = item.episodeCount ? Math.round((item.doneCount / item.episodeCount) * 100) : 0;
    const needsAction = item.status === "paused" && Boolean(item.pauseReason);
    const stage = item.episodeCount ? `${item.doneCount}/${item.episodeCount} 集成片` : item.status === "running" ? "正在改编小说" : item.status === "draft" ? "尚未开始" : "等待分集";
    return (
        <article className={`drama-library-card is-${item.status}`}>
            <Link to={`/projects/${item.project.id}`} className="drama-library-open" aria-label={`打开《${item.project.name}》`}>
                <DramaCover item={item} />
                <span className={`drama-chip drama-library-badge is-${needsAction ? "paused" : item.status}`}><span className="drama-dot" />{needsAction ? "需要处理" : STATUS_LABEL[item.status]}</span>
                <div className="drama-library-body">
                    <h3 title={item.project.name}>{item.project.name}</h3>
                    <div className="drama-library-meta">
                        {item.styleName ? <span>{item.styleName}</span> : null}
                        <span>{item.aspectRatio}</span>
                        <RelativeTime value={item.updatedAt || item.project.updatedAt} />
                    </div>
                    <div className="drama-library-progress">
                        <span className="drama-library-progress-bar"><span style={progressFillStyle(Math.max(progress, item.episodeCount && progress === 0 ? 2 : progress))} /></span>
                        <span className="drama-library-progress-text"><b>{stage}</b>{item.spentMicrocredits ? <span>{formatCredits(item.spentMicrocredits)} 积分</span> : null}</span>
                    </div>
                    {needsAction ? <p className="drama-library-alert" title={item.pauseReason}>{item.pauseReason}</p> : null}
                </div>
            </Link>
            <div className="drama-library-menu">
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        items: [
                            { key: "open", icon: <ExternalLink className="size-3.5" />, label: <Link to={`/projects/${item.project.id}`}>打开制作台</Link> },
                            { key: "canvas", icon: <Workflow className="size-3.5" />, label: <Link to={`/canvas?projectId=${item.project.id}`}>在画布中推演</Link> },
                            { type: "divider" },
                            { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除作品", onClick: onDelete },
                        ],
                    }}
                >
                    <button type="button" className="product-icon-button" aria-label={`${item.project.name} 更多操作`}><MoreHorizontal /></button>
                </Dropdown>
            </div>
        </article>
    );
}
