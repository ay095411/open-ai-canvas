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
	latest := schemaMigrations[len(schemaMigrations)-1]
	if latest.version != 106 || latest.name != "authorized_inspiration_library" {
		t.Fatal("unexpected latest migration")
	}
	if err := latest.apply(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.InspirationLibraryEntry{}) {
		t.Fatal("review table missing")
	}
	var count int64
	if err := db.Model(&model.InspirationLibraryEntry{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration must not seed or auto-approve: %d %v", count, err)
	}
	if err := latest.apply(db); err != nil {
		t.Fatal("migration not idempotent", err)
	}
}
