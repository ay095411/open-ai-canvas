package inspirations

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

var gallerySlugPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$`)
var galleryCursorPattern = regexp.MustCompile(`^[A-Za-z0-9_+/=-]+$`)

func galleryQuery(input url.Values, facets bool) (url.Values, error) {
	limits := map[string]int{"media_type": 5}
	if !facets {
		limits = map[string]int{
			"media_type": 5, "category": 32, "search": 200, "model": 128, "tag": 32,
			"sort": 16, "seed": 10, "cursor": 2048, "limit": 2,
		}
	}
	query := url.Values{}
	for key, values := range input {
		limit, allowed := limits[key]
		if !allowed || len(values) != 1 {
			return nil, kernel.BadAuthRequest("画廊查询包含未知或重复参数")
		}
		value := strings.TrimSpace(values[0])
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return nil, kernel.BadAuthRequest("画廊查询参数格式无效：" + key)
		}
		if value != "" {
			query.Set(key, value)
		}
	}
	switch query.Get("media_type") {
	case "", "all":
		query.Del("media_type")
	case "image", "video":
	default:
		return nil, kernel.BadAuthRequest("画廊 media_type 只支持 image、video 或 all")
	}
	if facets {
		return query, nil
	}
	limit := 20
	if value := query.Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 50 {
			return nil, kernel.BadAuthRequest("画廊 limit 必须为 1 到 50 的整数")
		}
		limit = parsed
	}
	query.Set("limit", strconv.Itoa(limit))
	if query.Get("sort") == "" {
		query.Set("sort", "latest")
		if query.Get("search") != "" {
			query.Set("sort", "relevance")
		}
	}
	switch query.Get("sort") {
	case "latest", "popular", "featured", "random", "relevance":
	default:
		return nil, kernel.BadAuthRequest("画廊 sort 无效")
	}
	if seed := query.Get("seed"); seed != "" {
		value, err := strconv.ParseInt(seed, 10, 64)
		if err != nil || value < 1 || value > 2147483646 || query.Get("sort") != "random" {
			return nil, kernel.BadAuthRequest("画廊 seed 仅用于 random，须为 1 到 2147483646 的整数")
		}
		query.Set("seed", strconv.FormatInt(value, 10))
	}
	if cursor := query.Get("cursor"); cursor != "" && !galleryCursorPattern.MatchString(cursor) {
		return nil, kernel.BadAuthRequest("画廊 cursor 无效")
	}
	return query, nil
}

func validateGallerySlug(slug string) error {
	if !gallerySlugPattern.MatchString(slug) || slug == "." || slug == ".." {
		return kernel.BadAuthRequest("画廊条目标识无效")
	}
	return nil
}
