import { ImageParameterFields } from "@/components/image-parameter-fields";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { formatVideoResolutionLabel as videoResolutionLabel } from "@/lib/video-generation-options";
import { buildImageResolutionOptions, formatImageResolutionSize, supportsImageResolutionPresets } from "@/lib/image-resolution-tiers";
import { imageQualityLabel } from "@/lib/image-quality";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Button, Popover } from "antd";
import { useWorkspaceTopBarMount } from "@/components/layout/workspace-top-bar-extension";
import { Tooltip } from "@/components/ui/base/tooltip";
import { type ThinkingLevel, type ThinkingRequest } from "@/lib/text-thinking";
import { ThinkingLevelSlider } from "@/components/thinking-level-slider";
import { Reorder, LayoutGroup, motion } from "motion/react";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Film, History, Image as ImageIcon, LoaderCircle, Maximize2, MessageSquareText, Minimize2, PenLine, Plus, SlidersHorizontal, Trash2, Waves, X } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { HoverBorderGradient } from "@/components/ui/aceternity/hover-border-gradient";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { formatShotOrdinal } from "@/lib/shot-label";
import { type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { mediaSettingIssues } from "@/lib/media-settings";
import { MediaSettingsNotice } from "@/components/media-settings-notice";
import { mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useGenerationBatchLimit, batchQuoteTotal } from "@/lib/generation-batch-limit";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { type CreationReference } from "./creation-references";
import { creationAttachmentKind, type CreationAttachment, type CreationMode } from "./creation-assets";
import { modeLabels, qualityOptions, type CreationShotRailEntry } from "./creation-types";
import { creationMessageNeedsResultSync } from "./creation-conversations";
import "./creation-product.css";
import "./creation-scrollbars.css";
import { CreationAttachmentThumbnail, CreationMediaPreviewModal } from "./creation-workspace-messages";
import { CreationSettingsPanel, type CreationSettingsPatch } from "./creation-settings-panel";

export { CreationHistoryDrawer } from "./creation-workspace-history";
export { CreationMessageView } from "./creation-workspace-messages";

const CanvasPromptOptimizerDrawer = lazy(() => import("@/components/canvas/canvas-prompt-optimizer-drawer").then((module) => ({ default: module.CanvasPromptOptimizerDrawer })));

export const creationAssetCategoryLabels: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

export function CreationWorkspaceToolbar({
    shots,
    onJumpToShot,
    onNewConversation,
    onOpenHistory,
    onContinueCanvas,
    openingCanvas,
}: {
    shots: CreationShotRailEntry[];
    onJumpToShot: (shot: CreationShotRailEntry) => void;
    onNewConversation: () => void;
    onOpenHistory: () => void;
    onContinueCanvas: () => void;
    openingCanvas: boolean;
}) {
    const [railOpen, setRailOpen] = useState(false);
    const railRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!railOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (railRef.current && !railRef.current.contains(event.target as Node)) setRailOpen(false);
        };
        window.addEventListener("mousedown", onPointerDown);
        return () => window.removeEventListener("mousedown", onPointerDown);
    }, [railOpen]);
    const mount = useWorkspaceTopBarMount();
    const toolbar = (
        <header className="creation-thread-toolbar">
            <div className="creation-toolbar-shots" ref={railRef}>
                <button type="button" className="creation-rail-trigger" aria-expanded={railOpen} aria-haspopup="listbox" onClick={() => setRailOpen((open) => !open)}>
                    <Clapperboard />
                    镜头时间线{shots.length > 0 ? <em className="creation-rail-count">{shots.length}</em> : null}
                </button>
                {railOpen ? (
                    <div className="creation-rail-pop" role="listbox" aria-label="镜头时间线">
                        <div className="creation-rail-pop-head">
                            <span className="creation-rail-pop-title">
                                镜头时间线<small>{shots.length ? `共 ${shots.length} 镜` : "空轨道"}</small>
                            </span>
                            <button type="button" className="creation-rail-pop-close" aria-label="关闭镜头列表" onClick={() => setRailOpen(false)}>
                                <X />
                            </button>
                        </div>
                        {shots.length ? (
                            <ol className="creation-rail-list">
                                {shots.map((shot) => {
                                    const resultStatus = shot.result?.status;
                                    const resultNeedsSync = Boolean(shot.result && creationMessageNeedsResultSync(shot.result));
                                    const statusLabel = resultStatus === "done" ? "完成" : resultNeedsSync ? "待同步" : resultStatus === "error" ? "生成失败" : resultStatus === "pending" ? "生成中" : resultStatus === "cancelled" ? "已停止" : "待生成";
                                    return (
                                        <li key={shot.key}>
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected="false"
                                                className="creation-rail-row"
                                                onClick={() => {
                                                    setRailOpen(false);
                                                    onJumpToShot(shot);
                                                }}
                                            >
                                                <span className="creation-rail-row-shot">{formatShotOrdinal(shot.ordinal - 1)}</span>
                                                <span className="creation-rail-row-prompt">{shot.user.content || "视频镜头"}</span>
                                                <span className={`creation-rail-row-state is-${resultNeedsSync ? "sync" : resultStatus || "idle"}`}>{statusLabel}</span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                        ) : (
                            <p className="creation-rail-empty">在下方发送一条视频消息，就会自动成为第 1 镜。</p>
                        )}
                    </div>
                ) : null}
            </div>
            <div className="creation-toolbar-actions">
                <Button size="small" loading={openingCanvas} onClick={onContinueCanvas}>
                    画布中继续
                </Button>
                <Tooltip title="新建创作">
                    <button type="button" aria-label="新建创作" className="creation-toolbar-action" onClick={onNewConversation}>
                        <Plus />
                    </button>
                </Tooltip>
                <Tooltip title="历史对话">
                    <button type="button" aria-label="查看历史对话" className="creation-toolbar-action" onClick={onOpenHistory}>
                        <History />
                    </button>
                </Tooltip>
            </div>
        </header>
    );
    if (mount) return createPortal(toolbar, mount);
    if (mount === null) return null;
    return toolbar;
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    generationActive: boolean;
    referenceReplacementBusy: boolean;
    attachments: CreationAttachment[];
    referenceImageSize?: { width: number; height: number };
    maxReferences: number;
    references: CreationReference[];
    onRemoveAttachment: (id: string) => void;
    onClearAttachments: () => void;
    onClearComposer: () => void;
    onReorderAttachments: (attachments: CreationAttachment[]) => void;
    onReplaceAttachment: (targetAttachmentId: string, replacement: CreationAttachment) => void;
    onReplaceReferenceFiles: (targetAttachmentId: string, files: File[]) => void;
    onOpenLibrary: () => void;
    onModeChange: (mode: CreationMode) => void;
    model: string;
    modelRequirements: ModelRequirements;
    videoProfile: VideoCapabilityConfig;
    imageProfile: ImageCapabilityConfig;
    config: AiConfig;
    onModelChange: (value: string) => void;
    ratio: string;
    setRatio: (value: string) => void;
    seconds: string;
    setSeconds: (value: string) => void;
    quality: string;
    setQuality: (value: string) => void;
    imageResolution: string;
    setImageResolution: (value: string) => void;
    imageParameters?: string;
    setImageParameters: (value: string) => void;
    setTransparentBackground: (value: string) => void;
    videoQuality: string;
    setVideoQuality: (value: string) => void;
    count: string;
    setCount: (value: string) => void;
    textStreaming: boolean;
    setTextStreaming: (value: boolean) => void;
    /** 当前模型可选的思考档位；为空时不显示思考控件。 */
    textThinkingLevels: ThinkingLevel[];
    /** 当前生效档位；空字符串表示跟随模型默认且模型没有声明默认值。 */
    textThinkingLevel: ThinkingLevel | "";
    textThinkingRequest: ThinkingRequest;
    setTextThinkingLevel: (value: ThinkingRequest) => void;
    promptOptimizerProvider: PromptOptimizerProvider | null;
    composerFocusRef: RefObject<HTMLTextAreaElement | null>;
    onPromptFocus: () => void;
    placeholderOverride?: string;
    onSubmit: () => void;
};

type CreationReferenceFilter = "all" | "image" | "video" | "audio" | "file";

export function CreationComposer(props: ComposerProps) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [referenceFilter, setReferenceFilter] = useState<CreationReferenceFilter>("all");
    const [canDragReferences, setCanDragReferences] = useState(false);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    const attachmentTrackRef = useRef<HTMLUListElement>(null);
    const cardDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
    const suppressAttachmentClickRef = useRef(false);
    const [trackState, setTrackState] = useState({ canScrollLeft: false, canScrollRight: false, isExpanded: true, isDragging: false });
    const previousAttachmentCountRef = useRef(0);
    const interactionBusy = props.busy || props.referenceReplacementBusy;
    // 创作页张数等于拆单数，上限按账号同时任务数，硬上限仍为 15。
    const imageBatchLimit = Math.min(15, useGenerationBatchLimit());
    const settingsError = mediaSettingIssues(props.config, props.mode, props.model)
        .map((item) => item.message)
        .join("；");
    const canSubmit = Boolean(props.prompt.trim()) && !interactionBusy && !settingsError;
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    // 报价接口需要登录；游客态直接回退到本地积分估算，不发无效请求。
    const userId = useUserStore((state) => state.user?.id);
    const priceChannel = resolveModelChannel(props.config, props.model);
    // 实际提交单数与 index.tsx 的 taskCount 同样 clamp。
    const imageTaskCount = Math.max(1, Math.min(imageBatchLimit, Math.floor(Number(props.count)) || 1));
    // 服务端按单任务报价，图片按每单 1 张询价，显示时再乘实际单数。
    const quoteRequirements = useMemo(() => (props.mode === "image" ? { ...props.modelRequirements, options: { ...props.modelRequirements.options, count: 1 } } : props.modelRequirements), [props.mode, props.modelRequirements]);
    const quoteRequest = useMemo(() => modelQuoteRequest(props.config, props.model, props.mode, quoteRequirements), [props.config, props.mode, props.model, quoteRequirements]);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const canOptimizePrompt = Boolean(props.promptOptimizerProvider) && (props.mode === "image" || props.mode === "video");
    const optimizerReferences = props.references.filter((reference) => reference.active && reference.kind !== "skill");
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(props.model),
        count: props.mode === "image" ? imageTaskCount : 1,
        seconds: props.mode === "video" ? props.seconds : 1,
        capability: props.mode,
        config: props.config,
        requirements: props.modelRequirements,
    });
    useEffect(() => {
        if (!userId || !creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setRouteQuote(quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(null);
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest, userId]);
    const generationCredits = routeQuote ? batchQuoteTotal(routeQuote.amountMicrocredits, props.mode === "image" ? imageTaskCount : 1) : credits;
    const showCost = creditsEnabled && generationCredits !== null && generationCredits !== undefined;
    const formattedCredits = generationCredits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const actionLabel = props.referenceReplacementBusy ? "正在替换参考图" : interactionBusy || (props.generationActive && !canSubmit) ? "生成中" : showCost ? `${!userId || routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，发送` : "发送";
    // Keep the working state throughout generation; typing a next prompt
    // restores the send action when another submission is allowed.
    const showWorkingSpinner = interactionBusy || (props.generationActive && !canSubmit);
    const placeholder = props.mode === "text" ? "描述你的故事、角色或想继续讨论的创意" : props.mode === "image" ? "描述画面、人物、场景、构图与风格" : "描述镜头内容、运动、光线与节奏";
    const emptyPlaceholder = "写下一瞬灵感，让故事从这里开始";
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "image" ? imageReferencesSupported : props.mode !== "video" || props.maxReferences > 0;
    const canAddMoreReferences = referencesSupported && props.attachments.length < props.maxReferences;
    const addReferenceLabel = interactionBusy ? (props.referenceReplacementBusy ? "正在替换参考图" : "生成中暂不能添加参考内容") : canAddMoreReferences ? "添加更多参考内容" : `已达到当前模型的参考内容上限（${props.maxReferences} 个）`;
    const referenceCounts = useMemo(
        () =>
            props.attachments.reduce(
                (counts, attachment) => {
                    const kind = creationAttachmentKind(attachment);
                    counts[kind] += 1;
                    return counts;
                },
                { image: 0, video: 0, audio: 0, file: 0 },
            ),
        [props.attachments],
    );
    const visibleAttachments = useMemo(() => (referenceFilter === "all" ? props.attachments : props.attachments.filter((attachment) => creationAttachmentKind(attachment) === referenceFilter)), [props.attachments, referenceFilter]);
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || imageBatchLimit > 1;
    const updateTrackScrollState = useCallback(() => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        setTrackState((current) => ({
            ...current,
            canScrollLeft: track.scrollLeft > 1,
            canScrollRight: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
        }));
    }, []);
    const setReferencePanelExpanded = useCallback((isExpanded: boolean) => {
        setTrackState((current) => ({ ...current, isExpanded }));
        if (!isExpanded) setReferenceFilter("all");
    }, []);
    useEffect(() => {
        const hadAttachments = previousAttachmentCountRef.current > 0;
        if (!props.attachments.length) setReferencePanelExpanded(false);
        else if (!hadAttachments) setReferencePanelExpanded(true);
        previousAttachmentCountRef.current = props.attachments.length;
        updateTrackScrollState();
    }, [props.attachments.length, setReferencePanelExpanded, updateTrackScrollState]);
    useEffect(() => {
        const query = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setCanDragReferences(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        const frame = window.requestAnimationFrame(updateTrackScrollState);
        return () => window.cancelAnimationFrame(frame);
    }, [referenceFilter, trackState.isExpanded, updateTrackScrollState, visibleAttachments.length]);
    const beginCardDrag = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || interactionBusy || !trackState.isExpanded) return;
        if ((event.target as HTMLElement).closest(".creation-reference-card-remove")) return;
        cardDragRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    };
    const endCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag) return;
        cardDragRef.current = null;
        if (drag.moved) {
            suppressAttachmentClickRef.current = true;
            window.setTimeout(() => {
                suppressAttachmentClickRef.current = false;
            }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setTrackState((current) => ({ ...current, isDragging: false }));
    };
    const moveCardDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = cardDragRef.current;
        if (!drag || drag.moved) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
        drag.moved = true;
        setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true }));
    };
    const previewAttachment = (type: "image" | "video", url: string) => {
        if (suppressAttachmentClickRef.current || cardDragRef.current?.moved) return;
        setPreviewType(type);
        setPreviewUrl(url);
    };
    const reorderVisibleAttachments = useCallback(
        (next: CreationAttachment[]) => {
            if (referenceFilter === "all") {
                props.onReorderAttachments(next);
                return;
            }
            const visibleIds = new Set(visibleAttachments.map((attachment) => attachment.id));
            const reordered = [...next];
            props.onReorderAttachments(props.attachments.map((attachment) => (visibleIds.has(attachment.id) ? reordered.shift() || attachment : attachment)));
        },
        [props.attachments, props.onReorderAttachments, referenceFilter, visibleAttachments],
    );
    useEffect(() => {
        if (!canOptimizePrompt) setPromptOptimizerOpen(false);
    }, [canOptimizePrompt]);

    const scrollAttachmentTrack = (direction: -1 | 1) => {
        const track = attachmentTrackRef.current;
        if (!track) return;
        track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.72, 120), behavior: "smooth" });
        window.setTimeout(updateTrackScrollState, 180);
    };
    const imageReferenceAtPoint = (x: number, y: number) => {
        for (const element of document.elementsFromPoint(x, y)) {
            const chip = element.closest<HTMLElement>("[data-mention-reference-id]");
            const referenceId = chip?.dataset.mentionReferenceId;
            const reference = referenceId ? props.references.find((item) => item.id === referenceId) : undefined;
            if (reference?.kind === "image" && reference.attachmentId) return reference;
        }
        return undefined;
    };
    const composer = (
        <HoverBorderGradient as="div" duration={2.2} containerClassName="creation-composer-shell" className="creation-composer-shell-inner">
            <SpotlightSurface className={`creation-chat-composer is-${props.variant}`} contentClassName="contents" spotlightColor="color-mix(in srgb, var(--user-ink) 12%, transparent)" spotlightRadius={280}>
                <div className="creation-chat-writing-surface">
                    <div className="creation-chat-editor">
                        <CanvasResourceMentionTextarea
                            ref={props.composerFocusRef}
                            value={props.prompt}
                            references={props.references}
                            mentionMenuWidth={400}
                            sendOnEnter
                            onFocus={props.onPromptFocus}
                            onChange={props.setPrompt}
                            onSubmit={props.onSubmit}
                            containerClassName="creation-chat-mention-container"
                            className="creation-chat-mention-editor creation-scrollbar"
                            style={{ color: "var(--creation-text)" }}
                            animatedPlaceholder={props.variant === "empty"}
                            placeholder={props.placeholderOverride || (props.variant === "empty" ? emptyPlaceholder : placeholder)}
                            aria-label="创作提示词，可使用 @ 引用当前参考内容或技能；回车发送，Shift+回车换行"
                            spellCheck
                            disabled={interactionBusy}
                            activeDropReferenceId={dropTargetReferenceId}
                            onReferenceFilesDrop={(reference, files) => {
                                const target = props.references.find((item) => item.id === reference.id);
                                if (target?.attachmentId) props.onReplaceReferenceFiles(target.attachmentId, files);
                            }}
                        />
                        {props.attachments.length || referencesSupported ? (
                            <div className={`creation-reference-panel${trackState.isExpanded ? " is-expanded" : ""}`} aria-busy={interactionBusy}>
                                {trackState.isExpanded ? (
                                    <div className="creation-reference-panel-header">
                                        <div className="creation-reference-filter-tabs" role="group" aria-label="筛选参考内容">
                                            {(
                                                [
                                                    { id: "all", label: "全部", count: props.attachments.length },
                                                    { id: "image", label: "图片", count: referenceCounts.image },
                                                    { id: "video", label: "视频", count: referenceCounts.video },
                                                    { id: "audio", label: "音频", count: referenceCounts.audio },
                                                    { id: "file", label: "文件", count: referenceCounts.file },
                                                ] as const
                                            ).map((filter) => (
                                                <button key={filter.id} type="button" aria-pressed={referenceFilter === filter.id} className={referenceFilter === filter.id ? "is-active" : undefined} onClick={() => setReferenceFilter(filter.id)}>
                                                    {filter.label}
                                                    {filter.count ? ` (${filter.count})` : ""}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="creation-reference-panel-actions">
                                            {props.attachments.length ? (
                                                <button type="button" onClick={props.onClearAttachments} disabled={interactionBusy}>
                                                    清空全部素材
                                                </button>
                                            ) : null}
                                            <Tooltip title="收起素材面板">
                                                <button type="button" className="creation-reference-panel-collapse" onClick={() => setReferencePanelExpanded(false)} aria-label="收起素材面板">
                                                    <Minimize2 aria-hidden="true" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                    </div>
                                ) : null}
                                <div className="creation-reference-track-wrapper">
                                    <div className="creation-reference-stack-shell">
                                        {trackState.canScrollLeft ? (
                                            <button type="button" className="creation-reference-track-button is-left" onClick={() => scrollAttachmentTrack(-1)} aria-label="向左浏览参考内容" title="向左浏览参考内容">
                                                <ChevronLeft aria-hidden="true" />
                                            </button>
                                        ) : null}
                                        <Reorder.Group<CreationAttachment[]>
                                            as="ul"
                                            ref={attachmentTrackRef}
                                            className={`creation-reference-track${trackState.isExpanded ? " is-expanded" : ""}${trackState.isDragging ? " is-dragging" : ""}${visibleAttachments.length ? "" : " is-empty"}`}
                                            axis="x"
                                            values={visibleAttachments}
                                            onReorder={reorderVisibleAttachments}
                                            layoutScroll
                                            role="list"
                                            aria-label="参考内容轨道"
                                            onScroll={updateTrackScrollState}
                                        >
                                            {visibleAttachments.map((item) => (
                                                <Reorder.Item<CreationAttachment>
                                                    key={item.id}
                                                    value={item}
                                                    layout="position"
                                                    drag={trackState.isExpanded && canDragReferences && !interactionBusy}
                                                    className="creation-reference-stack-card"
                                                    onPointerDown={beginCardDrag}
                                                    onPointerMove={moveCardDrag}
                                                    onPointerUp={endCardDrag}
                                                    onPointerCancel={endCardDrag}
                                                    onDragStart={() => {
                                                        setDropTargetReferenceId(null);
                                                        setTrackState((current) => ({ ...current, isDragging: true, isExpanded: true }));
                                                    }}
                                                    onDrag={(_, info) => {
                                                        if (creationAttachmentKind(item) !== "image") return;
                                                        const target = imageReferenceAtPoint(info.point.x, info.point.y);
                                                        setDropTargetReferenceId(target?.attachmentId !== item.id ? target?.id || null : null);
                                                    }}
                                                    onDragEnd={(_, info) => {
                                                        const target = creationAttachmentKind(item) === "image" ? imageReferenceAtPoint(info.point.x, info.point.y) : undefined;
                                                        setDropTargetReferenceId(null);
                                                        setTrackState((current) => ({ ...current, isDragging: false, isExpanded: true }));
                                                        if (target?.attachmentId && target.attachmentId !== item.id) props.onReplaceAttachment(target.attachmentId, item);
                                                    }}
                                                >
                                                    <CreationAttachmentThumbnail item={item} onPreview={previewAttachment} onRemove={props.onRemoveAttachment} />
                                                </Reorder.Item>
                                            ))}
                                            {!visibleAttachments.length && props.attachments.length ? <li className="creation-reference-filter-empty">该类型暂无参考内容</li> : null}
                                            {referencesSupported ? (
                                                <li className="creation-reference-add-slot">
                                                    <Tooltip title={addReferenceLabel}>
                                                        <button type="button" className="creation-reference-add-button" onClick={props.onOpenLibrary} disabled={interactionBusy || !canAddMoreReferences} aria-label={addReferenceLabel}>
                                                            <Plus aria-hidden="true" />
                                                            <span>参考内容</span>
                                                        </button>
                                                    </Tooltip>
                                                </li>
                                            ) : null}
                                        </Reorder.Group>
                                        {trackState.canScrollRight ? (
                                            <button type="button" className="creation-reference-track-button is-right" onClick={() => scrollAttachmentTrack(1)} aria-label="向右浏览参考内容" title="向右浏览参考内容">
                                                <ChevronRight aria-hidden="true" />
                                            </button>
                                        ) : null}
                                        {!trackState.isExpanded && props.attachments.length ? (
                                            <Tooltip title="查看全部">
                                                <button type="button" className="creation-reference-panel-expand" onClick={() => setReferencePanelExpanded(true)} aria-label={`查看全部 ${props.attachments.length} 个参考内容`} aria-expanded="false">
                                                    <Maximize2 aria-hidden="true" />
                                                </button>
                                            </Tooltip>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
                <footer className="creation-chat-dock">
                    <div className="creation-chat-controls">
                        {/* 模式切换固定在输入框左下角：首页与对话流共用同一位置，不再占用输入框上方的独立一行。 */}
                        <ModePicker mode={props.mode} onModeChange={props.onModeChange} />
                        {canOptimizePrompt ? (
                            <Tooltip title="用 AI 优化提示词">
                                <button type="button" className="creation-chat-control" onClick={() => setPromptOptimizerOpen(true)} aria-label="优化提示词" aria-expanded={promptOptimizerOpen} aria-haspopup="dialog">
                                    <PenLine />
                                    <span>优化</span>
                                </button>
                            </Tooltip>
                        ) : null}
                        <ModelPicker
                            config={props.config}
                            value={props.model}
                            onChange={props.onModelChange}
                            capability={props.mode}
                            requirements={props.modelRequirements}
                            className="creation-model-picker"
                            placeholder={`选择${modeLabels[props.mode]}模型`}
                            showSelectedPrice={false}
                            showOptionPrices
                            variant="creation"
                        />
                        {props.mode === "video" || (props.mode === "image" && imageSettingsSupported) ? (
                            <GenerationSettingsMenu {...props} costLabel={showCost ? `${!userId || routeQuote?.estimated ? "预估 " : ""}${formattedCredits} 积分` : undefined} costTitle={routeQuote ? modelQuoteDescription(routeQuote) : undefined} />
                        ) : null}
                        {props.mode === "text" ? (
                            <>
                                <Tooltip title={interactionBusy ? "生成中，暂不能切换流式输出" : props.textStreaming ? "流式输出已开启" : "流式输出已关闭"}>
                                    <button type="button" className="creation-chat-control is-streaming" aria-label="流式输出" aria-pressed={props.textStreaming} disabled={interactionBusy} onClick={() => props.setTextStreaming(!props.textStreaming)}>
                                        <Waves />
                                        <span>流式</span>
                                    </button>
                                </Tooltip>
                                <ThinkingControl levels={props.textThinkingLevels} value={props.textThinkingRequest} resolvedLevel={props.textThinkingLevel} onChange={props.setTextThinkingLevel} disabled={interactionBusy} />
                            </>
                        ) : null}
                        {props.prompt.trim() || props.attachments.length || props.references.some((reference) => reference.active) ? (
                            <Tooltip title="清空提示词和参考内容">
                                <button type="button" className="creation-chat-control is-clear" onClick={props.onClearComposer} disabled={interactionBusy} aria-label="清空提示词和参考内容">
                                    <Trash2 />
                                    <span>清空</span>
                                </button>
                            </Tooltip>
                        ) : null}
                    </div>
                    <div className={`creation-submit ${showCost ? "has-cost" : ""}`}>
                        {showCost ? (
                            <span className="creation-submit-cost" title={routeQuote ? modelQuoteDescription(routeQuote) : undefined}>
                                <CreditSymbol />
                                <span>{!userId || routeQuote?.estimated ? `预估:${formattedCredits}` : formattedCredits}</span>
                            </span>
                        ) : null}
                        <button
                            type="button"
                            className="creation-submit-action"
                            disabled={interactionBusy || !canSubmit}
                            onClick={props.onSubmit}
                            aria-label={actionLabel}
                            aria-busy={showWorkingSpinner}
                            title={!canSubmit && !showWorkingSpinner ? "输入创作想法后即可生成" : actionLabel}
                        >
                            {showWorkingSpinner ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
                        </button>
                    </div>
                </footer>
                {props.mode === "image" || props.mode === "video" ? (
                    <MediaSettingsNotice
                        config={{ ...props.config, model: props.model }}
                        capability={props.mode}
                        onChange={(field, value) => {
                            if (field === "size") props.setRatio(value);
                            else if (field === "quality") props.setQuality(value);
                            else if (field === "imageResolution") props.setImageResolution(value);
                            else if (field === "imageParameters") props.setImageParameters(value);
                            else if (field === "count") props.setCount(value);
                            else if (field === "videoSeconds") props.setSeconds(value);
                            else if (field === "vquality") props.setVideoQuality(value);
                        }}
                    />
                ) : null}
                <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
            </SpotlightSurface>
        </HoverBorderGradient>
    );

    if (!promptOptimizerOpen) return composer;

    return (
        <Suspense fallback={composer}>
            <CanvasPromptOptimizerDrawer
                open={promptOptimizerOpen}
                prompt={props.prompt}
                generationMode={props.mode === "video" ? "video" : "image"}
                targetModel={modelOptionName(props.model) || props.model}
                targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(props.model))?.protocol || priceChannel.interfaceType}
                config={props.config}
                optimizerModel={props.config.textModel}
                references={optimizerReferences}
                provider={props.promptOptimizerProvider}
                onClose={() => setPromptOptimizerOpen(false)}
                onApply={props.setPrompt}
            >
                {composer}
            </CanvasPromptOptimizerDrawer>
        </Suspense>
    );
}

type CreationModeTabBox = { x: number; y: number; w: number; h: number };

/**
 * 创作模式切换：测量当前 aria-pressed 按钮以定位胶囊指示器。
 * 首页与对话流都把紧凑版放进输入框左下角的 dock，尺寸由 `.creation-chat-dock` 的上下文规则收口。
 */
export function CreationModeTabs({ mode, onModeChange, orientation = "horizontal" }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void; orientation?: "horizontal" | "vertical" }) {
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const [tabBox, setTabBox] = useState<CreationModeTabBox | null>(null);
    const [ready, setReady] = useState(false);
    const columnCount = 3;
    const items: { mode: CreationMode; icon: ReactNode; label: string }[] = [
        { mode: "video", icon: <Film />, label: "视频" },
        { mode: "image", icon: <ImageIcon />, label: "图片" },
        { mode: "text", icon: <MessageSquareText />, label: "文本" },
    ];

    // 首帧之后才开放过渡：初次测量是从 0 滑到目标位，否则加载时会自己动一下。
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setReady(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    useLayoutEffect(() => {
        const container = tabsRef.current;
        if (!container) return;
        const measure = () => {
            const active = container.querySelector<HTMLElement>('.creation-mode-button[aria-pressed="true"]');
            if (!active) return;
            const next = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
            setTabBox((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next));
        };
        measure();
        // 观察容器而不是按钮：窄屏换行、dock 的 max-content 宽度、字体加载都会改容器尺寸。
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [mode, orientation, columnCount]);

    const visualStyle = {
        gridTemplateColumns: orientation === "vertical" ? "minmax(0, 1fr)" : `repeat(${columnCount}, minmax(0, 1fr))`,
        "--creation-tab-x": `${tabBox?.x ?? 0}px`,
        "--creation-tab-y": `${tabBox?.y ?? 0}px`,
        "--creation-tab-w": `${tabBox?.w ?? 0}px`,
        "--creation-tab-h": `${tabBox?.h ?? 0}px`,
    } as CSSProperties;

    return (
        <div ref={tabsRef} className="creation-mode-tabs" role="group" aria-label="创作模式" data-active-mode={mode} data-orientation={orientation} data-ready={ready ? "true" : "false"} style={visualStyle}>
            <span className="creation-mode-indicator" aria-hidden />
            {items.map((item) => (
                <button key={item.mode} type="button" className="creation-mode-button" data-mode={item.mode} aria-pressed={item.mode === mode} aria-label={`${item.label}生成`} onClick={() => onModeChange(item.mode)}>
                    {item.icon}
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
}

const MODE_CAPSULE_ITEMS: { mode: CreationMode; icon: ReactNode; label: string }[] = [
    { mode: "text", icon: <MessageSquareText className="size-3.5" />, label: "生文本" },
    { mode: "image", icon: <ImageIcon className="size-3.5" />, label: "生图片" },
    { mode: "video", icon: <Film className="size-3.5" />, label: "生视频" },
];

/**
 * 输入框左下角的紧凑型胶囊式选项：
 * 选中的 tab 展示图标+对应文本，未选中的 tab 仅展示图标以极致节省空间。
 */
function ModePicker({ mode, onModeChange }: { mode: CreationMode; onModeChange: (mode: CreationMode) => void }) {
    return (
        <div className="creation-mode-capsule-row" role="radiogroup" aria-label="创作生成模式切换">
            {MODE_CAPSULE_ITEMS.map((item) => {
                const isSelected = item.mode === mode;
                return (
                    <button
                        key={item.mode}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={cn("creation-mode-capsule-btn", isSelected && "is-active")}
                        onClick={() => onModeChange(item.mode)}
                        title={item.label}
                        aria-label={`切换到${item.label}模式`}
                    >
                        <span className="creation-mode-capsule-icon" aria-hidden="true">
                            {item.icon}
                        </span>
                        {isSelected ? <span className="creation-mode-capsule-label">{item.label}</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

/** 触发器上的参数摘要（纯函数，无交互）：图片「比例 · 清晰度 · 张数」、视频「画幅 · 清晰度 · 时长」。 */
function composerSettingsSummary(props: ComposerProps, imageBatchLimit: number) {
    const activeQualityOptions = props.imageProfile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: imageQualityLabel(value), description: "模型支持的质量/分辨率" });
    const qualityLabel = activeQualityOptions.find((item) => item.value === props.quality)?.label || qualityOptions.find((item) => item.value === props.quality)?.label || props.quality || "自动";
    // 尺寸/比例/分辨率选项取同显示名分组内全部模型的并集，路由模型只决定发送参数。
    const mergedProfile = mergedImageCapabilityConfig(props.config, props.model || props.config.imageModel);
    const usesImageResolutionPicker = props.mode === "image" && supportsImageResolutionPresets(mergedProfile.size);
    const imageResolutionOptions = usesImageResolutionPicker ? buildImageResolutionOptions(mergedProfile.size.values) : [];
    const referenceImageSize = props.mode === "image" && mergedProfile.size.allowCustom ? props.referenceImageSize : undefined;
    const referenceImageSizeValue = referenceImageSize ? String(referenceImageSize.width) + "x" + String(referenceImageSize.height) : "";
    const referenceImageSizeLabel = referenceImageSize ? String(referenceImageSize.width) + " × " + String(referenceImageSize.height) : "";
    const referenceImageSizeSelected = Boolean(referenceImageSizeValue && props.ratio === referenceImageSizeValue);
    const videoResolutionSupported = props.mode === "video" && props.videoProfile.resolutions.length > 0;
    const imageSummary = [
        ...(mergedProfile.size.parameter !== "none" ? [referenceImageSizeSelected ? referenceImageSizeLabel : usesImageResolutionPicker ? formatImageResolutionSize(props.ratio, imageResolutionOptions) : props.ratio] : []),
        ...(props.imageProfile.quality.supported ? [qualityLabel] : []),
        ...(imageBatchLimit > 1 ? [props.count] : []),
    ].join(" · ");
    const videoRatioSupported = props.mode === "video" && props.videoProfile.ratios.length > 0;
    // 视频摘要带上时长，时长不再单独占一个入口。
    const videoDurationSupported = props.mode === "video" && props.videoProfile.durationSupported !== false && Boolean(props.seconds);
    return props.mode === "video" ? [...(videoRatioSupported ? [props.ratio] : []), ...(videoResolutionSupported ? [videoResolutionLabel(props.videoQuality)] : []), ...(videoDurationSupported ? [`${props.seconds}s`] : [])].join(" · ") : imageSummary;
}

/** 输入坞里的「生成设置」入口：触发按钮显示当前参数摘要，面板走独立浮层（不塞进模型弹窗）。 */
function GenerationSettingsMenu({ costLabel, costTitle, ...props }: ComposerProps & { costLabel?: string; costTitle?: string }) {
    const [open, setOpen] = useState(false);
    const imageBatchLimit = Math.min(15, useGenerationBatchLimit());
    const summary = composerSettingsSummary(props, imageBatchLimit);
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={<ComposerSettingsPanel {...props} costLabel={costLabel} costTitle={costTitle} />}
        >
            <button type="button" className="creation-chat-control" aria-label={`生成设置：${summary}`}>
                <SlidersHorizontal />
                <span>{summary}</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

/** 生成参数面板本体：由「生成设置」按钮弹出。 */
function ComposerSettingsPanel({ costLabel, costTitle, ...props }: ComposerProps & { costLabel?: string; costTitle?: string }) {
    // 张数上限与发送时的实际单数保持一致。
    const imageBatchLimit = Math.min(15, useGenerationBatchLimit());
    // 尺寸/比例/分辨率选项取同显示名分组内全部模型的并集，路由模型只决定发送参数。
    const mergedProfile = mergedImageCapabilityConfig(props.config, props.model || props.config.imageModel);
    const referenceImageSize = props.mode === "image" && mergedProfile.size.allowCustom ? props.referenceImageSize : undefined;
    const applySettings = (patch: CreationSettingsPatch) => {
        if (patch.ratio !== undefined) props.setRatio(patch.ratio);
        if (patch.quality !== undefined) props.setQuality(patch.quality);
        if (patch.imageResolution !== undefined) props.setImageResolution(patch.imageResolution);
        if (patch.count !== undefined) props.setCount(String(patch.count));
        if (patch.videoQuality !== undefined) props.setVideoQuality(patch.videoQuality);
        if (patch.seconds !== undefined) props.setSeconds(String(patch.seconds));
    };
    // 声明式参数模型里本面板没有覆盖的字段（画面质感、种子等）追加在面板末尾，不能因为改版丢字段。
    const declaredExtras = (props.imageProfile.parameters || []).filter((field) => field.enabled !== false && !["size", "imageResolution", "count"].includes(field.name));
    const extraFields = declaredExtras.length ? (
        <ImageParameterFields
            profile={{ ...props.imageProfile, parameters: declaredExtras, size: { ...props.imageProfile.size, parameter: "none" }, resolution: { ...props.imageProfile.resolution, supported: false } }}
            countLimit={imageBatchLimit}
            showCount={false}
            showSize={false}
            config={{ ...props.config, model: props.model, size: props.ratio, quality: props.quality, imageResolution: props.imageResolution, imageParameters: props.imageParameters, count: props.count }}
            onChange={(key, value) => {
                const setters = {
                    size: props.setRatio,
                    quality: props.setQuality,
                    imageResolution: props.setImageResolution,
                    imageParameters: props.setImageParameters,
                    count: props.setCount,
                    transparentBackground: props.setTransparentBackground,
                };
                setters[key](value);
            }}
        />
    ) : undefined;
    return (
        <CreationSettingsPanel
            mode={props.mode === "video" ? "video" : "image"}
            imageProfile={mergedProfile}
            videoProfile={props.videoProfile}
            ratio={props.ratio}
            quality={props.quality}
            imageResolution={props.imageResolution}
            videoQuality={props.videoQuality}
            count={Number(props.count) || 1}
            countLimit={imageBatchLimit}
            seconds={Number(props.seconds) || 0}
            referenceImageSize={referenceImageSize}
            costLabel={costLabel}
            costTitle={costTitle}
            extra={extraFields}
            onChange={applySettings}
        />
    );
}

function ThinkingControl({ levels, value, resolvedLevel, onChange, disabled }: { levels: ThinkingLevel[]; value: ThinkingRequest; resolvedLevel: ThinkingLevel | ""; onChange: (value: ThinkingRequest) => void; disabled: boolean }) {
    if (!levels.length) return null;
    return (
        <div className="creation-thinking-inline">
            <ThinkingLevelSlider levels={levels} value={value} resolvedLevel={resolvedLevel} onChange={onChange} disabled={disabled} />
        </div>
    );
}
