import { useState } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, Bot, Check, Clapperboard, Copy, Flame, MessageSquare, Send, Sparkles, Wand2, Zap } from "lucide-react";
import type { DramaEpisodeDetail, DramaEpisodeRow, DramaSummary } from "@/services/api/drama";

interface AgentDirectorPanelProps {
    projectId: string;
    summary: DramaSummary;
    episode?: DramaEpisodeRow;
    detail?: DramaEpisodeDetail;
    onLocateShot: (shotId: string) => void;
}

interface DirectorMessage {
    id: string;
    role: "agent" | "user";
    text: string;
    actionable?: {
        label: string;
        copyText: string;
    };
}

/**
 * 短剧 Agent 专属编导工作台：
 * 提供镜头冲突强化、台词语气打磨、电影级运镜扩写与爽点节拍自检四大核心能力；
 * 创作者可直接与短剧智能体对话，协同推进分镜与提示词迭代。
 */
export function AgentDirectorPanel({
    summary,
    episode,
    detail,
    onLocateShot,
}: AgentDirectorPanelProps) {
    const { message } = App.useApp();
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [messages, setMessages] = useState<DirectorMessage[]>(() => [
        {
            id: "welcome",
            role: "agent",
            text: `你好！我是《${summary.project.name}》的专属短剧 Agent 编导。当前正在协同第 ${episode?.number || 1} 集《${episode?.title || "未命名"}》。你可以随时让我帮你：强化悬念冲突、重写镜头运镜、或者为特定角色润色对白。`,
        },
    ]);

    const presets = [
        {
            icon: Flame,
            title: "强化冲突节奏",
            prompt: `请帮我检视第 ${episode?.number || 1} 集的分镜节奏，指出节奏平淡的段落，并给出增强戏剧冲突的方案。`,
        },
        {
            icon: MessageSquare,
            title: "台词与语气润色",
            prompt: `请优化当前集的人物对白，去掉多余解释性台词，让主角对白更有力道、反派更具压迫感。`,
        },
        {
            icon: Clapperboard,
            title: "专业运镜提示词",
            prompt: `请为当前集的核心高潮镜头提供电影级运镜描述（包含景别变换、光影氛围与升格镜头）。`,
        },
        {
            icon: Zap,
            title: "钩子与爽点自检",
            prompt: `请分析当前集结尾的留白与悬念钩子，确保能有效吸引观众点击下一集。`,
        },
    ];

    const sendDirective = (text: string) => {
        const query = text.trim();
        if (!query || busy) return;
        setInput("");
        const userMsg: DirectorMessage = { id: `u-${Date.now()}`, role: "user", text: query };
        setMessages((prev) => [...prev, userMsg]);
        setBusy(true);

        // 模拟智能编导的结构化建议
        window.setTimeout(() => {
            let replyText = "";
            let actionText = "";

            if (query.includes("冲突") || query.includes("节奏")) {
                replyText = `【编导建议 · 节奏增强】建议将第 ${episode?.number || 1} 集的第 2 剧情段情绪前置。在第 1 镜头直接展示对立结果，缩短铺垫时间（建议由 6 秒收缩到 4 秒），随后由主角的一句简短台词反击破局，节奏更符合快节奏爆款短剧规律。`;
                actionText = "推镜头急速推进，特写人物冷峻眼神，光影从暗处骤亮，情绪紧绷一触即发。";
            } else if (query.includes("台词") || query.includes("对白")) {
                replyText = `【台词优化建议】当前角色的内心戏较多，建议改为行为驱动。将“我早就知道你们的算计”改为冷笑后的简短两个字：“就这？”，其余留给环境特写和冷色调侧光渲染。`;
                actionText = "主角嘴角微挑，冷峻不语，目光如刀锋般扫过全场。";
            } else if (query.includes("运镜") || query.includes("镜头")) {
                replyText = `【运镜提示词升级方案】建议采用连续升格跟镜头：\nSlow push-in cinematic close-up, dramatic split lighting, high contrast, shallow depth of field, 4k master shot.`;
                actionText = "Slow push-in cinematic close-up, dramatic split lighting, high contrast, shallow depth of field, 4k master shot.";
            } else {
                replyText = `【编导分析】已记录你的编导构思。建议保持本集单集时长在 90 秒内，当前已规划 ${detail?.shots.length || 0} 个镜头，重点把控第 1 镜的 3 秒吸睛率与结尾的断章悬念。`;
                actionText = query;
            }

            const agentReply: DirectorMessage = {
                id: `a-${Date.now()}`,
                role: "agent",
                text: replyText,
                actionable: actionText ? { label: "复制建议提示词", copyText: actionText } : undefined,
            };
            setMessages((prev) => [...prev, agentReply]);
            setBusy(false);
        }, 600);
    };

    const copyText = (text: string) => {
        void navigator.clipboard.writeText(text);
        message.success("建议已复制到剪贴板，可粘贴到分镜卡中使用");
    };

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
            {/* 顶部标题栏 */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
                <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Sparkles className="size-4" />
                    </span>
                    <strong className="text-sm font-semibold text-foreground">短剧 Agent 编导协同</strong>
                    <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[11px] text-muted-foreground">
                        第 {episode?.number || 1} 集 · {episode?.title || "制作中"}
                    </span>
                </div>
            </div>

            {/* 快捷指令胶囊 */}
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-foreground/[.02] px-5 py-2.5 scrollbar-none">
                <span className="shrink-0 text-xs font-medium text-muted-foreground">编导快捷指令：</span>
                {presets.map((preset) => {
                    const Icon = preset.icon;
                    return (
                        <button
                            key={preset.title}
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-all hover:border-foreground/30 hover:bg-foreground/[.04]"
                            onClick={() => sendDirective(preset.prompt)}
                        >
                            <Icon className="size-3.5 text-primary" />
                            <span>{preset.title}</span>
                        </button>
                    );
                })}
            </div>

            {/* 消息历史流 */}
            <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                    >
                        <span
                            className={`grid size-8 shrink-0 place-items-center rounded-xl text-xs font-semibold ${
                                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-foreground"
                            }`}
                        >
                            {msg.role === "user" ? "我" : <Bot className="size-4" />}
                        </span>
                        <div
                            className={`flex max-w-[85%] flex-col gap-2 rounded-2xl p-4 text-xs leading-relaxed ${
                                msg.role === "user"
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border bg-foreground/[.03] text-foreground"
                            }`}
                        >
                            <p className="m-0 whitespace-pre-wrap">{msg.text}</p>
                            {msg.actionable ? (
                                <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-background/80 p-2.5 text-foreground backdrop-blur-sm">
                                    <span className="truncate text-[11px] text-muted-foreground font-mono">
                                        {msg.actionable.copyText}
                                    </span>
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={<Copy className="size-3" />}
                                        onClick={() => copyText(msg.actionable!.copyText)}
                                    >
                                        复制应用
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>

            {/* 底部输入框 */}
            <div className="shrink-0 border-t border-border bg-foreground/[.02] p-4">
                <div className="flex items-center gap-2">
                    <Input
                        className="!h-10 !rounded-xl"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPressEnter={() => sendDirective(input)}
                        placeholder="向短剧 Agent 下达编导指令，例如：把反派的台词改成冷笑讽刺、重写第2段提示词..."
                        disabled={busy}
                    />
                    <Button
                        type="primary"
                        className="!h-10 !rounded-xl !px-4"
                        icon={<Send className="size-4" />}
                        loading={busy}
                        disabled={!input.trim()}
                        onClick={() => sendDirective(input)}
                    >
                        发送
                    </Button>
                </div>
            </div>
        </div>
    );
}
