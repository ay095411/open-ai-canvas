import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "../src/lib/sidebar-checkin";

describe("daily checkin offer", () => {
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

describe("workspace checkin entry", () => {
    // 领取入口原本是侧栏底部的卡片；侧栏整站移除后搬到顶栏图标按钮。
    // 它必须留在有人渲染的地方——否则 checkinCredits() 会变成永远调不到的死代码。
    test("is mounted from the topbar actions and still claims real credits", () => {
        const actions = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-topbar-actions.tsx"), "utf8");
        const button = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-topbar-checkin.tsx"), "utf8");

        expect(actions).toContain("<WorkspaceTopBarCheckin />");
        expect(button).toContain("checkinCredits()");
        expect(button).toContain("shouldShowSidebarCheckin");
        expect(button).toContain('window.dispatchEvent(new CustomEvent("wallet:updated"))');
        // 409（今天已领过）静默处理，不弹错误。
        expect(button).toContain("error.status === 409");
        // 顶栏形态是单个图标按钮，不再有卡片标题/副标题结构。
        expect(button).toContain("app-workspace-topbar-checkin");
        expect(button).not.toContain("app-workspace-sidebar-checkin");
    });

    test("keeps the light-blue stage out of the checkin colors", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const start = css.indexOf(".app-user-workspace .app-workspace-topbar-checkin {");
        const end = css.indexOf(".app-user-workspace .app-workspace-topbar-signin {", start);
        const block = css.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(block).toContain("color: #0f9b7c;");
        expect(block).toContain("color: #3ee0b8;");
        expect(block).not.toMatch(/#(?:dbeafe|e8f1ff|eef4ff|e6f0ff|d6e8ff)/i);
    });
});
