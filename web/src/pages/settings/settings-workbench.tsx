import { App, Button, InputNumber } from "antd";
import { SettingsRow } from "@/components/ui/product/settings-row";
import { ArrowLeft, Boxes, Brain, Bug, Cloud, MessageSquareText, RadioTower, SlidersHorizontal, Workflow } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { refreshSystemChannels } from "@/lib/user-session";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
import { SettingsPaneHeader } from "./settings-pane-header";
import { ModelDefaultGrid } from "./model-default-grid";
import { PromptPreferencesPane } from "./prompt-preferences-pane";
import DiagnosticsPanel from "./diagnostics-panel";
import AgentMemoryPane from "./agent-memory-pane";
import { RunningHubSettingsPane } from "./runninghub-settings-pane";

export type SettingsSectionKey = "channels" | "models" | "runninghub" | "preferences" | "prompts" | "agent-memory" | "storage" | "diagnostics";

/**
 * 分区清单是「页面版」和「弹窗版」唯一的真源：两个形态共用同一个数组和同一套文案，
 * 所以不存在「弹窗里少一个分区 / 顺序不一样」这种漂移。
 */
/**
 * 导航副标题一律控制在 8 个汉字以内：侧栏固定 200px，实测文字可用宽度 127px，
 * 13px 字号下 10 个字就会折成两行（「模型服务与个人工作流」「批准、添加、导出导入、压缩」
 * 原本都是两行，整列高度被撑得参差不齐）。折叠成行是这里唯一需要守的约束。
 */
export const settingsSections: Array<{ key: SettingsSectionKey; label: string; description: string; icon: ReactNode }> = [
    { key: "channels", label: "个人渠道", description: "模型服务与工作流", icon: <RadioTower className="size-4" /> },
    { key: "runninghub", label: "RunningHub 工作流", description: "云端工作流配置", icon: <Workflow className="size-4" /> },
    { key: "models", label: "模型选择", description: "按领域选默认模型", icon: <Boxes className="size-4" /> },
    { key: "preferences", label: "生成偏好", description: "画布生成默认值", icon: <SlidersHorizontal className="size-4" /> },
    { key: "prompts", label: "提示词偏好", description: "定制平台模板", icon: <MessageSquareText className="size-4" /> },
    { key: "agent-memory", label: "Agent 记忆", description: "记忆批准与压缩", icon: <Brain className="size-4" /> },
    { key: "storage", label: "我的对象存储", description: "个人媒体存储", icon: <Cloud className="size-4" /> },
    { key: "diagnostics", label: "问题诊断", description: "导出日志排查", icon: <Bug className="size-4" /> },
];

export function isSettingsSection(value: string | null): value is SettingsSectionKey {
    return settingsSections.some((section) => section.key === value);
}

export type SettingsWorkbenchProps = {
    /** page = 独立页面外壳；modal = 弹窗外壳。差异只在最外层 class 与关闭动作。 */
    variant: "page" | "modal";
    initialSection?: SettingsSectionKey;
    taskId?: string;
    projectId?: string;
    /** 画布「继续创作」流程：显示保存并返回，而不是普通关闭。 */
    continueCreation?: boolean;
    onClose?: () => void;
};

/**
 * 设置工作台：导航 + 内容。页面版（/settings 兜底）与弹窗版共用这一份实现，
 * 保证两处看到的分区、文案、交互完全一致。
 */
export function SettingsWorkbench({ variant, initialSection, taskId, projectId, continueCreation = false, onClose }: SettingsWorkbenchProps) {
    const { message } = App.useApp();
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const runningHubPluginEnabled = runtimeStatuses[RUNNINGHUB_PLUGIN_ID] === "enabled";
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");

    const visibleSections = useMemo(() => (customChannelsEnabled ? settingsSections : settingsSections.filter((section) => section.key !== "channels"))
        .filter((section) => section.key !== "runninghub" || runningHubPluginEnabled), [customChannelsEnabled, runningHubPluginEnabled]);

    const defaultSection = (): SettingsSectionKey => customChannelsEnabled ? "channels" : "models";
    const resolveInitial = (): SettingsSectionKey => {
        if (initialSection && visibleSections.some((section) => section.key === initialSection)) return initialSection;
        return defaultSection();
    };
    const [activeTab, setActiveTab] = useState<SettingsSectionKey>(resolveInitial);

    // 分区可能因功能开关而消失（个人渠道关闭、RunningHub 插件停用）：当前分区不可见时回落到默认分区。
    useEffect(() => {
        setActiveTab((current) => visibleSections.some((section) => section.key === current) ? current : defaultSection());
    }, [visibleSections]);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? `系统模型刷新失败：${error.message}` : "系统模型刷新失败，继续使用本地缓存");
        });
        return () => {
            cancelled = true;
        };
    }, [message, userId]);

    const selectSection = (section: SettingsSectionKey) => {
        if (section === "runninghub" && !runningHubPluginEnabled) return;
        setActiveTab(section);
    };

    const finishConfig = () => {
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const workflowReady = Boolean(runningHubPluginEnabled && config.runningHub.enabled && config.runningHub.workflowId.trim() && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim());
        if (!effectiveConfig.channels.some(isChannelReady) && !workflowReady) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (continueCreation ? "请先完成至少一个渠道的 Base URL、API Key 和模型配置" : "当前没有可用渠道，请先完成连接信息和模型配置") : "当前没有可用的系统模型，请联系管理员配置系统渠道");
            return;
        }
        message.success("配置已保存");
        onClose?.();
    };

    const panes: Record<SettingsSectionKey, ReactNode> = {
        channels: <SettingsPane><ChannelSettingsPane onOpenModels={() => selectSection("models")} onOpenRunningHub={runningHubPluginEnabled ? () => selectSection("runninghub") : undefined} /></SettingsPane>,
        models: (
            <SettingsPane>
                <SettingsPaneHeader title="模型选择" description="按领域选择默认模型；模型能力与请求协议在渠道“模型与能力”中配置。" />
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        runninghub: <SettingsPane><RunningHubSettingsPane /></SettingsPane>,
        preferences: (
            <SettingsPane>
                <SettingsPaneHeader title="生成偏好" description="设置新建生成任务时使用的初始值，节点内仍可单独覆盖。" />
                <div className="settings-section">
                    <section className="settings-preference-block">
                        <div className="settings-preference-heading">
                            <h3>画布生成</h3>
                            <p>用于新建图片生成任务，节点内仍可单独覆盖。</p>
                        </div>
                        <SettingsRow
                            label="默认生图张数"
                            control={
                                <InputNumber
                                    min={1}
                                    max={15}
                                    precision={0}
                                    className="w-full"
                                    value={Number(config.canvasImageCount)}
                                    onChange={(value) => updateConfig("canvasImageCount", normalizeImageCount(String(value ?? defaultConfig.canvasImageCount)))}
                                />
                            }
                            controlClassName="w-[200px]"
                        />
                    </section>
                </div>
            </SettingsPane>
        ),
        prompts: <SettingsPane fill><PromptPreferencesPane /></SettingsPane>,
        "agent-memory": (
            <SettingsPane>
                <SettingsPaneHeader title="Agent 记忆" description="只属于你。Agent 记下的先待批准；手动添加立刻生效。可导入导出，也可用文本模型压缩相近条目。" />
                <div className="settings-section">
                    <AgentMemoryPane />
                </div>
            </SettingsPane>
        ),
        diagnostics: <SettingsPane><DiagnosticsPanel taskId={taskId} projectId={projectId} /></SettingsPane>,
        storage: (
            <SettingsPane>
                <SettingsPaneHeader title="我的对象存储" description="启用后，新上传和新生成的媒体优先写入你的存储桶；停用时回退到平台存储。" />
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
    };

    const shellClass = variant === "modal"
        ? "settings-page settings-modal-shell"
        : "settings-page app-workspace-page app-user-workspace";
    // 独立页面保留 main 地标；弹窗里只是内容根，不抢占地标语义。
    const Shell = variant === "page" ? "main" : "div";

    return (
        <Shell className={`${shellClass} flex min-h-0 flex-col text-foreground`}>
            {/* 顶栏只在「继续创作」流程出现：普通打开时弹窗用自己的关闭按钮、页面用侧栏返回。 */}
            {continueCreation ? (
                <div className="settings-topbar shrink-0">
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button icon={<ArrowLeft className="size-4" />} onClick={() => onClose?.()}>返回创作</Button>
                        <Button type="primary" onClick={finishConfig}>保存并返回</Button>
                    </div>
                </div>
            ) : null}
            <div className="settings-library-frame flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="settings-nav-panel w-full shrink-0 md:w-[200px]">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:p-2.5" aria-label="配置分类">
                        {visibleSections.map((item) => {
                            const selected = item.key === activeTab;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`settings-nav-item flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:w-full md:items-start md:gap-3 md:py-2.5 ${selected ? "is-active" : "text-foreground/58 hover:bg-muted/55 hover:text-foreground"}`}
                                    onClick={() => selectSection(item.key)}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    <span className={`shrink-0 md:mt-0.5 ${selected ? "text-[var(--workspace-accent)]" : ""}`}>{item.icon}</span>
                                    <span className="min-w-0">
                                        {/* truncate 而不是 whitespace-nowrap：长标签（如 RunningHub 工作流）
                                            在 200px 侧栏里 nowrap 会撑出横向滚动条。 */}
                                        <span className="block truncate text-sm font-medium">{item.label}</span>
                                        <span className="mt-1 hidden text-[var(--fs-label)] leading-4 text-current opacity-65 md:block">{item.description}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>
                <section className="settings-content flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
                        <div className={`settings-pane-root ${activeTab === "prompts" ? "h-full w-full" : "mx-auto w-full max-w-none"}`}>
                            {panes[activeTab]}
                        </div>
                    </div>
                </section>
            </div>
        </Shell>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "settings-pane h-full" : "settings-pane"}>{children}</div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}
