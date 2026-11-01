import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, message } from "antd";
import { Sparkles, Target } from "lucide-react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import type { RemakeSettings } from "@/services/api/remakes";
import { getRemakeModels } from "@/services/api/remakes";
import { uploadResourceFile } from "@/services/api/resources";
import { buildRemakePickerItems, ensureRemakeResource } from "@/services/remake-assets";
import { useAssetStore } from "@/stores/use-asset-store";

import { missingRemakeModels, REMAKE_MAX_TARGET_IMAGES, RemakeDisclosure, RemakeModeSwitch, RemakeOutputFields, remakeSettingsSummary, RemakeTargetImages } from "./remake-settings-fields";

export type PlanStageProps = {
    settings: RemakeSettings;
    updateSettings: (patch: Partial<RemakeSettings>) => void;
    canLaunch: boolean;
    runPending: boolean;
    onKeyframes: () => void;
    onComplete: () => void;
};

/** 阶段② 设定新主体：主体描述与参考图在前，输出与模型折叠，底部是执行方式与启动。 */
export function WorkbenchPlanStage({ settings, updateSettings, canLaunch, runPending, onKeyframes, onComplete }: PlanStageProps) {
    const targetInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    // 图片/视频模型缺失时直接展开，否则保持收起。
    const [outputOpen, setOutputOpen] = useState(() => missingRemakeModels(settings, ["image", "video"]).length > 0);
    const assets = useAssetStore((state) => state.assets);
    const modelsQuery = useQuery({ queryKey: ["remakes", "models"], queryFn: ({ signal }) => getRemakeModels(signal) });

    const pickerItems = buildRemakePickerItems(assets);
    const missingModels = missingRemakeModels(settings);
    const generationModelsMissing = missingRemakeModels(settings, ["image", "video"]).length > 0;
    const subjectReady = Boolean(settings.targetDescription.trim()) && settings.targetResourceIds.length > 0;
    const generationReady = subjectReady && !generationModelsMissing;
    const missingItems = [!settings.targetDescription.trim() ? "主体描述" : "", !settings.targetResourceIds.length ? "参考图" : "", generationModelsMissing ? "图片/视频模型" : ""].filter(Boolean);
    const outputAttention = modelsQuery.isError || missingModels.length > 0;

    const addTargetFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const remaining = REMAKE_MAX_TARGET_IMAGES - settings.targetResourceIds.length;
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
        const remaining = REMAKE_MAX_TARGET_IMAGES - settings.targetResourceIds.length;
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

    return (
        <div className="rk-stage">
            <div className="rk-stage-scroll">
                <div className="rk-plan">
                    <section className="rk-panel">
                        <div className="rk-panel-title">
                            <h2 className="rk-panel-heading">
                                <Target size={16} aria-hidden />
                                新主体
                            </h2>
                            <span className="rk-panel-meta">替换进参考片的人物或产品</span>
                        </div>
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
                        <div className="rk-plan-subject">
                            <label className="remake-field">
                                <span className="remake-field-label">描述</span>
                                <Input.TextArea rows={5} maxLength={2000} value={settings.targetDescription} onChange={(event) => updateSettings({ targetDescription: event.target.value })} placeholder="例如：一瓶 500ml 的柑橘气泡水，瓶身带水珠" />
                            </label>
                            <RemakeTargetImages
                                items={settings.targetResourceIds.map((id) => ({ id }))}
                                uploading={uploading}
                                onUpload={() => targetInput.current?.click()}
                                onPickLibrary={() => setPickerOpen(true)}
                                onRemove={(id) => updateSettings({ targetResourceIds: settings.targetResourceIds.filter((item) => item !== id) })}
                            />
                        </div>
                    </section>

                    <RemakeDisclosure
                        title="输出与模型"
                        summary={modelsQuery.isError ? "模型目录加载失败" : missingModels.length ? `${missingModels.length} 个模型未选择` : remakeSettingsSummary(settings)}
                        attention={outputAttention}
                        open={outputOpen}
                        onToggle={() => setOutputOpen((open) => !open)}
                    >
                        <RemakeOutputFields settings={settings} onChange={updateSettings} catalog={modelsQuery.data} catalogError={modelsQuery.isError ? modelsQuery.error.message : undefined} catalogLoading={modelsQuery.isFetching} />
                    </RemakeDisclosure>

                    <section className="rk-plan-launch" aria-label="启动复刻">
                        <RemakeModeSwitch value={settings.mode} onChange={(mode) => updateSettings({ mode })} />
                        <div className="rk-plan-launch-actions">
                            {missingItems.length ? <span className="rk-plan-missing">还需：{missingItems.join("、")}</span> : null}
                            <Button icon={<Sparkles size={14} />} disabled={!canLaunch || !generationReady} loading={runPending} onClick={onKeyframes}>
                                生成关键帧
                            </Button>
                            <Button type="primary" size="large" icon={<Sparkles size={15} />} disabled={!canLaunch || !generationReady} loading={runPending} onClick={onComplete}>
                                一键复刻
                            </Button>
                        </div>
                    </section>
                </div>
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
