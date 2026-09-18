package gallery

import (
	"time"
)

// GalleryPrompt 代表提示词画廊中展示的条目
type GalleryPrompt struct {
	ID          uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Slug        string    `gorm:"size:128;uniqueIndex;not null" json:"slug"`
	Title       string    `gorm:"size:256;not null" json:"title"`
	Description string    `gorm:"type:text" json:"description"`
	Prompt      string    `gorm:"type:text" json:"prompt"`
	PromptZH    string    `gorm:"type:text" json:"prompt_zh"`
	Model       string    `gorm:"size:64;index" json:"model"`
	MediaType   string    `gorm:"size:32;index;not null;default:'image'" json:"media_type"`
	CoverURL    string    `gorm:"size:1024;not null" json:"cover_url"`
	MediaURL    string    `gorm:"size:1024;not null" json:"media_url"`
	MediaWidth  int       `gorm:"default:0" json:"media_width"`
	MediaHeight int       `gorm:"default:0" json:"media_height"`
	Tags        string    `gorm:"type:text" json:"tags"` // JSON 或英文逗号分隔存储
	Featured    bool      `gorm:"default:false;index" json:"featured"`
	IsActive    bool      `gorm:"default:true;index" json:"is_active"`
	SortOrder   int       `gorm:"default:0;index" json:"sort_order"`
	ViewCount   int       `gorm:"default:0" json:"view_count"`
	CopyCount   int       `gorm:"default:0" json:"copy_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (GalleryPrompt) TableName() string {
	return "gallery_prompts"
}

// GalleryPromptDTO 返回给前台展示的结构体
type GalleryPromptDTO struct {
	ID          uint      `json:"id"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Prompt      string    `json:"prompt"`
	PromptZH    string    `json:"prompt_zh"`
	Model       string    `json:"model"`
	MediaType   string    `json:"media_type"`
	CoverURL    string    `json:"cover_url"`
	MediaURL    string    `json:"media_url"`
	MediaWidth  int       `json:"media_width"`
	MediaHeight int       `json:"media_height"`
	Tags        []string  `json:"tags"`
	Featured    bool      `json:"featured"`
	IsActive    bool      `json:"is_active"`
	SortOrder   int       `json:"sort_order"`
	ViewCount   int       `json:"view_count"`
	CopyCount   int       `json:"copy_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// FacetsResult 聚合筛选器统计
type FacetsResult struct {
	Total     int64            `json:"total"`
	ByMedia   map[string]int64 `json:"by_media"`
	ByModel   map[string]int64 `json:"by_model"`
	TopTags   []TagCount       `json:"top_tags"`
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}
