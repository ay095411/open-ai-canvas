import { describe, expect, test } from "bun:test";

import { inspirationCoverRatio, layoutInspirationMasonry } from "@/lib/inspirations/masonry";

describe("inspiration cover presentation ratio", () => {
    test("positive finite dimensions take precedence over ratio labels and media fallbacks", () => {
        expect(inspirationCoverRatio({ width: 768, height: 1024, ratio: "16:9", mode: "video" })).toBe(3 / 4);
        expect(inspirationCoverRatio({ width: 1920, height: 1080, mode: "image" })).toBe(16 / 9);
    });

    test("valid colon and slash ratios support whitespace and decimal dimensions", () => {
        for (const ratio of ["4:3", " 4 / 3 ", "1.5:1.125", ".5 / .375"]) expect(inspirationCoverRatio({ ratio, mode: "image" })).toBe(4 / 3);
        expect(inspirationCoverRatio({ width: 0, height: 1024, ratio: "9:16", mode: "image" })).toBe(9 / 16);
    });

    test("missing and invalid dimensions or labels use stable media-specific display boxes", () => {
        for (const ratio of [undefined, "", "0:9", "16:0", "-4:3", "Infinity:9", "NaN/1", "4:3:2", "4/3px", "1e3:2e3"]) {
            expect(inspirationCoverRatio({ ratio, mode: "image" })).toBe(1);
            expect(inspirationCoverRatio({ width: Number.NaN, height: -1, ratio, mode: "video" })).toBe(16 / 9);
        }
        expect(inspirationCoverRatio({ width: Number.POSITIVE_INFINITY, height: 1, ratio: "2:1", mode: "image" })).toBe(2);
        expect(inspirationCoverRatio({ width: Number.MAX_VALUE, height: Number.MIN_VALUE, mode: "image" })).toBe(1);
    });
});

describe("stable inspiration masonry geometry", () => {
    test("places cards into the shortest column with leftmost tie-breaking and no trailing gap", () => {
        expect(layoutInspirationMasonry([100, 60, 80, 90, 50], 800, 248, 16)).toEqual({
            columnCount: 3,
            columnWidth: 256,
            height: 166,
            positions: [
                { left: 0, top: 0, column: 0 },
                { left: 272, top: 0, column: 1 },
                { left: 544, top: 0, column: 2 },
                { left: 272, top: 76, column: 1 },
                { left: 544, top: 96, column: 2 },
            ],
        });
    });

    test("multiple appended pages never move previous cards or change the column count", () => {
        const pages = [[100, 60], [80, 90, 50], [120, 35, 76, 42], Array.from({ length: 24 }, (_, index) => 50 + ((index * 31) % 180))];
        let heights: number[] = [];
        let previous = layoutInspirationMasonry(heights, 800, 248, 16);
        for (const page of pages) {
            heights = [...heights, ...page];
            const next = layoutInspirationMasonry(heights, 800, 248, 16);
            expect(next.columnCount).toBe(3);
            expect(next.columnWidth).toBe(previous.columnWidth);
            expect(next.positions.slice(0, previous.positions.length)).toEqual(previous.positions);
            expect(next.height).toBeGreaterThanOrEqual(previous.height);
            previous = next;
        }
    });

    test("container resizing intentionally recalculates columns and keeps every card inside its width", () => {
        const heights = [100, 60, 80, 90, 50];
        const narrow = layoutInspirationMasonry(heights, 528, 248, 16);
        const wide = layoutInspirationMasonry(heights, 800, 248, 16);
        expect(narrow.columnCount).toBe(2);
        expect(wide.columnCount).toBe(3);
        expect(narrow.positions[2]).toEqual({ left: 272, top: 76, column: 1 });
        expect(wide.positions[2]).toEqual({ left: 544, top: 0, column: 2 });
        for (const width of [120, 248, 527, 528, 800, 1200]) {
            const result = layoutInspirationMasonry(heights, width, 248, 16);
            expect(result.columnCount).toBeGreaterThanOrEqual(1);
            for (const position of result.positions) expect(position.left + result.columnWidth).toBeLessThanOrEqual(width + 1e-8);
        }
    });

    test("empty feeds keep container-derived geometry without allocating placeholder cards", () => {
        expect(layoutInspirationMasonry([], 800, 248, 16)).toEqual({ columnCount: 3, columnWidth: 256, height: 0, positions: [] });
        expect(layoutInspirationMasonry([], 0, 248, 16)).toEqual({ columnCount: 1, columnWidth: 0, height: 0, positions: [] });
    });

    test("invalid heights and gap safely become zero and invalid minimum widths use one column", () => {
        expect(layoutInspirationMasonry([100, Number.NaN, -20, Number.POSITIVE_INFINITY, 50], 200, 0, -16)).toEqual({
            columnCount: 1,
            columnWidth: 200,
            height: 150,
            positions: [
                { left: 0, top: 0, column: 0 },
                { left: 0, top: 100, column: 0 },
                { left: 0, top: 100, column: 0 },
                { left: 0, top: 100, column: 0 },
                { left: 0, top: 100, column: 0 },
            ],
        });
        for (const minimum of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(layoutInspirationMasonry([50], 800, minimum, 16).columnCount).toBe(1);
    });

    test("invalid or extreme geometry never emits NaN, Infinity or negative coordinates", () => {
        for (const width of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
            for (const gap of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
                const result = layoutInspirationMasonry([0, Number.NaN, 10, Number.MAX_VALUE, Number.MAX_VALUE], width, 248, gap);
                for (const value of [result.columnCount, result.columnWidth, result.height, ...result.positions.flatMap(({ left, top, column }) => [left, top, column])]) {
                    expect(Number.isFinite(value)).toBe(true);
                    expect(value).toBeGreaterThanOrEqual(0);
                }
            }
        }
        expect(layoutInspirationMasonry([10], 800, Number.MIN_VALUE, 0).columnCount).toBe(1);
    });
});
