import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageDir = (name: string) => resolve(import.meta.dir, `../src/pages/create/${name}`);
const read = (name: string) => readFileSync(pageDir(name), "utf8");

describe("首页空态不再有纵深画廊轮播", () => {
    test("画廊的组件、样式和手势模块都已下线", () => {
        for (const name of ["creation-inspiration-tunnel.tsx", "creation-inspiration-tunnel.css", "creation-gallery-gesture.ts"]) {
            expect(existsSync(pageDir(name))).toBe(false);
        }
    });

    test("空态只剩标题、输入区和快捷入口，不再挂画廊", () => {
        const page = read("index.tsx");

        expect(page).not.toContain("CreationInspirationTunnel");
        expect(page).toContain('className="creation-home-heading"');
        expect(page).toContain('className="creation-launchpad"');
        expect(page).toContain('import "./creation-home-layout.css"');
    });

    test("画廊退场后仍保留空态排版与素材署名", () => {
        const css = read("creation-home-layout.css");

        // globals.css 的默认是 justify-content: center，画廊靠这条从顶部起排；
        // 删画廊时不能把它一起带走，否则整块内容会悬到视口中间。
        expect(css).toContain(".creation-home .creation-empty-workspace {");
        expect(css).toContain("justify-content: flex-start");
        expect(css).toContain(".creation-inspiration-credit {");
        // 「照片透过输入框」而加的毛玻璃随画廊一起退场。
        expect(css).not.toContain("backdrop-filter: blur(24px)");
    });
});
