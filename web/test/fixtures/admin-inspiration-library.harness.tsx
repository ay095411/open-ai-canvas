import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { Window } from "happy-dom";
import type { InspirationLibraryRecord, LibraryCandidate } from "../../src/services/api/inspiration-library-admin";

const dom = new Window({ url: "http://localhost/admin/inspiration-library" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    XMLHttpRequest: dom.XMLHttpRequest,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
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
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
mock.module("../../src/pages/admin/components/admin-shell", () => ({
    AdminPageFrame: ({ title, description, actions, children }: { title: string; description: string; actions: React.ReactNode; children: React.ReactNode }) => (
        <main data-admin-root>
            <h1>{title}</h1>
            <p>{description}</p>
            {actions}
            {children}
        </main>
    ),
}));
const { default: Page } = await import("../../src/pages/admin/inspiration-library/inspiration-library-page");
const { apiClient } = await import("../../src/services/api/request");
const { listAdminInspirationLibrary } = await import("../../src/services/api/inspiration-library-admin");
const { emptyLibraryCandidate, candidateOf } = await import("../../src/pages/admin/inspiration-library/candidate-import");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { getActiveUserScope, setActiveUserScope } = await import("../../src/lib/user-scope");
const originalAdapter = apiClient.defaults.adapter;
const originalScope = getActiveUserScope();
const originalUser = useUserStore.getState().user;
const path = "/admin/inspirations/library";
let records: InspirationLibraryRecord[];
let calls: InternalAxiosRequestConfig[];
let failList: boolean;
let failReview: boolean;
let failDetail: boolean;
let deferReview: ((record: InspirationLibraryRecord) => Promise<InspirationLibraryRecord>) | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;

function fixture(slug = "candidate", patch: Partial<InspirationLibraryRecord> = {}): InspirationLibraryRecord {
    const license = { name: "测试书面许可", url: "https://rights.example.com/license", rightsholder: "测试权利人", attribution: "测试权利人署名", evidence: "明确授权测试平台商用展示、转载与再分发指定内容。", commercialUse: true, redistribution: true };
    return {
        ...emptyLibraryCandidate(),
        slug,
        title: `候选 ${slug}`,
        prompt: "本测试提示词仅用于组件行为验收。",
        image: "resource:local-image",
        sourceUrl: "https://rights.example.com/source",
        author: "测试作者",
        promptLicense: { ...license },
        mediaLicense: { ...license },
        mediaReviewed: true,
        contentHash: "c".repeat(64),
        imageHash: "a".repeat(64),
        revision: 1,
        status: "pending",
        reviewReason: "",
        createdAt: "2026-11-16T00:00:00Z",
        updatedAt: "2026-11-16T00:00:00Z",
        ...patch,
    };
}
const body = (config: InternalAxiosRequestConfig) => (typeof config.data === "string" ? JSON.parse(config.data) : config.data);
function signIn(scope: string) {
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: scope, displayName: scope, role: "admin", status: "active" } });
}
beforeEach(() => {
    records = [fixture()];
    calls = [];
    failList = false;
    failReview = false;
    failDetail = false;
    deferReview = undefined;
    signIn("admin-library-a");
    apiClient.defaults.adapter = (async (config) => {
        calls.push(config);
        let data: unknown;
        let code = 0;
        let msg = "ok";
        if (config.url === path) {
            if (failList) {
                code = 7001;
                msg = "测试列表读取失败";
            } else {
                const items = records.filter((record) => record.status === config.params.status);
                const page = config.params.page;
                const limit = config.params.limit;
                data = { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit };
            }
        } else if (config.url === `${path}/import`) {
            const items = body(config).items as LibraryCandidate[];
            const result = { created: 0, updated: 0, unchanged: 0 };
            for (const candidate of items) {
                const old = records.find((record) => record.slug === candidate.slug);
                if (!old) {
                    records.push(fixture(candidate.slug, candidate));
                    result.created++;
                } else if (JSON.stringify(candidateOf(old)) === JSON.stringify(candidate)) result.unchanged++;
                else {
                    records = records.map((record) => (record === old ? { ...old, ...candidate, status: "pending", revision: old.revision + 1 } : record));
                    result.updated++;
                }
            }
            data = result;
        } else if (config.url?.endsWith("/review")) {
            if (failReview) {
                code = 7001;
                msg = "测试版本冲突：请重新读取";
            } else {
                const old = records.find((record) => config.url === `${path}/${record.slug}/review`)!;
                const input = body(config);
                const next = { ...old, revision: old.revision + 1, status: input.action === "approve" ? "approved" : "rejected", reviewReason: input.reason } as InspirationLibraryRecord;
                if (deferReview) data = await deferReview(next);
                else data = next;
                records = records.map((record) => (record === old ? (data as InspirationLibraryRecord) : record));
            }
        } else {
            if (failDetail) {
                code = 7001;
                msg = "测试详情读取失败";
            } else data = records.find((record) => config.url === `${path}/${record.slug}`);
        }
        return { data: { code, data, msg, reason: code ? "library_revision_conflict" : undefined }, status: 200, statusText: "OK", headers: {}, config };
    }) as AxiosAdapter;
});
async function until(check: () => boolean) {
    for (let i = 0; i < 80; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        if (check()) return;
    }
    throw new Error(`UI did not settle: ${document.body.textContent?.slice(-1000)}`);
}
async function mount() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
        root!.render(
            <MemoryRouter>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <QueryClientProvider client={client}>
                            <Page />
                        </QueryClientProvider>
                    </App>
                </ConfigProvider>
            </MemoryRouter>,
        );
    });
    await until(() => Boolean(button("查看审核")) || document.body.textContent!.includes("当前状态没有素材") || document.body.textContent!.includes("测试列表读取失败"));
}
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const button = (text: string) => buttons().find((element) => element.textContent?.trim() === text)!;
async function click(text: string) {
    const target = button(text);
    expect(target, text).toBeDefined();
    await act(async () => {
        target.click();
    });
}
async function input(label: string, value: string) {
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    expect(element, label).toBeDefined();
    const proto = element.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
        element.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
}
async function check(label: string) {
    const element = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find((element) => element.textContent?.trim() === label)!;
    expect(element, label).toBeDefined();
    await act(async () => {
        element.querySelector<HTMLInputElement>("input")!.click();
    });
}
async function open() {
    await until(() => Boolean(button("查看审核")));
    await click("查看审核");
    await until(() => Boolean(document.querySelector(".inspiration-review")));
}
async function acknowledge() {
    await check("确认提示词授权覆盖本站商用展示与转载/再分发");
    await check("确认展示媒体授权覆盖本站商用展示与转载/再分发");
    await check("已核对当前固定媒体版本与必要署名");
}
const writes = () => calls.filter((config) => config.method === "post");
afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    client?.clear();
    host?.remove();
    document.body.replaceChildren();
});
afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    setActiveUserScope(originalScope);
    useUserStore.setState({ user: originalUser });
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("列表默认待审核，不自动取媒体或详情；分页和状态独立服务端请求", async () => {
    records = Array.from({ length: 25 }, (_, index) => fixture(`candidate-${index}`));
    await mount();
    await until(() => button("查看审核") !== undefined);
    expect(calls[0]!.params).toEqual({ status: "pending", page: 1, limit: 20 });
    expect(document.querySelectorAll("img,video")).toHaveLength(0);
    expect(calls.some((config) => config.url?.includes("candidate-"))).toBe(false);
    await act(async () => {
        document.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click();
    });
    await until(() => calls.some((config) => config.params?.page === 2));
    const approved = Array.from(document.querySelectorAll<HTMLElement>(".ant-segmented-item")).find((item) => item.textContent?.trim() === "已批准")!;
    await act(async () => {
        approved.click();
    });
    await until(() => calls.some((config) => config.params?.status === "approved"));
    expect(calls.at(-1)!.params.page).toBe(1);
});
test("列表业务失败强显示，不把错误伪装成空库；可重试", async () => {
    failList = true;
    await mount();
    await until(() => document.body.textContent!.includes("测试列表读取失败"));
    expect(document.body.textContent).toContain("失败不代表授权库为空");
    failList = false;
    await click("重试列表");
    await until(() => Boolean(button("查看审核")));
});
test("填空模板均false，导入仅候选且不会触发批准", async () => {
    await mount();
    await click("导入候选 JSON");
    await click("使用填空模板");
    const template = JSON.parse((document.querySelector('[aria-label="候选 JSON"]') as HTMLTextAreaElement).value).items[0];
    expect(template.promptLicense.rightsholder).toBe("");
    expect(template.mediaLicense.redistribution).toBe(false);
    expect(template.mediaReviewed).toBe(false);
    const candidate = candidateOf(fixture("new"));
    candidate.promptLicense.commercialUse = false;
    candidate.mediaLicense.redistribution = false;
    candidate.mediaReviewed = false;
    await input("候选 JSON", JSON.stringify({ items: [candidate] }));
    await click("导入待审核候选");
    await until(() => document.body.textContent!.includes("候选已导入"));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.url).toBe(`${path}/import`);
    expect(body(writes()[0]!).items[0].mediaReviewed).toBe(false);
});
test("伪造批准状态和非法JSON不进入写API", async () => {
    await mount();
    await click("导入候选 JSON");
    await input("候选 JSON", "not-json");
    await click("导入待审核候选");
    expect(document.body.textContent).toContain("无法解析");
    await input("候选 JSON", JSON.stringify([{ ...candidateOf(fixture()), status: "approved" }]));
    await click("导入待审核候选");
    expect(document.body.textContent).toContain("批准状态");
    expect(writes()).toHaveLength(0);
});
test("待审媒体只主动点击才绑定本站固定hash/revision地址", async () => {
    await mount();
    await open();
    expect(document.querySelectorAll("img,video")).toHaveLength(0);
    await click("主动预览当前媒体");
    const image = document.querySelector<HTMLImageElement>(".inspiration-review-preview img")!;
    expect(image.getAttribute("src")).toContain(`/api${path}/candidate/media?kind=image&hash=${"a".repeat(64)}&revision=1`);
    expect(image.referrerPolicy).toBe("no-referrer");
    expect(image.src).not.toContain("resource:");
    await click("关闭媒体预览");
    expect(document.querySelectorAll("img,video")).toHaveLength(0);
});
test("分别确认许可、媒体与署名，审核只提交当前revision；无原因不批准", async () => {
    await mount();
    await open();
    expect(button("批准当前版本").disabled).toBe(true);
    await acknowledge();
    expect(button("批准当前版本").disabled).toBe(true);
    await input("审核/拒绝/下架原因", "核对书面授权及固定媒体版本通过");
    await click("批准当前版本");
    await until(() => document.body.textContent!.includes("已批准"));
    const write = writes()[0]!;
    expect(write.url).toBe(`${path}/candidate/review`);
    expect(body(write)).toEqual({ revision: 1, action: "approve", reason: "核对书面授权及固定媒体版本通过" });
    expect(body(write)).not.toHaveProperty("promptLicense");
});
test("编辑许可使批准禁用；保存重新pending并读取新revision", async () => {
    await mount();
    await open();
    await acknowledge();
    await input("审核/拒绝/下架原因", "核实通过");
    await input("提示词权利人", "更新后的测试权利人");
    expect(button("批准当前版本").disabled).toBe(true);
    await click("保存候选证据");
    await until(() => document.body.textContent!.includes("版本 2"));
    expect(writes()[0]!.url).toBe(`${path}/import`);
    expect(body(writes()[0]!).items[0].promptLicense.rightsholder).toBe("更新后的测试权利人");
    expect(button("批准当前版本").disabled).toBe(true);
    expect(document.body.textContent).toContain("这不是批准");
});
test("已批准素材下架必须原因，随后按revision拒绝", async () => {
    records = [fixture("candidate", { status: "approved" })];
    await mount();
    const approved = Array.from(document.querySelectorAll<HTMLElement>(".ant-segmented-item")).find((item) => item.textContent?.trim() === "已批准")!;
    await act(async () => {
        approved.click();
    });
    await until(() => Boolean(button("查看审核")));
    await open();
    expect(button("下架当前版本").disabled).toBe(true);
    await input("审核/拒绝/下架原因", "权利人撤回授权");
    await click("下架当前版本");
    await until(() => document.body.textContent!.includes("不再公开展示"));
    expect(body(writes()[0]!)).toEqual({ revision: 1, action: "reject", reason: "权利人撤回授权" });
});
test("版本冲突强显示且不宣称批准，重读后需要重新确认", async () => {
    failReview = true;
    await mount();
    await open();
    await acknowledge();
    await input("审核/拒绝/下架原因", "核实通过");
    await click("批准当前版本");
    await until(() => document.body.textContent!.includes("测试版本冲突"));
    expect(records[0]!.status).toBe("pending");
    records[0]!.revision = 3;
    failReview = false;
    await click("重新读取当前版本");
    await until(() => document.body.textContent!.includes("版本 3"));
    expect(button("批准当前版本").disabled).toBe(true);
});
test("保存已被服务端接受但重读失败时明确区分，不能继续旧版批准", async () => {
    await mount();
    await open();
    await input("提示词权利人", "更新后的权利人");
    failDetail = true;
    await click("保存候选证据");
    await until(() => document.body.textContent!.includes("候选已提交，但新版本读取失败"));
    expect(records[0]!.revision).toBe(2);
    expect(button("批准当前版本").disabled).toBe(true);
});
test("双击不并发审核，切账号取消旧写响应并关闭审核", async () => {
    let resolve!: (record: InspirationLibraryRecord) => void;
    deferReview = () =>
        new Promise((done) => {
            resolve = done;
        });
    await mount();
    await open();
    await acknowledge();
    await input("审核/拒绝/下架原因", "核实通过");
    const approve = button("批准当前版本");
    await act(async () => {
        approve.click();
        approve.click();
    });
    await until(() => writes().length === 1);
    const write = writes()[0]!;
    await act(async () => {
        signIn("admin-library-b");
    });
    await until(() => !document.querySelector(".inspiration-review"));
    expect(write.signal?.aborted).toBe(true);
    await act(async () => {
        resolve(fixture("candidate", { status: "approved", revision: 2 }));
    });
    expect(document.body.textContent).not.toContain("版本 2 已批准");
});
test("http取消语义保留，业务非零code不会作为成功数据", async () => {
    failList = true;
    await expect(listAdminInspirationLibrary({ status: "pending", page: 1, limit: 20 })).rejects.toThrow("测试列表读取失败");
    let finish!: () => void;
    apiClient.defaults.adapter = (async (config) => {
        calls.push(config);
        await new Promise<void>((done) => {
            finish = done;
        });
        return { data: { code: 0, data: { items: [], total: 0, page: 1, limit: 20 }, msg: "ok" }, status: 200, statusText: "OK", headers: {}, config };
    }) as AxiosAdapter;
    const controller = new AbortController();
    const promise = listAdminInspirationLibrary({ status: "pending", page: 1, limit: 20 }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    finish();
    await expect(promise).rejects.toHaveProperty("name", "AbortError");
});
