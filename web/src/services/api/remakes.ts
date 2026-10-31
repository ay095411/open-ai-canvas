import { compactApiParams, http } from "@/services/api/request";
import type { DramaModelCatalog } from "@/services/api/drama";

export type RemakeModelChoice = { logicalModelId?: string; channelId?: string; modelKey?: string; label?: string; priceLabel?: string };
export type RemakeCapability = "text" | "image" | "video";
export type RemakeMode = "quick" | "review";
export type RemakeGoal = "analysis" | "keyframes" | "complete";
export type RemakeSettings = {
    sourceInMs: number;
    sourceOutMs: number;
    targetDescription: string;
    targetResourceIds: string[];
    style: string;
    aspectRatio: "9:16" | "16:9" | "1:1";
    audioMode: "original" | "generated" | "mute";
    mode: RemakeMode;
    budgetMicrocredits: number;
    models: Record<RemakeCapability, RemakeModelChoice>;
    videoResolution?: string;
};
export type RemakeShot = {
    id: string;
    sourceInMs: number;
    sourceOutMs: number;
    keyframeMs: number;
    keyframeResourceId: string;
    description: string;
    shotSize: string;
    camera: string;
    motion: string;
    dialogue: string;
    subjectPresent: boolean;
    subjectDescription?: string;
    imagePrompt: string;
    videoPrompt: string;
    warnings?: string[];
};
export type RemakeProject = { id: string; title: string; sourceResourceId: string; settings: RemakeSettings; draftVersion: number; status: string; stage: string; error: string; createdAt: string; updatedAt: string };
export type RemakeStep = { id: string; kind: string; shotId?: string; unitId?: string; status: string; taskId?: string; error?: string; resourceId?: string; attempt: number };
export type RemakeSelection = { imageTakeId?: string; videoTakeId?: string };
export type RemakeRun = {
    id: string;
    projectId: string;
    status: string;
    stage: string;
    goal: RemakeGoal;
    mode: RemakeMode;
    error: string;
    completedSteps: number;
    totalSteps: number;
    budgetMicrocredits: number;
    spentMicrocredits: number;
    reservedMicrocredits: number;
    selectionVersion: number;
    selections: Record<string, RemakeSelection>;
    steps: RemakeStep[];
    createdAt: string;
    updatedAt: string;
};
export type RemakeTake = { id: string; runId: string; shotId: string; unitId: string; kind: "image" | "video"; resourceId: string; taskId: string; requestedDurationMs: number; durationMs: number; createdAt: string };
export type RemakeExport = { id: string; runId: string; resourceId: string; subtitleSrt: string; durationMs: number; createdAt: string };
export type RemakeAnalysis = { sourceResourceId: string; sourceDurationMs: number; sourceInMs: number; sourceOutMs: number; width: number; height: number; fps: number; hasAudio: boolean; shots: RemakeShot[]; warnings?: string[] };
export type RemakeDetail = { project: RemakeProject; analysis: RemakeAnalysis | null; shots: RemakeShot[]; runs: RemakeRun[]; activeRun: RemakeRun | null; takes: RemakeTake[]; exports: RemakeExport[] };
export type RemakeModelCatalog = Pick<DramaModelCatalog, "options" | "defaults" | "unavailable">;
export type RemakeAction = "pause" | "resume" | "cancel" | "retry_failed" | "approve_and_continue";

const projectPath = (id: string) => `/remakes/${encodeURIComponent(id)}`;
export function listRemakes(options: { page: number; pageSize: number; query?: string; status?: string; signal?: AbortSignal }) {
    return http.get<{ items: RemakeProject[]; total: number; page: number; pageSize: number }>("/remakes", { params: compactApiParams({ page: options.page, pageSize: options.pageSize, q: options.query, status: options.status }), signal: options.signal });
}
export function getRemake(id: string, signal?: AbortSignal) {
    return http.get<RemakeDetail>(projectPath(id), { signal });
}
export function getRemakeModels(signal?: AbortSignal) {
    return http.get<RemakeModelCatalog>("/remakes/models", { signal });
}
export function createRemake(payload: { title: string; sourceResourceId: string; settings: RemakeSettings }) {
    return http.post<RemakeDetail>("/remakes", payload);
}
export function updateRemake(id: string, payload: { expectedVersion: number; title?: string; settings?: RemakeSettings; shots?: RemakeShot[] }) {
    return http.patch<RemakeDetail>(projectPath(id), payload);
}
export function deleteRemake(id: string) {
    return http.delete<{ id: string }>(projectPath(id));
}
export function startRemakeRun(id: string, payload: { expectedVersion: number; idempotencyKey: string; goal: RemakeGoal; mode?: RemakeMode; shotIds?: string[] }) {
    return http.post<RemakeDetail>(`${projectPath(id)}/runs`, payload);
}
export function actOnRemakeRun(id: string, runId: string, payload: { action: RemakeAction; expectedSelectionVersion?: number }) {
    return http.post<RemakeDetail>(`${projectPath(id)}/runs/${encodeURIComponent(runId)}/actions`, payload);
}
export function selectRemakeTakes(id: string, runId: string, payload: { expectedSelectionVersion: number; selections: Record<string, RemakeSelection> }) {
    return http.put<RemakeDetail>(`${projectPath(id)}/runs/${encodeURIComponent(runId)}/selections`, payload);
}
export function exportRemake(id: string, runId: string) {
    return http.post<RemakeDetail>(`${projectPath(id)}/exports`, { runId });
}
