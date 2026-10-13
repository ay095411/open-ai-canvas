import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { creationFeaturedWorks, inspirationSource } from "../src/pages/create/creation-inspirations";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("curated creation inspirations", () => {
    test("all templates have unique titles, usable prompts and local cover assets", () => {
        expect(creationFeaturedWorks.length).toBe(22);
        expect(new Set(creationFeaturedWorks.map((item) => item.title)).size).toBe(22);
        for (const item of creationFeaturedWorks) {
            expect(["image", "video", "text"]).toContain(item.mode);
            expect(item.prompt.length).toBeGreaterThan(35);
            expect(existsSync(resolve(import.meta.dir, "../public", item.image.slice(1)))).toBe(true);
        }
    });
    test("adapted prompts retain provenance and the data license", () => {
        expect(creationFeaturedWorks.filter((item) => item.source).length).toBe(8);
        expect(inspirationSource.license).toBe("CC0-1.0");
        expect(inspirationSource.revision).toMatch(/^[a-f0-9]{40}$/);
        expect(inspirationSource.notice).toContain("不代表实际生成结果");
    });
});

describe("首页瀑布流与灵感库页同源", () => {
    /**
     * 这两处以前读的是两份不同的数据：首页走 `gallery-pool.json`（329 条精选池），
     * 灵感库页走全量目录 + 用户叠加层。结果是「在库里收藏 / 隐藏了，首页没反应」、
     * 两边条数对不上。现在必须是同一个加载器 + 同一套合成规则。
     */
    test("waterfall loads the full catalog through the shared loader", () => {
        const waterfall = source("pages/create/creation-inspiration-waterfall.tsx");
        expect(waterfall).toContain("loadInspirationCatalog");
        expect(waterfall).toContain("resolveInspirations");
        // 叠加层三个集合都要接上，少一个就会出现「隐藏了还在」。
        expect(waterfall).toContain("useInspirationStore");
        expect(waterfall).toContain("custom");
        expect(waterfall).toContain("overrides");
        expect(waterfall).toContain("hidden");
        // 精选池与它那份只有首页在用的专用译名表都该退场（注释里提到旧方案不算）。
        expect(waterfall).not.toContain("loadGalleryPool");
        expect(waterfall).not.toContain("loadInspirationCategoryLabels");
    });

    test("the catalog service exposes one loader and no gallery pool", () => {
        const catalog = source("services/inspiration-catalog.ts");
        expect(catalog).toContain("export function loadInspirationCatalog");
        expect(catalog).toContain("export function categoryLabelsOf");
        expect(catalog).not.toContain("gallery-pool");
        expect(catalog).not.toContain("loadGalleryPool");
        // 译名表跟随目录一起回来，别再单独拉一次 manifest。
        expect(catalog).not.toContain("loadInspirationCategoryLabels");
        // 灵感库页用的也是这一个加载器。
        expect(source("pages/inspirations/index.tsx")).toContain("loadInspirationCatalog");
    });
});
