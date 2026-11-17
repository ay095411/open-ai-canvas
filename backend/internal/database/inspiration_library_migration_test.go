package database

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestAuthorizedInspirationLibraryMigrationCreatesEmptyReviewTable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	var target migration
	for _, item := range schemaMigrations {
		if item.version == 106 {
			target = item
			break
		}
	}
	if target.version != 106 || target.name != "authorized_inspiration_library" || target.checksum != "sha256:authorized-inspiration-library-v106" || target.apply == nil {
		t.Fatalf("missing or changed authorized inspiration migration: version=%d name=%q checksum=%q", target.version, target.name, target.checksum)
	}
	if err := target.apply(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.InspirationLibraryEntry{}) {
		t.Fatal("review table missing")
	}
	var count int64
	if err := db.Model(&model.InspirationLibraryEntry{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration must not seed or auto-approve: %d %v", count, err)
	}
	if err := target.apply(db); err != nil {
		t.Fatal("migration not idempotent", err)
	}
}
