package inspirations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func videoTestLink(slug string) VideoLink {
	return VideoLink{ID: "seedance:" + slug, SourceID: "seedance", SourceURL: "https://x.com/author/status/" + slug, VideoURL: "https://media.goodcase.ai/cases/" + slug + ".mp4"}
}

func videoTestCase(slug string) seedanceCase {
	link := videoTestLink(slug)
	return seedanceCase{Slug: slug, Title: "电影镜头", Summary: "中文镜头示例", PosterURL: "https://media.goodcase.ai/cases/" + slug + ".jpg", PromptFull: "镜头缓慢穿过雨后的街道，霓虹灯映照地面，人物在远处自然行走。", SourceURL: link.SourceURL, MediaType: "video", MediaURL: link.VideoURL}
}

func videoTestBatch(t *testing.T, cases ...seedanceCase) batch {
	t.Helper()
	parsed, err := buildSeedanceBatch(cases, map[string]string{"scene": "cinematic"})
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func videoTestSource(parsed *batch, calls *int) source {
	return source{id: "seedance", name: "awesome-seedance", load: func(context.Context, fetchFunc) (batch, error) {
		*calls++
		return *parsed, nil
	}}
}

func TestAutomaticVideoLinksUseSameCaseDownloadAndIncludeEnglishCases(t *testing.T) {
	english := videoTestCase("english")
	english.Title, english.PromptFull = "English case", "A camera follows the actor through a rainy street."
	data, err := json.Marshal(map[string]any{"cases": []seedanceCase{videoTestCase("scene"), english}})
	if err != nil {
		t.Fatal(err)
	}
	requests := map[string]int{}
	parsed, err := loadSeedance(context.Background(), func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
		requests[rawURL]++
		switch rawURL {
		case githubRaw + seedanceRepo + "/main/data/cases.json":
			return data, nil
		case githubRaw + seedanceRepo + "/main/data/case-taxonomy.json":
			return []byte(`{"assignments":{"scene":"cinematic"}}`), nil
		default:
			return nil, errors.New("unexpected upstream request")
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.entries) != 1 || len(parsed.videoLinks) != 2 || parsed.videoError != nil || parsed.videoRejected != 0 {
		t.Fatalf("parsed entries=%d videos=%d rejected=%d error=%v", len(parsed.entries), len(parsed.videoLinks), parsed.videoRejected, parsed.videoError)
	}
	if len(requests) != 2 || requests[githubRaw+seedanceRepo+"/main/data/cases.json"] != 1 {
		t.Fatalf("video metadata triggered extra case downloads: %v", requests)
	}
	englishOnly, err := buildSeedanceBatch([]seedanceCase{english}, nil)
	if err != nil || len(englishOnly.entries) != 0 || len(englishOnly.videoLinks) != 1 {
		t.Fatalf("valid English case media was excluded: %+v, error=%v", englishOnly, err)
	}
}

func TestAutomaticVideoLinksStrictPublicURLsAndIgnoreRetestArtifacts(t *testing.T) {
	for _, path := range []string{"/cases/case.mp4", "/media/video/case.mp4", "/media/goodcase/case.mp4", "/supabase-legacy/case-media/case.mp4"} {
		link := videoTestLink("case")
		link.VideoURL = "https://media.goodcase.ai" + path
		if !validVideoLink(link) {
			t.Fatalf("rejected observed public CDN path: %s", path)
		}
	}
	for _, rawURL := range []string{"http://media.goodcase.ai/cases/case.mp4", "https://goodcase.ai/media/goodcase/case.mp4", "https://media.goodcase.ai.evil.test/cases/case.mp4", "https://user:secret@media.goodcase.ai/cases/case.mp4", "https://media.goodcase.ai:8443/cases/case.mp4", "https://media.goodcase.ai/cases/case.mp4?token=expired", "https://media.goodcase.ai/cases/case.mp4#signature", "https://localhost/cases/case.mp4", "https://127.0.0.1/cases/case.mp4", "https://media.goodcase.ai/cases/page.html"} {
		link := videoTestLink("case")
		link.VideoURL = rawURL
		if validVideoLink(link) {
			t.Fatalf("accepted non-public or signed media: %s", rawURL)
		}
	}
	for _, change := range []VideoLink{{ID: "authorized-library:case", SourceID: "authorized-library", SourceURL: videoTestLink("case").SourceURL, VideoURL: videoTestLink("case").VideoURL}, {ID: "seedance:case", SourceID: "seedance", SourceURL: "https://user:secret@x.com/author/status/1", VideoURL: videoTestLink("case").VideoURL}} {
		if validVideoLink(change) {
			t.Fatalf("accepted mismatched identity or source credentials: %+v", change)
		}
	}
	var cases []seedanceCase
	if err := json.Unmarshal([]byte(`[{"slug":"case","mediaType":"video","sourceUrl":"https://x.com/author/status/case","mediaUrl":"https://media.goodcase.ai/cases/original.mp4","retests":[{"artifactUrl":"https://media.goodcase.ai/cases/wrong-model.mp4"}]}]`), &cases); err != nil {
		t.Fatal(err)
	}
	links, _, err := extractSeedanceVideoLinks(cases)
	if err != nil || len(links) != 1 || links[0].VideoURL != "https://media.goodcase.ai/cases/original.mp4" {
		t.Fatalf("original media was replaced by a retest: %+v, error=%v", links, err)
	}
}

func TestAutomaticVideoLinksConflictRejectedAndBoundsPreservePrevious(t *testing.T) {
	first := videoTestCase("case")
	second := first
	second.MediaURL = "https://media.goodcase.ai/cases/other.mp4"
	if links, rejected, err := extractSeedanceVideoLinks([]seedanceCase{first, second}); err == nil || len(links) != 0 || rejected != 2 {
		t.Fatalf("conflicting metadata accepted: links=%v rejected=%d error=%v", links, rejected, err)
	}
	previous := &VideoLinks{Version: 1, Entries: []VideoLink{videoTestLink("case")}}
	entries := make([]VideoLink, maxVideoLinks)
	for index := range entries {
		entries[index] = videoTestLink(fmt.Sprintf("new-%d", index))
	}
	if merged, err := mergeVideoLinks(previous, entries, time.Now()); err == nil || merged != nil {
		t.Fatal("overflow mapping did not reject the entire replacement")
	}
	if !reflect.DeepEqual(previous.Entries, []VideoLink{videoTestLink("case")}) {
		t.Fatal("overflow mutated previous metadata")
	}
	cases := make([]seedanceCase, maxVideoLinks+1)
	for index := range cases {
		cases[index] = videoTestCase(fmt.Sprintf("new-%d", index))
	}
	if links, _, err := extractSeedanceVideoLinks(cases); err == nil || links != nil {
		t.Fatal("oversized source batch was partly accepted")
	}
}

func TestAutomaticVideoLinksBootstrapOnceThenHonorSixHourSchedule(t *testing.T) {
	svc, _ := feedTestService(t)
	at := time.Unix(1_000_000, 0).UTC()
	svc.now = func() time.Time { return at }
	oldAttempt := at.Add(-time.Hour)
	if err := svc.saveSetting(stateKey, SyncState{LastAttemptAt: &oldAttempt}, ""); err != nil {
		t.Fatal(err)
	}
	parsed := videoTestBatch(t, videoTestCase("scene"))
	calls := 0
	svc.sources = []source{videoTestSource(&parsed, &calls)}
	svc.syncIfDue(context.Background())
	state, err := svc.readState()
	if err != nil || calls != 1 || state.VideoLinks == nil || state.VideoLinks.Version != 1 || len(state.VideoLinks.Entries) != 1 || state.Trigger != TriggerSchedule {
		t.Fatalf("upgrade bootstrap failed: calls=%d state=%+v error=%v", calls, state, err)
	}
	for _, delta := range []time.Duration{0, 10 * time.Minute, 6*time.Hour - time.Second} {
		at = time.Unix(1_000_000, 0).UTC().Add(delta)
		svc.syncIfDue(context.Background())
	}
	if calls != 1 {
		t.Fatalf("bootstrap repeated before six hours: %d", calls)
	}
	at = time.Unix(1_000_000, 0).UTC().Add(6 * time.Hour)
	svc.syncIfDue(context.Background())
	if calls != 2 {
		t.Fatalf("six-hour due time did not sync media: calls=%d", calls)
	}
}

func TestAutomaticVideoLinksFailedBootstrapPersistsMarkerAndUsesOneHourRetry(t *testing.T) {
	svc, _ := feedTestService(t)
	at := time.Unix(1_000_000, 0).UTC()
	svc.now = func() time.Time { return at }
	calls := 0
	svc.sources = []source{{id: "seedance", name: "awesome-seedance", load: func(context.Context, fetchFunc) (batch, error) {
		calls++
		return batch{}, errors.New("upstream unavailable")
	}}}
	svc.syncIfDue(context.Background())
	state, err := svc.readState()
	if err != nil || state.VideoLinks == nil || state.VideoLinks.Version != 1 || len(state.VideoLinks.Entries) != 0 || state.LastError == "" {
		t.Fatalf("failed bootstrap lost its attempt marker: %+v error=%v", state, err)
	}
	at = at.Add(10 * time.Minute)
	svc.syncIfDue(context.Background())
	if calls != 1 {
		t.Fatal("failed initialization triggered every ten-minute tick")
	}
	at = at.Add(50 * time.Minute)
	svc.syncIfDue(context.Background())
	if calls != 2 {
		t.Fatal("failed initialization did not retry after one hour")
	}
}

func TestAutomaticVideoLinksEmptyInvalidAndFailedSourceKeepPreviousValidMapping(t *testing.T) {
	for _, scenario := range []string{"empty", "invalid", "failed"} {
		t.Run(scenario, func(t *testing.T) {
			svc, _ := feedTestService(t)
			previousAt := time.Unix(100, 0).UTC()
			at := previousAt.Add(6 * time.Hour)
			svc.now = func() time.Time { return at }
			old := &VideoLinks{Version: 1, Entries: []VideoLink{videoTestLink("scene")}, SyncedAt: &previousAt}
			if err := svc.saveSetting(stateKey, SyncState{LastAttemptAt: &previousAt, VideoLinks: old}, ""); err != nil {
				t.Fatal(err)
			}
			svc.sources = []source{{id: "seedance", name: "awesome-seedance", load: func(context.Context, fetchFunc) (batch, error) {
				if scenario == "failed" {
					return batch{}, errors.New("network failure")
				}
				item := videoTestCase("scene")
				if scenario == "empty" {
					item.MediaType, item.MediaURL = "", ""
				} else {
					item.MediaURL = "https://media.goodcase.ai/cases/new.mp4?token=expires"
				}
				return buildSeedanceBatch([]seedanceCase{item}, nil)
			}}}
			svc.syncIfDue(context.Background())
			state, err := svc.readState()
			if err != nil || !reflect.DeepEqual(state.VideoLinks, old) || state.LastError == "" || state.Sources[0].VideoAccepted != 0 {
				t.Fatalf("%s replaced old media or hid failure: %+v error=%v", scenario, state, err)
			}
		})
	}
}

func TestAutomaticVideoLinksUpdateLatestCaseRetainRemovedCaseAndSurviveRestart(t *testing.T) {
	svc, db := feedTestService(t)
	at := time.Unix(100, 0).UTC()
	svc.now = func() time.Time { return at }
	old := videoTestLink("removed")
	if err := svc.saveSetting(stateKey, SyncState{VideoLinks: &VideoLinks{Version: 1, Entries: []VideoLink{old}}}, ""); err != nil {
		t.Fatal(err)
	}
	parsed := videoTestBatch(t, videoTestCase("scene"))
	calls := 0
	svc.sources = []source{videoTestSource(&parsed, &calls)}
	if _, _, err := svc.sync(context.Background(), TriggerSchedule, ""); err != nil {
		t.Fatal(err)
	}
	first, err := svc.Feed()
	if err != nil || first.Entries[0].VideoURL != videoTestLink("scene").VideoURL {
		t.Fatalf("initial feed did not receive media: %+v error=%v", first, err)
	}
	item := videoTestCase("scene")
	item.MediaURL = "https://media.goodcase.ai/cases/new-scene.mp4"
	parsed = videoTestBatch(t, item)
	at = at.Add(6 * time.Hour)
	svc.syncIfDue(context.Background())
	second, err := svc.Feed()
	if err != nil || second.Entries[0].VideoURL != item.MediaURL || len(second.VideoLinks.Entries) != 2 || second.Entries[0].Prompt != first.Entries[0].Prompt || second.Entries[0].Image != first.Entries[0].Image {
		t.Fatalf("latest media did not invalidate cache or changed content: %+v error=%v", second, err)
	}
	restarted := New(repository.New(db), feedTestAdminGate{}, nil, nil)
	restarted.now = svc.now
	feed, err := restarted.Feed()
	if err != nil || !reflect.DeepEqual(feed, second) {
		t.Fatalf("restart lost media JSON: %+v error=%v", feed, err)
	}
	if db.Migrator().HasColumn(&model.InspirationFeedEntry{}, "video_url") {
		t.Fatal("video enrichment added a persisted entry column")
	}
	var tables []string
	if err := db.Raw("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").Scan(&tables).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range tables {
		if table != "system_settings" && table != "inspiration_feed_entries" {
			t.Fatalf("video enrichment added a table: %s", table)
		}
	}
}

func TestAutomaticVideoLinksRequireSameSourceAndDisabledFeedHidesMetadata(t *testing.T) {
	svc, db := feedTestService(t)
	item := videoTestCase("scene")
	parsed := videoTestBatch(t, item)
	calls := 0
	svc.sources = []source{videoTestSource(&parsed, &calls)}
	if _, _, err := svc.sync(context.Background(), TriggerSchedule, ""); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.InspirationFeedEntry{}).Where("id = ?", "seedance:scene").Update("source_url", "https://x.com/other/status/scene").Error; err != nil {
		t.Fatal(err)
	}
	svc.invalidateFeed()
	feed, err := svc.Feed()
	if err != nil || feed.Entries[0].VideoURL != "" || len(feed.VideoLinks.Entries) != 1 {
		t.Fatalf("mismatched source was enriched: %+v error=%v", feed, err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, enabled := range []bool{false, true} {
		if _, err := svc.UpdateSettings(admin, SettingsUpdate{Enabled: &enabled}); err != nil {
			t.Fatal(err)
		}
		feed, err = svc.Feed()
		if err != nil || (feed.VideoLinks != nil) != enabled || (len(feed.Entries) != 0) != enabled {
			t.Fatalf("disabled state leaked or deleted data: enabled=%v feed=%+v error=%v", enabled, feed, err)
		}
	}
}

func TestAutomaticVideoLinksCanceledSyncDoesNotWriteAttemptOrMetadata(t *testing.T) {
	svc, _ := feedTestService(t)
	at := time.Unix(100, 0).UTC()
	old := SyncState{LastAttemptAt: &at, VideoLinks: &VideoLinks{Version: 1, Entries: []VideoLink{videoTestLink("old")}}}
	if err := svc.saveSetting(stateKey, old, ""); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	svc.sources = []source{{id: "seedance", load: func(context.Context, fetchFunc) (batch, error) {
		cancel()
		return batch{videoLinks: []VideoLink{videoTestLink("new")}}, nil
	}}}
	if _, acquired, err := svc.sync(ctx, TriggerSchedule, ""); !acquired || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled sync = acquired %v, error %v", acquired, err)
	}
	state, err := svc.readState()
	if err != nil || !reflect.DeepEqual(state, old) {
		t.Fatalf("cancelled sync wrote new attempt or metadata: %+v error=%v", state, err)
	}
}

func TestAutomaticVideoLinksFeedSnapshotsDoNotExposeCachedMutableReferences(t *testing.T) {
	svc, _ := feedTestService(t)
	item := videoTestCase("scene")
	item.Tags = []string{"original-tag"}
	parsed := videoTestBatch(t, item)
	parsed.categories = map[string]string{"cinematic": "电影感"}
	calls := 0
	svc.sources = []source{videoTestSource(&parsed, &calls)}
	if _, _, err := svc.sync(context.Background(), TriggerSchedule, ""); err != nil {
		t.Fatal(err)
	}
	feed, err := svc.Feed()
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(feed)
	if err != nil {
		t.Fatal(err)
	}
	feed.Entries[0].VideoURL = "https://media.goodcase.ai/cases/forged.mp4"
	feed.Entries[0].Tags[0] = "forged-tag"
	feed.Categories["seedance"]["cinematic"] = "forged-label"
	feed.VideoLinks.Entries[0].SourceURL = "https://x.com/forged/status/scene"
	*feed.VideoLinks.SyncedAt = time.Time{}
	*feed.SyncedAt = time.Time{}
	next, err := svc.Feed()
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(next)
	if err != nil || strings.Compare(string(before), string(after)) != 0 {
		t.Fatalf("caller mutated cached metadata: before=%s after=%s error=%v", before, after, err)
	}
}
