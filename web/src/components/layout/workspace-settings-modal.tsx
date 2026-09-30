import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { openWorkspaceSettings, WORKSPACE_SETTINGS_OPEN_EVENT, type WorkspaceSettingsOpenDetail } from "@/lib/workspace-settings";
import { isSettingsSection, SettingsWorkbench, type SettingsSectionKey } from "@/pages/settings/settings-workbench";

type SettingsState = { open: boolean } & WorkspaceSettingsOpenDetail;

const CLOSED: SettingsState = { open: false };
const SETTINGS_RETURN_KEY = "workspace-settings:return";

function readReturnTarget() {
    try {
        return window.sessionStorage.getItem(SETTINGS_RETURN_KEY) || "/";
    } catch {
        return "/";
    }
}

/**
 * 设置弹窗宿主，挂载在工作台外壳（`AppWorkspaceShell`）。它负责两件事：
 *
 * 1. 监听 `openWorkspaceSettings()` —— 账户菜单、命令面板等入口用事件打开弹窗，
 *    和积分中心（`WorkspaceWalletHost`）同一套约定，避免给每个入口都塞一份状态。
 * 2. 拦截 `/settings` 路由 —— 画布深处的「去设置」仍然走 URL（`navigateToSettings`
 *    可能发生在没有路由上下文的组件里），这里接住它、开弹窗，再把地址替换回
 *    **打开前的那一页**，用户因此不会像以前那样被扔回首页。
 */
export function WorkspaceSettingsHost() {
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [state, setState] = useState<SettingsState>(CLOSED);
    // 回跳目标同时记在 sessionStorage：直接访问 /settings 或整页刷新时 ref 会归零，
    // 落回首页比落回用户原本那一页糟得多。
    const returnToRef = useRef<string>(readReturnTarget());

    useEffect(() => {
        if (pathname.startsWith("/settings")) return;
        const target = `${pathname}${search}`;
        returnToRef.current = target;
        try {
            window.sessionStorage.setItem(SETTINGS_RETURN_KEY, target);
        } catch {
            // 隐私模式/禁用 storage 时忽略：ref 仍然有效，只是刷新后回落到首页。
        }
    }, [pathname, search]);

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            const detail = (raw as CustomEvent<WorkspaceSettingsOpenDetail>).detail || {};
            setState({ ...detail, open: true });
        };
        window.addEventListener(WORKSPACE_SETTINGS_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_SETTINGS_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (!pathname.startsWith("/settings")) return;
        const params = new URLSearchParams(search);
        setState({
            open: true,
            section: params.get("section") || undefined,
            taskId: params.get("taskId") || undefined,
            projectId: params.get("projectId") || undefined,
            continueCreation: params.get("continue") === "1",
        });
        navigate(returnToRef.current, { replace: true });
    }, [navigate, pathname, search]);

    // 先取到局部变量：类型守卫只收窄表达式本身，写 `state.section ?? null` 收窄不到 state.section。
    const requestedSection = state.section ?? null;

    return (
        <WorkspaceSettingsModal
            open={state.open}
            section={isSettingsSection(requestedSection) ? requestedSection : undefined}
            taskId={state.taskId}
            projectId={state.projectId}
            continueCreation={state.continueCreation}
            onClose={() => setState(CLOSED)}
        />
    );
}

export function WorkspaceSettingsModal({
    open,
    section,
    taskId,
    projectId,
    continueCreation = false,
    onClose,
}: {
    open: boolean;
    section?: SettingsSectionKey;
    taskId?: string;
    projectId?: string;
    continueCreation?: boolean;
    onClose: () => void;
}) {
    return (
        <AppModal
            flush
            open={open}
            title={null}
            footer={null}
            // 外壳自带关闭按钮（与弹窗头同一行），关掉 AntD 默认那颗，否则两颗 X 会叠在一起。
            closable={false}
            centered
            width="min(1280px, calc(100vw - 32px))"
            rootClassName="workspace-settings-modal"
            onCancel={onClose}
        >
            <div className="settings-modal-frame">
                <header className="settings-modal-header">
                    <div className="min-w-0">
                        <h2>账户与设置</h2>
                        <p>渠道、模型、生成偏好与问题诊断都在这一处维护。</p>
                    </div>
                    <button type="button" className="settings-modal-close" onClick={onClose} aria-label="关闭设置">
                        <X className="size-4" strokeWidth={2} aria-hidden />
                    </button>
                </header>
                <SettingsWorkbench
                    variant="modal"
                    initialSection={section}
                    taskId={taskId}
                    projectId={projectId}
                    continueCreation={continueCreation}
                    onClose={onClose}
                />
            </div>
        </AppModal>
    );
}
