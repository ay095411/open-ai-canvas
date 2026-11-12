package app

import "testing"

// Grsai 三个视频协议的值域与数量上限互不相同，默认能力必须跟着协议走，
// 否则新增模型时会落回「音频 0 段、时长 1~15 秒」的通用默认值，把上游能力挡在本地校验里。
func TestGrsaiVideoCapabilityDefaults(t *testing.T) {
	cases := []struct {
		protocol     string
		label        string
		maxImages    int
		maxAudios    int
		maxVideos    int
		audioSeconds int
		durationMin  int
		durationMax  int
		resolutions  []string
	}{
		{protocol: "grsai-video", label: "MiniMax H3", maxImages: 9, maxAudios: 3, maxVideos: 0, audioSeconds: 15, durationMin: 1, durationMax: 15, resolutions: []string{"480p", "768p", "1080p"}},
		{protocol: "grsai-wan-video", label: "Wan 3.0", maxImages: 10, maxAudios: 5, maxVideos: 0, audioSeconds: 15, durationMin: 2, durationMax: 30, resolutions: []string{"480p", "720p", "1080p"}},
		{protocol: "grsai-agnes-video", label: "Agnes 2.5", maxImages: 5, maxAudios: 3, maxVideos: 0, audioSeconds: 15, durationMin: 4, durationMax: 12, resolutions: []string{"720p", "1080p", "2k"}},
	}
	for _, tt := range cases {
		t.Run(tt.label, func(t *testing.T) {
			video := DefaultModelCapabilityConfigForModel(tt.protocol, "model").Video
			if video == nil {
				t.Fatal("video capability is missing")
			}
			if video.References.MaxImages != tt.maxImages {
				t.Fatalf("maxImages = %d, want %d", video.References.MaxImages, tt.maxImages)
			}
			if video.References.MaxAudios != tt.maxAudios {
				t.Fatalf("maxAudios = %d, want %d", video.References.MaxAudios, tt.maxAudios)
			}
			if video.References.MaxVideos != tt.maxVideos {
				t.Fatalf("maxVideos = %d, want %d (grsai has no reference video)", video.References.MaxVideos, tt.maxVideos)
			}
			if video.References.MaxAudioDuration != tt.audioSeconds {
				t.Fatalf("maxAudioDuration = %d, want %d", video.References.MaxAudioDuration, tt.audioSeconds)
			}
			if video.Duration.Min != tt.durationMin || video.Duration.Max != tt.durationMax {
				t.Fatalf("duration = %d~%d, want %d~%d", video.Duration.Min, video.Duration.Max, tt.durationMin, tt.durationMax)
			}
			if len(video.Resolutions) != len(tt.resolutions) {
				t.Fatalf("resolutions = %v, want %v", video.Resolutions, tt.resolutions)
			}
			for index, want := range tt.resolutions {
				if video.Resolutions[index] != want {
					t.Fatalf("resolutions = %v, want %v", video.Resolutions, tt.resolutions)
				}
			}
			// 参考图超过两张时创作端会判定为全模态参考，纯音频输入判定为音频生视频；
			// 两个模式缺失会让合法请求在本地被拒。
			for _, operation := range []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"} {
				if !containsCapabilityString(video.Operations, operation) {
					t.Fatalf("operations = %v, missing %s", video.Operations, operation)
				}
			}
			if !containsCapabilityString(video.Operations, video.DefaultOperation) {
				t.Fatalf("default operation %q is not in %v", video.DefaultOperation, video.Operations)
			}
			// Grsai 文档没有 generateAudio 参数，开关必须是关闭态，否则创作端会出现无效选项。
			if video.GenerateAudio.Supported {
				t.Fatal("grsai video must not expose generateAudio")
			}
			if len(video.Ratios) == 0 || !containsCapabilityString(video.Ratios, video.DefaultRatio) {
				t.Fatalf("default ratio %q is not in %v", video.DefaultRatio, video.Ratios)
			}
		})
	}
}
