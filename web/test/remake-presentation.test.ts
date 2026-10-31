import { expect, test } from "bun:test";

import type { RemakeRun, RemakeShot, RemakeTake } from "../src/services/api/remakes";
import { isRemakeRunActive, isRemakeRunEditable, remakeCredits, remakeTime, selectedRemakeTake, validateRemakeShots } from "../src/lib/remake/presentation";

const shot = (over: Partial<RemakeShot> = {}): RemakeShot => ({
    id: "s1",
    sourceInMs: 0,
    sourceOutMs: 1000,
    keyframeMs: 500,
    keyframeResourceId: "",
    description: "画面",
    shotSize: "",
    camera: "",
    motion: "",
    dialogue: "",
    subjectPresent: false,
    imagePrompt: "",
    videoPrompt: "",
    ...over,
});

test("validateRemakeShots 接受完整覆盖且逐镜连续的分镜", () => {
    const shots = [shot(), shot({ id: "s2", sourceInMs: 1000, sourceOutMs: 2000, keyframeMs: 1500 })];
    expect(validateRemakeShots(shots, 0, 2000)).toBe("");
});

test("validateRemakeShots 拒绝空列表与超上限", () => {
    expect(validateRemakeShots([], 0, 1000)).toContain("1–20");
    expect(validateRemakeShots(Array.from({ length: 21 }, (_, i) => shot({ id: `s${i}`, sourceInMs: i * 1000, sourceOutMs: (i + 1) * 1000 })), 0, 21000)).toContain("1–20");
});

test("validateRemakeShots 拒绝空隙与重叠", () => {
    const gap = [shot(), shot({ id: "s2", sourceInMs: 1500, sourceOutMs: 2000, keyframeMs: 1700 })];
    expect(validateRemakeShots(gap, 0, 2000)).toContain("空隙或重叠");
    const overlap = [shot(), shot({ id: "s2", sourceInMs: 500, sourceOutMs: 2000, keyframeMs: 1700 })];
    expect(validateRemakeShots(overlap, 0, 2000)).toContain("空隙或重叠");
});

test("validateRemakeShots 拒绝越界关键帧与空描述", () => {
    expect(validateRemakeShots([shot({ keyframeMs: 1000 })], 0, 1000)).toContain("关键帧");
    expect(validateRemakeShots([shot({ keyframeMs: -1 })], 0, 1000)).toContain("关键帧");
    expect(validateRemakeShots([shot({ description: " " })], 0, 1000)).toContain("画面描述");
});

test("validateRemakeShots 拒绝非法区间与不完整覆盖", () => {
    expect(validateRemakeShots([shot({ sourceOutMs: 1000, sourceInMs: 1000 })], 0, 1000)).toContain("结束时间");
    expect(validateRemakeShots([shot({ sourceInMs: Number.NaN })], 0, 1000)).toContain("结束时间");
    expect(validateRemakeShots([shot()], 0, 2000)).toContain("完整覆盖");
});

test("validateRemakeShots 在未选择参考片区间时放行编辑", () => {
    expect(validateRemakeShots([shot()], 0, 0)).toBe("");
});

test("remakeTime 与 remakeCredits 按约定格式化", () => {
    expect(remakeTime(0)).toBe("00:00.0");
    expect(remakeTime(65_000)).toBe("01:05.0");
    expect(remakeCredits(1_000_000)).toBe("1");
    expect(remakeCredits(0)).toBe("0");
});

test("运行活跃与可编辑状态互斥", () => {
    expect(isRemakeRunActive({ status: "running" })).toBe(true);
    expect(isRemakeRunActive({ status: "completed" })).toBe(false);
    expect(isRemakeRunActive(null)).toBe(false);
    expect(isRemakeRunEditable(null)).toBe(true);
    expect(isRemakeRunEditable({ status: "running" } as RemakeRun)).toBe(false);
    expect(isRemakeRunEditable({ status: "partial_failed" } as RemakeRun)).toBe(true);
});

test("selectedRemakeTake 只认当前运行的选中候选", () => {
    const takes: RemakeTake[] = [
        { id: "t1", runId: "r1", shotId: "s1", unitId: "u1", kind: "image", resourceId: "res1", taskId: "task1", requestedDurationMs: 0, durationMs: 0, createdAt: "" },
        { id: "t2", runId: "r1", shotId: "s1", unitId: "u1", kind: "image", resourceId: "res2", taskId: "task2", requestedDurationMs: 0, durationMs: 0, createdAt: "" },
        { id: "v1", runId: "r1", shotId: "s1", unitId: "u1", kind: "video", resourceId: "res3", taskId: "task3", requestedDurationMs: 1000, durationMs: 1000, createdAt: "" },
    ];
    const run = { selections: { u1: { imageTakeId: "t2" } } } as RemakeRun;
    expect(selectedRemakeTake(takes, run, "s1", "image")?.id).toBe("t2");
    expect(selectedRemakeTake(takes, run, "s1", "video")).toBeUndefined();
    expect(selectedRemakeTake(takes, run, "s2", "image")).toBeUndefined();
});
