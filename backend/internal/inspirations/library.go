package inspirations

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type LibraryAdminGate interface {
	RequireAdmin(*model.User) error
	NewAudit(*model.User, string, string, any) (*model.AdminAuditEvent, error)
}
type LibraryMediaReader func(context.Context, string, string) (*LibraryMediaContent, error)
type Library struct {
	repo  *repository.Repository
	admin LibraryAdminGate
	media LibraryMediaReader
	now   func() time.Time
}

func NewLibrary(repo *repository.Repository, admin LibraryAdminGate, media LibraryMediaReader) *Library {
	return &Library{repo: repo, admin: admin, media: media, now: time.Now}
}
func fmtRevision(value int64) string { return strconv.FormatInt(value, 10) }
func libraryError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("授权素材不存在或当前未发布")
	}
	if errors.Is(err, repository.ErrInspirationLibraryConflict) {
		e := kernel.NewAppError(409, err.Error())
		e.Reason = "library_revision_conflict"
		return e
	}
	return err
}
func (l *Library) requireAdmin(actor *model.User) error {
	if l.admin == nil {
		return kernel.Forbidden("仅管理员可维护授权目录")
	}
	return l.admin.RequireAdmin(actor)
}
func (l *Library) audit(repo *repository.Repository, actor *model.User, action string, row *model.InspirationLibraryEntry) error {
	event, err := l.admin.NewAudit(actor, action, row.Slug, map[string]any{"revision": row.Revision, "contentHash": row.ContentHash, "status": row.Status, "reviewReason": row.ReviewReason})
	if err != nil {
		return err
	}
	if event == nil {
		return errors.New("授权素材审计记录不可用")
	}
	return repo.AppendAdminAudit(event)
}
func (l *Library) readMedia(ctx context.Context, reference, kind string) (*LibraryMediaContent, error) {
	if l.media == nil {
		return nil, kernel.BadAuthRequest("本站已上传媒体校验不可用")
	}
	content, err := l.media(ctx, reference, kind)
	if err != nil {
		return nil, err
	}
	if content == nil || !libraryHashPattern.MatchString(content.Hash) {
		return nil, kernel.BadAuthRequest("本站媒体版本校验失败")
	}
	return content, nil
}
func (l *Library) AdminPage(ctx context.Context, actor *model.User, status string, page, limit int) (*LibraryReviewPage, error) {
	if err := l.requireAdmin(actor); err != nil {
		return nil, err
	}
	if status != "" && status != "pending" && status != "approved" && status != "rejected" {
		return nil, kernel.BadAuthRequest("审核状态无效")
	}
	if page < 1 || page > 1000000 || limit < 1 || limit > 100 {
		return nil, kernel.BadAuthRequest("分页范围无效")
	}
	rows, total, err := l.repo.WithContext(ctx).InspirationLibraryReviewPage(status, page, limit)
	if err != nil {
		return nil, err
	}
	result := &LibraryReviewPage{Items: []LibraryReviewRecord{}, Total: total, Page: page, Limit: limit}
	for index := range rows {
		record, err := libraryRecord(&rows[index])
		if err != nil {
			return nil, err
		}
		result.Items = append(result.Items, record)
	}
	return result, nil
}
func (l *Library) AdminDetail(ctx context.Context, actor *model.User, slug string) (*LibraryReviewRecord, error) {
	if err := l.requireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateGallerySlug(slug); err != nil {
		return nil, err
	}
	row, err := l.repo.WithContext(ctx).InspirationLibraryEntry(slug)
	if err != nil {
		return nil, libraryError(err)
	}
	record, err := libraryRecord(row)
	return &record, err
}

// Import is the repeatable legal-source synchronization boundary, not an external crawler.
// Every candidate is validated before writing; all records and audits commit atomically.
func (l *Library) Import(ctx context.Context, actor *model.User, input LibraryImport) (*LibraryImportResult, error) {
	if err := l.requireAdmin(actor); err != nil {
		return nil, err
	}
	if len(input.Items) < 1 || len(input.Items) > 100 {
		return nil, kernel.BadAuthRequest("每批候选必须为 1 到 100 条")
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > 2<<20 {
		return nil, kernel.BadAuthRequest("候选批次最多 2 MiB")
	}
	rows := make([]model.InspirationLibraryEntry, 0, len(input.Items))
	seen := map[string]bool{}
	for _, candidate := range input.Items {
		candidate, err = normalizeLibraryCandidate(candidate)
		if err != nil {
			return nil, err
		}
		if seen[candidate.Slug] {
			return nil, kernel.BadAuthRequest("候选批次不能包含重复 slug")
		}
		seen[candidate.Slug] = true
		image, err := l.readMedia(ctx, candidate.Image, "image")
		if err != nil {
			return nil, err
		}
		videoHash := ""
		if candidate.VideoURL != "" {
			video, err := l.readMedia(ctx, candidate.VideoURL, "video")
			if err != nil {
				return nil, err
			}
			videoHash = video.Hash
		}
		payload, hash, err := libraryContentHash(candidate, image.Hash, videoHash)
		if err != nil {
			return nil, err
		}
		tags, _ := json.Marshal(candidate.Tags)
		rows = append(rows, model.InspirationLibraryEntry{Slug: candidate.Slug, PayloadJSON: payload, ContentHash: hash, ImageHash: image.Hash, VideoHash: videoHash, Title: candidate.Title, Mode: candidate.Mode, Category: candidate.Category, Model: candidate.Model, Featured: candidate.Featured, TagsJSON: string(tags), SearchText: strings.ToLower(strings.Join([]string{candidate.Title, candidate.Description, candidate.Prompt, candidate.PromptZH, candidate.Author, candidate.Model, candidate.Category, strings.Join(candidate.Tags, " ")}, " "))})
	}
	result := &LibraryImportResult{}
	err = l.repo.WithContext(ctx).Transaction(func(tx *repository.Repository) error {
		resourceIDs := []string{}
		for _, candidate := range input.Items {
			resourceIDs = append(resourceIDs, strings.TrimPrefix(candidate.Image, "resource:"))
			if candidate.VideoURL != "" {
				resourceIDs = append(resourceIDs, strings.TrimPrefix(candidate.VideoURL, "resource:"))
			}
		}
		if err := tx.LockInspirationLibraryResources(resourceIDs); err != nil {
			return err
		}
		for index := range rows {
			row := &rows[index]
			row.ImageResourceID = strings.TrimPrefix(input.Items[index].Image, "resource:")
			row.VideoResourceID = strings.TrimPrefix(input.Items[index].VideoURL, "resource:")
			old, err := tx.InspirationLibraryEntry(row.Slug)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err == nil && old.ContentHash == row.ContentHash {
				result.Unchanged++
				continue
			}
			expected := int64(0)
			now := l.now().UTC()
			row.Revision = 1
			row.Status = "pending"
			row.CreatedBy = actor.ID
			row.UpdatedBy = actor.ID
			row.CreatedAt = now
			row.UpdatedAt = now
			if err == nil {
				expected = old.Revision
				if expected >= 9007199254740991 {
					return repository.ErrInspirationLibraryConflict
				}
				row.Revision = expected + 1
				row.CreatedBy = old.CreatedBy
				row.CreatedAt = old.CreatedAt
				result.Updated++
			} else {
				result.Created++
			}
			if err := tx.PutInspirationLibraryEntry(row, expected); err != nil {
				return err
			}
			if err := l.audit(tx, actor, "inspiration_library.import", row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, libraryError(err)
	}
	return result, nil
}
func (l *Library) Review(ctx context.Context, actor *model.User, slug string, input LibraryReview) (*LibraryReviewRecord, error) {
	if err := l.requireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateGallerySlug(slug); err != nil {
		return nil, err
	}
	if input.Revision < 1 || input.Revision >= 9007199254740991 || (input.Action != "approve" && input.Action != "reject") {
		return nil, kernel.BadAuthRequest("审核操作与版本无效")
	}
	reason, err := libraryText(input.Reason, 2000, true)
	if err != nil {
		return nil, err
	}
	var result LibraryReviewRecord
	err = l.repo.WithContext(ctx).Transaction(func(tx *repository.Repository) error {
		row, err := tx.InspirationLibraryEntry(slug)
		if err != nil {
			return err
		}
		if row.Revision != input.Revision {
			return repository.ErrInspirationLibraryConflict
		}
		if input.Action == "approve" {
			record, err := libraryRecord(row)
			if err != nil {
				return err
			}
			candidate, err := normalizeLibraryCandidate(record.LibraryCandidate)
			if err != nil {
				return err
			}
			resourceIDs := []string{strings.TrimPrefix(candidate.Image, "resource:")}
			if candidate.VideoURL != "" {
				resourceIDs = append(resourceIDs, strings.TrimPrefix(candidate.VideoURL, "resource:"))
			}
			if err := tx.LockInspirationLibraryResources(resourceIDs); err != nil {
				return err
			}
			if err := libraryCanApprove(candidate); err != nil {
				return err
			}
			image, err := l.readMedia(ctx, candidate.Image, "image")
			if err != nil {
				return err
			}
			if image.Hash != row.ImageHash {
				return kernel.BadAuthRequest("封面实际内容已变化，请重新导入后审核")
			}
			if candidate.VideoURL != "" {
				video, err := l.readMedia(ctx, candidate.VideoURL, "video")
				if err != nil {
					return err
				}
				if video.Hash != row.VideoHash {
					return kernel.BadAuthRequest("视频实际内容已变化，请重新导入后审核")
				}
			}
		}
		now := l.now().UTC()
		row.Revision++
		row.UpdatedBy = actor.ID
		row.UpdatedAt = now
		row.ReviewReason = reason
		row.ReviewedBy = actor.ID
		row.ReviewedAt = &now
		row.PublishedAt = nil
		row.Status = "rejected"
		if input.Action == "approve" {
			row.Status = "approved"
			row.PublishedAt = &now
		}
		if err := tx.PutInspirationLibraryEntry(row, input.Revision); err != nil {
			return err
		}
		if err := l.audit(tx, actor, "inspiration_library."+input.Action, row); err != nil {
			return err
		}
		result, err = libraryRecord(row)
		// A damaged candidate must still be retractable; only approval needs a valid payload.
		if err != nil && input.Action == "reject" {
			result = LibraryReviewRecord{LibraryCandidate: LibraryCandidate{Slug: row.Slug}, Revision: row.Revision, Status: row.Status, ReviewReason: row.ReviewReason, ReviewedBy: row.ReviewedBy, ReviewedAt: row.ReviewedAt}
			return nil
		}
		return err
	})
	if err != nil {
		return nil, libraryError(err)
	}
	return &result, nil
}
func (l *Library) Detail(ctx context.Context, slug string) (*LibraryDetail, error) {
	if err := validateGallerySlug(slug); err != nil {
		return nil, err
	}
	row, err := l.repo.WithContext(ctx).InspirationLibraryEntry(slug)
	if err != nil {
		return nil, libraryError(err)
	}
	if row.Status != "approved" {
		return nil, kernel.NotFound("授权素材不存在或当前未发布")
	}
	detail, err := libraryPublished(row)
	if err != nil {
		return nil, kernel.NotFound("授权素材版本暂不可用")
	}
	current, err := l.repo.WithContext(ctx).InspirationLibraryEntry(slug)
	if err != nil || current.Status != "approved" || current.Revision != row.Revision || current.ContentHash != row.ContentHash {
		return nil, kernel.NotFound("授权素材版本已下线")
	}
	return &detail, nil
}
func (l *Library) Prompts(ctx context.Context, input url.Values) (*LibraryPage, error) {
	query, filter, offset, err := libraryQuery(input)
	if err != nil {
		return nil, err
	}
	repo := l.repo.WithContext(ctx)
	version, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	if query.Get("cursor") != "" {
		offset, err = decodeLibraryCursor(query.Get("cursor"), version, query)
		if err != nil {
			return nil, err
		}
	}
	limit, _ := strconv.Atoi(query.Get("limit"))
	rows, total, err := repo.InspirationLibraryPublishedPage(filter, offset, limit)
	if err != nil {
		return nil, err
	}
	page := &LibraryPage{Items: []LibrarySummary{}, Total: total, PolicyVersion: LibraryPolicyVersion}
	for index := range rows {
		detail, err := libraryPublished(&rows[index])
		if err != nil {
			return nil, kernel.NotFound("授权目录版本暂不可用")
		}
		page.Items = append(page.Items, detail.LibrarySummary)
	}
	if int64(offset+len(rows)) < total {
		page.NextCursor = encodeLibraryCursor(version, query, offset+len(rows))
	}
	current, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	if current != version {
		return nil, libraryCursorStale()
	}
	return page, nil
}
func (l *Library) Facets(ctx context.Context, input url.Values) (*LibraryFacets, error) {
	media, err := libraryFacetQuery(input)
	if err != nil {
		return nil, err
	}
	repo := l.repo.WithContext(ctx)
	version, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	categories, models, tags, total, err := repo.InspirationLibraryFacetValues(media)
	if err != nil {
		return nil, err
	}
	current, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	if current != version {
		return nil, libraryCursorStale()
	}
	return &LibraryFacets{Categories: categories, Models: models, Tags: tags, Total: total, PolicyVersion: LibraryPolicyVersion}, nil
}
func (l *Library) Resolve(ctx context.Context, input LibraryResolve) (*LibraryResolved, error) {
	if input.IDs == nil || len(input.IDs) > 100 {
		return nil, kernel.BadAuthRequest("收藏解析必须提交 ids，最多 100 项")
	}
	slugs := []string{}
	seen := map[string]bool{}
	for _, id := range input.IDs {
		if len(id) > 220 || id == "" {
			return nil, kernel.BadAuthRequest("收藏 ID 无效")
		}
		if !strings.HasPrefix(id, LibrarySourceID+":") {
			continue
		}
		slug := strings.TrimPrefix(id, LibrarySourceID+":")
		if err := validateGallerySlug(slug); err != nil {
			return nil, err
		}
		if !seen[slug] {
			seen[slug] = true
			slugs = append(slugs, slug)
		}
	}
	repo := l.repo.WithContext(ctx)
	version, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	rows, err := repo.InspirationLibraryPublishedIDs(slugs)
	if err != nil {
		return nil, err
	}
	entries := map[string]LibrarySummary{}
	for index := range rows {
		detail, err := libraryPublished(&rows[index])
		if err != nil {
			return nil, kernel.NotFound("授权素材版本暂不可用")
		}
		entries[rows[index].Slug] = detail.LibrarySummary
	}
	result := &LibraryResolved{Items: []LibrarySummary{}, PolicyVersion: LibraryPolicyVersion}
	for _, slug := range slugs {
		if entry, ok := entries[slug]; ok {
			result.Items = append(result.Items, entry)
		}
	}
	current, err := repo.InspirationLibraryPublishedRevision()
	if err != nil {
		return nil, err
	}
	if current != version {
		return nil, libraryCursorStale()
	}
	return result, nil
}
func (l *Library) Media(ctx context.Context, actor *model.User, admin bool, slug, kind, hash string, revision int64) (*LibraryMediaContent, error) {
	if admin {
		if err := l.requireAdmin(actor); err != nil {
			return nil, err
		}
	}
	if err := validateGallerySlug(slug); err != nil {
		return nil, err
	}
	if (kind != "image" && kind != "video") || !libraryHashPattern.MatchString(hash) || revision < 1 {
		return nil, kernel.BadAuthRequest("媒体版本参数无效")
	}
	repo := l.repo.WithContext(ctx)
	row, err := repo.InspirationLibraryEntry(slug)
	if err != nil {
		return nil, libraryError(err)
	}
	if (!admin && row.Status != "approved") || row.Revision != revision {
		return nil, kernel.NotFound("授权媒体不存在或版本已下线")
	}
	if !admin {
		if _, err := libraryPublished(row); err != nil {
			return nil, kernel.NotFound("授权媒体版本暂不可用")
		}
	}
	record, err := libraryRecord(row)
	if err != nil {
		return nil, err
	}
	reference, expected := record.Image, row.ImageHash
	if kind == "video" {
		reference, expected = record.VideoURL, row.VideoHash
	}
	if reference == "" || hash != expected {
		return nil, kernel.NotFound("授权媒体版本不匹配")
	}
	content, err := l.readMedia(ctx, reference, kind)
	if err != nil {
		return nil, err
	}
	if content.Hash != expected {
		return nil, kernel.NotFound("媒体实际内容已变化，审核版本已隔离")
	}
	current, err := repo.InspirationLibraryEntry(slug)
	if err != nil {
		return nil, libraryError(err)
	}
	if current.Revision != revision || (!admin && current.Status != "approved") {
		return nil, kernel.NotFound("授权媒体版本已下线")
	}
	return content, nil
}
