import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWelcome } from "@/components/canvas/canvas-agent-welcome";
import { AgentContextRing, AgentConversation, AgentHeader } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { agentPermissionVisual } from "@/components/canvas/canvas-cloud-agent-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { DEFAULT_CANVAS_APPEARANCE, agentCopy } from "@/lib/canvas/agent-appearance";
import { emptyAgentContextUsage, presentAgentContextUsage, reduceAgentContextUsage, type AgentContextUsage } from "@/lib/canvas/agent-context-usage";

const noop = () => {};

const conversationProps = { theme: canvasThemes.light, references: [], approval: null, approvalSubmitting: false, onApprovalReasonChange: noop, onApprove: noop, onReject: noop };
const renderContextUsage = (usage: AgentContextUsage) => renderToStaticMarkup(<AgentContextRing view={presentAgentContextUsage(usage)} theme={canvasThemes.light} />);

test("new Agent conversation uses a message icon in the history title button", () => {
    const html = renderToStaticMarkup(
        <AgentHeader theme={canvasThemes.light} hasMessages={false} statusLabel="就绪" statusColor={canvasThemes.light.node.muted} onNew={noop} onHistory={noop} onSettings={noop} onResetLayout={noop} onCollapse={noop} onExport={noop} exporting={false} />,
    );
    const mark = html.match(/<span\b[^>]*class="agent-panel-mark"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    expect(html).toContain("新对话");
    expect(mark).toBeDefined();
    expect(mark).toMatch(/\blucide-message-square(?:\s|")/);
    expect(mark).not.toContain("lucide-message-square-plus");
    expect(mark).not.toContain("lucide-clapperboard");
    expect(mark).not.toContain("lucide-sparkles");
    expect(mark).not.toContain("lucide-bot");
    expect(html).toContain("lucide-message-square-plus");
});

test("Agent history title icon has no colored background", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    const mark = css.match(/\.agent-panel-mark\s*\{([^}]*)\}/)?.[1];
    expect(mark).toBeDefined();
    expect(mark).not.toMatch(/\bbackground(?:-color)?\s*:/);
    expect(mark).not.toContain("--palette-node-image");
    expect(mark).toContain("color: var(--agent-ink)");
    expect(mark).toContain("width: 28px");
    expect(mark).toContain("height: 28px");
});

test("Agent context control is absent before measurement", () => {
    expect(renderContextUsage(emptyAgentContextUsage(""))).toBe("");
});

test("Agent context control is absent after switching to an unread run", () => {
    const measured = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), {
        runId: "run-1",
        type: "context_pressure",
        seq: 1,
        payload: { tokenSource: "pi", modelLimitConfigured: true, contextWindowTokens: 128_000, estimatedInputTokens: 32_000, pressureRatio: 0.25 },
    });
    const reset = reduceAgentContextUsage(measured, { runId: "run-2", type: "assistant_message", seq: 1, payload: {} });
    expect(reset.runId).toBe("run-2");
    expect(reset.reading).toBeNull();
    expect(renderContextUsage(reset)).toBe("");
});

test("Agent context control preserves a real zero-token reading", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), {
        runId: "run-1",
        type: "context_pressure",
        seq: 1,
        payload: { tokenSource: "pi", modelLimitConfigured: true, contextWindowTokens: 128_000, estimatedInputTokens: 0, pressureRatio: 0 },
    });
    const view = presentAgentContextUsage(usage);
    expect(view.inputTokens).toBe(0);
    expect(view.ratio).toBe(0);
    const html = renderContextUsage(usage);
    expect(html).toContain("agent-context-ring is-ok");
    expect(html).toContain("<strong>0%</strong>");
});

test("Agent context control displays the measured model-window percentage", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), {
        runId: "run-1",
        type: "context_pressure",
        seq: 1,
        payload: { tokenSource: "pi", modelLimitConfigured: true, contextWindowTokens: 128_000, estimatedInputTokens: 32_000, pressureRatio: 0.25 },
    });
    const html = renderContextUsage(usage);
    expect(html).toContain("agent-context-ring is-ok");
    expect(html).toContain("上下文已用 25%");
    expect(html).toContain("<strong>25%</strong>");
});

test("Agent context control preserves measured usage when the model window is unknown", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), { runId: "run-1", type: "context_pressure", seq: 1, payload: { tokenSource: "pi", modelLimitConfigured: false, estimatedInputTokens: 12_000 } });
    const view = presentAgentContextUsage(usage);
    expect(view.inputTokens).toBe(12_000);
    expect(view.ratio).toBeUndefined();
    const html = renderContextUsage(usage);
    expect(html).toContain("agent-context-ring is-unknown");
    expect(html).toContain("上下文窗口未知");
    expect(html).not.toContain("<strong>0%</strong>");
});

test("Agent context control remains available during compaction without a token reading", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), { runId: "run-1", type: "context_compaction_requested", seq: 1, payload: { basis: "bytes", compactionId: "compact-1" } });
    expect(usage.reading).toBeNull();
    const html = renderContextUsage(usage);
    expect(html).toContain("agent-context-ring is-compacting");
    expect(html).toContain("正在压缩");
});

test("Agent context control retains completed compaction information without a token reading", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), { runId: "run-1", type: "context_compacted", seq: 1, payload: { mode: "checkpoint", compactionId: "compact-1", resume: true } });
    expect(usage.reading).toBeNull();
    expect(presentAgentContextUsage(usage).lastCompaction).toEqual({ mode: "checkpoint", compactionId: "compact-1", resume: true });
    expect(renderContextUsage(usage)).toContain("agent-context-ring");
});

test("Agent context control retains compaction failure information without a token reading", () => {
    const usage = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), { runId: "run-1", type: "context_compaction_failed", seq: 1, payload: { compactionId: "compact-1", errorMessage: "上下文压缩失败，原有对话历史已保留" } });
    expect(usage.reading).toBeNull();
    expect(presentAgentContextUsage(usage).compactionError).toBe("上下文压缩失败，原有对话历史已保留");
    expect(renderContextUsage(usage)).toContain("agent-context-ring");
});

test("empty Agent conversation hides skill actions before the administrator session loads", () => {
    const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy={false} nodeCount={0} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("agent-welcome-orb");
    expect(html).toContain("让灵感，慢慢成形");
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).not.toContain("选择技能，开始创作");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain("agent-conversation-starter");
    expect(html).not.toContain("agent-scene-capsules");
});

test("original welcome uses configured names and escapes them as text", () => {
    const html = renderToStaticMarkup(<AgentWelcome appearance={{ ...DEFAULT_CANVAS_APPEARANCE, agentName: "我的<工作室>" }} nodeCount={2} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("在这里，和我的&lt;工作室&gt;让灵感，慢慢成形");
    expect(html).toContain("2 个节点");
    expect(html).not.toContain('disabled=""');
});

test("submission state is explicit instead of claiming the model is thinking", () => {
    const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy activity="submitting" />);
    expect(html).toContain("正在发送…");
    expect(html).not.toContain("正在思考");
    expect(html).not.toContain("实时处理中");
});

test("assistant template replacement treats names literally", () => {
    expect(agentCopy("{agentName} / {agentName}", "$&小鱼")).toBe("$&小鱼 / $&小鱼");
});

test("permission modes have distinct icons, not just distinct colors", () => {
    const icons = (["read_only", "request_approval", "auto"] as const).map((mode) => {
        const Icon = agentPermissionVisual(mode).icon;
        return renderToStaticMarkup(<Icon />);
    });
    expect(new Set(icons).size).toBe(3);
    expect(icons[0]).toContain("lucide-lock-keyhole");
    expect(icons[1]).toContain("lucide-shield-check");
    expect(icons[2]).toContain("lucide-circle-play");
});

test("compact send button preserves empty-draft and sending guards", () => {
    for (const [prompt, sending, disabled] of [
        ["", false, true],
        ["故事灵感", false, false],
        ["故事灵感", true, true],
    ] as const) {
        const html = renderToStaticMarkup(<AgentChatComposer prompt={prompt} sending={sending} placeholder="聊聊想法" theme={canvasThemes.dark} onPromptChange={noop} onSubmit={noop} />);
        const button = html.match(/<button\b[^>]*class="agent-composer-send [^"]*"[^>]*>/)?.[0];
        expect(button).toBeDefined();
        expect(button).toContain("h-7");
        expect(button?.includes('disabled=""')).toBe(disabled);
        expect(button).not.toContain("box-shadow:");
    }
});
