import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { catalogIdOf, type CreationInspiration } from "@/lib/inspirations/catalog";
import { inspirationCoverRatio, layoutInspirationMasonry } from "@/lib/inspirations/masonry";
import "./inspiration-masonry.css";

type MasonryItem = Pick<CreationInspiration, "id" | "title" | "sourceId" | "width" | "height" | "ratio" | "mode">;
type CardMeasurement = { width: number; height: number };

/** 原始 DOM 顺序不变；列数仅由容器宽度决定，不随分页条数增加而重新平衡。 */
export function InspirationMasonry<T extends MasonryItem>({ items, busy, className, ariaLabel, renderItem }: { items: readonly T[]; busy?: boolean; className?: string; ariaLabel?: string; renderItem: (item: T) => ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const cells = useRef(new Map<string, HTMLDivElement>());
    const [geometry, setGeometry] = useState({ width: 0, gap: 16, minColumnWidth: 248 });
    const [measurements, setMeasurements] = useState<Record<string, CardMeasurement>>({});

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const measure = () => {
            // 详情显示时大厅被 hidden，不能把零宽写进布局；返回大厅保留原来的位置。
            if (container.clientWidth <= 0) return;
            const style = getComputedStyle(container);
            // Modal 开场有 scale 动画；读取未变换的布局尺寸，保留亚像素精度。
            const width = Number.parseFloat(style.width) || container.clientWidth;
            const gap = Number.parseFloat(style.columnGap) || 16;
            const minColumnWidth = Number.parseFloat(style.getPropertyValue("--inspiration-min-column-width")) || 248;
            setGeometry((previous) => (Math.abs(previous.width - width) < 0.25 && previous.gap === gap && previous.minColumnWidth === minColumnWidth ? previous : { width, gap, minColumnWidth }));
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        observer?.observe(container);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    const columnWidth = layoutInspirationMasonry([], geometry.width, geometry.minColumnWidth, geometry.gap).columnWidth;
    const layout = useMemo(() => {
        const heights = items.map((item) => {
            const measured = measurements[catalogIdOf(item)];
            // Only an initial estimate; rendered cards are never assigned this height or ratio.
            return measured && Math.abs(measured.width - columnWidth) < 0.25 ? measured.height : columnWidth / inspirationCoverRatio(item) + 200;
        });
        return layoutInspirationMasonry(heights, geometry.width, geometry.minColumnWidth, geometry.gap);
    }, [columnWidth, geometry, items, measurements]);

    useLayoutEffect(() => {
        if (geometry.width <= 0) return;
        const container = containerRef.current;
        if (!container) return;
        const measure = () => {
            if (!containerRef.current || containerRef.current.clientWidth <= 0) return;
            const next = new Map<string, CardMeasurement>();
            for (const [id, element] of cells.current) {
                const style = getComputedStyle(element);
                const width = Number.parseFloat(style.width) || element.offsetWidth;
                const height = Number.parseFloat(style.height) || element.offsetHeight;
                if (width > 0 && height > 0) next.set(id, { width, height });
            }
            setMeasurements((previous) => {
                let changed = false;
                const result = { ...previous };
                for (const [id, size] of next) {
                    const old = previous[id];
                    if (!old || Math.abs(old.width - size.width) >= 0.25 || Math.abs(old.height - size.height) >= 0.25) {
                        result[id] = size;
                        changed = true;
                    }
                }
                return changed ? result : previous;
            });
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        for (const element of cells.current.values()) observer?.observe(element);
        let frame: number | undefined;
        const mediaChanged = () => {
            measure();
            if (frame !== undefined) window.cancelAnimationFrame(frame);
            // An error handler may replace the image with text after the capture event.
            frame = window.requestAnimationFrame(() => {
                frame = undefined;
                measure();
            });
        };
        container.addEventListener("load", mediaChanged, true);
        container.addEventListener("error", mediaChanged, true);
        return () => {
            observer?.disconnect();
            container.removeEventListener("load", mediaChanged, true);
            container.removeEventListener("error", mediaChanged, true);
            if (frame !== undefined) window.cancelAnimationFrame(frame);
        };
    }, [geometry.width, items, columnWidth]);

    return (
        <div ref={containerRef} className={className ? `inspiration-gallery ${className}` : "inspiration-gallery"} role="list" aria-label={ariaLabel} aria-busy={busy} data-column-count={layout.columnCount} style={{ height: layout.height }}>
            {items.map((item, index) => {
                const id = catalogIdOf(item);
                const position = layout.positions[index];
                return (
                    <div
                        key={id}
                        className="inspiration-masonry-cell"
                        role="listitem"
                        data-inspiration-id={id}
                        ref={(element) => {
                            if (element) cells.current.set(id, element);
                            else cells.current.delete(id);
                        }}
                        style={{ width: geometry.width > 0 ? layout.columnWidth : "100%", left: position.left, top: position.top }}
                    >
                        {renderItem(item)}
                    </div>
                );
            })}
        </div>
    );
}
