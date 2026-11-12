package protocol

import (
	"context"
	"strings"
	"testing"
)

// 算力AI 把站内 300 多个视频模型收在同一个 /v1/videos 异步任务接口后面，
// 所以协议必须是「一个 provider 全量覆盖」。这些断言锁住四件最容易回归的事：
// 创建走 JSON、字段名是上游的 seconds/aspect_ratio、空素材不许下发空数组、
// 轮询的 queued/in_progress/completed 必须落到宿主状态词上。
func TestOfficialSuanliaiVideoCreateUsesVideosContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "稳定高速sd2.5(30参任选/4-30秒/720P)",
		Prompt:      "镜头缓缓推近，人物微笑转头",
		AspectRatio: "16:9",
		Resolution:  "720P",
		Duration:    10,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/v1/videos" {
		t.Fatalf("create = %s %s", spec.Method, spec.Path)
	}
	// 文档让用户把 Base URL 填成 https://suanliai.top/v1，路径必须按根路径解析，
	// 否则会拼成 /v1/v1/videos。
	if !spec.OriginPath {
		t.Fatal("create must resolve against the origin path so a /v1 base URL keeps working")
	}
	if spec.ContentType != "application/json" {
		t.Fatalf("contentType = %q, want application/json", spec.ContentType)
	}
	body := manifestTestBody(t, spec)
	if body["model"] != "稳定高速sd2.5(30参任选/4-30秒/720P)" {
		t.Fatalf("model = %v", body["model"])
	}
	if body["prompt"] != "镜头缓缓推近，人物微笑转头" {
		t.Fatalf("prompt = %v", body["prompt"])
	}
	if seconds, _ := body["seconds"].(float64); seconds != 10 {
		t.Fatalf("seconds = %v, want 10", body["seconds"])
	}
	if body["aspect_ratio"] != "16:9" || body["resolution"] != "720P" {
		t.Fatalf("aspect_ratio/resolution = %v / %v", body["aspect_ratio"], body["resolution"])
	}
	// 高质量特惠 sd2.5 这类模型只要看到 videos 字段就直接 400，空数组也不行；
	// generate_audio / watermark 在缺省时必须整键省略，不能发 false。
	for _, key := range []string{"images", "videos", "audios", "generate_audio", "watermark", "seed"} {
		if _, exists := body[key]; exists {
			t.Fatalf("%s must be omitted when not requested: %#v", key, body)
		}
	}
}

func TestOfficialSuanliaiVideoKeepsReferenceOrderAndDropsMask(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:    "高质量特惠sd2.5(满血原生过真人30-10-10/720P)",
		Prompt:   "把 @图片1 的人物放进 @图片2 的场景",
		Duration: 5,
		Images: []MediaReference{
			{URL: "https://cdn.example/scene.png", Order: 2},
			{URL: "https://cdn.example/mask.png", Role: "mask"},
			{URL: "https://cdn.example/hero.png", Order: 1},
		},
		Videos: []MediaReference{{URL: "https://cdn.example/ref.mp4"}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	images, ok := body["images"].([]any)
	if !ok || len(images) != 2 {
		t.Fatalf("images = %#v", body["images"])
	}
	// @图片N 的下标必须和实际传图顺序一致，顺序错了会锁错角色。
	if images[0] != "https://cdn.example/hero.png" || images[1] != "https://cdn.example/scene.png" {
		t.Fatalf("images must keep canvas order and drop mask: %#v", images)
	}
	videos, _ := body["videos"].([]any)
	if len(videos) != 1 || videos[0] != "https://cdn.example/ref.mp4" {
		t.Fatalf("videos = %#v", body["videos"])
	}
	audios, _ := body["audios"].([]any)
	if len(audios) != 1 || audios[0] != "https://cdn.example/voice.mp3" {
		t.Fatalf("audios = %#v", body["audios"])
	}
}

func TestOfficialSuanliaiVideoFlagsAndSeed(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:         "官方直连1区-MiniMax H3-768P-满血稳定高速",
		Prompt:        "海面日出",
		Duration:      10,
		GenerateAudio: true,
		Watermark:     true,
		ProviderOptions: map[string]map[string]any{
			"suanliai-video": {"seed": 20261112},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["generate_audio"] != true || body["watermark"] != true {
		t.Fatalf("flags = %#v", body)
	}
	if seed, _ := body["seed"].(float64); seed != 20261112 {
		t.Fatalf("seed = %v", body["seed"])
	}
}

// 只带参考音频、不带图/视频的请求上游会直接 400，本地先拦住可以减少一次空跑；
// 素材上限取全站最宽档（30 图 / 10 视频 / 10 音频），更窄的模型限制交给网关提示。
func TestOfficialSuanliaiVideoValidations(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	base := GenerationRequest{Model: "稳定高速sd2.5(30参任选/4-30秒/720P)", Prompt: "x", Duration: 5}
	cases := []struct {
		name   string
		mutate func(*GenerationRequest)
	}{
		{name: "audio only", mutate: func(r *GenerationRequest) {
			r.Audios = []MediaReference{{URL: "https://cdn.example/voice.mp3"}}
		}},
		{name: "too many images", mutate: func(r *GenerationRequest) {
			r.Images = suanliaiImages(31)
		}},
		{name: "too many videos", mutate: func(r *GenerationRequest) {
			r.Videos = suanliaiVideos(11)
		}},
		{name: "too many audios", mutate: func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png"}}
			r.Audios = suanliaiAudios(11)
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

	// 上游允许的边界值不能被误伤：30 张图 + 1 段音频必须放行。
	allowed := base
	allowed.Images = suanliaiImages(30)
	allowed.Audios = suanliaiAudios(1)
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: allowed}); err != nil {
		t.Fatalf("30 images with audio must pass: %v", err)
	}
}

func TestOfficialSuanliaiVideoPollContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task_abc", Request: GenerationRequest{Model: "x"}})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/v1/videos/task_abc" {
		t.Fatalf("poll = %s %s", poll.Method, poll.Path)
	}
	if !poll.OriginPath {
		t.Fatal("poll must resolve against the origin path")
	}

	cases := []struct {
		body string
		want Status
	}{
		{`{"id":"task_abc","task_id":"task_abc","status":"queued","progress":0}`, StatusPending},
		{`{"id":"task_abc","status":"in_progress","progress":30}`, StatusProcessing},
		{`{"id":"task_abc","status":"failed","message":"内容被拒"}`, StatusFailed},
		{`{"id":"task_abc","status":"cancelled"}`, StatusCancelled},
	}
	for _, tt := range cases {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_abc"}, []byte(tt.body))
		if err != nil {
			t.Fatalf("%s: %v", tt.body, err)
		}
		if state.Status != tt.want {
			t.Fatalf("%s: status = %q, want %q", tt.body, state.Status, tt.want)
		}
	}
}

// 成片地址同时出现在 url / video_url / result_url / download_url / metadata.url 五处，
// 而且都是带 expires 签名的临时直链：必须能取到任一处，并且标记为 ephemeral 让宿主立即落盘。
func TestOfficialSuanliaiVideoCompletedMedia(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	signed := "https://suanliai.top/v1/videos/task_abc/content?expires=1794578854&owner=2459&video_signature=deadbeef"
	bodies := []string{
		`{"id":"task_abc","status":"completed","progress":100,"video_url":"` + signed + `","url":"` + signed + `"}`,
		`{"id":"task_abc","status":"completed","progress":100,"download_url":"` + signed + `"}`,
		`{"task_id":"task_abc","status":"completed","progress":100,"metadata":{"url":"` + signed + `"}}`,
	}
	for _, body := range bodies {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_abc"}, []byte(body))
		if err != nil {
			t.Fatal(err)
		}
		if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 {
			t.Fatalf("%s: poll = %#v", body, state)
		}
		video := state.Result.Videos[0]
		if video.URL != signed {
			t.Fatalf("%s: url = %q", body, video.URL)
		}
		if !video.Ephemeral {
			t.Fatalf("%s: signed URL must be ephemeral so the host downloads it", body)
		}
	}

	// 归档阶段 progress 已经到 99 但还没出片，不能提前判成功。
	archiving, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_abc"}, []byte(`{"id":"task_abc","status":"in_progress","progress":99,"delivery_status":"archiving"}`))
	if err != nil {
		t.Fatal(err)
	}
	if archiving.Status != StatusProcessing {
		t.Fatalf("archiving status = %q", archiving.Status)
	}
	if archiving.Stage != "archiving" {
		t.Fatalf("stage = %q, want archiving", archiving.Stage)
	}
}

// 网关的错误体是 {"code":"fail_to_fetch_task","message":"..."}（实测 HTTP 503），
// 也会出现只有 error / fail_reason 的形态；消息必须透出中文原因，不能被吞成空。
func TestOfficialSuanliaiVideoErrorMessages(t *testing.T) {
	adapter := officialPackageAdapter(t, "suanliai.yingce-plugin", "suanliai-video")
	cases := []struct{ body, want string }{
		{`{"error":{"message":"该模型不支持参考视频"}}`, "该模型不支持参考视频"},
		{`{"fail_reason":"参考图必须是 1–9 张"}`, "参考图必须是 1–9 张"},
		{`{"message":"提示词里引用了 @图片3，但本次只传了 2 张参考图"}`, "提示词里引用了 @图片3，但本次只传了 2 张参考图"},
	}
	for _, tt := range cases {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task_abc"}, []byte(tt.body))
		if err != nil {
			t.Fatalf("%s: %v", tt.body, err)
		}
		if !strings.Contains(state.Message, tt.want) {
			t.Fatalf("%s: message = %q, want contains %q", tt.body, state.Message, tt.want)
		}
	}
}

func suanliaiImages(count int) []MediaReference {
	result := make([]MediaReference, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, MediaReference{URL: "https://cdn.example/img.png", Order: index + 1})
	}
	return result
}

func suanliaiVideos(count int) []MediaReference {
	result := make([]MediaReference, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, MediaReference{URL: "https://cdn.example/ref.mp4", Order: index + 1})
	}
	return result
}

func suanliaiAudios(count int) []MediaReference {
	result := make([]MediaReference, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, MediaReference{URL: "https://cdn.example/voice.mp3", Order: index + 1})
	}
	return result
}
