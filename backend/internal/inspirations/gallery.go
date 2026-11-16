package inspirations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/platform"
)

const (
	galleryTimeout          = 20 * time.Second
	galleryMaxResponseBytes = 4 << 20
	galleryCacheTTL         = 2 * time.Minute
)

// Gallery is a read-only adapter, deliberately independent from the licensed,
// Chinese-only feed. It never imports upstream content into the database.
type Gallery struct {
	client   *http.Client
	validate func(string) (*url.URL, error)
	cache    *platform.BoundedReadCache[string, []byte]
}

func NewGallery() *Gallery {
	return &Gallery{
		client: outbound.OutboundHTTPClient(galleryTimeout), validate: outbound.ValidateOutboundURL,
		cache: platform.NewBoundedReadCache[string, []byte](128, 16<<20, 8, galleryCacheTTL),
	}
}

func (s *Service) GalleryPrompts(ctx context.Context, query url.Values) (*GalleryPage, error) {
	return s.gallery.Prompts(ctx, query)
}

func (s *Service) GalleryPrompt(ctx context.Context, slug string) (*GalleryDetail, error) {
	return s.gallery.Prompt(ctx, slug)
}

func (s *Service) GalleryFacets(ctx context.Context, query url.Values) (*GalleryFacets, error) {
	return s.gallery.Facets(ctx, query)
}

func (g *Gallery) Prompts(ctx context.Context, input url.Values) (*GalleryPage, error) {
	query, err := galleryQuery(input, false)
	if err != nil {
		return nil, err
	}
	data, err := g.read(ctx, "/api/prompt-gallery/v1/prompts?"+query.Encode(), func(data json.RawMessage) (any, error) {
		var upstream struct {
			Items      []galleryUpstreamItem `json:"items"`
			Total      *int                  `json:"total"`
			NextCursor string                `json:"next_cursor"`
		}
		if err := json.Unmarshal(data, &upstream); err != nil {
			return nil, err
		}
		if upstream.Total == nil || *upstream.Total < 0 || upstream.Items == nil || len(upstream.Items) > 50 || len(upstream.NextCursor) > 2048 {
			return nil, errors.New("invalid upstream gallery list")
		}
		if upstream.NextCursor != "" && !galleryCursorPattern.MatchString(upstream.NextCursor) {
			return nil, errors.New("invalid upstream gallery cursor")
		}
		page := GalleryPage{Items: []GalleryEntry{}, Total: *upstream.Total, NextCursor: upstream.NextCursor}
		for _, item := range upstream.Items {
			entry, err := galleryEntry(item)
			if err != nil {
				return nil, err
			}
			page.Items = append(page.Items, entry)
		}
		return page, nil
	})
	if err != nil {
		return nil, err
	}
	var page GalleryPage
	if err := json.Unmarshal(data, &page); err != nil {
		return nil, galleryReadError(err)
	}
	return &page, nil
}

func (g *Gallery) Prompt(ctx context.Context, slug string) (*GalleryDetail, error) {
	if err := validateGallerySlug(slug); err != nil {
		return nil, err
	}
	data, err := g.read(ctx, "/api/prompt-gallery/v1/prompts/"+url.PathEscape(slug), func(data json.RawMessage) (any, error) {
		var item galleryUpstreamItem
		if err := json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		if item.Slug != slug {
			return nil, errors.New("upstream gallery slug does not match request")
		}
		return galleryDetail(item)
	})
	if err != nil {
		return nil, err
	}
	var detail GalleryDetail
	if err := json.Unmarshal(data, &detail); err != nil {
		return nil, galleryReadError(err)
	}
	return &detail, nil
}

func (g *Gallery) Facets(ctx context.Context, input url.Values) (*GalleryFacets, error) {
	query, err := galleryQuery(input, true)
	if err != nil {
		return nil, err
	}
	data, err := g.read(ctx, "/api/prompt-gallery/v1/facets?"+query.Encode(), func(data json.RawMessage) (any, error) {
		var upstream struct {
			Categories []string `json:"categories"`
			Models     []string `json:"models"`
			Tags       []string `json:"tags"`
			Total      *int     `json:"total"`
		}
		if err := json.Unmarshal(data, &upstream); err != nil {
			return nil, err
		}
		if upstream.Total == nil || *upstream.Total < 0 || upstream.Categories == nil || upstream.Models == nil || upstream.Tags == nil || len(upstream.Categories) > 200 || len(upstream.Models) > 500 || len(upstream.Tags) > 1000 {
			return nil, errors.New("invalid upstream gallery facets")
		}
		return GalleryFacets{
			Categories: galleryStrings(upstream.Categories, 200, 32), Models: galleryStrings(upstream.Models, 500, 128),
			Tags: galleryStrings(upstream.Tags, 1000, 32), Total: *upstream.Total,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	var facets GalleryFacets
	if err := json.Unmarshal(data, &facets); err != nil {
		return nil, galleryReadError(err)
	}
	return &facets, nil
}

func (g *Gallery) read(ctx context.Context, path string, normalize func(json.RawMessage) (any, error)) ([]byte, error) {
	data, err := g.cache.Get(ctx, path, func(ctx context.Context) ([]byte, int, error) {
		body, err := g.fetch(ctx, path)
		if err != nil {
			return nil, 0, err
		}
		var envelope struct {
			Success bool            `json:"success"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			return nil, 0, galleryReadError(err)
		}
		if !envelope.Success || len(envelope.Data) == 0 || bytes.Equal(bytes.TrimSpace(envelope.Data), []byte("null")) {
			return nil, 0, galleryReadError(errors.New("upstream gallery reported failure"))
		}
		value, err := normalize(envelope.Data)
		if err != nil {
			return nil, 0, galleryReadError(err)
		}
		data, err := json.Marshal(value)
		if err != nil {
			return nil, 0, galleryReadError(err)
		}
		return data, len(data), nil
	})
	if errors.Is(err, platform.ErrReadCacheBusy) {
		return nil, kernel.WrapAppError(http.StatusServiceUnavailable, "外部画廊请求较多，请稍后重试", err)
	}
	return data, err
}

func (g *Gallery) fetch(ctx context.Context, path string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, galleryTimeout)
	defer cancel()
	// Only internally constructed paths and normalized query values reach this boundary.
	target, err := g.validate(galleryOrigin + path)
	if err != nil {
		return nil, galleryReadError(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, galleryReadError(err)
	}
	outbound.ApplyDefaultOutboundHeaders(request)
	request.Header.Set("Accept", "application/json")
	response, err := g.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, galleryReadError(ctx.Err())
		}
		return nil, galleryReadError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusNotFound {
			return nil, kernel.NotFound("外部画廊条目不存在或已下架")
		}
		return nil, galleryReadError(fmt.Errorf("upstream gallery status %d", response.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, galleryMaxResponseBytes+1))
	if err != nil {
		return nil, galleryReadError(err)
	}
	if len(data) > galleryMaxResponseBytes {
		return nil, galleryReadError(errors.New("upstream gallery response exceeds limit"))
	}
	return data, nil
}

func galleryReadError(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return kernel.WrapAppError(http.StatusGatewayTimeout, "外部画廊响应超时，请稍后重试", err)
	}
	return kernel.WrapAppError(http.StatusBadGateway, "外部画廊暂时不可用，请稍后重试", err)
}
