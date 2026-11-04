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
    test("is mounted in the signed-in sidebar profile and still claims real credits", () => {
        const actions = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const button = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-checkin.tsx"), "utf8");

        expect(actions).toContain("<WorkspaceSidebarCheckin collapsed={collapsed} />");
        expect(button).toContain("checkinCredits()");
        expect(button).toContain("shouldShowSidebarCheckin");
        expect(button).toContain('window.dispatchEvent(new CustomEvent("wallet:updated"))');
        // 409（今天已领过）静默处理，不弹错误。
        expect(button).toContain("error.status === 409");
        expect(button).toContain("if (claiming) return");
        expect(button).toContain("disabled={claiming}");
        expect(button).toContain("await refresh()");
        expect(button).toContain("message.error(");
    });

    test("offers keyboard focus and reduced-motion treatment in both sidebar widths", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        expect(css).toMatch(/\.app-workspace-sidebar-checkin-claim:focus-visible,[^}]*outline:\s*2px solid #12c8a0/s);
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.app-user-workspace \.app-workspace-sidebar-checkin-claim,[^}]*transition:\s*none/s);
    });
});
