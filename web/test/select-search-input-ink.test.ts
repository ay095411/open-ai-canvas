import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

// Ant Design 6.7 的 Select 输入框文字色写成 `color: var(--ant-select-color)`，
// 但该变量只在 `.ant-select-disabled` 分支定义、正常态缺失（主题把 colorText
// 传成 undefined，--ant-color-text 也跟着空掉）。变量解析失败会退回继承，
// 命中 `.ant-select-content-has-search-value` 的 `color: transparent`，
// 造成「单选 + showSearch 在下拉里打字看不见」（首页筛选栏实测）。
// 防回退：正常态必须给 `.ant-select-input` 一个真实墨色。
test("unified select search input falls back to theme ink", () => {
    const globals = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    expect(globals).toContain(".ant-select.app-unified-select:not(.ant-select-disabled) .ant-select-input");
    expect(globals).toMatch(
        /\.ant-select\.app-unified-select:not\(\.ant-select-disabled\) \.ant-select-input \{\s*color: var\(--user-ink, var\(--foreground\)\);/,
    );
});
