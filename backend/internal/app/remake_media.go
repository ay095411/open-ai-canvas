package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/remake"
)

const remakeMaxSourceBytes int64 = 1 << 30

type remakeProbe struct {
	DurationMs int64
	Width      int
	Height     int
	FPS        float64
	HasAudio   bool
}

// inspectRemakeMedia operates on owned resources and keeps all times relative to
// the original file, including when the user selects a smaller source interval.
func (s *Service) inspectRemakeMedia(ctx context.Context, userID, resourceID string, sourceInMs, sourceOutMs int64) (remake.Analysis, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(resourceID) == "" || sourceInMs < 0 || (sourceOutMs != 0 && sourceOutMs <= sourceInMs) {
		return remake.Analysis{}, BadAuthRequest("参考视频或复刻区间无效")
	}
	ffmpeg, err := renderFfmpegBinary()
	if err != nil {
		return remake.Analysis{}, err
	}
	ffprobe, err := renderFfprobeBinary()
	if err != nil {
		return remake.Analysis{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return remake.Analysis{}, err
	}
	defer body.Close()
	if !strings.HasPrefix(resource.MimeType, "video/") || resource.Size <= 0 || resource.Size > remakeMaxSourceBytes {
		return remake.Analysis{}, BadAuthRequest("请选择已上传的视频文件，文件大小不能超过 1 GiB")
	}
	dir, err := os.MkdirTemp("", "yingce-remake-")
	if err != nil {
		return remake.Analysis{}, fmt.Errorf("无法准备复刻媒体处理目录")
	}
	defer func() {
		if cleanupErr := removeRemakeTemp(dir); cleanupErr != nil {
			_ = s.log(userID, "", "warn", "清理复刻临时媒体失败", "")
		}
	}()
	input := filepath.Join(dir, "source"+extForMime(resource.MimeType))
	file, err := os.Create(input)
	if err != nil {
		return remake.Analysis{}, fmt.Errorf("无法写入参考视频临时文件")
	}
	stopRead := context.AfterFunc(ctx, func() { _ = body.Close() })
	written, copyErr := io.Copy(file, io.LimitReader(body, remakeMaxSourceBytes+1))
	stopRead()
	closeErr := file.Close()
	if ctx.Err() != nil {
		return remake.Analysis{}, fmt.Errorf("读取参考视频超时或已取消: %w", ctx.Err())
	}
	if copyErr != nil || closeErr != nil || written <= 0 || written > remakeMaxSourceBytes || written != resource.Size {
		return remake.Analysis{}, fmt.Errorf("参考视频未完整读取，请确认资源可访问后重试")
	}
	probe, err := probeRemakeFile(ctx, ffprobe, input)
	if err != nil {
		return remake.Analysis{}, err
	}
	if sourceOutMs == 0 {
		sourceOutMs = probe.DurationMs
	}
	if sourceInMs >= sourceOutMs || sourceOutMs > probe.DurationMs || sourceOutMs-sourceInMs > remake.MaxSourceDurationMs {
		return remake.Analysis{}, BadAuthRequest("复刻区间应位于原视频内且不超过 60 秒")
	}
	cutOutput, err := runRemakeCommand(ctx, ffmpeg, []string{
		"-hide_banner", "-nostdin", "-loglevel", "info", "-ss", remakeSeconds(sourceInMs), "-i", input,
		"-t", remakeSeconds(sourceOutMs - sourceInMs), "-an", "-vf", "setpts=PTS-STARTPTS,select=gt(scene\\,0.32),showinfo", "-f", "null", "-",
	}, true, 4*1024*1024)
	if err != nil {
		return remake.Analysis{}, fmt.Errorf("视频切镜检测失败: %w", err)
	}
	shots, err := remakeSceneShots(string(cutOutput), sourceInMs, sourceOutMs)
	if err != nil {
		return remake.Analysis{}, err
	}
	analysis := remake.Analysis{
		SourceResourceID: resourceID, SourceDurationMs: probe.DurationMs,
		SourceInMs: sourceInMs, SourceOutMs: sourceOutMs,
		Width: probe.Width, Height: probe.Height, FPS: probe.FPS, HasAudio: probe.HasAudio,
		Shots: shots, Warnings: []string{"镜头边界来自画面变化检测，闪光、快动作及渐变转场可能需要手动校正；动作与运镜的单帧分析属于推测。"},
	}
	for i := range analysis.Shots {
		shot := &analysis.Shots[i]
		output := filepath.Join(dir, fmt.Sprintf("frame-%02d.jpg", i+1))
		_, err := runRemakeCommand(ctx, ffmpeg, []string{
			"-hide_banner", "-nostdin", "-loglevel", "error", "-ss", remakeSeconds(shot.KeyframeMs), "-i", input,
			"-frames:v", "1", "-an", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-q:v", "3", "-y", output,
		}, true, 128*1024)
		if err != nil {
			return remake.Analysis{}, fmt.Errorf("镜头 %d 关键帧提取失败: %w", i+1, err)
		}
		frame, err := os.Open(output)
		if err != nil {
			return remake.Analysis{}, fmt.Errorf("镜头 %d 未产出关键帧", i+1)
		}
		config, _, decodeErr := image.DecodeConfig(frame)
		stat, statErr := frame.Stat()
		if decodeErr != nil || statErr != nil || config.Width <= 0 || config.Height <= 0 {
			frame.Close()
			return remake.Analysis{}, fmt.Errorf("镜头 %d 关键帧无效", i+1)
		}
		if _, err = frame.Seek(0, io.SeekStart); err != nil {
			frame.Close()
			return remake.Analysis{}, fmt.Errorf("镜头 %d 关键帧无法读取", i+1)
		}
		identity := fmt.Sprintf("remake-frame-v1:%s:%d", resourceID, shot.KeyframeMs)
		saved, saveErr := s.UploadResourceFile(userID, fmt.Sprintf("复刻参考-%02d.jpg", i+1), stat.Size(), "image", config.Width, config.Height, 0, frame, identity)
		frame.Close()
		if saveErr != nil {
			return remake.Analysis{}, saveErr
		}
		shot.KeyframeResourceID = saved.ID
	}
	if err := remake.ValidateAnalysis(analysis); err != nil {
		return remake.Analysis{}, err
	}
	return analysis, nil
}

func removeRemakeTemp(dir string) error {
	resolved, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	parent, err := filepath.Abs(os.TempDir())
	if err != nil || filepath.Dir(resolved) != filepath.Clean(parent) || !strings.HasPrefix(filepath.Base(resolved), "yingce-remake-") {
		return fmt.Errorf("拒绝清理非复刻临时目录")
	}
	return os.RemoveAll(resolved)
}

func probeRemakeFile(ctx context.Context, ffprobe, path string) (remakeProbe, error) {
	output, err := runRemakeCommand(ctx, ffprobe, []string{
		"-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation", "-of", "json", path,
	}, false, 1024*1024)
	if err != nil {
		return remakeProbe{}, fmt.Errorf("无法探测参考视频: %w", err)
	}
	return parseRemakeProbe(output)
}

func parseRemakeProbe(output []byte) (remakeProbe, error) {
	var data struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType  string `json:"codec_type"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			AverageFPS string `json:"avg_frame_rate"`
			FPS        string `json:"r_frame_rate"`
			Duration   string `json:"duration"`
			Tags       struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
			SideData []struct {
				Rotation float64 `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
	}
	if json.Unmarshal(output, &data) != nil {
		return remakeProbe{}, fmt.Errorf("视频探测结果格式无效")
	}
	result := remakeProbe{}
	for _, stream := range data.Streams {
		if stream.CodecType == "audio" {
			result.HasAudio = true
		}
		if stream.CodecType != "video" || result.Width != 0 || stream.Width <= 0 || stream.Height <= 0 {
			continue
		}
		result.Width, result.Height = stream.Width, stream.Height
		rotation, _ := strconv.ParseFloat(stream.Tags.Rotate, 64)
		if len(stream.SideData) > 0 {
			rotation = stream.SideData[0].Rotation
		}
		if math.Mod(math.Abs(rotation), 180) == 90 {
			result.Width, result.Height = result.Height, result.Width
		}
		result.FPS = remakeFraction(stream.AverageFPS)
		if result.FPS <= 0 {
			result.FPS = remakeFraction(stream.FPS)
		}
		// Video stream duration avoids treating a longer audio tail as visual content.
		result.DurationMs = remakeDuration(stream.Duration)
	}
	if result.DurationMs == 0 {
		result.DurationMs = remakeDuration(data.Format.Duration)
	}
	if result.Width <= 0 || result.Height <= 0 || result.Width > 16384 || result.Height > 16384 || result.DurationMs <= 0 || result.FPS <= 0 || result.FPS > 1000 {
		return remakeProbe{}, fmt.Errorf("参考文件缺少有效的视频尺寸、帧率或时长")
	}
	return result, nil
}

func remakeDuration(value string) int64 {
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds > 24*60*60 {
		return 0
	}
	return int64(math.Round(seconds * 1000))
}

func remakeFraction(value string) float64 {
	parts := strings.Split(value, "/")
	numerator, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || math.IsNaN(numerator) || math.IsInf(numerator, 0) || numerator <= 0 {
		return 0
	}
	if len(parts) == 1 {
		return numerator
	}
	if len(parts) != 2 {
		return 0
	}
	denominator, err := strconv.ParseFloat(parts[1], 64)
	if err != nil || denominator <= 0 || math.IsNaN(denominator) || math.IsInf(denominator, 0) {
		return 0
	}
	return numerator / denominator
}

var remakeSceneTime = regexp.MustCompile(`\bpts_time:([0-9]+(?:\.[0-9]+)?)`)

func remakeSceneShots(output string, startMs, endMs int64) ([]remake.SourceShot, error) {
	if startMs < 0 || endMs <= startMs || endMs-startMs > remake.MaxSourceDurationMs {
		return nil, fmt.Errorf("复刻区间应位于原视频内且不超过 60 秒")
	}
	boundaries := []int64{startMs}
	for _, match := range remakeSceneTime.FindAllStringSubmatch(output, -1) {
		value, err := strconv.ParseFloat(match[1], 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("切镜检测返回了无效时间")
		}
		timestamp := startMs + int64(math.Round(value*1000))
		if timestamp > startMs && timestamp < endMs {
			boundaries = append(boundaries, timestamp)
		}
	}
	boundaries = append(boundaries, endMs)
	sort.Slice(boundaries, func(i, j int) bool { return boundaries[i] < boundaries[j] })
	unique := boundaries[:0]
	for _, boundary := range boundaries {
		if len(unique) == 0 || unique[len(unique)-1] != boundary {
			unique = append(unique, boundary)
		}
	}
	if len(unique)-1 > remake.MaxSourceShots {
		return nil, fmt.Errorf("检测到 %d 个镜头，超过首版 %d 个镜头上限，请缩小复刻区间", len(unique)-1, remake.MaxSourceShots)
	}
	shots := make([]remake.SourceShot, 0, len(unique)-1)
	for i := 0; i+1 < len(unique); i++ {
		shots = append(shots, remake.SourceShot{
			ID: fmt.Sprintf("shot-%02d", i+1), SourceInMs: unique[i], SourceOutMs: unique[i+1],
			KeyframeMs: unique[i] + (unique[i+1]-unique[i])/2,
		})
	}
	return shots, nil
}

func remakeSeconds(ms int64) string { return strconv.FormatFloat(float64(ms)/1000, 'f', 3, 64) }

type remakeOutputBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *remakeOutputBuffer) Write(p []byte) (int, error) {
	remaining := max(0, b.limit-b.Len())
	if len(p) > remaining {
		b.overflow = true
	}
	_, _ = b.Buffer.Write(p[:min(len(p), remaining)])
	return len(p), nil
}

func runRemakeCommand(ctx context.Context, binary string, args []string, includeStderr bool, outputLimit int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	output := &remakeOutputBuffer{limit: outputLimit}
	command := exec.CommandContext(ctx, binary, args...)
	command.Stdout = output
	if includeStderr {
		command.Stderr = output
	}
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("媒体处理超时或已取消: %w", ctx.Err())
		}
		return nil, fmt.Errorf("媒体工具执行失败，请检查文件编码和服务端媒体依赖")
	}
	if output.overflow {
		return nil, fmt.Errorf("媒体工具输出超出限制")
	}
	return output.Bytes(), nil
}
