import type { CreationInspiration } from "./catalog";

/** 上游有中文正文时优先使用中文，否则保留原文。 */
export function fillablePrompt(item: CreationInspiration): string {
    return (item.promptZh || item.prompt || "").trim();
}
