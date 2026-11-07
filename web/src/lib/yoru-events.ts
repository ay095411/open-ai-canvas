/** 页面通知小夜做出反应的全局事件；只携带动作，不携带任何用户内容。 */
export const YORU_CHEER_EVENT = "meiye:yoru-cheer";
export const YORU_SETTINGS_CHANGED = "canvas:yoru-settings-changed";
export const YORU_SETTINGS_CHANNEL = "canvas-yoru-settings";

export function notifyYoruSettingsChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(YORU_SETTINGS_CHANGED));
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const channel = new BroadcastChannel(YORU_SETTINGS_CHANNEL);
        try {
            channel.postMessage("changed");
        } finally {
            channel.close();
        }
    } catch (error) {
        console.warn("小夜配置已保存，但通知其他标签页失败", error instanceof Error ? error.message : "未知错误");
    }
}

export function cheerYoru() {
    window.dispatchEvent(new Event(YORU_CHEER_EVENT));
}
