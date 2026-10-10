/**
 * 创作页空态下方的灵感瀑布流。
 *
 * 与 /inspirations 的分工：那边是完整的库（来源、分类、搜索、收藏、编辑齐全），
 * 这边只负责"铺开给你看"——整面瀑布、按创作类型过滤、点一张就把提示词带回创作区。
 * 所以它不拉全量目录（约 4MB），只用 gallery-pool（几百 KB，条目已经带本地缩略图）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";

import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { loadGalleryPool } from "@/services/inspiration-catalog";
import type { CreationMode } from "./creation-types";
import "./creation-inspiration-waterfall.css";

/** 首批渲染与每次「加载更多」追加的条数。 */
const PAGE_SIZE = 24;

type ModeFilter = "all" | CreationMode;

const FILTERS: { label: string; value: ModeFilter }[] = [
    { label: "全部", value: "all" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
];

/**
 * 封面比例：条目自带 ratio 就照它，否则按创作类型给一个默认值。
 * 比例是写死在样式上的，图片回来之前卡片就已经是最终高度——整面瀑布不会
 * 边加载边上下抽动。这也是每张卡高度各不相同、错落成瀑布的来源。
 */
function coverAspect(item: CreationInspiration): string {
    const ratio = item.ratio?.trim() ?? "";
    if (/^\d{1,2}\s*:\s*\d{1,2}$/.test(ratio)) return ratio.replace(/\s*:\s*/, " / ");
    return item.mode === "video" ? "16 / 9" : "4 / 3";
}

export function CreationInspirationWaterfall({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    const [pool, setPool] = useState<CreationInspiration[]>([]);
    const [poolReady, setPoolReady] = useState(false);
    const [filter, setFilter] = useState<ModeFilter>("all");
    const [shown, setShown] = useState(PAGE_SIZE);

    useEffect(() => {
        let alive = true;
        // 加载器自己不会 reject：拉不到就退回打包的原创条目，瀑布宁可少几张也不该空着。
        loadGalleryPool().then((entries) => {
            if (!alive) return;
            setPool(entries);
            setPoolReady(true);
        });
        return () => {
            alive = false;
        };
    }, []);

    const counts = useMemo(() => {
        const total: Record<ModeFilter, number> = { all: pool.length, text: 0, image: 0, video: 0 };
        for (const item of pool) total[item.mode] += 1;
        return total;
    }, [pool]);

    const filtered = useMemo(() => (filter === "all" ? pool : pool.filter((item) => item.mode === filter)), [filter, pool]);

    // 换筛选条件要回到第一批，否则会停在一个已经不存在的位置上，看到一片空白。
    useEffect(() => {
        setShown(PAGE_SIZE);
    }, [filter]);

    const visible = filtered.slice(0, shown);
    const remaining = filtered.length - visible.length;

    const start = useCallback((item: CreationInspiration) => onStartPrompt(item.mode, fillablePrompt(item)), [onStartPrompt]);

    if (!poolReady) {
        return (
            <section className="creation-waterfall-section" aria-label="灵感瀑布流">
                <p className="creation-waterfall-loading">正在加载灵感…</p>
            </section>
        );
    }
    if (!pool.length) return null;

    return (
        <section className="creation-waterfall-section" aria-label="灵感瀑布流">
            <header className="creation-waterfall-header">
                <p className="creation-waterfall-heading">
                    灵感库
                    <small>{`共 ${counts.all} 条，点一张就带去创作区`}</small>
                </p>
                <div className="creation-waterfall-filters" role="group" aria-label="按创作类型筛选">
                    {FILTERS.map((option) => (
                        <button key={option.value} type="button" className="creation-waterfall-filter" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                            {option.label}
                            <span className="creation-waterfall-filter-count">{counts[option.value]}</span>
                        </button>
                    ))}
                </div>
            </header>

            <div className="creation-waterfall">
                {visible.map((item) => (
                    <article
                        key={catalogIdOf(item)}
                        className="creation-waterfall-card"
                        tabIndex={0}
                        role="button"
                        onClick={() => start(item)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                start(item);
                            }
                        }}
                    >
                        <div className="creation-waterfall-cover" style={{ aspectRatio: coverAspect(item) }}>
                            <img src={item.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
                            <span className="creation-waterfall-cta">
                                <ArrowUp aria-hidden="true" />
                                使用这个创意
                            </span>
                        </div>
                        <div className="creation-waterfall-body">
                            <h3 className="creation-waterfall-title">{item.title}</h3>
                            <p className="creation-waterfall-desc">{item.description}</p>
                        </div>
                    </article>
                ))}
            </div>

            {remaining > 0 ? (
                <button type="button" className="creation-waterfall-more" onClick={() => setShown((current) => current + PAGE_SIZE)}>
                    {`加载更多（还有 ${remaining} 条）`}
                </button>
            ) : null}
        </section>
    );
}
