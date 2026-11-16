package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func setupGalleryRateLimit(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previous := runtimeService
	runtimeService = service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { runtimeService = previous })
}

type fakeInspirationGallery struct {
	calls  []string
	query  url.Values
	slug   string
	err    error
	onRead func(context.Context)
}

func (f *fakeInspirationGallery) read(ctx context.Context, operation string) {
	f.calls = append(f.calls, operation)
	if f.onRead != nil {
		f.onRead(ctx)
	}
}

func (f *fakeInspirationGallery) InspirationGalleryPrompts(ctx context.Context, query url.Values) (*service.InspirationGalleryPage, error) {
	f.read(ctx, "list")
	f.query = query
	return &service.InspirationGalleryPage{Items: []service.InspirationGalleryEntry{{ID: "zzai-gallery:example", Slug: "example", SourceID: "zzai-gallery", Title: "Online example", GalleryURL: "https://api.seedance.nz/prompt-gallery/example", SourceURL: "https://creator.example/work", Credit: "Original Creator"}}, Total: 24, NextCursor: "next="}, f.err
}

func (f *fakeInspirationGallery) InspirationGalleryPrompt(ctx context.Context, slug string) (*service.InspirationGalleryDetail, error) {
	f.read(ctx, "detail")
	f.slug = slug
	return &service.InspirationGalleryDetail{GalleryEntry: service.InspirationGalleryEntry{ID: "zzai-gallery:" + slug, Slug: slug, SourceID: "zzai-gallery"}, Prompt: "Original prompt", PromptZH: "中文提示词"}, f.err
}

func (f *fakeInspirationGallery) InspirationGalleryFacets(ctx context.Context, query url.Values) (*service.InspirationGalleryFacets, error) {
	f.read(ctx, "facets")
	f.query = query
	return &service.InspirationGalleryFacets{Categories: []string{"story"}, Models: []string{"Example Model"}, Tags: []string{"cinematic"}, Total: 24}, f.err
}

func inspirationGalleryTestRouter(t *testing.T) (*gin.Engine, *fakeInspirationGallery) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	setupGalleryRateLimit(t)
	router := gin.New()
	fake := &fakeInspirationGallery{}
	registerInspirationGalleryRoutes(router.Group("/api"), fake)
	return router, fake
}

func TestInspirationGalleryRoutesPreserveOnlineContract(t *testing.T) {
	router, fake := inspirationGalleryTestRouter(t)
	query := url.Values{"media_type": {"video"}, "category": {"story"}, "model": {"Example Model"}, "search": {"镜头"}, "sort": {"popular"}, "cursor": {"first="}, "limit": {"21"}}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/prompts?"+query.Encode(), nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !reflect.DeepEqual(fake.query, query) {
		t.Fatalf("list contract: status=%d query=%v body=%s", response.Code, fake.query, response.Body.String())
	}
	var page struct {
		Code int                            `json:"code"`
		Data service.InspirationGalleryPage `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Code != 0 || page.Data.Total != 24 || page.Data.NextCursor != "next=" || len(page.Data.Items) != 1 || page.Data.Items[0].SourceID != "zzai-gallery" || page.Data.Items[0].Credit != "Original Creator" {
		t.Fatalf("online metadata lost: %+v", page)
	}
	if strings.Contains(response.Body.String(), "licensed-v1") || strings.Contains(response.Body.String(), "authorization") || strings.Contains(response.Body.String(), `"prompt"`) {
		t.Fatalf("summary falsely claims authorization or contains full prompt: %s", response.Body.String())
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/prompts/example", nil))
	if response.Code != http.StatusOK || fake.slug != "example" || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), `"prompt":"Original prompt"`) {
		t.Fatalf("detail contract: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/facets?media_type=video", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || fake.query.Get("media_type") != "video" || !strings.Contains(response.Body.String(), `"models":["Example Model"]`) {
		t.Fatalf("facets contract: %d %s", response.Code, response.Body.String())
	}
	if !reflect.DeepEqual(fake.calls, []string{"list", "detail", "facets"}) {
		t.Fatalf("unexpected domain calls: %v", fake.calls)
	}
}

func TestInspirationGalleryMalformedRequestsNeverReachDomain(t *testing.T) {
	router, fake := inspirationGalleryTestRouter(t)
	for _, path := range []string{
		"/api/public/inspirations/zzai-gallery/prompts?search=%ZZ",
		"/api/public/inspirations/zzai-gallery/prompts?limit=21;limit=22",
		"/api/public/inspirations/zzai-gallery/facets?media_type=%ZZ",
		"/api/public/inspirations/zzai-gallery/prompts/example?url=https://other.example",
		"/api/public/inspirations/zzai-gallery/prompts/example?x=1&x=2",
		"/api/public/inspirations/zzai-gallery/prompts/example?search=%ZZ",
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusBadRequest || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), `"reason":"invalid_argument"`) {
			t.Fatalf("invalid path %s returned %d %s", path, response.Code, response.Body.String())
		}
	}
	if len(fake.calls) != 0 {
		t.Fatalf("malformed request reached domain: %v", fake.calls)
	}
}

func TestInspirationGalleryDomainRejectsInvalidFiltersBeforeUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupGalleryRateLimit(t)
	router := gin.New()
	RegisterInspirationGalleryRoutes(router.Group("/api"), runtimeService)
	for _, path := range []string{
		"/api/public/inspirations/zzai-gallery/prompts?url=https://127.0.0.1",
		"/api/public/inspirations/zzai-gallery/prompts?limit=1&limit=2",
		"/api/public/inspirations/zzai-gallery/prompts?limit=51",
		"/api/public/inspirations/zzai-gallery/prompts?media_type=audio",
		"/api/public/inspirations/zzai-gallery/prompts?cursor=invalid%3F",
		"/api/public/inspirations/zzai-gallery/facets?model=unexpected",
		"/api/public/inspirations/zzai-gallery/prompts/..",
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"reason":"invalid_argument"`) {
			t.Fatalf("invalid domain input %s returned %d %s", path, response.Code, response.Body.String())
		}
	}
}

func TestInspirationGalleryFailuresRemainFailures(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		status int
	}{
		{"missing", service.NotFound("在线条目不存在"), http.StatusNotFound},
		{"upstream", service.NewAppError(http.StatusBadGateway, "外部画廊暂不可用"), http.StatusBadGateway},
		{"timeout", service.NewAppError(http.StatusGatewayTimeout, "外部画廊响应超时"), http.StatusGatewayTimeout},
		{"unknown", errors.New("do-not-expose-upstream-secret"), http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			router, fake := inspirationGalleryTestRouter(t)
			fake.err = test.err
			for _, suffix := range []string{"prompts", "prompts/example", "facets"} {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/"+suffix, nil))
				if response.Code != test.status || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), `"data":null`) || strings.Contains(response.Body.String(), "do-not-expose-upstream-secret") {
					t.Fatalf("failure became success or leaked data: %d %s", response.Code, response.Body.String())
				}
			}
		})
	}
}

func TestInspirationGalleryPassesRequestCancellation(t *testing.T) {
	for _, suffix := range []string{"prompts", "prompts/example", "facets"} {
		t.Run(suffix, func(t *testing.T) {
			router, fake := inspirationGalleryTestRouter(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started := make(chan struct{})
			observed := make(chan error, 1)
			fake.onRead = func(received context.Context) {
				close(started)
				<-received.Done()
				observed <- received.Err()
			}
			fake.err = service.NewAppError(http.StatusRequestTimeout, "请求已取消")
			done := make(chan struct{})
			response := httptest.NewRecorder()
			go func() {
				defer close(done)
				request := httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/"+suffix, nil).WithContext(ctx)
				router.ServeHTTP(response, request)
			}()
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				t.Fatal("domain was not called")
			}
			cancel()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("cancellation did not reach domain")
			}
			if err := <-observed; !errors.Is(err, context.Canceled) || response.Code != http.StatusRequestTimeout {
				t.Fatalf("cancellation lost: error=%v status=%d", err, response.Code)
			}
		})
	}
}

func TestInspirationGalleryEndpointsSharePerIPLimit(t *testing.T) {
	router, fake := inspirationGalleryTestRouter(t)
	paths := []string{"prompts", "prompts/example", "facets"}
	for index := range 61 {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/"+paths[index%len(paths)], nil)
		request.RemoteAddr = "198.51.100.7:8080"
		router.ServeHTTP(response, request)
		if index < 60 && response.Code != http.StatusOK {
			t.Fatalf("request %d denied: %d %s", index+1, response.Code, response.Body.String())
		}
		if index == 60 && (response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" || response.Header().Get("Cache-Control") != "no-store") {
			t.Fatalf("limit not enforced: %d %v %s", response.Code, response.Header(), response.Body.String())
		}
	}
	if len(fake.calls) != 60 {
		t.Fatalf("rate-limited request reached domain: %d calls", len(fake.calls))
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/public/inspirations/zzai-gallery/prompts", nil)
	request.RemoteAddr = "198.51.100.8:8080"
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || len(fake.calls) != 61 {
		t.Fatalf("independent IP denied: %d %s", response.Code, response.Body.String())
	}
}
