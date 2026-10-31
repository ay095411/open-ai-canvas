import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { resourceIdFromStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { normalizeAssetCategory } from "@/lib/asset-category";
import type { Asset } from "@/stores/use-asset-store";

export type RemakeMediaAsset = Extract<Asset, { kind: "image" | "video" }>;

export function isRemakeMediaAsset(asset: Asset): asset is RemakeMediaAsset {
    return asset.kind === "image" || asset.kind === "video";
}

/** 把素材库条目映射为选择弹窗数据源；一键复刻的新建页与工作台共用。 */
export function buildRemakePickerItems(assets: Asset[]): AssetLibraryPickerItem[] {
    return assets.filter(isRemakeMediaAsset).map((asset) => ({
        id: asset.id,
        title: asset.title,
        category: normalizeAssetCategory(asset.category),
        archived: asset.status === "archived",
        kindLabel: asset.kind === "video" ? "视频" : "图片",
        mediaKind: asset.kind,
        asset,
        searchText: (asset.tags || []).join(" "),
    }));
}

/**
 * 把素材库条目落成服务端资源：已有关联 resourceId 直接复用；
 * 本地 IndexedDB / dataURL 的 blob 转传服务端，避免引用只存在浏览器里的素材。
 */
export async function ensureRemakeResource(item: AssetLibraryPickerItem, kind: "image" | "video") {
    const candidate = item.asset;
    if (!candidate || !isRemakeMediaAsset(candidate)) throw new Error("“" + item.title + "”不是可用素材");
    const asset = candidate;
    const storageKey = asset.data.storageKey;
    const existingId = resourceIdFromStorageKey(storageKey);
    if (existingId) return existingId;

    let blob: Blob | null = null;
    let durationMs: number | undefined;
    if (kind === "image") {
        if (asset.kind !== "image") throw new Error("“" + item.title + "”不是图片");
        blob = storageKey ? await getImageBlob(storageKey) : null;
        if (!blob && asset.data.dataUrl) {
            const response = await fetch(asset.data.dataUrl);
            if (!response.ok) throw new Error("无法读取“" + item.title + "”");
            blob = await response.blob();
        }
    } else {
        if (asset.kind !== "video") throw new Error("“" + item.title + "”不是视频");
        blob = storageKey ? await getMediaBlob(storageKey) : null;
        durationMs = asset.data.durationMs;
        if (!blob && (asset.data.url.startsWith("blob:") || asset.data.url.startsWith("data:"))) {
            const response = await fetch(asset.data.url);
            if (!response.ok) throw new Error("无法读取“" + item.title + "”");
            blob = await response.blob();
        }
    }
    if (!blob) throw new Error("“" + item.title + "”的本地文件已不存在，请重新上传");

    const resource = await uploadResourceFile(blob, kind, {
        fileName: item.title,
        width: asset.data.width,
        height: asset.data.height,
        durationMs,
    });
    if (!resource.id) throw new Error("“" + item.title + "”没有成功保存到服务端");
    return resource.id;
}
