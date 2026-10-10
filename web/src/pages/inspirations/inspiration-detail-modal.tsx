import { Button } from "antd";
import { Copy, ExternalLink, Heart, Pencil, Trash2, Wand2 } from "lucide-react";

import { Tooltip } from "@/components/ui/base/tooltip";
import { AppModal } from "@/components/ui/product/app-modal";
import { catalogIdOf, inspirationSourceOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { isCustomInspiration } from "@/lib/inspirations/resolve";
import { modeLabels } from "@/pages/create/creation-types";

// 弹窗的样式（.inspiration-detail* / .inspiration-prompt-block / .inspiration-icon-button / 标签 chip）
// 都在灵感库样式表里，和画廊共用同一套 token 与视觉语言。
// ⚠️ 必须由弹窗自己 import，不能只挂在 `pages/inspirations/index.tsx` 上：
// 首页瀑布流也渲染这个弹窗，而 /create 是独立路由、冷启动时不会加载灵感库页面的样式模块——
// 只挂页面的话，首页里弹窗会退化成没有 grid、没有滚动区的大方块（实测撑到 953px 且溢出视口）。
import "./inspirations.css";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-baseline gap-3 text-xs leading-5">
            <span className="w-12 shrink-0 text-foreground/45">{label}</span>
            <span className="min-w-0 flex-1 text-foreground/78">{children}</span>
        </div>
    );
}

/**
 * 灵感详情弹窗。
 *
 * 两种用法：灵感页给全量能力（收藏 / 编辑 / 删除都是库管理动作）；
 * 首页瀑布流只借它做「看一眼完整提示词」，所以那一组按钮与分类行都是可选的，
 * 不传就不渲染——首页不该出现改库的入口。
 */
export function InspirationDetailModal({
    item,
    categoryLabel,
    favorite = false,
    onClose,
    onUse,
    onEdit,
    onDelete,
    onToggleFavorite,
    onCopy,
    afterClose,
}: {
    item: CreationInspiration | null;
    categoryLabel?: (item: CreationInspiration) => string;
    favorite?: boolean;
    onClose: () => void;
    onUse: (item: CreationInspiration) => void;
    onEdit?: (item: CreationInspiration) => void;
    onDelete?: (item: CreationInspiration) => void;
    onToggleFavorite?: (item: CreationInspiration) => void;
    onCopy: (text: string, label: string) => void;
    /**
     * 弹窗连动画都放完、子节点已卸载后触发。
     *
     * 调用方若要在这之后再去做「抢焦点」的动作（例如把提示词填进创作输入框并聚焦），
     * 必须挂在这里：AntD Modal 关闭动画结束后会把焦点还给打开它的元素，
     * 直接在 onUse 里 focus 会被这一下覆盖掉。
     */
    afterClose?: () => void;
}) {
    const source = item ? inspirationSourceOf(item) : null;
    const custom = item ? isCustomInspiration(catalogIdOf(item)) : false;
    const hasLibraryActions = Boolean(onToggleFavorite || onEdit || onDelete);

    return (
        /* closable={false}：两栏布局下右上角的 X 会压在正文上，而底栏本来就有「关闭」，
           关掉它省得出现两个关闭入口。Esc 与点遮罩照常可关。 */
        <AppModal open={Boolean(item)} onCancel={onClose} afterClose={afterClose} width={1080} title={null} footer={null} flush closable={false}>
            {item ? (
                /* 左图右文：图片按原图比例完整显示（不裁切、不放大超过原图），
                   右栏是弹窗里唯一的滚动区，提示词正文因此能整段铺开而不是塞在一个小框里。 */
                <div className="inspiration-detail">
                    <div className="inspiration-detail-media">
                        <img src={item.image} alt="" width={item.width} height={item.height} referrerPolicy="no-referrer" />
                    </div>

                    <div className="inspiration-detail-main">
                        <div className="inspiration-detail-body">
                            <div className="min-w-0">
                                <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                                {item.description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{item.description}</p> : null}
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <MetaRow label="来源">
                                    {source?.name ?? "原创"}
                                    {item.credit ? ` · ${item.credit}` : ""}
                                </MetaRow>
                                {categoryLabel ? <MetaRow label="分类">{categoryLabel(item)}</MetaRow> : null}
                                <MetaRow label="类型">
                                    {modeLabels[item.mode]}
                                    {item.ratio ? ` · ${item.ratio}` : ""}
                                </MetaRow>
                                {item.tags?.length ? (
                                    <MetaRow label="标签">
                                        <span className="flex flex-wrap gap-1.5">
                                            {item.tags.map((tag) => (
                                                <span key={tag} className="inspiration-chip">
                                                    {tag}
                                                </span>
                                            ))}
                                        </span>
                                    </MetaRow>
                                ) : null}
                                {item.sourceUrl ? (
                                    <MetaRow label="原页">
                                        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                            查看上游内容 <ExternalLink className="size-3" />
                                        </a>
                                    </MetaRow>
                                ) : null}
                            </div>

                            <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                            {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                        </div>

                        <div className="inspiration-detail-footer">
                            {/* 库管理动作放底栏：正文区留给阅读，也不再和关闭按钮抢右上角。 */}
                            {hasLibraryActions ? (
                                <div className="flex items-center gap-1.5">
                                    {onToggleFavorite ? (
                                        <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                            <button type="button" className="inspiration-icon-button" aria-pressed={favorite} onClick={() => onToggleFavorite(item)}>
                                                <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                    {onEdit ? (
                                        <Tooltip title="编辑">
                                            <button type="button" className="inspiration-icon-button" onClick={() => onEdit(item)}>
                                                <Pencil className="size-4" />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                    {onDelete ? (
                                        <Tooltip title={custom ? "删除" : "从库中隐藏"}>
                                            <button type="button" className="inspiration-icon-button" onClick={() => onDelete(item)}>
                                                <Trash2 className="size-4" />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="ml-auto flex items-center gap-2">
                                <Button onClick={onClose}>关闭</Button>
                                <Button type="primary" icon={<Wand2 className="size-4" />} onClick={() => onUse(item)}>
                                    用这个创意创作
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

function PromptSection({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground/58">{label}</h3>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text, label)}>
                    复制
                </Button>
            </div>
            <div className="inspiration-prompt-block">{text}</div>
        </section>
    );
}
