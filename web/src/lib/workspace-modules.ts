import { Boxes, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import { navigationTools } from "@/constant/navigation-tools";
import type { FeatureAvailability } from "@/stores/use-user-store";

export type WorkspaceModuleEntry = {
    id: string;
    title: string;
    hint: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }> | LucideIcon;
    to: string;
};

/** 每个模块一句话说明，作为 title 提示；标题与图标仍取自 navigationTools，避免两套文案。 */
const MODULE_HINTS: Record<string, string> = {
    inspirations: "浏览可复用的创意，一键带回创作区",
    projects: "从剧本到分镜的连续短剧生产",
    canvas: "节点式无限画布，反复推演构图",
    assets: "统一管理上传素材与生成结果",
    skills: "装配可复用的创作能力",
    plugins: "接入外部工具与数据源",
    tasks: "回看每一轮生成任务",
};

/**
 * 工作台模块入口的数据源。
 *
 * ⚠️ 侧栏整站下线后，首页的模块入口条是**页面之间唯一的常驻导航**。所以它不能是装饰：
 * 每一条都必须真的能到达对应路由，并且跟着功能开关（插件中心 / 任务中心）一起增减，
 * 否则界面上会留下「点不到」的入口。
 *
 * 创作自身（`/`）刻意不在列表里 —— 首页就是创作页，给自己加一个「回首页」的入口没有意义。
 * 兼容路由 `/create` 同理不进列表。
 */
export function buildWorkspaceModules(features: Pick<FeatureAvailability, "pluginCenterEnabled" | "taskCenterEnabled">): WorkspaceModuleEntry[] {
    const routes: Array<[string, string]> = [
        ["inspirations", "/inspirations"],
        ["projects", "/projects"],
        ["canvas", "/canvas"],
        ["assets", "/assets"],
        ["skills", "/skills"],
        ...(features.pluginCenterEnabled ? ([["plugins", "/plugins"]] as Array<[string, string]>) : []),
        ...(features.taskCenterEnabled ? ([["tasks", "/tasks"]] as Array<[string, string]>) : []),
    ];

    return routes.map(([slug, to]) => {
        const tool = navigationTools.find((item) => item.slug === slug);
        return {
            id: slug,
            title: tool?.label ?? slug,
            hint: MODULE_HINTS[slug] ?? "",
            icon: tool?.icon ?? Boxes,
            to,
        };
    });
}
