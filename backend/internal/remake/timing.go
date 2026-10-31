package remake

import (
	"fmt"
	"sort"
	"strings"
)

// BuildUnits respects the provider's declared durations without inventing defaults.
func BuildUnits(shots []SourceShot, allowedSeconds []int, minSeconds, maxSeconds int) ([]GenerationUnit, error) {
	if len(shots) == 0 || len(shots) > MaxSourceShots {
		return nil, fmt.Errorf("应包含 1 至 %d 个源镜头", MaxSourceShots)
	}
	allowed := append([]int(nil), allowedSeconds...)
	if len(allowed) == 0 {
		if minSeconds <= 0 || maxSeconds < minSeconds || maxSeconds > 600 {
			return nil, fmt.Errorf("视频模型没有有效的时长能力，请完善模型配置")
		}
		for duration := minSeconds; duration <= maxSeconds; duration++ {
			allowed = append(allowed, duration)
		}
	}
	for _, duration := range allowed {
		if duration <= 0 || duration > 600 || (minSeconds > 0 && duration < minSeconds) || (maxSeconds > 0 && duration > maxSeconds) {
			return nil, fmt.Errorf("视频模型时长选项不合法")
		}
	}
	sort.Ints(allowed)
	maximum := int64(allowed[len(allowed)-1]) * 1000
	units := make([]GenerationUnit, 0, len(shots))
	seen := make(map[string]bool, len(shots))
	var total int64
	for index, shot := range shots {
		if strings.TrimSpace(shot.ID) == "" || seen[shot.ID] || shot.SourceInMs < 0 || shot.SourceOutMs <= shot.SourceInMs {
			return nil, fmt.Errorf("源镜头标识或区间无效")
		}
		if index > 0 && shots[index-1].SourceOutMs != shot.SourceInMs {
			return nil, fmt.Errorf("源镜头之间存在缺段或重叠")
		}
		seen[shot.ID] = true
		total += shot.SourceOutMs - shot.SourceInMs
		if total > MaxSourceDurationMs {
			return nil, fmt.Errorf("复刻区间不能超过 60 秒")
		}
		cursor := shot.SourceInMs
		for part := 1; cursor < shot.SourceOutMs; part++ {
			target := min(shot.SourceOutMs-cursor, maximum)
			requested := maximum
			for _, seconds := range allowed {
				if int64(seconds)*1000 >= target {
					requested = int64(seconds) * 1000
					break
				}
			}
			units = append(units, GenerationUnit{
				ID: fmt.Sprintf("%s-part-%02d", shot.ID, part), SourceShotID: shot.ID,
				TargetDurationMs: target, RequestedDurationMs: requested,
				SourceInMs: cursor, SourceOutMs: cursor + target,
			})
			cursor += target
		}
	}
	return units, nil
}

func KeyframePrompt(shot SourceShot, targetDescription, style string) string {
	base := strings.TrimSpace(shot.ImagePrompt)
	if !shot.SubjectPresent {
		return base + "\n此镜头没有需要替换的主体，保持原场景与构图，不添加目标人物或商品。\n整体风格：" + strings.TrimSpace(style)
	}
	return base + "\n参考图1只提供原镜头的构图、景别与环境。其余参考图提供同一目标主体的身份和外观。\n用目标主体替换原主体，不保留原主体的脸、商品包装或旧标识；保持未要求替换的其他人物和环境。\n原主体：" + strings.TrimSpace(shot.SubjectDescription) + "\n目标主体：" + strings.TrimSpace(targetDescription) + "\n整体风格：" + strings.TrimSpace(style)
}

func VideoPrompt(shot SourceShot, unit GenerationUnit) string {
	return strings.TrimSpace(shot.VideoPrompt) + fmt.Sprintf("\n使用提供的新主体关键帧保持身份、产品外观、构图与风格。关键动作应完整发生在本次片段前 %.3f 秒，之后自然保持状态。最终剪辑使用这段 %.3f 秒，不通过加速对白凑时长。", float64(unit.TargetDurationMs)/1000, float64(unit.TargetDurationMs)/1000)
}
