import { memo } from "react";

import { remakeTime } from "@/lib/remake/presentation";
import type { RemakeShot } from "@/services/api/remakes";

export type ShotStripProps = {
    shots: RemakeShot[];
    /** 当前选中的镜头 id（高亮） */
    selectedId?: string | null;
    /** 播放位置所在的镜头 id */
    playingId?: string | null;
    /** 已有视频产出的镜头 id 集合（底部绿点） */
    videoReadyIds?: Set<string>;
    /** 播放头相对整个区间的位置 0–1；缺省不显示 */
    playheadRatio?: number | null;
    compact?: boolean;
    disabled?: boolean;
    onSelect?: (shotId: string, index: number) => void;
    ariaLabel?: string;
};

/**
 * 镜头时间条：按镜头时长比例分段的横向条，点击定位。
 * 参考片/分镜/成片三个阶段共用；成片场景通过 videoReadyIds 标注已生成镜头。
 */
export const WorkbenchShotStrip = memo(function WorkbenchShotStrip({ shots, selectedId, playingId, videoReadyIds, playheadRatio, compact, disabled, onSelect, ariaLabel = "镜头时间条" }: ShotStripProps) {
    if (!shots.length) return null;
    return (
        <div className={`rk-strip${compact ? " is-compact" : ""}`} role="group" aria-label={ariaLabel}>
            {shots.map((shot, index) => {
                const duration = Math.max(1, shot.sourceOutMs - shot.sourceInMs);
                const isSelected = shot.id === selectedId;
                const isPlaying = shot.id === playingId;
                return (
                    <button
                        type="button"
                        key={shot.id}
                        className={`rk-strip-seg${isSelected ? " is-selected" : ""}${!isSelected && isPlaying ? " is-playing" : ""}`}
                        style={{ flexGrow: duration }}
                        disabled={disabled}
                        title={`镜头 ${index + 1} · ${remakeTime(shot.sourceInMs)}–${remakeTime(shot.sourceOutMs)}`}
                        aria-label={`镜头 ${index + 1}，${remakeTime(shot.sourceInMs)} 到 ${remakeTime(shot.sourceOutMs)}`}
                        aria-pressed={isSelected}
                        onClick={() => onSelect?.(shot.id, index)}
                    >
                        <span className="rk-strip-num">{index + 1}</span>
                        {videoReadyIds?.has(shot.id) ? <span className="rk-strip-flag" aria-hidden /> : null}
                    </button>
                );
            })}
            {playheadRatio != null && playheadRatio >= 0 && playheadRatio <= 1 ? <span className="rk-strip-cursor" style={{ left: `${Math.min(100, Math.max(0, playheadRatio * 100))}%` }} aria-hidden /> : null}
        </div>
    );
});
