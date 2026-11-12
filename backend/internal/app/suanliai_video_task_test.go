package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// 算力AI 是 JSON + 轮询协议。这条测试把「渠道 → 协议 → 上游 → 成片落盘」整条链路走一遍，
// 锁住三件最容易回归的事：Base URL 写成 https://host/v1 时路径不能翻倍、空素材不能下发空数组、
// 带签名的成片地址必须由宿主下载成 data URL 交给画布。
func TestRunVideoTaskUsesDeclarativeSuanliaiJSONProtocol(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatalf("newPluginRuntime() error = %v", err)
	}
	adapter, ok := center.registrySnapshot().Resolve("suanliai-video")
	if !ok {
		t.Fatal("declarative 算力AI adapter is missing")
	}
	metadata := adapter.Metadata()
	if metadata.Execution != "declarative" || !metadata.RequiresPublicMediaURLs {
		t.Fatalf("runtime metadata = %#v", metadata)
	}

	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", contentType)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode create body: %v", err)
			}
			want := map[string]any{
				"model":        "官方直连1区-SD2.5-满血稳定高速",
				"prompt":       "镜头缓缓推近",
				"seconds":      float64(10),
				"aspect_ratio": "16:9",
				"resolution":   "720p",
				"images":       []any{server.URL + "/reference.png"},
			}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("create body = %#v, want %#v", body, want)
			}
			// 高质量特惠 sd2.5 这类模型只要看到 videos 字段就 400，空数组也不行。
			for _, unexpected := range []string{"videos", "audios", "generate_audio", "watermark", "seed"} {
				if _, exists := body[unexpected]; exists {
					t.Errorf("create body contains %q: %#v", unexpected, body)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_1","task_id":"task_1","status":"queued","progress":0}`))
		case "GET /v1/videos/task_1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_1","task_id":"task_1","status":"completed","progress":100,"delivery_status":"local_ready","video_url":"` + server.URL + `/out.mp4"}`))
		case "GET /out.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	result, err := runVideoTaskForTest(ctx, canvasGenerationInput{
		Mode:   "video",
		Prompt: "镜头缓缓推近",
		// Base URL 故意带 /v1：文档让用户填 https://suanliai.top/v1，协议必须按根路径解析。
		Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", InterfaceType: "suanliai-video", Model: "官方直连1区-SD2.5-满血稳定高速", VideoSeconds: "10", Size: "16:9", VQuality: "720p"},
		ReferenceImages: []providerMedia{{URL: server.URL + "/reference.png"}},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	wantPaths := "POST /v1/videos,GET /v1/videos/task_1,GET /out.mp4"
	if got := strings.Join(paths, ","); got != wantPaths {
		t.Fatalf("paths = %q, want %q", got, wantPaths)
	}
}

// 同一个协议要能接住全站模型：换一个纯文生模型（不带参考图）时，images 必须整键省略，
// 而不是发一个空数组让上游把「参考图必须是 1–9 张」的错误甩回来。
func TestRunVideoTaskSuanliaiOmitsEmptyMedia(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode create body: %v", err)
			}
			want := map[string]any{"model": "经典系列/MiniMax-H3-GO", "prompt": "海面日出", "seconds": float64(10)}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("create body = %#v, want %#v", body, want)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_2","status":"queued"}`))
		case "GET /v1/videos/task_2":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_2","status":"completed","url":"` + server.URL + `/out.mp4"}`))
		case "GET /out.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	if _, err := runVideoTaskForTest(ctx, canvasGenerationInput{
		Mode:   "video",
		Prompt: "海面日出",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", InterfaceType: "suanliai-video", Model: "经典系列/MiniMax-H3-GO", VideoSeconds: "10"},
	}); err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
}
