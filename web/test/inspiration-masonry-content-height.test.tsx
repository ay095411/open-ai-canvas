import { afterAll, afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Window } from "happy-dom";

if (process.env.INSPIRATION_MASONRY_CONTENT_HEIGHT_CHILD !== "1") {
    test("自然内容高度瀑布流的真实 React 测量、动态重排与分页前缀", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/inspiration-masonry-content-height.test.tsx"], {
            cwd: resolve(import.meta.dir, ".."),
            env: { ...process.env, INSPIRATION_MASONRY_CONTENT_HEIGHT_CHILD: "1" },
            timeout: 60_000,
        });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("0 fail");
        expect(output).toMatch(/\b[1-9]\d* pass\b/);
    }, 65_000);
} else {
    type Observation = { target: Element; contentRect: DOMRectReadOnly };
    const observers = new Set<ControlledResizeObserver>();
    class ControlledResizeObserver {
        readonly targets = new Set<Element>();
        constructor(readonly callback: (entries: Observation[]) => void) {
            observers.add(this);
        }
        observe(target: Element) {
            this.targets.add(target);
        }
        unobserve(target: Element) {
            this.targets.delete(target);
        }
        disconnect() {
            this.targets.clear();
            observers.delete(this);
        }
    }

    const dom = new Window({ url: "http://localhost/inspirations" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    let containerWidth = 800;
    let naturalOverrides = new WeakMap<Element, number>();
    const originalComputedStyle = dom.getComputedStyle.bind(dom);
    const computedStyle = (element: Element) => {
        const style = originalComputedStyle(element);
        return new Proxy(style, {
            get(target, property) {
                if (element.classList.contains("inspiration-gallery")) {
                    if (property === "width") return `${containerWidth}px`;
                    if (property === "columnGap") return "16px";
                    if (property === "getPropertyValue") return (name: string) => (name === "--inspiration-min-column-width" ? "248px" : target.getPropertyValue(name));
                }
                if (element.classList.contains("inspiration-masonry-cell")) {
                    if (property === "width") return (element as HTMLElement).style.width;
                    if (property === "height") return "auto";
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    };
    for (const [key, value] of Object.entries({
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        Element: dom.Element,
        Node: dom.Node,
        ResizeObserver: ControlledResizeObserver,
        getComputedStyle: computedStyle,
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }

    // Happy DOM has no pixel layout: natural child heights are controlled DOM
    // measurements, while the actual component owns observers, state and coordinates.
    const dimensions = new Map<string, PropertyDescriptor | undefined>();
    for (const property of ["clientWidth", "offsetWidth", "offsetHeight"]) dimensions.set(property, Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, property));
    const measuredHeight = (element: Element): number => {
        if (naturalOverrides.has(element)) return naturalOverrides.get(element)!;
        if (element.classList.contains("inspiration-masonry-cell")) return [...element.querySelectorAll<HTMLElement>("[data-natural-height]")].reduce((sum, child) => sum + measuredHeight(child), 0);
        const value = Number(element.getAttribute("data-natural-height") ?? 0);
        if (element.tagName === "IMG") {
            const width = Number.parseFloat(element.closest<HTMLElement>(".inspiration-masonry-cell")?.style.width ?? "256");
            return value * (width / 256);
        }
        return value;
    };
    Object.defineProperties(dom.HTMLElement.prototype, {
        clientWidth: {
            configurable: true,
            get(this: HTMLElement) {
                return this.classList.contains("inspiration-gallery") ? containerWidth : Number.parseFloat(this.style.width) || 0;
            },
        },
        offsetWidth: {
            configurable: true,
            get(this: HTMLElement) {
                return Number.parseFloat(this.style.width) || 0;
            },
        },
        offsetHeight: {
            configurable: true,
            get(this: HTMLElement) {
                return measuredHeight(this);
            },
        },
    });

    const { act, useState } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { InspirationMasonry } = await import("@/components/inspirations/inspiration-masonry");
    type Card = { id: string; sourceId: "original"; title: string; description: string; mode: "image"; imageHeight: number; titleHeight: number; descriptionHeight: number };
    const make = (id: string, imageHeight: number, titleHeight: number, descriptionHeight: number): Card => ({
        id: `original:${id}`,
        sourceId: "original",
        title: `自然标题 ${id}`,
        description: `完整描述 ${id}，随内容自然换行，不裁剪。`,
        mode: "image",
        imageHeight,
        titleHeight,
        descriptionHeight,
    });
    const baseCards = () => [make("short-image", 120, 24, 36), make("short-text", 80, 24, 56), make("long-content", 240, 56, 144), make("fourth", 60, 24, 16), make("fifth", 100, 24, 26), make("sixth", 20, 24, 16)];
    let mounted: Awaited<ReturnType<typeof mount>> | undefined;

    function NaturalCard({ item }: { item: Card }) {
        const [failed, setFailed] = useState(false);
        return (
            <article>
                {failed ? (
                    <div data-natural-height={48}>图片不可用，保留自然文本占位。</div>
                ) : (
                    <img src={`/controlled/${item.id}.webp`} alt={item.title} data-natural-height={item.imageHeight} style={{ width: "100%", height: "auto" }} onError={() => setFailed(true)} />
                )}
                <h3 data-natural-height={item.titleHeight}>{item.title}</h3>
                <p data-natural-height={item.descriptionHeight}>{item.description}</p>
            </article>
        );
    }

    async function settle() {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    async function mount(items: Card[]) {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const render = async (next: Card[]) => {
            await act(async () => root.render(<InspirationMasonry items={next} ariaLabel="自然内容高度测试作品" renderItem={(item) => <NaturalCard item={item} />} />));
            await settle();
        };
        await render(items);
        return {
            host,
            render,
            async dispose() {
                await act(async () => root.unmount());
                host.remove();
            },
        };
    }
    const container = () => mounted!.host.querySelector<HTMLElement>(".inspiration-gallery")!;
    const cells = () => [...mounted!.host.querySelectorAll<HTMLElement>(".inspiration-masonry-cell")];
    const positions = () => cells().map((cell) => ({ id: cell.dataset.inspirationId, left: Number.parseFloat(cell.style.left), top: Number.parseFloat(cell.style.top), width: Number.parseFloat(cell.style.width) }));
    function noOverlaps() {
        const columns = new Map<number, HTMLElement[]>();
        for (const cell of cells()) {
            const left = Number.parseFloat(cell.style.left);
            expect(left + Number.parseFloat(cell.style.width)).toBeLessThanOrEqual(containerWidth + 0.01);
            columns.set(left, [...(columns.get(left) ?? []), cell]);
        }
        for (const column of columns.values()) {
            column.sort((first, second) => Number.parseFloat(first.style.top) - Number.parseFloat(second.style.top));
            for (let index = 1; index < column.length; index += 1) expect(Number.parseFloat(column[index].style.top)).toBeGreaterThanOrEqual(Number.parseFloat(column[index - 1].style.top) + measuredHeight(column[index - 1]) + 16 - 0.01);
        }
        const maximumBottom = Math.max(0, ...cells().map((cell) => Number.parseFloat(cell.style.top) + measuredHeight(cell)));
        expect(Number.parseFloat(container().style.height)).toBeCloseTo(maximumBottom, 5);
    }
    async function notify(target: Element) {
        await act(async () => {
            for (const observer of [...observers]) if (observer.targets.has(target)) observer.callback([{ target, contentRect: { width: (target as HTMLElement).offsetWidth, height: measuredHeight(target) } as DOMRectReadOnly }]);
        });
        await settle();
    }

    afterEach(async () => {
        await mounted?.dispose();
        mounted = undefined;
        expect(observers.size).toBe(0);
        containerWidth = 800;
        naturalOverrides = new WeakMap();
        Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: ControlledResizeObserver });
    });
    afterAll(() => {
        dom.happyDOM.abort();
        for (const [property, descriptor] of dimensions) {
            if (descriptor) Object.defineProperty(dom.HTMLElement.prototype, property, descriptor);
            else Reflect.deleteProperty(dom.HTMLElement.prototype, property);
        }
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });

    test("three different natural image/title/description heights drive actual DOM shortest-column placement", async () => {
        mounted = await mount(baseCards());
        expect(container().dataset.columnCount).toBe("3");
        expect(cells().slice(0, 3).map(measuredHeight)).toEqual([180, 160, 440]);
        expect(positions().map(({ left, top }) => ({ left, top }))).toEqual([
            { left: 0, top: 0 },
            { left: 272, top: 0 },
            { left: 544, top: 0 },
            { left: 272, top: 176 },
            { left: 0, top: 196 },
            { left: 272, top: 292 },
        ]);
        expect(cells().map((cell) => cell.dataset.inspirationId)).toEqual(baseCards().map((item) => item.id));
        noOverlaps();
    });

    test("an image gaining natural height notifies the real observer and reflows later cards without overlap", async () => {
        mounted = await mount(baseCards());
        const image = cells()[0].querySelector("img")!;
        naturalOverrides.set(image, 320);
        await act(async () => image.dispatchEvent(new dom.Event("load")));
        await notify(cells()[0]);
        expect(measuredHeight(cells()[0])).toBe(380);
        expect(positions()[4]).toMatchObject({ left: 272, top: 292 });
        expect(positions()[5]).toMatchObject({ left: 0, top: 396 });
        expect(Number.parseFloat(container().style.height)).toBe(456);
        noOverlaps();
    });

    test("title wrapping and an expanded description remeasure existing DOM without clipping or equalized rows", async () => {
        mounted = await mount(baseCards());
        const first = cells()[0];
        naturalOverrides.set(first.querySelector("h3")!, 72);
        naturalOverrides.set(first.querySelector("p")!, 90);
        await notify(first);
        expect(measuredHeight(first)).toBe(282);
        expect(positions()[4]).toMatchObject({ left: 272, top: 292 });
        expect(Number.parseFloat(container().style.height)).toBe(442);
        expect(first.querySelector("p")?.textContent).toBe(baseCards()[0].description);
        expect(first.style.height).toBe("");
        noOverlaps();
    });

    test("same-ID rendered content changes are measured after React commits and retain the existing cell", async () => {
        const items = baseCards();
        mounted = await mount(items);
        const second = cells()[1];
        await mounted.render(items.map((item, index) => (index === 1 ? { ...item, title: "加长标题保持完整换行", description: "加长描述保持完整显示", titleHeight: 100, descriptionHeight: 180 } : item)));
        expect(cells()[1]).toBe(second);
        expect(measuredHeight(second)).toBe(360);
        expect(second.querySelector("p")?.textContent).toBe("加长描述保持完整显示");
        expect(positions()[4]).toMatchObject({ left: 0, top: 312 });
        expect(Number.parseFloat(container().style.height)).toBe(462);
        noOverlaps();
    });

    test("container resizing invalidates width-specific heights and measures naturally resized images", async () => {
        mounted = await mount(baseCards());
        containerWidth = 640;
        await notify(container());
        expect(container().dataset.columnCount).toBe("2");
        expect(cells().every((cell) => Number.parseFloat(cell.style.width) === 312)).toBe(true);
        expect(measuredHeight(cells()[0])).toBe(206.25);
        expect(positions()[2]).toMatchObject({ left: 328, top: 193.5 });
        expect(Number.parseFloat(container().style.height)).toBe(686);
        noOverlaps();
    });

    test("appending measured pages keeps unchanged prefix coordinates, natural heights and DOM nodes", async () => {
        let items = baseCards();
        mounted = await mount(items);
        for (const page of [[make("page-two-a", 80, 24, 36), make("page-two-b", 40, 24, 16)], [make("page-three-a", 220, 56, 96)]]) {
            const prefixPositions = positions();
            const prefixCells = cells();
            items = [...items, ...page];
            await mounted.render(items);
            expect(positions().slice(0, prefixPositions.length)).toEqual(prefixPositions);
            expect(cells().slice(0, prefixCells.length)).toEqual(prefixCells);
            expect(container().dataset.columnCount).toBe("3");
            noOverlaps();
        }
    });

    test("hidden zero-width containers preserve the measured layout until the same-width hall is visible again", async () => {
        mounted = await mount(baseCards());
        const original = positions();
        const originalHeight = container().style.height;
        containerWidth = 0;
        await notify(container());
        await notify(cells()[0]);
        expect(positions()).toEqual(original);
        expect(container().style.height).toBe(originalHeight);
        containerWidth = 800;
        await notify(container());
        expect(positions()).toEqual(original);
        noOverlaps();
    });

    test("captured image load remeasures natural height even when ResizeObserver is unavailable", async () => {
        Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: undefined });
        mounted = await mount(baseCards());
        expect(observers.size).toBe(0);
        const image = cells()[0].querySelector("img")!;
        naturalOverrides.set(image, 320);
        await act(async () => image.dispatchEvent(new dom.Event("load")));
        await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
        await settle();
        expect(measuredHeight(cells()[0])).toBe(380);
        expect(positions()[5]).toMatchObject({ left: 0, top: 396 });
        expect(Number.parseFloat(container().style.height)).toBe(456);
        noOverlaps();
    });

    test("captured image error measures the React replacement after commit without ResizeObserver", async () => {
        Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: undefined });
        mounted = await mount(baseCards());
        const first = cells()[0];
        await act(async () => first.querySelector("img")!.dispatchEvent(new dom.Event("error")));
        await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
        await settle();
        expect(first.querySelector("img")).toBeNull();
        expect(first.textContent).toContain("保留自然文本占位");
        expect(measuredHeight(first)).toBe(108);
        expect(positions()[3]).toMatchObject({ left: 0, top: 124 });
        expect(positions()[4]).toMatchObject({ left: 272, top: 176 });
        noOverlaps();
    });
}
