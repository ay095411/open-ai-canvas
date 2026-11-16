import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button, Input, Popover } from "antd";
import { ArrowDown, ArrowUpRight, Images, Info, RefreshCw, Search, SearchX, SlidersHorizontal, WifiOff, X } from "lucide-react";

import { InspirationMasonry } from "@/components/inspirations/inspiration-masonry";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { inspirationSources, type InspirationGallerySource } from "@/lib/inspirations/catalog";
import { mergeZzaiGalleryPages, zzaiCategoryLabel } from "@/lib/inspirations/zzai-gallery";
import { ApiError } from "@/services/api/request";
import { INSPIRATION_POLICY_VERSION, getZzaiGalleryFacets, getZzaiGalleryPrompts, type ZzaiGalleryQuery, type ZzaiGallerySort } from "@/services/api/zzai-gallery";
import { getOnlineGalleryFacets, getOnlineGalleryPrompts, type InspirationGalleryFacets, type InspirationGalleryPage, type InspirationGallerySummary } from "@/services/api/online-gallery";
import { useUserStore } from "@/stores/use-user-store";

import CreationInspirationDialog from "./creation-inspiration-dialog";
import { CreationShowcaseCard } from "./creation-showcase-card";
import type { CreationMode } from "./creation-types";
import "./creation-showcase-band.css";

type ShowcaseFilters = { search: string; media: "all" | "image" | "video"; category: string; model: string; sort: ZzaiGallerySort };
const DEFAULT_FILTERS: ShowcaseFilters = { search: "", media: "all", category: "", model: "", sort: "latest" };

function showcaseFailureMessage(error: unknown, nextPage: boolean): string {
    if (error instanceof ApiError) {
        if (error.status === 404 && error.reason === "not_found") return "在线示例接口尚未就绪，请确认后端已更新并重启后再试。";
        if (error.reason === "library_cursor_stale") return "素材目录已更新，需要从第一页重新加载，不能继续使用旧分页位置。";
        if (error.status === 429) return "请求过于频繁，请稍后重新加载。";
        if (error.status === undefined || error.status >= 500) return "暂时无法连接在线示例服务，请稍后重新加载。";
    }
    return nextPage ? "更多示例加载失败，已暂时隐藏旧内容；请从第一页重新核验。" : "在线示例暂不可用或未通过内容核验，请重新加载。";
}

/** 首页只读摘要；弹窗负责唯一一次首次详情请求，复制与使用前仍分别核验。 */
export function CreationShowcaseBand({ onStartPrompt, sourcesVisible = false, initialSource = "zzai-gallery" }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; sourcesVisible?: boolean; initialSource?: InspirationGallerySource }) {
    const userScope = useUserStore((state) => state.user?.id ?? "guest");
    const [source, setSource] = useState<InspirationGallerySource>(initialSource);
    const licensed = source === "authorized-library";
    const catalogVersion = licensed ? INSPIRATION_POLICY_VERSION : "online-v1";
    const [reloadRevision, setReloadRevision] = useState(0);
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const { search, media, category, model, sort } = filters;
    const debouncedSearch = useDebouncedValue(search.trim(), 300);
    const appliedSearch = search.trim() ? debouncedSearch : "";
    const searchPending = search.trim() !== appliedSearch;
    const hasFilters = Boolean(search.trim() || media !== "all" || category || model || sort !== "latest");
    const query = useMemo<ZzaiGalleryQuery>(
        () => ({ search: appliedSearch || undefined, mediaType: media === "all" ? undefined : media, category: category || undefined, model: model || undefined, sort, limit: 21 }),
        [appliedSearch, category, media, model, sort],
    );
    const [dialog, setDialog] = useState<{ item?: Pick<InspirationGallerySummary, "id" | "sourceId"> } | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    useEffect(() => {
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReducedMotion(preference.matches);
        update();
        preference.addEventListener("change", update);
        return () => preference.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        setDialog(null);
        setDialogOpen(false);
    }, [userScope]);

    const galleryKey = ["public", "inspirations", source, catalogVersion, "showcase", userScope, query, reloadRevision];
    const gallery = useInfiniteQuery({
        queryKey: galleryKey,
        queryFn: ({ pageParam, signal }): Promise<InspirationGalleryPage> => (licensed ? getZzaiGalleryPrompts : getOnlineGalleryPrompts)({ ...query, cursor: pageParam || undefined }, signal),
        initialPageParam: "",
        getNextPageParam: (page, _pages, _lastPageParam, pageParams) => (page.nextCursor && !pageParams.includes(page.nextCursor) ? page.nextCursor : undefined),
        // 换回缓存 key 也需重新读取，才能满足 isFetchedAfterMount 的核验门槛。
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 60_000,
        retry: false,
    });
    const facets = useQuery({
        queryKey: ["public", "inspirations", `${source}-facets`, catalogVersion, userScope, query.mediaType],
        queryFn: ({ signal }): Promise<InspirationGalleryFacets> => (licensed ? getZzaiGalleryFacets : getOnlineGalleryFacets)(query.mediaType, signal),
        staleTime: 60_000,
        refetchOnWindowFocus: "always",
        refetchOnMount: "always",
        refetchInterval: 60_000,
        retry: false,
    });
    const galleryReady = gallery.isSuccess && gallery.isFetchedAfterMount;
    const verifyingGallery = gallery.isPending || (!gallery.isFetchedAfterMount && gallery.isFetching);
    const entries = useMemo(() => (gallery.isSuccess && gallery.isFetchedAfterMount ? mergeZzaiGalleryPages<InspirationGallerySummary>(gallery.data.pages) : []), [gallery.data, gallery.isSuccess, gallery.isFetchedAfterMount]);
    const nextCursor = gallery.data?.pages.at(-1)?.nextCursor;
    const cursorStalled = Boolean(nextCursor && gallery.data?.pageParams.includes(nextCursor));

    const reloadGallery = () => {
        // 新查询从首屏核验；不 reset 旧查询的更新计数，否则缓存回访时无法判定核验完成。
        setReloadRevision((revision) => revision + 1);
        if (facets.isError) void facets.refetch();
    };
    const clearFilters = () => setFilters(DEFAULT_FILTERS);
    const previewEntry = (entry: InspirationGallerySummary) => {
        setDialog({ item: { id: entry.id, sourceId: entry.sourceId } });
        setDialogOpen(true);
    };
    const openHall = () => {
        setDialog({});
        setDialogOpen(true);
    };

    return (
        <section className="creation-showcase" aria-labelledby="creation-showcase-title">
            <header className="creation-showcase-head">
                <div className="creation-showcase-heading">
                    <span className="creation-showcase-eyebrow">在线示例</span>
                    <div className="creation-showcase-title-row">
                        <h2 id="creation-showcase-title">看看能拍成什么样</h2>
                        {sourcesVisible ? <ShowcaseSources entries={entries} /> : null}
                    </div>
                    <p className="creation-showcase-description">浏览作品，查看提示词，再带入你的创作。</p>
                </div>
                <button type="button" className="creation-showcase-hall-entry" onClick={openHall}>
                    灵感大厅 <ArrowUpRight size={14} aria-hidden="true" />
                </button>
            </header>
            <CreationShowcaseFilters
                source={source}
                onSourceChange={(next) => {
                    setSource(next);
                    setFilters((previous) => ({ ...previous, category: "", model: "", sort: "latest" }));
                }}
                filters={filters}
                onChange={setFilters}
                onClear={clearFilters}
                hasFilters={hasFilters}
                facets={facets.isSuccess ? facets.data : undefined}
                facetsPending={facets.isPending}
            />
            {facets.isError && !gallery.isError ? (
                <p className="creation-showcase-status" role="alert">
                    分类与模型选项暂不可用，仍可搜索和浏览在线示例。
                    <button type="button" onClick={() => void facets.refetch()} disabled={facets.isFetching}>
                        重试筛选选项
                    </button>
                </p>
            ) : null}
            <div className="creation-showcase-context">
                <p className="creation-showcase-license-note">
                    <Info size={14} aria-hidden="true" />
                    <span>{inspirationSources[source].notice}</span>
                </p>
                <p className="creation-showcase-query-status" role="status" aria-atomic="true">
                    {searchPending ? "正在应用关键词筛选…" : galleryReady ? `共 ${gallery.data.pages[0].total} 个${hasFilters ? "匹配" : "在线"}示例` : ""}
                </p>
            </div>
            {verifyingGallery ? (
                <div className="creation-showcase-loading" role="status" aria-busy="true">
                    <p className="creation-showcase-status">{gallery.data ? "正在核验在线示例…" : "正在加载在线提示词示例…"}</p>
                    <div className="creation-showcase-skeletons" aria-hidden="true">
                        {Array.from({ length: 4 }, (_, index) => (
                            <div className="creation-showcase-skeleton" key={index}>
                                <span className="creation-showcase-skeleton-cover" />
                                <span className="creation-showcase-skeleton-title" />
                                <span className="creation-showcase-skeleton-meta" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
            {gallery.isError ? (
                <div className="creation-showcase-feedback" role="alert">
                    <span className="creation-showcase-feedback-icon">
                        <WifiOff size={22} aria-hidden="true" />
                    </span>
                    <strong>在线示例暂不可用</strong>
                    <p>{showcaseFailureMessage(gallery.error, gallery.isFetchNextPageError)}</p>
                    <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={reloadGallery} disabled={gallery.isFetching || searchPending}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            {galleryReady && !entries.length && !searchPending ? (
                <div className="creation-showcase-feedback" role="status">
                    <span className="creation-showcase-feedback-icon">{hasFilters ? <SearchX size={22} aria-hidden="true" /> : <Images size={22} aria-hidden="true" />}</span>
                    <strong>{hasFilters ? "没有找到匹配的示例" : "示例正在准备中"}</strong>
                    <p>
                        {licensed
                            ? hasFilters
                                ? "没有符合当前筛选的已核验素材。试试其他关键词，或放宽筛选条件。"
                                : "尚未发布已核验素材。发布后会在这里展示。"
                            : hasFilters
                              ? "没有符合当前筛选的在线示例。试试其他关键词，或放宽筛选条件。"
                              : "在线图库暂未返回示例，请稍后重新加载。"}
                    </p>
                    {hasFilters ? <Button onClick={clearFilters}>清除筛选</Button> : null}
                </div>
            ) : null}
            {entries.length ? (
                <InspirationMasonry
                    key={JSON.stringify([userScope, source, query])}
                    className="creation-showcase-waterfall"
                    ariaLabel="图片与视频在线灵感作品"
                    items={entries}
                    busy={gallery.isFetchingNextPage || searchPending}
                    renderItem={(entry) => <CreationShowcaseCard entry={entry} disabled={searchPending} reducedMotion={reducedMotion} onPreview={() => previewEntry(entry)} />}
                />
            ) : null}
            {galleryReady && (entries.length > 0 || gallery.hasNextPage || cursorStalled) ? (
                <footer className="creation-showcase-pagination">
                    {cursorStalled ? (
                        <p className="creation-showcase-status" role="alert">
                            在线目录未返回新的分页位置，已停止重复加载。
                            <button type="button" onClick={reloadGallery} disabled={gallery.isFetching || searchPending}>
                                重新加载
                            </button>
                        </p>
                    ) : null}
                    {gallery.hasNextPage ? (
                        <button type="button" className="creation-showcase-load-more" disabled={gallery.isFetching || searchPending} aria-busy={gallery.isFetchingNextPage} onClick={() => void gallery.fetchNextPage({ cancelRefetch: false })}>
                            <span>{gallery.isFetchingNextPage ? "正在加载更多…" : "加载更多"}</span>
                            <ArrowDown size={14} aria-hidden="true" />
                        </button>
                    ) : entries.length && !cursorStalled ? (
                        <p className="creation-showcase-status" role="status">
                            已展示全部示例
                        </p>
                    ) : null}
                    <span className="creation-showcase-status" role="status">
                        已展示 {entries.length} 个示例
                    </span>
                </footer>
            ) : null}
            {dialog ? <CreationInspirationDialog key={dialog.item?.id ?? "hall"} open={dialogOpen} initialItem={dialog.item} initialSource={source} onClose={() => setDialogOpen(false)} afterClose={() => setDialog(null)} onUse={onStartPrompt} /> : null}
        </section>
    );
}

function CreationShowcaseFilters({
    source,
    onSourceChange,
    filters,
    onChange,
    onClear,
    hasFilters,
    facets,
    facetsPending,
}: {
    source: InspirationGallerySource;
    onSourceChange: (source: InspirationGallerySource) => void;
    filters: ShowcaseFilters;
    onChange: (next: ShowcaseFilters) => void;
    onClear: () => void;
    hasFilters: boolean;
    facets?: InspirationGalleryFacets;
    facetsPending: boolean;
}) {
    return (
        <div className="creation-showcase-filters" role="group" aria-label="首页在线示例筛选">
            <div className="creation-showcase-filter-primary">
                <SegmentedControl
                    value={filters.media}
                    onChange={(media) => onChange({ ...filters, media, category: "", model: "" })}
                    ariaLabel="首页示例媒体类型"
                    options={[
                        { value: "all", label: "全部" },
                        { value: "image", label: "图片" },
                        { value: "video", label: "视频" },
                    ]}
                />
                <Input
                    value={filters.search}
                    onChange={(event) => onChange({ ...filters, search: event.target.value })}
                    allowClear
                    prefix={<Search size={16} aria-hidden="true" />}
                    placeholder="搜索作品、风格或关键词"
                    aria-label="搜索首页在线示例"
                    className="creation-showcase-search"
                />
            </div>
            <div className="creation-showcase-filter-secondary">
                <span className="creation-showcase-filter-label">
                    <SlidersHorizontal size={14} aria-hidden="true" />
                    筛选
                </span>
                <Select
                    value={source}
                    onChange={onSourceChange}
                    ariaLabel="首页示例来源"
                    className="creation-showcase-filter-select"
                    options={[
                        { value: "zzai-gallery", label: "在线图库" },
                        { value: "authorized-library", label: "本站审核库" },
                    ]}
                />
                <Select
                    value={filters.category}
                    onChange={(category) => onChange({ ...filters, category })}
                    ariaLabel="首页示例分类"
                    className="creation-showcase-filter-select"
                    loading={facetsPending}
                    disabled={!facets}
                    showSearch
                    optionFilterProp="label"
                    options={[{ value: "", label: "全部分类" }, ...(facets?.categories ?? []).map((value) => ({ value, label: zzaiCategoryLabel(value) }))]}
                />
                <Select
                    value={filters.model}
                    onChange={(model) => onChange({ ...filters, model })}
                    ariaLabel="首页示例模型标注"
                    className="creation-showcase-filter-select"
                    loading={facetsPending}
                    disabled={!facets}
                    showSearch
                    optionFilterProp="label"
                    options={[{ value: "", label: "全部模型标注" }, ...(facets?.models ?? []).map((value) => ({ value, label: value }))]}
                />
                <Select
                    value={filters.sort}
                    onChange={(sort) => onChange({ ...filters, sort })}
                    ariaLabel="首页示例排序"
                    className="creation-showcase-filter-sort"
                    options={[
                        { value: "latest", label: "最新发布" },
                        { value: "featured", label: "精选" },
                    ]}
                />
                <Button type="text" className="creation-showcase-clear" icon={<X size={13} aria-hidden="true" />} disabled={!hasFilters} onClick={onClear}>
                    清除筛选
                </Button>
            </div>
        </div>
    );
}

function ShowcaseSources({ entries }: { entries: InspirationGallerySummary[] }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <span
            className="creation-inspiration-credit"
            onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                    event.stopPropagation();
                    close();
                }
            }}
        >
            <Popover
                open={open}
                onOpenChange={setOpen}
                trigger="click"
                placement="bottomLeft"
                align={{ overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
                arrow={false}
                autoAdjustOverflow
                destroyOnHidden
                classNames={{ root: "creation-inspiration-credit-popover", container: "creation-inspiration-credit-surface" }}
                content={
                    <section className="creation-inspiration-credit-panel" role="dialog" aria-label="素材来源">
                        <header>
                            <strong>素材来源</strong>
                            <button type="button" aria-label="关闭素材来源" onClick={close}>
                                <X size={16} aria-hidden="true" />
                            </button>
                        </header>
                        <div className="creation-inspiration-credit-scroll">
                            <p>保留每条示例的原始出处与署名；外部在线示例不等于已获授权，本站审核库另行标注已核验许可。</p>
                            {entries.length ? (
                                <section className="creation-inspiration-credit-works" aria-label="当前作品署名">
                                    <h3>当前作品署名</h3>
                                    <ul>
                                        {entries.map((entry) => (
                                            <li key={entry.id}>
                                                {entry.sourceUrl ? (
                                                    <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                                                        {entry.title}
                                                    </a>
                                                ) : (
                                                    <span>{entry.title}</span>
                                                )}
                                                <span>{entry.credit || (entry.sourceUrl ? "原始出处未标注署名" : "原始出处未标注")}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ) : (
                                <p>当前没有在线条目。</p>
                            )}
                        </div>
                    </section>
                }
            >
                <button ref={triggerRef} type="button" className="creation-inspiration-credit-trigger" aria-expanded={open} aria-haspopup="dialog">
                    素材来源
                </button>
            </Popover>
        </span>
    );
}
