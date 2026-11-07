import type { FeatureAvailability } from "@/stores/use-user-store";

export function workbenchEntryPath(features: Pick<FeatureAvailability, "imageWorkbenchEnabled" | "videoWorkbenchEnabled">) {
    return !features.imageWorkbenchEnabled && features.videoWorkbenchEnabled ? "/toolbox/video" : "/toolbox/image";
}
