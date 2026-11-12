import { App, Button } from "antd";
import { ArrowLeft, Boxes, Brain, Bug, Cloud, Inbox, MessageSquareText, RadioTower, ShieldCheck, SlidersHorizontal, UserRound, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { secretKeyProtocolIds, useUserProtocolCatalog } from "@/hooks/use-user-protocol-catalog";
import { refreshSystemChannels } from "@/lib/user-session";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { arkPortraitOverviewQueryKey, getArkPortraitOverview } from "@/services/api/ark-portraits";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
import { SettingsPaneHeader } from "./settings-pane-header";
import { ModelDefaultGrid } from "./model-default-grid";
import { ProfilePane } from "./profile-pane";
import { PromptPreferencesPane } from "./prompt-preferences-pane";
import DiagnosticsPanel from "./diagnostics-panel";
import AgentMemoryPane from "./agent-memory-pane";
const RunningHubSettingsPane = lazy(() => import("./runninghub-settings-pane").then((module) => ({ default: module.RunningHubSettingsPane })));
import { FeedbackInboxPane } from "./feedback-inbox-pane";
import { ArkAssetsPane } from "./ark-assets-pane";
import { PreferencesPane } from "./preferences-pane";

export type SettingsSectionKey = "profile" | "channels" | "models" | "runninghub" | "preferences" | "prompts" | "agent-memory" | "storage" | "ark-assets" | "diagnostics" | "feedbacks";

/**
 * 分区清单是「页面版」和「弹窗版」唯一的真源：两个形态共用同一个数组和同一套文案，
 * 所以不存在「弹窗里少一个分区 / 顺序不一样」这种漂移。
 */
const settingsSectionGroups = [
    { key: "account", label: "账户" },
    { key: "creation", label: "创作" },
    { key: "support", label: "支持" },
] as const;

type SettingsSectionGroup = (typeof settingsSectionGroups)[number]["key"];

export const settingsSections: Array<{ key: SettingsSectionKey; group: SettingsSectionGroup; label: string; description: string; icon: ReactNode }> = [
    { key: "profile", group: "account", label: "个人信息", description: "头像、密码与邮箱", icon: <UserRound className="size-4" /> },
    { key: "channels", group: "creation", label: "个人渠道", description: "模型服务与工作流", icon: <RadioTower className="size-4" /> },
    { key: "runninghub", group: "creation", label: "RunningHub 工作流", description: "云端工作流配置", icon: <Workflow className="size-4" /> },
    { key: "models", group: "creation", label: "模型选择", description: "按领域选默认模型", icon: <Boxes className="size-4" /> },
    { key: "preferences", group: "creation", label: "偏好设置", description: "外观、通知与生成默认值", icon: <SlidersHorizontal className="size-4" /> },
    { key: "prompts", group: "creation", label: "提示词偏好", description: "定制平台模板", icon: <MessageSquareText className="size-4" /> },
    { key: "agent-memory", group: "creation", label: "Agent 记忆", description: "记忆文档与历史", icon: <Brain className="size-4" /> },
    { key: "storage", group: "account", label: "我的对象存储", description: "个人媒体存储", icon: <Cloud className="size-4" /> },
    { key: "ark-assets", group: "account", label: "方舟素材库", description: "真人认证与专属素材", icon: <ShieldCheck className="size-4" /> },
    { key: "diagnostics", group: "support", label: "问题诊断", description: "导出日志排查", icon: <Bug className="size-4" /> },
    { key: "feedbacks", group: "support", label: "我的反馈", description: "提交问题与官方答复", icon: <Inbox className="size-4" /> },
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
    const protocolCatalog = useUserProtocolCatalog(customChannelsEnabled);
    const secretKeyProtocols = useMemo(() => secretKeyProtocolIds(protocolCatalog), [protocolCatalog]);
    // 加载中或读取失败时仅保留直达入口，由素材页显示加载与重试；不开默认权限。
    const arkOverviewQuery = useQuery({ queryKey: arkPortraitOverviewQueryKey, queryFn: ({ signal }) => getArkPortraitOverview(signal), enabled: Boolean(userId), staleTime: 60_000 });
    const arkAssetsVisible = arkOverviewQuery.data ? arkOverviewQuery.data.enabled : initialSection === "ark-assets";

    const visibleSections = useMemo(
        () =>
            (customChannelsEnabled ? settingsSections : settingsSections.filter((section) => section.key !== "channels"))
                .filter((section) => section.key !== "runninghub" || runningHubPluginEnabled)
                .filter((section) => section.key !== "ark-assets" || arkAssetsVisible),
        [arkAssetsVisible, customChannelsEnabled, runningHubPluginEnabled],
    );

    const defaultSection = (): SettingsSectionKey => (customChannelsEnabled ? "channels" : "models");
    const resolveInitial = (): SettingsSectionKey => {
        if (initialSection && visibleSections.some((section) => section.key === initialSection)) return initialSection;
        return defaultSection();
    };
    const [activeTab, setActiveTab] = useState<SettingsSectionKey>(resolveInitial);

    // 分区可能因功能开关而消失（个人渠道关闭、RunningHub 插件停用）：当前分区不可见时回落到默认分区。
    useEffect(() => {
        setActiveTab((current) => (visibleSections.some((section) => section.key === current) ? current : defaultSection()));
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
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel, secretKeyProtocols)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel, secretKeyProtocols)}`);
            focusInvalidChannelField(invalidChannel, secretKeyProtocols);
            return;
        }
        const workflowReady = Boolean(runningHubPluginEnabled && config.runningHub.enabled && config.runningHub.workflowId.trim() && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim());
        if (!effectiveConfig.channels.some((channel) => isChannelReady(channel, secretKeyProtocols)) && !workflowReady) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (continueCreation ? "请先完成至少一个渠道的 Base URL、API Key 和模型配置" : "当前没有可用渠道，请先完成连接信息和模型配置") : "当前没有可用的系统模型，请联系管理员配置系统渠道");
            return;
        }
        message.success("配置已保存");
        onClose?.();
    };

    const panes: Record<SettingsSectionKey, ReactNode> = {
        profile: (
            <SettingsPane>
                <ProfilePane key={userId} />
            </SettingsPane>
        ),
        channels: (
            <SettingsPane>
                <ChannelSettingsPane onOpenModels={() => selectSection("models")} onOpenRunningHub={runningHubPluginEnabled ? () => selectSection("runninghub") : undefined} />
            </SettingsPane>
        ),
        models: (
            <SettingsPane>
                <SettingsPaneHeader title="模型选择" description="按领域选择默认模型；模型能力与请求协议在渠道“模型与能力”中配置。" />
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        runninghub: runningHubPluginEnabled ? (
            <SettingsPane>
                <Suspense fallback={<span role="status">正在加载工作流配置…</span>}>
                    <RunningHubSettingsPane />
                </Suspense>
            </SettingsPane>
        ) : null,
        preferences: (
            <SettingsPane>
                <PreferencesPane />
            </SettingsPane>
        ),
        prompts: (
            <SettingsPane fill>
                <PromptPreferencesPane />
            </SettingsPane>
        ),
        "agent-memory": (
            <SettingsPane>
                <SettingsPaneHeader title="Agent 记忆" description="管理仅属于你的长期记忆文档，设置更新方式，编辑内容并查看或撤销修改历史。" />
                <div className="settings-section">
                    <AgentMemoryPane />
                </div>
            </SettingsPane>
        ),
        diagnostics: (
            <SettingsPane>
                <DiagnosticsPanel taskId={taskId} projectId={projectId} />
            </SettingsPane>
        ),
        feedbacks: (
            <SettingsPane>
                <FeedbackInboxPane />
            </SettingsPane>
        ),
        "ark-assets": (
            <SettingsPane>
                <ArkAssetsPane />
            </SettingsPane>
        ),
        storage: (
            <SettingsPane>
                <SettingsPaneHeader title="我的对象存储" description="启用后，新上传和新生成的媒体优先写入你的存储桶；停用时回退到平台存储。" />
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
    };

    const shellClass = variant === "modal" ? "settings-page settings-modal-shell" : "settings-page app-workspace-page app-user-workspace";
    // 独立页面保留 main 地标；弹窗里只是内容根，不抢占地标语义。
    const Shell = variant === "page" ? "main" : "div";

    return (
        <Shell className={`${shellClass} flex min-h-0 flex-col text-foreground`}>
            {/* 顶栏只在「继续创作」流程出现：普通打开时弹窗用自己的关闭按钮、页面用侧栏返回。 */}
            {continueCreation ? (
                <div className="settings-topbar shrink-0">
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button icon={<ArrowLeft className="size-4" />} onClick={() => onClose?.()}>
                            返回创作
                        </Button>
                        <Button type="primary" onClick={finishConfig}>
                            保存并返回
                        </Button>
                    </div>
                </div>
            ) : null}
            <div className="settings-library-frame flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="settings-nav-panel">
                    <nav className="settings-nav thin-scrollbar" aria-label="配置分类">
                        {settingsSectionGroups.map((group) => {
                            const items = visibleSections.filter((item) => item.group === group.key);
                            if (!items.length) return null;
                            return (
                                <div key={group.key} className="settings-nav-group">
                                    <span className="settings-nav-group-label" aria-hidden>
                                        {group.label}
                                    </span>
                                    {items.map((item) => {
                                        const selected = item.key === activeTab;
                                        return (
                                            <button
                                                key={item.key}
                                                type="button"
                                                className={`settings-nav-item${selected ? " is-active" : ""}`}
                                                onClick={() => selectSection(item.key)}
                                                aria-current={selected ? "page" : undefined}
                                                aria-pressed={selected}
                                                title={item.description}
                                            >
                                                <span className="settings-nav-icon" aria-hidden>
                                                    {item.icon}
                                                </span>
                                                <span className="settings-nav-label">{item.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </nav>
                </aside>
                <section className="settings-content flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="settings-content-scroll app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        <div className={`settings-pane-root ${activeTab === "prompts" ? "h-full w-full" : "mx-auto w-full max-w-none"}`}>{panes[activeTab]}</div>
                    </div>
                </section>
            </div>
        </Shell>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "settings-pane h-full" : "settings-pane"}>{children}</div>;
}
