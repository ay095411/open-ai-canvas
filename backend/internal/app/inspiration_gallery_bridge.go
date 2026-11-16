package app

import (
	"context"
	"net/url"

	"yingce/backend/internal/inspirations"
)

type (
	InspirationGalleryPage   = inspirations.GalleryPage
	InspirationGalleryEntry  = inspirations.GalleryEntry
	InspirationGalleryDetail = inspirations.GalleryDetail
	InspirationGalleryFacets = inspirations.GalleryFacets
)

func (s *Service) InspirationGalleryPrompts(ctx context.Context, query url.Values) (*InspirationGalleryPage, error) {
	return s.inspirationFeedDomain().GalleryPrompts(ctx, query)
}

func (s *Service) InspirationGalleryPrompt(ctx context.Context, slug string) (*InspirationGalleryDetail, error) {
	return s.inspirationFeedDomain().GalleryPrompt(ctx, slug)
}

func (s *Service) InspirationGalleryFacets(ctx context.Context, query url.Values) (*InspirationGalleryFacets, error) {
	return s.inspirationFeedDomain().GalleryFacets(ctx, query)
}
