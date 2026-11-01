import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label = "正在恢复工作区", detail = "同步账号、模型和项目数据", className }: FullScreenLoaderProps) {
    return (
        <div
            data-full-screen-loader
            role="status"
            aria-live="polite"
            aria-label={`${label}，${detail}`}
            className={cn("full-screen-loader", className)}
        >
            {/* 与 index.html 启动屏同一母题：中央一根细线 + 流光，下方大字距文案。 */}
            <span className="full-screen-loader-track" aria-hidden="true">
                <span className="full-screen-loader-sweep" />
            </span>
            <span className="full-screen-loader-copy">
                <strong>{label}</strong>
                <span>{detail}</span>
            </span>
        </div>
    );
}

export function WorkspaceRouteLoader({ label = "正在打开页面" }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <span className="full-screen-loader-track" aria-hidden="true">
                    <span className="full-screen-loader-sweep" />
                </span>
                <span className="workspace-route-loader-label">{label}</span>
            </div>
        </section>
    );
}
