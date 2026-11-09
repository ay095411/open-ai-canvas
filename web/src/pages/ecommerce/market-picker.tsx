import { Button } from "antd";
import { Check, ChevronDown, X } from "lucide-react";
import { GlobeIcon } from "@/components/ui/ecommerce-icons";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { commercePlatformGroups, labelOf, languageVisuals, languages, platforms } from "./catalog";
import { commerceKnowledgeFor, commercePlatformKnowledge } from "./platform-knowledge";
import "./market-picker.css";

export function PlatformMark({ platform }: { platform: string }) {
    return <img className="commerce-platform-logo" data-monochrome={["amazon", "tiktok", "douyin", "ozon", "dewu"].includes(platform)} src={`/commerce/platforms/${platform}.svg`} alt="" width={28} height={28} />;
}

export function LanguageFlag({ language }: { language: string }) {
    const flag = languageVisuals[language]?.flag;
    return flag ? <img className="commerce-language-flag" src={`/commerce/flags/${flag}.svg`} alt="" width={20} height={15} /> : <GlobeIcon size={16} />;
}

const groups = [
    ["domestic", "中文电商"],
    ["crossBorder", "跨境电商"],
] as const;

/** 语言浮层的最大高度与它到触发器的间距，量方向时两边都用这个基准。
    高度取整 7 行：36px 行高 + 1px 间距 + 上下各 4px 内边距，避免最后一行被切一半。 */
const LANGUAGE_MENU_MAX = 266;
const LANGUAGE_MENU_GAP = 6;

/** 投放平台与输出语言：居中弹窗，单层表面，平台按分组平铺。 */
export function CommerceMarketPicker({
    platform,
    language,
    region,
    onPlatform,
    onLanguage,
    onRegion,
    onClose,
}: {
    platform: string;
    language: string;
    region: string;
    onPlatform: (value: string) => void;
    onLanguage: (value: string) => void;
    onRegion: (value: string) => void;
    onClose: () => void;
}) {
    const [languageOpen, setLanguageOpen] = useState(false);
    const [languageMenu, setLanguageMenu] = useState<{ align: "up" | "down"; maxHeight: number }>({ align: "down", maxHeight: LANGUAGE_MENU_MAX });
    const languageAnchorRef = useRef<HTMLDivElement | null>(null);
    const knowledge = commerceKnowledgeFor(platform);

    const toggleLanguage = () => {
        if (languageOpen) {
            setLanguageOpen(false);
            return;
        }
        // 语言有十来种，一列排开比触发器高得多。锚点通常贴在滚动区末尾，向下展开
        // 会被 .commerce-market-body 的 overflow 裁掉，所以按上下实际剩余空间选方向，
        // 并把该侧剩余空间直接当成浮层的最大高度。
        const anchor = languageAnchorRef.current;
        const body = anchor?.closest(".commerce-market-body");
        if (anchor && body) {
            const anchorBox = anchor.getBoundingClientRect();
            const bodyBox = body.getBoundingClientRect();
            const below = bodyBox.bottom - anchorBox.bottom - LANGUAGE_MENU_GAP;
            const above = anchorBox.top - bodyBox.top - LANGUAGE_MENU_GAP;
            const align = below < Math.min(LANGUAGE_MENU_MAX, above) ? "up" : "down";
            const space = align === "up" ? above : below;
            setLanguageMenu({ align, maxHeight: Math.max(96, Math.min(LANGUAGE_MENU_MAX, Math.floor(space))) });
        }
        setLanguageOpen(true);
    };

    useEffect(() => {
        if (!languageOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!languageAnchorRef.current?.contains(event.target as Node)) setLanguageOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [languageOpen]);

    return (
        <AppModal open flush closable={false} footer={null} width="min(680px, calc(100vw - 32px))" onCancel={onClose} centered className="commerce-market-modal">
            <section className="commerce-market" role="dialog" aria-label="电商平台与语言" data-canvas-no-zoom>
                <header className="commerce-market-head">
                    <div>
                        <h2>投放平台与语言</h2>
                        <p>平台决定图片规范与文案约束，语言决定图中文字。</p>
                    </div>
                    <button type="button" className="commerce-market-close" aria-label="关闭参数" onClick={onClose}>
                        <X size={16} />
                    </button>
                </header>
                <div className="commerce-market-body" data-canvas-wheel-scroll>
                    {groups.map(([group, title]) => (
                        <section key={group} className="commerce-market-group">
                            <h3>{title}</h3>
                            <div className="commerce-market-grid">
                                {commercePlatformGroups[group].map((id) => (
                                    <button type="button" key={id} className={platform === id ? "is-selected" : ""} aria-pressed={platform === id} title={labelOf(platforms, id)} onClick={() => onPlatform(id)}>
                                        <span className="commerce-market-logo" aria-hidden="true">
                                            <PlatformMark platform={id} />
                                        </span>
                                        <span className="commerce-market-name">{labelOf(platforms, id)}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                    <div className="commerce-market-fields">
                        <div className="commerce-market-field commerce-market-field--language">
                            <h3>输出语言</h3>
                            {/* 浮层挂在这层只包住触发器的锚点上，才能贴着按钮上下展开，
                                不会连标题一起算进去空出一截。 */}
                            <div className="commerce-language-anchor" ref={languageAnchorRef}>
                                <button className="commerce-language-trigger" type="button" aria-haspopup="listbox" aria-expanded={languageOpen} aria-controls="commerce-language-options" onClick={toggleLanguage}>
                                    <LanguageFlag language={language} />
                                    <strong>{languageVisuals[language]?.label || labelOf(languages, language)}</strong>
                                    <ChevronDown size={14} className={languageOpen ? "is-open" : ""} />
                                </button>
                                {languageOpen ? (
                                    <div
                                        id="commerce-language-options"
                                        className="commerce-language-options"
                                        role="listbox"
                                        aria-label="输出语言"
                                        data-placement={languageMenu.align}
                                        style={{ "--commerce-language-max": `${languageMenu.maxHeight}px` } as CSSProperties}
                                    >
                                        {languages.map(([id, label]) => (
                                            <button
                                                type="button"
                                                key={id}
                                                role="option"
                                                aria-selected={language === id}
                                                onClick={() => {
                                                    onLanguage(id);
                                                    setLanguageOpen(false);
                                                }}
                                            >
                                                <LanguageFlag language={id} />
                                                <strong>{languageVisuals[id]?.label || label}</strong>
                                                {language === id ? <Check size={14} /> : null}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <label className="commerce-market-field">
                            <h3>目标地区（可选）</h3>
                            <input aria-label="目标国家或地区" value={region} maxLength={80} placeholder="例如：美国、日本" onChange={(event) => onRegion(event.target.value)} />
                        </label>
                    </div>
                    {knowledge ? (
                        <details className="commerce-market-rules" aria-label="所选平台图片规则">
                            <summary>{labelOf(platforms, platform)} 的图片与内容要求</summary>
                            <div>
                                {[knowledge.style, knowledge.risk, knowledge.scope].filter(Boolean).map((text) => (
                                    <p key={text}>{text}</p>
                                ))}
                                {knowledge.officialRules.length ? (
                                    <ul>
                                        {knowledge.officialRules.map((rule) => (
                                            <li key={rule}>{rule}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                <p className="commerce-market-source">
                                    {knowledge.reviewStatus === "pending" ? "详细规则待官方后台核实" : `已核对部分公开资料 · ${knowledge.checkedAt}`}
                                    {knowledge.sources.map((url, index) => (
                                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                            官方资料 {index + 1}
                                        </a>
                                    ))}
                                </p>
                                <p className="commerce-market-source">
                                    通用风险词示例：{commercePlatformKnowledge.restrictedPhrases.join("、")}（非完整官方禁词表）。{commercePlatformKnowledge.boundary}
                                </p>
                            </div>
                        </details>
                    ) : null}
                </div>
                <footer className="commerce-market-foot">
                    <span>
                        当前：{labelOf(platforms, platform)} · {languageVisuals[language]?.label || labelOf(languages, language)}
                        {region.trim() ? ` · ${region.trim()}` : ""}
                    </span>
                    <Button type="primary" onClick={onClose}>
                        完成
                    </Button>
                </footer>
            </section>
        </AppModal>
    );
}
