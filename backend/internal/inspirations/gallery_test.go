package inspirations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/platform"
)

type galleryTransportFunc func(*http.Request) (*http.Response, error)

func (f galleryTransportFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

const galleryFixtureItem = `{"slug":"example-1","title":"Original title","title_translations":{"zh":"中文标题"},"description":"Example description","category":"portrait","prompt":"Keep this original prompt exactly.","prompt_zh":"保留这个中文提示词原文。","model":"Upstream Model","featured":true,"media_type":"video","cover_url":"https://images.example.com/cover.png","media_url":"https://images.example.com/video.mp4","media_width":768,"media_height":1024,"source_name":"Original Creator","source_url":"https://source.example.com/entry/1","tags":["cinematic","cinematic","portrait"],"published_at":1794779241,"recipe":{"mode":"reference","notes":"Upload a reference image.","requirements":[{"kind":"image","count":1}]}}`

func galleryResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}

func testGallery(transport galleryTransportFunc) *Gallery {
	gallery := NewGallery()
	gallery.client = &http.Client{Transport: transport}
	// This transport never dials; production URL validation remains the SSRF-aware function.
	gallery.validate = url.Parse
	return gallery
}

func TestGalleryQueryValidation(t *testing.T) {
	for _, test := range []struct {
		name, input, want string
		invalid           bool
	}{
		{name: "defaults", want: "limit=20&sort=latest"},
		{name: "search", input: "search=%E7%8C%AB&media_type=all", want: "limit=20&search=%E7%8C%AB&sort=relevance"},
		{name: "random", input: "limit=50&sort=random&seed=2147483646", want: "limit=50&seed=2147483646&sort=random"},
		{name: "unknown", input: "url=https://127.0.0.1", invalid: true},
		{name: "duplicate", input: "limit=1&limit=2", invalid: true},
		{name: "large limit", input: "limit=51", invalid: true},
		{name: "zero limit", input: "limit=0", invalid: true},
		{name: "negative limit", input: "limit=-1", invalid: true},
		{name: "fraction limit", input: "limit=1.5", invalid: true},
		{name: "media", input: "media_type=audio", invalid: true},
		{name: "sort", input: "sort=oldest", invalid: true},
		{name: "seed without random", input: "seed=1", invalid: true},
		{name: "zero seed", input: "sort=random&seed=0", invalid: true},
		{name: "large seed", input: "sort=random&seed=2147483647", invalid: true},
		{name: "control", input: "search=a%0Ab", invalid: true},
		{name: "bad cursor", input: "cursor=%3Fsecret", invalid: true},
		{name: "bad utf8", input: "search=%FF", invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, err := url.ParseQuery(test.input)
			if err != nil {
				t.Fatal(err)
			}
			query, err := galleryQuery(input, false)
			if test.invalid {
				var appErr *kernel.AppError
				if !errors.As(err, &appErr) || appErr.Status != http.StatusBadRequest {
					t.Fatalf("expected structured 400, got %v", err)
				}
				return
			}
			if err != nil || query.Encode() != test.want {
				t.Fatalf("query=%v error=%v, want %s", query, err, test.want)
			}
		})
	}
	if _, err := galleryQuery(url.Values{"search": {strings.Repeat("字", 201)}}, false); err == nil {
		t.Fatal("accepted oversized search")
	}
	if _, err := galleryQuery(url.Values{"model": {"model"}}, true); err == nil {
		t.Fatal("facets accepted unknown parameter")
	}
	for _, slug := range []string{"", "..", "../private", "example%2fprivate", "example?key=secret", "https://other.example.com", strings.Repeat("a", 192)} {
		if err := validateGallerySlug(slug); err == nil {
			t.Fatalf("accepted unsafe slug %q", slug)
		}
	}
}

func TestGalleryReadContractAndCache(t *testing.T) {
	var calls atomic.Int32
	gallery := testGallery(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		if request.URL.Host != "api.seedance.nz" || request.URL.Scheme != "https" || request.Method != http.MethodGet || request.Header.Get("User-Agent") != outbound.DefaultOutboundUserAgent || request.Header.Get("Accept") != "application/json" || request.Header.Get("Cookie") != "" || request.Header.Get("Authorization") != "" {
			t.Errorf("invalid outbound request: %s headers=%v", request.URL, request.Header)
		}
		switch request.URL.Path {
		case "/api/prompt-gallery/v1/prompts":
			if request.URL.RawQuery != "limit=20&sort=latest" {
				t.Errorf("unexpected query: %s", request.URL.RawQuery)
			}
			return galleryResponse(200, `{"success":true,"data":{"items":[`+galleryFixtureItem+`],"total":1,"next_cursor":"eyJpZCI6MX0="}}`), nil
		case "/api/prompt-gallery/v1/prompts/example-1":
			return galleryResponse(200, `{"success":true,"data":`+galleryFixtureItem+`}`), nil
		case "/api/prompt-gallery/v1/facets":
			return galleryResponse(200, `{"success":true,"data":{"categories":["portrait"],"models":["Upstream Model"],"tags":["cinematic"],"total":1}}`), nil
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
			return nil, nil
		}
	})
	for range 2 {
		page, err := gallery.Prompts(context.Background(), url.Values{})
		if err != nil || len(page.Items) != 1 || page.Total != 1 || page.NextCursor != "eyJpZCI6MX0=" {
			t.Fatalf("page=%v, error=%v", page, err)
		}
		entry := page.Items[0]
		if entry.ID != "zzai-gallery:example-1" || entry.Title != "中文标题" || entry.Ratio != "3:4" || entry.SourceURL != "https://source.example.com/entry/1" || entry.GalleryURL != "https://api.seedance.nz/prompt-gallery/example-1" || len(entry.Tags) != 2 || !entry.Featured || entry.PublishedAt == nil || entry.PublishedAt.Location() != time.UTC {
			t.Fatalf("incorrect entry: %+v", entry)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("same query not cached: %d calls", calls.Load())
	}
	detail, err := gallery.Prompt(context.Background(), "example-1")
	if err != nil || detail.Prompt != "Keep this original prompt exactly." || detail.PromptZH != "保留这个中文提示词原文。" || !detail.RequiresReference || !detail.Featured || detail.UsageNotes != "Upload a reference image." {
		t.Fatalf("detail=%+v, error=%v", detail, err)
	}
	encoded, _ := json.Marshal(detail)
	if !strings.Contains(string(encoded), `"featured":true`) {
		t.Fatal("featured detail metadata missing from DTO")
	}
	for _, unexpected := range []string{"media_url", "source_name", "prompt_zh", "generation_params"} {
		if strings.Contains(string(encoded), unexpected) {
			t.Fatalf("leaked upstream field %s", unexpected)
		}
	}
	facets, err := gallery.Facets(context.Background(), url.Values{"media_type": {"video"}})
	if err != nil || facets.Total != 1 || len(facets.Models) != 1 {
		t.Fatalf("facets=%v, error=%v", facets, err)
	}
}

func TestGalleryRejectsUpstreamFailures(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		want       int
	}{
		{name: "http error", status: 500, body: "secret upstream failure", want: 502},
		{name: "not found", status: 404, want: 404},
		{name: "business error", status: 200, body: `{"success":false,"message":"secret upstream failure"}`, want: 502},
		{name: "missing data", status: 200, body: `{"success":true}`, want: 502},
		{name: "null data", status: 200, body: `{"success":true,"data":null}`, want: 502},
		{name: "malformed", status: 200, body: `{"success":true,`, want: 502},
		{name: "null items", status: 200, body: `{"success":true,"data":{"items":null,"total":1}}`, want: 502},
		{name: "missing total", status: 200, body: `{"success":true,"data":{"items":[]}}`, want: 502},
		{name: "invalid entry", status: 200, body: `{"success":true,"data":{"items":[{"slug":"../private"}],"total":1}}`, want: 502},
		{name: "oversized response", status: 200, body: strings.Repeat("x", galleryMaxResponseBytes+1), want: 502},
	} {
		t.Run(test.name, func(t *testing.T) {
			gallery := testGallery(func(*http.Request) (*http.Response, error) { return galleryResponse(test.status, test.body), nil })
			page, err := gallery.Prompts(context.Background(), url.Values{})
			var appErr *kernel.AppError
			if page != nil || !errors.As(err, &appErr) || appErr.Status != test.want || strings.Contains(err.Error(), "secret") {
				t.Fatalf("page=%v error=%v, expected structured %d", page, err, test.want)
			}
		})
	}
}

func TestGalleryDetailValidationAndSafeLinks(t *testing.T) {
	var item galleryUpstreamItem
	if err := json.Unmarshal([]byte(galleryFixtureItem), &item); err != nil {
		t.Fatal(err)
	}
	item.SourceURL = "javascript:alert(1)"
	item.MediaURL = "https://user:password@example.com/video.mp4"
	item.Prompt = ""
	detail, err := galleryDetail(item)
	if err != nil || detail.SourceURL != "" || detail.VideoURL != "" || detail.Prompt != item.PromptZH {
		t.Fatalf("invalid safe detail: %+v %v", detail, err)
	}
	item.CoverURL = "http://example.com/cover.png"
	if _, err := galleryDetail(item); err == nil {
		t.Fatal("accepted HTTP cover")
	}
	gallery := testGallery(func(*http.Request) (*http.Response, error) {
		return galleryResponse(200, `{"success":true,"data":`+galleryFixtureItem+`}`), nil
	})
	if _, err := gallery.Prompt(context.Background(), "different-slug"); err == nil {
		t.Fatal("accepted mismatched detail slug")
	}
}

func TestGalleryRequestCoalescingCancellationAndBounds(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	gallery := testGallery(func(request *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
			return galleryResponse(200, `{"success":true,"data":{"items":[],"total":0}}`), nil
		case <-request.Context().Done():
			return nil, request.Context().Err()
		}
	})
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := gallery.Prompts(context.Background(), url.Values{}); err != nil {
				t.Errorf("coalesced request failed: %v", err)
			}
		}()
	}
	<-started
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := gallery.Prompts(canceled, url.Values{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("expected one upstream request, got %d", calls.Load())
	}
	gallery.cache = platform.NewBoundedReadCache[string, []byte](2, 1024, 1, galleryCacheTTL)
	for _, category := range []string{"a", "b", "c", "d"} {
		if _, err := gallery.Prompts(context.Background(), url.Values{"category": {category}}); err != nil {
			t.Fatal(err)
		}
	}
	if count := gallery.cache.ClearAndCount(); count > 2 {
		t.Fatalf("cache exceeded entry budget: %d", count)
	}
}

func TestGalleryCancelsActiveUpstreamRequest(t *testing.T) {
	started := make(chan struct{})
	gallery := testGallery(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := gallery.Prompts(ctx, url.Values{})
		result <- err
	}()
	<-started
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("active request cancellation lost: %v", err)
	}
	if count := gallery.cache.ClearAndCount(); count != 0 {
		t.Fatalf("canceled response was cached: %d", count)
	}
}

// Opt-in smoke checks the actual adapter and upstream without starting a dev server.
func TestGalleryLiveSmoke(t *testing.T) {
	if os.Getenv("CANVAS_GALLERY_LIVE_SMOKE") != "1" {
		t.Skip("set CANVAS_GALLERY_LIVE_SMOKE=1 to check the public upstream")
	}
	gallery := NewGallery()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	page, err := gallery.Prompts(ctx, url.Values{"limit": {"2"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Total < len(page.Items) {
		t.Fatalf("unexpected live page: %+v", page)
	}
	detail, err := gallery.Prompt(ctx, page.Items[0].Slug)
	if err != nil || detail.Prompt == "" {
		t.Fatalf("live detail error: %v", err)
	}
	facets, err := gallery.Facets(ctx, url.Values{})
	if err != nil || facets.Total < len(page.Items) || len(facets.Models) == 0 {
		t.Fatalf("live facets error: %v", err)
	}
	if page.NextCursor != "" {
		next, err := gallery.Prompts(ctx, url.Values{"limit": {"2"}, "cursor": {page.NextCursor}})
		if err != nil || len(next.Items) == 0 || next.Items[0].Slug == page.Items[0].Slug {
			t.Fatalf("live pagination error: %v", err)
		}
	}
	t.Logf("live gallery: total=%d items=%d detail=%s models=%d", page.Total, len(page.Items), detail.Slug, len(facets.Models))
}
