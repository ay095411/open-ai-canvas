import { AppModal } from "@/components/ui/product/app-modal";
import { FolderTree, X } from "lucide-react";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasAssetVersion } from "@/lib/canvas/canvas-asset-catalog";
import { CanvasAssetView } from "./canvas-asset-view";

export type CanvasAssetModalProps = {
    open: boolean;
    onClose: () => void;
    nodes: CanvasNodeData[];
    onLocate: (nodeId: string) => void;
    onRename: (updates: Array<{ nodeId: string; title: string }>) => void;
    onPromoteVersion: (version: CanvasAssetVersion) => void;
    onDownloadMedia: (node: CanvasNodeData) => void | Promise<void>;
    onUpload: () => void;
};

/**
 * 画布资产模态弹窗：
 * 代替原有的覆盖式全屏视图切换，保持画布为默认视图，
 * 点击「查看资产」时以大弹窗形式展示资产列表与版本；
 * 点击「在画布中定位」自动关闭弹窗并聚焦目标节点。
 */
export function CanvasAssetModal({
    open,
    onClose,
    nodes,
    onLocate,
    onRename,
    onPromoteVersion,
    onDownloadMedia,
    onUpload,
}: CanvasAssetModalProps) {
    return (
        <AppModal
            open={open}
            onCancel={onClose}
            title={null}
            footer={null}
            closable={false}
            centered
            flush
            destroyOnHidden
            width="min(1240px, calc(100vw - 32px))"
            styles={{
                body: {
                    height: "min(760px, calc(100dvh - 80px))",
                    padding: 0,
                    overflow: "hidden",
                },
            }}
            rootClassName="canvas-asset-modal"
        >
            <div className="flex size-full min-h-0 flex-col overflow-hidden bg-background">
                <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-foreground/[.02] px-4">
                    <div className="flex items-center gap-2">
                        <FolderTree className="size-4 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">画布资产</span>
                        <span className="text-xs text-muted-foreground tabular-nums">（共 {nodes.length} 个节点）</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="关闭资产弹窗"
                    >
                        <X className="size-4" />
                    </button>
                </header>
                <div className="min-h-0 flex-1">
                    <CanvasAssetView
                        nodes={nodes}
                        onLocate={(nodeId) => {
                            onClose();
                            onLocate(nodeId);
                        }}
                        onRename={onRename}
                        onPromoteVersion={onPromoteVersion}
                        onDownloadMedia={onDownloadMedia}
                        onUpload={onUpload}
                    />
                </div>
            </div>
        </AppModal>
    );
}
