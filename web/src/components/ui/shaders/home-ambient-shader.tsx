import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useReducedMotion } from "motion/react";
import { WebGPUShaderStage } from "./webgpu-stage";

// 动态导入 React 着色器，隔离非 WebGPU 环境下的模块副作用
const LazyShaderRenderer = lazy(async () => {
    const { Shader, MeshGradient } = await import("shaders/react");
    return {
        default: function AmbientRenderer({
            isDark,
            reducedMotion,
            onUnavailable,
        }: {
            isDark: boolean;
            reducedMotion: boolean;
            onUnavailable: () => void;
        }) {
            return (
                <Shader
                    disableTelemetry
                    className="size-full"
                    style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                    onUnavailable={onUnavailable}
                >
                    <MeshGradient
                        colorA={isDark ? "#283e99" : "#3D66FF"}
                        colorB={isDark ? "#946329" : "#F2AD4D"}
                        stops={
                            isDark
                                ? [
                                      { color: "#5e2a39", position: 0 },
                                      { color: "#283e99", position: 0.5 },
                                      { color: "#805524", position: 1 },
                                  ]
                                : [
                                      { color: "#97455C", position: 0 },
                                      { color: "#3D66FF", position: 0.5 },
                                      { color: "#F2AD4D", position: 1 },
                                  ]
                        }
                        speed={reducedMotion ? 0 : 0.35}
                        smoothness={0.85}
                        swirl={0.25}
                        drift={0.15}
                    />
                </Shader>
            );
        },
    };
});

/**
 * 首页全屏动态环境流光。
 *
 * 特性：
 * 1. 采用 WebGPU 着色器（MeshGradient），在 GPU 端原生并行计算光斑流体力学；
 * 2. 纵向羽化渐变：仅在顶部渲染柔和光斑，向下渐隐，无缝融入背景；
 * 3. 视口可见性休眠：离开视口时自动暂停渲染，降低能耗；
 * 4. 减弱动效偏好 (prefers-reduced-motion) 支持；
 * 5. 深浅主题明度自适应；
 * 6. 不支持 WebGPU 时无感静默降级。
 */
export function HomeAmbientShader() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const reducedMotion = Boolean(useReducedMotion());
    const [isDark, setIsDark] = useState(false);
    const [inView, setInView] = useState(true);
    const [unavailable, setUnavailable] = useState(false);

    // 监听深浅主题变化
    useEffect(() => {
        const updateTheme = () => {
            setIsDark(document.documentElement.classList.contains("dark"));
        };
        updateTheme();
        const observer = new MutationObserver(updateTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    // 离开视口时休眠，避免翻到底部瀑布流时空耗 GPU
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    setInView(entry.isIntersecting);
                }
            },
            { threshold: 0 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    if (unavailable) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className="home-ambient-shader-host"
            aria-hidden="true"
        >
            <WebGPUShaderStage
                fallback={null}
                className="size-full"
                style={{ width: "100%", height: "100%" }}
            >
                {inView ? (
                    <Suspense fallback={null}>
                        <LazyShaderRenderer
                            isDark={isDark}
                            reducedMotion={reducedMotion}
                            onUnavailable={() => setUnavailable(true)}
                        />
                    </Suspense>
                ) : null}
            </WebGPUShaderStage>
        </div>
    );
}
