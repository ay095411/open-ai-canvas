export type AgentPanelLayout = { left: number; top: number; width: number; height: number };
export type AgentPanelViewport = { width: number; height: number };
export type AgentPanelGesture = "move" | "north" | "west" | "northwest";

export const AGENT_PANEL_LAYOUT_KEY = "canvas:agent-panel-layout:v1";
const MARGIN = 12;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function clampAgentPanelLayout(layout: AgentPanelLayout, viewport: AgentPanelViewport): AgentPanelLayout {
    const maxWidth = Math.max(1, viewport.width - MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - MARGIN * 2);
    const width = clamp(layout.width, Math.min(360, maxWidth), maxWidth);
    const height = clamp(layout.height, Math.min(420, maxHeight), maxHeight);
    return {
        width,
        height,
        left: clamp(layout.left, MARGIN, Math.max(MARGIN, viewport.width - width - MARGIN)),
        top: clamp(layout.top, MARGIN, Math.max(MARGIN, viewport.height - height - MARGIN)),
    };
}

export function restoreAgentPanelLayout(raw: string | null, viewport: AgentPanelViewport): AgentPanelLayout {
    const fallback = defaultAgentPanelLayout(viewport);
    if (!raw) return clampAgentPanelLayout(fallback, viewport);
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && ["left", "top", "width", "height"].every((key) => typeof (parsed as Record<string, unknown>)[key] === "number" && Number.isFinite((parsed as Record<string, unknown>)[key]))) {
            return clampAgentPanelLayout(parsed as AgentPanelLayout, viewport);
        }
    } catch {
        // UI 偏好损坏不影响对话或服务端数据，恢复可见的默认窗口。
    }
    return clampAgentPanelLayout(fallback, viewport);
}

/**
 * 默认窗口按视口比例给尺寸：宽度约占 26%、高度约占 90%，再收进可读区间。
 *
 * 参考的是画布内实测效果：1920×919 下约 500×827、贴右下 12px；
 * 固定 420×640 在大屏上偏小，而写死大尺寸又会在 1366 笔记本上压住画布。
 */
const DEFAULT_WIDTH_RATIO = 0.26;
const DEFAULT_HEIGHT_RATIO = 0.9;
const DEFAULT_MIN_WIDTH = 420;
const DEFAULT_MAX_WIDTH = 560;
const DEFAULT_MIN_HEIGHT = 640;
const DEFAULT_MAX_HEIGHT = 860;

export function defaultAgentPanelLayout(viewport: AgentPanelViewport): AgentPanelLayout {
    const width = clamp(Math.round(viewport.width * DEFAULT_WIDTH_RATIO), DEFAULT_MIN_WIDTH, DEFAULT_MAX_WIDTH);
    const height = clamp(Math.round(viewport.height * DEFAULT_HEIGHT_RATIO), DEFAULT_MIN_HEIGHT, DEFAULT_MAX_HEIGHT);
    return clampAgentPanelLayout({ width, height, left: viewport.width - width - MARGIN, top: viewport.height - height - MARGIN }, viewport);
}

export function changeAgentPanelLayout(start: AgentPanelLayout, gesture: AgentPanelGesture, dx: number, dy: number, viewport: AgentPanelViewport): AgentPanelLayout {
    if (gesture === "move") return clampAgentPanelLayout({ ...start, left: start.left + dx, top: start.top + dy }, viewport);
    const right = start.left + start.width;
    const bottom = start.top + start.height;
    const left = gesture === "north" ? start.left : clamp(start.left + dx, MARGIN, right - Math.min(360, start.width));
    const top = gesture === "west" ? start.top : clamp(start.top + dy, MARGIN, bottom - Math.min(420, start.height));
    return { left, top, width: right - left, height: bottom - top };
}
