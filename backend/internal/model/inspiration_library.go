package model

import "time"

// InspirationLibraryEntry publishes only a reviewed, immutable candidate revision.
// Incoming updates replace the current candidate and immediately return it to pending.
type InspirationLibraryEntry struct {
	Slug            string `gorm:"primaryKey;size:191"`
	PayloadJSON     string `gorm:"type:text;not null"`
	ContentHash     string `gorm:"size:64;not null"`
	ImageHash       string `gorm:"size:64;not null"`
	VideoHash       string `gorm:"size:64"`
	ImageResourceID string `gorm:"size:80;index"`
	VideoResourceID string `gorm:"size:80;index"`
	Revision        int64  `gorm:"not null;default:1"`
	Status          string `gorm:"size:16;not null;default:pending;index"`
	Title           string `gorm:"size:500;not null"`
	Mode            string `gorm:"size:16;not null;index"`
	Category        string `gorm:"size:128;index"`
	Model           string `gorm:"size:128;index"`
	Featured        bool   `gorm:"not null;default:false"`
	TagsJSON        string `gorm:"type:text"`
	SearchText      string `gorm:"type:text"`
	ReviewReason    string `gorm:"type:text"`
	ReviewedBy      string `gorm:"size:36"`
	ReviewedAt      *time.Time
	PublishedAt     *time.Time `gorm:"index"`
	CreatedBy       string     `gorm:"size:36;not null"`
	UpdatedBy       string     `gorm:"size:36;not null"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}
