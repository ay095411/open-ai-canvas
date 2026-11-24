import { Button } from "antd";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { useNavigate } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceLoadingState } from "@/components/layout/workspace-state";
import type { CreationInspiration, InspirationGallerySource } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";
import "./inspirations.css";

const ZzaiGallery = lazy(() => import("./zzai-gallery"));

type InspirationsPageProps = {
    initialSource?: InspirationGallerySource;
    embedded?: boolean;
    onUse?: (item: CreationInspiration) => void;
    onPreview?: (item: CreationInspiration) => void;
};

export default function InspirationsPage({ embedded = false, onUse, onPreview, initialSource = "official-catalog" }: InspirationsPageProps = {}) {
    const navigate = useNavigate();
    const userScope = useUserStore((state) => state.user?.id ?? "guest");
    const hydrationError = useInspirationStore((state) => state.hydrationError);

    useEffect(() => {
        void useInspirationStore.persist.rehydrate();
    }, [userScope]);

    const handleUse = useCallback(
        (item: CreationInspiration) => {
            if (onUse) onUse(item);
            else navigate("/create", { state: { mode: item.mode, prompt: fillablePrompt(item) } });
        },
        [navigate, onUse],
    );

    return (
        <WorkspacePage className={embedded ? "inspiration-library-embedded" : undefined}>
            {!embedded ? <PageHeader title="灵感大厅" description="浏览官方开源目录与本站审核素材，收藏到当前账号的浏览器本地。" /> : null}
            {hydrationError ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="alert">
                    <span>{hydrationError}</span>
                    <Button size="small" onClick={() => void useInspirationStore.persist.rehydrate()}>
                        重试本地记录
                    </Button>
                </div>
            ) : null}
            <Suspense fallback={<WorkspaceLoadingState label="正在加载在线提示词" />}>
                <ZzaiGallery key={userScope} initialSource={initialSource} onUse={handleUse} onPreview={onPreview} userScope={userScope} />
            </Suspense>
        </WorkspacePage>
    );
}
