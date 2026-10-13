import { useMemo } from "react";
import { Link } from "react-router";

import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { buildWorkspaceModules } from "@/lib/workspace-modules";
import { useUserStore } from "@/stores/use-user-store";

import "./creation-module-nav.css";

/**
 * 首页的模块入口条。条目定义在 `lib/workspace-modules.ts`（那边没有 CSS 依赖，可单测）。
 *
 * 放在创作区正下方、灵感瀑布流之上：几乎不占纵向空间，但「去别的页面」这件事
 * 在首屏就能看到 —— 侧栏下线后，这里是唯一的常驻导航，不能压到瀑布流下面。
 */
export function CreationModuleNav() {
    const features = useUserStore((state) => state.features);
    const modules = useMemo(() => buildWorkspaceModules(features), [features]);

    if (modules.length === 0) return null;

    return (
        <nav className="creation-module-nav" aria-label="工作台模块">
            <ul className="creation-module-chips">
                {modules.map((module) => {
                    const Icon = module.icon;
                    return (
                        <li key={module.id}>
                            <Link
                                to={module.to}
                                className="creation-module-chip"
                                title={module.hint || module.title}
                                // 预载行为从侧栏继承：指到 / 键盘聚焦时就拉对应模块的 chunk，
                                // 点下去不出现整页 loading。
                                onFocus={() => preloadWorkspaceRoute(module.to)}
                                onPointerDown={() => preloadWorkspaceRoute(module.to)}
                                onPointerEnter={() => preloadWorkspaceRoute(module.to)}
                            >
                                <Icon className="creation-module-chip-icon" strokeWidth={1.8} aria-hidden />
                                <span>{module.title}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
