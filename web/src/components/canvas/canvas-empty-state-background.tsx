import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useReducedMotion } from "motion/react";
import { WebGPUShaderStage } from "@/components/ui/shaders/webgpu-stage";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

// 动态导入 WebGPU 粒子着色器
const LazyParticlesShader = lazy(async () => {
    const { Shader, FloatingParticles } = await import("shaders/react");
    return {
        default: function ParticlesShaderRenderer({
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
                    <FloatingParticles
                        particleColor={isDark ? "rgba(240, 240, 255, 0.65)" : "rgba(35, 42, 60, 0.35)"}
                        count={75}
                        particleSize={0.022}
                        softness={0.8}
                        speed={reducedMotion ? 0 : 0.22}
                        angle={-90}
                        speedVariance={0.4}
                        angleVariance={45}
                        randomness={0.6}
                        twinkle={0.7}
                        cursorStrength={0.12}
                    />
                </Shader>
            );
        },
    };
});

/**
 * 轻量 Canvas2D 星尘兜底（当设备不支持 WebGPU 时平滑降级）
 */
function Canvas2DFallbackParticles({ isDark, reducedMotion }: { isDark: boolean; reducedMotion: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationFrameId: number;
        let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
        let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

        const onResize = () => {
            if (!canvas) return;
            width = canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
            height = canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
        };
        window.addEventListener("resize", onResize);

        // 生成 50 颗微型星尘粒子
        const particleCount = 50;
        const particles = Array.from({ length: particleCount }).map(() => ({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 1.5 + 0.5,
            alpha: Math.random() * 0.5 + 0.15,
            speedY: Math.random() * 0.3 + 0.1,
            phase: Math.random() * Math.PI * 2,
        }));

        let time = 0;
        const render = () => {
            ctx.clearRect(0, 0, width, height);
            time += 0.02;

            for (const p of particles) {
                if (!reducedMotion) {
                    p.y -= p.speedY;
                    if (p.y < 0) p.y = height;
                }
                const currentAlpha = p.alpha * (0.6 + 0.4 * Math.sin(time + p.phase));
                ctx.fillStyle = isDark
                    ? `rgba(235, 238, 255, ${currentAlpha})`
                    : `rgba(32, 40, 58, ${currentAlpha * 0.6})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
            }

            if (!reducedMotion) {
                animationFrameId = requestAnimationFrame(render);
            }
        };

        render();

        return () => {
            window.removeEventListener("resize", onResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, [isDark, reducedMotion]);

    return (
        <canvas
            ref={canvasRef}
            className="canvas-empty-fallback-dust"
            style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
        />
    );
}

/**
 * 新建画布动态背景组件：
 * 1. 深空微光场（中心 Radial Glow，深浅主题自适应）；
 * 2. 悬浮微星尘（WebGPU 原生 FloatingParticles，深浅主题粒子反转，自动降级 Canvas2D）；
 * 3. 兼容黑白画布主题模式；
 * 4. 纯净硬件级渲染，不阻挡交互。
 */
export function CanvasEmptyStateBackground({ theme }: { theme?: "light" | "dark" } = {}) {
    const contextTheme = useActiveTheme();
    const activeTheme = theme || contextTheme;
    const isDark = activeTheme === "dark";
    const reducedMotion = Boolean(useReducedMotion());
    const [unavailable, setUnavailable] = useState(false);

    return (
        <div
            className={`canvas-empty-dynamic-backdrop ${isDark ? "is-dark" : "is-light"}`}
            data-canvas-theme={activeTheme}
            style={{ backgroundColor: isDark ? "#09090b" : "#f0f0f2", transition: "background-color 400ms ease" }}
            aria-hidden="true"
        >
            {/* 中心柔和聚光场 */}
            <div className="canvas-empty-center-glow" />

            {/* 动态星尘粒子层（WebGPU 优先，自动降级 Canvas2D） */}
            <div className="canvas-empty-particles-layer">
                <WebGPUShaderStage
                    fallback={<Canvas2DFallbackParticles isDark={isDark} reducedMotion={reducedMotion} />}
                    className="size-full"
                    style={{ width: "100%", height: "100%" }}
                >
                    {!unavailable ? (
                        <Suspense fallback={<Canvas2DFallbackParticles isDark={isDark} reducedMotion={reducedMotion} />}>
                            <LazyParticlesShader
                                key={isDark ? "dark-particles" : "light-particles"}
                                isDark={isDark}
                                reducedMotion={reducedMotion}
                                onUnavailable={() => setUnavailable(true)}
                            />
                        </Suspense>
                    ) : (
                        <Canvas2DFallbackParticles isDark={isDark} reducedMotion={reducedMotion} />
                    )}
                </WebGPUShaderStage>
            </div>
        </div>
    );
}
