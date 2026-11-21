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

func TestGalleryIgnoresZhenzhenModelsAndSeedanceSourceURL(t *testing.T) {
	itemJSON := func(slug, model, sourceURL string) string {
		raw, _ := json.Marshal(map[string]any{
			"slug":         slug,
			"title":        "Title " + slug,
			"media_type":   "image",
			"cover_url":    "https://images.example.com/" + slug + ".png",
			"media_width":  1024,
			"media_height": 1024,
			"model":        model,
			"source_url":   sourceURL,
			"prompt":       "Prompt " + slug,
		})
		return string(raw)
	}

	var listCalls []string
	gallery := testGallery(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/api/prompt-gallery/v1/prompts":
			listCalls = append(listCalls, request.URL.RawQuery)
			switch request.URL.Query().Get("cursor") {
			case "":
				return galleryResponse(200, `{"success":true,"data":{"items":[`+
					itemJSON("blocked-model", "zhenzhen-image-muse", "https://creator.example.com/zz")+`,`+
					itemJSON("blocked-model-case", "ZHENZHEN-image-g-v2.6-lowprice", "https://creator.example.com/a")+`,`+
					itemJSON("blocked-origin", "GPT Image 2.6", "https://api.seedance.nz/prompt-gallery/origin")+`,`+
					itemJSON("blocked-fallback-origin", "Google Nano Banana Pro", "")+
					`],"total":10,"next_cursor":"cursor_page_2"}}`), nil
			case "cursor_page_2":
				if request.URL.Query().Get("limit") != "50" {
					t.Errorf("expected fast-skip limit=50 after all-ignored batch, got %s", request.URL.RawQuery)
				}
				return galleryResponse(200, `{"success":true,"data":{"items":[`+
					itemJSON("blocked-fallback-2", "GPT Image 2", "")+`,`+
					itemJSON("kept-1", "GPT Image 2.6", "https://creator.example.com/1")+
					`],"total":10,"next_cursor":"cursor_page_3"}}`), nil
			case "cursor_page_3":
				if request.URL.Query().Get("limit") != "50" {
					t.Errorf("expected scan limit=50 for refill batch, got %s", request.URL.RawQuery)
				}
				return galleryResponse(200, `{"success":true,"data":{"items":[`+
					itemJSON("kept-2", "Seedream 5.0", "https://creator.example.com/2")+`,`+
					itemJSON("kept-3", "Flux.2", "https://x.com/user/status/1")+`,`+
					itemJSON("kept-4", "Flux.2", "https://x.com/user/status/2")+`,`+
					itemJSON("kept-5", "Flux.2", "https://x.com/user/status/3")+
					`],"total":10,"next_cursor":""}}`), nil
			default:
				t.Fatalf("unexpected cursor: %s", request.URL.RawQuery)
				return nil, nil
			}
		case "/api/prompt-gallery/v1/prompts/blocked-model":
			return galleryResponse(200, `{"success":true,"data":`+itemJSON("blocked-model", "zhenzhen-image-muse", "https://creator.example.com/zz")+`}`), nil
		case "/api/prompt-gallery/v1/prompts/blocked-origin":
			return galleryResponse(200, `{"success":true,"data":`+itemJSON("blocked-origin", "GPT Image 2.6", "https://api.seedance.nz/prompt-gallery/origin")+`}`), nil
		case "/api/prompt-gallery/v1/prompts/blocked-fallback-origin":
			return galleryResponse(200, `{"success":true,"data":`+itemJSON("blocked-fallback-origin", "Google Nano Banana Pro", "")+`}`), nil
		case "/api/prompt-gallery/v1/facets":
			return galleryResponse(200, `{"success":true,"data":{"categories":["portrait"],"models":["GPT Image 2.6","zhenzhen-image-muse","ZHENZHEN-video-pro","Seedream 5.0"],"tags":["cinematic"],"total":10}}`), nil
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
			return nil, nil
		}
	})

	page, err := gallery.Prompts(context.Background(), url.Values{"limit": {"3"}})
	if err != nil {
		t.Fatalf("Prompts failed: %v", err)
	}
	if len(page.Items) != 3 || page.Items[0].Slug != "kept-1" || page.Items[1].Slug != "kept-2" || page.Items[2].Slug != "kept-3" {
		t.Fatalf("unexpected filtered items: %+v", page.Items)
	}
	if !strings.HasPrefix(page.NextCursor, galleryCursorPrefix) || page.Total != 5 {
		t.Fatalf("unexpected pagination after mid-batch refill: total=%d next=%q", page.Total, page.NextCursor)
	}
	if len(listCalls) != 3 {
		t.Fatalf("expected 3 upstream calls for page 1, got %v", listCalls)
	}

	// Page 2 resumes from the cached mid-batch cursor with 0 extra upstream requests and drains the final batch cleanly.
	page2, err := gallery.Prompts(context.Background(), url.Values{"limit": {"3"}, "cursor": {page.NextCursor}})
	if err != nil {
		t.Fatalf("Prompts page 2 failed: %v", err)
	}
	if len(page2.Items) != 2 || page2.Items[0].Slug != "kept-4" || page2.Items[1].Slug != "kept-5" || page2.NextCursor != "" {
		t.Fatalf("unexpected page 2 after mid-batch resume: %+v", page2)
	}
	if len(listCalls) != 3 {
		t.Fatalf("page 2 should hit cached batch without new upstream call: %v", listCalls)
	}

	// Malformed wrapped cursors are rejected with 400.
	for _, badCursor := range []string{"yc1_not-valid", "yc1_e30", "yc1_eyJzIjo1MCwibCI6NTB9"} {
		_, err := gallery.Prompts(context.Background(), url.Values{"cursor": {badCursor}})
		var appErr *kernel.AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusBadRequest {
			t.Fatalf("expected 400 for malformed wrapped cursor %q, got %v", badCursor, err)
		}
	}

	empty, err := gallery.Prompts(context.Background(), url.Values{"model": {"zhenzhen-image-muse"}})
	if err != nil || len(empty.Items) != 0 || empty.Total != 0 || empty.NextCursor != "" {
		t.Fatalf("expected empty result for ignored model filter, got page=%+v err=%v", empty, err)
	}
	if len(listCalls) != 3 {
		t.Fatalf("ignored model filter must not call upstream: %v", listCalls)
	}

	for _, slug := range []string{"blocked-model", "blocked-origin", "blocked-fallback-origin"} {
		detail, err := gallery.Prompt(context.Background(), slug)
		var appErr *kernel.AppError
		if detail != nil || !errors.As(err, &appErr) || appErr.Status != http.StatusNotFound {
			t.Fatalf("expected 404 for ignored slug %s, got detail=%v err=%v", slug, detail, err)
		}
	}

	// Verify exact page counts across multiple consecutive pages resumed from a single cached 50-item batch.
	var multiCalls []string
	multiGallery := testGallery(func(request *http.Request) (*http.Response, error) {
		multiCalls = append(multiCalls, request.URL.RawQuery)
		switch request.URL.Query().Get("cursor") {
		case "":
			return galleryResponse(200, `{"success":true,"data":{"items":[`+
				itemJSON("skip-1", "Google Nano Banana Pro", "")+`,`+
				itemJSON("skip-2", "GPT Image 2", "")+
				`],"total":7,"next_cursor":"cursor_dense"}}`), nil
		case "cursor_dense":
			return galleryResponse(200, `{"success":true,"data":{"items":[`+
				itemJSON("v1", "GPT Image 2.6", "https://x.com/u/1")+`,`+
				itemJSON("v2", "GPT Image 2.6", "https://x.com/u/2")+`,`+
				itemJSON("v3", "GPT Image 2.6", "https://x.com/u/3")+`,`+
				itemJSON("v4", "GPT Image 2.6", "https://x.com/u/4")+`,`+
				itemJSON("v5", "GPT Image 2.6", "https://x.com/u/5")+
				`],"total":7,"next_cursor":"cursor_after_dense"}}`), nil
		case "cursor_after_dense":
			return galleryResponse(200, `{"success":true,"data":{"items":[`+
				itemJSON("v6", "GPT Image 2.6", "https://x.com/u/6")+
				`],"total":7,"next_cursor":""}}`), nil
		default:
			t.Fatalf("unexpected cursor: %s", request.URL.RawQuery)
			return nil, nil
		}
	})
	p1, err := multiGallery.Prompts(context.Background(), url.Values{"limit": {"2"}})
	if err != nil || len(p1.Items) != 2 || p1.Items[0].Slug != "v1" || p1.Items[1].Slug != "v2" {
		t.Fatalf("p1=%+v err=%v", p1, err)
	}
	p2, err := multiGallery.Prompts(context.Background(), url.Values{"limit": {"2"}, "cursor": {p1.NextCursor}})
	if err != nil || len(p2.Items) != 2 || p2.Items[0].Slug != "v3" || p2.Items[1].Slug != "v4" {
		t.Fatalf("p2=%+v err=%v", p2, err)
	}
	p3, err := multiGallery.Prompts(context.Background(), url.Values{"limit": {"2"}, "cursor": {p2.NextCursor}})
	if err != nil || len(p3.Items) != 2 || p3.Items[0].Slug != "v5" || p3.Items[1].Slug != "v6" || p3.NextCursor != "" {
		t.Fatalf("p3=%+v err=%v", p3, err)
	}
	if len(multiCalls) != 3 {
		t.Fatalf("expected exactly 3 upstream calls across 3 pages (cached middle page), got %v", multiCalls)
	}

	facets, err := gallery.Facets(context.Background(), url.Values{})
	if err != nil {
		t.Fatalf("Facets failed: %v", err)
	}
	if strings.Join(facets.Models, ",") != "GPT Image 2.6,Seedream 5.0" {
		t.Fatalf("ignored models leaked in facets: %v", facets.Models)
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
	imagePage, err := gallery.Prompts(ctx, url.Values{"media_type": {"image"}, "limit": {"21"}})
	if err != nil || len(imagePage.Items) != 21 || imagePage.NextCursor == "" {
		t.Fatalf("live image gallery page 1 error: len=%d next=%q err=%v", len(imagePage.Items), imagePage.NextCursor, err)
	}
	imagePage2, err := gallery.Prompts(ctx, url.Values{"media_type": {"image"}, "limit": {"21"}, "cursor": {imagePage.NextCursor}})
	if err != nil || len(imagePage2.Items) != 21 {
		t.Fatalf("live image gallery page 2 error: len=%d err=%v", len(imagePage2.Items), err)
	}
	seenImage := map[string]bool{}
	for _, entry := range imagePage.Items {
		seenImage[entry.Slug] = true
	}
	for _, entry := range imagePage2.Items {
		if seenImage[entry.Slug] {
			t.Fatalf("live image pagination duplicated slug %s", entry.Slug)
		}
	}
	allEntries := append(append(append([]GalleryEntry{}, page.Items...), imagePage.Items...), imagePage2.Items...)
	for _, entry := range allEntries {
		if galleryEntryIgnored(entry) || entry.SourceURL == "" {
			t.Fatalf("live gallery leaked ignored entry: %+v", entry)
		}
	}
	for _, model := range facets.Models {
		if galleryModelIgnored(model) {
			t.Fatalf("live facets leaked ignored model: %s", model)
		}
	}
	t.Logf("live gallery: total=%d items=%d imagePage1=%d imagePage2=%d firstImageSource=%s detail=%s models=%d", page.Total, len(page.Items), len(imagePage.Items), len(imagePage2.Items), imagePage.Items[0].SourceURL, detail.Slug, len(facets.Models))
}
