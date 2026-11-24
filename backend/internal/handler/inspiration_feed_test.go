package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/inspirations"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestOfficialInspirationFeedPublicReadAndAdminAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
	entry := model.InspirationFeedEntry{ID: "youmind:42", SourceID: "youmind", Mode: "image", Title: "中文人像", Image: "https://images.example/portrait.jpg", Prompt: "画面呈现柔和自然光中的人物肖像，保留真实肌肤纹理。", FirstSeenAt: time.Unix(100, 0).UTC()}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	runtimeService = svc
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterInspirationFeedRoutes(router.Group("/api"), svc)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/feed", nil))
	var envelope struct {
		Code int               `json:"code"`
		Data inspirations.Feed `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || envelope.Code != 0 || !envelope.Data.Enabled || len(envelope.Data.Entries) != 1 {
		t.Fatalf("anonymous feed: status=%d body=%s", response.Code, response.Body)
	}
	if got := envelope.Data.Entries[0]; got.ID != entry.ID || got.Prompt != entry.Prompt || got.Image != entry.Image || !got.AddedAt.Equal(entry.FirstSeenAt) {
		t.Fatalf("public feed changed persisted source fields: %+v", got)
	}
	for _, test := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/settings/inspiration-feed"},
		{http.MethodPatch, "/api/admin/settings/inspiration-feed"},
		{http.MethodPost, "/api/admin/settings/inspiration-feed/sync"},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(`{"enabled":true}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s %s returned %d, want 401", test.method, test.path, response.Code)
		}
	}
}

func TestOfficialInspirationFeedPublishesPersistedVideoLinks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, enabled := range []bool{true, false} {
		t.Run(map[bool]string{true: "enabled", false: "disabled"}[enabled], func(t *testing.T) {
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
			entry := model.InspirationFeedEntry{ID: "seedance:scene", SourceID: "seedance", Mode: "video", Title: "电影镜头", Image: "https://media.goodcase.ai/cases/scene.jpg", Prompt: "镜头穿过雨后街道。", SourceURL: "https://x.com/sample/status/1", FirstSeenAt: time.Unix(100, 0).UTC()}
			if err := db.Create(&entry).Error; err != nil {
				t.Fatal(err)
			}
			state := model.SystemSetting{Key: "inspiration_feed_sync", ValueJSON: `{"videoLinks":{"version":1,"entries":[{"id":"seedance:scene","sourceId":"seedance","sourceUrl":"https://x.com/sample/status/1","videoUrl":"https://media.goodcase.ai/cases/scene.mp4"}]}}`}
			if err := db.Create(&state).Error; err != nil {
				t.Fatal(err)
			}
			if !enabled {
				if err := db.Create(&model.SystemSetting{Key: "inspiration_feed", ValueJSON: `{"enabled":false}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			svc := service.New(repository.New(db), t.TempDir())
			previous := runtimeService
			runtimeService = svc
			t.Cleanup(func() { runtimeService = previous })
			router := gin.New()
			RegisterInspirationFeedRoutes(router.Group("/api"), svc)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/inspirations/feed", nil))
			var envelope struct {
				Code int               `json:"code"`
				Data inspirations.Feed `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || envelope.Code != 0 || envelope.Data.Enabled != enabled {
				t.Fatalf("feed response status=%d body=%s", response.Code, response.Body)
			}
			if !enabled {
				if envelope.Data.VideoLinks != nil || len(envelope.Data.Entries) != 0 {
					t.Fatal("disabled feed published dynamic videos")
				}
				return
			}
			if envelope.Data.VideoLinks == nil || envelope.Data.VideoLinks.Version != 1 || len(envelope.Data.VideoLinks.Entries) != 1 || len(envelope.Data.Entries) != 1 || envelope.Data.Entries[0].VideoURL != "https://media.goodcase.ai/cases/scene.mp4" {
				t.Fatalf("persisted video mapping was not published: %+v", envelope.Data)
			}
		})
	}
}

func TestOpenAPIInspirationFeedRoutesAndAuthentication(t *testing.T) {
	document := libraryOpenAPIDocument(t)
	for _, test := range []struct {
		path, method string
		public       bool
	}{
		{"/public/inspirations/feed", "get", true},
		{"/admin/settings/inspiration-feed", "get", false},
		{"/admin/settings/inspiration-feed", "patch", false},
		{"/admin/settings/inspiration-feed/sync", "post", false},
	} {
		operation := libraryOpenAPIAt(t, document, "paths", test.path, test.method).(map[string]any)
		libraryOpenAPIAt(t, operation, "responses", "200")
		if test.public {
			security, ok := operation["security"].([]any)
			if !ok || len(security) != 0 {
				t.Fatal("public feed must explicitly allow anonymous reads")
			}
			libraryOpenAPIAt(t, operation, "responses", "429")
		} else {
			libraryOpenAPIAt(t, operation, "responses", "401")
			libraryOpenAPIAt(t, operation, "responses", "403")
			if !strings.Contains(operation["description"].(string), "管理员") {
				t.Errorf("%s %s does not document the admin boundary", test.method, test.path)
			}
		}
	}
	security := libraryOpenAPIAt(t, document, "security").([]any)
	if len(security) != 1 {
		t.Fatal("admin feed operations must inherit session authentication")
	}
	libraryOpenAPIAt(t, security[0], "sessionCookie")
	libraryOpenAPIAt(t, document, "paths", "/admin/settings/inspiration-feed", "patch", "requestBody", "content", "application/json", "schema", "properties", "enabled", "type")
}
