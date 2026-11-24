import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFICIAL_INSPIRATION_REF, curatedInspirations } from "@/lib/inspirations/catalog";
import { buildOfficialCatalog, filterOfficialCatalog, normalizeOfficialInspiration, pageOfficialCatalog, readOfficialCatalogPack, type OfficialCatalogFeed } from "@/lib/inspirations/official-catalog";
import { getInspirationGalleryPrompts, getInspirationPrompt, getOnlineGalleryFacets } from "@/services/api/online-gallery";
import { apiClient } from "@/services/api/request";
import { invalidateInspirationCatalog } from "@/services/inspiration-catalog";

const sources = ["seedance", "haohaoxue", "youmind"] as const;
const payloads = sources.map((source) => JSON.parse(readFileSync(new URL(`../public/inspirations/${source}.json`, import.meta.url), "utf8")));
const manifest = JSON.parse(readFileSync(new URL("../public/inspirations/manifest.json", import.meta.url), "utf8"));
const packs = sources.map((source, index) => readOfficialCatalogPack(payloads[index], source, source));
const adapter = apiClient.defaults.adapter;
const fetch = globalThis.fetch;
afterEach(() => {
    apiClient.defaults.adapter = adapter;
    globalThis.fetch = fetch;
    invalidateInspirationCatalog();
});

test("官方精确提交的三静态目录与22模板组成1341条，来源与完整正文不被改名", () => {
    expect(OFFICIAL_INSPIRATION_REF).toBe("c8262a2594277f1d75fe300e5aeac698ee8bdb6e");
    expect(packs.map((pack) => pack.length)).toEqual([767, 297, 255]);
    expect(curatedInspirations).toHaveLength(22);
    const catalog = buildOfficialCatalog(packs, manifest);
    expect(catalog.entries).toHaveLength(1341);
    expect(catalog.entries.every((item) => item.prompt.trim() && item.id.startsWith(`${item.sourceId}:`) && !item.authorization)).toBe(true);
    expect(filterOfficialCatalog(catalog, { sourceId: "chatgpt-prompts", mediaType: "text" })).toHaveLength(8);
    expect(new Set(catalog.entries.map((item) => item.id)).size).toBe(1341);
});

test("静态目录优先、feed去重且只增加Seedance/YouMind，不把关闭或错来源当数据", () => {
    const duplicate = { ...packs[0][0], prompt: "FORGED UPSTREAM REPLACEMENT" };
    const addition = { ...packs[2][0], id: "youmind:official-feed-new", title: "新增案例", image: "https://cdn.example.com/new.webp", prompt: "新增完整提示词" };
    const feed: OfficialCatalogFeed = { enabled: true, entries: [duplicate, addition, addition, { ...addition, id: "haohaoxue:unexpected", sourceId: "haohaoxue" }] };
    const merged = buildOfficialCatalog(packs, manifest, feed);
    expect(merged.entries).toHaveLength(1342);
    expect(merged.entries.find((item) => item.id === duplicate.id)?.prompt).toBe(packs[0][0].prompt);
    expect(merged.entries.find((item) => item.id === addition.id)?.sourceId).toBe("youmind");
    expect(buildOfficialCatalog(packs, manifest, { ...feed, enabled: false }).entries).toHaveLength(1341);
    expect(() => normalizeOfficialInspiration({ ...addition, authorization: { policyVersion: "licensed-v1" } })).toThrow("审核授权");
});

test("全量本地筛选与游标分页不重复，正文只用于详情不参与摘要搜索", () => {
    const catalog = buildOfficialCatalog(packs, manifest);
    const first = pageOfficialCatalog(catalog, { sourceId: "seedance", limit: 24 });
    const second = pageOfficialCatalog(catalog, { sourceId: "seedance", limit: 24, cursor: first.nextCursor });
    expect(first.total).toBe(767);
    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(24);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(48);
    expect(() => pageOfficialCatalog(catalog, { cursor: "https://legacy.example" })).toThrow("游标");
    expect(() => pageOfficialCatalog(catalog, { limit: 0 })).toThrow("分页数量");
});

test("真实静态加载、详情与facets只读官方文件；feed失败仍1341条且无ZZAI/授权库替代请求", async () => {
    const urls: string[] = [];
    const apiUrls: string[] = [];
    globalThis.fetch = (async (input) => {
        const url = String(input);
        urls.push(url);
        if (url === "/inspiration-video-urls.json") return new Response(JSON.stringify({ version: 1, entries: [] }), { status: 200 });
        const index = sources.findIndex((source) => url === `/inspirations/${source}.json`);
        return new Response(JSON.stringify(index >= 0 ? payloads[index] : manifest), { status: 200 });
    }) as typeof globalThis.fetch;
    apiClient.defaults.adapter = async (config) => {
        apiUrls.push(config.url!);
        throw new Error("feed temporarily unavailable");
    };
    const page = await getInspirationGalleryPrompts("official-catalog", { limit: 24 });
    expect(page.total).toBe(1341);
    const detail = await getInspirationPrompt(packs[0][0].id);
    expect(detail.prompt).toBe(packs[0][0].prompt);
    expect(detail.sourceId).toBe("seedance");
    expect((await getOnlineGalleryFacets("text")).total).toBe(9);
    expect(urls.sort()).toEqual(["/inspiration-video-urls.json", "/inspirations/haohaoxue.json", "/inspirations/manifest.json", "/inspirations/seedance.json", "/inspirations/youmind.json"]);
    expect(apiUrls).toEqual(["/public/inspirations/feed"]);
    expect(() => getInspirationPrompt("zzai-gallery:legacy")).toThrow("停用");
    expect(apiUrls).toEqual(["/public/inspirations/feed"]);
});
