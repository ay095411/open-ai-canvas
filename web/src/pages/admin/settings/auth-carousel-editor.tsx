// 后台「登录页」分区里的轮播条目编辑器。
// 上传即时生效（选完文件就传），不走页面统一的「保存时上传」流程：
// 轮播是可增删的列表，把文件挂在草稿里再统一提交，ID 与文件的对应关系会变得很难追踪。

import { App, Button, Input, Segmented, Upload } from "antd";
import { ArrowDown, ArrowUp, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { uploadAppearanceAsset, type AdminAppearanceCarouselItem, type AppearanceCarouselKind } from "@/services/api/appearance";

import "./auth-carousel-editor.css";

const MAX_ITEMS = 8;

function newItem(): AdminAppearanceCarouselItem {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 10) : Math.random().toString(36).slice(2, 12);
    return { id, kind: "image", mediaResourceId: "", posterResourceId: "", title: "", subtitle: "" };
}

export function AuthCarouselEditor({ items, onChange, disabled }: { items: AdminAppearanceCarouselItem[]; onChange: (next: AdminAppearanceCarouselItem[]) => void; disabled: boolean }) {
    const { message } = App.useApp();
    const [uploadingSlot, setUploadingSlot] = useState<string>("");
    const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

    const patch = (id: string, changes: Partial<AdminAppearanceCarouselItem>) => {
        onChange(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    };

    const move = (index: number, delta: number) => {
        const next = [...items];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const upload = async (item: AdminAppearanceCarouselItem, field: "media" | "poster", file: File | undefined) => {
        if (!file || disabled) return;
        const isVideo = field === "media" && item.kind === "video";
        const slot = `carousel-${item.id}-${isVideo ? "video" : field === "poster" ? "poster" : "image"}`;
        setUploadingSlot(slot);
        try {
            const resource = await uploadAppearanceAsset(slot, file);
            if (field === "media") patch(item.id, { mediaResourceId: resource.id });
            else patch(item.id, { posterResourceId: resource.id });
            message.success(isVideo ? "轮播视频已上传" : field === "poster" ? "轮播封面已上传" : "轮播图片已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploadingSlot("");
            const input = inputsRef.current[`${item.id}:${field}`];
            if (input) input.value = "";
        }
    };

    return (
        <div className="auth-carousel-editor" aria-label="登录弹窗轮播">
            <header className="auth-carousel-editor-head">
                <div>
                    <strong>登录弹窗左侧轮播</strong>
                    <small>图片与视频可混排；留空时弹窗回退到下方那支品牌视频。最多 {MAX_ITEMS} 条，标题 40 字、副标题 60 字。</small>
                </div>
                <Button icon={<Plus className="size-3.5" />} disabled={disabled || items.length >= MAX_ITEMS} onClick={() => onChange([...items, newItem()])}>
                    添加条目
                </Button>
            </header>

            {items.length === 0 ? (
                <p className="auth-carousel-editor-empty">还没有配置轮播，弹窗左侧会播放登录页品牌视频。</p>
            ) : (
                <ul className="auth-carousel-editor-list">
                    {items.map((item, index) => {
                        const mediaSlot = `carousel-${item.id}-${item.kind === "video" ? "video" : "image"}`;
                        const posterSlot = `carousel-${item.id}-poster`;
                        const busy = Boolean(uploadingSlot);
                        return (
                            <li key={item.id} className="auth-carousel-editor-item">
                                <div className="auth-carousel-editor-item-head">
                                    <span className="auth-carousel-editor-order">{index + 1}</span>
                                    <Segmented
                                        size="small"
                                        value={item.kind}
                                        disabled={disabled || busy}
                                        aria-label={`第 ${index + 1} 条类型`}
                                        onChange={(value) => {
                                            const kind = value as AppearanceCarouselKind;
                                            // 类型切换后原资源多半对不上（图片当视频用会被后端拒），
                                            // 干脆清掉让管理员重新选，避免保存时才报错。
                                            onChange(items.map((entry) => (entry.id === item.id ? { ...entry, kind, mediaResourceId: "", posterResourceId: kind === "video" ? entry.posterResourceId : "" } : entry)));
                                        }}
                                        options={[
                                            { value: "image", label: "图片" },
                                            { value: "video", label: "视频" },
                                        ]}
                                    />
                                    <span className="auth-carousel-editor-item-actions">
                                        <Button type="text" size="small" icon={<ArrowUp className="size-3.5" />} disabled={disabled || busy || index === 0} aria-label="上移" onClick={() => move(index, -1)} />
                                        <Button type="text" size="small" icon={<ArrowDown className="size-3.5" />} disabled={disabled || busy || index === items.length - 1} aria-label="下移" onClick={() => move(index, 1)} />
                                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} disabled={disabled || busy} aria-label="删除" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} />
                                    </span>
                                </div>

                                <div className="auth-carousel-editor-fields">
                                    <label className="auth-carousel-editor-picker">
                                        <input
                                            ref={(node) => {
                                                inputsRef.current[`${item.id}:media`] = node;
                                            }}
                                            type="file"
                                            accept={item.kind === "video" ? "video/mp4,video/webm" : "image/png,image/jpeg,image/webp"}
                                            disabled={disabled || busy}
                                            onChange={(event) => void upload(item, "media", event.target.files?.[0])}
                                        />
                                        <span className="auth-carousel-editor-picker-box">
                                            <ImageIcon className="size-4" aria-hidden="true" />
                                        </span>
                                        <span className="auth-carousel-editor-picker-copy">
                                            <strong>{item.kind === "video" ? "视频" : "图片"}</strong>
                                            <em>{uploadingSlot === mediaSlot ? "上传中…" : item.mediaResourceId ? (item.kind === "video" ? "已配置视频" : "已配置图片") : "未配置"}</em>
                                            <small>{item.kind === "video" ? "MP4 / WebM，≤256MB" : "PNG / JPEG / WebP，≤10MB"}</small>
                                        </span>
                                    </label>

                                    {item.kind === "video" ? (
                                        <label className="auth-carousel-editor-picker is-poster">
                                            <input
                                                ref={(node) => {
                                                    inputsRef.current[`${item.id}:poster`] = node;
                                                }}
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                disabled={disabled || busy}
                                                onChange={(event) => void upload(item, "poster", event.target.files?.[0])}
                                            />
                                            <span className="auth-carousel-editor-picker-copy">
                                                <strong>封面（可选）</strong>
                                                <em>{uploadingSlot === posterSlot ? "上传中…" : item.posterResourceId ? "已配置" : "未配置"}</em>
                                                <small>视频起播前显示</small>
                                            </span>
                                        </label>
                                    ) : null}

                                    <div className="auth-carousel-editor-copy">
                                        <Input
                                            value={item.title}
                                            maxLength={40}
                                            placeholder="标题（如：Seedance 2.5）"
                                            disabled={disabled || busy}
                                            aria-label={`第 ${index + 1} 条标题`}
                                            onChange={(event) => patch(item.id, { title: event.target.value })}
                                        />
                                        <Input
                                            value={item.subtitle}
                                            maxLength={60}
                                            placeholder="副标题（如：当代最强视频模型）"
                                            disabled={disabled || busy}
                                            aria-label={`第 ${index + 1} 条副标题`}
                                            onChange={(event) => patch(item.id, { subtitle: event.target.value })}
                                        />
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="auth-carousel-editor-foot">媒体在上传后立即进入草稿；点「保存修改」才会写进线上配置。</p>
        </div>
    );
}
