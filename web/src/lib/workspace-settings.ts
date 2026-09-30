export const WORKSPACE_SETTINGS_OPEN_EVENT = "workspace-settings:open";

export type WorkspaceSettingsOpenDetail = {
    /** 打开后直接定位到分区；不传则用默认分区。 */
    section?: string;
    taskId?: string;
    projectId?: string;
    /** 画布「继续创作」流程：弹窗里显示保存并返回。 */
    continueCreation?: boolean;
};

/** 工作台任意入口打开设置弹窗，不再进入独立设置页。 */
export function openWorkspaceSettings(detail: WorkspaceSettingsOpenDetail = {}) {
    window.dispatchEvent(new CustomEvent<WorkspaceSettingsOpenDetail>(WORKSPACE_SETTINGS_OPEN_EVENT, { detail }));
}
