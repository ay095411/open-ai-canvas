import { App, Button, Dropdown, Popconfirm } from "antd";
import type { MenuProps } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Check, ChevronDown, FileText, FolderOpen, HardDrive, Image as ImageIcon, LoaderCircle, Music2, Puzzle, RotateCcw, Search, Trash2, Upload, UserRound, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserStore } from "@/stores/use-user-store";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AudioPlayButton, AudioWaveArt, CharacterAssetCover } from "@/components/assets/asset-rich-cover";
import { AssetLibraryCard } from "@/components/assets/asset-library-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { PaginationBar } from "@/components/layout/workspace-page";
import { cn } from "@/lib/utils";
import { getActiveUserScope } from "@/lib/user-scope";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { deleteAssetsWithRemoteSync, loadAssetLibraryPage, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";

export type AssetPickerMediaKind = "image" | "video" | "audio" | "text";

export const ASSET_PICKER_MEDIA_KIND_LABELS: Record<AssetPickerMediaKind, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };

const DEFAULT_MEDIA_KINDS: AssetPickerMediaKind[] = ["image", "video", "audio"];

export type AssetLibraryPickerItem = {
    id: string;
    title: string;
    category: string;
    archived?: boolean;
    kindLabel: string;
    /** 媒体类型筛选依据；缺省时按本地素材或插件素材的 kind 推断。 */
    mediaKind?: AssetPickerMediaKind;
    asset?: Asset;
    imageUrl?: string;
    imageStorageKey?: string;
    imageFit?: "cover" | "contain";
    description?: string;
    searchText?: string;
    disabledReason?: string;
    folderId?: string;
    external?: ExternalAssetPickerReference;
};

export type AssetLibraryPickerFolder = {
    id: string;
    parentId?: string;
    name: string;
};

type Props = {
    remoteLibrary?: boolean;
    remoteKind?: string;
    /** 远端素材库里的角色卡是否展示并可选（插入画布时会作为角色卡节点）。 */
    allowCharacters?: boolean;
    /** 调用方能处理 onConfirm 的 pickedItems 时设为 true：远端分页里不在本地缓存的素材也可选。 */
    acceptRemoteItems?: boolean;
    /** 远端条目不依赖本地缓存，仍需按调用方当前能力校验。 */
    remoteItemDisabledReason?: (asset: Asset) => string | undefined;
    /** 左侧「媒体类型」筛选项；只有一种类型或已由 remoteKind 固定时不展示该分组。 */
    mediaKinds?: AssetPickerMediaKind[];
    open: boolean;
    items: AssetLibraryPickerItem[];
    categoryLabels: Record<string, string>;
    initialCategory?: string;
    initialFolderId?: string;
    folders?: AssetLibraryPickerFolder[];
    initialSelectedIds?: Iterable<string>;
    multiple?: boolean;
    title?: string;
    eyebrow?: string;
    confirmLabel?: (count: number) => string;
    emptyTitle?: string;
    emptyDescription?: string;
    footerNote?: string;
    loading?: boolean;
    pagination?: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void };
    folderActionLabel?: string;
    folderActionSource?: "local" | "all";
    upload?: {
        accept: string;
        description: string;
        /** 上传资源并写入本地 asset store，返回成功项 ID；保存与刷新由选择器完成。写入前检查 signal，防止账号切换后串数据。 */
        onUpload: (files: FileList, signal: AbortSignal) => Promise<string[]>;
        external?: {
            accept: string;
            description: string;
            onUpload: (files: FileList, folderId?: string) => Promise<AssetLibraryPickerItem[]>;
        };
    };
    onClose: () => void;
    /** pickedItems 包含远端分页里选中的条目（它们不在调用方传入的 items 里）。 */
    onConfirm: (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => Promise<void> | void;
    onFolderAction?: (folderId: string) => Promise<void> | void;
};

export function AssetLibraryPickerModal({
    remoteLibrary = false,
    remoteKind,
    allowCharacters = false,
    acceptRemoteItems = false,
    remoteItemDisabledReason,
    mediaKinds = DEFAULT_MEDIA_KINDS,
    open,
    items,
    categoryLabels,
    initialCategory = "all",
    initialFolderId = "all",
    folders = [],
    initialSelectedIds,
    multiple = true,
    title = "素材库",
    eyebrow = "参考内容",
    confirmLabel = (count) => `使用已选素材${count ? `（${count}）` : ""}`,
    emptyTitle = "这个分类还没有素材",
    emptyDescription = "换个分类后再试。",
    footerNote,
    loading = false,
    pagination,
    folderActionLabel = "将文件夹放到画布",
    folderActionSource = "all",
    upload,
    onClose,
    onConfirm,
    onFolderAction,
}: Props) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [isRecycleBin, setIsRecycleBin] = useState(initialCategory === "archived");
    const [category, setCategory] = useState(initialCategory === "archived" ? "all" : initialCategory);
    const [mediaKind, setMediaKind] = useState<AssetPickerMediaKind | "all">("all");
    const [folderId, setFolderId] = useState(initialFolderId);
    const [source, setSource] = useState<"local" | "plugin">("local");
    const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploadedItems, setUploadedItems] = useState<AssetLibraryPickerItem[]>([]);
    const [working, setWorking] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState("");
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const [remotePage, setRemotePage] = useState(1);
    const [remotePageSize, setRemotePageSize] = useState(40);
    const [remoteKeyword, setRemoteKeyword] = useState("");
    const remoteEnabled = remoteLibrary && Boolean(userId) && source === "local";
    useEffect(() => {
        const timer = window.setTimeout(() => setRemoteKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    useEffect(() => setRemotePage(1), [category, mediaKind, remoteKeyword, isRecycleBin, open]);
    // remoteKind 是调用方写死的能力约束；媒体类型筛选只在没有该约束时参与服务端查询。
    const remoteQueryKind = remoteKind || (isRecycleBin || mediaKind === "all" ? undefined : mediaKind);
    const remoteStatus = isRecycleBin ? "archived" : "active";
    const remotePageQuery = (page: number) => ({
        queryKey: ["asset-picker", userId, remoteStatus, page, remotePageSize, category, remoteKeyword, remoteQueryKind],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
            loadAssetLibraryPage({
                page,
                pageSize: remotePageSize,
                kind: remoteQueryKind,
                category: isRecycleBin || category === "all" || category === remoteQueryKind ? undefined : category,
                status: remoteStatus,
                query: remoteKeyword,
                signal,
            }),
    });
    const remoteQuery = useQuery({
        ...remotePageQuery(remotePage),
        enabled: remoteEnabled && open && sessionHydrated,
        // 仅在同一账号、同一浏览范围内保留分页，避免正常素材和回收站串页。
        placeholderData: (previous, query) => (query?.queryKey[1] === userId && query?.queryKey[2] === remoteStatus ? previous : undefined),
    });
    // 导航统计独立于结果页；facets 只按 status 聚合，不能用筛选后的 total 或当前页条数代替。
    const activeSummaryQuery = useQuery({
        queryKey: ["asset-picker", userId, "stats", "active"],
        queryFn: ({ signal }) => loadAssetLibraryPage({ page: 1, pageSize: 1, status: "active", signal }),
        enabled: remoteEnabled && open && sessionHydrated,
    });
    const archivedSummaryQuery = useQuery({
        queryKey: ["asset-picker", userId, "stats", "archived"],
        queryFn: ({ signal }) => loadAssetLibraryPage({ page: 1, pageSize: 1, status: "archived", signal }),
        enabled: remoteEnabled && open && sessionHydrated,
    });
    // 调用方的 items 只是本地缓存，不代表可插入集合（分页结果大多不在缓存里）。能接收 pickedItems 的
    // 调用方（acceptRemoteItems）允许直接选远端条目；其余调用方保持"不在 items 里就不可选"的旧约束。
    const remoteItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            (remoteQuery.data?.assets || [])
                .filter((asset) => asset.kind !== "model" && (asset.kind !== "entity" || (allowCharacters && asset.category === "character")))
                .map((asset) =>
                    remoteAssetToPickerItem(
                        asset,
                        items.find((item) => item.id === asset.id),
                        acceptRemoteItems,
                        remoteItemDisabledReason?.(asset),
                    ),
                ),
        [acceptRemoteItems, allowCharacters, remoteItemDisabledReason, remoteQuery.data, items],
    );
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const uploadAbortRef = useRef<AbortController | null>(null);
    useEffect(() => () => uploadAbortRef.current?.abort(), []);
    const pickedRemoteRef = useRef(new Map<string, AssetLibraryPickerItem>());
    const initialSelectedIdsRef = useRef(initialSelectedIds);
    const itemsRef = useRef(items);
    initialSelectedIdsRef.current = initialSelectedIds;
    const allItems = useMemo(() => {
        const known = new Set(items.map((item) => item.id));
        return [...items, ...uploadedItems.filter((item) => !known.has(item.id))];
    }, [items, uploadedItems]);
    itemsRef.current = allItems;
    const localItems = useMemo(() => allItems.filter((item) => !item.external), [allItems]);
    // 远端成功且有可展示素材时用远端。真正的空结果保持空列表。
    // 仅在远端空而本地仍有素材、或远端总数>0 但本页全被排除时回退本地，避免合法空搜索被缓存铺满。
    const remoteTotal = remoteQuery.data?.total ?? 0;
    const remoteReady = remoteEnabled && remoteQuery.isSuccess;
    useEffect(() => {
        if (!remoteReady || remoteQuery.isFetching || remoteQuery.isPlaceholderData) return;
        const lastPage = Math.max(1, Math.ceil(remoteTotal / remotePageSize));
        if (remotePage > lastPage) setRemotePage(lastPage);
    }, [remotePage, remotePageSize, remoteQuery.isFetching, remoteQuery.isPlaceholderData, remoteReady, remoteTotal]);
    // 只有在未做任何分类/类型筛选（全量状态）、且远端总数为 0 但本地有未同步条目时，才回退未同步数据。
    // 用户一旦主动筛选了媒体类型、分类或输入了搜索词，必须严格信赖服务端的精准查询结果，绝不把其他类型的本地缓存糊上来！
    const isFiltered = isRecycleBin || mediaKind !== "all" || category !== "all" || Boolean(remoteKeyword);
    const preferLocalUnsynced = remoteReady && !isFiltered && remoteTotal === 0 && localItems.length > 0;
    const remoteEntityOnlyPage = remoteReady && !isFiltered && remoteItems.length === 0 && remoteTotal > 0 && !allowCharacters;
    const useRemoteItems = remoteReady && !preferLocalUnsynced && !remoteEntityOnlyPage;
    const effectivePagination = useRemoteItems
        ? {
              current: remotePage,
              pageSize: remotePageSize,
              total: remoteTotal,
              onChange: (page: number, pageSize: number) => {
                  setRemotePage(page);
                  setRemotePageSize(pageSize);
              },
          }
        : pagination;
    const pluginItems = useMemo(() => allItems.filter((item) => Boolean(item.external)), [allItems]);
    const hasPluginSource = useMemo(() => Object.keys(categoryLabels).some((value) => value.startsWith("external:")) || pluginItems.some((item) => item.category.startsWith("external:")), [categoryLabels, pluginItems]);
    const localActiveItems = useMemo(() => localItems.filter((item) => !item.archived), [localItems]);
    const libraryItems = useMemo(() => (source === "plugin" ? pluginItems.filter((item) => !item.archived) : localActiveItems), [localActiveItems, pluginItems, source]);
    // 媒体类型数据源：远端模式下服务端已按 remoteQueryKind 过滤，本地模式在前端按 mediaKind 过滤。
    const sourceItems = useMemo(() => {
        if (source === "plugin") {
            if (mediaKind === "all") return pluginItems;
            return pluginItems.filter((item) => pickerItemMediaKind(item) === mediaKind);
        }
        if (useRemoteItems) {
            return remoteItems;
        }
        if (isRecycleBin || mediaKind === "all") return localItems;
        return localItems.filter((item) => pickerItemMediaKind(item) === mediaKind);
    }, [isRecycleBin, localItems, mediaKind, pluginItems, useRemoteItems, remoteItems, source]);
    const activeSourceItems = useMemo(() => sourceItems.filter((item) => !item.archived), [sourceItems]);
    const mediaKindOptions = useMemo(() => (remoteKind ? [] : Array.from(new Set(mediaKinds))), [mediaKinds, remoteKind]);
    const sourceFolders = source === "plugin" ? folders : [];
    const showCategories = source === "local" || !sourceFolders.length;
    const normalCategories = useMemo(
        () =>
            remoteEnabled ? Object.keys(categoryLabels).filter((value) => value !== "archived" && !value.startsWith("external:")) : ["all", ...Array.from(new Set(libraryItems.map((item) => item.category || "other"))).filter((value) => value !== "all")],
        [categoryLabels, libraryItems, remoteEnabled],
    );

    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return sourceItems.filter((item) => {
            if (isRecycleBin) {
                if (!item.archived) return false;
            } else if (item.archived || (category !== "all" && item.category !== category)) {
                return false;
            }
            if (folderId !== "all" && (item.folderId || "") !== folderId) return false;
            return !query || [item.title, item.searchText || "", item.description || ""].join(" ").toLowerCase().includes(query);
        });
    }, [category, folderId, isRecycleBin, keyword, sourceItems]);

    // 汇总已知所有可用条目字典，确保跨分页远端条目的选中与有效性校验无遗漏
    const itemLookup = useMemo(() => {
        const map = new Map<string, AssetLibraryPickerItem>();
        for (const item of allItems) map.set(item.id, item);
        for (const item of remoteItems) map.set(item.id, item);
        for (const item of pickedRemoteRef.current.values()) map.set(item.id, item);
        return map;
    }, [allItems, remoteItems, selected]);

    const selectedIds = useMemo(
        () =>
            Array.from(selected).filter((id) => {
                const item = itemLookup.get(id);
                return !item?.disabledReason;
            }),
        [itemLookup, selected],
    );
    const archivedSelectedIds = useMemo(() => selectedIds.filter((id) => itemLookup.get(id)?.archived), [itemLookup, selectedIds]);

    useEffect(() => {
        if (!open) return;

        setFolderId(initialFolderId);
        setIsRecycleBin(initialCategory === "archived");
        setCategory(initialCategory === "archived" ? "all" : initialCategory);
        setMediaKind("all");
        setSource("local");
        setKeyword("");
        setRemoteKeyword("");
        setRemotePage(1);
        setUploadedItems([]);
        pickedRemoteRef.current.clear();
        const selectableIds = new Set(itemsRef.current.filter((item) => !item.disabledReason).map((item) => item.id));
        setSelected(new Set(Array.from(initialSelectedIdsRef.current || []).filter((id) => selectableIds.has(id))));
        setWorking(false);
        setUploadingCount(0);
        setError("");
    }, [initialCategory, initialFolderId, open, userId]);

    useEffect(() => {
        if (category === "all" || normalCategories.includes(category)) return;
        // 远端分页还在加载时分类列表是临时的，不能据此把用户刚点的分类改回"全部"。
        if (remoteEnabled && (remoteQuery.isFetching || !remoteQuery.isSuccess)) return;
        setCategory("all");
    }, [normalCategories, category, remoteEnabled, remoteQuery.isFetching, remoteQuery.isSuccess]);

    useEffect(() => {
        if (hasPluginSource || source === "local") return;
        setSource("local");
    }, [hasPluginSource, source]);

    useEffect(() => {
        if (mediaKind === "all" || mediaKindOptions.includes(mediaKind)) return;
        setMediaKind("all");
    }, [mediaKind, mediaKindOptions]);

    const selectSource = (nextSource: "local" | "plugin") => {
        if (working || (nextSource === "plugin" && !hasPluginSource)) return;
        if (isRecycleBin) clearSelection();
        setSource(nextSource);
        setIsRecycleBin(false);
        setCategory("all");
        setMediaKind("all");
        setFolderId("all");
        setKeyword("");
        setRemoteKeyword("");
        setRemotePage(1);
        setError("");
    };

    const toggle = (item: AssetLibraryPickerItem) => {
        if (item.disabledReason || working) return;
        setError("");
        setSelected((current) => {
            if (!multiple) {
                if (current.has(item.id)) {
                    pickedRemoteRef.current.delete(item.id);
                    return new Set();
                }
                pickedRemoteRef.current.clear();
                if (item.asset && !allItems.some((known) => known.id === item.id)) {
                    pickedRemoteRef.current.set(item.id, item);
                }
                return new Set([item.id]);
            }
            const next = new Set(current);
            if (next.has(item.id)) {
                next.delete(item.id);
                pickedRemoteRef.current.delete(item.id);
            } else {
                next.add(item.id);
                // 远端分页条目翻页后就不在列表里了；选中时记下来，确认时仍能转成插入内容。
                if (item.asset && !allItems.some((known) => known.id === item.id)) {
                    pickedRemoteRef.current.set(item.id, item);
                }
            }
            return next;
        });
    };

    const clearSelection = () => {
        if (working) return;
        setSelected(new Set());
        pickedRemoteRef.current.clear();
        setError("");
    };

    const selectLibraryFilter = (nextCategory: string, nextMediaKind: AssetPickerMediaKind | "all") => {
        if (working) return;
        if (isRecycleBin) {
            clearSelection();
            setKeyword("");
            setRemoteKeyword("");
        }
        setIsRecycleBin(false);
        setCategory(nextCategory);
        setMediaKind(nextMediaKind);
        setRemotePage(1);
    };

    const selectRecycleBin = () => {
        if (working || isRecycleBin) return;
        clearSelection();
        setIsRecycleBin(true);
        setCategory("all");
        setMediaKind("all");
        setFolderId("all");
        setKeyword("");
        setRemoteKeyword("");
        setRemotePage(1);
    };

    const refreshRemoteLibrary = () => {
        if (!remoteEnabled) return;
        void queryClient.invalidateQueries({ queryKey: ["asset-picker", userId] });
    };

    const confirm = async () => {
        if (!selectedIds.length || working) return;
        setWorking(true);
        setError("");
        try {
            const known = new Set(allItems.map((item) => item.id));
            await onConfirm(selectedIds, [...allItems, ...[...pickedRemoteRef.current.values()].filter((item) => !known.has(item.id))]);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "素材操作失败，请重试");
        } finally {
            setWorking(false);
        }
    };

    const handleRestoreSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            for (const id of archivedSelectedIds) {
                useAssetStore.getState().updateAsset(id, { status: "confirmed" });
            }
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow([]);
            setSelected(new Set());
            pickedRemoteRef.current.clear();
            message.success(`已还原 ${archivedSelectedIds.length} 个素材至素材库`);
            setIsRecycleBin(false);
            setKeyword("");
            setRemoteKeyword("");
        } catch (error) {
            message.warning(localSavedRemotePendingMessage("已在本地还原", error));
        } finally {
            setWorking(false);
            refreshRemoteLibrary();
        }
    };

    const handleDeleteSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(archivedSelectedIds);
            setSelected(new Set());
            pickedRemoteRef.current.clear();
            message.success(`已彻底删除 ${archivedSelectedIds.length} 个素材`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "删除失败");
        } finally {
            setWorking(false);
            refreshRemoteLibrary();
        }
    };

    const handleEmptyRecycleBin = async () => {
        if (working || (remoteEnabled && remoteQuery.isFetching)) return;
        const toDelete = visibleItems.filter((item) => item.archived);
        if (!toDelete.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(toDelete.map((item) => item.id));
            setSelected(new Set());
            pickedRemoteRef.current.clear();
            message.success(`已删除${remoteEnabled ? "当前页" : "回收站"} ${toDelete.length} 个素材`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "清空回收站失败");
        } finally {
            setWorking(false);
            refreshRemoteLibrary();
        }
    };

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length || working || (source === "local" && !upload) || (source === "plugin" && !upload?.external)) return;
        const controller = new AbortController();
        uploadAbortRef.current?.abort();
        uploadAbortRef.current = controller;
        const uploadUserId = userId;
        const uploadScope = getActiveUserScope();
        const unsubscribe = useUserStore.subscribe((state, previous) => {
            if (state.user?.id !== previous.user?.id) controller.abort();
        });
        const requireCurrentUpload = () => {
            if (uploadScope !== getActiveUserScope() || uploadUserId !== useUserStore.getState().user?.id) controller.abort();
            controller.signal.throwIfAborted();
        };
        let saveStage: "upload" | "local" | "remote" = "upload";
        setWorking(true);
        setError("");
        setUploadingCount(files.length);
        try {
            requireCurrentUpload();
            if (source === "plugin") {
                const uploaded = await upload!.external!.onUpload(files, folderId === "all" ? undefined : folderId);
                requireCurrentUpload();
                setUploadedItems((current) => [...current, ...uploaded]);
                const ids = uploaded.map((item) => item.id);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            } else {
                const ids = await upload!.onUpload(files, controller.signal);
                requireCurrentUpload();
                if (!ids.length) return;
                saveStage = "local";
                await flushAssetStorePersistence();
                requireCurrentUpload();
                if (remoteLibrary) {
                    saveStage = "remote";
                    await saveRemoteUserDataNow([]);
                    requireCurrentUpload();
                }
                setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
                if (remoteLibrary) {
                    setRemotePage(1);
                    try {
                        // 首屏请求可能早于素材保存开始，先取消它，避免刷新复用旧快照。
                        await Promise.all([queryClient.cancelQueries({ queryKey: ["asset-picker", uploadUserId] }), queryClient.cancelQueries({ queryKey: ["asset-library", uploadUserId] })]);
                        requireCurrentUpload();
                        await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ["asset-picker", uploadUserId] }, { throwOnError: true }),
                            queryClient.invalidateQueries({ queryKey: ["asset-library", uploadUserId] }, { throwOnError: true }),
                            queryClient.fetchQuery({ ...remotePageQuery(1), staleTime: 0 }),
                        ]);
                        requireCurrentUpload();
                    } catch (reason) {
                        requireCurrentUpload();
                        const detail = reason instanceof Error ? `：${reason.message}` : "";
                        const warning = `素材已保存，但列表刷新失败${detail}，请重新打开素材库重试`;
                        setError(warning);
                        message.warning(warning);
                        return;
                    }
                }
                message.success(`${ids.length} 个素材已${remoteLibrary ? "保存到素材库" : "保存在本机"}并自动选中${category !== "all" || mediaKind !== "all" || keyword.trim() ? "，当前筛选可能隐藏新素材" : ""}`);
            }
        } catch (reason) {
            if (controller.signal.aborted) return;
            const detail = reason instanceof Error ? reason.message : "请重试";
            setError(saveStage === "remote" ? `素材已保存在本机，但云端保存失败：${detail}` : saveStage === "local" ? `素材本地保存失败：${detail}` : `素材上传失败：${detail}`);
        } finally {
            unsubscribe();
            if (uploadAbortRef.current === controller) {
                uploadAbortRef.current = null;
                if (uploadInputRef.current) uploadInputRef.current.value = "";
                setWorking(false);
                setUploadingCount(0);
            }
        }
    };

    const runFolderAction = async () => {
        if (!onFolderAction || folderId === "all" || working) return;
        setWorking(true);
        setError("");
        try {
            await onFolderAction(folderId);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "文件夹操作失败，请重试");
        } finally {
            setWorking(false);
        }
    };

    const useLocalCounts = !remoteEnabled || (remoteQuery.isError && !activeSummaryQuery.data) || (activeSummaryQuery.data?.total === 0 && localActiveItems.length > 0);
    const activeSummary = useLocalCounts ? undefined : activeSummaryQuery.data;
    const remoteCategoryCounts = activeSummary?.categoryCounts;
    const libraryTotal = activeSummary ? (remoteKind ? activeSummary.kindCounts[remoteKind] || 0 : Object.values(activeSummary.kindCounts).reduce((sum, count) => sum + count, 0)) : useLocalCounts ? libraryItems.length : undefined;
    const archivedSummary = remoteEnabled ? archivedSummaryQuery.data : undefined;
    const archivedCount = archivedSummary
        ? remoteKind
            ? archivedSummary.kindCounts[remoteKind] || 0
            : Object.values(archivedSummary.kindCounts).reduce((sum, count) => sum + count, 0)
        : !remoteEnabled || remoteQuery.isError
          ? localItems.filter((item) => item.archived).length
          : undefined;
    const countFor = (value: string) => {
        if (value === "all") return libraryTotal;
        // facets 没有类型与分类的交叉统计；固定媒体类型时不把当前页数量冒充分类总数。
        if (remoteEnabled && remoteKind) return undefined;
        if (remoteCategoryCounts) return remoteCategoryCounts[value] || 0;
        return useLocalCounts ? libraryItems.filter((item) => item.category === value).length : undefined;
    };

    const kindCountFor = (value: AssetPickerMediaKind | "all") => {
        if (value === "all") return libraryTotal;
        if (activeSummary) return activeSummary.kindCounts[value] || 0;
        return useLocalCounts ? libraryItems.filter((item) => pickerItemMediaKind(item) === value).length : undefined;
    };
    const sourceLabel = source === "plugin" ? "插件来源" : "本地素材";
    const sourceMenuItems: MenuProps["items"] = [
        {
            key: "local",
            icon: <HardDrive aria-hidden="true" />,
            label: (
                <span className="asset-picker-source-menu-label">
                    <span>本地素材</span>
                    <em>{source === "local" ? libraryTotal : localActiveItems.length}</em>
                </span>
            ),
        },
        ...(hasPluginSource
            ? [
                  {
                      key: "plugin",
                      icon: <Puzzle aria-hidden="true" />,
                      label: (
                          <span className="asset-picker-source-menu-label">
                              <span>插件来源</span>
                              <em>{pluginItems.length}</em>
                          </span>
                      ),
                  },
              ]
            : []),
    ];
    const activeUpload = isRecycleBin ? undefined : source === "plugin" ? upload?.external : upload;
    const uploading = uploadingCount > 0;

    return (
        <AppModal
            centered
            open={open}
            footer={null}
            title={null}
            destroyOnHidden
            closable={!working}
            mask={{ closable: !working }}
            keyboard={!working}
            onCancel={() => {
                if (!working) onClose();
            }}
            className="workspace-modal workspace-modal-wide asset-library-picker-modal"
            flush
        >
            <div className="asset-picker-shell">
                <header className="asset-picker-toolbar">
                    <div className="asset-picker-heading">
                        <div className="asset-picker-heading-copy">
                            <span>{eyebrow}</span>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomLeft"
                                rootClassName="asset-picker-source-dropdown"
                                onOpenChange={setSourceMenuOpen}
                                menu={{
                                    selectedKeys: [source],
                                    items: sourceMenuItems,
                                    onClick: ({ key }) => {
                                        if (key === "local" || key === "plugin") selectSource(key);
                                    },
                                }}
                            >
                                <button type="button" className="asset-picker-title-trigger" aria-haspopup="menu" aria-expanded={sourceMenuOpen} aria-label={"素材库来源：" + sourceLabel}>
                                    <strong>{isRecycleBin ? "回收站" : title}</strong>
                                    <ChevronDown aria-hidden="true" />
                                </button>
                            </Dropdown>
                        </div>
                    </div>
                    <label className="asset-picker-search">
                        <Search aria-hidden />
                        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材名称或标签" aria-label="搜索素材" />
                    </label>
                    <span className="asset-picker-count">
                        已选 {selectedIds.length} · {effectivePagination ? effectivePagination.total : visibleItems.length} 个素材
                    </span>
                </header>
                <div className="asset-picker-body">
                    <nav className="asset-picker-categories" aria-label="素材分类">
                        {mediaKindOptions.length > 1 ? (
                            <>
                                <span className="asset-picker-nav-label">媒体类型</span>
                                {(["all", ...mediaKindOptions] as const).map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={cn("assets-filter-item", !isRecycleBin && mediaKind === value && "is-active")}
                                        aria-pressed={!isRecycleBin && mediaKind === value}
                                        disabled={working}
                                        onClick={() => selectLibraryFilter(category, value)}
                                    >
                                        <span className="assets-filter-item-label">{value === "all" ? "全部类型" : ASSET_PICKER_MEDIA_KIND_LABELS[value]}</span>
                                        <span className="assets-filter-count">{kindCountFor(value)}</span>
                                    </button>
                                ))}
                            </>
                        ) : null}
                        {sourceFolders.length ? (
                            <>
                                <span className="asset-picker-nav-label">文件夹</span>
                                <button type="button" className={cn("assets-filter-item", folderId === "all" && "is-active")} aria-pressed={folderId === "all"} onClick={() => setFolderId("all")}>
                                    <span className="assets-filter-item-label">全部文件夹</span>
                                    <span className="assets-filter-count">{sourceItems.length}</span>
                                </button>
                                {renderPickerFolders(sourceFolders, activeSourceItems, folderId, setFolderId)}
                            </>
                        ) : null}
                        {showCategories ? (
                            <>
                                <span className="asset-picker-nav-label">分类</span>
                                {normalCategories.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={cn("assets-filter-item", !isRecycleBin && category === value && "is-active")}
                                        aria-pressed={!isRecycleBin && category === value}
                                        disabled={working}
                                        onClick={() => selectLibraryFilter(value, mediaKind)}
                                    >
                                        <span className="assets-filter-item-label">{categoryLabels[value] || (value === "all" ? "全部素材" : "其他")}</span>
                                        {countFor(value) !== undefined ? <span className="assets-filter-count">{countFor(value)}</span> : null}
                                    </button>
                                ))}
                                {source === "local" && (Boolean(archivedCount) || remoteEnabled || isRecycleBin) ? (
                                    <div className="mt-3 border-t border-border/40 pt-2">
                                        <button type="button" className={cn("assets-filter-item", isRecycleBin && "is-active")} aria-pressed={isRecycleBin} disabled={working} onClick={selectRecycleBin}>
                                            <span className="assets-filter-item-label flex items-center gap-2">
                                                <Trash2 className="size-3.5" />
                                                <span>回收站</span>
                                            </span>
                                            <span className="assets-filter-count">{archivedCount}</span>
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </nav>
                    <div className="asset-picker-grid-wrap">
                        <div className="asset-picker-grid">
                            {remoteEnabled && remoteQuery.isError && !localItems.length ? (
                                <div className="asset-picker-empty" role="alert">
                                    <FolderOpen />
                                    <strong>素材读取失败</strong>
                                    <span>服务端暂时不可用，重试不会影响本地已保存素材。</span>
                                    <Button onClick={() => void remoteQuery.refetch()}>重试</Button>
                                </div>
                            ) : loading || (remoteEnabled && remoteQuery.isFetching) ? (
                                <div className="asset-picker-empty">
                                    <LoaderCircle className="animate-spin" />
                                    <strong>正在读取素材</strong>
                                    <span>素材会按页加载，不会一次下载整个项目库。</span>
                                </div>
                            ) : visibleItems.length ? (
                                visibleItems.map((item) => <PickerCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item)} />)
                            ) : (
                                <div className="asset-picker-empty">
                                    <FolderOpen />
                                    <strong>{keyword.trim() ? "没有匹配的素材" : isRecycleBin ? "回收站是空的" : emptyTitle}</strong>
                                    <span>{keyword.trim() ? "换个关键词后再试。" : isRecycleBin ? "删除画布或手动归档的素材会暂存到这里，可在需要时还原。" : activeUpload ? "换个分类，或从底部上传一份新素材。" : emptyDescription}</span>
                                </div>
                            )}
                        </div>
                        {effectivePagination ? (
                            <PaginationBar alwaysShow current={effectivePagination.current} pageSize={effectivePagination.pageSize} total={effectivePagination.total} itemLabel="项" pageSizeOptions={[20, 40, 80]} onChange={effectivePagination.onChange} />
                        ) : null}
                    </div>
                </div>
                <footer className={cn("asset-picker-footer", !activeUpload && "is-compact")}>
                    {activeUpload ? (
                        <>
                            <input ref={uploadInputRef} type="file" hidden accept={activeUpload.accept} multiple={multiple} onChange={(event) => void handleUpload(event.target.files)} />
                            <button type="button" className="asset-picker-upload" onClick={() => uploadInputRef.current?.click()} disabled={working} aria-busy={uploading}>
                                {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                                <span>
                                    <strong>{uploading ? `正在上传 ${uploadingCount} 个素材` : "上传新素材"}</strong>
                                    <small>{uploading ? "保存完成后会自动选中" : activeUpload.description}</small>
                                </span>
                            </button>
                        </>
                    ) : footerNote || (remoteEnabled && remoteQuery.isError) ? (
                        <span className="asset-picker-footer-note">{remoteEnabled && remoteQuery.isError ? "云端素材暂时不可用，当前显示本地缓存" : footerNote}</span>
                    ) : (
                        <span />
                    )}
                    {error ? (
                        <span className="asset-picker-footer-error" role="alert">
                            {error}
                        </span>
                    ) : null}
                    <div className="asset-picker-actions">
                        {isRecycleBin ? (
                            <>
                                <Popconfirm
                                    title={remoteEnabled ? "确认删除当前页回收站素材？" : "确认清空回收站？"}
                                    description="仅删除当前列表中的素材；关联文件会直接释放，原画布或任务中的旧引用可能失效。删除不可恢复。"
                                    onConfirm={handleEmptyRecycleBin}
                                    okText="删除"
                                    okButtonProps={{ danger: true }}
                                    cancelText="取消"
                                >
                                    <Button type="text" danger disabled={working || remoteQuery.isFetching || !visibleItems.some((item) => item.archived)}>
                                        {remoteEnabled ? "删除当前页" : "清空回收站"}
                                    </Button>
                                </Popconfirm>
                                <Popconfirm title="确认彻底删除已选素材？" onConfirm={handleDeleteSelected} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                                    <Button type="text" danger disabled={working || !archivedSelectedIds.length}>
                                        彻底删除
                                    </Button>
                                </Popconfirm>
                                <Button type="text" onClick={onClose} disabled={working}>
                                    关闭
                                </Button>
                                <Button type="primary" icon={<RotateCcw className="size-3.5" />} disabled={working || !archivedSelectedIds.length} loading={working} onClick={handleRestoreSelected}>
                                    还原已选素材{archivedSelectedIds.length ? `（${archivedSelectedIds.length}）` : ""}
                                </Button>
                            </>
                        ) : (
                            <>
                                {onFolderAction && folderId !== "all" && (folderActionSource !== "local" || source === "local") ? (
                                    <Button type="text" icon={<FolderOpen />} disabled={working} onClick={() => void runFolderAction()}>
                                        {folderActionLabel}
                                    </Button>
                                ) : null}
                                {selectedIds.length > 0 ? (
                                    <button type="button" className="asset-picker-clear-selection-btn" onClick={clearSelection} disabled={working}>
                                        清空已选 ({selectedIds.length})
                                    </button>
                                ) : null}
                                <Button type="text" onClick={onClose} disabled={working}>
                                    取消
                                </Button>
                                <Button type="primary" icon={<Check />} disabled={working || !selectedIds.length} loading={working && !uploading} onClick={() => void confirm()}>
                                    {confirmLabel(selectedIds.length)}
                                </Button>
                            </>
                        )}
                    </div>
                </footer>
            </div>
        </AppModal>
    );
}

export function remoteAssetToPickerItem(asset: Asset, known: AssetLibraryPickerItem | undefined, acceptRemoteItems: boolean, disabledReason?: string): AssetLibraryPickerItem {
    const inferredKind: AssetPickerMediaKind | undefined = asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "text" ? asset.kind : undefined;
    return {
        id: asset.id,
        title: asset.title,
        category: asset.category || "other",
        archived: asset.status === "archived",
        kindLabel: asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : asset.kind === "entity" ? "角色" : "文本",
        mediaKind: inferredKind,
        searchText: (asset.tags ?? []).join(" "),
        ...known,
        disabledReason: known?.disabledReason || (!known && !acceptRemoteItems ? "此素材不适用于当前操作" : disabledReason),
        asset,
    };
}

// 角色卡、3D 模型等非媒体条目没有媒体类型，媒体筛选生效时不参与匹配。
export function pickerItemMediaKind(item: AssetLibraryPickerItem): AssetPickerMediaKind | undefined {
    if (item.mediaKind) return item.mediaKind;
    const kind = item.external?.item.kind || item.asset?.kind;
    return kind === "image" || kind === "video" || kind === "audio" || kind === "text" ? kind : undefined;
}

function PickerCard({ item, selected, onToggle }: { item: AssetLibraryPickerItem; selected: boolean; onToggle: () => void }) {
    const disabled = Boolean(item.disabledReason);
    const previewClassName = item.imageFit === "cover" ? undefined : "is-contain";
    return (
        <AssetLibraryCard selected={selected} className={cn("asset-picker-card relative", disabled && "is-disabled")}>
            <button type="button" className="asset-picker-card-action" onClick={onToggle} disabled={disabled} aria-pressed={selected} title={item.disabledReason || item.title}>
                <div className="assets-cover asset-picker-card-media">
                    {item.asset?.kind === "entity" ? (
                        <CharacterAssetCover asset={item.asset} />
                    ) : item.asset?.kind === "audio" && !item.imageUrl && !item.imageStorageKey ? (
                        <AudioWaveArt seed={item.asset.id} />
                    ) : item.imageUrl || item.imageStorageKey ? (
                        <CachedResourceImage
                            storageKey={item.imageStorageKey}
                            src={item.imageUrl}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                            className={previewClassName}
                            fallback={<div className="assets-cover-fallback">{kindIcon(item.kindLabel)}</div>}
                        />
                    ) : (
                        <AssetMediaPreview asset={item.asset} alt={item.title} className={previewClassName} fallback={<div className="assets-cover-fallback">{kindIcon(item.kindLabel)}</div>} />
                    )}
                    <span className="assets-cover-vignette" aria-hidden="true" />
                    <span className="assets-cover-badges" aria-hidden="true">
                        <span className="assets-cover-badge is-kind">{item.kindLabel}</span>
                    </span>
                    <span className="asset-picker-card-check" aria-hidden="true">
                        <Check />
                    </span>
                    {item.disabledReason ? <span className="asset-picker-card-lock">{item.disabledReason}</span> : null}
                </div>
                <div className="asset-picker-card-copy">
                    <strong>{item.title || "未命名素材"}</strong>
                    {item.description ? <span>{item.description}</span> : null}
                </div>
            </button>
            {item.asset?.kind === "audio" && !disabled ? (
                // 与封面同尺寸的覆盖层：试听按钮落在封面左下角，又不嵌套在选择按钮里。
                <span className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/3]">
                    <AudioPlayButton asset={item.asset} className="pointer-events-auto absolute bottom-2 left-2 !size-8" />
                </span>
            ) : null}
        </AssetLibraryCard>
    );
}

function renderPickerFolders(folders: AssetLibraryPickerFolder[], items: AssetLibraryPickerItem[], selectedId: string, onSelect: (folderId: string) => void, parentId = "", depth = 0, visited: ReadonlySet<string> = new Set()): ReactNode {
    if (depth >= 8) return null;
    return folders
        .filter((folder) => (folder.parentId || "") === parentId && !visited.has(folder.id))
        .map((folder) => {
            const nextVisited = new Set(visited).add(folder.id);
            return (
                <span key={folder.id} className="contents">
                    <button
                        type="button"
                        className={cn("assets-filter-item", selectedId === folder.id && "is-active")}
                        aria-pressed={selectedId === folder.id}
                        onClick={() => onSelect(folder.id)}
                        style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}
                    >
                        <span className="assets-filter-item-label" title={folder.name}>
                            {folder.name}
                        </span>
                        <span className="assets-filter-count">{items.filter((item) => item.folderId === folder.id).length}</span>
                    </button>
                    {renderPickerFolders(folders, items, selectedId, onSelect, folder.id, depth + 1, nextVisited)}
                </span>
            );
        });
}

function kindIcon(label: string): ReactNode {
    if (label.includes("角色")) return <UserRound />;
    if (label.includes("视频")) return <Video />;
    if (label.includes("音频")) return <Music2 />;
    if (label.includes("文本")) return <FileText />;
    return <ImageIcon />;
}
