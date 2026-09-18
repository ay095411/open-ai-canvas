package gallery_test

import (
	"testing"

	"infinite-canvas/backend/internal/gallery"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGalleryModule(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}

	repo := gallery.NewRepository(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("failed to automigrate: %v", err)
	}

	svc := gallery.NewService(repo)
	svc.InitDefaultDataIfEmpty()

	count, err := svc.Count()
	if err != nil {
		t.Fatalf("failed to count: %v", err)
	}
	if count != 1528 {
		t.Fatalf("expected 1528 items, got %d", count)
	}

	res, err := svc.ListPrompts(gallery.QueryFilter{
		Page:     1,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("failed to list: %v", err)
	}
	if len(res.Items) != 10 {
		t.Fatalf("expected 10 items, got %d", len(res.Items))
	}
	if res.Total != 1528 {
		t.Fatalf("expected total 1528, got %d", res.Total)
	}

	facets, err := svc.GetFacets()
	if err != nil {
		t.Fatalf("failed to get facets: %v", err)
	}
	if facets.Total != 1528 {
		t.Fatalf("expected facet total 1528, got %d", facets.Total)
	}
	if facets.ByMedia["image"] != 1516 || facets.ByMedia["video"] != 12 {
		t.Fatalf("media counts mismatch: %+v", facets.ByMedia)
	}
}
