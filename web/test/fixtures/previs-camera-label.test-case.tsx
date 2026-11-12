import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { RenderCallback, RootState } from "@react-three/fiber";
import type { RefObject } from "react";

const dom = new Window({ url: "http://localhost/dev/previs-repro" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __APP_VERSION__: "0.0.0-test",
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { context } = await import("@react-three/fiber");
const { create } = await import("zustand");
const { Group, OrthographicCamera, PerspectiveCamera } = await import("three");
const { PrevisCameraLabel } = await import("@/components/canvas/previs/previs-viewport");
type Label = { id: string; target: InstanceType<typeof Group>; label: string; selected: boolean; accentHex: string };
let fixture: Awaited<ReturnType<typeof mount>> | undefined;

afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function cameraLabel(id: string): Label {
    return { id, target: new Group(), label: `摄影机 ${id}`, selected: false, accentHex: "#5eead4" };
}

async function mount(labels: Label[]) {
    const rootHost = document.createElement("div");
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.append(canvas);
    document.body.append(rootHost, host);
    const appended = spyOn(host, "append");
    const consoleErrors = spyOn(console, "error").mockImplementation(() => {});
    const errors: unknown[] = [];
    const root = createRoot(rootHost, { onUncaughtError: (error) => errors.push(error) });
    const frames = new Set<RefObject<RenderCallback>>();
    const camera = new PerspectiveCamera(90, 4 / 3, 0.1, 100);
    camera.position.set(0, 0.98, 10);
    camera.lookAt(0, 0.98, 0);
    const store = create<RootState>(
        () =>
            ({
                camera,
                size: { width: 800, height: 600, top: 0, left: 0 },
                gl: { domElement: canvas },
                events: { connected: host },
                internal: {
                    subscribe(callback: RefObject<RenderCallback>) {
                        frames.add(callback);
                        return () => frames.delete(callback);
                    },
                },
            }) as unknown as RootState,
    );
    store.setState({ get: store.getState });
    const render = async (next: Label[]) => {
        await act(async () => {
            root.render(
                <StrictMode>
                    <context.Provider value={store}>
                        {next.map(({ id, ...props }) => (
                            <PrevisCameraLabel key={id} {...props} />
                        ))}
                    </context.Provider>
                </StrictMode>,
            );
        });
    };
    const frame = () => {
        for (const callback of frames) callback.current(store.getState(), 1 / 60);
    };
    const dispose = async () => {
        try {
            await act(async () => root.unmount());
            expect(host.querySelectorAll("[data-previs-camera-label]")).toHaveLength(0);
            expect(frames.size).toBe(0);
            expect(errors).toEqual([]);
            expect(consoleErrors.mock.calls).toEqual([]);
        } finally {
            appended.mockRestore();
            consoleErrors.mockRestore();
            host.remove();
            rootHost.remove();
        }
    };
    try {
        await render(labels);
        return { host, appended, frames, store, camera, render, frame, dispose };
    } catch (error) {
        await dispose();
        throw error;
    }
}

function labelElement() {
    return fixture!.host.querySelector<HTMLDivElement>("[data-previs-camera-label]")!;
}

function screenPosition(element: HTMLElement) {
    const values = element.style.transform.match(/translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/);
    expect(values).not.toBeNull();
    return [Number(values![1]), Number(values![2])];
}

test("StrictMode 重演会移除第一次挂载的节点，只保留一个标签和帧订阅", async () => {
    fixture = await mount([cameraLabel("A")]);
    expect(fixture.appended.mock.calls).toHaveLength(2);
    const first = fixture.appended.mock.calls[0][0] as HTMLElement;
    const current = fixture.appended.mock.calls[1][0] as HTMLElement;
    expect(first.isConnected).toBe(false);
    expect(current.isConnected).toBe(true);
    expect(fixture.host.querySelectorAll("[data-previs-camera-label]")).toHaveLength(1);
    expect(fixture.frames.size).toBe(1);
    expect(current.textContent).toBe("摄影机 A");
    expect(current.style.pointerEvents).toBe("none");
});

test("删除一台摄影机只清理它的标签，剩余摄影机继续投影", async () => {
    const first = cameraLabel("A");
    const remaining = cameraLabel("B");
    fixture = await mount([first, remaining]);
    const [firstElement, remainingElement] = fixture.host.querySelectorAll<HTMLDivElement>("[data-previs-camera-label]");
    await fixture.render([remaining]);
    expect(firstElement.isConnected).toBe(false);
    expect(labelElement()).toBe(remainingElement);
    expect(fixture.frames.size).toBe(1);
    remaining.target.position.x = 2;
    fixture.frame();
    expect(screenPosition(remainingElement)[0]).toBeCloseTo(460, 5);
});

test("标签跟随机位和视口尺寸，在观察相机背后隐藏，并支持正交视图", async () => {
    const label = cameraLabel("A");
    fixture = await mount([label]);
    const element = labelElement();
    expect(screenPosition(element)[0]).toBeCloseTo(400, 5);
    expect(screenPosition(element)[1]).toBeCloseTo(300, 5);
    label.target.position.set(2, 2, 0);
    fixture.frame();
    expect(screenPosition(element)[0]).toBeCloseTo(460, 5);
    expect(screenPosition(element)[1]).toBeCloseTo(240, 5);
    fixture.store.setState({ size: { width: 1600, height: 1200, top: 0, left: 0 } });
    fixture.frame();
    expect(screenPosition(element)[0]).toBeCloseTo(920, 5);
    expect(screenPosition(element)[1]).toBeCloseTo(480, 5);
    fixture.camera.lookAt(0, 0.98, 20);
    fixture.frame();
    expect(element.style.display).toBe("none");
    const orthographic = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
    orthographic.position.set(0, 0.98, 10);
    orthographic.lookAt(0, 0.98, 0);
    fixture.store.setState({ camera: orthographic, size: { width: 800, height: 600, top: 0, left: 0 } });
    fixture.frame();
    expect(element.style.display).toBe("block");
    expect(screenPosition(element)[0]).toBeCloseTo(600, 5);
    expect(screenPosition(element)[1]).toBeCloseTo(100, 5);
    expect(Number(element.style.zIndex)).toBeGreaterThanOrEqual(0);
    expect(Number(element.style.zIndex)).toBeLessThanOrEqual(12);
});

test("改名和选中状态更新原节点，保留动效及省略样式，名称不会解释成 HTML", async () => {
    const label = cameraLabel("A");
    fixture = await mount([label]);
    const element = labelElement();
    const badge = element.firstElementChild!.firstElementChild as HTMLElement;
    expect(badge.style.opacity).toBe("0.75");
    expect(badge.style.transform).toBe("scale(0.95)");
    await fixture.render([{ ...label, label: "<b>摄影机 B</b>", selected: true, accentHex: "#78a9ff" }]);
    expect(labelElement()).toBe(element);
    expect(element.textContent).toBe("<b>摄影机 B</b>");
    expect(element.querySelector("b")).toBeNull();
    expect(badge.style.opacity).toBe("1");
    expect(badge.style.transform).toBe("scale(1)");
    expect(badge.style.textOverflow).toBe("ellipsis");
    expect(badge.style.transition).toContain("0.2s");
    expect((badge.firstElementChild as HTMLElement).style.background).toBe("#78a9ff");
    expect(fixture.appended.mock.calls).toHaveLength(2);
});
