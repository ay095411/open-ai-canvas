import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";

const MIIT_FILING_URL = "https://beian.miit.gov.cn/";

export function SiteComplianceFooter({ className, variant = "default" }: { className?: string; variant?: "default" | "auth" }) {
    const appearance = useAppearanceStore((state) => state.appearance);

    return (
        <footer className={cn("site-compliance-footer", variant === "auth" && "is-auth", className)} aria-label="站点版权、字体授权与备案信息">
            <span>{appearance.footerCopyright}</span>
            <a href="/fonts/oppo-sans/LICENSE.txt" target="_blank" rel="noopener noreferrer" aria-label="本网站使用 OPPO Sans 4.0 字体，查看字体授权说明">
                字体：OPPO Sans 4.0
                <ExternalLink aria-hidden="true" />
            </a>
            {appearance.icpFilingEnabled && appearance.icpFilingNumber ? (
                <a href={MIIT_FILING_URL} target="_blank" rel="noopener noreferrer" aria-label={`${appearance.icpFilingNumber}，前往工业和信息化部备案管理系统查询`}>
                    {appearance.icpFilingNumber}
                    <ExternalLink aria-hidden="true" />
                </a>
            ) : null}
        </footer>
    );
}
