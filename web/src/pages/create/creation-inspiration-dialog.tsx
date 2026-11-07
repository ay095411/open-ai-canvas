import { App } from "antd";
import { ArrowLeft, X } from "lucide-react";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { InspirationDetailContent } from "@/pages/inspirations/inspiration-detail-modal";
import type { CreationMode } from "./creation-types";
import "./creation-inspiration-dialog.css";

const InspirationLibrary = lazy(() => import("@/pages/inspirations"));

export default function CreationInspirationDialog({
    open,
    initialItem = null,
    initialVideo,
    onClose,
    afterClose,
    onUse,
}: {
    open: boolean;
    initialItem?: CreationInspiration | null;
    initialVideo?: string;
    onClose: () => void;
    afterClose: () => void;
    onUse: (mode: CreationMode, prompt: string) => void;
}) {
    const { message } = App.useApp();
    const [detail, setDetail] = useState(initialItem);
    const [using, setUsing] = useState(false);
    const pendingUse = useRef<CreationInspiration | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const libraryRef = useRef<HTMLDivElement>(null);
    const previewTrigger = useRef<HTMLElement | null>(null);
    const hasLibrary = !initialItem;
    const title = detail ? "灵感详情" : "灵感大厅";

    useLayoutEffect(() => {
        if (!open) return;
        if (detail) {
            headingRef.current?.focus({ preventScroll: true });
        } else if (previewTrigger.current) {
            previewTrigger.current.focus({ preventScroll: true });
            previewTrigger.current = null;
        }
    }, [detail, open]);

    const previewInspiration = (item: CreationInspiration) => {
        const activeElement = document.activeElement;
        previewTrigger.current = activeElement instanceof HTMLElement && libraryRef.current?.contains(activeElement) ? activeElement : null;
        setDetail(item);
    };

    const copyPrompt = useCallback(
        async (text: string, label: string) => {
            try {
                await navigator.clipboard.writeText(text);
                message.success(`${label}已复制`);
            } catch {
                message.error("复制失败，请手动选中文本");
            }
        },
        [message],
    );

    const useInspiration = (item: CreationInspiration) => {
        if (pendingUse.current) return;
        pendingUse.current = item;
        setUsing(true);
        onClose();
    };

    const finishClose = () => {
        const item = pendingUse.current;
        pendingUse.current = null;
        afterClose();
        // AntD 先恢复触发器焦点，再回调 afterClose；此时填词才能把焦点留在创作输入框。
        if (item) onUse(item.mode, fillablePrompt(item));
    };

    return (
        <AppModal open={open} onCancel={onClose} afterClose={finishClose} width={hasLibrary ? 1440 : 1080} centered title={null} footer={null} flush closable={false} aria-label={title}>
            <section className="creation-inspiration-dialog">
                <header className="creation-inspiration-dialog-header">
                    <div>
                        {hasLibrary && detail ? (
                            <button type="button" aria-label="返回灵感大厅" onClick={() => setDetail(null)}>
                                <ArrowLeft size={18} aria-hidden="true" />
                            </button>
                        ) : null}
                        <h2 ref={headingRef} tabIndex={-1}>
                            {title}
                        </h2>
                    </div>
                    <button type="button" aria-label="关闭灵感弹窗" onClick={onClose}>
                        <X size={18} aria-hidden="true" />
                    </button>
                </header>
                <div className="creation-inspiration-dialog-body">
                    {hasLibrary ? (
                        <div ref={libraryRef} className="creation-inspiration-dialog-library" hidden={Boolean(detail)}>
                            <Suspense
                                fallback={
                                    <p className="creation-inspiration-dialog-loading" role="status">
                                        正在加载灵感大厅…
                                    </p>
                                }
                            >
                                <InspirationLibrary embedded onPreview={previewInspiration} onUse={useInspiration} />
                            </Suspense>
                        </div>
                    ) : null}
                    {detail ? (
                        <InspirationDetailContent
                            item={detail}
                            videoUrl={initialVideo}
                            onClose={hasLibrary ? () => setDetail(null) : onClose}
                            closeLabel={hasLibrary ? "返回大厅" : "关闭"}
                            onUse={useInspiration}
                            useLabel="带进创作区"
                            useDisabled={using}
                            onCopy={copyPrompt}
                        />
                    ) : null}
                </div>
            </section>
        </AppModal>
    );
}
