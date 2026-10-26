import { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 首页交互式动态网格背景（对齐 kunrouai.com，全自动适配日间 / 夜间主题切换）。
 *
 * 视觉构成：
 * 1. 40px 间距的几何网格，以 30px/s 沿对角线平滑漂移（prefers-reduced-motion 下静止）；
 * 2. 指针穿透交互：监听容器 pointermove，被光标掠过的网格方块高亮并平滑衰减淡出；
 * 3. 径向边缘羽化渐变：中心通透，向边缘自然融进 --home-grid-edge 底色（深色 #111415 / 浅色 #f8f8fa）；
 * 4. 主题感知：通过 MutationObserver 与 useThemeStore 双重保障，在深浅主题切换时无缝重绘对应色彩；
 * 5. 性能守卫：视口不可见（document.hidden）自动暂停 RAF，窗口尺寸变化（ResizeObserver）动态重绘。
 */
export function ShapeGrid() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const theme = useThemeStore((state) => state.theme);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // 监听指针移动的舞台容器（canvas -> .home-background -> .app-workspace-stage）
        const container = canvas.parentElement?.parentElement ?? canvas.parentElement ?? canvas;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

        let line = "#2f293a";
        let hover = "#2d2837";
        let edge = "#111415";

        const hoverCells = new Map<string, { x: number; y: number; opacity: number }>();
        let width = 0;
        let height = 0;
        let offset = 0;
        let animId = 0;
        let lastTime = 0;
        let pointer: { x: number; y: number } | null = null;
        let vignetteGradient: CanvasGradient | null = null;

        function updateThemeColors() {
            if (!canvas || !ctx) return;
            const isDark = document.documentElement.classList.contains("dark");
            const computed = getComputedStyle(canvas);
            line = computed.getPropertyValue("--home-grid-line").trim() || (isDark ? "#2f293a" : "rgba(0, 0, 0, 0.055)");
            hover = computed.getPropertyValue("--home-grid-hover").trim() || (isDark ? "#2d2837" : "rgba(0, 0, 0, 0.04)");
            edge = computed.getPropertyValue("--home-grid-edge").trim() || (isDark ? "#111415" : "#f8f8fa");

            if (width > 0 && height > 0) {
                vignetteGradient = ctx.createRadialGradient(
                    width / 2,
                    height / 2,
                    0,
                    width / 2,
                    height / 2,
                    Math.hypot(width, height) / 2,
                );
                vignetteGradient.addColorStop(0, "transparent");
                vignetteGradient.addColorStop(1, edge);
            }
            render(0);
        }

        function render(delta: number) {
            if (!ctx) return;
            ctx.clearRect(0, 0, width, height);

            let currentHoverKey: string | null = null;
            if (pointer) {
                const gx = Math.floor((pointer.x - offset) / 40);
                const gy = Math.floor((pointer.y - offset) / 40);
                currentHoverKey = `${gx},${gy}`;
                if (!hoverCells.has(currentHoverKey)) {
                    hoverCells.set(currentHoverKey, { x: gx, y: gy, opacity: 0 });
                }
            }

            const stepFactor = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 10);
            ctx.fillStyle = hover;
            for (const [key, cell] of hoverCells) {
                cell.opacity += ((key === currentHoverKey ? 1 : 0) - cell.opacity) * stepFactor;
                if (key !== currentHoverKey && cell.opacity < 0.005) {
                    hoverCells.delete(key);
                    continue;
                }
                ctx.globalAlpha = cell.opacity;
                ctx.fillRect(cell.x * 40 + offset, cell.y * 40 + offset, 40, 40);
            }

            ctx.globalAlpha = 1;
            ctx.strokeStyle = line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const start = ((offset % 40) + 40) % 40;
            for (let x = start; x <= width; x += 40) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
            }
            for (let y = start; y <= height; y += 40) {
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
            ctx.stroke();

            if (vignetteGradient) {
                ctx.fillStyle = vignetteGradient;
                ctx.fillRect(0, 0, width, height);
            }
        }

        function resize() {
            if (!canvas || !ctx) return;
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            if (width === 0 || height === 0) return;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            updateThemeColors();
        }

        function loop(time: number) {
            const dt = Math.min((time - lastTime) / 1000, 0.05);
            lastTime = time;
            offset -= dt * 30;
            render(dt);
            animId = requestAnimationFrame(loop);
        }

        function syncAnimation() {
            cancelAnimationFrame(animId);
            if (!document.hidden) {
                render(0);
                if (!reducedMotion.matches) {
                    lastTime = performance.now();
                    animId = requestAnimationFrame(loop);
                }
            }
        }

        function handlePointerMove(event: PointerEvent) {
            if (event.pointerType === "touch" || !canvas) return;
            const rect = canvas.getBoundingClientRect();
            pointer = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
            };
            if (reducedMotion.matches && !document.hidden) {
                render(0);
            }
        }

        function handlePointerLeave() {
            pointer = null;
            if (reducedMotion.matches && !document.hidden) {
                render(0);
            }
        }

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);

        const themeObserver = new MutationObserver(() => {
            updateThemeColors();
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        container.addEventListener("pointermove", handlePointerMove as EventListener, { passive: true, capture: true });
        container.addEventListener("pointerleave", handlePointerLeave as EventListener);
        window.addEventListener("blur", handlePointerLeave);
        document.addEventListener("visibilitychange", syncAnimation);
        reducedMotion.addEventListener("change", syncAnimation);

        syncAnimation();

        return () => {
            cancelAnimationFrame(animId);
            observer.disconnect();
            themeObserver.disconnect();
            container.removeEventListener("pointermove", handlePointerMove as EventListener, true);
            container.removeEventListener("pointerleave", handlePointerLeave as EventListener);
            window.removeEventListener("blur", handlePointerLeave);
            document.removeEventListener("visibilitychange", syncAnimation);
            reducedMotion.removeEventListener("change", syncAnimation);
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        };
    }, [theme]);

    return <canvas ref={canvasRef} className="home-shape-grid" aria-hidden="true" />;
}

export default ShapeGrid;
