import { ArrowUpRight } from "lucide-react";
import type { MouseEvent } from "react";
import { Link } from "react-router";

import { mayNavigateWithAuth } from "@/lib/guard-navigation";
import "./creation-home-feature-matrix.css";

function guardHomeLink(event: MouseEvent<HTMLAnchorElement>, to: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!mayNavigateWithAuth(to)) event.preventDefault();
}

export function CreationHomeAgentEntry({ onOpenAgentNewCanvas, openingAgentCanvas }: { onOpenAgentNewCanvas: () => void; openingAgentCanvas: boolean }) {
    return (
        <section className="creation-home-agent-entry" aria-label="画布 Agent 协作">
            <span>需要一起梳理素材和镜头？</span>
            <button type="button" disabled={openingAgentCanvas} onClick={onOpenAgentNewCanvas}>
                {openingAgentCanvas ? "正在新建画布…" : "新建画布，与 Agent 创作"}
                <ArrowUpRight aria-hidden="true" />
            </button>
            <Link to="/canvas?agent=1" onClick={(event) => guardHomeLink(event, "/canvas?agent=1")}>使用已有画布</Link>
        </section>
    );
}
