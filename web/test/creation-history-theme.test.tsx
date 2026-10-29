import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { creationConversationBucket, conversationPreviewMessage, buildConversationExportMarkdown } from "../src/pages/create/creation-workspace-history";
import type { CreationConversation } from "../src/pages/create/creation-types";

const conversation: CreationConversation = {
    id: "history-a", title: "雨夜镜头", updatedAt: new Date().toISOString(),
    messages: [
        { id: "user-a", role: "user", content: "雨夜街道的镜头", mode: "image", createdAt: new Date().toISOString() },
        { id: "reply-a", role: "assistant", content: "已整理画面说明", createdAt: new Date().toISOString() },
    ],
};

test("history keeps search preview and export semantics", () => {
    expect(creationConversationBucket(conversation.updatedAt)).toBe("today");
    expect(creationConversationBucket("invalid")).toBe("earlier");
    expect(conversationPreviewMessage(conversation)?.id).toBe("user-a");
    const exported = buildConversationExportMarkdown(conversation, "工作台", "用户");
    expect(exported).toContain("# 雨夜镜头");
    expect(exported).toContain("雨夜街道的镜头");
    expect(exported).toContain("已整理画面说明");
});

test("history colors use workspace theme and selected control roles", () => {
    const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    const theme = css.split(".creation-history-drawer,\n")[1]?.split("}")[0] ?? css.split(".creation-history-drawer,\r\n")[1]?.split("}")[0];
    for (const token of ["--user-surface", "--user-surface-muted", "--user-surface-hover", "--user-ink", "--user-ink-muted", "--user-border", "--user-accent"]) expect(theme).toContain(token);
    const selected = css.split(".creation-history-list > li.is-active .creation-history-row {")[1]?.split("}")[0];
    expect(selected).toContain("--control-selected-bg");
    expect(selected).toContain("--control-selected-border");
    expect(css).not.toContain("--creation-history-accent: #1688a3");
    const more = css.split(".creation-history-more {")[1]?.split("}")[0];
    expect(more).not.toContain("position: absolute");
    expect(css).toContain(".creation-history-scroll { min-height: 0; flex: 1; overflow: auto;");
});

test("history offers accessible search clearing and keeps original actions", () => {
    const source = readFileSync(new URL("../src/pages/create/creation-workspace-history.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-label="清除对话搜索"');
    expect(source).toContain('className="creation-history-scroll creation-scrollbar"');
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain('aria-current={active ? "page" : undefined}');
    for (const label of ["重命名", "导出对话", "删除对话"]) expect(source).toContain(label);
    expect(source).toContain("onSelect(conversation)");
    expect(source).toContain("onRename(conversation, value)");
    expect(source).toContain("onDelete(conversation)");
});
