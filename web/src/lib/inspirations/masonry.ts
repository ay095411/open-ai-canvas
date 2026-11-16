import type { CreationInspiration } from "./catalog";

export type InspirationMasonryLayout = {
    columnCount: number;
    columnWidth: number;
    height: number;
    positions: Array<{ left: number; top: number; column: number }>;
};

function positiveRatio(width: unknown, height: unknown): number | undefined {
    if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    const ratio = width / height;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

/** 这是固定展示框比例，不根据远程图片加载结果改变占位或伪造媒体尺寸。 */
export function inspirationCoverRatio(item: Pick<CreationInspiration, "width" | "height" | "ratio" | "mode">): number {
    const dimensions = positiveRatio(item.width, item.height);
    if (dimensions !== undefined) return dimensions;
    const parts = typeof item.ratio === "string" ? /^\s*(\d*\.?\d+)\s*[:/]\s*(\d*\.?\d+)\s*$/.exec(item.ratio) : null;
    const ratio = parts ? positiveRatio(Number(parts[1]), Number(parts[2])) : undefined;
    return ratio ?? (item.mode === "video" ? 16 / 9 : 1);
}

function nonnegative(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function addSize(first: number, second: number): number {
    const next = first + second;
    return Number.isFinite(next) ? next : Number.MAX_VALUE;
}

/** 按输入顺序放入最短列；固定容器与旧卡高度下，追加不会改变任何前缀坐标。 */
export function layoutInspirationMasonry(heights: readonly number[], width: number, minColumnWidth: number, gap: number): InspirationMasonryLayout {
    const availableWidth = nonnegative(width);
    const spacing = nonnegative(gap);
    const minimum = nonnegative(minColumnWidth) || availableWidth || 1;
    const proposedCount = Math.floor((availableWidth + spacing) / (minimum + spacing));
    // 非法几何归零；不可表示的列数退回单列，避免 NaN 和异常数组分配。
    const columnCount = Number.isSafeInteger(proposedCount) && proposedCount > 0 ? proposedCount : 1;
    const columnWidth = Math.max(0, (availableWidth - (columnCount - 1) * spacing) / columnCount);
    const cursors = Array.from({ length: Math.min(columnCount, heights.length) }, () => 0);
    let height = 0;
    const positions = heights.map((cardHeight) => {
        let column = 0;
        for (let candidate = 1; candidate < cursors.length; candidate += 1) {
            if (cursors[candidate] < cursors[column]) column = candidate;
        }
        const top = cursors[column];
        const bottom = addSize(top, nonnegative(cardHeight));
        height = Math.max(height, bottom);
        cursors[column] = addSize(bottom, spacing);
        return { left: column * addSize(columnWidth, spacing), top, column };
    });
    return { columnCount, columnWidth, height, positions };
}
