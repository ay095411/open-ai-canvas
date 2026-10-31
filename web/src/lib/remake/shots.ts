import type { RemakeRun, RemakeShot, RemakeTake } from "@/services/api/remakes";

/**
 * 复刻分镜的纯编辑操作：拆分、合并、边界校正与成片定位估算。
 * 只操作草稿数组，落库仍走 PATCH /remakes/:id 的 shots + validateRemakeShots 校验。
 */

const joinText = (parts: Array<string | undefined>, separator: string) =>
    parts
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(separator);

/** 拆分镜头：在 atMs（默认中点）处一分为二；后段沿用原关键帧并在 warnings 中标注待校正。 */
export function splitRemakeShot(shots: RemakeShot[], index: number, options?: { atMs?: number; newId?: string }): RemakeShot[] {
    const shot = shots[index];
    if (!shot || shot.sourceOutMs - shot.sourceInMs < 2) return shots;
    const atMs = Math.min(shot.sourceOutMs - 1, Math.max(shot.sourceInMs + 1, Math.round(options?.atMs ?? (shot.sourceInMs + shot.sourceOutMs) / 2)));
    const next = shots.slice();
    next[index] = { ...shot, sourceOutMs: atMs, keyframeMs: Math.min(Math.max(shot.keyframeMs, shot.sourceInMs), atMs - 1) };
    next.splice(index + 1, 0, {
        ...shot,
        id: options?.newId || `${shot.id}-split`,
        sourceInMs: atMs,
        keyframeMs: Math.min(shot.sourceOutMs - 1, Math.max(atMs, shot.keyframeMs)),
        warnings: [`由镜头 ${index + 1} 拆分生成：沿用原关键帧，请校正区间、画面描述与提示词`],
    });
    return next;
}

/** 与前一镜合并：区间取并集，文本字段拼接，主体出现取或；关键帧沿用前一镜。 */
export function mergeRemakeShotWithPrevious(shots: RemakeShot[], index: number): RemakeShot[] {
    if (index <= 0 || !shots[index] || !shots[index - 1]) return shots;
    const prev = shots[index - 1];
    const cur = shots[index];
    const merged: RemakeShot = {
        ...prev,
        sourceOutMs: cur.sourceOutMs,
        description: joinText([prev.description, cur.description], "；"),
        subjectDescription: joinText([prev.subjectDescription, cur.subjectDescription], "；") || undefined,
        shotSize: joinText([prev.shotSize, cur.shotSize], "；"),
        camera: joinText([prev.camera, cur.camera], "；"),
        motion: joinText([prev.motion, cur.motion], "；"),
        dialogue: joinText([prev.dialogue, cur.dialogue], "；"),
        imagePrompt: joinText([prev.imagePrompt, cur.imagePrompt], "\n"),
        videoPrompt: joinText([prev.videoPrompt, cur.videoPrompt], "\n"),
        subjectPresent: prev.subjectPresent || cur.subjectPresent,
        warnings: [...new Set([...(prev.warnings || []), ...(cur.warnings || [])])],
    };
    return [...shots.slice(0, index - 1), merged, ...shots.slice(index + 1)];
}

/** 校正镜头边界：夹取到全局区间与相邻镜头之间（保持 1ms 最小宽度），关键帧随之夹回区间内。 */
export function clampRemakeShotBoundaries(shots: RemakeShot[], index: number, nextInMs: number, nextOutMs: number, minInMs: number, maxOutMs: number): RemakeShot[] {
    const shot = shots[index];
    if (!shot) return shots;
    const lower = index > 0 ? shots[index - 1].sourceOutMs : minInMs;
    const upper = index + 1 < shots.length ? shots[index + 1].sourceInMs : maxOutMs;
    const inMs = Math.min(Math.max(Math.round(nextInMs), lower), Math.max(lower, upper - 1));
    const outMs = Math.min(Math.max(Math.round(nextOutMs), inMs + 1), Math.max(inMs + 1, upper));
    return shots.map((item, i) => (i === index ? { ...item, sourceInMs: inMs, sourceOutMs: outMs, keyframeMs: Math.min(outMs - 1, Math.max(inMs, item.keyframeMs)) } : item));
}

/**
 * 按采用的视频候选估算每个镜头在成片中的起点（毫秒），用于源片/成片按镜头对照定位。
 * 未生成的镜头按 0 时长跳过；估算值与最终成片剪辑点可能存在差异，仅用于导航定位。
 */
export function remakeResultOffsets(shots: RemakeShot[], run: RemakeRun | null | undefined, takes: RemakeTake[]): number[] {
    const unitsByShot = new Map<string, string[]>();
    for (const step of run?.steps || []) {
        if (!step.unitId || !step.shotId) continue;
        const list = unitsByShot.get(step.shotId) || [];
        list.push(step.unitId);
        unitsByShot.set(step.shotId, list);
    }
    const videoTakes = new Map<string, RemakeTake>();
    for (const take of takes) {
        if (take.kind !== "video" || (run && take.runId !== run.id)) continue;
        const selectedId = run?.selections[take.unitId]?.videoTakeId;
        if (selectedId) {
            if (selectedId === take.id) videoTakes.set(take.unitId, take);
            continue;
        }
        if (!videoTakes.has(take.unitId)) videoTakes.set(take.unitId, take);
    }
    const offsets: number[] = [];
    let cursor = 0;
    for (const shot of shots) {
        offsets.push(cursor);
        for (const unitId of unitsByShot.get(shot.id) || []) cursor += Math.max(0, videoTakes.get(unitId)?.durationMs || 0);
    }
    return offsets;
}
