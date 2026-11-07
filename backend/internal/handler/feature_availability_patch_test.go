package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFeatureAvailabilityPatchRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := "feature-" + string(role)
		for _, row := range []any{
			&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive},
			&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close(); _ = sqlDB.Close() })
	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), svc)
	submit := func(body, identity string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPatch, "/api/admin/settings/features", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if identity != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "feature-" + identity + ".test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	for _, body := range []string{`{"ecommerceEnabled":true}`, `{"creditsEnabled":false}`} {
		out := submit(body, string(model.UserRoleAdmin))
		if out.Code != http.StatusOK {
			t.Fatalf("valid patch status=%d: %s", out.Code, out.Body.String())
		}
		var result struct {
			Code int `json:"code"`
			Data struct {
				Features service.PublicFeatureAvailability `json:"features"`
			} `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != 0 || !result.Data.Features.EcommerceEnabled || !result.Data.Features.ShortDramaEnabled || !result.Data.Features.Configured {
			t.Fatalf("PATCH response contract changed: %s", out.Body.String())
		}
	}
	before, err := svc.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	if before.CreditsEnabled {
		t.Fatal("explicit false was ignored")
	}
	for _, tc := range []struct {
		name, body, identity string
		status               int
	}{
		{name: "anonymous", body: `{"ecommerceEnabled":false}`, status: 401},
		{name: "ordinary_user", body: `{"ecommerceEnabled":false}`, identity: string(model.UserRoleUser), status: 403},
		{name: "empty", body: `{}`, status: 400},
		{name: "null", body: `null`, status: 400},
		{name: "unknown", body: `{"ecommerceEnabled":false,"unknown":true}`, status: 400},
		{name: "wrong_case", body: `{"EcommerceEnabled":false}`, status: 400},
		{name: "null_field", body: `{"ecommerceEnabled":null}`, status: 400},
		{name: "number", body: `{"ecommerceEnabled":0}`, status: 400},
		{name: "string", body: `{"ecommerceEnabled":"false"}`, status: 400},
		{name: "duplicate", body: `{"ecommerceEnabled":false,"ecommerceEnabled":true}`, status: 400},
		{name: "trailing_object", body: `{"ecommerceEnabled":false} {}`, status: 400},
		{name: "trailing_null", body: `{"ecommerceEnabled":false} null`, status: 400},
		{name: "truncated", body: `{"ecommerceEnabled":`, status: 400},
		{name: "oversize", body: `{"ecommerceEnabled":false}` + strings.Repeat(" ", 16<<10), status: 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			identity := tc.identity
			if identity == "" && tc.name != "anonymous" {
				identity = string(model.UserRoleAdmin)
			}
			out := submit(tc.body, identity)
			if out.Code != tc.status {
				t.Fatalf("status=%d, want=%d: %s", out.Code, tc.status, out.Body.String())
			}
			after, err := svc.FeatureAvailability()
			if err != nil || *after != *before {
				t.Fatalf("rejected PATCH changed settings: after=%#v err=%v", after, err)
			}
		})
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Count(&audits).Error; err != nil || audits != 2 {
		t.Fatalf("audit count=%d, want=2: %v", audits, err)
	}
}
