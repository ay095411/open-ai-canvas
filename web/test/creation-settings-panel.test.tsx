import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { CreationSettingsPanel } from "../src/pages/create/creation-settings-panel";
import { defaultImageCapabilityConfig, defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

const panelCss = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-settings-panel.css"), "utf8");

const seedream = defaultImageCapabilityConfig("km-kemei-seedream", "doubao-seedream-5-0-pro-260628");

/** 视频面板用例固定为「单档清晰度 + 整数时长区间」，与上游协议默认值解耦。 */
const videoProfile = {
    ...defaultModelCapabilityConfig().video!,
    resolutions: ["720p"],
    defaultResolution: "720p",
    duration: { selection: "range" as const, min: 5, max: 30, step: 5, default: 5 },
};

/** 只保留 1K 一档的模型：分辨率没有可选值，面板不应再铺一条满宽按钮。 */
function singleTierProfile() {
    const presets = (seedream.size.presets || []).filter((preset) => preset.tier === "1k");
    return {
        ...seedream,
        resolution: { ...seedream.resolution, values: ["1k"], default: "1k" },
        size: { ...seedream.size, presets, default: presets[0]?.size ?? seedream.size.default },
    };
}

function renderImage(profile: ReturnType<typeof singleTierProfile>, overrides: Partial<Parameters<typeof CreationSettingsPanel>[0]> = {}) {
    return renderToStaticMarkup(
        <CreationSettingsPanel
            mode="image"
            imageProfile={profile}
            videoProfile={videoProfile}
            ratio="1:1"
            quality={profile.quality.default}
            imageResolution={profile.resolution.default}
            videoQuality=""
            count={1}
            countLimit={4}
            seconds={5}
            costLabel="0.04 积分"
            onChange={() => {}}
            {...overrides}
        />,
    );
}

describe("创作页统一参数面板：分辨率只在真有可选档位时占一整行", () => {
    test("多档分辨率渲染等宽分段，当前档位为选中态", () => {
        const html = renderImage(seedream, { imageResolution: "2k" });

        expect((html.match(/creation-settings-segment"/g) || []).length).toBe(3);
        expect(html).toContain("1K");
        expect(html).toContain("1.5K");
        expect(html).toContain("2K");
        // 2K 是当前档位，且只有一个分段被按下。
        expect((html.match(/creation-settings-segment" aria-pressed="true"/g) || []).length).toBe(1);
    });

    test("只有一档分辨率时值落在行标题右侧，不再渲染满宽假按钮", () => {
        const html = renderImage(singleTierProfile());

        expect((html.match(/分辨率/g) || []).length).toBe(1);
        expect((html.match(/creation-settings-segment"/g) || []).length).toBe(0);
        expect(html).toContain(">1K</span>");
    });

    test("宽高比格始终三列，不按视口宽度回退成两列", () => {
        expect(panelCss).toContain(".creation-settings-ratios {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));");
        // 面板宽度固定 300px，列数跟视口无关；出现 @media 说明又按窗口宽度改列数了。
        expect(panelCss).not.toContain("@media");
    });

    test("只有一行值的参数行不留控件间距", () => {
        expect(panelCss).toContain(".creation-settings-row > header:last-child");
        expect(panelCss).toContain("margin-bottom: 0;");
    });
});

describe("创作页统一参数面板：张数与报价", () => {
    test("多张时页脚说明共几张，单张时不重复一遍数量", () => {
        const many = renderImage(seedream, { count: 3 });
        expect(many).toContain("共 3 张");
        expect(many).toContain("0.04 积分");

        const single = renderImage(seedream, { count: 1 });
        expect(single).not.toContain("共 1 张");
        expect(single).toContain("0.04 积分");
    });

    test("未开启报价时不渲染页脚，面板不出现空分隔线", () => {
        const html = renderImage(seedream, { costLabel: undefined });
        expect(html).not.toContain("creation-settings-footer");
    });

    test("单次上限为 1 张时不显示生成张数行", () => {
        const html = renderImage(seedream, { countLimit: 1 });
        expect(html).not.toContain("生成张数");
    });
});

describe("创作页统一参数面板：视频摘要与面板同源", () => {
    test("视频面板只列画幅、清晰度与时长，单档清晰度值落在行标题", () => {
        const html = renderToStaticMarkup(
            <CreationSettingsPanel
                mode="video"
                imageProfile={seedream}
                videoProfile={videoProfile}
                ratio="16:9"
                quality={seedream.quality.default}
                imageResolution={seedream.resolution.default}
                videoQuality="720p"
                count={1}
                countLimit={1}
                seconds={30}
                onChange={() => {}}
            />,
        );

        expect(html).toContain("画幅");
        expect(html).toContain("清晰度");
        expect(html).toContain("时长");
        expect(html).toContain("30 秒");
        expect(html).not.toContain("生成张数");
    });
});
