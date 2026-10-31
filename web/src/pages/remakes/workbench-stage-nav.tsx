import { memo } from "react";

export type RemakeStageKey = "source" | "plan" | "shots" | "export";

export type RemakeStageStatus = "idle" | "done" | "busy" | "warn";

const STAGE_ITEMS: Array<{ key: RemakeStageKey; label: string }> = [
    { key: "source", label: "参考片" },
    { key: "plan", label: "复刻方案" },
    { key: "shots", label: "分镜制作" },
    { key: "export", label: "成片" },
];

/** 工作台四阶段导航：可点击切换主内容区；右侧状态点标注每阶段进度。 */
export const WorkbenchStageNav = memo(function WorkbenchStageNav({ value, onChange, status }: { value: RemakeStageKey; onChange: (stage: RemakeStageKey) => void; status: Record<RemakeStageKey, RemakeStageStatus> }) {
    return (
        <nav className="rk-stage-nav" aria-label="复刻阶段">
            {STAGE_ITEMS.map((item, index) => {
                const state = status[item.key];
                return (
                    <button type="button" key={item.key} role="tab" aria-selected={value === item.key} className={`rk-stage-item${value === item.key ? " is-active" : ""}`} onClick={() => onChange(item.key)}>
                        <span className="rk-stage-num" aria-hidden>
                            {state === "done" && value !== item.key ? "✓" : index + 1}
                        </span>
                        <span className="rk-stage-label-full">{item.label}</span>
                        {state !== "idle" ? <span className={`rk-stage-dot${state === "done" ? " is-done" : state === "busy" ? " is-busy" : " is-warn"}`} aria-hidden /> : null}
                    </button>
                );
            })}
        </nav>
    );
});
