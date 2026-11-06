import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

// 会话恢复、客户端初始化和整页路由共用时间线，接力时流光延续原相位，文案不重播入场。
// index.html 的启动流光也使用 performance.now()；两处保留同样的细线尺寸与扫描节奏。
const LOADER_HANDOFF_MS = 400;
let presentationStartedAt = 0;
let lastUnmountedAt = Number.NEGATIVE_INFINITY;
let mountedLoaders = 0;

function useLoaderTimeline() {
    const [timeline] = useState(() => {
        const now = performance.now();
        if (mountedLoaders === 0 && now - lastUnmountedAt > LOADER_HANDOFF_MS) presentationStartedAt = now;
        return { "--loader-clock": `${now}ms`, "--loader-elapsed": `${now - presentationStartedAt}ms` } as CSSProperties;
    });

    useEffect(() => {
        mountedLoaders += 1;
        return () => {
            mountedLoaders -= 1;
            lastUnmountedAt = performance.now();
        };
    }, []);

    return timeline;
}

export function FullScreenLoader({ label = "正在恢复工作区", detail = "同步账号、模型和项目数据", className }: FullScreenLoaderProps) {
    const timeline = useLoaderTimeline();
    return (
        <div data-full-screen-loader role="status" aria-live="polite" aria-label={`${label}，${detail}`} className={cn("full-screen-loader", className)} style={timeline}>
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
