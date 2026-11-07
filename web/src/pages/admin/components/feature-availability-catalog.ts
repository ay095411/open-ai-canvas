import { Bot, Boxes, Clapperboard, Coins, ImageIcon, ListChecks, MessageCircleMore, MonitorCog, PlugZap, Quote, RadioTower, ShieldCheck, ShoppingBag, Video, type LucideIcon } from "lucide-react";
import type { FeatureAvailability, FeatureAvailabilityKey } from "@/stores/use-user-store";

export type FeatureRow = {
    key: FeatureAvailabilityKey;
    title: string;
    location: string;
    description: string;
    icon: LucideIcon;
    parent?: FeatureAvailabilityKey;
    requires?: FeatureAvailabilityKey[];
    link?: { to: string; label: string };
};

export const featureGroups: { title: string; description: string; icon: LucideIcon; rows: FeatureRow[] }[] = [
    {
        title: "创作功能",
        description: "电商Agent与创作影棚分别开放，开关互不影响。",
        icon: MonitorCog,
        rows: [
            {
                key: "imageWorkbenchEnabled",
                title: "影棚图片生成",
                location: "创作影棚 · 图片",
                description: "仅控制独立影棚图片生成与重试，不影响电商Agent、首页或自由画布。",
                icon: ImageIcon,
            },
            {
                key: "videoWorkbenchEnabled",
                title: "影棚视频生成",
                location: "创作影棚 · 视频",
                description: "仅控制独立影棚视频生成与重试，不影响电商项目、首页或自由画布。",
                icon: Video,
            },
            {
                key: "ecommerceEnabled",
                title: "电商Agent",
                location: "侧栏 · 电商Agent",
                description: "控制商品项目写入、识图、策划、出图与重试，不依赖影棚开关。关闭保留历史与已受理任务恢复。",
                icon: ShoppingBag,
                link: { to: "/admin/ecommerce/agent", label: "配置电商Agent模型" },
            },
            { key: "shortDramaEnabled", title: "短剧创作", location: "侧栏 · 短剧创作", description: "开放短剧入口、项目列表与项目详情；关闭不删除已有项目。", icon: Clapperboard },
        ],
    },
    {
        title: "插件与记录",
        description: "插件调用和任务记录分别控制，关闭任务中心不会停止生成。",
        icon: PlugZap,
        rows: [
            { key: "pluginCenterEnabled", title: "插件中心", location: "侧栏 · 插件中心", description: "开放插件中心及插件调用能力。", icon: PlugZap },
            {
                key: "systemPluginsVisibleToUsers",
                title: "系统插件可见性",
                location: "插件中心 · 系统插件",
                description: "向普通用户展示系统协议插件和管理员上传的插件。",
                icon: ShieldCheck,
                parent: "pluginCenterEnabled",
                requires: ["pluginCenterEnabled"],
            },
            { key: "taskCenterEnabled", title: "任务中心", location: "侧栏 · 任务中心", description: "开放任务记录页面；关闭不会停止已提交的生成任务。", icon: ListChecks },
        ],
    },
    {
        title: "模型与计费",
        description: "配置模型来源、个人渠道和积分计费规则。",
        icon: Boxes,
        rows: [
            { key: "frontendModelsEnabled", title: "用户模型目录", location: "生成面板 · 模型选择", description: "选择前台模型目录，或直接使用系统渠道中的模型。", icon: Boxes, link: { to: "/admin/models", label: "配置前台模型" } },
            { key: "customChannelsEnabled", title: "自定义渠道", location: "用户设置 · 自定义渠道", description: "允许用户配置并使用自己的模型渠道。", icon: RadioTower },
            { key: "creditsEnabled", title: "积分计费", location: "积分中心 · 任务计费", description: "控制积分中心及新任务的积分预授权与结算；关闭后小夜助手也不可用，已有冻结订单继续按原规则结算。", icon: Coins },
        ],
    },
    {
        title: "页面辅助",
        description: "小夜助手与全局 Agent 独立；小夜需继续完成自身配置。",
        icon: MessageCircleMore,
        rows: [
            {
                key: "siteAssistantEnabled",
                title: "小夜助手",
                location: "页面右下角 · 小夜",
                description: "原站内助手。开启此总开关后，还需在小夜配置中启用助手、设置可用模型和开放人群，并开启积分计费。",
                icon: MessageCircleMore,
                requires: ["creditsEnabled"],
                link: { to: "/admin/settings/yoru", label: "配置小夜助手" },
            },
            { key: "globalAgentEnabled", title: "全局 Agent", location: "页面右下角 · Agent", description: "控制自由画布以外页面的 Agent 悬浮入口；自由画布内 Agent 始终保留，与小夜助手独立。", icon: Bot },
            { key: "inspirationSourcesVisible", title: "素材来源署名", location: "创作首页 · 来源说明", description: "显示创作首页的素材来源说明面板。", icon: Quote },
        ],
    },
];

export const additionalTaskRows: FeatureRow[] = [
    {
        key: "ecommerceVideoEnabled",
        title: "电商项目视频任务",
        location: "当前无独立前台流程",
        description: "控制电商项目视频任务，需开启「电商Agent」，与影棚视频开关无关。当前电商页无独立视频流程。",
        icon: Video,
        requires: ["ecommerceEnabled"],
    },
];

export const featureByKey = new Map([...featureGroups.flatMap((group) => group.rows), ...additionalTaskRows].map((row) => [row.key, row]));

export function missingFeatureRequirements(features: FeatureAvailability, row: FeatureRow) {
    return (row.requires ?? []).filter((key) => !features[key]);
}

export function featureRowState(features: FeatureAvailability, row: FeatureRow) {
    if (missingFeatureRequirements(features, row).length) return "blocked";
    return features[row.key] ? "on" : "off";
}
