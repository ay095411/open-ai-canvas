package protocol

import (
	"context"
	"strings"
	"testing"
)

// Grsai 的图片与视频共用 /v1/api/generate，靠 replyType 决定返回形态；三个视频模型的
// 参数值域和数量上限互不相同。这些断言锁住最容易回归的四件事：replyType 必须是 async、
// 首尾帧与参考图互斥、协议不能跨模型误用、上游 running/violation 必须落到宿主状态词上。
func TestOfficialGrsaiVideoCreateIsAsyncAndKeepsDuration(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "深夜雨街，蓝色传送门开启",
		AspectRatio: "portrait",
		Resolution:  "768p",
		Duration:    10,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/v1/api/generate" {
		t.Fatalf("create = %s %s", spec.Method, spec.Path)
	}
	body := manifestTestBody(t, spec)
	if body["replyType"] != "async" {
		t.Fatalf("replyType = %v, want async", body["replyType"])
	}
	if body["model"] != "minimax-h3" || body["aspectRatio"] != "portrait" || body["resolution"] != "768p" {
		t.Fatalf("body = %#v", body)
	}
	if duration, _ := body["duration"].(float64); duration != 10 {
		t.Fatalf("duration = %v, want 10", body["duration"])
	}
	if body["promptSkill"] != true {
		t.Fatalf("promptSkill = %v, want default true", body["promptSkill"])
	}
	if _, exists := body["images"]; exists {
		t.Fatalf("reference images must be omitted when none supplied: %#v", body)
	}
	if _, exists := body["audios"]; exists {
		t.Fatalf("reference audios must be omitted when none supplied: %#v", body)
	}
}

// 画布提交的是 16:9 这类比例，H3 只认 portrait / landscape，必须由协议换算；
// 直接透传会让上游拒绝每一次请求。
func TestOfficialGrsaiH3ConvertsCanvasRatioToOrientation(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	cases := []struct{ ratio, want string }{
		{"16:9", "landscape"},
		{"4:3", "landscape"},
		{"21:9", "landscape"},
		{"9:16", "portrait"},
		{"3:4", "portrait"},
		{"portrait", "portrait"},
		{"landscape", "landscape"},
	}
	for _, tt := range cases {
		t.Run(tt.ratio, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model:       "minimax-h3",
				Prompt:      "x",
				AspectRatio: tt.ratio,
				Resolution:  "480p",
				Duration:    5,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["aspectRatio"] != tt.want {
				t.Fatalf("%s -> %v, want %s", tt.ratio, body["aspectRatio"], tt.want)
			}
		})
	}
}

func TestOfficialGrsaiVideoFirstLastFrameExcludesReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "keyframe transition",
		AspectRatio: "landscape",
		Resolution:  "480p",
		Duration:    5,
		Images: []MediaReference{
			{URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2},
			{URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1},
		},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["firstFrame"] != "https://cdn.example/first.png" || body["lastFrame"] != "https://cdn.example/last.png" {
		t.Fatalf("keyframes = %#v / %#v", body["firstFrame"], body["lastFrame"])
	}
	if _, exists := body["images"]; exists {
		t.Fatalf("keyframe mode must not send reference images: %#v", body)
	}
	if _, exists := body["audios"]; exists {
		t.Fatalf("keyframe mode must not send reference audios: %#v", body)
	}
}

func TestOfficialGrsaiVideoReferenceImagesStayOrdered(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "two references",
		AspectRatio: "portrait",
		Resolution:  "480p",
		Duration:    5,
		Images: []MediaReference{
			{URL: "https://cdn.example/second.png", Order: 2},
			{URL: "https://cdn.example/first.png", Order: 1},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	images, ok := body["images"].([]any)
	if !ok || len(images) != 2 {
		t.Fatalf("images = %#v", body["images"])
	}
	if images[0] != "https://cdn.example/first.png" || images[1] != "https://cdn.example/second.png" {
		t.Fatalf("images keep order = %#v", images)
	}
	if _, exists := body["firstFrame"]; exists {
		t.Fatalf("reference mode must not send firstFrame: %#v", body)
	}
}

func TestOfficialGrsaiVideoRejectsUnpairedKeyframeAndLong1080p(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	base := GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "x",
		AspectRatio: "portrait",
		Resolution:  "480p",
		Duration:    5,
	}
	cases := []struct {
		name   string
		mutate func(*GenerationRequest)
	}{
		{name: "unpaired first frame", mutate: func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/first.png", Role: "first_frame"}}
		}},
		{name: "1080p over ten seconds", mutate: func(r *GenerationRequest) {
			r.Resolution = "1080p"
			r.Duration = 15
		}},
		{name: "reference video", mutate: func(r *GenerationRequest) {
			r.Videos = []MediaReference{{URL: "https://cdn.example/ref.mp4"}}
		}},
		{name: "too many reference images", mutate: func(r *GenerationRequest) {
			r.Images = grsaiReferenceImages(10)
		}},
		{name: "missing duration", mutate: func(r *GenerationRequest) {
			r.Duration = 0
		}},
		{name: "foreign model", mutate: func(r *GenerationRequest) {
			r.Model = "wan-3.0"
		}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			request := base
			tt.mutate(&request)
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

// Wan 3.0 的取值域与 H3 完全不同：六种比例、720p 档位、2~30 秒、10 张参考图，
// 并且没有 promptSkill。这条测试同时守住「不把 H3 的参数发给 Wan」。
func TestOfficialGrsaiWanVideoProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-wan-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "wan-3.0",
		Prompt:      "9:16 竖屏短剧镜头",
		AspectRatio: "9:16",
		Resolution:  "720p",
		Duration:    30,
		Images:      grsaiReferenceImages(10),
		Audios: []MediaReference{
			{URL: "https://cdn.example/a1.mp3"},
			{URL: "https://cdn.example/a2.mp3"},
			{URL: "https://cdn.example/a3.mp3"},
			{URL: "https://cdn.example/a4.mp3"},
			{URL: "https://cdn.example/a5.mp3"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["model"] != "wan-3.0" || body["aspectRatio"] != "9:16" || body["resolution"] != "720p" {
		t.Fatalf("body = %#v", body)
	}
	if duration, _ := body["duration"].(float64); duration != 30 {
		t.Fatalf("duration = %v, want 30", body["duration"])
	}
	if _, exists := body["promptSkill"]; exists {
		t.Fatalf("wan-3.0 has no promptSkill field: %#v", body)
	}
	if images, _ := body["images"].([]any); len(images) != 10 {
		t.Fatalf("wan-3.0 accepts 10 reference images, got %d", len(images))
	}
	if audios, _ := body["audios"].([]any); len(audios) != 5 {
		t.Fatalf("wan-3.0 accepts 5 reference audios, got %d", len(audios))
	}
}

func TestOfficialGrsaiWanVideoRejectsOutOfRangeAndForeignModel(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-wan-video")
	base := GenerationRequest{
		Model:       "wan-3.0",
		Prompt:      "x",
		AspectRatio: "16:9",
		Resolution:  "1080p",
		Duration:    10,
	}
	cases := []struct {
		name   string
		mutate func(*GenerationRequest)
	}{
		{name: "eleven reference images", mutate: func(r *GenerationRequest) { r.Images = grsaiReferenceImages(11) }},
		{name: "six reference audios", mutate: func(r *GenerationRequest) {
			r.Audios = make([]MediaReference, 0, 6)
			for index := 0; index < 6; index++ {
				r.Audios = append(r.Audios, MediaReference{URL: "https://cdn.example/a.mp3"})
			}
		}},
		{name: "one second is below wan minimum", mutate: func(r *GenerationRequest) { r.Duration = 1 }},
		{name: "thirty one seconds exceeds wan maximum", mutate: func(r *GenerationRequest) { r.Duration = 31 }},
		{name: "h3 model on wan protocol", mutate: func(r *GenerationRequest) { r.Model = "minimax-h3" }},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			request := base
			tt.mutate(&request)
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

// Agnes 2.5 的分辨率用 2k 档，时长窗口 4~12 秒，参考图只有 5 张。
func TestOfficialGrsaiAgnesVideoProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-agnes-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "agnes-video-2.5",
		Prompt:      "x",
		AspectRatio: "4:3",
		Resolution:  "2k",
		Duration:    12,
		Images:      grsaiReferenceImages(5),
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["resolution"] != "2k" || body["aspectRatio"] != "4:3" {
		t.Fatalf("body = %#v", body)
	}
	if _, exists := body["promptSkill"]; exists {
		t.Fatalf("agnes-video has no promptSkill field: %#v", body)
	}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "agnes-video-2.5",
		Prompt:      "x",
		AspectRatio: "4:3",
		Resolution:  "2k",
		Duration:    13,
	}}); err == nil {
		t.Fatal("agnes-video must reject durations above 12 seconds")
	}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "agnes-video-2.5",
		Prompt:      "x",
		AspectRatio: "4:3",
		Resolution:  "2k",
		Duration:    8,
		Images:      grsaiReferenceImages(6),
	}}); err == nil {
		t.Fatal("agnes-video must reject more than 5 reference images")
	}
}

func TestOfficialGrsaiPollNormalizesStatusAndMarksEphemeral(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-video")
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "14-abc", Request: GenerationRequest{Model: "minimax-h3"}})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/v1/api/result" || len(poll.Query["id"]) != 1 || poll.Query["id"][0] != "14-abc" {
		t.Fatalf("poll = %s %s %#v", poll.Method, poll.Path, poll.Query)
	}

	cases := []struct {
		body string
		want Status
	}{
		{`{"id":"14-abc","status":"running","progress":42}`, StatusProcessing},
		{`{"id":"14-abc","status":"violation","error":"blocked"}`, StatusFailed},
		{`{"id":"14-abc","status":"failed","error":"generate failed"}`, StatusFailed},
	}
	for _, tt := range cases {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "14-abc"}, []byte(tt.body))
		if err != nil {
			t.Fatalf("%s: %v", tt.body, err)
		}
		if state.Status != tt.want {
			t.Fatalf("%s: status = %q, want %q", tt.body, state.Status, tt.want)
		}
	}

	done, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "14-abc"}, []byte(`{"id":"14-abc","status":"succeeded","results":[{"url":"https://file.example/clip.mp4"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != StatusSucceeded || done.Result == nil || len(done.Result.Videos) != 1 {
		t.Fatalf("succeeded poll = %#v", done)
	}
	if done.Result.Videos[0].URL != "https://file.example/clip.mp4" || !done.Result.Videos[0].Ephemeral {
		t.Fatalf("video = %#v", done.Result.Videos[0])
	}
}

func TestOfficialGrsaiImageCreateMapsSizeAndQuality(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai.yingce-plugin", "grsai-image")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "nano-banana-2",
		Prompt:      "边牧与古牧直播带货截图",
		AspectRatio: "1:1",
		ProviderOptions: map[string]map[string]any{
			"grsai-image": {"imageSize": "2K"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["replyType"] != "async" || body["aspectRatio"] != "1:1" || body["imageSize"] != "2K" {
		t.Fatalf("body = %#v", body)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"6-xyz","status":"succeeded","results":[{"url":"https://file.example/out.png"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 {
		t.Fatalf("create = %#v", result)
	}
	if !result.Result.Images[0].Ephemeral {
		t.Fatalf("image result must be ephemeral: %#v", result.Result.Images[0])
	}
	if result.TaskID != "6-xyz" {
		t.Fatalf("task id = %q", result.TaskID)
	}
}

func TestOfficialGrsaiModelsAreDeclaredWithDistinctProtocols(t *testing.T) {
	ids := []string{"grsai-video", "grsai-wan-video", "grsai-agnes-video", "grsai-image"}
	for _, id := range ids {
		adapter := officialPackageAdapter(t, "grsai.yingce-plugin", id)
		metadata := adapter.Metadata()
		if !metadata.Enabled {
			t.Fatalf("%s is disabled", id)
		}
		if metadata.Poll == "" || !strings.HasPrefix(metadata.Poll, "GET /v1/api/result") {
			t.Fatalf("%s poll = %q", id, metadata.Poll)
		}
	}
}

func grsaiReferenceImages(count int) []MediaReference {
	images := make([]MediaReference, 0, count)
	for index := 0; index < count; index++ {
		images = append(images, MediaReference{
			URL:   "https://cdn.example/ref.png",
			Order: index + 1,
		})
	}
	return images
}
