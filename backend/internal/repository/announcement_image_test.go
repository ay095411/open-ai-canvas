package repository

import (
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func announcementImageDeletionFixture(t *testing.T) (*Repository, *gorm.DB, *model.Resource, *model.Announcement) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Resource{}, &model.InspirationLibraryEntry{}, &model.Announcement{}, &model.UserAnnouncementRead{}, &model.AnnouncementImageDraft{}, &model.ArkPrivateAssetBinding{}, &model.ResourceDeletionJob{}); err != nil {
		t.Fatal(err)
	}
	old := &model.Resource{ID: "old-image", UserID: "admin", Kind: "image", Provider: "local", Status: model.ResourceStatusReady}
	announcement := &model.Announcement{ID: "notice", Title: "Original", ImageResourceID: old.ID, CreatedBy: old.UserID}
	for _, value := range []any{
		old,
		&model.Resource{ID: "new-image", UserID: "admin", Kind: "image", Provider: "local", Status: model.ResourceStatusReady},
		announcement,
		&model.UserAnnouncementRead{UserID: "reader", AnnouncementID: announcement.ID},
		&model.AnnouncementImageDraft{ResourceID: "old-image", UserID: "admin"},
		&model.AnnouncementImageDraft{ResourceID: "new-image", UserID: "admin"},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	return New(db), db, old, announcement
}

func TestAnnouncementImageDeletionRechecksLibraryReferences(t *testing.T) {
	for _, operation := range []string{"replace", "discard"} {
		for _, status := range []string{"pending", "approved", "rejected", ""} {
			t.Run(operation+"/"+status, func(t *testing.T) {
				repo, db, old, announcement := announcementImageDeletionFixture(t)
				if operation == "discard" {
					if err := db.Model(announcement).Update("image_resource_id", "").Error; err != nil {
						t.Fatal(err)
					}
				}
				// Model the reference arriving after the service's earlier snapshot.
				if status != "" {
					if err := db.Create(&model.InspirationLibraryEntry{Slug: "licensed", Status: status, ImageResourceID: old.ID}).Error; err != nil {
						t.Fatal(err)
					}
				}
				job := &model.ResourceDeletionJob{ID: "delete-image", ResourceID: old.ID, UserID: old.UserID}
				var err error
				if operation == "replace" {
					announcement.Title = "Updated"
					announcement.ImageResourceID = "new-image"
					err = repo.UpdateAnnouncementWithImage(announcement, "admin", "new-image", old, job)
				} else {
					err = repo.DiscardAnnouncementImageDraft("admin", old, job)
				}
				blocked := status == "pending" || status == "approved"
				if blocked && !errors.Is(err, ErrResourceCleanupStillReferenced) {
					t.Errorf("referenced image deletion error = %v", err)
				}
				if !blocked && err != nil {
					t.Fatalf("unreferenced image deletion failed: %v", err)
				}
				wantResource, wantJobs := int64(0), int64(1)
				if blocked {
					wantResource, wantJobs = 1, 0
				}
				var resources, jobs int64
				if err := db.Model(&model.Resource{}).Where("id = ?", old.ID).Count(&resources).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.ResourceDeletionJob{}).Count(&jobs).Error; err != nil {
					t.Fatal(err)
				}
				if resources != wantResource || jobs != wantJobs {
					t.Errorf("resources/jobs = %d/%d, want %d/%d", resources, jobs, wantResource, wantJobs)
				}
				draftID := "old-image"
				if operation == "replace" {
					draftID = "new-image"
					var current model.Announcement
					if err := db.First(&current, "id = ?", announcement.ID).Error; err != nil {
						t.Fatal(err)
					}
					if blocked && (current.Title != "Original" || current.ImageResourceID != old.ID) {
						t.Error("blocked replacement changed the announcement")
					}
					var reads int64
					if err := db.Model(&model.UserAnnouncementRead{}).Count(&reads).Error; err != nil {
						t.Fatal(err)
					}
					if reads != wantResource {
						t.Errorf("read receipts = %d, want %d", reads, wantResource)
					}
				}
				var drafts int64
				if err := db.Model(&model.AnnouncementImageDraft{}).Where("resource_id = ?", draftID).Count(&drafts).Error; err != nil {
					t.Fatal(err)
				}
				if drafts != wantResource {
					t.Errorf("draft count = %d, want %d", drafts, wantResource)
				}
			})
		}
	}
}

func TestAnnouncementImageUpdateWithoutResourceDeletion(t *testing.T) {
	repo, db, old, announcement := announcementImageDeletionFixture(t)
	if err := db.Create(&model.InspirationLibraryEntry{Slug: "licensed", Status: "approved", ImageResourceID: old.ID}).Error; err != nil {
		t.Fatal(err)
	}
	announcement.Title = "Updated"
	if err := repo.UpdateAnnouncementWithImage(announcement, "admin", "", nil, nil); err != nil {
		t.Fatalf("metadata-only update must not block on retained image: %v", err)
	}
	if _, err := repo.Resource(old.ID); err != nil {
		t.Fatal("metadata-only update deleted the image", err)
	}
}

func TestAnnouncementImageDeletionMissingResourceIsAtomic(t *testing.T) {
	for _, operation := range []string{"replace", "discard"} {
		t.Run(operation, func(t *testing.T) {
			repo, db, old, announcement := announcementImageDeletionFixture(t)
			if err := db.Delete(&model.Resource{}, "id = ?", old.ID).Error; err != nil {
				t.Fatal(err)
			}
			job := &model.ResourceDeletionJob{ID: "delete-image", ResourceID: old.ID, UserID: old.UserID}
			var err error
			draftID := old.ID
			if operation == "replace" {
				announcement.ImageResourceID = "new-image"
				err = repo.UpdateAnnouncementWithImage(announcement, "admin", "new-image", old, job)
				draftID = "new-image"
			} else {
				if err := db.Model(announcement).Update("image_resource_id", "").Error; err != nil {
					t.Fatal(err)
				}
				err = repo.DiscardAnnouncementImageDraft("admin", old, job)
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("missing resource error = %v", err)
			}
			var drafts, jobs int64
			if err := db.Model(&model.AnnouncementImageDraft{}).Where("resource_id = ?", draftID).Count(&drafts).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ResourceDeletionJob{}).Count(&jobs).Error; err != nil {
				t.Fatal(err)
			}
			if drafts != 1 || jobs != 0 {
				t.Fatalf("missing resource changed draft/jobs = %d/%d", drafts, jobs)
			}
		})
	}
}
