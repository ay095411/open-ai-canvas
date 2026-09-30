import { useNavigate, useSearchParams } from "react-router";

import { isSettingsSection, SettingsWorkbench } from "./settings-workbench";

/**
 * /settings 的兜底渲染。正常路径下 `WorkspaceSettingsHost` 会拦截这个路由、
 * 打开设置弹窗并把地址替换回打开前的页面，所以这页只在宿主没有挂载时才会出现
 * （例如直接访问一个尚未进入工作台外壳的地址）。两个形态共用 SettingsWorkbench，
 * 内容不会分叉。
 */
export default function SettingsPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const requestedSection = searchParams.get("section");

    return (
        <SettingsWorkbench
            variant="page"
            initialSection={isSettingsSection(requestedSection) ? requestedSection : undefined}
            taskId={searchParams.get("taskId") || undefined}
            projectId={searchParams.get("projectId") || undefined}
            continueCreation={searchParams.get("continue") === "1"}
            onClose={() => navigate(-1)}
        />
    );
}
