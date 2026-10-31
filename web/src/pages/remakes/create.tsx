import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Progress, Segmented, Select, message } from "antd";
import { ArrowLeft, FolderOpen, ImagePlus, Upload, Video, X } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { initialRemakeSettings } from "@/lib/remake/presentation";
import { createRemake, getRemakeModels, type RemakeCapability, type RemakeModelChoice, type RemakeSettings } from "@/services/api/remakes";
import { resourceFileUrl, resourceIdFromStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const assetCategoryLabels: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS, archived: "回收站" };

type RemakePickerAsset = Extract<Asset, { kind: "image" | "video" }>;

function isRemakePickerAsset(asset: Asset): asset is RemakePickerAsset {
    return asset.kind === "image" || asset.kind === "video";
}

async function ensureRemakeResource(item: AssetLibraryPickerItem, kind: "image" | "video") {
    const candidate = item.asset;
    if (!candidate || !isRemakePickerAsset(candidate)) throw new Error("“" + item.title + "”不是可用素材");
    const asset = candidate;
    const storageKey = asset.data.storageKey;
    const existingId = resourceIdFromStorageKey(storageKey);
    if (existingId) return existingId;

    let blob: Blob | null = null;
    let durationMs: number | undefined;
    if (kind === "image") {
        if (asset.kind !== "image") throw new Error("“" + item.title + "”不是图片");
        blob = storageKey ? await getImageBlob(storageKey) : null;
        if (!blob && asset.data.dataUrl) {
            const response = await fetch(asset.data.dataUrl);
            if (!response.ok) throw new Error("无法读取“" + item.title + "”");
            blob = await response.blob();
        }
    } else {
        if (asset.kind !== "video") throw new Error("“" + item.title + "”不是视频");
        blob = storageKey ? await getMediaBlob(storageKey) : null;
        durationMs = asset.data.durationMs;
        if (!blob && (asset.data.url.startsWith("blob:") || asset.data.url.startsWith("data:"))) {
            const response = await fetch(asset.data.url);
            if (!response.ok) throw new Error("无法读取“" + item.title + "”");
            blob = await response.blob();
        }
    }
    if (!blob) throw new Error("“" + item.title + "”的本地文件已不存在，请重新上传");

    const resource = await uploadResourceFile(blob, kind, {
        fileName: item.title,
        width: asset.data.width,
        height: asset.data.height,
        durationMs,
    });
    if (!resource.id) throw new Error("“" + item.title + "”没有成功保存到服务端");
    return resource.id;
}

async function readVideoDuration(file: File) {
    return new Promise<number>((resolve, reject) => {
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

function modelChoiceValue(choice: RemakeModelChoice) {
    return JSON.stringify(choice);
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
    const pickerItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            assets.filter(isRemakePickerAsset).map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: normalizeAssetCategory(asset.category),
                archived: asset.status === "archived",
                kindLabel: asset.kind === "video" ? "视频" : "图片",
                mediaKind: asset.kind,
                asset,
                searchText: (asset.tags || []).join(" "),
            })),
        [assets],
    );

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

    const videoOption = useMemo(() => (modelsQuery.data?.options.video || []).find((item) => modelChoiceValue(item.choice) === modelChoiceValue(settings.models.video)), [modelsQuery.data, settings.models.video]);
    const ratioOptions = (videoOption?.videoRatios?.length ? videoOption.videoRatios : ["9:16", "16:9", "1:1"]).map((value) => ({ value, label: value }));

    const onChooseSource = async (file?: File) => {
        if (!file) return;
        if (file.size > 1 << 30) {
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

    const onChooseTargets = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploadError("");
        const remaining = 4 - targetResources.length;
        if (remaining <= 0) {
            setUploadError("一个主体最多选择四张参考图");
            return;
        }
        setUploading(true);
        setUploadProgress(0);
        try {
            const picked = Array.from(files).slice(0, remaining);
            const uploaded = [] as Array<{ id: string; name: string }>;
            for (const [index, file] of picked.entries()) {
                if (!file.type.startsWith("image/")) throw new Error("主体参考素材必须是图片");
                const resource = await uploadResourceFile(file, "image", { fileName: file.name }, (loaded, total) => {
                    const current = total > 0 ? loaded / total : 0;
                    setUploadProgress(Math.round(((index + current) / picked.length) * 100));
                });
                uploaded.push({ id: resource.id, name: file.name });
            }
            setTargetResources((current) => [...current, ...uploaded].slice(0, 4));
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "主体参考图上传失败");
        } finally {
            setUploading(false);
            setUploadProgress(0);
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

    const chooseTargetAssets = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const remaining = 4 - targetResources.length;
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
            setTargetResources((current) => [...current, ...added].slice(0, 4));
            setTargetPickerOpen(false);
        } catch (error) {
            if (added.length) setTargetResources((current) => [...current, ...added].slice(0, 4));
            const detail = error instanceof Error ? error.message : "读取主体参考图失败";
            setUploadError(detail);
            throw error;
        } finally {
            setUploading(false);
        }
    };

    const updateModel = (capability: RemakeCapability, raw: string) => {
        try {
            const choice = JSON.parse(raw) as RemakeModelChoice;
            setSettings((current) => ({ ...current, models: { ...current.models, [capability]: choice } }));
        } catch {
            setUploadError("模型选择无效，请重新选择");
        }
    };

    const setRange = (key: "sourceInMs" | "sourceOutMs", seconds: number | null) => {
        const value = Math.max(0, Math.round((seconds || 0) * 1000));
        setSettings((current) => ({ ...current, [key]: value }));
    };

    const missingModels = (Object.keys(settings.models) as RemakeCapability[]).filter((key) => !Object.keys(settings.models[key] || {}).length);
    const overLimit = settings.sourceOutMs > settings.sourceInMs && settings.sourceOutMs - settings.sourceInMs > 60_000;
    const ready = Boolean(sourceResourceId) && !uploading && !overLimit && missingModels.length === 0;

    return (
        <WorkspacePage>
            <PageHeader
                title="新建复刻"
                actions={
                    <Button icon={<ArrowLeft size={15} />} onClick={() => navigate("/remakes")}>
                        返回项目库
                    </Button>
                }
            />
            <div className="mt-4 grid max-w-6xl grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
                <section className="min-w-0 border-b border-border/70 pb-6 xl:border-b-0 xl:border-r xl:pr-6">
                    <h2 className="text-sm font-semibold">参考视频</h2>
                    <p className="mt-1 text-xs text-foreground/55">首版支持 60 秒以内、最多 20 个镜头的片段。</p>
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
                    <button
                        type="button"
                        className="mt-4 flex min-h-44 w-full flex-col items-center justify-center gap-2 border border-dashed border-border/80 bg-surface/50 px-4 text-center transition-colors hover:border-primary/60"
                        onClick={() => sourceInput.current?.click()}
                        disabled={uploading}
                    >
                        <Video className="size-7 text-foreground/45" />
                        <span className="text-sm font-medium">{sourceName || "上传参考视频"}</span>
                        <span className="text-xs text-foreground/50">MP4、MOV 或 WebM，最大 1 GiB</span>
                    </button>
                    <Button className="mt-2" icon={<FolderOpen size={14} />} disabled={uploading} onClick={() => setSourcePickerOpen(true)}>
                        从素材库选择视频
                    </Button>
                    {uploading && sourceName ? <Progress className="mt-2" percent={uploadProgress} size="small" /> : null}
                    {sourceResourceId ? <video className="mt-4 aspect-video w-full bg-black object-contain" src={resourceFileUrl(sourceResourceId)} controls preload="metadata" crossOrigin="use-credentials" /> : null}
                    {sourceDurationMs > 0 ? (
                        <p className="mt-2 text-xs text-foreground/55">
                            检测到时长 {Math.floor(sourceDurationMs / 60000)}:{String(Math.floor(sourceDurationMs / 1000) % 60).padStart(2, "0")}
                        </p>
                    ) : null}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <label className="min-w-0 text-xs text-foreground/65">
                            片段开始（秒）
                            <InputNumber className="mt-1 w-full" min={0} max={sourceDurationMs ? sourceDurationMs / 1000 : undefined} step={0.1} value={settings.sourceInMs / 1000} onChange={(value) => setRange("sourceInMs", value)} />
                        </label>
                        <label className="min-w-0 text-xs text-foreground/65">
                            片段结束（秒）
                            <InputNumber
                                className="mt-1 w-full"
                                min={0}
                                max={sourceDurationMs ? sourceDurationMs / 1000 : undefined}
                                step={0.1}
                                value={settings.sourceOutMs ? settings.sourceOutMs / 1000 : null}
                                placeholder="完整视频"
                                onChange={(value) => setRange("sourceOutMs", value)}
                            />
                        </label>
                    </div>
                    {overLimit ? <p className="mt-2 text-xs text-red-500">复刻区间不能超过 60 秒，请先缩短片段。</p> : null}
                </section>

                <section className="min-w-0 space-y-5">
                    <div>
                        <h2 className="text-sm font-semibold">复刻目标</h2>
                        <label className="mt-3 block text-xs text-foreground/65">
                            项目名称
                            <Input className="mt-1" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="为这次复刻命名" />
                        </label>
                        <label className="mt-3 block text-xs text-foreground/65">
                            新主体描述
                            <Input.TextArea
                                className="mt-1"
                                maxLength={2000}
                                rows={3}
                                value={settings.targetDescription}
                                onChange={(event) => setSettings((current) => ({ ...current, targetDescription: event.target.value }))}
                                placeholder="描述要替换进去的人物或产品"
                            />
                        </label>
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-foreground/65">新主体参考图</span>
                            <input
                                ref={targetInput}
                                type="file"
                                accept="image/*"
                                multiple
                                className="sr-only"
                                onChange={(event) => {
                                    void onChooseTargets(event.target.files);
                                    event.currentTarget.value = "";
                                }}
                            />
                            <div className="flex gap-2">
                                <Button size="small" icon={<FolderOpen size={14} />} disabled={uploading || targetResources.length >= 4} onClick={() => setTargetPickerOpen(true)}>
                                    素材库
                                </Button>
                                <Button size="small" icon={<ImagePlus size={14} />} disabled={uploading || targetResources.length >= 4} onClick={() => targetInput.current?.click()}>
                                    上传图片
                                </Button>
                            </div>
                        </div>
                        {targetResources.length ? (
                            <div className="mt-2 grid grid-cols-4 gap-2">
                                {targetResources.map((item) => (
                                    <div key={item.id} className="group relative min-w-0">
                                        <img className="aspect-square w-full bg-surface object-cover" src={resourceFileUrl(item.id)} alt={item.name} crossOrigin="use-credentials" />
                                        <button
                                            type="button"
                                            className="absolute right-1 top-1 grid size-6 place-items-center bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                                            aria-label={`移除${item.name}`}
                                            onClick={() => setTargetResources((current) => current.filter((resource) => resource.id !== item.id))}
                                        >
                                            <X size={14} />
                                        </button>
                                        <span className="mt-1 block truncate text-[11px] text-foreground/55">{item.name}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-2 text-xs text-foreground/45">最多四张同一主体的参考图。分析阶段可先不上传。</p>
                        )}
                    </div>

                    {modelsQuery.isError ? <Alert type="error" showIcon message="模型目录加载失败" description={modelsQuery.error.message} /> : null}
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold">模型与输出</h2>
                            {modelsQuery.isFetching ? <span className="text-xs text-foreground/45">读取模型</span> : null}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {(["text", "image", "video"] as RemakeCapability[]).map((capability) => {
                                const labels: Record<RemakeCapability, string> = { text: "视频分析", image: "关键帧图片", video: "镜头视频" };
                                const options = modelsQuery.data?.options[capability] || [];
                                return (
                                    <label key={capability} className="min-w-0 text-xs text-foreground/65">
                                        {labels[capability]}模型
                                        <Select
                                            className="mt-1 w-full"
                                            value={Object.keys(settings.models[capability] || {}).length ? modelChoiceValue(settings.models[capability]) : undefined}
                                            placeholder="选择模型"
                                            options={options.map((option) => ({ value: modelChoiceValue(option.choice), label: option.priceLabel ? `${option.label} · ${option.priceLabel}` : option.label }))}
                                            onChange={(value) => updateModel(capability, value)}
                                        />
                                    </label>
                                );
                            })}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="min-w-0 text-xs text-foreground/65">
                                成片画幅
                                <Select className="mt-1 w-full" value={settings.aspectRatio} options={ratioOptions} onChange={(value) => setSettings((current) => ({ ...current, aspectRatio: value as RemakeSettings["aspectRatio"] }))} />
                            </label>
                            <label className="min-w-0 text-xs text-foreground/65">
                                音轨
                                <Select
                                    className="mt-1 w-full"
                                    value={settings.audioMode}
                                    options={[
                                        { value: "original", label: "沿用原片" },
                                        { value: "generated", label: "生成音轨" },
                                        { value: "mute", label: "静音" },
                                    ]}
                                    onChange={(value) => setSettings((current) => ({ ...current, audioMode: value as RemakeSettings["audioMode"] }))}
                                />
                            </label>
                        </div>
                        <label className="mt-3 block text-xs text-foreground/65">
                            整体风格
                            <Input.TextArea className="mt-1" maxLength={2000} rows={2} value={settings.style} onChange={(event) => setSettings((current) => ({ ...current, style: event.target.value }))} placeholder="可选，例如自然光、胶片质感" />
                        </label>
                    </div>

                    <div>
                        <h2 className="text-sm font-semibold">执行方式与预算</h2>
                        <Segmented
                            className="mt-3"
                            block
                            value={settings.mode}
                            options={[
                                { label: "精修复刻", value: "review" },
                                { label: "快速复刻", value: "quick" },
                            ]}
                            onChange={(value) => setSettings((current) => ({ ...current, mode: value as RemakeSettings["mode"] }))}
                        />
                        <label className="mt-3 block text-xs text-foreground/65">
                            累计预算上限（积分）
                            <InputNumber
                                className="mt-1 w-full"
                                min={0}
                                max={1_000_000}
                                step={10}
                                value={settings.budgetMicrocredits / 1_000_000}
                                onChange={(value) => setSettings((current) => ({ ...current, budgetMicrocredits: Math.round((value || 0) * 1_000_000) }))}
                            />
                        </label>
                        <p className="mt-1 text-xs leading-5 text-foreground/50">0 表示不设上限。单项任务完成结算后才累计费用；若该笔超过剩余额度，费用仍会计入，之后停止派发。已提交任务可能继续完成。</p>
                    </div>

                    {uploadError ? <Alert type="error" showIcon message={uploadError} /> : null}
                    {missingModels.length > 0 && modelsQuery.data ? <Alert type="warning" showIcon message="先为三个处理阶段选择可用模型" /> : null}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
                        <Button type="primary" icon={<Upload size={15} />} loading={createMutation.isPending || uploading} disabled={!ready} onClick={() => createMutation.mutate()}>
                            创建复刻项目
                        </Button>
                    </div>
                    <p className="text-xs leading-5 text-foreground/45">确认创建后，项目草稿会保存并进入复刻工作台。</p>
                </section>
            </div>
            <AssetLibraryPickerModal
                remoteLibrary
                acceptRemoteItems
                open={sourcePickerOpen}
                items={pickerItems.filter((item) => item.mediaKind === "video")}
                categoryLabels={assetCategoryLabels}
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
                categoryLabels={assetCategoryLabels}
                mediaKinds={["image"]}
                remoteKind="image"
                multiple
                title="选择主体参考图"
                eyebrow="一键复刻"
                confirmLabel={(count) => "添加" + (count ? "（" + count + "）" : "")}
                emptyDescription="素材库中还没有可用的图片。"
                onClose={() => setTargetPickerOpen(false)}
                onConfirm={chooseTargetAssets}
            />
        </WorkspacePage>
    );
}
