import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Heart, Wand2 } from "lucide-react";

import { Tooltip } from "@/components/ui/base/tooltip";
import { AppModal } from "@/components/ui/product/app-modal";
import { catalogIdOf, inspirationSourceOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { modeLabels } from "@/pages/create/creation-types";
import { INSPIRATION_POLICY_VERSION } from "@/services/api/zzai-gallery";
import { getInspirationPrompt, normalizeInspirationDetail } from "@/services/api/online-gallery";
import { useUserStore } from "@/stores/use-user-store";
import { InspirationDetailMedia } from "./inspiration-detail-media";

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
 * 灵感大厅与首页共用在线正文；收藏按钮和分类行按调用方能力展示。
 */
export function InspirationDetailModal({ item, afterClose, ...props }: Omit<Parameters<typeof InspirationDetailContent>[0], "item"> & { item: CreationInspiration | null; afterClose?: () => void }) {
    const scope = useUserStore((state) => state.user?.id ?? "guest");
    const licensed = item?.sourceId === "authorized-library";
    const detail = useQuery({
        queryKey: ["public", "inspirations", licensed ? "authorized-library" : "official-catalog", licensed ? INSPIRATION_POLICY_VERSION : "official-v1", "detail", scope, item?.id],
        queryFn: ({ signal }) => {
            if (!item?.id) throw new Error("缺少示例标识");
            return getInspirationPrompt(item.id, signal);
        },
        enabled: Boolean(item),
        retry: false,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 60_000,
    });
    return (
        <AppModal open={Boolean(item)} onCancel={props.onClose} afterClose={afterClose} width={1080} title={null} footer={null} flush closable={false}>
            {item && detail.isSuccess && detail.isFetchedAfterMount ? <InspirationDetailContent {...props} item={detail.data} videoUrl={detail.data.videoUrl} /> : null}
            {item && !detail.isError && (!detail.isSuccess || !detail.isFetchedAfterMount) ? <p role="status">{licensed ? "正在核验授权素材…" : "正在读取官方目录…"}</p> : null}
            {item && detail.isError ? (
                <p role="alert">
                    当前素材不可用，正文和媒体已隐藏。<Button onClick={() => void detail.refetch()}>重试核验</Button>
                </p>
            ) : null}
        </AppModal>
    );
}

/** 大厅在同一弹窗里切换列表与详情，复用正文而不再叠一层 Modal。 */
export function InspirationDetailContent({
    item: candidate,
    categoryLabel,
    favorite = false,
    favoriteDisabled = false,
    onClose,
    onUse,
    onToggleFavorite,
    onCopy,
    videoUrl = candidate.videoUrl,
    closeLabel = "关闭",
    useLabel = "用这个创意创作",
    useDisabled = false,
}: {
    item: CreationInspiration;
    categoryLabel?: (item: CreationInspiration) => string;
    favorite?: boolean;
    favoriteDisabled?: boolean;
    onClose: () => void;
    onUse: (item: CreationInspiration) => void;
    onToggleFavorite?: (item: CreationInspiration) => void;
    onCopy: (text: string, label: string) => void;
    videoUrl?: string;
    closeLabel?: string;
    useLabel?: string;
    useDisabled?: boolean;
}) {
    let item: CreationInspiration;
    try {
        item = normalizeInspirationDetail(candidate);
    } catch {
        return (
            <p role="alert">
                历史素材未通过当前授权核验，已隐藏。<Button onClick={onClose}>{closeLabel}</Button>
            </p>
        );
    }
    const source = inspirationSourceOf(item);
    const hasLibraryActions = Boolean(onToggleFavorite);

    return (
        /* 左图右文：图片按原图比例完整显示（不裁切、不放大超过原图），
                   右栏是弹窗里唯一的滚动区，提示词正文因此能整段铺开而不是塞在一个小框里。 */
        <div className="inspiration-detail">
            <InspirationDetailMedia key={`${catalogIdOf(item)}:${videoUrl ?? ""}`} item={item} videoUrl={videoUrl} />

            <div className="inspiration-detail-main">
                <div className="inspiration-detail-body">
                    <div className="min-w-0">
                        <h2 className="text-[var(--fs-heading,16px)] font-semibold leading-6 text-foreground">{item.title}</h2>
                        {item.description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{item.description}</p> : null}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <MetaRow label="来源">
                            {source.name ?? source.label}
                            {item.credit && item.credit !== (source.name ?? source.label) ? ` · ${item.credit}` : ""}
                        </MetaRow>
                        {item.model ? <MetaRow label="模型">{item.model}（上游标注）</MetaRow> : null}
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
                        {item.authorization?.policyVersion === "licensed-v1"
                            ? (
                                  [
                                      ["提示词许可", item.authorization.promptLicense],
                                      ["媒体许可", item.authorization.mediaLicense],
                                  ] as const
                              ).map(([label, license]) => (
                                  <MetaRow key={label} label={label}>
                                      <a href={license.url} target="_blank" rel="noreferrer">
                                          {license.name}
                                      </a>
                                      {` · ${license.attribution}`}
                                      {license.rightsholder ? ` · 权利人：${license.rightsholder}` : ""}
                                  </MetaRow>
                              ))
                            : null}
                    </div>

                    {source.notice ? (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-foreground/65">
                            {!item.sourceUrl ? <p>上游未标注原始出处，不能视为原创。</p> : null}
                            <p>{source.notice}</p>
                            {item.requiresReference ? <p className="mt-1 font-medium">此案例需要参考素材；带入提示词后，请自行添加相应图片或视频，不会自动复用上游人物素材。</p> : null}
                            {item.usageNotes ? <p className="mt-1 whitespace-pre-wrap">{item.usageNotes}</p> : null}
                        </div>
                    ) : null}

                    <PromptSection label={item.promptZh ? "提示词 · 中文" : "提示词"} text={item.promptZh || item.prompt} onCopy={onCopy} />
                    {item.promptZh && item.prompt !== item.promptZh ? <PromptSection label="提示词 · 原文" text={item.prompt} onCopy={onCopy} /> : null}
                </div>

                <div className="inspiration-detail-footer">
                    {/* 库管理动作放底栏：正文区留给阅读，也不再和关闭按钮抢右上角。 */}
                    {hasLibraryActions ? (
                        <div className="flex items-center gap-1.5">
                            {onToggleFavorite ? (
                                <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                    <button type="button" className="inspiration-icon-button" aria-label={favorite ? "取消收藏" : "收藏"} aria-pressed={favorite} disabled={favoriteDisabled} onClick={() => onToggleFavorite(item)}>
                                        <Heart className="size-4" fill={favorite ? "currentColor" : "none"} />
                                    </button>
                                </Tooltip>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                        <Button onClick={onClose}>{closeLabel}</Button>
                        <Button type="primary" disabled={useDisabled} icon={<Wand2 className="size-4" />} onClick={() => onUse(item)}>
                            {useLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PromptSection({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, label: string) => void }) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground/58">{label}</h3>
                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(text, label)}>
                    复制提示词
                </Button>
            </div>
            <div className="inspiration-prompt-block">{text}</div>
        </section>
    );
}
