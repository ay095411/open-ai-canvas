import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "../src/lib/sidebar-checkin";

describe("sidebar checkin offer", () => {
    test("shows only when credits and a checkin bonus are enabled and today is unclaimed", () => {
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 100_000_000, checkedInToday: false })).toBe(true);
        expect(shouldShowSidebarCheckin({ creditsEnabled: false, checkinBonusMicrocredits: 100_000_000, checkedInToday: false })).toBe(false);
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 0, checkedInToday: false })).toBe(false);
        expect(shouldShowSidebarCheckin({ creditsEnabled: true, checkinBonusMicrocredits: 100_000_000, checkedInToday: true })).toBe(false);
    });

    test("uses the configured brand name instead of Buddy", () => {
        expect(sidebarCheckinTitle("Navo AI")).toBe("Navo AI加油站");
        expect(sidebarCheckinTitle(" 本地工作室 ")).toBe("本地工作室加油站");
        expect(sidebarCheckinTitle("")).toBe("Navo AI加油站");
    });
});

describe("workspace sidebar checkin card", () => {
    test("collapsed offer uses a centered credit coin instead of a clipped text label", () => {
        const card = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-checkin.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const collapsed = card.slice(card.indexOf("if (collapsed)"), card.indexOf("<aside"));
        // 签到与可用积分共用同一枚金币标记，不再各用一套图标。
        expect(collapsed).toContain("<WorkspaceCreditMark");
        expect(collapsed).not.toContain("<Gift");
        expect(collapsed).toContain("<LoaderCircle");
        expect(collapsed).toContain("aria-busy={claiming}");
        expect(collapsed).not.toContain(': "领"');
        // 折叠态有两条同选择器规则（共用高度的一条 + 48px 方形按钮的一条），这里取后者。
        const rule = css.match(/^\.app-user-workspace \.app-workspace-sidebar-checkin\.is-collapsed \{([^}]*width: 48px;[^}]*)\}/m)?.[1] || "";
        expect(rule).toContain("justify-content: center;");
        expect(rule).toContain("align-items: center;");
        expect(rule).toContain("padding: 0;");
        expect(rule).toContain("box-shadow: none;");
    });
    test("sits above account storage and uses the claim card colors without a light-blue stage", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const card = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-checkin.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const checkinIndex = sidebar.indexOf("<WorkspaceSidebarCheckin collapsed={collapsed} />");
        const storageIndex = sidebar.indexOf("<WorkspaceSidebarStorageMeter collapsed={collapsed} />");
        const start = css.indexOf(".app-user-workspace .app-workspace-sidebar-checkin {");
        const end = css.indexOf(".app-user-workspace .app-workspace-sidebar-storage {", start);
        const block = css.slice(start, end);

        expect(checkinIndex).toBeGreaterThan(-1);
        expect(storageIndex).toBeGreaterThan(checkinIndex);
        expect(card).toContain("立即领取");
        expect(card).toContain("今日<em>{amount}</em>积分");
        expect(card).toContain("checkinCredits()");
        expect(block).toContain("background: #fff;");
        expect(block).toContain("background: #171717;");
        expect(block).toContain("color: #12c8a0;");
        expect(block).not.toMatch(/#(?:dbeafe|e8f1ff|eef4ff|e6f0ff|d6e8ff)/i);
    });
});
