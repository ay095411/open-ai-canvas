import { http } from "@/services/api/request";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";

export type YoruSettings = {
    enabled: boolean;
    audience: "admin" | "all";
    name: string;
    welcome: string;
    questions: string[];
    navigation: string[];
    motionEnabled: boolean;
    avatarSize: number;
    defaultRight: number;
    defaultBottom: number;
    saveHistory: boolean;
};
export type YoruMessage = { role: "user" | "assistant"; content: string };

export type AdminYoruSettings = YoruSettings & {
    modelMode: "direct" | "smart_route";
    channelModelId: string;
    logicalModelId: string;
    systemPrompt: string;
    knowledge: string;
    dailyCalls: number;
    maxChargeMicrocredits: number;
    maxDailyMicrocredits: number;
    maxOutputTokens: number;
    allowGuests: boolean;
    voiceEnabled: boolean;
};

export const getPublicYoru = (signal?: AbortSignal) => http.get<YoruSettings>("/public/yoru", { signal });
export const getAdminYoru = (signal?: AbortSignal) => http.get<AdminYoruSettings>("/admin/settings/yoru", { signal });
export const saveAdminYoru = (value: AdminYoruSettings) => http.put<AdminYoruSettings>("/admin/settings/yoru", value);

export async function sendYoruMessage(input: { message: string; history: YoruMessage[]; page: string; publicModelName?: string; errorText?: string }, onDelta: (text: string) => void, signal?: AbortSignal) {
    const task = await http.post<GenerationTask>("/yoru/messages", input, { signal });
    const result = await waitForGenerationTask(task.id, { initialTask: task, useTextEvents: true, onTextDelta: onDelta, signal, timeoutMs: 180000 });
    if (result.status !== "succeeded") throw new Error(result.error || "小夜暂时没能完成回复");
    const data = result.resultJson ? (JSON.parse(result.resultJson) as { text?: string }) : {};
    return data.text || result.textDraft || "";
}
