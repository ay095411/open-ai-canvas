import { type ReactNode, useEffect, useState } from "react";

interface WebGPUShaderStageProps {
    fallback?: ReactNode;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * 安全的 WebGPU 画布容器。
 * 
 * 职责：
 * 1. 异步探测当前环境是否具备可用的 WebGPU Adapter；
 * 2. 如果不支持 WebGPU 或 GPU 崩溃，无感渲染 fallback；
 * 3. 避免在低版本浏览器中产生未捕获的 WebGPU 初始化异常。
 */
export function WebGPUShaderStage({ fallback = null, children, className, style }: WebGPUShaderStageProps) {
    const [supported, setSupported] = useState<boolean | null>(null);

    useEffect(() => {
        let mounted = true;

        if (typeof window === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
            setSupported(false);
            return;
        }

        navigator.gpu
            .requestAdapter()
            .then((adapter) => {
                if (!mounted) return;
                setSupported(Boolean(adapter));
            })
            .catch(() => {
                if (!mounted) return;
                setSupported(false);
            });

        return () => {
            mounted = false;
        };
    }, []);

    if (supported === false) {
        return <>{fallback}</>;
    }

    if (supported === null) {
        // 探测期间显示 fallback，保证首帧不白屏
        return <>{fallback}</>;
    }

    return (
        <div className={className} style={style}>
            {children}
        </div>
    );
}
