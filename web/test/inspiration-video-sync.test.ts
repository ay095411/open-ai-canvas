import { afterEach, beforeEach, expect, test } from "bun:test";
import type { AxiosAdapter } from "axios";

import { buildOfficialCatalog, normalizeOfficialInspiration } from "@/lib/inspirations/official-catalog";
import { readInspirationVideoLinks } from "@/lib/inspirations/video-enrichment";
import { getInspirationPrompt } from "@/services/api/online-gallery";
import { getPublicInspirationFeed } from "@/services/api/inspiration-feed";
import { apiClient } from "@/services/api/request";
import { INSPIRATION_CATALOG_CACHE_TTL_MS, invalidateInspirationCatalog, loadInspirationCatalog, loadedInspirationCatalog } from "@/services/inspiration-catalog";

const originalFetch = globalThis.fetch;
const originalAdapter = apiClient.defaults.adapter;
const originalNow = Date.now;
const originalWarn = console.warn;
const original = normalizeOfficialInspiration({
    id: "seedance:case",
    sourceId: "seedance",
    title: "原始官方案例",
    description: "不替换固定目录的正文和封面",
    image: "https://cdn.example.com/original.jpg",
    mode: "video",
    prompt: "固定目录中文提示词。",
    credit: "原作者",
    sourceUrl: "https://x.com/author/status/123",
});
const staticLink = { id: original.id, sourceId: "seedance" as const, sourceUrl: original.sourceUrl!, videoUrl: "https://media.goodcase.ai/cases/static.mp4" };
const syncedLink = { ...staticLink, videoUrl: "https://media.goodcase.ai/cases/synced.mp4" };
const staticLinks = readInspirationVideoLinks({ version: 1, entries: [staticLink] });
const packs = [[original], [], []];
let now: number;
let warnings: unknown[][];

beforeEach(() => {
    invalidateInspirationCatalog();
    now = originalNow();
    Date.now = () => now;
    warnings = [];
    console.warn = (...args) => warnings.push(args);
});

afterEach(() => {
    invalidateInspirationCatalog();
    globalThis.fetch = originalFetch;
    apiClient.defaults.adapter = originalAdapter;
    Date.now = originalNow;
    console.warn = originalWarn;
});

function dynamicFeed(entries: unknown[] = [syncedLink]) {
    return { enabled: true, entries: [], videoLinks: { version: 1 as const, entries, syncedAt: "2026-11-24T04:00:00Z" } };
}

function installCatalog(initialFeed: unknown = dynamicFeed(), supplementStatus = 200) {
    let feed = initialFeed;
    let apiRequests = 0;
    const staticRequests: string[] = [];
    globalThis.fetch = (async (input) => {
        const url = String(input);
        staticRequests.push(url);
        if (url === "/inspiration-video-urls.json") return Response.json({ version: 1, entries: [staticLink] }, { status: supplementStatus });
        if (url === "/inspirations/manifest.json") return Response.json({ sources: {} });
        if (!["/inspirations/seedance.json", "/inspirations/haohaoxue.json", "/inspirations/youmind.json"].includes(url)) throw new Error(`Unexpected test request: ${url}`);
        return Response.json({ entries: url.includes("/seedance.json") ? [original] : [] });
    }) as typeof globalThis.fetch;
    apiClient.defaults.adapter = async (config) => {
        apiRequests += 1;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: feed, msg: "ok" } };
    };
    return {
        staticRequests,
        get apiRequests() {
            return apiRequests;
        },
        setFeed(value: unknown) {
            feed = value;
        },
    };
}

test("定时同步视频补充已在固定目录中的ID，正文封面署名不被Feed重复条目替换", () => {
    const feed = { ...dynamicFeed(), entries: [{ ...original, prompt: "不应替换的上新正文", videoUrl: "https://cdn.example.com/duplicate.mp4" }] };
    const plain = buildOfficialCatalog(packs);
    const catalog = buildOfficialCatalog(packs, {}, feed as Parameters<typeof buildOfficialCatalog>[2], staticLinks);
    expect(catalog.entries).toHaveLength(plain.entries.length);
    const { videoUrl, ...entry } = catalog.entries.find((item) => item.id === original.id)!;
    expect(videoUrl).toBe(syncedLink.videoUrl);
    expect(entry).toEqual(original);
});

test("新上新条目可得到动态地址，但单独未知映射ID不会凭空新增目录", () => {
    const addition = { ...original, id: "seedance:new", title: "新的官方案例" };
    const newLink = { ...syncedLink, id: addition.id };
    const feed = { ...dynamicFeed([syncedLink, newLink, { ...syncedLink, id: "seedance:not-in-catalog" }]), entries: [addition] };
    const catalog = buildOfficialCatalog(packs, {}, feed as Parameters<typeof buildOfficialCatalog>[2], staticLinks);
    expect(catalog.entries).toHaveLength(buildOfficialCatalog(packs).entries.length + 1);
    expect(catalog.entries.find((item) => item.id === addition.id)?.videoUrl).toBe(newLink.videoUrl);
    expect(catalog.entries.some((item) => item.id === "seedance:not-in-catalog")).toBe(false);
});

test("动态相同ID但出处不同，仍保留该官方案例的静态视频地址", () => {
    const feed = dynamicFeed([{ ...syncedLink, sourceUrl: "https://x.com/other-author/status/123" }]);
    expect(buildOfficialCatalog(packs, {}, feed as Parameters<typeof buildOfficialCatalog>[2], staticLinks).entries[0].videoUrl).toBe(staticLink.videoUrl);
});

test("关闭上新、旧后端缺少视频字段或动态版本损坏都保留静态补充地址", () => {
    for (const feed of [
        { ...dynamicFeed(), enabled: false },
        { enabled: true, entries: [] },
        { ...dynamicFeed(), videoLinks: { version: 2, entries: [syncedLink] } },
    ]) {
        const catalog = buildOfficialCatalog(packs, {}, feed as Parameters<typeof buildOfficialCatalog>[2], staticLinks);
        expect(catalog.entries[0].videoUrl).toBe(staticLink.videoUrl);
    }
});

test("非法签名/未知主机/审核身份与冲突映射不会遮掉已有静态地址", () => {
    for (const entries of [
        [{ ...syncedLink, videoUrl: `${syncedLink.videoUrl}?signature=expired` }],
        [{ ...syncedLink, videoUrl: "https://unknown.test/video.mp4" }],
        [{ ...syncedLink, sourceId: "authorized-library" }],
        [syncedLink, { ...syncedLink, videoUrl: "https://media.goodcase.ai/cases/conflict.mp4" }],
    ]) {
        const catalog = buildOfficialCatalog(packs, {}, dynamicFeed(entries) as Parameters<typeof buildOfficialCatalog>[2], staticLinks);
        expect(catalog.entries[0].videoUrl).toBe(staticLink.videoUrl);
    }
});

test("条目本身已有视频地址优先于两份补充，图片和审核库不混入动态视频", () => {
    const withVideo = { ...original, videoUrl: "https://cdn.example.com/original-video.mp4" };
    const withImage = { ...original, mode: "image" as const };
    for (const item of [withVideo, withImage]) {
        const catalog = buildOfficialCatalog([[item], [], []], {}, dynamicFeed() as Parameters<typeof buildOfficialCatalog>[2], staticLinks);
        expect(catalog.entries[0].videoUrl).toBe(item.videoUrl);
    }
});

test("公共API只降级坏视频元数据并告警，不丢合法提示词Feed", async () => {
    installCatalog({ ...dynamicFeed(), entries: [{ ...original, id: "seedance:new" }], videoLinks: { version: 2, entries: [syncedLink] } });
    const feed = await getPublicInspirationFeed();
    expect(feed.enabled).toBe(true);
    expect(feed.entries).toHaveLength(1);
    expect(feed.videoLinks).toBeUndefined();
    expect(warnings.some((args) => String(args[0]).includes("同步数据无效"))).toBe(true);
    expect((await getInspirationPrompt(original.id)).videoUrl).toBe(staticLink.videoUrl);
});

test("公共API归一化合法动态行、丢弃非法行并记录准确数量", async () => {
    installCatalog(dynamicFeed([syncedLink, { ...syncedLink, id: "seedance:bad", videoUrl: "https://127.0.0.1/cases/video.mp4" }]));
    const feed = await getPublicInspirationFeed();
    expect(feed.videoLinks).toEqual({ version: 1, entries: [syncedLink], syncedAt: "2026-11-24T04:00:00Z" });
    expect(warnings.some((args) => String(args[0]).includes("1 条无效地址"))).toBe(true);
});

test("旧后端或关闭Feed不会让同步视频暴露，静态基础保持可用", async () => {
    for (const feed of [
        { enabled: true, entries: [] },
        { ...dynamicFeed(), enabled: false },
    ]) {
        invalidateInspirationCatalog();
        installCatalog(feed);
        expect((await getPublicInspirationFeed()).videoLinks).toBeUndefined();
        expect((await getInspirationPrompt(original.id)).videoUrl).toBe(staticLink.videoUrl);
    }
});

test("静态视频JSON404时仍可使用同一次Feed提供的动态真实地址", async () => {
    installCatalog(dynamicFeed(), 404);
    expect((await getInspirationPrompt(original.id)).videoUrl).toBe(syncedLink.videoUrl);
    expect(warnings.some((args) => String(args[0]).includes("视频地址暂不可用"))).toBe(true);
});

test("五分钟内详情复用缓存，TTL到期并发只重读一轮并获得最新同步地址", async () => {
    const requests = installCatalog();
    const firstRequest = loadInspirationCatalog();
    expect(loadInspirationCatalog()).toBe(firstRequest);
    const first = await firstRequest;
    expect(first.entries[0].videoUrl).toBe(syncedLink.videoUrl);
    expect(requests.apiRequests).toBe(1);
    now += INSPIRATION_CATALOG_CACHE_TTL_MS - 1;
    requests.setFeed(dynamicFeed([{ ...syncedLink, videoUrl: "https://media.goodcase.ai/cases/synced-v2.mp4" }]));
    expect(await loadInspirationCatalog()).toBe(first);
    expect((await getInspirationPrompt(original.id)).videoUrl).toBe(syncedLink.videoUrl);
    expect(requests.apiRequests).toBe(1);
    now += 1;
    expect(loadedInspirationCatalog()).toBeNull();
    const nextRequest = loadInspirationCatalog();
    expect(loadInspirationCatalog()).toBe(nextRequest);
    const next = await nextRequest;
    expect(next.entries[0].videoUrl).toBe("https://media.goodcase.ai/cases/synced-v2.mp4");
    expect(loadedInspirationCatalog()).toBe(next);
    expect(requests.apiRequests).toBe(2);
    expect(requests.staticRequests.filter((url) => url === "/inspiration-video-urls.json")).toHaveLength(2);
});

test("缓存到期Feed网络失败时保留静态视频，之后到期仍可重试新同步数据", async () => {
    const requests = installCatalog();
    await loadInspirationCatalog();
    now += INSPIRATION_CATALOG_CACHE_TTL_MS;
    apiClient.defaults.adapter = async () => {
        throw new Error("feed temporarily unavailable");
    };
    expect((await getInspirationPrompt(original.id)).videoUrl).toBe(staticLink.videoUrl);
    now += INSPIRATION_CATALOG_CACHE_TTL_MS;
    installCatalog(dynamicFeed([{ ...syncedLink, videoUrl: "https://media.goodcase.ai/cases/recovered.mp4" }]));
    expect((await getInspirationPrompt(original.id)).videoUrl).toBe("https://media.goodcase.ai/cases/recovered.mp4");
    expect(requests.apiRequests).toBe(1);
});

test("invalidate后的旧成功响应不能覆写新版loaded或清掉新版pending", async () => {
    installCatalog();
    let oldStarted = () => {};
    let releaseOld = () => {};
    let releaseNew = () => {};
    const began = new Promise<void>((resolve) => {
        oldStarted = resolve;
    });
    const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve;
    });
    const newGate = new Promise<void>((resolve) => {
        releaseNew = resolve;
    });
    let calls = 0;
    apiClient.defaults.adapter = async (config) => {
        calls += 1;
        const old = calls === 1;
        if (old) oldStarted();
        await (old ? oldGate : newGate);
        const videoUrl = old ? syncedLink.videoUrl : "https://media.goodcase.ai/cases/new-generation.mp4";
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: dynamicFeed([{ ...syncedLink, videoUrl }]), msg: "ok" } };
    };
    try {
        const oldRequest = loadInspirationCatalog();
        await began;
        invalidateInspirationCatalog();
        const nextRequest = loadInspirationCatalog();
        releaseOld();
        expect((await oldRequest).entries[0].videoUrl).toBe(syncedLink.videoUrl);
        expect(loadedInspirationCatalog()).toBeNull();
        expect(loadInspirationCatalog()).toBe(nextRequest);
        releaseNew();
        const next = await nextRequest;
        expect(next.entries[0].videoUrl).toBe("https://media.goodcase.ai/cases/new-generation.mp4");
        expect(loadedInspirationCatalog()).toBe(next);
        expect(await loadInspirationCatalog()).toBe(next);
        expect(calls).toBe(2);
    } finally {
        releaseOld();
        releaseNew();
    }
});

test("invalidate后的旧失败不能清掉正在加载的新版pending", async () => {
    installCatalog();
    const fetcher = globalThis.fetch;
    let oldStarted = () => {};
    let releaseOld = () => {};
    let releaseNew = () => {};
    const began = new Promise<void>((resolve) => {
        oldStarted = resolve;
    });
    const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve;
    });
    const newGate = new Promise<void>((resolve) => {
        releaseNew = resolve;
    });
    let seedanceRequests = 0;
    globalThis.fetch = (async (input, init) => {
        if (String(input) === "/inspirations/seedance.json") {
            seedanceRequests += 1;
            if (seedanceRequests === 1) {
                oldStarted();
                await oldGate;
                return new Response("unavailable", { status: 503 });
            }
            await newGate;
        }
        return fetcher(input, init);
    }) as typeof globalThis.fetch;
    try {
        const oldRequest = loadInspirationCatalog();
        const oldFailure = oldRequest.catch((error: Error) => error);
        await began;
        invalidateInspirationCatalog();
        const nextRequest = loadInspirationCatalog();
        releaseOld();
        expect(await oldFailure).toBeInstanceOf(Error);
        expect(loadInspirationCatalog()).toBe(nextRequest);
        releaseNew();
        const next = await nextRequest;
        expect(next.entries[0].videoUrl).toBe(syncedLink.videoUrl);
        expect(loadedInspirationCatalog()).toBe(next);
        expect(seedanceRequests).toBe(2);
    } finally {
        releaseOld();
        releaseNew();
    }
});

test("等待动态同步时调用方取消仍为AbortError，不中断共享目录或迟到写成功", async () => {
    installCatalog();
    const adapter = apiClient.defaults.adapter as AxiosAdapter;
    let started = () => {};
    let release = () => {};
    const began = new Promise<void>((resolve) => {
        started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        started();
        await gate;
        return adapter(config);
    };
    try {
        const controller = new AbortController();
        const request = getInspirationPrompt(original.id, controller.signal);
        const shared = loadInspirationCatalog();
        await began;
        controller.abort(new DOMException("Canceled sync read", "AbortError"));
        await expect(request).rejects.toMatchObject({ name: "AbortError" });
        release();
        expect((await shared).entries[0].videoUrl).toBe(syncedLink.videoUrl);
    } finally {
        release();
    }
});

test("系统时钟回退不会让过期目录永久缓存", async () => {
    const requests = installCatalog();
    await loadInspirationCatalog();
    now -= 1;
    expect(loadedInspirationCatalog()).toBeNull();
    await loadInspirationCatalog();
    expect(requests.apiRequests).toBe(2);
});
