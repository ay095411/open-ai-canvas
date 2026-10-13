/**
 * 创作页空态下方的灵感瀑布流。
 *
 * **数据与 /inspirations 完全同源**：拉 `loadInspirationCatalog()` 的全量目录
 * （原创 + seedance / haohaoxue / youmind 三个外部来源），再按 `resolveInspirations()`
 * 叠上用户自己的改动（自建条目、改写、隐藏）。所以这里的条数与内容跟灵感库页一一对应 ——
 * 之前它读的是另一份 `gallery-pool.json` 精选池（329 条），两边对不上，
 * 在灵感库页收藏或隐藏的条目在首页也没有反映。
 *
 * 首页只负责"铺开给你看"：整面瀑布、按创作类型过滤、首批若干条 + 加载更多、
 * 点开一张看完整提示词，决定要用再一键带回创作区。
 *
 * 卡片图片按原图比例自适应显示，不裁切也不压成统一高度；宽高由目录数据里的
 * width/height 提前给出，图片到达前就已占好位，整面瀑布不会边加载边上下抽动。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { Eye } from "lucide-react";

import { InspirationDetailModal } from "@/pages/inspirations/inspiration-detail-modal";
import { catalogIdOf, curatedInspirations, inspirationCategoryLabel, type CreationInspiration, type InspirationCategoryLabels } from "@/lib/inspirations/catalog";
import { fillablePrompt, resolveInspirations } from "@/lib/inspirations/resolve";
import { categoryLabelsOf, loadInspirationCatalog } from "@/services/inspiration-catalog";
import { useInspirationStore } from "@/stores/use-inspiration-store";
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

export function CreationInspirationWaterfall({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    const { message } = App.useApp();
    const [categoryLabels, setCategoryLabels] = useState<InspirationCategoryLabels>({});
    const [filter, setFilter] = useState<ModeFilter>("all");
    const [shown, setShown] = useState(PAGE_SIZE);
    const [detail, setDetail] = useState<CreationInspiration | null>(null);
    /** 点了「用这个创意创作」但弹窗还没关完的条目，等 afterClose 再真正填词。 */
    const [pendingUse, setPendingUse] = useState<CreationInspiration | null>(null);

    // 用户的增删改是叠加层，不是数据副本：目录本身始终只读。
    const custom = useInspirationStore((state) => state.custom);
    const overrides = useInspirationStore((state) => state.overrides);
    const hidden = useInspirationStore((state) => state.hidden);
    const overlay = useMemo(() => ({ custom, overrides, hidden }), [custom, hidden, overrides]);

    /** 内置目录，加载完成前是 null（界面显示"正在加载灵感…"）。 */
    const [base, setBase] = useState<CreationInspiration[] | null>(null);

    useEffect(() => {
        let alive = true;
        // 失败不往界面上抛：退回打包的原创条目，瀑布宁可少几张也不该空着。
        loadInspirationCatalog()
            .then((catalog) => {
                if (!alive) return;
                setBase(catalog.entries);
                // 译名表直接从目录里取（`categoriesBySource` 已经带着），不必再单独拉一次 manifest。
                setCategoryLabels(categoryLabelsOf(catalog));
            })
            .catch((error) => {
                console.warn("灵感目录加载失败，退回打包的原创条目", error);
                if (alive) setBase(curatedInspirations);
            });
        return () => {
            alive = false;
        };
    }, []);

    /**
     * 与灵感库页共用同一套合成规则（`resolveInspirations`）：隐藏的滤掉、改写的生效、
     * 自建条目排在最前。所以库里隐藏了哪条，首页也就少哪条。
     *
     * 不等 store 的 `hydrated`：目录要拉 3MB+，本地持久化的回填比它快得多，等目录到位时
     * 叠加层早就 ready 了；真等下去只是多一个「永远转圈」的死锁面。
     */
    const pool = useMemo(() => (base ? resolveInspirations(base, overlay) : null), [base, overlay]);

    const poolReady = pool !== null;
    const items = useMemo(() => pool ?? [], [pool]);

    const counts = useMemo(() => {
        const total: Record<ModeFilter, number> = { all: items.length, text: 0, image: 0, video: 0 };
        for (const item of items) total[item.mode] += 1;
        return total;
    }, [items]);

    const filtered = useMemo(() => (filter === "all" ? items : items.filter((item) => item.mode === filter)), [filter, items]);

    // 换筛选条件要回到第一批，否则会停在一个已经不存在的位置上，看到一片空白。
    useEffect(() => {
        setShown(PAGE_SIZE);
    }, [filter]);

    const visible = filtered.slice(0, shown);
    const remaining = filtered.length - visible.length;

    const categoryLabel = useCallback((item: CreationInspiration) => inspirationCategoryLabel(item, categoryLabels), [categoryLabels]);

    const copyPrompt = useCallback(
        (text: string, label: string) => {
            void navigator.clipboard.writeText(text).then(
                () => message.success(`${label}已复制`),
                () => message.error("复制失败，请手动选中文本"),
            );
        },
        [message],
    );

    /**
     * 详情里的「用这个创意创作」。
     *
     * 只登记待办、不在这里填词：AntD Modal 关闭动画结束后会把焦点还给打开它的卡片，
     * 此刻 focus 输入框会被那一下覆盖。真正执行放到弹窗的 afterClose —— 见下面的注释。
     */
    const useInspiration = useCallback((item: CreationInspiration) => {
        setPendingUse(item);
        setDetail(null);
    }, []);

    /** 弹窗彻底关完（动画结束、子节点已卸载）才填词，这样输入框拿到的焦点不会再被抢走。 */
    const commitPendingUse = useCallback(() => {
        if (!pendingUse) return;
        setPendingUse(null);
        onStartPrompt(pendingUse.mode, fillablePrompt(pendingUse));
    }, [onStartPrompt, pendingUse]);

    if (!poolReady) {
        return (
            <section className="creation-waterfall-section" aria-label="灵感瀑布流">
                <p className="creation-waterfall-loading">正在加载灵感…</p>
            </section>
        );
    }
    if (!items.length) return null;

    return (
        <section className="creation-waterfall-section" aria-label="灵感瀑布流">
            <header className="creation-waterfall-header">
                <p className="creation-waterfall-heading">
                    灵感库
                    <small>{`共 ${counts.all} 条，点开看完整提示词`}</small>
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
                        aria-label={`查看灵感详情：${item.title}`}
                        onClick={() => setDetail(item)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setDetail(item);
                            }
                        }}
                    >
                        <div className="creation-waterfall-cover">
                            <img src={item.image} alt="" width={item.width} height={item.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
                            <span className="creation-waterfall-cta">
                                <Eye aria-hidden="true" />
                                查看详情
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

            {/* 首页是展示态：不传收藏 / 编辑 / 删除，弹窗里就不会出现改库的入口。 */}
            <InspirationDetailModal item={detail} categoryLabel={categoryLabel} onClose={() => setDetail(null)} onUse={useInspiration} onCopy={copyPrompt} afterClose={commitPendingUse} />
        </section>
    );
}
