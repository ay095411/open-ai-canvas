package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

type fakeInspirationLibrary struct {
	calls int
	ids   []string
}

func (f *fakeInspirationLibrary) InspirationLibraryPrompts(context.Context, url.Values) (*service.InspirationLibraryPage, error) {
	f.calls++
	return &service.InspirationLibraryPage{Items: []service.InspirationLibrarySummary{}, PolicyVersion: "licensed-v1"}, nil
}
func (f *fakeInspirationLibrary) InspirationLibraryPrompt(context.Context, string) (*service.InspirationLibraryDetail, error) {
	f.calls++
	return &service.InspirationLibraryDetail{Prompt: "Licensed body"}, nil
}
func (f *fakeInspirationLibrary) InspirationLibraryFacets(context.Context, url.Values) (*service.InspirationLibraryFacets, error) {
	f.calls++
	return &service.InspirationLibraryFacets{Categories: []string{}, Models: []string{}, Tags: []string{}, PolicyVersion: "licensed-v1"}, nil
}
func (f *fakeInspirationLibrary) ResolveInspirationLibrary(_ context.Context, input service.InspirationLibraryResolve) (*service.InspirationLibraryResolved, error) {
	f.calls++
	f.ids = input.IDs
	return &service.InspirationLibraryResolved{Items: []service.InspirationLibrarySummary{}, PolicyVersion: "licensed-v1"}, nil
}
func (f *fakeInspirationLibrary) InspirationLibraryMedia(context.Context, string, string, string, int64) (*service.InspirationLibraryMediaContent, error) {
	f.calls++
	return &service.InspirationLibraryMediaContent{Data: []byte("0123456789"), MimeType: "image/png"}, nil
}

func inspirationLibraryTestRouter(t *testing.T) (*gin.Engine, *fakeInspirationLibrary) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	setupGalleryRateLimit(t)
	router := gin.New()
	fake := &fakeInspirationLibrary{}
	registerPublicInspirationLibraryRoutes(router.Group("/api"), fake)
	return router, fake
}

func TestInspirationLibraryPublicRoutesAndStrictJSON(t *testing.T) {
	router, fake := inspirationLibraryTestRouter(t)
	for _, test := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/public/inspirations/library/prompts", "", 200},
		{"GET", "/api/public/inspirations/library/facets?media_type=image", "", 200},
		{"GET", "/api/public/inspirations/library/prompts/portrait", "", 200},
		{"POST", "/api/public/inspirations/library/resolve", `{"ids":["authorized-library:portrait"]}`, 200},
		{"POST", "/api/public/inspirations/library/resolve", `{"ids":[],"unknown":true}`, 400},
		{"POST", "/api/public/inspirations/library/resolve", `{"ids":[]} {"ids":[]}`, 400},
		{"POST", "/api/public/inspirations/library/resolve", `{"ids":["` + strings.Repeat("x", 33<<10) + `"]}`, 400},
		{"GET", "/api/public/inspirations/library/prompts/portrait?url=remote", "", 400},
		{"GET", "/api/public/inspirations/library/prompts/portrait?x=1&x=2", "", 400},
		{"POST", "/api/public/inspirations/library/resolve?foo=bar", `{"ids":[]}`, 400},
		{"GET", "/api/public/inspirations/library/prompts?search=%ZZ", "", 400},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(response, request)
		if response.Code != test.status || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %s", test.method, test.path, response.Code, response.Body.String())
		}
	}
	if fake.calls != 4 || len(fake.ids) != 1 {
		t.Fatalf("invalid input reached domain: %#v", fake)
	}
}

func TestInspirationLibraryMediaRangeAndHeaders(t *testing.T) {
	router, fake := inspirationLibraryTestRouter(t)
	path := "/api/public/inspirations/library/prompts/portrait/media?kind=image&hash=" + strings.Repeat("a", 64) + "&revision=2"
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("Range", "bytes=2-4")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "234" || response.Header().Get("Content-Type") != "image/png" || response.Header().Get("X-Content-Type-Options") != "nosniff" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("range response: %d %v %s", response.Code, response.Header(), response.Body.String())
	}
	for _, suffix := range []string{"&hash=b", "&unknown=x", "&revision=3"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path+suffix, nil))
		if response.Code != 400 {
			t.Fatalf("duplicate/unknown media query accepted: %s", suffix)
		}
	}
	if fake.calls != 1 {
		t.Fatal("invalid media query reached domain")
	}
}

func TestInspirationLibraryAdminRoutesRequireLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterInspirationLibraryRoutes(router.Group("/api"), &service.Service{})
	for _, test := range []struct{ method, path string }{
		{"GET", "/api/admin/inspirations/library"}, {"GET", "/api/admin/inspirations/library/portrait"}, {"POST", "/api/admin/inspirations/library/import"}, {"POST", "/api/admin/inspirations/library/portrait/review"}, {"GET", "/api/admin/inspirations/library/portrait/media"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != 401 {
			t.Fatalf("anonymous admin request %s returned %d", test.path, response.Code)
		}
	}
	if !storageReadOnlyExempt(http.MethodPost, "/api/public/inspirations/library/resolve") {
		t.Fatal("public read POST blocked by storage guard")
	}
}
