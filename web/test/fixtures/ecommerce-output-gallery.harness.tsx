import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { EcommercePlan, EcommercePlanImage } from "../../src/services/api/ecommerce";
import type { GenerationTask } from "../../src/services/api/task-center";

const dom = new Window({ url: "http://localhost:3000/ecommerce" });
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
const { createRoot } = await import("react-dom/client");
const { EcommerceOutputGallery } = await import("../../src/pages/ecommerce/output-gallery");
const { emptyEcommerceDraft } = await import("../../src/services/api/ecommerce");
const { defaultConfig } = await import("../../src/stores/use-config-store");

type GalleryProps = Parameters<typeof EcommerceOutputGallery>[0];
let props: GalleryProps;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

function picture(id: string, fields: Partial<EcommercePlanImage> = {}): EcommercePlanImage {
    return {
        id,
        imageType: "main",
        platform: "taobao",
        language: "zh-CN",
        goal: "商品主视觉",
        theme: "日常生活",
        composition: "商品居中",
        mainVisual: "耳机",
        verifiedClaims: "",
        copy: "日常聆听",
        lighting: "自然光",
        fidelity: "保持外观",
        prompt: "保留商品外观，呈现自然光",
        negativePrompt: "",
        imageModel: "test-model",
        ratio: "1:1",
        resolution: "2K",
        ...fields,
    };
}
function task(id: string, status: GenerationTask["status"], fields: Partial<GenerationTask> = {}): GenerationTask {
    return { id, projectId: "", type: "canvas_image", status, prompt: "", attempts: 1, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", ...fields };
}
function plan(images: EcommercePlanImage[], previousImages: EcommercePlanImage[] = []): EcommercePlan {
    return { productSummary: "耳机", confirmedFacts: [], uncertainFacts: [], visualStrategy: "自然光", qualityChecks: [], images, previousImages };
}
function Harness() {
    const [selected, setSelected] = React.useState(props.selected);
    return (
        <EcommerceOutputGallery
            {...props}
            selected={selected}
            onSelect={(id) => {
                props.onSelect(id);
                setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                });
            }}
        />
    );
}
async function render(overrides: Partial<GalleryProps> = {}) {
    props = { ...props, ...overrides };
    await act(async () => root!.render(<Harness />));
}
async function press(text: string, container: ParentNode = host) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.textContent?.trim() === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
}
async function filter(text: string) {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>(".commerce-output-filters button")).find((entry) => entry.textContent?.startsWith(text));
    expect(button).toBeDefined();
    await act(async () => button!.click());
}
const cards = () => Array.from(host.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]"));

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
        config: defaultConfig,
        draft: emptyEcommerceDraft(),
        plan: null,
        tasks: {},
        imageModels: [],
        selected: new Set(),
        onSelect: mock(() => {}),
        onDownload: mock(() => {}),
        onRemove: mock(async () => {}),
        onRegenerate: mock(async () => {}),
        onRetry: mock(() => {}),
        generationPending: false,
    };
});
afterEach(async () => {
    await act(async () => root?.unmount());
    host.remove();
    await dom.happyDOM.cancelAsync();
});
afterAll(async () => {
    await dom.happyDOM.close();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("按真实状态筛选两个批次，正在重做的已完成任务显示生成中", async () => {
    const delivered = picture("delivered", { taskId: "not-loaded", assetId: "saved-asset", resourceId: "saved-resource", deliveryStatus: "delivered" });
    const queued = picture("queued", { taskId: "queued-task" });
    const failed = picture("failed", { taskId: "failed-task" });
    const waiting = picture("waiting");
    const regenerating = picture("regenerating", { taskId: "old-task" });
    await render({
        plan: plan([delivered, queued, failed, waiting], [regenerating]),
        tasks: { "queued-task": task("queued-task", "queued"), "failed-task": task("failed-task", "failed"), "old-task": task("old-task", "succeeded") },
        regeneratingIds: new Set(["regenerating"]),
    });
    expect(host.querySelector(".commerce-output-title p")?.textContent).toBe("1 张已完成，2 张生成中，1 张待处理");
    await filter("生成中");
    expect(cards().map((card) => card.dataset.ecommerceImageId)).toEqual(["queued", "regenerating"]);
    await filter("待生成");
    expect(cards().map((card) => card.dataset.ecommerceImageId)).toEqual(["waiting"]);
    await filter("已完成");
    expect(cards().map((card) => card.dataset.ecommerceImageId)).toEqual(["delivered"]);
    await render({ generationPending: true });
    expect(cards().map((card) => card.dataset.ecommerceImageId)).toEqual(["delivered"]);
});

test("选择可下载作品跨批次生效，取消选择不会包含未生成图片", async () => {
    await render({ plan: plan([picture("current", { assetId: "a", deliveryStatus: "delivered" }), picture("waiting")], [picture("previous", { assetId: "b", deliveryStatus: "delivered" })]) });
    expect(host.querySelector<HTMLInputElement>('[data-ecommerce-image-id="waiting"] input')?.disabled).toBe(true);
    await press("选择可下载作品");
    expect(props.onSelect).toHaveBeenCalledTimes(2);
    expect(
        cards()
            .filter((card) => card.classList.contains("is-selected"))
            .map((card) => card.dataset.ecommerceImageId),
    ).toEqual(["current", "previous"]);
    expect(host.querySelector(".commerce-output-selection")?.textContent).toContain("已选 2 张");
    await press("取消选择");
    expect(cards().some((card) => card.classList.contains("is-selected"))).toBe(false);
});

test("持久化图片无任务详情也可以下载并打开原图预览", async () => {
    const image = picture("restored", { taskId: "unavailable-task", assetId: "saved-asset", resourceId: "saved-resource", deliveryStatus: "delivered" });
    await render({ plan: plan([image]) });
    const thumbnail = host.querySelector<HTMLImageElement>(".commerce-output-card-media img");
    expect(thumbnail?.getAttribute("src")).toContain("/resources/saved-resource/file?variant=thumbnail");
    await press("下载");
    expect(props.onDownload).toHaveBeenCalledWith({ image, index: 0, assetId: "saved-asset", resourceId: "saved-resource" });
    await act(async () => host.querySelector<HTMLButtonElement>(".commerce-output-card-media")!.click());
    expect(document.querySelector<HTMLImageElement>(".commerce-output-preview img")?.getAttribute("src")).toContain("/resources/saved-resource/file?variant=original");
    expect(document.querySelector(".commerce-output-preview")?.textContent).toContain("下载原图");
    expect(document.querySelector(".commerce-output-preview")?.textContent).toContain("修改这张");
});

test("保存失败保留错误与重新保存操作，回调不经过重新生成", async () => {
    const image = picture("recoverable", { taskId: "recover-task" });
    await render({ plan: plan([image]), tasks: { "recover-task": task("recover-task", "failed", { canRecoverMedia: true, error: "保存资源暂时失败" }) } });
    expect(host.textContent).toContain("作品等待保存");
    expect(host.textContent).toContain("保存资源暂时失败");
    await press("重新保存");
    expect(props.onRetry).toHaveBeenCalledWith(image);
    expect(props.onRegenerate).not.toHaveBeenCalled();
    await press("移除");
    expect(props.onRemove).toHaveBeenCalledWith(image);
});

test("空筛选可回到全部作品，方案进行时不展示初始引导", async () => {
    await render({ plan: plan([picture("delivered", { deliveryStatus: "delivered", assetId: "a" })]) });
    await filter("失败");
    expect(host.querySelector(".commerce-output-filter-empty")?.textContent).toContain("暂无失败的作品");
    await press("查看全部作品");
    expect(cards()).toHaveLength(1);
    await render({ plan: null, stageActive: true, stage: <div>正在准备视觉方案</div> });
    expect(host.querySelector(".ecs-stage")?.textContent).toContain("正在准备视觉方案");
    expect(host.querySelector(".commerce-output-empty")).toBeNull();
    await render({ stageActive: false, nextStep: "请先添加商品图片" });
    expect(host.querySelector(".commerce-output-title h2")?.textContent).toBe("商品作品");
    expect(host.querySelector(".commerce-output-empty strong")?.textContent).toBe("暂无作品");
    expect(host.querySelector(".commerce-output-empty")?.textContent).toContain("请先添加商品图片");
    expect(host.querySelector('.commerce-output-empty [aria-label="创作步骤"]')).toBeNull();
    await render({ nextStep: undefined });
    expect(host.querySelector(".commerce-output-empty p")?.textContent).toBe("添加商品图，填写画面描述。");
});

test("新图片地址重启加载状态，导出动作保留禁用与已打包下载合同", async () => {
    const image = picture("completed", { taskId: "completed-task" });
    await render({ plan: plan([image]), tasks: { "completed-task": task("completed-task", "succeeded", { resultJson: JSON.stringify({ images: [{ dataUrl: "/first.png" }] }) }) }, exportCount: 1, exportDisabled: true, onExport: mock(() => {}) });
    const loaded = host.querySelector<HTMLImageElement>(".commerce-output-card-media img")!;
    await act(async () => {
        loaded.dispatchEvent(new Event("load"));
    });
    expect(host.querySelector(".commerce-result-image-shell")?.classList.contains("is-loaded")).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="导出图片，共 1 张"]')?.disabled).toBe(true);
    await render({
        tasks: { "completed-task": task("completed-task", "succeeded", { resultJson: JSON.stringify({ images: [{ dataUrl: "/second.png" }] }) }) },
        exportDisabled: false,
        preparedDownload: { url: "blob:test-export", fileName: "商品作品.zip" },
    });
    expect(host.querySelector(".commerce-result-image-shell")?.classList.contains("is-loading")).toBe(true);
    expect(host.querySelector<HTMLImageElement>(".commerce-output-card-media img")?.getAttribute("src")).toBe("/second.png");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="导出图片，共 1 张"]')!.click());
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLAnchorElement>('a[download="商品作品.zip"]')?.getAttribute("href")).toBe("blob:test-export");
});
