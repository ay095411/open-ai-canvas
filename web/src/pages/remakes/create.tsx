import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Input, Progress, message } from "antd";
import { ArrowLeft, Check, FolderOpen, Upload, Video } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { Callout } from "@/components/ui/product/callout";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { initialRemakeSettings, remakeDuration } from "@/lib/remake/presentation";
import { createRemake, getRemakeModels, type RemakeSettings } from "@/services/api/remakes";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { buildRemakePickerItems, ensureRemakeResource } from "@/services/remake-assets";
import { useAssetStore } from "@/stores/use-asset-store";

import { missingRemakeModels, REMAKE_MAX_RANGE_MS, REMAKE_MAX_TARGET_IMAGES, RemakeDisclosure, RemakeModeSwitch, RemakeOutputFields, RemakeRangeFields, remakeSettingsSummary, RemakeTargetImages } from "./remake-settings-fields";
import "./remake-pages.css";

const MAX_SOURCE_BYTES = 1 << 30;

async function readVideoDuration(file: File) {
    return new Promise<number>((resolve) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        const done = (duration: number) => {
            video.removeAttribute("src");
            video.load();
            URL.revokeObjectURL(url);
            resolve(duration);
        };
        video.onloadedmetadata = () => (Number.isFinite(video.duration) && video.duration > 0 ? done(video.duration) : done(0));
        video.onerror = () => done(0);
        video.src = url;
    });
}

/** 两个主步骤的标题：编号在完成后变为对勾。 */
function StepTitle({ step, done, title, hint, extra }: { step: number; done: boolean; title: string; hint: string; extra?: React.ReactNode }) {
    return (
        <div className="remake-step-head">
            <span className={`remake-step-num${done ? " is-done" : ""}`} aria-hidden>
                {done ? <Check size={15} /> : step}
            </span>
            <div className="min-w-0 flex-1">
                <h2 className="remake-step-title">{title}</h2>
                <p className="remake-step-hint">{hint}</p>
            </div>
            {extra ? <div className="remake-step-extra">{extra}</div> : null}
        </div>
    );
}

export default function RemakeCreatePage() {
    const navigate = useNavigate();
    const sourceInput = useRef<HTMLInputElement>(null);
    const targetInput = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const modelsQuery = useQuery({ queryKey: ["remakes", "models"], queryFn: ({ signal }) => getRemakeModels(signal) });
    const [title, setTitle] = useState("");
    const [sourceResourceId, setSourceResourceId] = useState("");
    const [sourceName, setSourceName] = useState("");
    const [sourceDurationMs, setSourceDurationMs] = useState(0);
    const [targetResources, setTargetResources] = useState<Array<{ id: string; name: string }>>([]);
    const [settings, setSettings] = useState<RemakeSettings>(initialRemakeSettings);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [targetPickerOpen, setTargetPickerOpen] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const pickerItems = useMemo(() => buildRemakePickerItems(assets), [assets]);

    useEffect(() => {
        const catalog = modelsQuery.data;
        if (!catalog) return;
        setSettings((current) => ({
            ...current,
            models: {
                text: Object.keys(current.models.text).length ? current.models.text : catalog.defaults.text || {},
                image: Object.keys(current.models.image).length ? current.models.image : catalog.defaults.image || {},
                video: Object.keys(current.models.video).length ? current.models.video : catalog.defaults.video || {},
            },
        }));
    }, [modelsQuery.data]);

    const createMutation = useMutation({
        mutationFn: () =>
            createRemake({
                title: title.trim() || sourceName.replace(/\.[^.]+$/, "") || "新复刻项目",
                sourceResourceId,
                settings: { ...settings, targetResourceIds: targetResources.map((item) => item.id) },
            }),
        onSuccess: (detail) => navigate(`/remakes/${encodeURIComponent(detail.project.id)}`),
        onError: (error) => message.error(error instanceof Error ? error.message : "创建复刻项目失败"),
    });

    const onChooseSource = async (file?: File) => {
        if (!file) return;
        if (file.size > MAX_SOURCE_BYTES) {
            setUploadError("参考视频不能超过 1 GiB");
            return;
        }
        setUploadError("");
        setSourceResourceId("");
        setSourceName(file.name);
        setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
        setUploading(true);
        setUploadProgress(0);
        try {
            const duration = await readVideoDuration(file);
            const durationMs = duration > 0 ? Math.round(duration * 1000) : 0;
            setSourceDurationMs(durationMs);
            setSettings((current) => ({ ...current, sourceInMs: 0, sourceOutMs: durationMs }));
            const resource = await uploadResourceFile(file, "video", { fileName: file.name, durationMs: durationMs || undefined }, (uploaded, total) => setUploadProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0));
            setSourceResourceId(resource.id);
            setUploadProgress(100);
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "参考视频上传失败");
        } finally {
            setUploading(false);
        }
    };

    const chooseSourceAsset = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const pool = new Map([...pickerItems, ...(pickedItems || [])].map((item) => [item.id, item]));
        const item = ids[0] ? pool.get(ids[0]) : undefined;
        if (!item) throw new Error("请选择一个视频素材");
        setUploadError("");
        setUploading(true);
        try {
            const resourceId = await ensureRemakeResource(item, "video");
            const asset = item.asset;
            const durationMs = asset?.kind === "video" ? asset.data.durationMs || 0 : 0;
            setSourceResourceId(resourceId);
            setSourceName(item.title);
            setSourceDurationMs(durationMs);
            setTitle((current) => current || item.title.replace(/\.[^.]+$/, ""));
            setSettings((current) => ({ ...current, sourceInMs: 0, sourceOutMs: durationMs }));
            setSourcePickerOpen(false);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "读取素材失败";
            setUploadError(detail);
            throw error;
        } finally {
            setUploading(false);
        }
    };

    const addTargetFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploadError("");
        const remaining = REMAKE_MAX_TARGET_IMAGES - targetResources.length;
        if (remaining <= 0) {
            setUploadError("一个主体最多选择四张参考图");
            return;
        }
        setUploading(true);
        setUploadProgress(0);
        try {
            const picked = Array.from(files).slice(0, remaining);
            const uploaded: Array<{ id: string; name: string }> = [];
            for (const [index, file] of picked.entries()) {
                if (!file.type.startsWith("image/")) throw new Error("主体参考素材必须是图片");
                const resource = await uploadResourceFile(file, "image", { fileName: file.name }, (loaded, total) => {
                    const current = total > 0 ? loaded / total : 0;
                    setUploadProgress(Math.round(((index + current) / picked.length) * 100));
                });
                uploaded.push({ id: resource.id, name: file.name });
            }
            setTargetResources((current) => [...current, ...uploaded].slice(0, REMAKE_MAX_TARGET_IMAGES));
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "主体参考图上传失败");
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const addTargetAssets = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const remaining = REMAKE_MAX_TARGET_IMAGES - targetResources.length;
        if (ids.length > remaining) throw new Error("还可选择" + remaining + "张主体参考图");
        const pool = new Map([...pickerItems, ...(pickedItems || [])].map((item) => [item.id, item]));
        const selected = ids.map((id) => pool.get(id)).filter((item): item is AssetLibraryPickerItem => Boolean(item));
        if (selected.length !== ids.length) throw new Error("部分素材已不可用，请重新选择");
        setUploadError("");
        setUploading(true);
        const added: Array<{ id: string; name: string }> = [];
        try {
            for (const item of selected) {
                const id = await ensureRemakeResource(item, "image");
                if (!targetResources.some((resource) => resource.id === id) && !added.some((resource) => resource.id === id)) {
                    added.push({ id, name: item.title });
                }
            }
            setTargetResources((current) => [...current, ...added].slice(0, REMAKE_MAX_TARGET_IMAGES));
            setTargetPickerOpen(false);
        } catch (error) {
            if (added.length) setTargetResources((current) => [...current, ...added].slice(0, REMAKE_MAX_TARGET_IMAGES));
            const detail = error instanceof Error ? error.message : "读取主体参考图失败";
            setUploadError(detail);
            throw error;
        } finally {
            setUploading(false);
        }
    };

    const updateSettings = (patch: Partial<RemakeSettings>) => setSettings((current) => ({ ...current, ...patch }));

    const catalog = modelsQuery.data;
    const missingModels = missingRemakeModels(settings);
    const overLimit = settings.sourceOutMs > settings.sourceInMs && settings.sourceOutMs - settings.sourceInMs > REMAKE_MAX_RANGE_MS;
    const modelsReady = missingModels.length === 0 && Boolean(catalog);
    const ready = Boolean(sourceResourceId) && !uploading && !overLimit && modelsReady;
    const subjectReady = Boolean(settings.targetDescription.trim() && targetResources.length);
    // 目录里没有默认值的模型需要用户手选：此时强制展开「更多设置」，不依赖默认值回填的时序。
    const modelsNeedAttention = modelsQuery.isError || Boolean(catalog && missingModels.some((key) => !Object.keys(catalog.defaults[key] || {}).length));
    const showMore = moreOpen || modelsNeedAttention;

    const status = uploading
        ? { blocked: true, text: uploadProgress > 0 && uploadProgress < 100 ? `正在上传 ${uploadProgress}%` : "正在处理素材…" }
        : !sourceResourceId
          ? { blocked: true, text: "先上传参考视频" }
          : overLimit
            ? { blocked: true, text: "复刻区间超过 60 秒，请先缩短" }
            : modelsQuery.isPending
              ? { blocked: true, text: "正在读取可用模型…" }
              : !modelsReady
                ? { blocked: true, text: "模型未就绪，请在「更多设置」中选择" }
                : { blocked: false, text: subjectReady ? "准备就绪，创建后先分析参考片" : "准备就绪，新主体也可以进入工作台后再补充" };

    return (
        <WorkspacePage className="remake-create-page">
            <PageHeader
                title="新建复刻"
                description="上传参考视频，描述要换上的新主体，创建后在工作台拆镜并逐镜重新生成。"
                actions={
                    <Button icon={<ArrowLeft size={15} />} onClick={() => navigate("/remakes")}>
                        返回项目库
                    </Button>
                }
            />

            <div className="remake-create-layout">
                <section className="remake-create-panel" aria-label="参考视频">
                    <StepTitle
                        step={1}
                        done={Boolean(sourceResourceId) && !overLimit}
                        title="参考视频"
                        hint="保留它的镜头顺序与节奏"
                        extra={
                            sourceResourceId ? (
                                <>
                                    <Button size="small" type="text" icon={<FolderOpen size={14} />} disabled={uploading} onClick={() => setSourcePickerOpen(true)}>
                                        素材库
                                    </Button>
                                    <Button size="small" icon={<Upload size={14} />} disabled={uploading} onClick={() => sourceInput.current?.click()}>
                                        更换视频
                                    </Button>
                                </>
                            ) : null
                        }
                    />
                    <input
                        ref={sourceInput}
                        type="file"
                        accept="video/*"
                        className="sr-only"
                        onChange={(event) => {
                            void onChooseSource(event.target.files?.[0]);
                            event.currentTarget.value = "";
                        }}
                    />
                    {!sourceResourceId ? (
                        <>
                            <button
                                type="button"
                                className={`remake-source-dropzone${dragOver ? " is-dragging" : ""}`}
                                onClick={() => sourceInput.current?.click()}
                                disabled={uploading}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setDragOver(true);
                                }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    setDragOver(false);
                                    void onChooseSource(event.dataTransfer.files?.[0]);
                                }}
                            >
                                <span className="remake-dropzone-icon" aria-hidden>
                                    <Video size={26} />
                                </span>
                                <span className="remake-dropzone-title">{uploading && sourceName ? `正在上传 ${sourceName}` : "拖入视频，或点击上传"}</span>
                                <span className="remake-dropzone-meta">MP4 · MOV · WebM，最大 1 GiB；单次复刻 60 秒以内</span>
                            </button>
                            {uploading && sourceName ? <Progress className="mt-3" percent={uploadProgress} size="small" aria-label="参考视频上传进度" /> : null}
                            <p className="remake-source-alt">
                                已在素材库里？
                                <button type="button" className="remake-link" disabled={uploading} onClick={() => setSourcePickerOpen(true)}>
                                    从素材库选择
                                </button>
                            </p>
                        </>
                    ) : (
                        <div className="remake-source-preview">
                            <video className="remake-source-video" src={resourceFileUrl(sourceResourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                            <p className="remake-source-name">
                                <span className="truncate">{sourceName}</span>
                                {sourceDurationMs > 0 ? <span className="shrink-0 tabular-nums">{remakeDuration(sourceDurationMs)}</span> : null}
                            </p>
                            <RemakeRangeFields inMs={settings.sourceInMs} outMs={settings.sourceOutMs} durationMs={sourceDurationMs || undefined} overLimit={overLimit} onChange={updateSettings} />
                            {overLimit ? <p className="remake-error-text">复刻区间不能超过 60 秒，请缩短片段。</p> : null}
                        </div>
                    )}
                </section>

                <section className="remake-create-panel" aria-label="新主体">
                    <StepTitle step={2} done={subjectReady} title="新主体" hint="要换进视频的人物或产品，可稍后在工作台补充" />
                    <input
                        ref={targetInput}
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(event) => {
                            void addTargetFiles(event.target.files);
                            event.currentTarget.value = "";
                        }}
                    />
                    <label className="remake-field">
                        <span className="remake-field-label">描述</span>
                        <Input.TextArea maxLength={2000} rows={4} value={settings.targetDescription} onChange={(event) => updateSettings({ targetDescription: event.target.value })} placeholder="例如：穿米色风衣的短发女性 / 500ml 柑橘气泡水，瓶身带水珠" />
                    </label>
                    <RemakeTargetImages
                        items={targetResources}
                        uploading={uploading}
                        onUpload={() => targetInput.current?.click()}
                        onPickLibrary={() => setTargetPickerOpen(true)}
                        onRemove={(id) => setTargetResources((current) => current.filter((resource) => resource.id !== id))}
                    />
                </section>
            </div>

            <RemakeDisclosure
                className="remake-create-more"
                title="更多设置"
                summary={modelsNeedAttention ? "模型未就绪，请选择" : remakeSettingsSummary(settings, { includeMode: true })}
                attention={modelsNeedAttention}
                open={showMore}
                onToggle={() => setMoreOpen((open) => !open)}
            >
                <div className="remake-more-grid">
                    <label className="remake-field">
                        <span className="remake-field-label">项目名称</span>
                        <Input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="默认使用视频文件名" />
                    </label>
                    <div className="remake-field">
                        <span className="remake-field-label">执行方式</span>
                        <RemakeModeSwitch value={settings.mode} onChange={(mode) => updateSettings({ mode })} />
                    </div>
                </div>
                <RemakeOutputFields settings={settings} onChange={updateSettings} catalog={catalog} catalogError={modelsQuery.isError ? modelsQuery.error.message : undefined} catalogLoading={modelsQuery.isFetching} />
            </RemakeDisclosure>

            {uploadError ? <Callout className="mt-5" tone="error" title={uploadError} onClose={() => setUploadError("")} closeLabel="关闭错误提示" /> : null}

            <div className="remake-create-dock">
                <p className={`remake-dock-status${status.blocked ? " is-blocked" : ""}`} aria-live="polite">
                    {status.text}
                </p>
                <Button type="primary" size="large" loading={createMutation.isPending} disabled={!ready} onClick={() => createMutation.mutate()}>
                    创建并进入工作台
                </Button>
            </div>

            <AssetLibraryPickerModal
                remoteLibrary
                acceptRemoteItems
                open={sourcePickerOpen}
                items={pickerItems.filter((item) => item.mediaKind === "video")}
                categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS, archived: "回收站" }}
                mediaKinds={["video"]}
                remoteKind="video"
                multiple={false}
                title="选择参考视频"
                eyebrow="一键复刻"
                confirmLabel={() => "使用此视频"}
                emptyDescription="素材库中还没有可用的视频。"
                onClose={() => setSourcePickerOpen(false)}
                onConfirm={chooseSourceAsset}
            />
            <AssetLibraryPickerModal
                remoteLibrary
                acceptRemoteItems
                open={targetPickerOpen}
                items={pickerItems.filter((item) => item.mediaKind === "image")}
                categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS, archived: "回收站" }}
                mediaKinds={["image"]}
                remoteKind="image"
                multiple
                title="选择主体参考图"
                eyebrow="一键复刻"
                confirmLabel={(count) => "添加" + (count ? "（" + count + "）" : "")}
                emptyDescription="素材库中还没有可用的图片。"
                onClose={() => setTargetPickerOpen(false)}
                onConfirm={addTargetAssets}
            />
        </WorkspacePage>
    );
}
