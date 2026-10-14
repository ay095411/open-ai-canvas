import { ArrowUpRight, Clock3, FolderOpen, LayoutGrid, PlugZap, WandSparkles } from "lucide-react";
import { useNavigate } from "react-router";
import "./creation-home-feature-matrix.css";

interface CreationHomeFeatureMatrixProps {
    onOpenAgent: () => void;
    onCreateCanvas: () => void;
}

/**
 * 四个能力入口。封面复用短剧风格图：这一带与上方画廊同宽，纯图标撑不起这个尺度，
 * 配一张封面才和画廊连成一条内容带；图标压在封面上保留入口语义，不让照片盖掉"去哪儿"。
 */
const capabilities = [
    {
        title: "技能工坊",
        tag: "Skills",
        description: "沉淀与复用专业影视工作流与定制方法库。",
        icon: WandSparkles,
        iconClassName: "is-skills",
        cover: "/short-drama-styles/ink-narrative.jpg",
        route: "/skills",
    },
    {
        title: "素材资产库",
        tag: "Assets",
        description: "管理角色设定卡、参考原画与视频片段。",
        icon: FolderOpen,
        iconClassName: "is-assets",
        cover: "/short-drama-styles/period-live-action.jpg",
        route: "/assets",
    },
    {
        title: "插件中心",
        tag: "Plugins",
        description: "连接模型供应商与第三方工作流应用扩展。",
        icon: PlugZap,
        iconClassName: "is-plugins",
        cover: "/short-drama-styles/future-tech.jpg",
        route: "/plugins",
    },
    {
        title: "任务与历史",
        tag: "Tasks",
        description: "追踪云端异步生成任务，随时回溯历史版本。",
        icon: Clock3,
        iconClassName: "is-tasks",
        cover: "/short-drama-styles/space-opera.jpg",
        route: "/tasks",
    },
] as const;

export function CreationHomeFeatureMatrix({
    onOpenAgent,
    onCreateCanvas,
}: CreationHomeFeatureMatrixProps) {
    const navigate = useNavigate();

    const handleKeyboardAction = (event: React.KeyboardEvent, action: () => void) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            action();
        }
    };

    return (
        <section className="creation-feature-matrix" aria-label="核心创作与工具能力">
            <div className="creation-feature-layout">
                <article
                    className="creation-feature-lead"
                    role="button"
                    tabIndex={0}
                    onClick={onOpenAgent}
                    onKeyDown={(event) => handleKeyboardAction(event, onOpenAgent)}
                >
                    <div className="creation-feature-lead-media" aria-hidden="true" />
                    <div className="creation-feature-lead-scrim" aria-hidden="true" />
                    <div className="creation-feature-lead-content">
                        <div className="creation-feature-lead-copy">
                            <h2>短剧 Agent 创作助手</h2>
                            <p>从一句想法拆解剧本大纲、角色画像与多镜头分镜，全流程智能化影视协同。</p>
                        </div>
                        <div className="creation-feature-lead-actions">
                            <button
                                type="button"
                                className="creation-feature-lead-primary"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenAgent();
                                }}
                            >
                                <span>与 Agent 开启创作</span>
                                <ArrowUpRight className="size-4" />
                            </button>
                            <button
                                type="button"
                                className="creation-feature-lead-secondary"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onCreateCanvas();
                                }}
                            >
                                <LayoutGrid className="size-3.5" />
                                <span>新建空白画布</span>
                            </button>
                        </div>
                    </div>
                </article>

                <div className="creation-capability-panel">
                    <div className="creation-capability-list">
                        {capabilities.map((capability) => {
                            const Icon = capability.icon;
                            const openCapability = () => navigate(capability.route);
                            return (
                                <div
                                    key={capability.route}
                                    className="creation-cap-card"
                                    role="button"
                                    tabIndex={0}
                                    onClick={openCapability}
                                    onKeyDown={(event) => handleKeyboardAction(event, openCapability)}
                                >
                                    <div className={`creation-cap-card-thumb ${capability.iconClassName}`} aria-hidden="true">
                                        <img src={capability.cover} alt="" loading="lazy" decoding="async" draggable={false} />
                                        <span className="creation-cap-card-thumb-icon">
                                            <Icon className="size-4" />
                                        </span>
                                    </div>
                                    <div className="creation-cap-card-content">
                                        <div className="creation-cap-card-heading">
                                            <h3>{capability.title}</h3>
                                            <span className="creation-cap-card-tag">{capability.tag}</span>
                                        </div>
                                        <p className="creation-cap-card-desc">{capability.description}</p>
                                    </div>
                                    <div className="creation-cap-card-arrow" aria-hidden="true">
                                        <ArrowUpRight className="size-4" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
