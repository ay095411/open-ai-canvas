package app

import (
	"context"
	"net/url"

	"yingce/backend/internal/inspirations"
	"yingce/backend/internal/model"
)

type (
	InspirationLibraryCandidate    = inspirations.LibraryCandidate
	InspirationLibraryLicense      = inspirations.LibraryLicense
	InspirationLibraryReviewRecord = inspirations.LibraryReviewRecord
	InspirationLibraryReviewPage   = inspirations.LibraryReviewPage
	InspirationLibraryImport       = inspirations.LibraryImport
	InspirationLibraryImportResult = inspirations.LibraryImportResult
	InspirationLibraryReview       = inspirations.LibraryReview
	InspirationLibrarySummary      = inspirations.LibrarySummary
	InspirationLibraryDetail       = inspirations.LibraryDetail
	InspirationLibraryPage         = inspirations.LibraryPage
	InspirationLibraryFacets       = inspirations.LibraryFacets
	InspirationLibraryResolve      = inspirations.LibraryResolve
	InspirationLibraryResolved     = inspirations.LibraryResolved
	InspirationLibraryMediaContent = inspirations.LibraryMediaContent
)

type inspirationLibraryAdminGate struct{ svc *Service }

func (g inspirationLibraryAdminGate) RequireAdmin(actor *model.User) error {
	return g.svc.RequireAdmin(actor)
}

func (g inspirationLibraryAdminGate) NewAudit(actor *model.User, action, slug string, metadata any) (*model.AdminAuditEvent, error) {
	return newAdminAuditEvent(actor, action, "inspiration_library", slug, "维护已核验授权素材目录", metadata)
}

func (s *Service) inspirationLibraryDomain() *inspirations.Library {
	return inspirations.NewLibrary(s.repo, inspirationLibraryAdminGate{s}, s.readInspirationLibraryMedia)
}

func (s *Service) InspirationLibraryPrompts(ctx context.Context, query url.Values) (*InspirationLibraryPage, error) {
	return s.inspirationLibraryDomain().Prompts(ctx, query)
}
func (s *Service) InspirationLibraryPrompt(ctx context.Context, slug string) (*InspirationLibraryDetail, error) {
	return s.inspirationLibraryDomain().Detail(ctx, slug)
}
func (s *Service) InspirationLibraryFacets(ctx context.Context, query url.Values) (*InspirationLibraryFacets, error) {
	return s.inspirationLibraryDomain().Facets(ctx, query)
}
func (s *Service) ResolveInspirationLibrary(ctx context.Context, input InspirationLibraryResolve) (*InspirationLibraryResolved, error) {
	return s.inspirationLibraryDomain().Resolve(ctx, input)
}
func (s *Service) AdminInspirationLibrary(ctx context.Context, actor *model.User, status string, page, limit int) (*InspirationLibraryReviewPage, error) {
	return s.inspirationLibraryDomain().AdminPage(ctx, actor, status, page, limit)
}
func (s *Service) AdminInspirationLibraryDetail(ctx context.Context, actor *model.User, slug string) (*InspirationLibraryReviewRecord, error) {
	return s.inspirationLibraryDomain().AdminDetail(ctx, actor, slug)
}
func (s *Service) ImportInspirationLibrary(ctx context.Context, actor *model.User, input InspirationLibraryImport) (*InspirationLibraryImportResult, error) {
	return s.inspirationLibraryDomain().Import(ctx, actor, input)
}
func (s *Service) ReviewInspirationLibrary(ctx context.Context, actor *model.User, slug string, input InspirationLibraryReview) (*InspirationLibraryReviewRecord, error) {
	return s.inspirationLibraryDomain().Review(ctx, actor, slug, input)
}
func (s *Service) InspirationLibraryMedia(ctx context.Context, slug, kind, hash string, revision int64) (*InspirationLibraryMediaContent, error) {
	return s.inspirationLibraryDomain().Media(ctx, nil, false, slug, kind, hash, revision)
}
func (s *Service) AdminInspirationLibraryMedia(ctx context.Context, actor *model.User, slug, kind, hash string, revision int64) (*InspirationLibraryMediaContent, error) {
	return s.inspirationLibraryDomain().Media(ctx, actor, true, slug, kind, hash, revision)
}
