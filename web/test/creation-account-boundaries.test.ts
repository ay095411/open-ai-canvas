import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function pageCallback(name: string, scope: Record<string, unknown>) {
    const source = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    const match = source.match(new RegExp(`^    const ${name} = ([\\s\\S]*?\\n    \\});`, "m"));
    if (!match) throw new Error(`Missing page callback: ${name}`);
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`const handler = ${match[1]};`);
    return new Function(...Object.keys(scope), js + "; return handler;")(...Object.values(scope));
}

test.each(["runtime", "skills"] as const)("%s 准备期间切换账号时不再提交旧创作，且释放提交锁", async (boundary) => {
    for (const change of ["scope", "user"] as const) {
        let activeScope = "owner-scope";
        let userId = "owner";
        let prepared = 0;
        let released = 0;
        const errors: string[] = [];
        const attachments: unknown[] = [];
        const switchAccount = () => {
            if (change === "scope") activeScope = "other-scope";
            else userId = "other";
        };
        const runtime = {
            skillRuntime: {
                prepare: async () => {
                    prepared += 1;
                    if (boundary === "skills") switchAccount();
                    return { prompt: "prepared", metadata: {} };
                },
            },
        };
        const submit = pageCallback("submit", {
            useUserStore: { getState: () => ({ user: { id: userId } }) },
            getActiveUserScope: () => activeScope,
            submitGateRef: {
                current: {
                    tryAcquire: () => 1,
                    release: () => {
                        released += 1;
                    },
                },
            },
            retryPreparingRef: { current: new Set(["retry"]) },
            prompt: "保留原账号的提示词",
            busy: false,
            activeConversation: { id: "conversation", messages: [] },
            conversationStorageReady: true,
            selectedModel: "model",
            mode: "text",
            generationConfig: {},
            mediaSettingIssues: () => [],
            attachments,
            mentionReferences: [],
            maxReferences: 6,
            reconcileCreationAttachmentLimit: () => ({ attachments }),
            selectedCreationReferences: () => [],
            splitCreationAttachments: () => ({ referenceImages: [], referenceVideos: [], referenceAudios: [] }),
            inferVideoOperation: () => undefined,
            ratio: "16:9",
            seconds: "6",
            quality: "auto",
            videoQuality: "720",
            count: "1",
            loadCreationRuntime: async () => {
                if (boundary === "runtime") switchAccount();
                return runtime;
            },
            expandCreationPrompt: (value: string) => value,
            toast: { error: (value: string) => errors.push(value) },
        });
        await submit(undefined, "retry");
        expect(prepared).toBe(boundary === "runtime" ? 0 : 1);
        expect(released).toBe(1);
        expect(errors).toEqual(["登录账号已切换，已停止提交"]);
    }
});

test("素材持久化期间切换账号时，画布交接不接收旧账号的对话", async () => {
    for (const change of ["scope", "user"] as const) {
        let activeScope = "owner-scope";
        let userId = "owner";
        let handoffs = 0;
        const pending: boolean[] = [];
        const lock = { current: false };
        const handoff = pageCallback("continueOnCanvas", {
            activeConversation: { id: "old-conversation", messages: [] },
            openingCanvasRef: lock,
            setOpeningCanvas: (value: boolean) => pending.push(value),
            getActiveUserScope: () => activeScope,
            useUserStore: { getState: () => ({ user: { id: userId } }) },
            useAssetStore: { getState: () => ({ assets: [] }) },
            saveRemoteUserDataNow: async () => {
                if (change === "scope") activeScope = "other-scope";
                else userId = "other";
            },
            continueCreationConversationOnCanvas: async () => {
                handoffs += 1;
                throw new Error("old conversation crossed account boundary");
            },
            toast: {
                error: (value: string) => {
                    throw new Error(value);
                },
            },
        });
        await handoff(["owned-asset"]);
        expect(handoffs).toBe(0);
        expect(lock.current).toBe(false);
        expect(pending).toEqual([true, false]);
    }
});
