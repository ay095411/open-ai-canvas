import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, InputNumber, message } from "antd";
import { CircleCheck, Circle, ImagePlus, Sparkles, Target, Wand2, X } from "lucide-react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { Select } from "@/components/ui/base/select";
import type { RemakeCapability, RemakeModelChoice, RemakeSettings } from "@/services/api/remakes";
import { getRemakeModels } from "@/services/api/remakes";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { buildRemakePickerItems, ensureRemakeResource } from "@/services/remake-assets";
import { useAssetStore } from "@/stores/use-asset-store";

const MAX_TARGET_IMAGES = 4;

const capabilityLabels: Record<RemakeCapability, string> = { text: "视频分析", image: "关键帧图片", video: "镜头视频" };

function modelChoiceValue(choice: RemakeModelChoice) {
    return JSON.stringify(choice);
}

function CheckItem({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return (
        <span className={`rk-check-item${ok ? "" : " text-[var(--rk-warning)]"}`}>
            {ok ? <CircleCheck size={13} className="text-[var(--rk-success)]" aria-hidden /> : <Circle size={13} aria-hidden />}
            {children}
        </span>
    );
}

export type PlanStageProps = {
    settings: RemakeSettings;
    updateSettings: (patch: Partial<RemakeSettings>) => void;
    canLaunch: boolean;
    runPending: boolean;
    onKeyframes: () => void;
    onComplete: () => void;
};

/** 阶段② 复刻方案：主体绑定、输出风格、执行模式与预算、模型设置。 */
export function WorkbenchPlanStage({ settings, updateSettings, canLaunch, runPending, onKeyframes, onComplete }: PlanStageProps) {
    const targetInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const assets = useAssetStore((state) => state.assets);
    const modelsQuery = useQuery({ queryKey: ["remakes", "models"], queryFn: ({ signal }) => getRemakeModels(signal) });

    const pickerItems = buildRemakePickerItems(assets);
    const missingModels = (Object.keys(settings.models) as RemakeCapability[]).filter((key) => !Object.keys(settings.models[key] || {}).length);
    const subjectReady = Boolean(settings.targetDescription.trim()) && settings.targetResourceIds.length > 0;
    const generationReady = subjectReady && missingModels.filter((key) => key !== "text").length === 0;

    const addTargetFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const remaining = MAX_TARGET_IMAGES - settings.targetResourceIds.length;
        if (remaining <= 0) {
            message.warning("一个主体最多选择四张参考图");
            return;
        }
        setUploading(true);
        try {
            const added: string[] = [];
            for (const file of Array.from(files).slice(0, remaining)) {
                if (!file.type.startsWith("image/")) throw new Error("主体参考素材必须是图片");
                added.push((await uploadImage(file)).id);
            }
            updateSettings({ targetResourceIds: [...settings.targetResourceIds, ...added] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "主体参考图上传失败");
        } finally {
            setUploading(false);
        }
    };

    const addTargetAssets = async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
        const remaining = MAX_TARGET_IMAGES - settings.targetResourceIds.length;
        if (ids.length > remaining) throw new Error("还可选择" + remaining + "张主体参考图");
        const pool = new Map([...pickerItems, ...(pickedItems || [])].map((item) => [item.id, item]));
        const selected = ids.map((id) => pool.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (selected.length !== ids.length) throw new Error("部分素材已不可用，请重新选择");
        setUploading(true);
        const added: string[] = [];
        try {
            for (const item of selected) {
                const id = await ensureRemakeResource(item, "image");
                if (!settings.targetResourceIds.includes(id) && !added.includes(id)) added.push(id);
            }
            updateSettings({ targetResourceIds: [...settings.targetResourceIds, ...added] });
            setPickerOpen(false);
        } finally {
            setUploading(false);
        }
    };

    const updateModel = (capability: RemakeCapability, raw: string) => {
        try {
            const choice = JSON.parse(raw) as RemakeModelChoice;
            updateSettings({ models: { ...settings.models, [capability]: choice } });
        } catch {
            message.error("模型选择无效，请重新选择");
        }
    };

    return (
        <div className="rk-stage">
            <div className="rk-stage-scroll mx-auto flex w-full max-w-[880px] flex-col gap-3">
                <section className="rk-panel">
                    <div className="rk-panel-title">
                        <h2 className="rk-panel-heading">
                            <Target size={15} aria-hidden />
                            主体绑定
                        </h2>
                        <span className="text-xs tabular-nums text-[var(--rk-text-muted)]">
                            {settings.targetResourceIds.length}/{MAX_TARGET_IMAGES} 张参考图
                        </span>
                    </div>
                    <p className="rk-panel-hint mt-1">描述要替换进去的人物或产品；参考图是同一主体的多角度素材，分析阶段可先不上传。</p>
                    <label className="mt-3 block text-xs text-[var(--rk-text-muted)]">
                        新主体描述
                        <Input.TextArea
                            className="mt-1"
                            rows={3}
                            maxLength={2000}
                            value={settings.targetDescription}
                            onChange={(event) => updateSettings({ targetDescription: event.target.value })}
                            placeholder="例如：一瓶 500ml 的柑橘气泡水，瓶身带水珠"
                        />
                    </label>
                    <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--rk-text-muted)]">主体参考图</span>
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
                        <div className="flex gap-2">
                            <Button size="small" disabled={uploading || settings.targetResourceIds.length >= MAX_TARGET_IMAGES} onClick={() => setPickerOpen(true)}>
                                素材库
                            </Button>
                            <Button size="small" icon={<ImagePlus size={13} />} disabled={uploading || settings.targetResourceIds.length >= MAX_TARGET_IMAGES} loading={uploading} onClick={() => targetInput.current?.click()}>
                                上传图片
                            </Button>
                        </div>
                    </div>
                    {settings.targetResourceIds.length ? (
                        <div className="mt-2 grid grid-cols-4 gap-2 sm:max-w-[320px]">
                            {settings.targetResourceIds.map((resourceId) => (
                                <div className="rk-ref-slot" key={resourceId}>
                                    <img src={resourceFileUrl(resourceId)} alt="主体参考图" crossOrigin="use-credentials" />
                                    <button type="button" className="rk-ref-remove" aria-label="移除主体参考图" onClick={() => updateSettings({ targetResourceIds: settings.targetResourceIds.filter((id) => id !== resourceId) })}>
                                        <X size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-2 text-xs text-[var(--rk-warning)]">生成关键帧或一键复刻前，需要至少一张新主体图片。</p>
                    )}
                </section>

                <section className="rk-panel">
                    <h2 className="rk-panel-heading">输出与风格</h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                            画幅
                            <Select
                                className="mt-1 w-full"
                                value={settings.aspectRatio}
                                ariaLabel="成片画幅"
                                options={[
                                    { value: "9:16", label: "9:16 竖屏" },
                                    { value: "16:9", label: "16:9 横屏" },
                                    { value: "1:1", label: "1:1 方形" },
                                ]}
                                onChange={(value) => updateSettings({ aspectRatio: value as RemakeSettings["aspectRatio"] })}
                            />
                        </label>
                        <label className="min-w-0 text-xs text-[var(--rk-text-muted)]">
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
                                onChange={(value) => updateSettings({ audioMode: value as RemakeSettings["audioMode"] })}
                            />
                        </label>
                    </div>
                    <label className="mt-3 block text-xs text-[var(--rk-text-muted)]">
                        整体风格
                        <Input.TextArea className="mt-1" rows={2} maxLength={2000} value={settings.style} onChange={(event) => updateSettings({ style: event.target.value })} placeholder="可选，例如自然光、胶片质感" />
                    </label>
                </section>

                <section className="rk-panel">
                    <h2 className="rk-panel-heading">执行方式</h2>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <button type="button" className={`rk-mode-card${settings.mode === "review" ? " is-active" : ""}`} aria-pressed={settings.mode === "review"} onClick={() => updateSettings({ mode: "review" })}>
                            <span className="rk-mode-radio" aria-hidden />
                            <span className="min-w-0">
                                <span className="flex items-center gap-2 text-sm font-medium">
                                    精修复刻
                                    <span className="rounded-full bg-[var(--rk-accent-soft)] px-1.5 py-px text-[var(--fs-micro,10px)] font-semibold text-[var(--rk-accent)]">推荐</span>
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-[var(--rk-text-muted)]">先拆镜并生成关键帧，你确认主体替换效果后再批量生成视频，避免错误扩散到整片。</span>
                            </span>
                        </button>
                        <button type="button" className={`rk-mode-card${settings.mode === "quick" ? " is-active" : ""}`} aria-pressed={settings.mode === "quick"} onClick={() => updateSettings({ mode: "quick" })}>
                            <span className="rk-mode-radio" aria-hidden />
                            <span className="min-w-0">
                                <span className="text-sm font-medium">快速复刻</span>
                                <span className="mt-1 block text-xs leading-5 text-[var(--rk-text-muted)]">一次执行到成片，合格关键帧自动选用；适合熟悉效果后的批量制作。</span>
                            </span>
                        </button>
                    </div>
                    <label className="mt-3 block max-w-[280px] text-xs text-[var(--rk-text-muted)]">
                        累计预算上限（积分）
                        <InputNumber className="mt-1 w-full" min={0} max={1_000_000} step={10} value={settings.budgetMicrocredits / 1_000_000} onChange={(value) => updateSettings({ budgetMicrocredits: Math.round((value || 0) * 1_000_000) })} />
                    </label>
                    <p className="mt-1 rk-panel-hint">0 表示不设上限。单项任务完成结算后才累计费用；若该笔超过剩余额度，费用仍会计入，之后停止派发。</p>
                </section>

                <section className="rk-panel">
                    <div className="rk-panel-title">
                        <h2 className="rk-panel-heading">
                            <Wand2 size={15} aria-hidden />
                            模型设置
                        </h2>
                        {modelsQuery.isFetching ? <span className="text-xs text-[var(--rk-text-muted)]">读取模型</span> : null}
                    </div>
                    {modelsQuery.isError ? <Alert className="mt-2" type="error" showIcon message="模型目录加载失败" description={modelsQuery.error.message} /> : null}
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {(["text", "image", "video"] as RemakeCapability[]).map((capability) => {
                            const options = modelsQuery.data?.options[capability] || [];
                            return (
                                <label key={capability} className="min-w-0 text-xs text-[var(--rk-text-muted)]">
                                    {capabilityLabels[capability]}模型
                                    <Select
                                        className={`mt-1 w-full${missingModels.includes(capability) ? " ant-select-status-warning" : ""}`}
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
                    {missingModels.length ? <p className="mt-2 text-xs text-[var(--rk-warning)]">还有 {missingModels.length} 个阶段未选择模型，生成前需补齐。</p> : null}
                </section>

                <section className="rk-panel flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <CheckItem ok={Boolean(settings.targetDescription.trim())}>主体描述</CheckItem>
                        <CheckItem ok={settings.targetResourceIds.length > 0}>
                            参考图 {settings.targetResourceIds.length}/{MAX_TARGET_IMAGES}
                        </CheckItem>
                        <CheckItem ok={missingModels.filter((key) => key !== "text").length === 0}>图片/视频模型</CheckItem>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<Sparkles size={14} />} disabled={!canLaunch || !generationReady} loading={runPending} onClick={onKeyframes}>
                            生成关键帧
                        </Button>
                        <Button type="primary" icon={<Sparkles size={14} />} disabled={!canLaunch || !generationReady} loading={runPending} onClick={onComplete}>
                            一键复刻
                        </Button>
                    </div>
                </section>
            </div>
            <AssetLibraryPickerModal
                remoteLibrary
                acceptRemoteItems
                open={pickerOpen}
                items={pickerItems.filter((item) => item.mediaKind === "image")}
                categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS, archived: "回收站" }}
                mediaKinds={["image"]}
                remoteKind="image"
                multiple
                title="选择主体参考图"
                eyebrow="一键复刻"
                confirmLabel={(count) => "添加" + (count ? "（" + count + "）" : "")}
                emptyDescription="素材库中还没有可用的图片。"
                onClose={() => setPickerOpen(false)}
                onConfirm={(ids, pickedItems) => addTargetAssets(ids, pickedItems)}
            />
        </div>
    );
}

async function uploadImage(file: File) {
    return uploadResourceFile(file, "image", { fileName: file.name });
}
