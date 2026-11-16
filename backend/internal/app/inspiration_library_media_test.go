package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func libraryMediaTestSetup(t *testing.T) (*Service, *gorm.DB, []byte) {
	t.Helper()
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Resource{}, &model.InspirationLibraryEntry{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	svc := &Service{repo: repository.New(db), dataDir: dir}
	var buffer bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	data := buffer.Bytes()
	if err := os.MkdirAll(filepath.Join(dir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "resources", "cover.png"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "cover", UserID: "admin", Provider: "local", Status: model.ResourceStatusReady, Kind: "image", MimeType: "image/png", ObjectKey: "cover.png", Size: int64(len(data))}).Error; err != nil {
		t.Fatal(err)
	}
	return svc, db, data
}

func TestInspirationLibraryMediaReadsActualLocalBytes(t *testing.T) {
	svc, _, data := libraryMediaTestSetup(t)
	content, err := svc.readInspirationLibraryMedia(context.Background(), "resource:cover", "image")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	if content.Hash != hex.EncodeToString(hash[:]) || content.MimeType != "image/png" || !bytes.Equal(content.Data, data) {
		t.Fatal("media hash/content mismatch")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.readInspirationLibraryMedia(ctx, "resource:cover", "image"); err == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestInspirationLibraryMediaRejectsUnsafeResourceAndContent(t *testing.T) {
	for _, test := range []struct {
		name    string
		updates map[string]any
		bytes   []byte
		kind    string
	}{
		{"nonlocal", map[string]any{"provider": "s3"}, nil, "image"},
		{"unready", map[string]any{"status": "pending"}, nil, "image"},
		{"wrong kind", nil, nil, "video"},
		{"traversal", map[string]any{"object_key": "../test.db"}, nil, "image"},
		{"absolute", map[string]any{"object_key": "C:/Windows/win.ini"}, nil, "image"},
		{"declared svg", map[string]any{"mime_type": "image/svg+xml"}, []byte("<svg></svg>"), "image"},
		{"html masquerading", nil, []byte("<html><script>alert(1)</script></html>"), "image"},
		{"mime mismatch", map[string]any{"mime_type": "image/jpeg"}, nil, "image"},
		{"metadata oversize", map[string]any{"size": int64(33 << 20)}, nil, "image"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db, _ := libraryMediaTestSetup(t)
			if len(test.updates) > 0 {
				if err := db.Model(&model.Resource{}).Where("id = ?", "cover").Updates(test.updates).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.bytes != nil {
				if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", "cover.png"), test.bytes, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := svc.readInspirationLibraryMedia(context.Background(), "resource:cover", test.kind); err == nil {
				t.Fatal("unsafe media accepted")
			}
		})
	}
}

func TestInspirationLibraryServiceEndToEndApprovalAndWithdrawal(t *testing.T) {
	svc, _, _ := libraryMediaTestSetup(t)
	ctx := context.Background()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	yes := true
	license := InspirationLibraryLicense{Name: "Direct permission", URL: "https://creator.example/license", Attribution: "Original Creator", Rightsholder: "Original Creator", Evidence: "Signed permission authorizes commercial public display and redistribution", CommercialUse: &yes, Redistribution: &yes}
	candidate := InspirationLibraryCandidate{Slug: "portrait", Title: "Licensed portrait", Prompt: "Exact approved prompt", Image: "resource:cover", Mode: "image", SourceURL: "https://creator.example/work", Author: "Original Creator", PromptLicense: license, MediaLicense: license, MediaReviewed: true}
	if _, err := svc.ImportInspirationLibrary(ctx, admin, InspirationLibraryImport{Items: []InspirationLibraryCandidate{candidate}}); err != nil {
		t.Fatal(err)
	}
	approved, err := svc.ReviewInspirationLibrary(ctx, admin, "portrait", InspirationLibraryReview{Revision: 1, Action: "approve", Reason: "Written permission and media verified"})
	if err != nil {
		t.Fatal(err)
	}
	detail, err := svc.InspirationLibraryPrompt(ctx, "portrait")
	if err != nil || detail.Prompt != candidate.Prompt {
		t.Fatal("public detail unavailable", err)
	}
	if _, err := svc.InspirationLibraryMedia(ctx, "portrait", "image", approved.ImageHash, approved.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReviewInspirationLibrary(ctx, admin, "portrait", InspirationLibraryReview{Revision: approved.Revision, Action: "reject", Reason: "Permission withdrawn"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.InspirationLibraryMedia(ctx, "portrait", "image", approved.ImageHash, approved.Revision); err == nil {
		t.Fatal("withdrawn media served")
	}
}
