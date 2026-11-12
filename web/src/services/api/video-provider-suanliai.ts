import { modelCapabilityConfigFor, videoResolutionRequest } from "@/lib/model-capabilities";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import { isPublicMediaUrl, normalizeVideoSeconds } from "./video-validation";
import type { RequestOptions, ResolvedAiConfig, VideoGenerationTask } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

// 算力AI 的 /v1/videos 收 JSON：参考素材是 URL 或 base64 字符串数组，不是 multipart 文件。
// 轮询不需要单独实现：成片返回在 url / video_url / result_url 上，pollOpenAIVideoTask 已覆盖。
export async function createSuanliaiVideoTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const payload: Record<string, unknown> = { model: modelOptionName(model) };
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) payload.prompt = trimmedPrompt;
    const seconds = Number.parseInt(normalizeVideoSeconds(config.videoSeconds), 10);
    if (Number.isFinite(seconds) && seconds > 0) payload.seconds = seconds;
    if (config.size) payload.aspect_ratio = config.size;
    const resolution = videoResolutionRequest(modelCapabilityConfigFor(config, model).video!, config.vquality);
    if (resolution) payload.resolution = resolution;
    const images = await mediaValues(references);
    if (images.length) payload.images = images;
    if (videoReferences.length) payload.videos = videoReferences.map((item) => item.url).filter(Boolean);
    if (audioReferences.length) payload.audios = audioReferences.map((item) => item.url).filter(Boolean);
    try {
        const created = await deps.transport.post<{ task_id?: string; id?: string; error?: { message?: string } }>(deps.transport.apiUrl("/videos"), payload, options);
        const id = created.task_id || created.id;
        if (!id) throw new Error("算力AI 视频接口没有返回任务 ID");
        return { id, provider: "openai", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "算力AI 视频任务创建失败"));
    }
}

// 公网地址原样透传，本地素材退化为 base64 data URL：算力AI 两种都接受，
// 但公网直链更稳，且大体积视频不会撑爆请求体。
async function mediaValues(references: ReferenceImage[]) {
    const values: string[] = [];
    for (const reference of references) {
        if (reference.url && isPublicMediaUrl(reference.url)) {
            values.push(reference.url);
            continue;
        }
        values.push(await imageToDataUrl(reference));
    }
    return values;
}
