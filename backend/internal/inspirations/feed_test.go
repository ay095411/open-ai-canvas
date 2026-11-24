package inspirations

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type feedTestAdminGate struct{}

func (feedTestAdminGate) RequireAdmin(actor *model.User) error {
	if actor == nil || actor.Role != model.UserRoleAdmin {
		return kernel.Forbidden("admin only")
	}
	return nil
}

func (feedTestAdminGate) AppendAudit(*model.User, string, string, string, string, any) error {
	return nil
}

func feedTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.InspirationFeedEntry{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return New(repository.New(db), feedTestAdminGate{}, nil, nil), db
}

func TestOfficialInspirationFeedDefaultSettingsAndSchedule(t *testing.T) {
	svc, _ := feedTestService(t)
	settings, err := svc.settings()
	if err != nil || !settings.Enabled {
		t.Fatalf("default settings = %+v, error = %v", settings, err)
	}
	if SyncInterval != 6*time.Hour || retryInterval != time.Hour || startupDelay != 2*time.Minute || checkInterval != 10*time.Minute {
		t.Fatal("official feed schedule changed")
	}
	if got := []string{svc.sources[0].id, svc.sources[1].id}; !reflect.DeepEqual(got, []string{"youmind", "seedance"}) {
		t.Fatalf("sources = %v", got)
	}
	if nextSyncAt(SyncState{}) != nil {
		t.Fatal("a feed that has never synced must be due immediately")
	}
	at := time.Unix(100, 0).UTC()
	for _, test := range []struct {
		errorText string
		interval  time.Duration
	}{{"", 6 * time.Hour}, {"source unavailable", time.Hour}} {
		state := SyncState{LastAttemptAt: &at, LastError: test.errorText}
		if next := nextSyncAt(state); next == nil || !next.Equal(at.Add(test.interval)) {
			t.Fatalf("next sync for %q = %v", test.errorText, next)
		}
	}
}

func TestOfficialInspirationFeedUsesGitHubSources(t *testing.T) {
	const readme = "\n### No. 1: 中文人像\n\n#### 📝 提示词\n\n```text\n画面呈现电影感人像，柔和自然光照亮人物面部，保持真实肌肤纹理。\n```\n<img src=\"https://images.example/portrait.jpg\">\n[详情](https://youmind.com/prompts?id=42)\n"
	cases, err := json.Marshal([]seedanceCase{{Slug: "scene", Title: "电影镜头", PromptFull: "镜头缓慢穿过雨后的街道，霓虹灯映照地面，人物在远处自然行走。", PosterURL: "https://images.example/scene.jpg"}})
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{
		"https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main/README_zh.md": []byte(readme),
		"https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main/README_zh.md":             []byte(readme),
		"https://raw.githubusercontent.com/LearnPrompt/awesome-seedance/main/data/cases.json":                 cases,
		"https://raw.githubusercontent.com/LearnPrompt/awesome-seedance/main/data/case-taxonomy.json":         []byte(`{"assignments":{"scene":"cinematic"}}`),
	}
	seen := map[string]bool{}
	fetch := func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
		data, ok := files[rawURL]
		if !ok {
			return nil, fmt.Errorf("unexpected upstream URL: %s", rawURL)
		}
		seen[rawURL] = true
		return data, nil
	}
	for _, source := range defaultSources() {
		batch, err := source.load(context.Background(), fetch)
		if err != nil {
			t.Fatal(err)
		}
		if len(batch.entries) != 1 {
			t.Fatalf("%s entries = %d; duplicate YouMind records must be merged", source.id, len(batch.entries))
		}
		entry := batch.entries[0]
		if entry.SourceID != source.id || entry.Image == "" || entry.ContentHash == "" || entry.Prompt == "" {
			t.Fatalf("invalid persisted source entry: %+v", entry)
		}
	}
	if len(seen) != len(files) {
		t.Fatalf("fetched %d source files, want %d", len(seen), len(files))
	}
}

func TestOfficialInspirationFeedPersistsChangesAndRetainsDisabledEntries(t *testing.T) {
	svc, db := feedTestService(t)
	at := time.Unix(100, 0).UTC()
	svc.now = func() time.Time { return at }
	entry := withContentHash(model.InspirationFeedEntry{ID: "youmind:42", SourceID: "youmind", Mode: "image", Title: "中文人像", Image: "https://images.example/portrait.jpg", Prompt: "画面呈现自然光照下的人物肖像，保留真实肌肤纹理。"})
	svc.sources = []source{{id: "youmind", load: func(context.Context, fetchFunc) (batch, error) {
		return batch{upstream: 1, entries: []model.InspirationFeedEntry{entry}}, nil
	}}}
	for index, wantUpdated := range []int{0, 0, 1} {
		if index == 2 {
			entry.Prompt = "画面呈现雨中人物肖像，柔和光线照亮人物面部，保持自然表情。"
			entry = withContentHash(entry)
		}
		state, acquired, err := svc.sync(context.Background(), TriggerSchedule, "")
		if err != nil || !acquired {
			t.Fatalf("sync %d: acquired=%v, error=%v", index, acquired, err)
		}
		created, updated := state.totals()
		wantCreated := 0
		if index == 0 {
			wantCreated = 1
		}
		if created != wantCreated || updated != wantUpdated {
			t.Fatalf("sync %d created=%d updated=%d", index, created, updated)
		}
		at = at.Add(time.Hour)
	}
	var persisted model.InspirationFeedEntry
	if err := db.First(&persisted, "id = ?", entry.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Prompt != entry.Prompt || !persisted.FirstSeenAt.Equal(time.Unix(100, 0).UTC()) {
		t.Fatalf("content update changed first-seen time or lost prompt: %+v", persisted)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, enabled := range []bool{false, true} {
		if _, err := svc.UpdateSettings(admin, SettingsUpdate{Enabled: &enabled}); err != nil {
			t.Fatal(err)
		}
		feed, err := svc.Feed()
		if err != nil || feed.Enabled != enabled || (len(feed.Entries) == 1) != enabled {
			t.Fatalf("enabled=%v feed=%+v error=%v", enabled, feed, err)
		}
		var count int64
		if err := db.Model(&model.InspirationFeedEntry{}).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("toggle deleted stored entries: count=%d error=%v", count, err)
		}
	}
}
