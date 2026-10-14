import { expect, test } from "bun:test";

async function pickerSources() {
    const [component, styles] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
    ]);
    return { component, styles };
}

test("模型选择器已移除调用记录指示条与质量检测展示，保持纯净", async () => {
    const { component } = await pickerSources();

    // 品牌栏与模型选项中不再挂载指示条与可用性检测
    expect(component).not.toContain("<ModelRecentHealthTrack availability={groupAvailability(config, group)} />");
    expect(component).not.toContain("<ModelAvailabilityBadge");
});

