import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { FeatureAvailabilitySaveResult, useFeatureAvailabilityEditor as EditorHook } from "@/pages/admin/components/use-feature-availability-editor";
import type { FeatureAvailability } from "@/stores/use-user-store";

const dom = new Window({ url: "http://localhost/admin/settings/features" });
const notifications: { channel: string; data: unknown }[] = [];
const originals = new Map<string, PropertyDescriptor | undefined>();
class TestBroadcastChannel {
    constructor(private readonly name: string) {}
    postMessage(data: unknown) {
        notifications.push({ channel: this.name, data });
    }
    close() {}
}
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    BroadcastChannel: TestBroadcastChannel,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { apiClient } = await import("@/services/api/request");
const { defaultFeatureAvailability, useUserStore } = await import("@/stores/use-user-store");
const { useFeatureAvailabilityEditor } = await import("@/pages/admin/components/use-feature-availability-editor");
const originalAdapter = apiClient.defaults.adapter;
const originalFeatures = useUserStore.getState().features;
type Editor = ReturnType<typeof EditorHook>;
type PendingRequest = {
    method: string;
    body: unknown;
    settled: boolean;
    resolve: (features: unknown) => void;
    reject: (error: Error) => void;
};
const requests: PendingRequest[] = [];
let view: Awaited<ReturnType<typeof mount>> | undefined;

beforeEach(() => {
    requests.length = 0;
    notifications.length = 0;
    useUserStore.setState({ features: { ...defaultFeatureAvailability } });
    apiClient.defaults.adapter = (config) =>
        new Promise((resolve, reject) => {
            if (config.url !== "/admin/settings/features") {
                reject(new Error(`Unexpected API request: ${config.url}`));
                return;
            }
            const pending: PendingRequest = {
                method: config.method || "get",
                body: config.data ? JSON.parse(String(config.data)) : undefined,
                settled: false,
                resolve: (features) => {
                    pending.settled = true;
                    resolve({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { features }, msg: "" } });
                },
                reject: (error) => {
                    pending.settled = true;
                    reject(error);
                },
            };
            requests.push(pending);
        });
});

afterEach(async () => {
    await view?.dispose();
    view = undefined;
    await act(async () => {
        for (const request of requests) if (!request.settled) request.reject(new Error("test disposed"));
    });
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState({ features: originalFeatures });
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function configuration(patch: Partial<FeatureAvailability> = {}): FeatureAvailability {
    return { ...defaultFeatureAvailability, configured: true, updatedBy: "admin", ...patch };
}

async function mount(strict = false) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let editor!: Editor;
    let disposed = false;
    function Probe() {
        editor = useFeatureAvailabilityEditor();
        return <output>{JSON.stringify({ features: editor.features, error: editor.error, uncertain: editor.uncertain })}</output>;
    }
    await act(async () =>
        root.render(
            strict ? (
                <StrictMode>
                    <Probe />
                </StrictMode>
            ) : (
                <Probe />
            ),
        ),
    );
    return {
        get editor() {
            return editor;
        },
        host,
        async dispose() {
            if (disposed) return;
            disposed = true;
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

async function resolve(index: number, value: unknown) {
    expect(requests[index]).toBeDefined();
    await act(async () => requests[index].resolve(value));
}

async function reject(index: number, message: string) {
    expect(requests[index]).toBeDefined();
    await act(async () => requests[index].reject(new Error(message)));
}

async function ready(value = configuration()) {
    view = await mount();
    await resolve(0, value);
    return view;
}

test("initial load shows no assumed configuration and publishes only a validated response", async () => {
    view = await mount();
    expect(view.editor.features).toBeNull();
    expect(view.editor.loading).toBe(true);
    expect(await view.editor.save("ecommerceEnabled", true)).toEqual({ kind: "ignored" });
    const value = configuration({ imageWorkbenchEnabled: true });
    await resolve(0, value);
    expect(view.editor.features).toEqual(value);
    expect(view.editor.loading).toBe(false);
    expect(view.editor.error).toBe("");
    expect(useUserStore.getState().features).toMatchObject(value);
    expect(notifications).toEqual([]);
});

test("save sends one field and synchronously ignores duplicate clicks and reads during the write", async () => {
    const current = await ready();
    let first!: Promise<FeatureAvailabilitySaveResult>;
    let duplicate!: Promise<FeatureAvailabilitySaveResult>;
    let refreshing!: Promise<boolean>;
    await act(async () => {
        first = current.editor.save("ecommerceEnabled", true);
        duplicate = current.editor.save("imageWorkbenchEnabled", true);
        refreshing = current.editor.load();
    });
    expect(await duplicate).toEqual({ kind: "ignored" });
    expect(await refreshing).toBe(false);
    expect(requests).toHaveLength(2);
    expect(requests[1].method).toBe("patch");
    expect(requests[1].body).toEqual({ ecommerceEnabled: true });
    expect(current.editor.savingKey).toBe("ecommerceEnabled");
    expect(current.editor.features?.ecommerceEnabled).toBe(false);
    // A concurrent administrator may change an unrelated field; accept the
    // full server snapshot while checking only this write's requested field.
    const value = configuration({ ecommerceEnabled: true, imageWorkbenchEnabled: true });
    await resolve(1, value);
    expect(await first).toEqual({ kind: "saved" });
    expect(current.editor.features).toEqual(value);
    expect(current.editor.savingKey).toBeNull();
    expect(notifications).toEqual([{ channel: "canvas-feature-availability", data: "changed" }]);
    expect(await current.editor.save("ecommerceEnabled", true)).toEqual({ kind: "ignored" });
    expect(requests).toHaveLength(2);
});

test("a late GET cannot overwrite a newer successful PATCH", async () => {
    const current = await ready();
    let read!: Promise<boolean>;
    await act(async () => {
        read = current.editor.load();
    });
    expect(current.editor.refreshing).toBe(true);
    let save!: Promise<FeatureAvailabilitySaveResult>;
    await act(async () => {
        save = current.editor.save("ecommerceEnabled", true);
    });
    await resolve(2, configuration({ ecommerceEnabled: true }));
    expect(await save).toEqual({ kind: "saved" });
    await resolve(1, configuration({ ecommerceEnabled: false }));
    expect(await read).toBe(false);
    expect(current.editor.features?.ecommerceEnabled).toBe(true);
    expect(useUserStore.getState().features.ecommerceEnabled).toBe(true);
    expect(current.editor.refreshing).toBe(false);
});

test("two GETs completing in reverse order retain the newest request", async () => {
    view = await mount();
    let read!: Promise<boolean>;
    await act(async () => {
        read = view!.editor.load();
    });
    await resolve(1, configuration({ ecommerceEnabled: true }));
    expect(await read).toBe(true);
    await resolve(0, configuration());
    expect(view.editor.features?.ecommerceEnabled).toBe(true);
    expect(view.editor.loading).toBe(false);
});

test("a lost PATCH response recovers through GET without falsely rolling back a committed write", async () => {
    const current = await ready();
    let save!: Promise<FeatureAvailabilitySaveResult>;
    await act(async () => {
        save = current.editor.save("ecommerceEnabled", true);
    });
    await reject(1, "response connection lost");
    expect(requests[2].method).toBe("get");
    expect(current.editor.savingKey).toBe("ecommerceEnabled");
    await resolve(2, configuration({ ecommerceEnabled: true, videoWorkbenchEnabled: true }));
    expect(await save).toEqual({ kind: "recovered" });
    expect(current.editor.features?.ecommerceEnabled).toBe(true);
    expect(current.editor.features?.videoWorkbenchEnabled).toBe(true);
    expect(current.editor.error).toBe("");
    expect(current.editor.uncertain).toBe(false);
    expect(notifications).toHaveLength(1);
});

test("a verified unsuccessful write displays the newly read server snapshot", async () => {
    const current = await ready();
    let save!: Promise<FeatureAvailabilitySaveResult>;
    await act(async () => {
        save = current.editor.save("ecommerceEnabled", true);
    });
    await reject(1, "save refused");
    const actual = configuration({ imageWorkbenchEnabled: true });
    await resolve(2, actual);
    expect((await save).kind).toBe("failed");
    expect(current.editor.features).toEqual(actual);
    expect(useUserStore.getState().features).toMatchObject(actual);
    expect(current.editor.error).toContain("已重新读取服务端状态");
    expect(current.editor.uncertain).toBe(false);
    expect(notifications).toEqual([]);
    await act(async () => {
        save = current.editor.save("ecommerceEnabled", true);
    });
    expect(requests[3].method).toBe("patch");
    await resolve(3, configuration({ imageWorkbenchEnabled: true, ecommerceEnabled: true }));
    expect((await save).kind).toBe("saved");
});

for (const response of ["mismatch", "malformed"] as const) {
    test(`a ${response} PATCH response is verified before reporting success`, async () => {
        const current = await ready();
        let save!: Promise<FeatureAvailabilitySaveResult>;
        await act(async () => {
            save = current.editor.save("ecommerceEnabled", true);
        });
        await resolve(1, response === "mismatch" ? configuration() : { ecommerceEnabled: true });
        expect(requests[2].method).toBe("get");
        expect(notifications).toEqual([]);
        await resolve(2, configuration({ ecommerceEnabled: true }));
        expect(await save).toEqual({ kind: "recovered" });
        expect(current.editor.error).toBe("");
    });
}

test("failed verification locks further writes until a successful explicit reload", async () => {
    const initial = configuration({ imageWorkbenchEnabled: true });
    const current = await ready(initial);
    let save!: Promise<FeatureAvailabilitySaveResult>;
    await act(async () => {
        save = current.editor.save("ecommerceEnabled", true);
    });
    await reject(1, "save disconnected");
    await reject(2, "verification disconnected");
    expect((await save).kind).toBe("uncertain");
    expect(current.editor.uncertain).toBe(true);
    expect(current.editor.features).toEqual(initial);
    expect(current.editor.savingKey).toBeNull();
    expect(current.editor.error).toContain("上一次已确认的配置");
    expect(await current.editor.save("siteAssistantEnabled", true)).toEqual({ kind: "ignored" });
    expect(requests).toHaveLength(3);
    let read!: Promise<boolean>;
    await act(async () => {
        read = current.editor.load();
    });
    await reject(3, "still disconnected");
    expect(await read).toBe(false);
    expect(current.editor.uncertain).toBe(true);
    expect(await current.editor.save("siteAssistantEnabled", true)).toEqual({ kind: "ignored" });
    await act(async () => {
        read = current.editor.load();
    });
    await resolve(4, configuration({ ecommerceEnabled: true }));
    expect(await read).toBe(true);
    expect(current.editor.uncertain).toBe(false);
    expect(current.editor.error).toBe("");
    await act(async () => {
        save = current.editor.save("siteAssistantEnabled", true);
    });
    await resolve(5, configuration({ ecommerceEnabled: true, siteAssistantEnabled: true }));
    expect((await save).kind).toBe("saved");
});

test("initial read failure keeps configuration absent and can be retried", async () => {
    view = await mount();
    await reject(0, "initial read failed");
    expect(view.editor.features).toBeNull();
    expect(view.editor.loading).toBe(false);
    expect(view.editor.error).toBe("initial read failed");
    expect(await view.editor.save("ecommerceEnabled", true)).toEqual({ kind: "ignored" });
    let read!: Promise<boolean>;
    await act(async () => {
        read = view!.editor.load();
    });
    expect(view.editor.loading).toBe(true);
    await resolve(1, configuration());
    expect(await read).toBe(true);
    expect(view.editor.error).toBe("");
});

for (const phase of ["read", "save", "verification"] as const) {
    test(`unmount ignores a late ${phase} response without publishing state or notifications`, async () => {
        view = await mount();
        let pending: Promise<FeatureAvailabilitySaveResult> | undefined;
        let index = 0;
        if (phase !== "read") {
            await resolve(0, configuration());
            await act(async () => {
                pending = view!.editor.save("ecommerceEnabled", true);
            });
            index = 1;
            if (phase === "verification") {
                await reject(1, "save response lost");
                index = 2;
            }
        }
        await view.dispose();
        const globalBefore = useUserStore.getState().features;
        await resolve(index, configuration({ ecommerceEnabled: true }));
        if (pending) expect(await pending).toEqual({ kind: "ignored" });
        expect(useUserStore.getState().features).toBe(globalBefore);
        expect(notifications).toEqual([]);
    });
}

test("StrictMode effect replay rejects the prior mount's delayed read", async () => {
    view = await mount(true);
    expect(requests).toHaveLength(2);
    await resolve(1, configuration({ ecommerceEnabled: true }));
    await resolve(0, configuration());
    expect(view.editor.features?.ecommerceEnabled).toBe(true);
    expect(useUserStore.getState().features.ecommerceEnabled).toBe(true);
    expect(view.editor.loading).toBe(false);
});
