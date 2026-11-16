package inspirations

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const GallerySourceID = "zzai-gallery"
const galleryOrigin = "https://api.seedance.nz"

// GalleryEntry keeps the aggregator page separate from its claimed original source.
// Model and media remain upstream metadata, not a promise about our available models.
type GalleryEntry struct {
	ID          string     `json:"id"`
	Slug        string     `json:"slug"`
	SourceID    string     `json:"sourceId"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Image       string     `json:"image"`
	Mode        string     `json:"mode"`
	Category    string     `json:"category,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
	Width       int        `json:"width,omitempty"`
	Height      int        `json:"height,omitempty"`
	Ratio       string     `json:"ratio,omitempty"`
	Model       string     `json:"model,omitempty"`
	Featured    bool       `json:"featured"`
	Credit      string     `json:"credit,omitempty"`
	SourceURL   string     `json:"sourceUrl,omitempty"`
	GalleryURL  string     `json:"galleryUrl"`
	VideoURL    string     `json:"videoUrl,omitempty"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

type GalleryDetail struct {
	GalleryEntry
	Prompt            string `json:"prompt"`
	PromptZH          string `json:"promptZh,omitempty"`
	UsageNotes        string `json:"usageNotes,omitempty"`
	RequiresReference bool   `json:"requiresReference,omitempty"`
}

type GalleryPage struct {
	Items      []GalleryEntry `json:"items"`
	Total      int            `json:"total"`
	NextCursor string         `json:"nextCursor,omitempty"`
}

type GalleryFacets struct {
	Categories []string `json:"categories"`
	Models     []string `json:"models"`
	Tags       []string `json:"tags"`
	Total      int      `json:"total"`
}

type galleryUpstreamItem struct {
	Slug              string            `json:"slug"`
	Title             string            `json:"title"`
	TitleTranslations map[string]string `json:"title_translations"`
	Description       string            `json:"description"`
	Category          string            `json:"category"`
	Prompt            string            `json:"prompt"`
	PromptZH          string            `json:"prompt_zh"`
	Model             string            `json:"model"`
	Featured          bool              `json:"featured"`
	MediaType         string            `json:"media_type"`
	CoverURL          string            `json:"cover_url"`
	MediaURL          string            `json:"media_url"`
	MediaWidth        int               `json:"media_width"`
	MediaHeight       int               `json:"media_height"`
	SourceName        string            `json:"source_name"`
	SourceURL         string            `json:"source_url"`
	Tags              []string          `json:"tags"`
	PublishedAt       int64             `json:"published_at"`
	Recipe            *struct {
		Mode         string `json:"mode"`
		Notes        string `json:"notes"`
		Requirements []struct {
			Kind  string `json:"kind"`
			Count int    `json:"count"`
		} `json:"requirements"`
	} `json:"recipe"`
}

func galleryEntry(item galleryUpstreamItem) (GalleryEntry, error) {
	if err := validateGallerySlug(item.Slug); err != nil {
		return GalleryEntry{}, errors.New("invalid upstream gallery slug")
	}
	title := strings.TrimSpace(item.TitleTranslations["zh"])
	if title == "" {
		title = strings.TrimSpace(item.Title)
	}
	image, validImage := httpsURL(item.CoverURL)
	if title == "" || !validImage || (item.MediaType != "image" && item.MediaType != "video") || item.MediaWidth < 0 || item.MediaHeight < 0 || item.MediaWidth > 20000 || item.MediaHeight > 20000 {
		return GalleryEntry{}, errors.New("invalid upstream gallery entry")
	}
	entry := GalleryEntry{
		ID: GallerySourceID + ":" + item.Slug, Slug: item.Slug, SourceID: GallerySourceID,
		Title: clipText(title, 200), Description: clipText(item.Description, 1000), Image: image,
		Mode: item.MediaType, Category: clipText(item.Category, 32), Tags: galleryStrings(item.Tags, 12, 32),
		Width: item.MediaWidth, Height: item.MediaHeight, Model: clipText(item.Model, 128), Featured: item.Featured,
		Credit: clipText(item.SourceName, 120), SourceURL: optionalURL(item.SourceURL),
		GalleryURL: galleryOrigin + "/prompt-gallery/" + url.PathEscape(item.Slug),
	}
	if item.MediaType == "video" {
		entry.VideoURL, _ = httpsURL(item.MediaURL)
	}
	if item.MediaWidth > 0 && item.MediaHeight > 0 {
		divisor := galleryGCD(item.MediaWidth, item.MediaHeight)
		entry.Ratio = fmt.Sprintf("%d:%d", item.MediaWidth/divisor, item.MediaHeight/divisor)
	}
	if item.PublishedAt > 0 && item.PublishedAt <= 253402300799 {
		value := time.Unix(item.PublishedAt, 0).UTC()
		entry.PublishedAt = &value
	}
	return entry, nil
}

func galleryDetail(item galleryUpstreamItem) (GalleryDetail, error) {
	entry, err := galleryEntry(item)
	if err != nil {
		return GalleryDetail{}, err
	}
	prompt, promptZH := strings.TrimSpace(item.Prompt), strings.TrimSpace(item.PromptZH)
	if (prompt == "" && promptZH == "") || len(prompt) > 512<<10 || len(promptZH) > 512<<10 || !utf8.ValidString(prompt) || !utf8.ValidString(promptZH) {
		return GalleryDetail{}, errors.New("invalid upstream gallery prompt")
	}
	detail := GalleryDetail{GalleryEntry: entry, Prompt: prompt, PromptZH: promptZH}
	if prompt == "" {
		detail.Prompt = promptZH
	}
	if item.Recipe != nil {
		detail.UsageNotes = clipText(item.Recipe.Notes, 2000)
		for _, requirement := range item.Recipe.Requirements {
			if requirement.Kind == "image" || requirement.Kind == "video" {
				detail.RequiresReference = true
			}
		}
		if item.Recipe.Mode == "reference" {
			detail.RequiresReference = true
		}
	}
	return detail, nil
}

func galleryStrings(values []string, count, length int) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = clipText(value, length)
		if value != "" && !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
		if len(result) == count {
			break
		}
	}
	return result
}

func galleryGCD(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return max(a, 1)
}
