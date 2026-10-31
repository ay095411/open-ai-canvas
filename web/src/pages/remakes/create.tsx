import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, Progress, message } from "antd";
import { ArrowLeft, Check, Circle, CircleCheck, FolderOpen, Plus, Upload, Video, X } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { Select } from "@/components/ui/base/select";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { initialRemakeSettings, remakeDuration } from "@/lib/remake/presentation";
import { createRemake, getRemakeModels, type RemakeCapability, type RemakeModelChoice, type RemakeSettings } from "@/services/api/remakes";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { buildRemakePickerItems, ensureRemakeResource } from "@/services/remake-assets";
import { useAssetStore } from "@/stores/use-asset-store";

const MAX_SOURCE_BYTES = 1 << 30;
const MAX_RANGE_MS = 60_000;
const MAX_TARGET_IMAGES = 4;

const capabilityLabels: Record<RemakeCapability, string> = { text: "视频分析", image: "关键帧图片", video: "镜头视频" };

function modelChoiceValue(choice: RemakeModelChoice) {
    return JSON.stringify(choice);
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

/** 分节标题：编号圆标在完成时变为绿色对勾，表达创建流程的推进感。 */
function SectionHeader({ step, done, title, hint, extra }: { step: number; done?: boolean; title: string; hint?: string; extra?: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-emerald-600 text-white" : "bg-foreground/6 text-foreground/70"}`} aria-hidden>
                    {done ? <Check size={13} /> : step}
                </span>
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                    {hint ? <p className="mt-0.5 text-xs leading-5 text-foreground/50">{hint}</p> : null}
                </div>
            </div>
            {extra ? <div className="flex shrink-0 flex-wrap items-center gap-2">{extra}</div> : null}
        </div>
    );
}

function ModeCard({ active, title, badge, description, onClick }: { active: boolean; title: string; badge?: string; description: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/45"}`}
        >
            <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${active ? "border-primary" : "border-border"}`} aria-hidden>
                {active ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {title}
                    {badge ? <span className="rounded-full bg-primary/10 px-1.5 py-px text-[var(--fs-micro,10px)] font-semibold text-primary">{badge}</span> : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-foreground/55">{description}</span>
            </span>
        </button>
    );
}

function CheckItem({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-foreground/65" : "text-amber-600"}`}>
            {ok ? <CircleCheck size={13} className="text-emerald-600" aria-hidden /> : <Circle size={13} aria-hidden />}
            {children}
        </span>
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
        const remaining = MAX_TARGET_IMAGES - targetResources.length;
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
            setTargetResources((current) => [...current, ...uploaded].slice(0, MAX_TARGET_IMAGES));
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : "主体参考图上传失败");
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const addTargetAssets = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const remaining = MAX_TARGET_IMAGES - targetResources.length;
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
            setTargetResources((current) => [...current, ...added].slice(0, MAX_TARGET_IMAGES));
            setTargetPickerOpen(false);
        } catch (error) {
            if (added.length) setTargetResources((current) => [...current, ...added].slice(0, MAX_TARGET_IMAGES));
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
    const overLimit = settings.sourceOutMs > settings.sourceInMs && settings.sourceOutMs - settings.sourceInMs > MAX_RANGE_MS;
    const rangeMs = Math.max(0, settings.sourceOutMs - settings.sourceInMs);
    const modelsReady = missingModels.length === 0 && Boolean(modelsQuery.data);
    const ready = Boolean(sourceResourceId) && !uploading && !overLimit && modelsReady;

    return (
        <WorkspacePage>
            <PageHeader
                title="新建复刻"
                description="选择参考视频、绑定新主体、确认输出与执行，创建后进入复刻工作台完成分析与分镜。"
                actions={
                    <Button icon={<ArrowLeft size={15} />} onClick={() => navigate("/remakes")}>
                        返回项目库
                    </Button>
                }
            />
            <div className="mx-auto mt-4 w-full max-w-[960px]">
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface">
                    <section className="border-b border-border/60 p-4 sm:p-5">
                        <SectionHeader
                            step={1}
                            done={Boolean(sourceResourceId) && !overLimit}
                            title="参考视频"
                            hint="复刻会保留参考片的镜头顺序与节奏；首版支持 60 秒以内、最多 20 个镜头的片段。"
                            extra={
                                <>
                                    <Button size="small" icon={<FolderOpen size={13} />} disabled={uploading} onClick={() => setSourcePickerOpen(true)}>
                                        素材库
                                    </Button>
                                    <Button size="small" icon={<Upload size={13} />} disabled={uploading} loading={uploading && !sourceResourceId} onClick={() => sourceInput.current?.click()}>
                                        {sourceResourceId ? "重新上传" : "上传视频"}
                                    </Button>
                                </>
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
                        {uploading && sourceName ? <Progress className="mt-3" percent={uploadProgress} size="small" aria-label="参考视频上传进度" /> : null}
                        {!sourceResourceId ? (
                            <button
                                type="button"
                                className={`mt-3 flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${dragOver ? "border-primary bg-primary/5" : "border-border/80 bg-surface-secondary hover:border-primary/60"}`}
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
                                <Video className="size-7 text-foreground/45" aria-hidden />
                                <span className="text-sm font-medium text-foreground">{sourceName || "拖入视频文件，或点击选择"}</span>
                                <span className="text-xs text-foreground/50">MP4、MOV、WebM · 最大 1 GiB · 也可以从右上角「素材库」选择</span>
                            </button>
                        ) : (
                            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(250px,0.9fr)]">
                                <div className="min-w-0">
                                    <video className="aspect-video w-full rounded-lg bg-black object-contain" src={resourceFileUrl(sourceResourceId)} controls preload="metadata" crossOrigin="use-credentials" />
                                    <p className="mt-2 truncate text-xs tabular-nums text-foreground/55">
                                        {sourceName}
                                        {sourceDurationMs > 0 ? ` · 检测到时长 ${remakeDuration(sourceDurationMs)}` : ""}
                                    </p>
                                </div>
                                <div className="min-w-0 space-y-2">
                                    <div className="grid grid-cols-2 gap-3">
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
                                    <p className="text-xs tabular-nums text-foreground/55">复刻区间 {remakeDuration(rangeMs)}</p>
                                    {overLimit ? <p className="text-xs text-red-500">复刻区间不能超过 60 秒，请先缩短片段。</p> : <p className="text-xs text-foreground/45">只截取要复刻的片段，可减少分析等待与生成费用。</p>}
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="border-b border-border/60 p-4 sm:p-5">
                        <SectionHeader
                            step={2}
                            done={Boolean(settings.targetDescription.trim() && targetResources.length)}
                            title="主体绑定"
                            hint="描述要替换进去的人物或产品，并附 1–4 张同一主体的参考图；这一步也可以创建后在工作台补充。"
                            extra={
                                <Button size="small" icon={<FolderOpen size={13} />} disabled={uploading || targetResources.length >= MAX_TARGET_IMAGES} onClick={() => setTargetPickerOpen(true)}>
                                    素材库添加
                                </Button>
                            }
                        />
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
                        <label className="mt-4 block text-xs text-foreground/65">
                            项目名称
                            <Input className="mt-1" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="为这次复刻命名，默认取视频文件名" />
                        </label>
                        <label className="mt-3 block text-xs text-foreground/65">
                            新主体描述
                            <Input.TextArea
                                className="mt-1"
                                maxLength={2000}
                                rows={3}
                                value={settings.targetDescription}
                                onChange={(event) => setSettings((current) => ({ ...current, targetDescription: event.target.value }))}
                                placeholder="例如：一位穿米色风衣的短发女性 / 一瓶 500ml 的柑橘气泡水，瓶身带水珠"
                            />
                        </label>
                        <div className="mt-3 grid w-full max-w-[320px] grid-cols-4 gap-2">
                            {targetResources.map((item) => (
                                <div key={item.id} className="group relative min-w-0 overflow-hidden rounded-lg bg-surface-secondary">
                                    <img className="aspect-square w-full object-cover" src={resourceFileUrl(item.id)} alt={item.name} crossOrigin="use-credentials" />
                                    <button
                                        type="button"
                                        className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                                        aria-label={`移除${item.name}`}
                                        onClick={() => setTargetResources((current) => current.filter((resource) => resource.id !== item.id))}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                            {targetResources.length < MAX_TARGET_IMAGES ? (
                                <button
                                    type="button"
                                    className="grid aspect-square w-full place-items-center rounded-lg border border-dashed border-border/80 bg-surface-secondary text-foreground/40 transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                    aria-label="上传主体参考图"
                                    disabled={uploading}
                                    onClick={() => targetInput.current?.click()}
                                >
                                    <Plus size={16} />
                                </button>
                            ) : null}
                        </div>
                        {!targetResources.length ? <p className="mt-2 text-xs text-foreground/45">生成关键帧或一键复刻前需要至少一张参考图；点击上方「素材库添加」或虚线格上传。</p> : null}
                    </section>

                    <section className="border-b border-border/60 p-4 sm:p-5">
                        <SectionHeader step={3} title="输出与执行" hint="画幅、音轨与风格决定成片形态；精修模式会先停下来让你确认关键帧效果。" />
                        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
                            <div className="min-w-0 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="min-w-0 text-xs text-foreground/65">
                                        成片画幅
                                        <Select
                                            className="mt-1 w-full"
                                            value={settings.aspectRatio}
                                            ariaLabel="成片画幅"
                                            options={[
                                                { value: "9:16", label: "9:16 竖屏" },
                                                { value: "16:9", label: "16:9 横屏" },
                                                { value: "1:1", label: "1:1 方形" },
                                            ]}
                                            onChange={(value) => setSettings((current) => ({ ...current, aspectRatio: value as RemakeSettings["aspectRatio"] }))}
                                        />
                                    </label>
                                    <label className="min-w-0 text-xs text-foreground/65">
                                        音轨
                                        <Select
                                            className="mt-1 w-full"
                                            value={settings.audioMode}
                                            ariaLabel="音轨模式"
                                            options={[
                                                { value: "original", label: "沿用原片" },
                                                { value: "generated", label: "生成音轨" },
                                                { value: "mute", label: "静音" },
                                            ]}
                                            onChange={(value) => setSettings((current) => ({ ...current, audioMode: value as RemakeSettings["audioMode"] }))}
                                        />
                                    </label>
                                </div>
                                <label className="block text-xs text-foreground/65">
                                    整体风格
                                    <Input.TextArea className="mt-1" maxLength={2000} rows={2} value={settings.style} onChange={(event) => setSettings((current) => ({ ...current, style: event.target.value }))} placeholder="可选，例如自然光、胶片质感" />
                                </label>
                            </div>
                            <div className="min-w-0 space-y-3">
                                <div className="flex flex-col gap-2">
                                    <ModeCard
                                        active={settings.mode === "review"}
                                        title="精修复刻"
                                        badge="推荐"
                                        description="先拆镜并生成关键帧，确认主体替换效果后再批量生成视频，避免错误扩散到整片。"
                                        onClick={() => setSettings((current) => ({ ...current, mode: "review" }))}
                                    />
                                    <ModeCard active={settings.mode === "quick"} title="快速复刻" description="一次执行到成片，合格关键帧自动选用；适合熟悉效果后的批量制作。" onClick={() => setSettings((current) => ({ ...current, mode: "quick" }))} />
                                </div>
                                <label className="block max-w-[280px] text-xs text-foreground/65">
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
                                <p className="text-xs leading-5 text-foreground/50">0 表示不设上限。单项任务完成结算后才累计费用；若该笔超过剩余额度，费用仍会计入，之后停止派发。</p>
                            </div>
                        </div>
                    </section>

                    <section className="p-4 sm:p-5">
                        <SectionHeader
                            step={4}
                            done={modelsReady}
                            title="模型"
                            hint="分析、关键帧与镜头视频各用一个模型；已按目录预选默认项，通常无需修改。"
                            extra={modelsQuery.isFetching ? <span className="text-xs text-foreground/45">读取模型</span> : null}
                        />
                        {modelsQuery.isError ? <Alert className="mt-3" type="error" showIcon message="模型目录加载失败" description={modelsQuery.error.message} /> : null}
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {(["text", "image", "video"] as RemakeCapability[]).map((capability) => {
                                const options = modelsQuery.data?.options[capability] || [];
                                return (
                                    <label key={capability} className="min-w-0 text-xs text-foreground/65">
                                        {capabilityLabels[capability]}模型
                                        <Select
                                            className="mt-1 w-full"
                                            value={Object.keys(settings.models[capability] || {}).length ? modelChoiceValue(settings.models[capability]) : undefined}
                                            placeholder="选择模型"
                                            ariaLabel={capabilityLabels[capability] + "模型"}
                                            options={options.map((option) => ({ value: modelChoiceValue(option.choice), label: option.priceLabel ? `${option.label} · ${option.priceLabel}` : option.label }))}
                                            onChange={(value) => updateModel(capability, value)}
                                        />
                                    </label>
                                );
                            })}
                        </div>
                        {missingModels.length > 0 && modelsQuery.data ? <p className="mt-2 text-xs text-amber-600">先为三个处理阶段选择可用模型。</p> : null}
                    </section>
                </div>

                {uploadError ? <Alert className="mt-4" type="error" showIcon message={uploadError} closable onClose={() => setUploadError("")} /> : null}

                <div className="sticky bottom-3 z-10 mt-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-surface/95 px-4 py-3 backdrop-blur" style={{ boxShadow: "var(--elevation-card)" }}>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                            <CheckItem ok={Boolean(sourceResourceId)}>参考视频</CheckItem>
                            <CheckItem ok={modelsReady}>模型</CheckItem>
                            <CheckItem ok={!overLimit}>区间 ≤ 60 秒</CheckItem>
                            <span className="hidden text-xs text-foreground/45 sm:inline">主体绑定可创建后在工台补充</span>
                        </div>
                        <Button type="primary" loading={createMutation.isPending || uploading} disabled={!ready} onClick={() => createMutation.mutate()}>
                            创建复刻项目
                        </Button>
                    </div>
                </div>
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
