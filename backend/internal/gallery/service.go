package gallery

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) EnsureMigrated() error {
	return s.repo.AutoMigrate()
}

func (s *Service) ToDTO(m *GalleryPrompt) GalleryPromptDTO {
	tags := make([]string, 0)
	if strings.TrimSpace(m.Tags) != "" {
		_ = json.Unmarshal([]byte(m.Tags), &tags)
	}
	return GalleryPromptDTO{
		ID:          m.ID,
		Slug:        m.Slug,
		Title:       m.Title,
		Description: m.Description,
		Prompt:      m.Prompt,
		PromptZH:    m.PromptZH,
		Model:       m.Model,
		MediaType:   m.MediaType,
		CoverURL:    m.CoverURL,
		MediaURL:    m.MediaURL,
		MediaWidth:  m.MediaWidth,
		MediaHeight: m.MediaHeight,
		Tags:        tags,
		Featured:    m.Featured,
		IsActive:    m.IsActive,
		SortOrder:   m.SortOrder,
		ViewCount:   m.ViewCount,
		CopyCount:   m.CopyCount,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

type ListResult struct {
	Items []GalleryPromptDTO `json:"items"`
	Total int64              `json:"total"`
	Page  int                `json:"page"`
	Size  int                `json:"pageSize"`
}

func (s *Service) ListPrompts(filter QueryFilter) (*ListResult, error) {
	items, total, err := s.repo.List(filter)
	if err != nil {
		return nil, err
	}
	dtos := make([]GalleryPromptDTO, len(items))
	for i, item := range items {
		dtos[i] = s.ToDTO(&item)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 30
	}
	return &ListResult{
		Items: dtos,
		Total: total,
		Page:  page,
		Size:  pageSize,
	}, nil
}

func (s *Service) GetPromptDetail(slug string) (*GalleryPromptDTO, error) {
	item, err := s.repo.GetBySlug(slug)
	if err != nil {
		return nil, err
	}
	_ = s.repo.IncrementViewCount(item.ID)
	dto := s.ToDTO(item)
	return &dto, nil
}

func (s *Service) RecordCopy(id uint) error {
	return s.repo.IncrementCopyCount(id)
}

func (s *Service) GetFacets() (*FacetsResult, error) {
	return s.repo.GetFacets()
}

// SeedDataRecord 对应原始采集 json 的结构
type SeedDataRecord struct {
	ID          int      `json:"id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Prompt      string   `json:"prompt"`
	PromptZH    string   `json:"prompt_zh"`
	Model       string   `json:"model"`
	MediaType   string   `json:"media_type"`
	CoverURL    string   `json:"cover_url"`
	MediaURL    string   `json:"media_url"`
	MediaWidth  int      `json:"media_width"`
	MediaHeight int      `json:"media_height"`
	Tags        []string `json:"tags"`
	Featured    bool     `json:"featured"`
	ViewCount   int      `json:"view_count"`
	CopyCount   int      `json:"copy_count"`
	PublishedAt int64    `json:"published_at"`
}

// SeedDataFile 顶层结构
type SeedDataFile struct {
	Items []SeedDataRecord `json:"items"`
}

// ImportFromJSONData 将原始 json 数据导入入库（完全忽略 source_name, source_url）
func (s *Service) ImportFromJSONData(rawJSON []byte) (int, error) {
	var records []SeedDataRecord
	if err := json.Unmarshal(rawJSON, &records); err != nil {
		// 尝试解析包含 items 外层的包装结构
		var wrapper SeedDataFile
		if wrapErr := json.Unmarshal(rawJSON, &wrapper); wrapErr != nil {
			return 0, err
		}
		records = wrapper.Items
	}

	items := make([]GalleryPrompt, 0, len(records))
	now := time.Now()

	for _, rec := range records {
		slug := strings.TrimSpace(rec.Slug)
		if slug == "" {
			continue
		}
		tagsBytes, _ := json.Marshal(rec.Tags)
		createdAt := now
		if rec.PublishedAt > 0 {
			createdAt = time.Unix(rec.PublishedAt, 0)
		}
		mediaType := strings.TrimSpace(rec.MediaType)
		if mediaType == "" {
			mediaType = "image"
		}
		items = append(items, GalleryPrompt{
			Slug:        slug,
			Title:       rec.Title,
			Description: rec.Description,
			Prompt:      rec.Prompt,
			PromptZH:    rec.PromptZH,
			Model:       rec.Model,
			MediaType:   mediaType,
			CoverURL:    rec.CoverURL,
			MediaURL:    rec.MediaURL,
			MediaWidth:  rec.MediaWidth,
			MediaHeight: rec.MediaHeight,
			Tags:        string(tagsBytes),
			Featured:    rec.Featured,
			IsActive:    true,
			SortOrder:   0,
			ViewCount:   rec.ViewCount,
			CopyCount:   rec.CopyCount,
			CreatedAt:   createdAt,
			UpdatedAt:   now,
		})
	}

	if err := s.repo.BatchUpsert(items); err != nil {
		return 0, err
	}
	return len(items), nil
}

func (s *Service) Count() (int64, error) {
	return s.repo.Count()
}

// Admin 更新
type UpdatePromptRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Prompt      string   `json:"prompt"`
	PromptZH    string   `json:"prompt_zh"`
	Model       string   `json:"model"`
	MediaType   string   `json:"media_type"`
	Tags        []string `json:"tags"`
	Featured    bool     `json:"featured"`
	IsActive    bool     `json:"is_active"`
	SortOrder   int      `json:"sort_order"`
}

func (s *Service) UpdatePromptByAdmin(actor *model.User, id uint, req UpdatePromptRequest) error {
	item, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	item.Title = req.Title
	item.Description = req.Description
	item.Prompt = req.Prompt
	item.PromptZH = req.PromptZH
	item.Model = req.Model
	item.MediaType = req.MediaType
	tagsBytes, _ := json.Marshal(req.Tags)
	item.Tags = string(tagsBytes)
	item.Featured = req.Featured
	item.IsActive = req.IsActive
	item.SortOrder = req.SortOrder
	item.UpdatedAt = time.Now()
	return s.repo.Save(item)
}

func (s *Service) SetActiveByAdmin(actor *model.User, id uint, isActive bool) error {
	return s.repo.UpdateActive(id, isActive)
}

func (s *Service) DeleteByAdmin(actor *model.User, id uint) error {
	return s.repo.Delete(id)
}
