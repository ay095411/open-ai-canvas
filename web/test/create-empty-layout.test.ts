import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 空态横幅（.creation-empty-art / CreationEmptyBanner）已随旧空态一起删掉，
// 这条只守还在的那两块：文案区和输入区仍走文档流，不靠 margin: auto 顶位置。
test("create empty state keeps the intro and composer in document flow", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const layoutStart = styles.indexOf("/* 空态布局收敛：保持文案和输入区的文档流顺序");
    const layoutEnd = styles.indexOf("/* ===== 素材库", layoutStart);
    const layout = styles.slice(layoutStart, layoutEnd);

    expect(layoutStart).toBeGreaterThanOrEqual(0);
    expect(layoutEnd).toBeGreaterThan(layoutStart);
    expect(layout).toContain("justify-content: flex-start;");
    expect(layout).toContain("flex: 0 0 auto;");
    expect(layout).toContain("margin: 0 auto 18px;");
    expect(layout).not.toContain("margin: auto auto 18px;");
    expect(layout).not.toContain("margin: 26px auto auto;");
    expect(layout).not.toContain(".creation-empty-art");
});
