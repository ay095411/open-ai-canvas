import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { imagePresetForRatio, imagePresetSelected, imagePresetSelectionPatch, imageResolutionTiers, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageResolutionOption, ImageResolutionTier } from "@/lib/image-resolution-tiers";
import { videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { formatVideoResolutionLabel, VIDEO_DURATION_MIN } from "@/lib/video-generation-options";
import { validateImageSize } from "@/services/api/image-validation";
import "./creation-settings-panel.css";

/** 参数面板只回传发生变化的字段，由调用方写回创作配置。 */
export type CreationSettingsPatch = {
    ratio?: string;
    quality?: string;
    imageResolution?: string;
    count?: number;
    videoQuality?: string;
    seconds?: number;
};

export type CreationSettingsPanelProps = {
    mode: "image" | "video";
    imageProfile: ImageCapabilityConfig;
    videoProfile: VideoCapabilityConfig;
    ratio: string;
    quality: string;
    imageResolution: string;
    videoQuality: string;
    count: number;
    /** 单次请求可生成的最大张数（账号并发与模型上限取小）。 */
    countLimit: number;
    seconds: number;
    /** 当前参考图尺寸，可直接套用为输出比例。 */
    referenceImageSize?: { width: number; height: number };
    costLabel?: string;
    costTitle?: string;
    /** 声明式参数模型里本面板未覆盖的字段，按同一套行样式追加在末尾。 */
    extra?: React.ReactNode;
    onChange: (patch: CreationSettingsPatch) => void;
};

export function CreationSettingsPanel(props: CreationSettingsPanelProps) {
    return (
        <div className="creation-settings-menu" onMouseDown={(event) => event.stopPropagation()}>
            {props.mode === "video" ? <VideoSettingsBody {...props} /> : <ImageSettingsBody {...props} />}
            {props.mode === "image" && props.extra ? <div className="creation-settings-extra">{props.extra}</div> : null}
            {props.costLabel ? (
                <div className="creation-settings-footer">
                    <span className="creation-settings-footer-label">{props.mode === "image" && props.count > 1 ? `共 ${props.count} 张` : ""}</span>
                    <span className="creation-settings-cost" title={props.costTitle}>
                        {props.costLabel}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

function ImageSettingsBody({ imageProfile, ratio, quality, imageResolution, count, countLimit, referenceImageSize, onChange }: CreationSettingsPanelProps) {
    const [chosenTier, setChosenTier] = useState<ImageResolutionTier>("1k");
    const [customOpen, setCustomOpen] = useState(false);
    const [customValue, setCustomValue] = useState("");
    const [error, setError] = useState("");

    const presets = useMemo(() => imageSizePresets(imageProfile).filter((preset) => imageTierAvailable(imageProfile, preset.tier)), [imageProfile]);
    // 声明值可能是大写的 1K/2K/4K，档位比较统一走小写。
    const tierValues = useMemo(() => {
        const values = imageProfile.resolution.supported ? imageProfile.resolution.values.map((value) => value.trim().toLowerCase() as ImageResolutionTier) : imageResolutionTiers(imageProfile);
        return [...new Set(values)];
    }, [imageProfile]);
    const visibleTiers = tierValues.filter((tier) => presets.some((preset) => preset.tier === tier));
    const scaleTiers = visibleTiers.length ? visibleTiers : tierValues;
    const active = presets.find((preset) => imagePresetSelected(imageProfile, preset, { size: ratio, quality, imageResolution, tiers: tierValues }));
    const tier = (active && scaleTiers.includes(active.tier) ? active.tier : undefined) || (scaleTiers.includes(chosenTier) ? chosenTier : scaleTiers[0]) || "1k";
    const choices = presets.filter((preset) => preset.tier === tier);
    const referenceValue = referenceImageSize ? `${referenceImageSize.width}x${referenceImageSize.height}` : "";

    const emitPreset = (preset: ImageResolutionOption) => {
        const patch = imagePresetSelectionPatch(imageProfile, preset);
        onChange({ ratio: patch.size, quality: patch.quality, imageResolution: patch.imageResolution });
    };
    const changeTier = (next: ImageResolutionTier) => {
        setError("");
        if (imageProfile.size.parameter === "none") {
            onChange({ imageResolution: next });
            return;
        }
        const currentRatio = active?.ratio || (ratio.includes(":") ? ratio : "1:1");
        const target = presets.find((preset) => preset.tier === next && preset.ratio === currentRatio) || presets.find((preset) => preset.tier === next);
        setChosenTier(next);
        if (target) {
            emitPreset(target);
            return;
        }
        // 该档位没有现成预设时按当前比例换算一档像素，请求端仍会做最终校验。
        try {
            emitPreset(imagePresetForRatio(next, currentRatio));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "尺寸格式无效");
        }
    };
    const applyCustom = () => {
        try {
            emitPreset(customValue.trim().includes(":") ? imagePresetForRatio(tier, customValue) : parsePixelPreset(customValue, tier));
            setError("");
            setCustomOpen(false);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "尺寸格式无效");
        }
    };

    return (
        <>
            {/* 只有一档分辨率时不再铺一条满宽的假按钮，值直接落在行标题右侧。 */}
            {scaleTiers.length > 1 ? (
                <CreationSettingRow title="分辨率">
                    <div className="creation-settings-segmented" style={{ gridTemplateColumns: `repeat(${scaleTiers.length}, minmax(0, 1fr))` }}>
                        {scaleTiers.map((value) => (
                            <button key={value} type="button" className="creation-settings-segment" aria-pressed={active ? active.tier === value : imageResolution.toLowerCase() === value} onClick={() => changeTier(value)}>
                                {value.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </CreationSettingRow>
            ) : scaleTiers.length === 1 ? (
                <CreationSettingRow title="分辨率" value={scaleTiers[0].toUpperCase()} />
            ) : null}

            {imageProfile.size.parameter !== "none" && choices.length ? (
                <CreationSettingRow title="宽高比" value={active?.ratio}>
                    <div className="creation-settings-ratios">
                        {choices.map((preset) => (
                            <button
                                key={`${preset.ratio}:${preset.size}`}
                                type="button"
                                className="creation-settings-ratio"
                                aria-pressed={active?.size === preset.size && active?.tier === preset.tier}
                                title={`${preset.ratio} · ${preset.width} × ${preset.height}`}
                                onClick={() => emitPreset(preset)}
                            >
                                <RatioBox width={preset.width} height={preset.height} />
                                <span className="creation-settings-ratio-label">{preset.ratio}</span>
                                <span className="creation-settings-ratio-pixels">
                                    {preset.width}×{preset.height}
                                </span>
                            </button>
                        ))}
                    </div>
                </CreationSettingRow>
            ) : null}

            {referenceValue ? (
                <button type="button" className="creation-settings-inline-action" aria-pressed={ratio === referenceValue} onClick={() => onChange({ ratio: referenceValue })}>
                    使用参考图尺寸 · {referenceImageSize?.width} × {referenceImageSize?.height}
                </button>
            ) : null}

            {countLimit > 1 ? (
                <CreationSettingRow title="生成张数" value={`${count} 张`}>
                    <div className="creation-settings-count">
                        {[1, 2, 3, 4].filter((value) => value <= countLimit).map((value) => (
                            <button key={value} type="button" className="creation-settings-chip" aria-pressed={count === value} onClick={() => onChange({ count: value })}>
                                {value}
                            </button>
                        ))}
                    </div>
                    {countLimit > 4 ? (
                        <label className="creation-settings-custom">
                            <span>自定义</span>
                            <input inputMode="numeric" pattern="[0-9]*" value={count} aria-label={`生成张数，范围 1 到 ${countLimit}`} onChange={(event) => onChange({ count: clampCount(event.target.value, countLimit) })} />
                            <em>张</em>
                        </label>
                    ) : null}
                </CreationSettingRow>
            ) : null}

            {imageProfile.size.allowCustom ? (
                <div className="creation-settings-custom-ratio">
                    <button type="button" className="creation-settings-inline-action" aria-expanded={customOpen} onClick={() => setCustomOpen((open) => !open)}>
                        自定义比例或尺寸
                        <ChevronDown className={customOpen ? "is-open" : ""} aria-hidden="true" />
                    </button>
                    {customOpen ? (
                        <div className="creation-settings-custom">
                            <input value={customValue} placeholder="16:9 或 1824x1024" aria-label="自定义比例或尺寸" onChange={(event) => setCustomValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && applyCustom()} />
                            <button type="button" onClick={applyCustom}>
                                应用
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {error ? (
                <p className="creation-settings-error" role="alert">
                    {error}
                </p>
            ) : null}
        </>
    );
}

function VideoSettingsBody({ videoProfile, ratio, videoQuality, seconds, onChange }: CreationSettingsPanelProps) {
    const resolutions = videoProfile.resolutions.map((value) => value.replace(/p$/i, ""));
    const selectedResolution = normalizeResolution(videoQuality) || resolutions[0] || "";
    const durationMin = videoProfile.duration.min || VIDEO_DURATION_MIN;
    const durationMax = Math.max(durationMin, videoProfile.duration.max || durationMin);
    const presets = videoProfile.duration.selection === "enum" ? videoDurationOptions(videoProfile) : [];
    const durationValue = presets.length ? presets.reduce((closest, item) => (Math.abs(item - seconds) < Math.abs(closest - seconds) ? item : closest), presets[0]) : Math.max(durationMin, Math.min(durationMax, seconds));

    return (
        <>
            {videoProfile.ratios.length ? (
                <CreationSettingRow title="画幅" value={ratio}>
                    <div className="creation-settings-ratios">
                        {videoProfile.ratios.map((value) => {
                            const box = ratioBox(value);
                            return (
                                <button key={value} type="button" className="creation-settings-ratio is-compact" aria-pressed={ratio === value} onClick={() => onChange({ ratio: value })}>
                                    <RatioBox width={box.width} height={box.height} />
                                    <span className="creation-settings-ratio-label">{value}</span>
                                </button>
                            );
                        })}
                    </div>
                </CreationSettingRow>
            ) : null}

            {/* 只有一档清晰度时不再铺一排按钮，值直接落在标题右侧。 */}
            {resolutions.length ? (
                <CreationSettingRow title="清晰度" value={formatVideoResolutionLabel(selectedResolution)}>
                    {resolutions.length > 1 ? (
                        <div className="creation-settings-segmented" style={{ gridTemplateColumns: `repeat(${resolutions.length}, minmax(0, 1fr))` }}>
                            {resolutions.map((value) => (
                                <button key={value} type="button" className="creation-settings-segment" aria-pressed={normalizeResolution(value) === normalizeResolution(selectedResolution)} onClick={() => onChange({ videoQuality: value })}>
                                    {formatVideoResolutionLabel(value)}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </CreationSettingRow>
            ) : null}

            {presets.length ? (
                <CreationSettingRow title="时长" value={`${durationValue} 秒`}>
                    <div className="creation-settings-segmented" style={{ gridTemplateColumns: `repeat(${Math.min(presets.length, 4)}, minmax(0, 1fr))` }}>
                        {presets.map((value) => (
                            <button key={value} type="button" className="creation-settings-segment" aria-pressed={durationValue === value} onClick={() => onChange({ seconds: value })}>
                                {value}s
                            </button>
                        ))}
                    </div>
                </CreationSettingRow>
            ) : (
                <CreationSettingRow title="时长" value={`${durationValue} 秒`}>
                    <div className="creation-settings-range">
                        {/* 刻度只跟滑块等宽，避免右端刻度落到步进器下面被当成单位。 */}
                        <div className="creation-settings-range-track">
                            <input
                                type="range"
                                min={durationMin}
                                max={durationMax}
                                step={Math.max(1, videoProfile.duration.step || 1)}
                                value={durationValue}
                                aria-label="视频时长（秒）"
                                onChange={(event) => onChange({ seconds: Number(event.target.value) })}
                            />
                            <div className="creation-settings-range-scale">
                                <span>{durationMin}s</span>
                                <span>{durationMax}s</span>
                            </div>
                        </div>
                        <label className="creation-settings-stepper">
                            <input inputMode="numeric" value={durationValue} aria-label="自定义视频时长，单位秒" onChange={(event) => onChange({ seconds: clampSeconds(event.target.value, durationMin, durationMax) })} />
                            <em>秒</em>
                        </label>
                    </div>
                </CreationSettingRow>
            )}
        </>
    );
}

/** 单行参数：标题 + 右侧当前值；只有需要选择时才传子控件。 */
export function CreationSettingRow({ title, value, children }: { title: string; value?: string; children?: React.ReactNode }) {
    return (
        <section className="creation-settings-row">
            <header>
                <h3>{title}</h3>
                {value ? <span>{value}</span> : null}
            </header>
            {children}
        </section>
    );
}

/** 比例缩略图：等比映射到 18×14 的画框内，横竖屏一眼可辨。 */
function RatioBox({ width, height }: { width: number; height: number }) {
    if (!width || !height) return <span className="creation-settings-ratio-box" aria-hidden="true" />;
    const scale = Math.min(18 / width, 14 / height);
    return <span className="creation-settings-ratio-box" style={{ width: Math.max(5, Math.round(width * scale)), height: Math.max(5, Math.round(height * scale)) }} aria-hidden="true" />;
}

function ratioBox(ratio: string) {
    const [width, height] = ratio.replace("x", ":").split(":").map(Number);
    return { width: Number.isFinite(width) && width > 0 ? width : 1, height: Number.isFinite(height) && height > 0 ? height : 1 };
}

function normalizeResolution(value: string) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/p$/, "");
}

function clampCount(value: string, limit: number) {
    return Math.max(1, Math.min(limit, Math.floor(Number(value)) || 1));
}

function clampSeconds(value: string, min: number, max?: number) {
    const next = Math.floor(Number(value)) || min;
    return Math.max(min, max ? Math.min(max, next) : next);
}

function parsePixelPreset(value: string, tier: ImageResolutionTier): ImageResolutionOption {
    const match = value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) throw new Error("输入比例 16:9，或像素 1824x1024");
    const width = Number(match[1]);
    const height = Number(match[2]);
    validateImageSize(width, height);
    return { ...imagePresetForRatio(tier, `${width}:${height}`), width, height, size: `${width}x${height}`, tier };
}
