import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useReducedMotion } from "motion/react";
import { WebGPUShaderStage } from "./webgpu-stage";
import type { CreationMode } from "@/lib/creation-mode";

interface HomeAmbientShaderProps {
    mode?: CreationMode;
}

interface PaletteConfig {
    colorA: string;
    colorB: string;
    stops: { color: string; position: number }[];
}

function resolvePalette(mode: CreationMode, isDark: boolean): PaletteConfig {
    if (mode === "video") {
        // 视频模式：深邃未来感与电影幻彩
        return isDark
            ? {
                  colorA: "#312e81",
                  colorB: "#831843",
                  stops: [
                      { color: "#1e3a8a", position: 0 },
                      { color: "#4c1d95", position: 0.5 },
                      { color: "#701a75", position: 1 },
                  ],
              }
            : {
                  colorA: "#4f46e5",
                  colorB: "#db2777",
                  stops: [
                      { color: "#2563eb", position: 0 },
                      { color: "#7c3aed", position: 0.5 },
                      { color: "#ec4899", position: 1 },
                  ],
              };
    }

    if (mode === "text") {
        // 文本模式：静谧晴空与墨色青瓷
        return isDark
            ? {
                  colorA: "#0c4a6e",
                  colorB: "#134e4a",
                  stops: [
                      { color: "#075985", position: 0 },
                      { color: "#0e7490", position: 0.5 },
                      { color: "#065f46", position: 1 },
                  ],
              }
            : {
                  colorA: "#0284c7",
                  colorB: "#0d9488",
                  stops: [
                      { color: "#0369a1", position: 0 },
                      { color: "#0891b2", position: 0.5 },
                      { color: "#059669", position: 1 },
                  ],
              };
    }

    // 默认/图片模式：艺术暖金、经典蓝与玫红
    return isDark
        ? {
              colorA: "#283e99",
              colorB: "#946329",
              stops: [
                  { color: "#5e2a39", position: 0 },
                  { color: "#283e99", position: 0.5 },
                  { color: "#805524", position: 1 },
              ],
          }
        : {
              colorA: "#3d66ff",
              colorB: "#f2ad4d",
              stops: [
                  { color: "#97455c", position: 0 },
                  { color: "#3d66ff", position: 0.5 },
                  { color: "#f2ad4d", position: 1 },
              ],
          };
}

// 动态导入 React 着色器，隔离非 WebGPU 环境下的模块副作用
const LazyShaderRenderer = lazy(async () => {
    const { Shader, MeshGradient } = await import("shaders/react");
    return {
        default: function AmbientRenderer({
            palette,
            reducedMotion,
            onUnavailable,
        }: {
            palette: PaletteConfig;
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
                        colorA={palette.colorA}
                        colorB={palette.colorB}
                        stops={palette.stops}
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
 * 2. 创作模式联动：根据视频/图片/文本/Agent 模式平滑渲染专属氛围色彩；
 * 3. 纵向羽化渐变：仅在顶部渲染柔和光斑，向下渐隐，无缝融入背景；
 * 4. 视口可见性休眠：离开视口时自动暂停渲染，降低能耗；
 * 5. 减弱动效偏好 (prefers-reduced-motion) 支持；
 * 6. 深浅主题明度自适应；
 * 7. 不支持 WebGPU 时无感静默降级。
 */
export function HomeAmbientShader({ mode = "image" }: HomeAmbientShaderProps) {
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

    const palette = resolvePalette(mode, isDark);

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
                            palette={palette}
                            reducedMotion={reducedMotion}
                            onUnavailable={() => setUnavailable(true)}
                        />
                    </Suspense>
                ) : null}
            </WebGPUShaderStage>
        </div>
    );
}
