package gallery

import (
	"encoding/json"
	"strings"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) AutoMigrate() error {
	return r.db.AutoMigrate(&GalleryPrompt{})
}

func (r *Repository) Count() (int64, error) {
	var count int64
	err := r.db.Model(&GalleryPrompt{}).Count(&count).Error
	return count, err
}

type QueryFilter struct {
	MediaType string
	Model     string
	Tag       string
	Keyword   string
	Featured  *bool
	OnlyActive bool
	Page      int
	PageSize  int
}

func (r *Repository) List(f QueryFilter) ([]GalleryPrompt, int64, error) {
	q := r.db.Model(&GalleryPrompt{})

	if f.OnlyActive {
		q = q.Where("is_active = ?", true)
	}
	if f.MediaType != "" && f.MediaType != "all" {
		q = q.Where("media_type = ?", f.MediaType)
	}
	if f.Model != "" && f.Model != "all" {
		q = q.Where("model = ?", f.Model)
	}
	if f.Tag != "" {
		// SQLite / PG 兼容的子串搜索
		q = q.Where("tags LIKE ?", "%\""+f.Tag+"\"%")
	}
	if f.Keyword != "" {
		like := "%" + f.Keyword + "%"
		q = q.Where("title LIKE ? OR description LIKE ? OR prompt LIKE ? OR prompt_zh LIKE ?", like, like, like, like)
	}
	if f.Featured != nil {
		q = q.Where("featured = ?", *f.Featured)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	page := f.Page
	if page < 1 {
		page = 1
	}
	pageSize := f.PageSize
	if pageSize < 1 || pageSize > 100 {
		pageSize = 30
	}
	offset := (page - 1) * pageSize

	var list []GalleryPrompt
	err := q.Order("sort_order DESC, id DESC").Limit(pageSize).Offset(offset).Find(&list).Error
	return list, total, err
}

func (r *Repository) GetBySlug(slug string) (*GalleryPrompt, error) {
	var item GalleryPrompt
	err := r.db.Where("slug = ?", slug).First(&item).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) GetByID(id uint) (*GalleryPrompt, error) {
	var item GalleryPrompt
	err := r.db.First(&item, id).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) IncrementCopyCount(id uint) error {
	return r.db.Model(&GalleryPrompt{}).Where("id = ?", id).UpdateColumn("copy_count", gorm.Expr("copy_count + 1")).Error
}

func (r *Repository) IncrementViewCount(id uint) error {
	return r.db.Model(&GalleryPrompt{}).Where("id = ?", id).UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

func (r *Repository) Save(item *GalleryPrompt) error {
	return r.db.Save(item).Error
}

func (r *Repository) UpdateActive(id uint, isActive bool) error {
	return r.db.Model(&GalleryPrompt{}).Where("id = ?", id).Update("is_active", isActive).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&GalleryPrompt{}, id).Error
}

func (r *Repository) BatchUpsert(items []GalleryPrompt) error {
	if len(items) == 0 {
		return nil
	}
	// 分批写入，每批 200 条，避免参数超限
	batchSize := 200
	for i := 0; i < len(items); i += batchSize {
		end := i + batchSize
		if end > len(items) {
			end = len(items)
		}
		batch := items[i:end]
		if err := r.db.Save(&batch).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) GetFacets() (*FacetsResult, error) {
	var total int64
	if err := r.db.Model(&GalleryPrompt{}).Where("is_active = ?", true).Count(&total).Error; err != nil {
		return nil, err
	}

	type CountRow struct {
		Key   string `gorm:"column:k"`
		Count int64  `gorm:"column:c"`
	}

	byMedia := make(map[string]int64)
	var mediaRows []CountRow
	if err := r.db.Model(&GalleryPrompt{}).Select("media_type as k, count(*) as c").Where("is_active = ?", true).Group("media_type").Scan(&mediaRows).Error; err == nil {
		for _, row := range mediaRows {
			byMedia[row.Key] = row.Count
		}
	}

	byModel := make(map[string]int64)
	var modelRows []CountRow
	if err := r.db.Model(&GalleryPrompt{}).Select("model as k, count(*) as c").Where("is_active = ?", true).Group("model").Scan(&modelRows).Error; err == nil {
		for _, row := range modelRows {
			if strings.TrimSpace(row.Key) != "" {
				byModel[row.Key] = row.Count
			}
		}
	}

	// 聚合标签（从已有数据统计）
	var tagRows []struct {
		Tags string `gorm:"column:tags"`
	}
	tagCountMap := make(map[string]int64)
	if err := r.db.Model(&GalleryPrompt{}).Select("tags").Where("is_active = ? AND tags != '' AND tags != '[]'", true).Find(&tagRows).Error; err == nil {
		for _, r := range tagRows {
			var parsed []string
			if err := json.Unmarshal([]byte(r.Tags), &parsed); err == nil {
				for _, t := range parsed {
					t = strings.TrimSpace(t)
					if t != "" {
						tagCountMap[t]++
					}
				}
			}
		}
	}

	topTags := make([]TagCount, 0, len(tagCountMap))
	for t, c := range tagCountMap {
		topTags = append(topTags, TagCount{Tag: t, Count: c})
	}

	return &FacetsResult{
		Total:   total,
		ByMedia: byMedia,
		ByModel: byModel,
		TopTags: topTags,
	}, nil
}
