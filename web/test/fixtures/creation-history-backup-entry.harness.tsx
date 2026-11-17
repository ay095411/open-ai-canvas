import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationConversation } from "../../src/pages/create/creation-types";
import type { HistoryConflictBackup, HistorySyncStatus } from "../../src/services/creation-history-sync";

const dom = new Window({ url: "http://localhost/create" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { CreationHistoryDrawer } = await import("../../src/pages/create/creation-workspace-history");
const { CreationHistoryConflicts } = await import("../../src/pages/create/creation-history-conflicts");
const { CreationHistorySync } = await import("../../src/services/creation-history-sync");

const conversation: CreationConversation = {
    id: "original-conversation",
    title: "当前历史对话",
    updatedAt: "2026-11-17T08:00:00Z",
    messages: [{ id: "original-message", role: "user", content: "当前内容保持不变", mode: "text", createdAt: "2026-11-17T08:00:00Z" }],
};
const backup: Omit<HistoryConflictBackup, "key"> = {
    id: conversation.id,
    snapshotId: "backup-1",
    at: "2026-11-17T08:01:00Z",
    local: { ...conversation, title: "本机历史副本", messages: [{ ...conversation.messages[0], content: "需要保留的本机消息" }] },
};
const manageText = "查看历史副本（1）";
let view: Awaited<ReturnType<typeof mountHistory>> | undefined;

afterEach(async () => {
    await view?.dispose();
    view = undefined;
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function mountHistory({ open = false, busy = false, withBackup = true } = {}) {
    let disk = JSON.stringify({ version: 1, conversations: [conversation], bases: {}, deleted: [], removedMessages: {}, conflicts: withBackup ? [backup] : [] });
    let status: HistorySyncStatus = { phase: "local" };
    let changeStatus: ((status: HistorySyncStatus) => void) | undefined;
    let changeConversations: ((conversations: CreationConversation[]) => void) | undefined;
    const session = new CreationHistorySync({
        read: async () => disk,
        readLegacy: async () => null,
        write: async (value) => {
            disk = value;
        },
        api: {
            list: async () => {
                throw new Error("This local recovery must not request remote history");
            },
            get: async () => {
                throw new Error("This local recovery must not request remote history");
            },
            sync: async () => {
                throw new Error("This local recovery must not submit remote mutations");
            },
        },
        prepare: async () => {
            throw new Error("Restoring history must not run generation or media preparation");
        },
        active: () => true,
        cloud: false,
        onChange: (next) => changeConversations?.(next),
        onStatus: (next) => {
            status = next;
            changeStatus?.(next);
        },
    });
    const conversations = await session.load();
    const resolve = spyOn(session, "resolveConflict");
    const sync = spyOn(session, "sync");
    let changeBusy: (busy: boolean) => void;
    function History() {
        const [historyOpen, setHistoryOpen] = useState(open);
        const [historyBusy, setHistoryBusy] = useState(busy);
        const [historyStatus, setHistoryStatus] = useState(status);
        const [historyConversations, setHistoryConversations] = useState(conversations);
        changeBusy = setHistoryBusy;
        changeStatus = setHistoryStatus;
        changeConversations = setHistoryConversations;
        return (
            <>
                <button type="button" onClick={() => setHistoryOpen(true)}>
                    打开历史对话
                </button>
                <CreationHistoryDrawer
                    open={historyOpen}
                    conversations={historyConversations}
                    activeId={conversation.id}
                    onNew={() => {}}
                    onClose={() => setHistoryOpen(false)}
                    onSelect={() => {}}
                    onDelete={() => {}}
                    onRename={() => {}}
                    recoveryActions={historyOpen && historyStatus.backupCount ? <CreationHistoryConflicts key="history-user" session={session} status={historyStatus} busy={historyBusy} /> : null}
                />
            </>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <History />
                </App>
            </ConfigProvider>,
        ),
    );
    return {
        session,
        resolve,
        sync,
        disk: () => JSON.parse(disk),
        setBusy: async (next: boolean) => act(async () => changeBusy(next)),
        dispose: async () => {
            await act(async () => root.unmount());
            changeStatus = undefined;
            changeConversations = undefined;
            session.dispose();
            resolve.mockRestore();
            sync.mockRestore();
            host.remove();
        },
    };
}

function button(text: string) {
    return [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
}
function backupModal() {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((item) => item.textContent?.includes("历史冲突副本"));
}
async function click(element: HTMLButtonElement | undefined | null) {
    expect(element).toBeDefined();
    expect(element).not.toBeNull();
    expect(element!.disabled).toBe(false);
    await act(async () => element!.click());
}
async function settleUntil(check: () => boolean) {
    for (let attempt = 0; attempt < 50 && !check(); attempt++) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(check()).toBe(true);
}

test("副本入口仅在打开的真实历史抽屉底部，关闭历史同时移除副本弹窗", async () => {
    view = await mountHistory();
    expect(button(manageText)).toBeUndefined();
    expect(backupModal()).toBeUndefined();
    await click(button("打开历史对话"));
    await settleUntil(() => Boolean(button(manageText)));
    const entry = button(manageText)!;
    const historyContent = entry.closest(".creation-history-content");
    expect(historyContent).not.toBeNull();
    const list = historyContent!.querySelector(".creation-history-list");
    expect(list).not.toBeNull();
    expect(entry.compareDocumentPosition(list!) & dom.Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    await click(entry);
    await settleUntil(() => Boolean(backupModal()));
    expect(backupModal()!.textContent).toContain(backup.local.title);
    expect(backupModal()!.textContent).toContain(backup.local.messages[0].content);
    await click(document.querySelector<HTMLButtonElement>(".creation-history-drawer .ant-drawer-close"));
    await settleUntil(() => !button(manageText) && !backupModal());
    await click(button("打开历史对话"));
    await settleUntil(() => Boolean(button(manageText)));
    expect(backupModal()).toBeUndefined();
});

test("没有历史副本时打开抽屉不出现恢复入口", async () => {
    view = await mountHistory({ open: true, withBackup: false });
    expect(document.querySelector(".creation-history-content")).not.toBeNull();
    expect(document.body.textContent).toContain(conversation.title);
    expect(button(manageText)).toBeUndefined();
    expect(document.body.textContent).not.toContain("查看历史副本");
    expect(backupModal()).toBeUndefined();
});

test("底部入口仍通过真实会话保留当前版本且不删除原始副本", async () => {
    view = await mountHistory({ open: true });
    await click(button(manageText));
    await settleUntil(() => Boolean(button("保留当前版本")));
    await click(button("保留当前版本"));
    await settleUntil(() => Boolean(view!.session.conflictBackups()[0].resolvedAt));
    expect(view.resolve).toHaveBeenCalledWith("backup-1", "keep", "本机历史副本（恢复副本）");
    expect(view.sync).not.toHaveBeenCalled();
    expect(view.disk().conversations).toEqual([conversation]);
    expect(view.session.conflictBackups()[0].local).toEqual(backup.local);
    expect(backupModal()!.textContent).toContain("已保留当前版本");
});

test("生成忙碌时禁用恢复，空闲后恢复为独立新对话并触发同步", async () => {
    view = await mountHistory({ open: true, busy: true });
    await click(button(manageText));
    await settleUntil(() => Boolean(button("恢复为新对话")));
    const restore = button("恢复为新对话")!;
    expect(restore.disabled).toBe(true);
    await act(async () => restore.click());
    expect(view.resolve).not.toHaveBeenCalled();
    expect(view.disk().conversations).toEqual([conversation]);
    await view.setBusy(false);
    await click(button("恢复为新对话"));
    await settleUntil(() => Boolean(view!.session.conflictBackups()[0].restoredConversationId));
    expect(view.resolve).toHaveBeenCalledWith("backup-1", "restore", "本机历史副本（恢复副本）");
    expect(view.sync).toHaveBeenCalledTimes(1);
    const saved = view.disk();
    expect(saved.conversations).toHaveLength(2);
    expect(saved.conversations.find((item: CreationConversation) => item.id === conversation.id)).toEqual(conversation);
    const restored = saved.conversations.find((item: CreationConversation) => item.id !== conversation.id) as CreationConversation;
    expect(restored.title).toBe("本机历史副本（恢复副本）");
    expect(restored.messages).toEqual(backup.local.messages);
    expect(view.session.conflictBackups()[0].local).toEqual(backup.local);
    expect(button("已恢复为新对话")!.disabled).toBe(true);
});
