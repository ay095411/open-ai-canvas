import { App, Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, X } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { catalogIdOf, type CreationInspiration, type InspirationGallerySource } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { assertCurrentUserSession, captureUserSession, type UserSessionSnapshot } from "@/lib/user-scope";
import { InspirationDetailContent } from "@/pages/inspirations/inspiration-detail-modal";
import { INSPIRATION_POLICY_VERSION } from "@/services/api/zzai-gallery";
import { getInspirationPrompt } from "@/services/api/online-gallery";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CreationMode } from "./creation-types";
import "./creation-inspiration-dialog.css";

const InspirationLibrary = lazy(() => import("@/pages/inspirations"));

export default function CreationInspirationDialog({
    open,
    initialItem = null,
    initialSource = "official-catalog",
    onClose,
    afterClose,
    onUse,
}: {
    open: boolean;
    initialItem?: { id: string; sourceId?: CreationInspiration["sourceId"] } | null;
    initialSource?: InspirationGallerySource;
    initialVideo?: string;
    onClose: () => void;
    afterClose: () => void;
    onUse: (mode: CreationMode, prompt: string) => void;
}) {
    const { message } = App.useApp();
    const [selectedId, setSelectedId] = useState(initialItem?.id ?? null);
    const [using, setUsing] = useState(false);
    const [favoriteSaving, setFavoriteSaving] = useState(false);
    const [actionError, setActionError] = useState("");
    const actionBusy = useRef(false);
    const userScope = useUserStore((state) => state.user?.id ?? "guest");
    const previousScope = useRef(userScope);
    const currentSelection = useRef(selectedId);
    currentSelection.current = selectedId;
    const favorites = useInspirationStore((state) => state.favorites);
    const hydrationError = useInspirationStore((state) => state.hydrationError);
    const localRecordsReady = useInspirationStore((state) => state.hydrated && state.hydrationScope === userScope);
    const pendingUse = useRef<{ id: string; session: UserSessionSnapshot } | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const libraryRef = useRef<HTMLDivElement>(null);
    const previewTrigger = useRef<HTMLElement | null>(null);
    const hasLibrary = !initialItem;
    const title = selectedId ? "灵感详情" : "灵感大厅";
    const licensed = selectedId?.startsWith("authorized-library:") ?? false;
    const detailQuery = useQuery({
        queryKey: ["public", "inspirations", selectedId?.split(":")[0] ?? "official-catalog", licensed ? INSPIRATION_POLICY_VERSION : "official-catalog-v1", "detail", userScope, selectedId],
        queryFn: ({ signal }) => getInspirationPrompt(selectedId!, signal),
        enabled: open && Boolean(selectedId),
        retry: false,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 60_000,
    });
    const detail = detailQuery.isSuccess && detailQuery.isFetchedAfterMount && !actionError ? detailQuery.data : null;

    useEffect(() => {
        if (previousScope.current === userScope) return;
        previousScope.current = userScope;
        setSelectedId(null);
        pendingUse.current = null;
        setUsing(false);
        setFavoriteSaving(false);
        setActionError("");
    }, [userScope]);
    useEffect(() => {
        setActionError("");
    }, [selectedId, detailQuery.dataUpdatedAt]);
    useLayoutEffect(() => {
        if (!open) return;
        if (selectedId) headingRef.current?.focus({ preventScroll: true });
        else if (previewTrigger.current) {
            previewTrigger.current.focus({ preventScroll: true });
            previewTrigger.current = null;
        }
    }, [selectedId, open]);

    const previewInspiration = (item: CreationInspiration) => {
        const active = document.activeElement;
        previewTrigger.current = active instanceof HTMLElement && libraryRef.current?.contains(active) ? active : null;
        setSelectedId(catalogIdOf(item));
    };
    const copyPrompt = async (_text: string, label: string) => {
        if (!selectedId || actionBusy.current) return;
        const id = selectedId;
        let session: UserSessionSnapshot | undefined;
        actionBusy.current = true;
        try {
            session = captureUserSession();
            const current = await getInspirationPrompt(id, session.signal);
            assertCurrentUserSession(session);
            if (currentSelection.current !== id) return;
            try {
                await navigator.clipboard.writeText(label.includes("原文") ? current.prompt : fillablePrompt(current));
            } catch {
                if (currentSelection.current === id && !session.signal.aborted) message.error("复制失败，请手动选中文本");
                return;
            }
            if (currentSelection.current === id && !session.signal.aborted) message.success(`${label}已复制`);
        } catch (error) {
            if (currentSelection.current !== id || session?.signal.aborted) return;
            setActionError("当前内容读取失败，已暂时隐藏。");
            message.error(error instanceof Error ? error.message : "复制失败，请重试");
        } finally {
            actionBusy.current = false;
        }
    };
    const useInspiration = (item: CreationInspiration) => {
        if (pendingUse.current) return;
        try {
            pendingUse.current = { id: catalogIdOf(item), session: captureUserSession() };
            setUsing(true);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "当前会话不可用");
        }
    };
    const favoriteInspiration = async (item: CreationInspiration) => {
        if (!localRecordsReady || actionBusy.current) return;
        actionBusy.current = true;
        setFavoriteSaving(true);
        try {
            await useInspirationStore.getState().toggleFavorite(catalogIdOf(item));
        } catch (error) {
            if (useUserStore.getState().user?.id === userScope && currentSelection.current === catalogIdOf(item)) {
                setActionError("收藏操作失败，需重新核验当前内容。");
                message.error(error instanceof Error ? error.message : "收藏修改未保存，请重试");
            }
        } finally {
            actionBusy.current = false;
            if (useUserStore.getState().user?.id === userScope) setFavoriteSaving(false);
        }
    };
    const finishClose = () => {
        const pending = pendingUse.current;
        pendingUse.current = null;
        afterClose();
        if (!pending) return;
        // 焦点恢复之后再复核当前版本，撤销授权或账号切换均不得填词。
        void (async () => {
            try {
                assertCurrentUserSession(pending.session);
                const current = await getInspirationPrompt(pending.id, pending.session.signal);
                assertCurrentUserSession(pending.session);
                onUse(current.mode, fillablePrompt(current));
            } catch (error) {
                if (!pending.session.signal.aborted) message.error(error instanceof Error ? error.message : "当前素材不可用，未填入提示词");
            }
        })();
    };

    return (
        <AppModal open={open} onCancel={onClose} afterClose={finishClose} width={hasLibrary ? 1440 : 1080} centered title={null} footer={null} flush closable={false} aria-label={title}>
            <section className="creation-inspiration-dialog">
                <header className="creation-inspiration-dialog-header">
                    <div>
                        {hasLibrary && selectedId ? (
                            <button type="button" aria-label="返回灵感大厅" onClick={() => setSelectedId(null)}>
                                <ArrowLeft size={18} aria-hidden="true" />
                            </button>
                        ) : null}
                        <h2 ref={headingRef} tabIndex={-1}>
                            {title}
                        </h2>
                    </div>
                    <button type="button" aria-label="关闭灵感弹窗" onClick={onClose}>
                        <X size={18} aria-hidden="true" />
                    </button>
                </header>
                {!hasLibrary && hydrationError ? (
                    <div className="flex flex-wrap items-center gap-2 p-3 text-xs text-muted-foreground" role="alert">
                        <span>{hydrationError}</span>
                        <Button size="small" onClick={() => void useInspirationStore.persist.rehydrate()}>
                            重试本地记录
                        </Button>
                    </div>
                ) : null}
                <div className="creation-inspiration-dialog-body">
                    {hasLibrary ? (
                        <div ref={libraryRef} className="creation-inspiration-dialog-library" hidden={Boolean(selectedId)}>
                            <Suspense
                                fallback={
                                    <p className="creation-inspiration-dialog-loading" role="status">
                                        正在加载灵感大厅…
                                    </p>
                                }
                            >
                                <InspirationLibrary embedded initialSource={initialSource} onPreview={previewInspiration} onUse={useInspiration} />
                            </Suspense>
                        </div>
                    ) : null}
                    {selectedId && !detail && !detailQuery.isError && !actionError ? (
                        <p className="creation-inspiration-dialog-loading" role="status">
                            {licensed ? "正在核验授权素材…" : "正在读取官方目录示例…"}
                        </p>
                    ) : null}
                    {selectedId && (detailQuery.isError || actionError) ? (
                        <p className="creation-inspiration-dialog-loading" role="alert">
                            {licensed ? "当前素材未通过授权核验或暂不可用，正文和媒体已隐藏。" : "官方目录示例暂不可用，正文和媒体已隐藏。"}
                            <Button disabled={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>
                                重试核验
                            </Button>
                        </p>
                    ) : null}
                    {selectedId && detail ? (
                        <InspirationDetailContent
                            item={detail}
                            onClose={hasLibrary ? () => setSelectedId(null) : onClose}
                            closeLabel={hasLibrary ? "返回大厅" : "关闭"}
                            onUse={useInspiration}
                            useLabel="带进创作区"
                            useDisabled={using}
                            onCopy={(text, label) => void copyPrompt(text, label)}
                            favorite={localRecordsReady && favorites.includes(detail.id)}
                            favoriteDisabled={favoriteSaving}
                            onToggleFavorite={userScope !== "guest" && localRecordsReady ? (item) => void favoriteInspiration(item) : undefined}
                        />
                    ) : null}
                </div>
            </section>
        </AppModal>
    );
}
