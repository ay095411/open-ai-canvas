import { App, Button, Input } from "antd";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Heart, LoaderCircle, Search, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { InspirationMasonry } from "@/components/inspirations/inspiration-masonry";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { catalogIdOf, inspirationSources, type CreationInspiration, type InspirationGallerySource } from "@/lib/inspirations/catalog";
import { isIgnoredOnlineInspiration, normalizeOnlineFavorite } from "@/lib/inspirations/external-favorites";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { filterZzaiGalleryFavorites, mergeZzaiGalleryPages, toZzaiGalleryInspiration, zzaiCategoryLabel } from "@/lib/inspirations/zzai-gallery";
import { inspirationCoverRatio } from "@/lib/inspirations/masonry";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { INSPIRATION_POLICY_VERSION, resolveInspirationFavorites, getZzaiGalleryFacets, getZzaiGalleryPrompts, type ZzaiGalleryQuery, type ZzaiGallerySort } from "@/services/api/zzai-gallery";
import { getOnlineGalleryFacets, getOnlineGalleryPrompts, getInspirationPrompt, type InspirationGallerySummary, type InspirationGalleryPage, type InspirationGalleryFacets } from "@/services/api/online-gallery";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";
import { InspirationDetailModal } from "./inspiration-detail-modal";
import { InspirationAuthorizationNotice } from "./inspiration-authorization-notice";
import "./inspirations.css";

type GalleryItem = InspirationGallerySummary | CreationInspiration;
type GalleryAction = "preview" | "use" | "copy" | "favorite";
const noFavorites: string[] = [];

export function ZzaiGallery({ onUse, onPreview, userScope, initialSource = "zzai-gallery" }: { onUse: (item: CreationInspiration) => void; onPreview?: (item: CreationInspiration) => void; userScope?: string; initialSource?: InspirationGallerySource }) {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const scope = userScope ?? user?.id ?? "guest";
    const hydrated = useInspirationStore((state) => state.hydrated);
    const hydrationScope = useInspirationStore((state) => state.hydrationScope);
    const hydrationError = useInspirationStore((state) => state.hydrationError);
    const storedFavorites = useInspirationStore((state) => state.favorites);
    const storedSnapshots = useInspirationStore((state) => state.externalFavorites);
    const toggleFavorite = useInspirationStore((state) => state.toggleFavorite);
    const ready = hydrated && hydrationScope === scope;
    const canFavorite = ready && Boolean(user?.id);
    const favorites = ready ? storedFavorites : noFavorites;
    const authorizedFavorites = useMemo(() => favorites.filter((id) => id.startsWith("authorized-library:")), [favorites]);
    const requiresResolution = authorizedFavorites.length > 0;
    const localOnlineSnapshots = useMemo(() => {
        if (!ready) return [];
        const current = new Map<string, CreationInspiration>();
        for (const raw of storedSnapshots) {
            // 外部收藏可读本地快照；旧格式或损坏数据只隐藏，不删除原记录。
            try {
                const item = normalizeOnlineFavorite(raw);
                if (item.id && favorites.includes(item.id) && !isIgnoredOnlineInspiration(item)) current.set(item.id, item);
            } catch {
                /* 授权库记录由服务端 resolve 单独核验。 */
            }
        }
        return [...current.values()];
    }, [favorites, ready, storedSnapshots]);
    const resolved = useQuery({
        queryKey: ["public", "inspirations", "authorized-library", INSPIRATION_POLICY_VERSION, "favorites", scope, authorizedFavorites],
        queryFn: ({ signal }) => resolveInspirationFavorites(authorizedFavorites, signal),
        enabled: ready && Boolean(user?.id) && requiresResolution,
        retry: false,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 60_000,
    });
    const snapshots: GalleryItem[] = useMemo(
        () => [...localOnlineSnapshots, ...(ready && resolved.isSuccess && resolved.isFetchedAfterMount ? resolved.data.items.filter((item) => favorites.includes(item.id)) : [])],
        [localOnlineSnapshots, ready, resolved.isSuccess, resolved.isFetchedAfterMount, resolved.data, favorites],
    );
    const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

    const [view, setView] = useState<"online" | "favorites">("online");
    const [source, setSource] = useState<InspirationGallerySource>(initialSource);
    const licensed = source === "authorized-library";
    const catalogVersion = licensed ? INSPIRATION_POLICY_VERSION : "online-v1";
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 300);
    const searchPending = search.trim() !== debouncedSearch.trim();
    const [media, setMedia] = useState<"all" | "image" | "video">("all");
    const [category, setCategory] = useState("");
    const [model, setModel] = useState("");
    const [sort, setSort] = useState<ZzaiGallerySort>("latest");
    const [detail, setDetail] = useState<CreationInspiration | null>(null);
    const [busyId, setBusyId] = useState("");
    const actionController = useRef<AbortController | null>(null);
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const currentIntent = useRef("");
    currentIntent.current = JSON.stringify([scope, view, source, search, media, category, model, sort]);
    const cancelAction = () => {
        actionController.current?.abort();
        actionController.current = null;
        setBusyId("");
    };

    useEffect(() => {
        setDetail(null);
        setBusyId("");
        actionController.current?.abort();
        actionController.current = null;
        return () => {
            actionController.current?.abort();
            actionController.current = null;
        };
    }, [scope, view, source]);

    const query = useMemo<ZzaiGalleryQuery>(() => ({ search: debouncedSearch, mediaType: media === "all" ? undefined : media, category: category || undefined, model: model || undefined, sort, limit: 24 }), [category, debouncedSearch, media, model, sort]);
    const online = useInfiniteQuery({
        queryKey: ["public", "inspirations", source, catalogVersion, scope, query],
        queryFn: ({ pageParam, signal }): Promise<InspirationGalleryPage> => (licensed ? getZzaiGalleryPrompts : getOnlineGalleryPrompts)({ ...query, cursor: pageParam || undefined }, signal),
        initialPageParam: "",
        getNextPageParam: (page, _pages, _lastPageParam, pageParams) => (page.nextCursor && !pageParams.includes(page.nextCursor) ? page.nextCursor : undefined),
        enabled: view === "online",
        retry: false,
        // 同一 observer 切换缓存 key 不触发 refetchOnMount，列表需始终重新核验。
        staleTime: 0,
        refetchOnWindowFocus: "always",
        refetchOnMount: "always",
        refetchInterval: 60_000,
    });
    const facets = useQuery({
        queryKey: ["public", "inspirations", `${source}-facets`, catalogVersion, scope, query.mediaType],
        queryFn: ({ signal }): Promise<InspirationGalleryFacets> => (licensed ? getZzaiGalleryFacets : getOnlineGalleryFacets)(query.mediaType, signal),
        enabled: view === "online",
        retry: false,
        staleTime: 60_000,
        refetchOnWindowFocus: "always",
        refetchOnMount: "always",
        refetchInterval: 60_000,
    });
    const onlineItems = useMemo(() => (online.isSuccess && online.isFetchedAfterMount ? mergeZzaiGalleryPages<InspirationGallerySummary>(online.data.pages) : []), [online.data, online.isSuccess, online.isFetchedAfterMount]);
    const savedItems = useMemo(() => filterZzaiGalleryFavorites(snapshots, query), [favoriteSet, query, snapshots, sort]);
    const items: GalleryItem[] = view === "online" ? onlineItems : savedItems;
    const savedCategories = useMemo(() => [...new Set(snapshots.map((item) => item.category).filter((value): value is string => Boolean(value)))], [snapshots]);
    const savedModels = useMemo(() => [...new Set(snapshots.map((item) => item.model).filter((value): value is string => Boolean(value)))], [snapshots]);
    const categories = view === "online" ? (facets.isSuccess ? facets.data.categories : []) : savedCategories;
    const models = view === "online" ? (facets.isSuccess ? facets.data.models : []) : savedModels;

    const copyPrompt = useCallback(
        async (text: string, label: string) => {
            try {
                await navigator.clipboard.writeText(text);
                message.success(`${label}已复制`);
            } catch {
                message.error("复制失败，请手动选中文本");
            }
        },
        [message],
    );

    const actOnItem = useCallback(
        async (item: GalleryItem, action: GalleryAction, copyLabel = "提示词") => {
            if (actionController.current || searchPending || (action === "favorite" && !canFavorite)) return;
            const controller = new AbortController();
            actionController.current = controller;
            const requestScope = scope;
            const requestIntent = currentIntent.current;
            const id = catalogIdOf(item);
            setBusyId(id);
            try {
                const session = captureUserSession();
                if (action === "favorite" && favoriteSet.has(id)) {
                    await toggleFavorite(id);
                    return;
                }
                const loaded = toZzaiGalleryInspiration(await getInspirationPrompt(id, controller.signal));
                assertCurrentUserSession(session);
                if (catalogIdOf(loaded) !== id) throw new Error("示例与所选条目不一致");
                if (controller.signal.aborted || currentScope.current !== requestScope || currentIntent.current !== requestIntent) return;
                if (!fillablePrompt(loaded)) throw new Error("画廊详情缺少提示词，无法使用");
                if (action === "favorite") {
                    await toggleFavorite(id, loaded);
                    if (!controller.signal.aborted && currentScope.current === requestScope) message.success(favoriteSet.has(id) ? "已取消本地收藏" : "已收藏到当前账号的本地灵感库");
                } else if (action === "copy") await copyPrompt(copyLabel.includes("原文") ? loaded.prompt : fillablePrompt(loaded), copyLabel);
                else if (action === "use") onUse(loaded);
                else if (onPreview) onPreview(loaded);
                else setDetail(loaded);
            } catch (error) {
                if (!controller.signal.aborted && currentScope.current === requestScope) message.error(error instanceof Error ? error.message : "画廊详情加载失败，请重试");
            } finally {
                if (actionController.current === controller) {
                    actionController.current = null;
                    setBusyId("");
                }
            }
        },
        [canFavorite, copyPrompt, favoriteSet, message, onPreview, onUse, scope, toggleFavorite, searchPending],
    );

    const clearFilters = () => {
        cancelAction();
        setSearch("");
        setMedia("all");
        setCategory("");
        setModel("");
        setSort("latest");
    };
    const total = online.isSuccess ? online.data?.pages[0]?.total : undefined;

    return (
        <section className="mt-4 min-w-0" aria-label="在线提示词画廊">
            <div className="mb-4 flex flex-col gap-2 rounded-lg bg-surface-tertiary p-3 text-xs leading-5 text-muted-foreground">
                <p>{view === "online" ? inspirationSources[source].notice : "外部收藏保留本地提示词快照，本站审核素材仍需服务端复核；来源与许可不能相互替代。"}</p>
                <p>这里只浏览、复制和填入提示词，不会自动生成或切换项目模型。使用与新增收藏前重新读取所选来源的详情，原记录不会自动删除。</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl
                    value={view}
                    onChange={(next) => {
                        cancelAction();
                        setView(next);
                    }}
                    ariaLabel="画廊浏览范围"
                    options={[
                        { value: "online", label: "在线浏览" },
                        { value: "favorites", label: `本地收藏 ${snapshots.filter((item) => favoriteSet.has(catalogIdOf(item))).length}` },
                    ]}
                />
                <Input
                    value={search}
                    onChange={(event) => {
                        cancelAction();
                        setSearch(event.target.value);
                    }}
                    allowClear
                    prefix={<Search className="size-4" />}
                    placeholder="搜索画廊提示词"
                    aria-label="搜索画廊提示词"
                    className="sm:max-w-72"
                />
            </div>
            <div className="my-3 flex flex-wrap items-center gap-2">
                {view === "online" ? (
                    <Select
                        value={source}
                        ariaLabel="画廊素材来源"
                        className="min-w-32"
                        options={[
                            { value: "zzai-gallery", label: "在线图库" },
                            { value: "authorized-library", label: "本站审核库" },
                        ]}
                        onChange={(next) => {
                            cancelAction();
                            setSource(next);
                            setCategory("");
                            setModel("");
                            setSort("latest");
                        }}
                    />
                ) : null}
                <SegmentedControl
                    value={media}
                    onChange={(next) => {
                        cancelAction();
                        setMedia(next);
                        setCategory("");
                        setModel("");
                    }}
                    ariaLabel="画廊媒体类型"
                    size="sm"
                    options={[
                        { value: "all", label: "全部类型" },
                        { value: "image", label: "图片" },
                        { value: "video", label: "视频" },
                    ]}
                />
                <Select
                    value={category}
                    onChange={(next) => {
                        cancelAction();
                        setCategory(next);
                    }}
                    ariaLabel="画廊分类"
                    className="min-w-32"
                    options={[{ value: "", label: "全部分类" }, ...categories.map((value) => ({ value, label: zzaiCategoryLabel(value) }))]}
                />
                <Select
                    value={model}
                    onChange={(next) => {
                        cancelAction();
                        setModel(next);
                    }}
                    ariaLabel="画廊模型标注"
                    className="min-w-40"
                    showSearch
                    options={[{ value: "", label: "全部模型标注" }, ...models.map((value) => ({ value, label: value }))]}
                />
                <Select
                    value={sort}
                    onChange={(next) => {
                        cancelAction();
                        setSort(next);
                    }}
                    ariaLabel="画廊排序"
                    className="min-w-28"
                    options={[
                        { value: "latest", label: "最新发布" },
                        { value: "featured", label: "精选" },
                    ]}
                />
            </div>

            {view === "online" ? (
                <p className="mb-3 text-xs text-muted-foreground" role="status">
                    {total === undefined ? (online.isError ? "在线画廊读取失败，未获得条目总数。" : "正在读取当前筛选的条目数量…") : `当前筛选共 ${total.toLocaleString()} 条，已加载 ${onlineItems.length} 条。完整提示词在打开详情时加载。`}
                </p>
            ) : (
                <p className="mb-3 text-xs text-muted-foreground">当前筛选显示 {savedItems.length} 条收藏；外部收藏为本地快照，审核库素材经当前服务复核。详情、复制与使用会重新读取当前内容。</p>
            )}
            {view === "favorites" && (!requiresResolution || !resolved.isPending) && favorites.length > snapshots.length ? <p role="status">部分历史收藏暂不可展示，已隐藏，原记录未删除（{favorites.length - snapshots.length} 条）。</p> : null}
            {view === "favorites" && requiresResolution && resolved.isError ? (
                <p role="alert">
                    当前无法复核本站审核库收藏，相关内容已隐藏，原记录未删除。<Button onClick={() => void resolved.refetch()}>重试核验</Button>
                </p>
            ) : null}
            {!canFavorite ? (
                <p className="mb-3 text-xs leading-5 text-muted-foreground" role={hydrationError ? "alert" : undefined}>
                    {!user?.id ? "登录后可将完整提示词收藏到当前账号的浏览器本地。" : hydrationError || "本地灵感记录尚未就绪，收藏暂不可用。"}
                </p>
            ) : null}
            {view === "online" && facets.isError ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="alert">
                    <span>分类与模型选项暂不可用，仍可搜索和浏览条目。</span>
                    <Button size="small" onClick={() => void facets.refetch()}>
                        重试筛选选项
                    </Button>
                </div>
            ) : null}

            {view === "online" && (online.isPending || (!online.isFetchedAfterMount && online.isFetching)) ? <WorkspaceLoadingState label="正在加载在线画廊" detail="按需读取公开条目，不下载整库" rows={3} /> : null}
            {view === "online" && online.isError && !onlineItems.length ? <WorkspaceErrorState compact title="在线画廊暂不可用" description={online.error instanceof Error ? online.error.message : undefined} onRetry={() => void online.refetch()} /> : null}
            {view === "favorites" && !ready ? <WorkspaceState compact icon="loading" title="本地收藏暂不可用" description={hydrationError || "正在读取当前账号的本地收藏。"} /> : null}
            {view === "favorites" && ready && requiresResolution && resolved.isPending ? <WorkspaceLoadingState label="正在复核收藏授权" rows={2} /> : null}
            {!items.length && ((view === "online" && online.isSuccess && online.isFetchedAfterMount) || (view === "favorites" && ready && (!requiresResolution || resolved.isSuccess))) ? (
                <WorkspaceNoResultsState
                    compact
                    query={debouncedSearch}
                    title={view === "favorites" && !snapshots.length ? "没有可展示的收藏" : !query.search && !query.category && !query.model && !query.mediaType ? (licensed ? "尚未发布已核验素材" : "在线图库暂未返回示例") : undefined}
                    description={view === "favorites" && !snapshots.length ? "原收藏记录不会删除；可以从在线图库重新打开并收藏示例。" : undefined}
                    onClear={clearFilters}
                />
            ) : null}

            <InspirationMasonry
                key={JSON.stringify([scope, view, source, query])}
                items={items}
                busy={Boolean(busyId) || online.isFetchingNextPage}
                renderItem={(item) => {
                    const id = catalogIdOf(item);
                    const favorite = favoriteSet.has(id);
                    return (
                        <article
                            key={id}
                            className="inspiration-card"
                            tabIndex={0}
                            role="button"
                            aria-label={`预览画廊提示词：${item.title}`}
                            onClick={() => void actOnItem(item, "preview")}
                            onKeyDown={(event) => {
                                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                    event.preventDefault();
                                    void actOnItem(item, "preview");
                                }
                            }}
                        >
                            <div className="inspiration-card-cover" style={{ aspectRatio: inspirationCoverRatio(item) }}>
                                <img src={item.image} alt="" width={item.width} height={item.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
                                <span className="inspiration-card-source">{item.mode === "video" ? "视频案例" : "图片案例"}</span>
                                {busyId === id ? (
                                    <span className="inspiration-card-new" role="status">
                                        正在读取详情…
                                    </span>
                                ) : null}
                                <div className="inspiration-card-actions">
                                    {canFavorite ? (
                                        <Tooltip title={favorite ? "取消本地收藏" : "收藏完整提示词到本地"}>
                                            <button
                                                type="button"
                                                className={`inspiration-card-action${favorite ? " is-on" : ""}`}
                                                aria-label={favorite ? `取消收藏：${item.title}` : `收藏：${item.title}`}
                                                aria-pressed={favorite}
                                                disabled={Boolean(busyId)}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void actOnItem(item, "favorite");
                                                }}
                                            >
                                                <Heart className="size-3.5" fill={favorite ? "currentColor" : "none"} />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                </div>
                            </div>
                            <div className="inspiration-card-body">
                                <h3 className="inspiration-card-title" title={item.title}>
                                    {item.title}
                                </h3>
                                {item.description ? <p className="inspiration-card-desc">{item.description}</p> : null}
                                <div className="inspiration-card-tags">
                                    <span className="inspiration-chip">{zzaiCategoryLabel(item.category)}</span>
                                    {item.model ? <span className="inspiration-chip">{item.model}</span> : null}
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">{item.credit ? `来源署名：${item.credit}` : item.sourceUrl ? "原始出处未标注署名" : "原始出处未标注"}</p>
                                <InspirationAuthorizationNotice item={item} />
                                {item.sourceUrl ? (
                                    <a className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                        查看原始出处 <ExternalLink className="size-3" />
                                    </a>
                                ) : null}
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <Button
                                        size="small"
                                        icon={<Copy className="size-3.5" />}
                                        disabled={Boolean(busyId)}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void actOnItem(item, "copy");
                                        }}
                                    >
                                        复制提示词
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Wand2 className="size-3.5" />}
                                        disabled={Boolean(busyId)}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void actOnItem(item, "use");
                                        }}
                                    >
                                        带入创作
                                    </Button>
                                </div>
                            </div>
                        </article>
                    );
                }}
            />
            {view === "online" && online.isSuccess && online.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                    <Button loading={online.isFetchingNextPage} icon={online.isFetchingNextPage ? <LoaderCircle className="size-4 motion-safe:animate-spin" /> : undefined} onClick={() => void online.fetchNextPage()}>
                        加载更多
                    </Button>
                </div>
            ) : null}

            {!onPreview ? (
                <InspirationDetailModal
                    item={detail}
                    videoUrl={detail?.videoUrl}
                    categoryLabel={(item) => zzaiCategoryLabel(item.category)}
                    favorite={detail ? favoriteSet.has(catalogIdOf(detail)) : false}
                    favoriteDisabled={Boolean(busyId)}
                    onClose={() => setDetail(null)}
                    onUse={(item) => void actOnItem(item, "use")}
                    onCopy={(_text, label) => {
                        if (detail) void actOnItem(detail, "copy", label);
                    }}
                    onToggleFavorite={canFavorite ? (item) => void actOnItem(item, "favorite") : undefined}
                />
            ) : null}
        </section>
    );
}

export default ZzaiGallery;
