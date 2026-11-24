import { afterAll, afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { Window } from "happy-dom";

if (process.env.INSPIRATION_DETAIL_MEDIA_CHILD !== "1") {
    test("灵感视频媒体的真实 React 播放器、失败反馈和来源变化", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/inspiration-detail-media.test.tsx"], {
            cwd: resolve(import.meta.dir, ".."),
            env: { ...process.env, INSPIRATION_DETAIL_MEDIA_CHILD: "1" },
            timeout: 60_000,
        });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("0 fail");
        expect(output).toMatch(/\b[1-9]\d* pass\b/);
    }, 65_000);
} else {
    const dom = new Window({ url: "http://localhost/create" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        HTMLBodyElement: dom.HTMLBodyElement,
        HTMLInputElement: dom.HTMLInputElement,
        Element: dom.Element,
        Node: dom.Node,
        SVGElement: dom.SVGElement,
        ShadowRoot: dom.ShadowRoot,
        ResizeObserver: dom.ResizeObserver,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        localStorage: dom.localStorage,
        sessionStorage: dom.sessionStorage,
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { InspirationDetailMedia } = await import("@/pages/inspirations/inspiration-detail-media");
    const { InspirationDetailContent } = await import("@/pages/inspirations/inspiration-detail-modal");
    const { CreationShowcaseCard } = await import("@/pages/create/creation-showcase-card");
    const item = {
        id: "seedance:media-case",
        sourceId: "seedance" as const,
        title: "官方视频案例",
        image: "https://media.goodcase.ai/cases/cover.jpg",
        width: 640,
        height: 960,
        description: "视频提示词描述",
        prompt: "完整视频提示词。",
        mode: "video" as const,
        sourceUrl: "https://goodcase.ai/cases/media-case",
        model: "",
        slug: "media-case",
        galleryUrl: "https://goodcase.ai/cases/media-case",
    };
    const videoUrl = "https://media.goodcase.ai/media/video/media-case.mp4";
    let mounted: Awaited<ReturnType<typeof mount>> | undefined;

    async function mount(content: ReactElement) {
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host);
        await act(async () => root.render(content));
        return { host, root };
    }
    async function fail(video: HTMLVideoElement, code: number | null) {
        Object.defineProperty(video, "error", { configurable: true, value: code === null ? null : { code, message: "Simulated browser media failure" } });
        await act(async () => video.dispatchEvent(new dom.Event("error")));
    }
    afterEach(async () => {
        if (mounted) {
            const current = mounted;
            mounted = undefined;
            await act(async () => current.root.unmount());
            current.host.remove();
        }
    });
    afterAll(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        dom.happyDOM.abort();
    });

    test("有视频地址使用原生手动播放器，不声称自动播放或增加跨域绕过", async () => {
        mounted = await mount(<InspirationDetailMedia item={item} videoUrl={videoUrl} />);
        const video = mounted.host.querySelector("video")!;
        expect(video.getAttribute("src")).toBe(videoUrl);
        expect(video.controls).toBe(true);
        expect(video.getAttribute("preload")).toBe("metadata");
        expect(video.hasAttribute("playsinline")).toBe(true);
        expect(video.hasAttribute("autoplay")).toBe(false);
        expect(video.hasAttribute("crossorigin")).toBe(false);
        expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
    });

    test("无视频地址保留自然比例封面并明确只有提示词，只提示右侧原页而不重复链接", async () => {
        mounted = await mount(<InspirationDetailMedia item={item} />);
        expect(mounted.host.querySelector("video")).toBeNull();
        const image = mounted.host.querySelector("img")!;
        expect(image.getAttribute("src")).toBe(item.image);
        expect(image.getAttribute("width")).toBe("640");
        expect(image.getAttribute("height")).toBe("960");
        expect(image.style.height).toBe("");
        expect(image.style.aspectRatio).toBe("");
        expect(mounted.host.querySelector('[role="status"]')?.textContent).toContain("未提供可播放的视频地址");
        expect(mounted.host.querySelectorAll("a")).toHaveLength(0);
        expect(mounted.host.textContent).toContain("右侧“原页”");
    });

    test("图片条目不误报缺少视频地址，无原出处时不伪造链接", async () => {
        mounted = await mount(<InspirationDetailMedia item={{ ...item, mode: "image", sourceUrl: undefined }} />);
        expect(mounted.host.querySelector("img")).not.toBeNull();
        expect(mounted.host.querySelector('[role="status"]')).toBeNull();
        expect(mounted.host.querySelector("a")).toBeNull();
    });

    test.each([
        [1, "媒体请求已中止"],
        [2, "网络读取失败"],
        [3, "浏览器无法解码视频"],
        [4, "视频地址或格式不可用"],
        [null, "浏览器未能加载视频"],
    ] as const)("浏览器媒体错误 %s 明确反馈实际错误并回退封面", async (code, message) => {
        mounted = await mount(<InspirationDetailMedia item={item} videoUrl={videoUrl} />);
        await fail(mounted.host.querySelector("video")!, code);
        expect(mounted.host.querySelector("video")).toBeNull();
        expect(mounted.host.querySelector("img")?.getAttribute("src")).toBe(item.image);
        expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(message);
        expect(mounted.host.querySelectorAll("a")).toHaveLength(0);
        expect(mounted.host.textContent).toContain("右侧“原页”");
        expect(mounted.host.textContent).not.toContain("Simulated browser media failure");
    });

    test("重新加载创建新播放器，但不把重新请求当作播放成功", async () => {
        mounted = await mount(<InspirationDetailMedia item={item} videoUrl={videoUrl} />);
        const oldVideo = mounted.host.querySelector("video")!;
        await fail(oldVideo, 2);
        const retry = [...mounted.host.querySelectorAll("button")].find((button) => button.textContent?.includes("重新加载视频"))!;
        await act(async () => retry.click());
        const currentVideo = mounted.host.querySelector("video")!;
        expect(currentVideo).not.toBe(oldVideo);
        expect(currentVideo.getAttribute("src")).toBe(videoUrl);
        expect(currentVideo.hasAttribute("autoplay")).toBe(false);
        expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
    });

    test("实际详情入口切换视频地址时重置旧错误，正文与来源不会被视频失败删除", async () => {
        const props = { onClose: () => {}, onUse: () => {}, onCopy: () => {} };
        mounted = await mount(<InspirationDetailContent item={{ ...item, videoUrl }} {...props} />);
        await fail(mounted.host.querySelector("video")!, 3);
        expect(mounted.host.textContent).toContain(item.prompt);
        expect(mounted.host.textContent).toContain(item.title);
        const replacement = `${videoUrl}?revision=2`;
        await act(async () => mounted!.root.render(<InspirationDetailContent item={{ ...item, videoUrl: replacement }} {...props} />));
        expect(mounted.host.querySelector("video")?.getAttribute("src")).toBe(replacement);
        expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
        expect(mounted.host.textContent).toContain(item.prompt);
    });

    test("首页无地址仅标视频提示词，有真实地址才保留示例片段与悬停播放器", async () => {
        const props = { onPreview: () => {}, disabled: false, reducedMotion: false };
        mounted = await mount(<CreationShowcaseCard entry={item} {...props} />);
        expect(mounted.host.querySelector("video")).toBeNull();
        expect(mounted.host.querySelector(".creation-showcase-badge")?.textContent).toContain("视频提示词");
        expect(mounted.host.textContent).not.toContain("示例片段");
        await act(async () => mounted!.root.render(<CreationShowcaseCard entry={{ ...item, videoUrl }} {...props} />));
        expect(mounted.host.querySelector("video")?.getAttribute("src")).toBe(videoUrl);
        expect(mounted.host.querySelector(".creation-showcase-badge")?.textContent).toContain("示例片段");
    });
}
