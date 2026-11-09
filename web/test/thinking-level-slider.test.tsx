import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingLevelSlider } from "../src/components/thinking-level-slider";
import type { ThinkingLevel } from "../src/lib/text-thinking";

const levels: ThinkingLevel[] = ["off", "low", "high", "max"];
const noop = () => {};

test("slider uses supported discrete positions and marks max distinctly", () => {
    const html = renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="max" resolvedLevel="max" onChange={noop} />);
    expect(html).toContain('type="range"');
    expect(html).toContain('max="4"');
    expect(html).toContain('value="4"');
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-valuetext="极限"');
    expect(html).toContain('data-tone="max"');
    expect(html).not.toContain("极简");
    expect(html).not.toContain("标准");
});

test("model default remains distinct from its effective level", () => {
    const html = renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="auto" resolvedLevel="high" onChange={noop} />);
    expect(html).toContain('aria-valuetext="默认"');
    expect(html).toContain('value="0"');
    expect(html).not.toContain("<button");
});

test("off, unavailable and disabled states remain explicit", () => {
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="off" onChange={noop} />)).toContain('data-tone="off"');
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="max" disabled onChange={noop} />)).toContain("disabled");
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={[]} value="auto" onChange={noop} />)).not.toContain('type="range"');
});

// 拖一档的鼠标行程 = (轨道宽 - 22px 滑块) / 档数，轨道宽又由创作页这个容器宽度决定。
// 容器曾经是 180px（3 档时要拖 59px），过长的行程度量被用户判为"太远"，这里锁住回归点。
test("creation slider keeps one level within a short drag", () => {
    const css = readFileSync(new URL("../src/components/thinking-level-slider.css", import.meta.url), "utf8");
    const inline = css.slice(css.indexOf(".creation-thinking-inline"), css.indexOf(".thinking-level-slider {"));
    const track = css.slice(css.indexOf(".thinking-level-track {"), css.indexOf(".thinking-level-rail {"));
    const width = Number(/width:\s*([\d.]+)px/.exec(inline)?.[1] ?? 0);
    const minWidth = Number(/min-width:\s*([\d.]+)px/.exec(track)?.[1] ?? 0);
    expect(width).toBeGreaterThan(110);
    expect(width).toBeLessThanOrEqual(140);
    // 内边距 4×2 + 间隙 10 + 数值标签 22（2em @ 11px）之外要够轨道的最小宽度，否则会撑出容器。
    expect(minWidth).toBeGreaterThan(0);
    expect(minWidth).toBeLessThanOrEqual(width - 8 - 10 - 22);
});
