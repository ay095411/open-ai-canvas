import { useState } from "react";
import { Copy, Check, ExternalLink, UsersRound } from "lucide-react";
import { App, Popover } from "antd";
import { useAppearanceStore } from "@/stores/use-appearance-store";

/**
 * 顶栏 QQ 交流群展示入口与群二维码悬浮卡片。
 *
 * 对齐 kunrouai.com 体验：
 * 1. 位于积分中心旁边，展示群组图标与群号文案（移动端自适应仅保留图标）；
 * 2. 悬停或点击弹出 Popover 卡片，展示 QQ 群二维码大图、群号、一键复制与加群跳转；
 * 3. 群号、群链接与二维码图片在后台“站点及外观”中统一配置，未配置时不展示入口。
 */
export function WorkspaceTopBarQQGroup() {
    const { message } = App.useApp();
    const appearance = useAppearanceStore((state) => state.appearance);
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);

    const qqGroupNumber = appearance.qqGroupNumber?.trim() || "";
    const qqGroupQrcodeUrl = appearance.qqGroupQrcodeUrl?.trim() || "";
    const qqGroupLink = appearance.qqGroupLink?.trim() || "";

    // 未配置群号与二维码与链接时，不展示该入口
    if (!qqGroupNumber && !qqGroupQrcodeUrl && !qqGroupLink) {
        return null;
    }

    const displayText = qqGroupNumber ? `QQ交流群:${qqGroupNumber}` : "QQ交流群";

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!qqGroupNumber) return;
        navigator.clipboard.writeText(qqGroupNumber).then(() => {
            setCopied(true);
            message.success("QQ群号已复制到剪贴板");
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
            message.error("复制失败，请手动长按复制");
        });
    };

    const popoverContent = (
        <div className="workspace-qq-group-card flex flex-col items-center gap-3 p-1.5 text-center" style={{ width: 220 }}>
            <div className="flex flex-col items-center gap-1 w-full">
                <span className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                    <UsersRound className="size-4 text-primary" aria-hidden="true" />
                    官方 QQ 交流群
                </span>
                {qqGroupNumber ? (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <span>群号: <strong className="text-foreground tracking-wide select-all font-mono">{qqGroupNumber}</strong></span>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center justify-center size-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="复制群号"
                            aria-label="复制群号"
                        >
                            {copied ? <Check className="size-3 text-emerald-500" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                        </button>
                    </div>
                ) : null}
            </div>

            {qqGroupQrcodeUrl ? (
                <div className="size-44 rounded-xl overflow-hidden bg-white p-2 border border-border shadow-sm flex items-center justify-center">
                    <img
                        src={qqGroupQrcodeUrl}
                        alt="QQ交流群二维码"
                        className="size-full object-contain select-none"
                    />
                </div>
            ) : null}

            <div className="flex items-center gap-2 w-full pt-0.5">
                {qqGroupLink ? (
                    <a
                        href={qqGroupLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                        <span>一键加群</span>
                        <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                ) : null}
                {qqGroupNumber && !qqGroupLink ? (
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/80 transition-colors cursor-pointer"
                    >
                        <Copy className="size-3" aria-hidden="true" />
                        <span>复制群号</span>
                    </button>
                ) : null}
            </div>
            {qqGroupQrcodeUrl ? <span className="text-[11px] text-muted-foreground">扫码加入官方创作者交流群</span> : null}
        </div>
    );

    const triggerButton = (
        <button
            type="button"
            className="app-workspace-topbar-qq-group flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
            aria-label={displayText}
            onClick={() => {
                if (qqGroupLink && !qqGroupQrcodeUrl) {
                    window.open(qqGroupLink, "_blank", "noopener,noreferrer");
                } else {
                    setOpen(!open);
                }
            }}
        >
            <UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="hidden sm:inline tracking-tight">{displayText}</span>
        </button>
    );

    if (qqGroupQrcodeUrl || qqGroupNumber) {
        return (
            <Popover
                content={popoverContent}
                trigger={["hover", "click"]}
                open={open}
                onOpenChange={setOpen}
                placement="bottomRight"
                overlayClassName="workspace-qq-group-popover"
            >
                {triggerButton}
            </Popover>
        );
    }

    return (
        <a
            href={qqGroupLink}
            target="_blank"
            rel="noopener noreferrer"
            className="app-workspace-topbar-qq-group flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={displayText}
        >
            <UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="hidden sm:inline tracking-tight">{displayText}</span>
        </a>
    );
}

export default WorkspaceTopBarQQGroup;
