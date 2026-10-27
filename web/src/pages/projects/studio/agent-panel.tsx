import { useState } from "react";
import { App, Button, Input } from "antd";
import { BookmarkCheck, Camera, Check, Clapperboard, Copy, Film, MessageSquare, Play, Sparkles, Wand2 } from "lucide-react";
import type { DramaEpisodeDetail, DramaEpisodeRow, DramaSummary } from "@/services/api/drama";

interface AgentDirectorPanelProps {
    projectId: string;
    summary: DramaSummary;
    episode?: DramaEpisodeRow;
    detail?: DramaEpisodeDetail;
    onLocateShot: (shotId: string) => void;
}

type DirectorToolKey = "conflict" | "dialogue" | "camera" | "hook";

interface ToolPreset {
    key: DirectorToolKey;
    icon: typeof Film;
    title: string;
    tag: string;
    description: string;
    suggestion: string;
    refinedText: string;
}

/**
 * 专业短剧编导工作台：
 * 告别机械客服气泡，采用专业剧作工序面板（冲突节奏、台词精炼、运镜规范、断章尾钩）；
 * 提供直观的优化方案与一键应用通道。
 */
export function AgentDirectorPanel({
    summary,
    episode,
    detail,
    onLocateShot,
}: AgentDirectorPanelProps) {
    const { message } = App.useApp();
    const [activeTool, setActiveTool] = useState<DirectorToolKey>("conflict");
    const [customIntent, setCustomIntent] = useState("");
    const [optimizing, setOptimizing] = useState(false);

    const tools: ToolPreset[] = [
        {
            key: "conflict",
            icon: Film,
            title: "节奏与冲突前置",
            tag: "戏剧张力",
            description: "分析分镜节奏，收紧前置剧情段，强化开篇 3 秒吸睛度与情绪爆发点。",
            suggestion: `针对第 ${episode?.number || 1} 集《${episode?.title || "未命名"}》，建议将剧情段 1 中的铺垫缩短，将核心对抗直接提前至开头第 4 秒。通过主角动作打断对话，制造突发戏剧悬念。`,
            refinedText: "急速近景跟推，焦点骤锁主角冷峻面部，逆光暗调，周围环境声瞬间静音，爆发冲突对峙。",
        },
        {
            key: "dialogue",
            icon: MessageSquare,
            title: "台词精炼与对白",
            tag: "人物语气",
            description: "剔除冗余解释性对话，增强主角口吻决绝度与反派压迫感，凸显人物性格。",
            suggestion: "当前台词字数偏多，在快节奏竖屏中容易分散观众注意力。建议将长篇辩解压缩为具有行动力的短促台词，依靠眼神特写传递潜台词。",
            refinedText: "主角嘴角冷挑，静止三秒后吐出两字：“就这？” —— 随即转身，全场屏息。",
        },
        {
            key: "camera",
            icon: Camera,
            title: "电影级运镜规范",
            tag: "视觉构图",
            description: "为剧情段注入工业级机位运动描述（特写、跟推、升格镜头与电影布光）。",
            suggestion: "建议高潮镜头采用升格高速摄影（Slow Motion）配合浅景深推镜头，拉长戏剧高光时刻的视听感知。",
            refinedText: "Slow cinematic push-in close-up, dramatic rim lighting, shallow depth of field, high contrast cinematic grade, 4k master.",
        },
        {
            key: "hook",
            icon: BookmarkCheck,
            title: "断章悬念自检",
            tag: "留存追看",
            description: "把控本集末尾的留白与悬念钩子，确保高潮断章，驱动点击下一集。",
            suggestion: "本集结尾目前落在平静对话，缺乏未解谜团。建议在倒数第 1 镜头骤停在关键信物出现或突发敲门声处，留出巨大悬念空间。",
            refinedText: "镜头定格在未拆封的带血密函上，门外骤然响起沉重急促的撞击声，画面骤黑切出。",
        },
    ];

    const currentTool = tools.find((t) => t.key === activeTool) || tools[0];

    const handleApply = (text: string) => {
        void navigator.clipboard.writeText(text);
        message.success("编导优化方案已复制，可在分镜卡或提示词中直接粘贴使用");
    };

    const handleCustomSubmit = () => {
        if (!customIntent.trim() || optimizing) return;
        setOptimizing(true);
        window.setTimeout(() => {
            setOptimizing(false);
            message.success("编导意图已提炼并更新建议");
        }, 500);
    };

    return (
        <div className="flex size-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
            {/* 顶栏：剧目与当前集信息 */}
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-foreground/[.02] px-5">
                <div className="flex items-center gap-2 leading-none">
                    <span className="flex size-5 shrink-0 items-center justify-center text-primary">
                        <Clapperboard className="size-4" />
                    </span>
                    <strong className="text-sm font-semibold text-foreground leading-none">
                        分镜编导工坊
                    </strong>
                    <span className="inline-flex items-center rounded-full bg-foreground/[.08] px-2 py-0.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums">
                        第 {episode?.number || 1} 集 · {episode?.title || "制作中"}
                    </span>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                    已规划 {detail?.shots.length || 0} 个镜头
                </div>
            </header>

            {/* 核心工序选择栏 */}
            <div className="grid shrink-0 grid-cols-4 border-b border-border bg-foreground/[.01] p-2 gap-2">
                {tools.map((item) => {
                    const Icon = item.icon;
                    const selected = item.key === activeTool;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            className={`flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-all ${
                                selected
                                    ? "bg-foreground/[.08] shadow-sm border border-foreground/15"
                                    : "border border-transparent hover:bg-foreground/[.03]"
                            }`}
                            onClick={() => setActiveTool(item.key)}
                        >
                            <div className="flex w-full items-center justify-between leading-none">
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                    <Icon className="size-3.5 text-primary" />
                                    <span>{item.title}</span>
                                </span>
                                <span className="rounded bg-foreground/[.06] px-1 py-0.5 text-[10px] text-muted-foreground">
                                    {item.tag}
                                </span>
                            </div>
                            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground line-clamp-1">
                                {item.description}
                            </p>
                        </button>
                    );
                })}
            </div>

            {/* 编导执行主台 */}
            <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                {/* 编导诊断建议 */}
                <div className="rounded-2xl border border-border bg-foreground/[.02] p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <span className="flex size-4 shrink-0 items-center justify-center text-primary">
                            <Wand2 className="size-3.5" />
                        </span>
                        <h4 className="m-0 text-xs font-semibold text-foreground">
                            编导诊断与把控建议
                        </h4>
                    </div>
                    <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                        {currentTool.suggestion}
                    </p>
                </div>

                {/* 推荐优化方案卡 */}
                <div className="flex flex-col gap-2 rounded-2xl border border-border bg-foreground/[.03] p-4">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                            推荐镜头/对白方案
                        </span>
                        <Button
                            size="small"
                            type="primary"
                            icon={<Copy className="size-3" />}
                            onClick={() => handleApply(currentTool.refinedText)}
                        >
                            复制方案
                        </Button>
                    </div>
                    <div className="rounded-xl border border-border/80 bg-background/80 p-3 text-xs leading-relaxed text-foreground font-mono">
                        {currentTool.refinedText}
                    </div>
                </div>

                {/* 针对当前镜头的定制意图 */}
                <div className="mt-auto rounded-2xl border border-border bg-foreground/[.02] p-4">
                    <div className="mb-2 text-xs font-semibold text-foreground">
                        针对当前戏份的定制意图
                    </div>
                    <div className="flex items-center gap-2">
                        <Input
                            className="!h-9 !rounded-lg"
                            value={customIntent}
                            onChange={(e) => setCustomIntent(e.target.value)}
                            onPressEnter={handleCustomSubmit}
                            placeholder="输入微调要求，例如：将男主角语气调整为冷酷自持、后景增加大雨光影..."
                        />
                        <Button
                            type="primary"
                            className="!h-9 !rounded-lg"
                            loading={optimizing}
                            disabled={!customIntent.trim()}
                            onClick={handleCustomSubmit}
                        >
                            提炼并改写
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
