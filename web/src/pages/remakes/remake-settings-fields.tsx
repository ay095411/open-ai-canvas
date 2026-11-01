import { useId, type ReactNode } from "react";
import { Input, InputNumber, message } from "antd";
import { ChevronDown, ImagePlus, X } from "lucide-react";

import { SegmentedControl, type SegmentedOption } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { Callout } from "@/components/ui/product/callout";
import { remakeCredits, remakeDuration } from "@/lib/remake/presentation";
import { cn } from "@/lib/utils";
import type { RemakeCapability, RemakeModelCatalog, RemakeModelChoice, RemakeMode, RemakeSettings } from "@/services/api/remakes";
import { resourceFileUrl } from "@/services/api/resources";

import "./remake-settings.css";

export const REMAKE_CAPABILITIES: RemakeCapability[] = ["text", "image", "video"];
export const REMAKE_MAX_TARGET_IMAGES = 4;
export const REMAKE_MAX_RANGE_MS = 60_000;

const capabilityLabels: Record<RemakeCapability, string> = { text: "视频分析", image: "关键帧图片", video: "镜头视频" };

const aspectOptions: Array<{ value: RemakeSettings["aspectRatio"]; label: string }> = [
    { value: "9:16", label: "9:16 竖屏" },
    { value: "16:9", label: "16:9 横屏" },
    { value: "1:1", label: "1:1 方形" },
];

const audioOptions: Array<{ value: RemakeSettings["audioMode"]; label: string }> = [
    { value: "original", label: "沿用原片" },
    { value: "generated", label: "生成音轨" },
    { value: "mute", label: "静音" },
];

const audioSummary: Record<RemakeSettings["audioMode"], string> = { original: "原片音轨", generated: "生成音轨", mute: "静音" };

const modeOptions: Array<SegmentedOption<RemakeMode>> = [
    { value: "review", label: "精修复刻" },
    { value: "quick", label: "快速复刻" },
];

const modeHints: Record<RemakeMode, string> = {
    review: "推荐。先生成关键帧，确认主体替换效果后再生成视频。",
    quick: "一次执行到成片，自动选用合格关键帧，适合熟悉效果后批量制作。",
};

function modelChoiceValue(choice: RemakeModelChoice) {
    return JSON.stringify(choice);
}

export function missingRemakeModels(settings: RemakeSettings, capabilities: RemakeCapability[] = REMAKE_CAPABILITIES) {
    return capabilities.filter((key) => !Object.keys(settings.models[key] || {}).length);
}

/** 折叠区标题旁的一行摘要：不展开也能看到当前生效的输出设置。 */
export function remakeSettingsSummary(settings: RemakeSettings, { includeMode = false }: { includeMode?: boolean } = {}) {
    const parts = [aspectOptions.find((option) => option.value === settings.aspectRatio)?.label ?? settings.aspectRatio, audioSummary[settings.audioMode] ?? settings.audioMode];
    if (includeMode) parts.push(settings.mode === "quick" ? "快速复刻" : "精修复刻");
    parts.push(settings.budgetMicrocredits > 0 ? `预算 ${remakeCredits(settings.budgetMicrocredits)} 积分` : "不限预算");
    return parts.join(" · ");
}

export function RemakeDisclosure({
    title,
    summary,
    open,
    onToggle,
    attention = false,
    variant = "panel",
    className,
    children,
}: {
    title: ReactNode;
    summary?: ReactNode;
    open: boolean;
    onToggle: () => void;
    /** 摘要用警示色，提示折叠内容里有待处理项 */
    attention?: boolean;
    variant?: "panel" | "inline";
    className?: string;
    children: ReactNode;
}) {
    const bodyId = useId();
    return (
        <section className={cn("remake-disclosure", `is-${variant}`, open && "is-open", attention && "needs-attention", className)}>
            <button type="button" className="remake-disclosure-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={onToggle}>
                <span className="remake-disclosure-title">{title}</span>
                {summary ? <span className="remake-disclosure-summary">{summary}</span> : null}
                <ChevronDown className="remake-disclosure-chevron" size={16} aria-hidden />
            </button>
            {open ? (
                <div id={bodyId} className="remake-disclosure-body">
                    {children}
                </div>
            ) : null}
        </section>
    );
}

export function RemakeModeSwitch({ value, onChange, className }: { value: RemakeMode; onChange: (mode: RemakeMode) => void; className?: string }) {
    return (
        <div className={cn("remake-mode-switch", className)}>
            <SegmentedControl<RemakeMode> ariaLabel="执行方式" value={value} options={modeOptions} onChange={onChange} />
            <p className="remake-mode-hint">{modeHints[value]}</p>
        </div>
    );
}

export function RemakeRangeFields({
    inMs,
    outMs,
    durationMs,
    overLimit = false,
    disabled,
    label = "复刻区间",
    onChange,
}: {
    inMs: number;
    outMs: number;
    /** 参考片总时长；结束为空（整段）时用于计算区间长度 */
    durationMs?: number;
    overLimit?: boolean;
    disabled?: boolean;
    label?: string;
    onChange: (patch: Pick<Partial<RemakeSettings>, "sourceInMs" | "sourceOutMs">) => void;
}) {
    const toMs = (value: number | null) => Math.max(0, Math.round((value || 0) * 1000));
    const maxSeconds = durationMs ? durationMs / 1000 : undefined;
    const endMs = outMs || durationMs || 0;
    return (
        <div className={cn("remake-range", overLimit && "is-over")} role="group" aria-label={label}>
            <span className="remake-range-label">{label}</span>
            <span className="remake-range-inputs">
                <InputNumber className="remake-range-input" min={0} max={maxSeconds} step={0.1} value={inMs / 1000} disabled={disabled} aria-label={`${label}开始秒数`} onChange={(value) => onChange({ sourceInMs: toMs(value) })} />
                <span aria-hidden>–</span>
                <InputNumber
                    className="remake-range-input"
                    min={0}
                    max={maxSeconds}
                    step={0.1}
                    value={outMs ? outMs / 1000 : null}
                    placeholder="结尾"
                    disabled={disabled}
                    aria-label={`${label}结束秒数`}
                    onChange={(value) => onChange({ sourceOutMs: toMs(value) })}
                />
                <span>秒</span>
            </span>
            <span className="remake-range-total">{endMs > 0 ? `共 ${remakeDuration(Math.max(0, endMs - inMs))}` : "至视频结尾"}</span>
        </div>
    );
}

export function RemakeTargetImages({
    items,
    uploading = false,
    disabled = false,
    onUpload,
    onPickLibrary,
    onRemove,
}: {
    items: Array<{ id: string; name?: string }>;
    uploading?: boolean;
    disabled?: boolean;
    onUpload: () => void;
    onPickLibrary: () => void;
    onRemove: (id: string) => void;
}) {
    const full = items.length >= REMAKE_MAX_TARGET_IMAGES;
    return (
        <div className="remake-field">
            <div className="remake-field-head">
                <span className="remake-field-label">参考图</span>
                <span className="remake-field-aside">
                    <span className="tabular-nums">
                        {items.length}/{REMAKE_MAX_TARGET_IMAGES}
                    </span>
                    <button type="button" className="remake-link" disabled={disabled || uploading || full} onClick={onPickLibrary}>
                        从素材库添加
                    </button>
                </span>
            </div>
            <div className="remake-target-grid">
                {items.map((item) => {
                    const name = item.name || "主体参考图";
                    return (
                        <div key={item.id} className="remake-target-tile">
                            <img src={resourceFileUrl(item.id)} alt={name} crossOrigin="use-credentials" />
                            <button type="button" className="remake-target-remove" aria-label={`移除${name}`} onClick={() => onRemove(item.id)}>
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
                {!full ? (
                    <button type="button" className="remake-target-add" aria-label="上传主体参考图" disabled={disabled || uploading} onClick={onUpload}>
                        <ImagePlus size={20} aria-hidden />
                        <span>{uploading ? "上传中…" : "上传"}</span>
                    </button>
                ) : null}
            </div>
        </div>
    );
}

export function RemakeOutputFields({
    settings,
    onChange,
    catalog,
    catalogError,
    catalogLoading = false,
}: {
    settings: RemakeSettings;
    onChange: (patch: Partial<RemakeSettings>) => void;
    catalog?: RemakeModelCatalog;
    catalogError?: string;
    catalogLoading?: boolean;
}) {
    const missing = missingRemakeModels(settings);
    const updateModel = (capability: RemakeCapability, raw: string) => {
        try {
            const choice = JSON.parse(raw) as RemakeModelChoice;
            onChange({ models: { ...settings.models, [capability]: choice } });
        } catch {
            message.error("模型选择无效，请重新选择");
        }
    };

    return (
        <div className="remake-output-fields">
            <div className="remake-field-grid">
                <label className="remake-field">
                    <span className="remake-field-label">成片画幅</span>
                    <Select className="w-full" value={settings.aspectRatio} ariaLabel="成片画幅" options={aspectOptions} onChange={(value) => onChange({ aspectRatio: value as RemakeSettings["aspectRatio"] })} />
                </label>
                <label className="remake-field">
                    <span className="remake-field-label">音轨</span>
                    <Select className="w-full" value={settings.audioMode} ariaLabel="音轨模式" options={audioOptions} onChange={(value) => onChange({ audioMode: value as RemakeSettings["audioMode"] })} />
                </label>
                <label className="remake-field">
                    <span className="remake-field-label">预算上限（积分）</span>
                    <InputNumber className="w-full" min={0} max={1_000_000} step={10} value={settings.budgetMicrocredits / 1_000_000} onChange={(value) => onChange({ budgetMicrocredits: Math.round((value || 0) * 1_000_000) })} />
                </label>
            </div>
            <p className="remake-field-note">预算 0 表示不限。费用在每项任务完成结算后累计；某项超出剩余额度时仍会计入，之后停止派发新任务。</p>
            <label className="remake-field">
                <span className="remake-field-label">整体风格</span>
                <Input.TextArea rows={2} maxLength={2000} value={settings.style} onChange={(event) => onChange({ style: event.target.value })} placeholder="可选，例如自然光、胶片质感" />
            </label>
            <div className="remake-field">
                <div className="remake-field-head">
                    <span className="remake-field-label">模型</span>
                    {catalogLoading ? <span className="remake-field-aside">读取中…</span> : null}
                </div>
                {catalogError ? (
                    <Callout tone="error" title="模型目录加载失败">
                        {catalogError}
                    </Callout>
                ) : null}
                <div className="remake-field-grid">
                    {REMAKE_CAPABILITIES.map((capability) => {
                        const options = catalog?.options[capability] || [];
                        return (
                            <label key={capability} className="remake-field is-compact">
                                <span className="remake-field-sublabel">{capabilityLabels[capability]}</span>
                                <Select
                                    className="w-full"
                                    status={missing.includes(capability) ? "warning" : undefined}
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
            </div>
        </div>
    );
}
