package app

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPatchFeatureAvailabilityPreservesOmittedFieldsAndAudits(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	actor := &model.User{ID: "admin-patch", Role: model.UserRoleAdmin}
	want := defaultFeatureAvailability()
	want.EcommerceEnabled, want.CreditsEnabled = true, false
	first, err := svc.PatchFeatureAvailability(actor, FeatureAvailabilityPatch{"ecommerceEnabled": true, "creditsEnabled": false})
	if err != nil {
		t.Fatal(err)
	}
	if first.FeatureAvailability != want || !first.Configured || first.UpdatedBy != actor.ID || first.UpdatedAt.IsZero() {
		t.Fatalf("first patch = %#v, want %#v", first, want)
	}
	want.SiteAssistantEnabled = true
	second, err := svc.PatchFeatureAvailability(actor, FeatureAvailabilityPatch{"siteAssistantEnabled": true})
	if err != nil {
		t.Fatal(err)
	}
	if second.FeatureAvailability != want {
		t.Fatalf("second patch lost omitted fields: %#v, want %#v", second.FeatureAvailability, want)
	}
	var audits []model.AdminAuditEvent
	if err := db.Order("created_at").Find(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if len(audits) != 2 {
		t.Fatalf("audit count = %d, want 2", len(audits))
	}
	before := defaultFeatureAvailability()
	for index, audit := range audits {
		var change struct {
			Before FeatureAvailability `json:"before"`
			After  FeatureAvailability `json:"after"`
		}
		if err := json.Unmarshal([]byte(audit.MetadataJSON), &change); err != nil {
			t.Fatal(err)
		}
		if audit.ActorUserID != actor.ID || audit.Action != "feature_availability.update" || audit.TargetType != "system_setting" || audit.TargetID != featureAvailabilitySettingKey || change.Before != before {
			t.Fatalf("audit %d does not describe committed change: %#v, %#v", index, audit, change)
		}
		before = change.After
	}
	if before != want {
		t.Fatalf("last audit after = %#v, want %#v", before, want)
	}
}

func TestPatchFeatureAvailabilityRejectsUnauthorizedAndInvalidInput(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	for _, tc := range []struct {
		name   string
		actor  *model.User
		patch  FeatureAvailabilityPatch
		status int
	}{
		{name: "anonymous", patch: FeatureAvailabilityPatch{"ecommerceEnabled": true}, status: 401},
		{name: "user", actor: &model.User{ID: "user", Role: model.UserRoleUser}, patch: FeatureAvailabilityPatch{"ecommerceEnabled": true}, status: 403},
		{name: "empty_admin_id", actor: &model.User{Role: model.UserRoleAdmin}, patch: FeatureAvailabilityPatch{"ecommerceEnabled": true}, status: 401},
		{name: "unknown", actor: &model.User{ID: "admin", Role: model.UserRoleAdmin}, patch: FeatureAvailabilityPatch{"unknownEnabled": true}, status: 400},
		{name: "empty", actor: &model.User{ID: "admin", Role: model.UserRoleAdmin}, patch: FeatureAvailabilityPatch{}, status: 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.PatchFeatureAvailability(tc.actor, tc.patch)
			var authErr *AuthError
			if !errors.As(err, &authErr) || authErr.Status != tc.status {
				t.Fatalf("patch error = %v, want status %d", err, tc.status)
			}
		})
	}
	for _, row := range []any{&model.SystemSetting{}, &model.AdminAuditEvent{}} {
		var count int64
		if err := db.Model(row).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("rejected update persisted %T: count=%d, err=%v", row, count, err)
		}
	}
}

func TestPatchFeatureAvailabilityRollsBackWhenAuditFails(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "first_write", true: "existing"}[configured], func(t *testing.T) {
			svc, db := newFeatureAvailabilityTestService(t)
			actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
			if configured {
				if _, err := svc.UpdateFeatureAvailability(actor, defaultFeatureAvailability()); err != nil {
					t.Fatal(err)
				}
			}
			before, err := svc.FeatureAvailability()
			if err != nil {
				t.Fatal(err)
			}
			auditErr := errors.New("audit persistence unavailable")
			if err := db.Callback().Create().Before("gorm:create").Register("test:reject_feature_audit", func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "admin_audit_events" {
					tx.AddError(auditErr)
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Create().Remove("test:reject_feature_audit") })
			if _, err := svc.PatchFeatureAvailability(actor, FeatureAvailabilityPatch{"ecommerceEnabled": true}); !errors.Is(err, auditErr) {
				t.Fatalf("patch error = %v, want audit failure", err)
			}
			after, err := svc.FeatureAvailability()
			if err != nil {
				t.Fatal(err)
			}
			if *after != *before {
				t.Fatalf("audit failure changed setting: before=%#v, after=%#v", before, after)
			}
		})
	}
}

func TestPatchFeatureAvailabilityConcurrentAdministrators(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "first_write", true: "existing"}[configured], func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "feature-patches.db") + "?_journal_mode=WAL&_busy_timeout=5000"
			open := func() (*Service, *gorm.DB) {
				db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
				if err != nil {
					t.Fatal(err)
				}
				sqlDB, err := db.DB()
				if err != nil {
					t.Fatal(err)
				}
				sqlDB.SetMaxOpenConns(1)
				svc := New(repository.New(db), t.TempDir())
				t.Cleanup(func() { _ = svc.Close(); _ = sqlDB.Close() })
				return svc, db
			}
			first, db := open()
			second, _ := open()
			if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
				t.Fatal(err)
			}
			want := defaultFeatureAvailability()
			if configured {
				// A legacy setting must retain its explicit value and fill omitted
				// fields from defaults even when two independent services update it.
				if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"shortDramaEnabled":false}`}).Error; err != nil {
					t.Fatal(err)
				}
				want.ShortDramaEnabled = false
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			for index, svc := range []*Service{first, second} {
				go func() {
					<-start
					keys := []string{"imageWorkbenchEnabled", "ecommerceEnabled"}
					actors := []string{"admin-image", "admin-commerce"}
					_, err := svc.PatchFeatureAvailability(&model.User{ID: actors[index], Role: model.UserRoleAdmin}, FeatureAvailabilityPatch{keys[index]: true})
					results <- err
				}()
			}
			close(start)
			for range 2 {
				if err := <-results; err != nil {
					t.Fatal(err)
				}
			}
			var audits []model.AdminAuditEvent
			if err := db.Order("created_at").Find(&audits).Error; err != nil {
				t.Fatal(err)
			}
			if len(audits) != 2 {
				t.Fatalf("concurrent audit count = %d, want 2", len(audits))
			}
			seenActors := map[string]bool{}
			for _, audit := range audits {
				var change struct{ Before, After FeatureAvailability }
				if err := json.Unmarshal([]byte(audit.MetadataJSON), &change); err != nil {
					t.Fatal(err)
				}
				if change.Before != want {
					t.Fatalf("concurrent audit before is stale: %#v, want %#v", change.Before, want)
				}
				want = change.After
				seenActors[audit.ActorUserID] = true
			}
			setting, err := first.FeatureAvailability()
			if err != nil {
				t.Fatal(err)
			}
			if !setting.ImageWorkbenchEnabled || !setting.EcommerceEnabled || setting.ShortDramaEnabled == configured || setting.FeatureAvailability != want || len(seenActors) != 2 {
				t.Fatalf("concurrent patch lost a committed field: %#v, actors=%v", setting, seenActors)
			}
		})
	}
}
