import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("personal channel copy stays on one line without affecting other settings descriptions", () => {
    const component = read("../src/pages/settings/channel-settings-pane.tsx");
    const css = read("../src/styles/globals.css");
    expect(component).toContain('className="settings-pane-header settings-channel-header"');
    expect(component).toContain('className="settings-channel-description" tabIndex={0}');
    expect(component).toContain("打开模型选择");
    const rule = css.split(".settings-channel-header .settings-channel-heading .settings-channel-description {")[1]?.split("}")[0];
    expect(rule).toContain("white-space: nowrap;");
    expect(rule).toContain("max-width: none;");
    expect(rule).toContain("overflow-x: auto;");
    expect(css).toContain(".settings-channel-description:focus-visible");
});
