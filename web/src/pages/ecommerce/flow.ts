/**
 * 电商创作的一条完整流程：准备素材 → 选视觉方向 → 确认方案 → 生成图片 → 交付。
 * 页面状态很多，这里只把它们折算成「现在在哪一步、这一步在做什么」，供进度条和下一步提示共用。
 */
export type CommerceFlowStepKey = "material" | "direction" | "plan" | "generate" | "deliver";
export type CommerceFlowStepStatus = "done" | "current" | "todo";
export type CommerceFlowStep = { key: CommerceFlowStepKey; label: string; status: CommerceFlowStepStatus; detail: string; running: boolean };

export type CommerceFlowInput = {
    /** 直接生成的旧项目：没有方向和方案两步。 */
    direct: boolean;
    hasProduct: boolean;
    hasInstruction: boolean;
    directionsLoading: boolean;
    /** 四套方向已经出来，等用户选。 */
    directionsReady: boolean;
    directionChosen: boolean;
    planningPending: boolean;
    /** 本轮方案已经写好（还没提交出图也算）。 */
    planReady: boolean;
    planCount: number;
    submitted: number;
    completed: number;
    failed: number;
    active: number;
};

const labels: Record<CommerceFlowStepKey, string> = {
    material: "准备素材",
    direction: "选视觉方向",
    plan: "图片方案",
    generate: "生成图片",
    deliver: "导出交付",
};

function currentStep(input: CommerceFlowInput): CommerceFlowStepKey {
    // 正在进行的分析优先：上一轮已交付后继续下一组时，进度回到选方向 / 策划。
    if (!input.direct && input.planningPending) return "plan";
    if (!input.direct && (input.directionsLoading || input.directionsReady)) return "direction";
    if (input.submitted > 0) return input.planCount > 0 && input.completed >= input.planCount ? "deliver" : "generate";
    if (input.direct) return input.hasProduct && input.hasInstruction ? "generate" : "material";
    if (input.planReady || input.directionChosen) return "plan";
    return input.hasProduct && input.hasInstruction ? "direction" : "material";
}

function stepDetail(key: CommerceFlowStepKey, input: CommerceFlowInput): string {
    switch (key) {
        case "material":
            return !input.hasProduct ? "添加商品图，填写画面描述" : "填写画面描述";
        case "direction":
            return input.directionsLoading ? "正在推荐 4 套方向，可离开页面" : input.directionsReady ? "选择方向后自动策划、出图" : "推荐 4 套方向，或跳过选方向";
        case "plan":
            if (input.planningPending) return `正在策划，${input.directionChosen ? "完成后自动出图" : "完成后可审阅方案"}`;
            return input.planReady ? `方案共 ${input.planCount} 张，审阅后确认出图` : "按选定方向生成图片方案";
        case "generate":
            if (!input.submitted) return input.direct ? "确认后直接按设置出图" : "确认方案后逐张出图";
            return `已完成 ${input.completed} / ${input.planCount} 张${input.failed ? `，${input.failed} 张失败可重试` : ""}`;
        case "deliver":
            return "作品已保存，可导出或继续创作";
    }
}

export function resolveCommerceFlow(input: CommerceFlowInput): CommerceFlowStep[] {
    const keys: CommerceFlowStepKey[] = input.direct ? ["material", "generate", "deliver"] : ["material", "direction", "plan", "generate", "deliver"];
    const current = keys.indexOf(currentStep(input));
    return keys.map((key, index) => {
        // 交付是终点：到了这一步就算完成，同时保持高亮提示下一步可做的事。
        const status: CommerceFlowStepStatus = index < current ? "done" : index === current ? "current" : "todo";
        const running = status === "current" && ((key === "direction" && input.directionsLoading) || (key === "plan" && input.planningPending) || (key === "generate" && input.active > 0));
        return { key, label: labels[key], status, detail: status === "todo" ? "" : stepDetail(key, input), running };
    });
}

/** 当前这一步的说明，作品区空态和进度条共用同一句话。 */
export function commerceFlowNextStep(steps: CommerceFlowStep[]) {
    return steps.find((step) => step.status === "current")?.detail || "";
}
