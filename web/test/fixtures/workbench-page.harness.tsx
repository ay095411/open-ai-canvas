import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { GenerationTask } from "../../src/services/api/task-center";
import type { CreateWorkbenchTaskInput, WorkbenchKind, WorkbenchToolDirectory } from "../../src/services/api/workbench";

const dom = new Window({ url: "http://localhost:3000/toolbox/image" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const React = await import("react");
const { act } = React;
mock.module("../../src/components/canvas/canvas-resource-mention-textarea", () => ({
    CanvasResourceMentionTextarea: ({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: () => void }) => (
        <textarea
            aria-label="测试生成提示词"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
            }}
        />
    ),
}));
mock.module("../../src/components/media-preview", () => ({ MediaPreview: ({ src, kind }: { src: string; kind: string }) => <div data-media-kind={kind}>{src}</div> }));
mock.module("../../src/components/ui/aceternity/spotlight-surface", () => ({ SpotlightSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import("react-router");
const { App, message, modal, notification } = await import("antd");
const configStore = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useCreationPreferencesStore } = await import("../../src/stores/use-creation-preferences-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const capabilityApi = await import("../../src/lib/model-capabilities");
const modelPicker = await import("../../src/components/model-picker");
const imageSizePicker = await import("../../src/components/image-size-picker");
const featureApi = await import("../../src/services/feature-availability");
const workbenchApi = await import("../../src/services/api/workbench");
const taskApi = await import("../../src/services/api/task-center");
const generationApi = await import("../../src/services/api/generation-task");
const { default: ImageRoute } = await import("../../src/pages/workbench/image-workbench-route");
const { default: VideoRoute } = await import("../../src/pages/workbench/video-workbench-page");

const originalUser = useUserStore.getState();
const originalConfig = configStore.useConfigStore.getState();
const originalPreferences = useCreationPreferencesStore.getState();
const originalScope = originalUser.user?.id || null;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let scope: string;
let route = "";
let navigate: ReturnType<typeof useNavigate>;
let custom = false;
const tasks = new Map<string, GenerationTask>();
const notices: string[] = [];
const created: CreateWorkbenchTaskInput[] = [];
const customCreated: unknown[] = [];

function featureFlags(flags: Partial<ReturnType<typeof useUserStore.getState>["features"]>) {
    useUserStore.setState({ features: { ...useUserStore.getState().features, ...flags } });
}
function task(kind: WorkbenchKind, status: GenerationTask["status"] = "running", id = `${kind}-task`): GenerationTask {
    return {
        id,
        type: `canvas_${kind}`,
        status,
        prompt: `${kind}原始任务`,
        model: kind,
        previewKind: kind,
        attempts: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        inputJson: JSON.stringify({ metadata: { source: "workbench", workbench: { kind, parameters: { size: "1:1", ratio: "16:9", seconds: 6, resolution: "720p", count: 1 }, references: [] } } }),
        ...(status === "succeeded" ? { previewUrl: `/result-${kind}`, resultJson: JSON.stringify(kind === "video" ? { video: { url: "/result-video" } } : { images: [{ url: "/result-image" }] }) } : {}),
    };
}
function Harness() {
    navigate = useNavigate();
    route = useLocation().pathname;
    return (
        <Routes>
            <Route path="/toolbox/image" element={<ImageRoute />} />
            <Route path="/toolbox/video" element={<VideoRoute />} />
            <Route path="/other" element={<div>其他页面</div>} />
        </Routes>
    );
}
async function render(kind: WorkbenchKind = "image") {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
        root!.render(
            <MemoryRouter initialEntries={[`/toolbox/${kind}`]}>
                <Harness />
            </MemoryRouter>,
        ),
    );
}
async function inputPrompt(text = "测试创作需求") {
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="测试生成提示词"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function press(label: string) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.getAttribute("aria-label") === label || entry.textContent?.replace(/\s/g, "") === label);
    expect(button, `找不到按钮 ${label}`).toBeDefined();
    await act(async () => button!.click());
}
async function submitFromKeyboard() {
    await act(async () => host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

beforeEach(() => {
    scope = crypto.randomUUID();
    setActiveUserScope(scope);
    useUserStore.setState({
        user: { id: scope, username: "test", displayName: "测试", role: "user", status: "active" },
        features: { ...originalUser.features, creditsEnabled: false, imageWorkbenchEnabled: true, videoWorkbenchEnabled: true, ecommerceEnabled: false },
    });
    useCreationPreferencesStore.setState({ hydrated: true, preferences: {} });
    configStore.useConfigStore.setState({ isAiConfigReady: () => true });
    custom = false;
    tasks.clear();
    created.length = 0;
    customCreated.length = 0;
    notices.length = 0;
    const config = { ...configStore.defaultConfig, model: "test::image", imageModel: "test::image", videoModel: "test::video", videoGenerateAudio: "false", videoWatermark: "false" };
    configStore.useConfigStore.setState({ config });
    spyOn(configStore, "useEffectiveConfig").mockImplementation(() => configStore.useConfigStore((state) => state.config));
    spyOn(configStore, "selectableModelsByCapability").mockImplementation((_config, kind) => (kind === "image" || kind === "video" ? [`test::${kind}`] : []));
    spyOn(configStore, "logicalModelIDForConfig").mockImplementation(() => (custom ? "" : "logical-model"));
    spyOn(configStore, "resolveModelChannel").mockImplementation(() => ({ id: "test", scope: custom ? "user" : "system", modelCosts: [{ model: "video", logicalModelId: "managed-video" }] }) as ReturnType<typeof configStore.resolveModelChannel>);
    spyOn(configStore, "modelDisplayName").mockImplementation((_config, value) => value);
    const profile = capabilityApi.defaultModelCapabilityConfig();
    profile.image!.references.maxImages = 6;
    profile.video!.references.maxImages = 6;
    spyOn(capabilityApi, "modelCapabilityConfigFor").mockReturnValue(profile);
    spyOn(modelPicker, "ModelPicker").mockImplementation(() => <span>模型选择</span>);
    spyOn(imageSizePicker, "ImageSizePicker").mockImplementation(() => <span>图片参数</span>);
    spyOn(App, "useApp").mockReturnValue({ message, modal, notification } as ReturnType<typeof App.useApp>);
    for (const method of ["error", "warning", "success", "info"] as const)
        spyOn(message, method).mockImplementation(((value: unknown) => {
            notices.push(String(value));
            return () => {};
        }) as (typeof message)[typeof method]);
    spyOn(featureApi, "refreshFeatureAvailability").mockImplementation(async () => useUserStore.getState().features);
    spyOn(workbenchApi, "listWorkbenchTools").mockResolvedValue({ tools: [] });
    spyOn(workbenchApi, "listWorkbenchTasks").mockImplementation(async (kind) => [...tasks.values()].filter((entry) => entry.previewKind === kind));
    spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async (value) => {
        created.push(value);
        const accepted = task(value.kind, "running", `${value.kind}-created-${created.length}`);
        tasks.set(accepted.id, accepted);
        return accepted;
    });
    spyOn(taskApi, "queryGenerationTask").mockImplementation(async (id) => {
        const found = tasks.get(id);
        if (!found) throw new Error("任务不存在");
        return structuredClone(found);
    });
    spyOn(generationApi, "prepareBackendGenerationTask").mockImplementation(async (input) => input as unknown as Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>);
    spyOn(taskApi, "createGenerationTask").mockImplementation(async (input) => {
        customCreated.push(input);
        const accepted = task((input as unknown as { mode: WorkbenchKind }).mode, "running", "custom-created");
        tasks.set(accepted.id, accepted);
        return accepted;
    });
    spyOn(taskApi, "retryGenerationTask").mockImplementation(async (id) => {
        const old = tasks.get(id)!;
        const next = { ...old, id: `${id}-retry`, status: "running" as const };
        tasks.set(next.id, next);
        return next;
    });
});
afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    mock.restore();
});
afterAll(() => {
    useUserStore.setState(originalUser);
    configStore.useConfigStore.setState(originalConfig);
    useCreationPreferencesStore.setState(originalPreferences);
    setActiveUserScope(originalScope);
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("创作影棚真实双模式页面", () => {
    test("独立于电商Agent，图片和视频Tab共用同一面板并分别提交正确kind", async () => {
        await render();
        const panel = host.querySelector(".workbench-shell");
        expect(host.querySelector("h1")?.textContent).toBe("创作影棚");
        await inputPrompt();
        await press("生成图片");
        expect(created.map((entry) => entry.kind)).toEqual(["image"]);
        await press("视频");
        expect(route).toBe("/toolbox/video");
        expect(host.querySelector(".workbench-shell")).toBe(panel);
        expect(host.querySelector('[role="tab"][aria-label="视频"]')?.getAttribute("aria-selected")).toBe("true");
        await inputPrompt("镜头缓慢推进");
        await press("生成视频");
        expect(created.map((entry) => entry.kind)).toEqual(["image", "video"]);
        expect(created.every((entry) => !entry.ecommerceProjectId)).toBe(true);
        await press("图片");
        expect(route).toBe("/toolbox/image");
    });

    test.each(["image", "video"] as const)("%s 关闭后直链仍可读历史，按钮和键盘都不能创建新任务", async (kind) => {
        featureFlags(kind === "image" ? { imageWorkbenchEnabled: false } : { videoWorkbenchEnabled: false });
        const history = task(kind, "succeeded", "historical");
        tasks.set(history.id, history);
        await render(kind);
        expect(host.querySelectorAll('[role="tablist"][aria-label="创作影棚生成模式"] [role="tab"]')).toHaveLength(2);
        expect(host.textContent).toContain("暂未开放");
        expect(host.textContent).toContain(history.prompt);
        await inputPrompt();
        expect(host.querySelector<HTMLButtonElement>(".workbench-submit")?.disabled).toBe(true);
        await submitFromKeyboard();
        expect(created).toHaveLength(0);
        expect(customCreated).toHaveLength(0);
    });

    test("切到关闭的视频Tab只展示视频历史和关闭说明", async () => {
        featureFlags({ videoWorkbenchEnabled: false });
        const video = task("video", "succeeded", "past-video");
        tasks.set(video.id, video);
        await render();
        await press("视频");
        expect(route).toBe("/toolbox/video");
        expect(host.textContent).toContain(video.prompt);
        expect(host.textContent).toContain("视频生成暂未开放");
        await inputPrompt();
        await submitFromKeyboard();
        expect(created).toHaveLength(0);
    });

    test.each(["image", "video"] as const)("%s 提交前刷新获知关停，不调用系统任务API", async (kind) => {
        await render(kind);
        await inputPrompt();
        spyOn(featureApi, "refreshFeatureAvailability").mockImplementation(async () => {
            featureFlags(kind === "image" ? { imageWorkbenchEnabled: false } : { videoWorkbenchEnabled: false });
            return useUserStore.getState().features;
        });
        await press(kind === "image" ? "生成图片" : "生成视频");
        expect(created).toHaveLength(0);
        expect(notices.some((value) => value.includes("暂未开放"))).toBe(true);
    });

    test("刷新开放状态失败，不以旧开关状态继续提交", async () => {
        await render();
        await inputPrompt();
        spyOn(featureApi, "refreshFeatureAvailability").mockRejectedValue(new Error("network failure"));
        await press("生成图片");
        expect(created).toHaveLength(0);
        expect(notices).toContain("无法确认创作影棚开放状态，请稍后重试");
    });

    test("自定义视频通道仍通过同一门控并提交视频工作台元数据", async () => {
        custom = true;
        await render("video");
        await inputPrompt();
        await press("生成视频");
        expect(created).toHaveLength(0);
        expect(customCreated).toHaveLength(1);
        expect(customCreated[0]).toMatchObject({ mode: "video", operation: "text_to_video", metadata: { source: "workbench", workbenchKind: "video" } });
    });

    test("自定义通道准备期间关闭视频开关，不向任务API提交", async () => {
        custom = true;
        let finish!: (value: Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>) => void;
        spyOn(generationApi, "prepareBackendGenerationTask").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await render("video");
        await inputPrompt();
        await press("生成视频");
        expect(finish).toBeDefined();
        await act(async () => {
            featureFlags({ videoWorkbenchEnabled: false });
            finish({} as Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>);
        });
        expect(customCreated).toHaveLength(0);
        expect(notices.some((value) => value.includes("视频生成暂未开放"))).toBe(true);
    });

    test.each(["image", "video"] as const)("%s 失败任务重试在关停后不创建新任务", async (kind) => {
        const failed = task(kind, "failed");
        tasks.set(failed.id, failed);
        await render(kind);
        const retry = spyOn(taskApi, "retryGenerationTask");
        await act(async () => featureFlags(kind === "image" ? { imageWorkbenchEnabled: false } : { videoWorkbenchEnabled: false }));
        await press("重试任务");
        expect(retry).not.toHaveBeenCalled();
        expect(notices.some((value) => value.includes("暂未开放"))).toBe(true);
    });

    test("打开视频任务详情后关停，重新生成仍在API前检查最新开关", async () => {
        const failed = task("video", "failed");
        tasks.set(failed.id, failed);
        await render("video");
        await press("查看任务详情");
        spyOn(featureApi, "refreshFeatureAvailability").mockImplementation(async () => {
            featureFlags({ videoWorkbenchEnabled: false });
            return useUserStore.getState().features;
        });
        const retry = spyOn(taskApi, "retryGenerationTask");
        await press("重新生成");
        expect(retry).not.toHaveBeenCalled();
        expect(notices.some((value) => value.includes("视频生成暂未开放"))).toBe(true);
    });

    test("关停后允许恢复已生成的媒体保存，不重新生成", async () => {
        const failed = { ...task("video", "failed"), canRecoverMedia: true };
        tasks.set(failed.id, failed);
        featureFlags({ imageWorkbenchEnabled: false, videoWorkbenchEnabled: false });
        const recover = spyOn(taskApi, "recoverGenerationTaskMedia").mockResolvedValue({ ...failed, status: "running" });
        const retry = spyOn(taskApi, "retryGenerationTask");
        await render("video");
        await press("重新保存");
        expect(recover).toHaveBeenCalledTimes(1);
        expect(retry).not.toHaveBeenCalled();
        expect(notices).toContain("已重新开始保存，不会重新生成或扣费");
    });

    test("任务已受理后关停且详情读取失败，仍保留回执并明确告知受理", async () => {
        let finish!: (value: GenerationTask) => void;
        const create = spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await render();
        await inputPrompt();
        await press("生成图片");
        await act(async () => {
            featureFlags({ imageWorkbenchEnabled: false });
            finish(task("image", "running", "accepted-image"));
        });
        expect(create).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain("image原始任务");
        expect(notices.some((value) => value.includes("已受理"))).toBe(true);
        expect(notices.some((value) => value.includes("任务提交失败"))).toBe(false);
    });

    test("切换到视频后迟到的图片列表不覆盖当前模式", async () => {
        let finishImages!: (value: GenerationTask[]) => void;
        const old = task("image", "succeeded", "late-image");
        const video = task("video", "succeeded", "current-video");
        spyOn(workbenchApi, "listWorkbenchTasks").mockImplementation((kind) =>
            kind === "image"
                ? new Promise((resolve) => {
                      finishImages = resolve;
                  })
                : Promise.resolve([video]),
        );
        await render();
        await press("视频");
        await act(async () => finishImages([old]));
        expect(host.textContent).toContain(video.prompt);
        expect(host.textContent).not.toContain(old.prompt);
    });

    test("取消图片任务的迟到回包不覆盖视频舞台", async () => {
        const image = task("image", "running", "cancelled-image");
        const video = task("video", "succeeded", "visible-video");
        tasks.set(image.id, image);
        tasks.set(video.id, video);
        let finish!: (value: GenerationTask) => void;
        spyOn(taskApi, "cancelGenerationTask").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await render();
        await act(async () => host.querySelector<HTMLButtonElement>(".workbench-task-main")!.click());
        await press("取消任务");
        await press("视频");
        await act(async () => finish({ ...image, status: "cancelled" }));
        expect(host.querySelector('[aria-label="生成结果"]')?.textContent).toContain(video.prompt);
        expect(host.querySelector('[aria-label="生成结果"]')?.textContent).not.toContain(image.prompt);
    });

    test("旧图片工具目录的迟到回包不进入视频工具列表", async () => {
        let finish!: (value: WorkbenchToolDirectory) => void;
        spyOn(workbenchApi, "listWorkbenchTools").mockImplementation((kind) =>
            kind === "image"
                ? new Promise((resolve) => {
                      finish = resolve;
                  })
                : Promise.resolve({ tools: [] }),
        );
        await render();
        await press("视频");
        await act(async () => finish({ tools: [{ id: "old-tool", kind: "image", categoryId: "product", name: "迟到的图片工具", subtitle: "", description: "", sortOrder: 0, enabled: true, presets: [] }] }));
        expect(host.textContent).not.toContain("迟到的图片工具");
    });

    test("账号切换后不提交旧账号准备中的自定义视频请求", async () => {
        custom = true;
        let finish!: (value: Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>) => void;
        spyOn(generationApi, "prepareBackendGenerationTask").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await render("video");
        await inputPrompt();
        await press("生成视频");
        await act(async () => {
            const newScope = crypto.randomUUID();
            setActiveUserScope(newScope);
            useUserStore.setState({ user: { id: newScope, username: "next", displayName: "其他账号", role: "user", status: "active" } });
            finish({} as Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>);
        });
        expect(customCreated).toHaveLength(0);
        expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    });

    test("视频模型支持音频与水印时，UI切换的选项进入实际请求", async () => {
        const profile = capabilityApi.defaultModelCapabilityConfig();
        profile.video!.generateAudio = { supported: true, default: false };
        profile.video!.watermark = { supported: true, default: false };
        spyOn(capabilityApi, "modelCapabilityConfigFor").mockReturnValue(profile);
        await render("video");
        await inputPrompt();
        for (const label of ["生成音频", "添加水印"]) {
            const field = Array.from(host.querySelectorAll("label")).find((element) => element.textContent?.includes(label));
            await act(async () => field!.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
        }
        expect(configStore.useConfigStore.getState().config).toMatchObject({ videoGenerateAudio: "true", videoWatermark: "true" });
        await press("生成视频");
        expect(created[0].parameters).toMatchObject({ generateAudio: true, watermark: true });
    });
});
