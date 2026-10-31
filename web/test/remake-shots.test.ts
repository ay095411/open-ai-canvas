import { expect, test } from "bun:test";

import type { RemakeRun, RemakeShot, RemakeTake } from "../src/services/api/remakes";
import { clampRemakeShotBoundaries, mergeRemakeShotWithPrevious, remakeResultOffsets, splitRemakeShot } from "../src/lib/remake/shots";
import { validateRemakeShots } from "../src/lib/remake/presentation";

const shot = (over: Partial<RemakeShot> = {}): RemakeShot => ({
    id: "s1",
    sourceInMs: 0,
    sourceOutMs: 2000,
    keyframeMs: 1000,
    keyframeResourceId: "kf1",
    description: "画面",
    shotSize: "中景",
    camera: "",
    motion: "",
    dialogue: "",
    subjectPresent: false,
    imagePrompt: "",
    videoPrompt: "",
    ...over,
});

test("splitRemakeShot 默认在中点拆分并保证后段区间与关键帧有效", () => {
    const next = splitRemakeShot([shot()], 0, { newId: "s2" });
    expect(next).toHaveLength(2);
    expect(next[0].sourceInMs).toBe(0);
    expect(next[0].sourceOutMs).toBe(1000);
    expect(next[1].id).toBe("s2");
    expect(next[1].sourceInMs).toBe(1000);
    expect(next[1].sourceOutMs).toBe(2000);
    expect(next[1].keyframeMs).toBe(1000);
    expect(next[1].warnings?.join()).toContain("拆分");
    expect(validateRemakeShots(next, 0, 2000)).toBe("");
});

test("splitRemakeShot 把关键帧夹回后段区间并拒绝过短镜头", () => {
    const narrow = splitRemakeShot([shot({ keyframeMs: 200, sourceOutMs: 3000 })], 0, { newId: "s2", atMs: 2500 });
    expect(narrow[1].keyframeMs).toBe(2500);
    expect(splitRemakeShot([shot({ sourceOutMs: 1 })], 0)).toHaveLength(1);
});

test("mergeRemakeShotWithPrevious 拼接文本且主体出现取或", () => {
    const shots = [shot({ description: "全景", imagePrompt: "p1", subjectPresent: false }), shot({ id: "s2", sourceInMs: 2000, sourceOutMs: 4000, description: "特写", imagePrompt: "p2", subjectPresent: true })];
    const merged = mergeRemakeShotWithPrevious(shots, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceOutMs).toBe(4000);
    expect(merged[0].description).toBe("全景；特写");
    expect(merged[0].imagePrompt).toBe("p1\np2");
    expect(merged[0].subjectPresent).toBe(true);
    expect(validateRemakeShots(merged, 0, 4000)).toBe("");
});

test("mergeRemakeShotWithPrevious 忽略越界索引", () => {
    expect(mergeRemakeShotWithPrevious([shot()], 0)).toHaveLength(1);
    expect(mergeRemakeShotWithPrevious([shot()], 3)).toHaveLength(1);
});

test("clampRemakeShotBoundaries 夹取到相邻镜头之间并保持关键帧有效", () => {
    const shots = [shot(), shot({ id: "s2", sourceInMs: 2000, sourceOutMs: 4000, keyframeMs: 3000 })];
    const clamped = clampRemakeShotBoundaries(shots, 0, -500, 2500, 0, 4000);
    expect(clamped[0].sourceInMs).toBe(0);
    expect(clamped[0].sourceOutMs).toBe(2000);
    expect(clamped[0].keyframeMs).toBe(1000);
    const widened = clampRemakeShotBoundaries(shots, 1, 1500, 5000, 0, 4000);
    expect(widened[1].sourceInMs).toBe(2000);
    expect(widened[1].sourceOutMs).toBe(4000);
    expect(validateRemakeShots(widened, 0, 4000)).toBe("");
});

const takes = (over: Partial<RemakeTake> = {}): RemakeTake => ({
    id: "v1",
    runId: "r1",
    shotId: "s1",
    unitId: "u1",
    kind: "video",
    resourceId: "res",
    taskId: "task",
    requestedDurationMs: 0,
    durationMs: 1000,
    createdAt: "",
    ...over,
});

test("remakeResultOffsets 按采用候选累计成片位置", () => {
    const shots = [shot(), shot({ id: "s2", sourceInMs: 2000, sourceOutMs: 4000 })];
    const run = {
        id: "r1",
        steps: [
            { id: "st1", kind: "video", shotId: "s1", unitId: "u1", status: "succeeded", attempt: 1 },
            { id: "st2", kind: "video", shotId: "s2", unitId: "u2", status: "succeeded", attempt: 1 },
        ],
        selections: { u2: { videoTakeId: "v2" } },
    } as unknown as RemakeRun;
    const list: RemakeTake[] = [takes({ unitId: "u1", durationMs: 2000 }), takes({ id: "v2", unitId: "u2", durationMs: 3000 }), takes({ id: "v3", unitId: "u2", durationMs: 9999 })];
    const offsets = remakeResultOffsets(shots, run, list);
    expect(offsets).toEqual([0, 2000]);
});

test("remakeResultOffsets 未生成镜头按 0 时长跳过", () => {
    const offsets = remakeResultOffsets([shot(), shot({ id: "s2" })], undefined, []);
    expect(offsets).toEqual([0, 0]);
});
