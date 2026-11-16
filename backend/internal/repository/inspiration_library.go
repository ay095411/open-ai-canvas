package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrInspirationLibraryConflict = errors.New("授权素材版本已变化，请刷新后重试")

const InspirationLibraryResourceReferenceKind = "授权素材库"

// Import/review and removal use the same ordered resource-row locks on PostgreSQL.
// The deletion path checks references after obtaining these locks.
func (r *Repository) lockInspirationLibraryResourceRows(ids []string) ([]model.Resource, error) {
	rows := []model.Resource{}
	if len(ids) == 0 {
		return rows, nil
	}
	query := r.db.Where("id IN ?", ids).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.Find(&rows).Error
	return rows, err
}

func (r *Repository) LockInspirationLibraryResources(ids []string) error {
	rows, err := r.lockInspirationLibraryResourceRows(ids)
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		if id != "" {
			wanted[id] = true
		}
	}
	if len(rows) != len(wanted) {
		return gorm.ErrRecordNotFound
	}
	for _, row := range rows {
		if row.Provider != "local" || row.Status != model.ResourceStatusReady {
			return ErrInspirationLibraryConflict
		}
	}
	return nil
}

// Pending reviews and published entries retain their review media, across owner scopes.
func (r *Repository) InspirationLibraryResourceReferences(ids []string) ([]ResourceDirectReference, error) {
	result := []ResourceDirectReference{}
	if len(ids) == 0 || !r.db.Migrator().HasTable(&model.InspirationLibraryEntry{}) {
		return result, nil
	}
	var rows []model.InspirationLibraryEntry
	if err := r.db.Select("slug", "title", "image_resource_id", "video_resource_id").Where("status IN ? AND (image_resource_id IN ? OR video_resource_id IN ?)", []string{"pending", "approved"}, ids, ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	for _, row := range rows {
		for _, id := range []string{row.ImageResourceID, row.VideoResourceID} {
			if wanted[id] {
				result = append(result, ResourceDirectReference{Kind: InspirationLibraryResourceReferenceKind, ID: row.Slug, Title: row.Title, ResourceID: id})
			}
		}
	}
	return result, nil
}

func (r *Repository) RequireNoInspirationLibraryReferences(ids []string) error {
	references, err := r.InspirationLibraryResourceReferences(ids)
	if err != nil {
		return err
	}
	if len(references) > 0 {
		return ErrResourceCleanupStillReferenced
	}
	return nil
}

func (r *Repository) InspirationLibraryEntry(slug string) (*model.InspirationLibraryEntry, error) {
	var row model.InspirationLibraryEntry
	err := r.db.Where("slug = ?", slug).First(&row).Error
	return &row, err
}

// PutInspirationLibraryEntry uses CAS for both imported updates and reviews.
// The caller's transaction also contains the corresponding audit event.
func (r *Repository) PutInspirationLibraryEntry(row *model.InspirationLibraryEntry, expected int64) error {
	if expected == 0 {
		result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(row)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInspirationLibraryConflict
		}
		return nil
	}
	result := r.db.Model(&model.InspirationLibraryEntry{}).Where("slug = ? AND revision = ?", row.Slug, expected).Select("*").Omit("slug", "created_at", "created_by").Updates(row)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInspirationLibraryConflict
	}
	return nil
}

func (r *Repository) InspirationLibraryReviewPage(status string, page, limit int) ([]model.InspirationLibraryEntry, int64, error) {
	query := r.db.Model(&model.InspirationLibraryEntry{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := []model.InspirationLibraryEntry{}
	err := query.Order("updated_at DESC, slug ASC").Offset((page - 1) * limit).Limit(limit).Find(&rows).Error
	return rows, total, err
}

type InspirationLibraryFilter struct {
	MediaType, Category, Model, Search string
	Featured                           bool
}

func (r *Repository) approvedLibraryQuery(filter InspirationLibraryFilter) *gorm.DB {
	query := r.db.Model(&model.InspirationLibraryEntry{}).Where("status = ?", "approved")
	if filter.MediaType != "" {
		query = query.Where("mode = ?", filter.MediaType)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.Model != "" {
		query = query.Where("model = ?", filter.Model)
	}
	if filter.Featured {
		query = query.Where("featured = ?", true)
	}
	if filter.Search != "" {
		// Literal substring matching; query text never becomes SQL or LIKE syntax.
		needle := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(filter.Search))
		query = query.Where("LOWER(search_text) LIKE ? ESCAPE '!'", "%"+needle+"%")
	}
	return query
}

func (r *Repository) InspirationLibraryPublishedPage(filter InspirationLibraryFilter, offset, limit int) ([]model.InspirationLibraryEntry, int64, error) {
	query := r.approvedLibraryQuery(filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := []model.InspirationLibraryEntry{}
	err := query.Order("published_at DESC, slug ASC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}

func (r *Repository) InspirationLibraryPublishedRevision() (string, error) {
	rows, err := r.db.Model(&model.InspirationLibraryEntry{}).Select("slug", "revision", "content_hash").Where("status = ?", "approved").Order("slug ASC").Rows()
	if err != nil {
		return "", err
	}
	defer rows.Close()
	digest := sha256.New()
	for rows.Next() {
		var slug, contentHash string
		var revision int64
		if err := rows.Scan(&slug, &revision, &contentHash); err != nil {
			return "", err
		}
		fmt.Fprintf(digest, "%d:%s:%d:%s\n", len(slug), slug, revision, contentHash)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func (r *Repository) InspirationLibraryPublishedIDs(slugs []string) ([]model.InspirationLibraryEntry, error) {
	rows := []model.InspirationLibraryEntry{}
	if len(slugs) == 0 {
		return rows, nil
	}
	err := r.db.Where("status = ? AND slug IN ?", "approved", slugs).Find(&rows).Error
	return rows, err
}

func (r *Repository) InspirationLibraryFacetValues(media string) ([]string, []string, []string, int64, error) {
	filter := InspirationLibraryFilter{MediaType: media}
	var total int64
	categories, models, tags := []string{}, []string{}, []string{}
	if err := r.approvedLibraryQuery(filter).Count(&total).Error; err != nil {
		return nil, nil, nil, 0, err
	}
	if err := r.approvedLibraryQuery(filter).Where("category <> ''").Distinct("category").Order("category").Limit(200).Pluck("category", &categories).Error; err != nil {
		return nil, nil, nil, 0, err
	}
	if err := r.approvedLibraryQuery(filter).Where("model <> ''").Distinct("model").Order("model").Limit(500).Pluck("model", &models).Error; err != nil {
		return nil, nil, nil, 0, err
	}
	rows, err := r.approvedLibraryQuery(filter).Select("tags_json").Order("slug").Rows()
	if err != nil {
		return nil, nil, nil, 0, err
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, nil, nil, 0, err
		}
		var values []string
		if err := json.Unmarshal([]byte(raw), &values); err != nil {
			return nil, nil, nil, 0, err
		}
		for _, value := range values {
			if !seen[value] && len(tags) < 1000 {
				seen[value] = true
				tags = append(tags, value)
			}
		}
	}
	return categories, models, tags, total, rows.Err()
}
