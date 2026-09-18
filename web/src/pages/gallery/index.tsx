import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { Button, Input, Select, Modal, Spin } from "antd";
import { App } from "antd";
import { Copy, Sparkles, Video, Image as ImageIcon, Search, RefreshCw, LayoutGrid, Box } from "lucide-react";
import { useNavigate } from "react-router";
import { WorkspacePage, PageHeader } from "@/components/layout/workspace-page";
import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import {
    fetchGalleryItems,
    fetchGalleryFacets,
    recordGalleryPromptCopy,
    type GalleryPromptItem,
    type GalleryFacetsResponse,
} from "@/services/api/gallery";
import "./gallery.css";

export default function GalleryPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();

    // 筛选状态
    const [mediaType, setMediaType] = useState<string>("all");
    const [selectedModel, setSelectedModel] = useState<string>("all");
    const [keyword, setKeyword] = useState<string>("");
    const [debouncedKeyword, setDebouncedKeyword] = useState<string>("");

    // 数据状态
    const [items, setItems] = useState<GalleryPromptItem[]>([]);
    const [total, setTotal] = useState<number>(0);
    const [page, setPage] = useState<number>(1);
    const pageSize = 40;
    const [loading, setLoading] = useState<boolean>(false);
    const [hasMore, setHasMore] = useState<boolean>(true);
    const [facets, setFacets] = useState<GalleryFacetsResponse | null>(null);
    const loadingRef = useRef(false);

    // 详情状态
    const [detailItem, setDetailItem] = useState<GalleryPromptItem | null>(null);

    // 滑动指示条
    const tabsRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    const stickyRef = useRef<HTMLDivElement>(null);
    const [isStuck, setIsStuck] = useState(false);

    // 监听滚动判断是否吸顶
    useEffect(() => {
        const el = stickyRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setIsStuck(!entry.isIntersecting),
            { threshold: 0, rootMargin: "-1px 0px 0px 0px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // 格式化模型列表供 Tab 切换罗列
    const modelTabs = useMemo(() => {
        const allCount = facets?.total ?? total;
        const list = [{ label: "全部模型", value: "all", count: allCount }];
        if (facets?.by_model) {
            for (const [m, count] of Object.entries(facets.by_model)) {
                list.push({ label: m, value: m, count });
            }
        }
        return list;
    }, [facets, total]);

    useLayoutEffect(() => {
        const tabs = tabsRef.current;
        const indicator = indicatorRef.current;
        const active = tabs?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
        if (!tabs || !indicator || !active) return;
        indicator.style.left = `${active.offsetLeft}px`;
        indicator.style.width = `${active.offsetWidth}px`;
    }, [selectedModel, modelTabs]);

    // 防抖搜索
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedKeyword(keyword.trim());
        }, 300);
        return () => clearTimeout(timer);
    }, [keyword]);

    // 加载 facets 统计数据
    useEffect(() => {
        void fetchGalleryFacets()
            .then((res) => setFacets(res))
            .catch(() => {});
    }, []);

    const loadItems = useCallback(async (isReset = false) => {
        if (!isReset && loadingRef.current) return;
        const targetPage = isReset ? 1 : page + 1;
        loadingRef.current = true;
        setLoading(true);

        try {
            const res = await fetchGalleryItems({
                page: targetPage,
                pageSize,
                media_type: mediaType !== "all" ? mediaType : undefined,
                model: selectedModel !== "all" ? selectedModel : undefined,
                keyword: debouncedKeyword ? debouncedKeyword : undefined,
            });

            if (isReset) {
                setItems(res.items);
                setPage(1);
            } else {
                setItems((prev) => [...prev, ...res.items]);
                setPage(targetPage);
            }
            setTotal(res.total);
            setHasMore(targetPage * pageSize < res.total);
        } catch {
            void message.error("加载画廊数据失败");
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [debouncedKeyword, mediaType, page, selectedModel]);

    useEffect(() => {
        void loadItems(true);
    }, [mediaType, selectedModel, debouncedKeyword]);

    // 复制 Prompt 动作（默认优先复制中文）
    const handleCopy = (item: GalleryPromptItem, id: number, preferZh = true) => {
        const text = preferZh ? (item.prompt_zh || item.prompt) : (item.prompt || item.prompt_zh);
        if (!text) return;
        const label = preferZh ? (item.prompt_zh ? "中文提示词" : "英文提示词") : (item.prompt ? "英文提示词" : "中文提示词");
        void navigator.clipboard.writeText(text);
        void message.success(`已复制${label}`);
        void recordGalleryPromptCopy(id);
    };

    // 发送到自由画布（创建对应类型节点并预填提示词）
    const handleSendToCanvas = (item: GalleryPromptItem) => {
        const nodeType = item.media_type === "video" ? "video" : "image";
        const prompt = item.prompt_zh || item.prompt || "";
        sessionStorage.setItem("canvas_draft_node", JSON.stringify({ type: nodeType, prompt }));
        message.success("提示词已就绪，正在打开画布...");
        navigate("/canvas");
    };

    const mediaTypeOptions = [
        { label: "全部素材", value: "all" },
        { label: "图片", value: "image" },
        { label: "视频", value: "video" },
    ];

    return (
        <WorkspacePage className="library-page gallery-library-page" grid>
            <div className={`gallery-sticky-header${isStuck ? " is-stuck" : ""}`} ref={stickyRef}>
                <PageHeader
                    title="灵感画廊"
                    description="精选 AI 创作提示词与高画质镜头样例，一键复用至自由画布。"
                />

                <div className="skills-browse-bar gallery-browse-bar">
                    {/* 仿照技能库风格的模型 Tabs 导航 */}
                    <div className="skills-navigation">
                        <div className="skills-tabs" ref={tabsRef} role="tablist" aria-label="模型分类">
                            <span className="skills-tabs-indicator" ref={indicatorRef} aria-hidden="true" />
                            {modelTabs.map((tab) => {
                                const active = selectedModel === tab.value;
                                return (
                                    <button
                                        key={tab.value}
                                        type="button"
                                        role="tab"
                                        tabIndex={active ? 0 : -1}
                                        aria-selected={active}
                                        className={`skills-tab${active ? " is-active" : ""}`}
                                        onClick={() => setSelectedModel(tab.value)}
                                    >
                                        <Box className="size-4" />
                                        <span>{tab.label}</span>
                                        {tab.count !== undefined ? <span className="skills-tab-count">{tab.count}</span> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 搜索与媒体类型过滤工具条 */}
                    <CollectionToolbar active={Boolean(keyword.trim() || mediaType !== "all" || selectedModel !== "all")} onReset={() => { setKeyword(""); setMediaType("all"); setSelectedModel("all"); }}>
                        <Input
                            className="min-w-0 sm:!w-64"
                            prefix={<Search className="size-4 text-foreground/38" />}
                            value={keyword}
                            allowClear
                            placeholder="搜索画面、风格、提示词..."
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                        <Select
                            aria-label="媒体类型"
                            className="w-28"
                            value={mediaType}
                            options={mediaTypeOptions}
                            onChange={(val) => setMediaType(val)}
                        />
                    </CollectionToolbar>
                </div>
            </div>

            {/* 瀑布流主体 */}
            <main className="gallery-masonry-grid">
                {items.map((item) => (
                    <article key={item.id} className="gallery-card">
                        <div className="gallery-card-media" onClick={() => setDetailItem(item)}>
                            {item.media_type === "video" ? (
                                <video
                                    src={item.media_url || item.cover_url}
                                    poster={item.cover_url}
                                    muted
                                    loop
                                    playsInline
                                    onMouseEnter={(e) => void e.currentTarget.play()}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.pause();
                                        e.currentTarget.currentTime = 0;
                                    }}
                                />
                            ) : (
                                <img
                                    src={item.cover_url}
                                    alt={item.title}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                />
                            )}

                            <span className="gallery-card-type-tag">
                                {item.media_type === "video" ? <Video className="size-3" /> : <ImageIcon className="size-3" />}
                                {item.media_type === "video" ? "视频" : "图片"}
                            </span>

                            {/* 悬停快捷操作 */}
                            <div className="gallery-card-hover-actions" onClick={(e) => e.stopPropagation()}>
                                <Button
                                    size="small"
                                    type="primary"
                                    icon={<Sparkles className="size-3.5" />}
                                    onClick={() => handleSendToCanvas(item)}
                                >
                                    去画布
                                </Button>
                                <Button
                                    size="small"
                                    icon={<Copy className="size-3.5" />}
                                    onClick={() => handleCopy(item, item.id)}
                                >
                                    复制提示词
                                </Button>
                            </div>
                        </div>

                        <div className="gallery-card-body">
                            <h3 className="gallery-card-title" title={item.title}>{item.title}</h3>
                            {item.description && (
                                <p className="gallery-card-desc">{item.description}</p>
                            )}

                            <div className="gallery-card-footer">
                                <span className="gallery-model-tag" title={item.model}>{item.model}</span>
                                {item.media_width && item.media_height ? (
                                    <span>{item.media_width}×{item.media_height}</span>
                                ) : null}
                            </div>
                        </div>
                    </article>
                ))}
            </main>

            {/* 加载更多 / 底部指示 */}
            <div className="py-8 flex justify-center items-center gap-3">
                {loading && <Spin />}
                {!loading && hasMore && (
                    <Button onClick={() => void loadItems(false)} icon={<RefreshCw className="size-3.5" />}>
                        加载更多
                    </Button>
                )}
                {!loading && !hasMore && items.length > 0 && (
                    <span className="text-xs text-[var(--user-ink-soft,var(--muted-foreground))]">已经到底了（共 {total} 条）</span>
                )}
                {!loading && items.length === 0 && (
                    <span className="text-sm text-[var(--user-ink-soft,var(--muted-foreground))]">没有匹配到画廊条目</span>
                )}
            </div>

            {/* 详情弹窗（中间弹出） */}
            <Modal
                open={Boolean(detailItem)}
                onCancel={() => setDetailItem(null)}
                width="min(860px, calc(100vw - 32px))"
                centered
                destroyOnHidden
                rootClassName="gallery-detail-modal"
                title={detailItem?.title || "资产详情"}
                footer={
                    detailItem ? (
                        <div className="flex items-center justify-end gap-2 pt-2">
                            <Button onClick={() => setDetailItem(null)}>
                                关闭
                            </Button>
                            <Button
                                type="primary"
                                icon={<Sparkles className="size-4" />}
                                onClick={() => handleSendToCanvas(detailItem)}
                            >
                                在自由画布中使用
                            </Button>
                        </div>
                    ) : null
                }
            >
                {detailItem && (
                    <div className="gallery-detail-modal-body">
                        {/* 效果预览区域 */}
                        <div className="gallery-preview-section">
                            <div className="gallery-preview-header">
                                <span className="flex items-center gap-1.5 font-medium text-[var(--user-ink,var(--foreground))]">
                                    {detailItem.media_type === "video" ? <Video className="size-4 text-primary" /> : <ImageIcon className="size-4 text-primary" />}
                                    生成效果预览
                                </span>
                                <span className="gallery-model-tag">{detailItem.model}</span>
                            </div>
                            <div className="gallery-detail-media-wrap">
                                {detailItem.media_type === "video" ? (
                                    <video
                                        key={detailItem.media_url || detailItem.cover_url}
                                        src={detailItem.media_url || detailItem.cover_url}
                                        poster={detailItem.cover_url}
                                        controls
                                        autoPlay
                                        loop
                                        playsInline
                                    />
                                ) : (
                                    <img
                                        src={detailItem.media_url || detailItem.cover_url}
                                        alt={detailItem.title}
                                        referrerPolicy="no-referrer"
                                    />
                                )}
                            </div>
                        </div>

                        {detailItem.prompt && (
                            <div className="gallery-prompt-box">
                                <div className="gallery-prompt-box-header">
                                    <span>完整英文提示词 (Prompt)</span>
                                    <Button
                                        size="small"
                                        type="link"
                                        icon={<Copy className="size-3.5" />}
                                        onClick={() => handleCopy(detailItem, detailItem.id, false)}
                                    >
                                        复制英文
                                    </Button>
                                </div>
                                <pre className="gallery-prompt-text">{detailItem.prompt}</pre>
                            </div>
                        )}

                        {detailItem.prompt_zh && (
                            <div className="gallery-prompt-box">
                                <div className="gallery-prompt-box-header">
                                    <span>中文提示词参考</span>
                                    <Button
                                        size="small"
                                        type="link"
                                        icon={<Copy className="size-3.5" />}
                                        onClick={() => handleCopy(detailItem, detailItem.id)}
                                    >
                                        复制中文
                                    </Button>
                                </div>
                                <p className="gallery-prompt-text">{detailItem.prompt_zh}</p>
                            </div>
                        )}

                        <div className="gallery-detail-meta-list">
                            <div className="gallery-detail-meta-item">
                                <strong>对应模型：</strong>
                                <span>{detailItem.model}</span>
                            </div>
                            {detailItem.media_width && detailItem.media_height && (
                                <div className="gallery-detail-meta-item">
                                    <strong>分辨率规格：</strong>
                                    <span>{detailItem.media_width} × {detailItem.media_height}</span>
                                </div>
                            )}
                            {detailItem.tags && detailItem.tags.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                    <strong>相关标签：</strong>
                                    {detailItem.tags.map((t) => (
                                        <span key={t} className="gallery-detail-tag">
                                            #{t}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </WorkspacePage>
    );
}
