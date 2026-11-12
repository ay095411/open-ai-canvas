import { useState, type ReactNode } from "react";
import { Button, Checkbox, Typography } from "antd";
import { ArrowDownToLine, Check, CircleAlert, Clock3, Image as ImageIcon, LoaderCircle, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { GenerationTask } from "@/services/api/task-center";
import type { EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import type { AiConfig } from "@/stores/use-config-store";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { resolveResourceVariantUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { EcommerceExportItem } from "./export";
import { imageTypes, labelOf } from "./catalog";
import { commerceCanvasAspect } from "./canvas-layout";
import { CommerceResultImage } from "./result-image";
import { SingleImageEditor, imageResultAsset } from "./result-gallery";
import "./output-gallery.css";

type OutputImage = { image: EcommercePlanImage; index: number; task?: GenerationTask; src?: string; assetId?: string; resourceId?: string };

type OutputState = "active" | "done" | "failed" | "waiting";
type OutputFilter = "all" | OutputState;
const filters: Array<[OutputFilter, string]> = [
    ["all", "全部"],
    ["done", "已完成"],
    ["active", "生成中"],
    ["failed", "失败"],
    ["waiting", "待生成"],
];

export function EcommerceOutputGallery({
    config,
    draft,
    plan,
    tasks,
    imageModels,
    qualityIssues,
    selected,
    onSelect,
    onDownload,
    onRemove,
    onRegenerate,
    onRetry,
    generationPending,
    regeneratingIds = new Set<string>(),
    regenerationPreviews = {},
    historyHasMore = false,
    historyLoading = false,
    onLoadMoreHistory,
    stage,
    stageActive = false,
    nextStep,
    exportCount = 0,
    exportDisabled = false,
    onExport,
    preparedDownload,
    progress,
}: {
    config: AiConfig;
    draft: EcommerceDraft;
    plan: EcommercePlan | null;
    tasks: Record<string, GenerationTask>;
    imageModels: string[];
    qualityIssues?: Record<string, string[]>;
    selected: Set<string>;
    onSelect: (id: string) => void;
    onDownload: (item: EcommerceExportItem) => void;
    onRemove: (image: EcommercePlanImage) => Promise<void>;
    onRegenerate: (image: EcommercePlanImage) => Promise<void>;
    onRetry: (image: EcommercePlanImage) => void;
    generationPending: boolean;
    regeneratingIds?: Set<string>;
    regenerationPreviews?: Record<string, string>;
    /** 历史轮次按页读取；还有更早的轮次时显示“加载更多”。 */
    historyHasMore?: boolean;
    historyLoading?: boolean;
    onLoadMoreHistory?: () => void;
    /** 本轮流程：已发送的需求、视觉方向、方案审阅与进度，显示在作品之上。 */
    stage?: ReactNode;
    stageActive?: boolean;
    /** 空态里告诉用户下一步做什么。 */
    nextStep?: string;
    exportCount?: number;
    exportDisabled?: boolean;
    onExport?: () => void;
    preparedDownload?: { url: string; fileName: string };
    /** 流程进度条，固定在作品区顶部。 */
    progress?: ReactNode;
}) {
    const [preview, setPreview] = useState<OutputImage | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [filter, setFilter] = useState<OutputFilter>("all");
    const images = [...(plan?.previousImages || []), ...(plan?.images || [])];
    const stateOf = (image: EcommercePlanImage, pending: boolean) => outputState(image, image.taskId ? tasks[image.taskId] : undefined, regenerationPending(image, tasks, pending, regeneratingIds));
    const counts = { active: 0, done: 0, failed: 0, waiting: 0 };
    for (const image of plan?.images || []) {
        counts[stateOf(image, generationPending)] += 1;
    }
    for (const image of plan?.previousImages || []) {
        counts[stateOf(image, false)] += 1;
    }
    const visible = (image: EcommercePlanImage, pending: boolean) => filter === "all" || stateOf(image, pending) === filter;
    const card = (image: EcommercePlanImage, index: number, pending: boolean) => {
        const task = image.taskId ? tasks[image.taskId] : undefined;
        const assetId = imageResultAsset(task) || image.assetId;
        return (
            <OutputCard
                key={image.id}
                image={image}
                index={index}
                task={task}
                selected={selected.has(image.id)}
                working={regenerationPending(image, tasks, pending, regeneratingIds)}
                src={outputSource(image, tasks) || (pending ? regenerationPreviews[image.id] : undefined)}
                assetId={assetId}
                resourceId={resourceFor(image, tasks)}
                issues={qualityIssues?.[assetId || ""]}
                onSelect={() => onSelect(image.id)}
                onPreview={setPreview}
                onDownload={onDownload}
                onRetry={() => onRetry(image)}
                onEdit={() => setEditing(image.id)}
                onRemove={() => void onRemove(image)}
            />
        );
    };
    const current = (plan?.images || []).map((image, index) => ({ image, index })).filter(({ image }) => visible(image, generationPending));
    const previous = (plan?.previousImages || []).map((image, index) => ({ image, index })).filter(({ image }) => visible(image, false));
    const selectedImages = images.filter((image) => selected.has(image.id));
    const selectableImages = [...current, ...previous].map(({ image }) => image).filter((image) => imageResultAsset(image.taskId ? tasks[image.taskId] : undefined) || image.assetId);

    return (
        <section className="commerce-output-gallery" aria-label="商品作品">
            <header className="commerce-output-gallery-header">
                <div className="commerce-output-title">
                    <h2>商品作品{images.length ? <span className="commerce-output-total">{images.length}</span> : null}</h2>
                    {images.length ? <p role="status">{`${counts.done} 张已完成${counts.active ? `，${counts.active} 张生成中` : ""}${counts.failed ? `，${counts.failed} 张待处理` : ""}`}</p> : null}
                </div>
                <div className="commerce-output-tools">
                    {preparedDownload ? (
                        <Button icon={<ArrowDownToLine size={15} />} href={preparedDownload.url} download={preparedDownload.fileName}>
                            下载已打包文件
                        </Button>
                    ) : null}
                    {onExport ? (
                        <Button type={exportCount && !preparedDownload ? "primary" : "default"} icon={<ArrowDownToLine size={15} />} disabled={!exportCount || exportDisabled} onClick={onExport} aria-label={`导出图片，共 ${exportCount} 张`}>
                            {selectedImages.length ? `导出已选 ${exportCount}` : exportCount ? `导出 ${exportCount} 张` : "导出"}
                        </Button>
                    ) : null}
                </div>
            </header>
            {progress}
            {images.length ? (
                <div className="commerce-output-toolbar">
                    <div className="commerce-output-filters" role="group" aria-label="按状态筛选作品">
                        {filters.map(([value, label]) => (
                            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                                {label}
                                <span>{value === "all" ? images.length : counts[value]}</span>
                            </button>
                        ))}
                    </div>
                    <div className="commerce-output-selection">
                        {selectedImages.length ? <span>已选 {selectedImages.length} 张</span> : null}
                        {selectedImages.length ? (
                            <button type="button" onClick={() => selectedImages.forEach((image) => onSelect(image.id))}>
                                <X size={13} />
                                取消选择
                            </button>
                        ) : (
                            <button type="button" disabled={!selectableImages.length} onClick={() => selectableImages.filter((image) => !selected.has(image.id)).forEach((image) => onSelect(image.id))}>
                                选择可下载作品
                            </button>
                        )}
                    </div>
                </div>
            ) : null}
            <div className="commerce-output-scroll" data-canvas-wheel-scroll>
                {stageActive ? <div className="ecs-stage">{stage}</div> : null}
                {!images.length ? (
                    stageActive ? null : (
                        <div className="commerce-output-empty" role="status">
                            <ImageIcon size={28} strokeWidth={1.5} aria-hidden="true" />
                            <strong>暂无作品</strong>
                            <p>{nextStep || "添加商品图，填写画面描述。"}</p>
                        </div>
                    )
                ) : (
                    <div className="commerce-output-batches">
                        {current.length ? (
                            <section className="commerce-output-batch" aria-label="当前创作批次">
                                <header>
                                    <div>
                                        <strong>{plan!.images.length > 1 ? "本轮作品" : "本次创作"}</strong>
                                        <span>{filter === "all" ? `${plan!.images.length} 张` : `${current.length} / ${plan!.images.length} 张`}</span>
                                    </div>
                                </header>
                                <div className="commerce-output-grid">{current.map(({ image, index }) => card(image, index, generationPending))}</div>
                            </section>
                        ) : null}
                        {previous.length ? (
                            <section className="commerce-output-batch" aria-label="之前的商品作品">
                                <header>
                                    <div>
                                        <strong>之前的作品</strong>
                                        <span>{filter === "all" ? `${plan!.previousImages!.length} 张` : `${previous.length} / ${plan!.previousImages!.length} 张`}</span>
                                    </div>
                                </header>
                                <div className="commerce-output-grid">{previous.map(({ image, index }) => card(image, index, false))}</div>
                            </section>
                        ) : null}
                        {historyHasMore && onLoadMoreHistory ? (
                            <div className="commerce-output-history-more">
                                <Button size="small" loading={historyLoading} onClick={onLoadMoreHistory}>
                                    加载更早的作品
                                </Button>
                            </div>
                        ) : null}
                        {!current.length && !previous.length ? (
                            <div className="commerce-output-filter-empty" role="status">
                                <ImageIcon size={24} strokeWidth={1.4} />
                                <strong>暂无{filters.find(([value]) => value === filter)?.[1]}的作品</strong>
                                <Button onClick={() => setFilter("all")}>查看全部作品</Button>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
            {preview ? (
                <AppModal open onCancel={() => setPreview(null)} footer={null} width="min(1120px, calc(100vw - 32px))" title={`${String(preview.index + 1).padStart(2, "0")} · ${labelOf(imageTypes, preview.image.imageType)}`}>
                    <div className="commerce-output-preview">
                        <CommerceResultImage key={preview.src} ratio={commerceCanvasAspect(preview.image.ratio)} src={preview.src || ""} alt={`第 ${preview.index + 1} 张商品图片预览`} />
                        <section>
                            <span className="commerce-output-eyebrow">作品信息</span>
                            <h3>{preview.image.goal || preview.image.theme || labelOf(imageTypes, preview.image.imageType)}</h3>
                            {preview.image.copy ? <p>{preview.image.copy}</p> : null}
                            <Typography.Text type="secondary">{preview.image.prompt}</Typography.Text>
                            <dl>
                                <div>
                                    <dt>用途</dt>
                                    <dd>{labelOf(imageTypes, preview.image.imageType)}</dd>
                                </div>
                                <div>
                                    <dt>模型</dt>
                                    <dd>{preview.image.imageModel}</dd>
                                </div>
                                <div>
                                    <dt>尺寸</dt>
                                    <dd>
                                        {preview.image.ratio} · {preview.image.resolution}
                                    </dd>
                                </div>
                            </dl>
                            {preview.assetId ? (
                                <Button type="primary" icon={<ArrowDownToLine size={14} />} onClick={() => onDownload({ image: preview.image, index: preview.index, assetId: preview.assetId!, resourceId: preview.resourceId })}>
                                    下载原图
                                </Button>
                            ) : null}
                            <Button
                                icon={<Pencil size={14} />}
                                onClick={() => {
                                    setEditing(preview.image.id);
                                    setPreview(null);
                                }}
                            >
                                修改这张
                            </Button>
                        </section>
                    </div>
                </AppModal>
            ) : null}
            {editing
                ? (() => {
                      const image = images.find((item) => item.id === editing);
                      if (!image) return null;
                      return (
                          <AppModal open onCancel={() => setEditing(null)} footer={null} width="min(600px, calc(100vw - 32px))" title={`修改第 ${images.indexOf(image) + 1} 张`}>
                              <SingleImageEditor config={config} draft={image.sourceDraft || draft} image={image} imageModels={imageModels} onClose={() => setEditing(null)} onGenerate={onRegenerate} />
                          </AppModal>
                      );
                  })()
                : null}
        </section>
    );
}

function OutputCard({
    image,
    index,
    task,
    selected,
    working,
    src,
    assetId,
    resourceId,
    issues,
    onSelect,
    onPreview,
    onDownload,
    onRetry,
    onEdit,
    onRemove,
}: {
    image: EcommercePlanImage;
    index: number;
    task?: GenerationTask;
    selected: boolean;
    working: boolean;
    src?: string;
    assetId?: string;
    resourceId?: string;
    issues?: string[];
    onSelect: () => void;
    onPreview: (image: OutputImage) => void;
    onDownload: (item: EcommerceExportItem) => void;
    onRetry: () => void;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const state = outputState(image, task, working);
    const failed = state === "failed";
    const status = state === "active" ? (!image.taskId || task?.status === "queued" ? "排队中" : task?.stage || "生成中") : state === "done" ? "已完成" : task?.status === "cancelled" ? "已取消" : failed ? "生成失败" : "待生成";
    const title = `${String(index + 1).padStart(2, "0")} · ${labelOf(imageTypes, image.imageType)}`;
    const openPreview = () => src && onPreview({ image, index, src: resourceId ? resolveResourceVariantUrl(`resource:${resourceId}`, "original") : src, assetId, resourceId });
    return (
        <article className={`commerce-output-card${selected ? " is-selected" : ""}`} data-ecommerce-image-id={image.id} data-status={state}>
            <header className="commerce-output-card-heading">
                <Checkbox checked={selected} disabled={!assetId} onChange={onSelect} aria-label={`选择第 ${index + 1} 张图片`}>
                    <span className="commerce-output-card-number">{String(index + 1).padStart(2, "0")}</span>
                </Checkbox>
                <span className="commerce-output-status" title={status}>
                    {state === "done" ? <Check size={13} /> : state === "active" ? <LoaderCircle size={13} className="commerce-output-spin" /> : failed ? <CircleAlert size={13} /> : <Clock3 size={13} />}
                    <span>{status}</span>
                </span>
            </header>
            <div className="commerce-output-card-frame">
                <button type="button" className="commerce-output-card-media" disabled={!src} style={!src ? { aspectRatio: commerceCanvasAspect(image.ratio) } : undefined} onClick={openPreview} aria-label={`预览第 ${index + 1} 张图片`}>
                    {src ? (
                        <CommerceResultImage key={src} ratio={commerceCanvasAspect(image.ratio)} src={src} alt={`${labelOf(imageTypes, image.imageType)}生成结果`} loading="lazy" />
                    ) : working ? (
                        <span className="commerce-output-pending-artwork" role="status">
                            <span className="commerce-output-pending-layout" aria-hidden="true">
                                <i />
                                <i />
                                <i />
                            </span>
                            <strong>{status}</strong>
                            <span>{!image.taskId || task?.status === "queued" ? "轮到这张时会自动开始" : "完成后会自动呈现在这里"}</span>
                        </span>
                    ) : (
                        <span className="commerce-output-empty-card">
                            {failed ? <CircleAlert size={26} strokeWidth={1.4} /> : <ImageIcon size={26} strokeWidth={1.4} />}
                            <strong>{failed ? (task?.canRecoverMedia ? "作品等待保存" : "这张作品未完成") : state === "done" ? "预览暂不可用" : "画面已就绪，等待生成"}</strong>
                            <span>{failed ? (task?.canRecoverMedia ? "点击重新保存，取回已生成的图片" : "可重试，或修改画面后再次生成") : state === "done" ? "已保存的作品仍可从下载入口获取" : "确认创作方案后，图片会出现在这里"}</span>
                        </span>
                    )}
                </button>
                {src ? (
                    <span className="commerce-output-preview-hint" aria-hidden="true">
                        查看原图
                    </span>
                ) : null}
            </div>
            <div className="commerce-output-card-meta">
                <strong className="commerce-output-card-title" title={image.goal || image.theme || title}>
                    {image.goal || image.theme || labelOf(imageTypes, image.imageType)}
                </strong>
                <span className="commerce-output-card-spec">
                    {labelOf(imageTypes, image.imageType)}
                    <span aria-hidden="true">·</span>
                    {image.ratio}
                    {image.resolution ? (
                        <>
                            <span aria-hidden="true">·</span>
                            {image.resolution}
                        </>
                    ) : null}
                </span>
            </div>
            {image.copy ? <p className="commerce-output-card-copy">{image.copy}</p> : null}
            {failed && task?.error ? <p className="commerce-output-card-error">{task.error}</p> : null}
            {issues?.length ? (
                <p className="commerce-output-issue">
                    <CircleAlert size={14} />
                    <span>需要检查：{issues.join("；")}</span>
                </p>
            ) : null}
            <footer>
                {failed ? (
                    <Button size="small" icon={<RotateCcw size={14} />} onClick={onRetry}>
                        {task!.canRecoverMedia ? "重新保存" : "重试"}
                    </Button>
                ) : null}
                <Button size="small" type="text" icon={<Pencil size={14} />} onClick={onEdit}>
                    修改这张
                </Button>
                {assetId ? (
                    <Button size="small" type="text" icon={<ArrowDownToLine size={14} />} aria-label={`下载第 ${index + 1} 张`} onClick={() => onDownload({ image, index, assetId, resourceId })}>
                        下载
                    </Button>
                ) : null}
                <Button className="commerce-output-remove" size="small" type="text" icon={<Trash2 size={14} />} aria-label={`从本轮移除第 ${index + 1} 张`} onClick={onRemove}>
                    移除
                </Button>
            </footer>
        </article>
    );
}

function outputState(image: EcommercePlanImage, task: GenerationTask | undefined, working: boolean): OutputState {
    if (working) return "active";
    if (task?.status === "succeeded" || (!task && image.deliveryStatus === "delivered")) return "done";
    if (task && ["failed", "cancelled"].includes(task.status)) return "failed";
    return "waiting";
}

function outputSource(image: EcommercePlanImage, tasks: Record<string, GenerationTask>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    try {
        const output = task?.status === "succeeded" ? parseBackendGenerationResult(task)?.images?.[0] : undefined;
        if (output?.storageKey) return resolveResourceVariantUrl(output.storageKey, "thumbnail");
        if (output?.dataUrl || task?.previewUrl) return output?.dataUrl || task?.previewUrl;
        if (image.resourceId) return resolveResourceVariantUrl(`resource:${image.resourceId}`, "thumbnail");
    } catch {
        if (task?.previewUrl) return task.previewUrl;
    }
    return undefined;
}

function resourceFor(image: EcommercePlanImage, tasks: Record<string, GenerationTask>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    try {
        return resourceIdFromStorageKey(task && parseBackendGenerationResult(task)?.images?.[0]?.storageKey) || image.resourceId;
    } catch {
        return image.resourceId;
    }
}

function regenerationPending(image: EcommercePlanImage, tasks: Record<string, GenerationTask>, generationPending: boolean, regeneratingIds: Set<string>) {
    const task = image.taskId ? tasks[image.taskId] : undefined;
    return regeneratingIds.has(image.id) || Boolean(image.taskId && (task ? ["queued", "running"].includes(task.status) : image.deliveryStatus !== "delivered")) || (!image.taskId && image.deliveryStatus !== "delivered" && generationPending);
}
