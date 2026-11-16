package inspirations

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/repository"
)

type libraryCursor struct {
	Version string `json:"v"`
	Filter  string `json:"f"`
	Offset  int    `json:"o"`
}

func libraryCursorStale() error {
	err := kernel.NewAppError(409, "授权目录或筛选已变化，请从首页重新加载")
	err.Reason = "library_cursor_stale"
	return err
}
func libraryFilterHash(query url.Values) string {
	copy := url.Values{}
	for key, values := range query {
		if key != "cursor" {
			copy[key] = values
		}
	}
	hash := sha256.Sum256([]byte(copy.Encode()))
	return hex.EncodeToString(hash[:])
}
func encodeLibraryCursor(version string, query url.Values, offset int) string {
	data, _ := json.Marshal(libraryCursor{version, libraryFilterHash(query), offset})
	return base64.RawURLEncoding.EncodeToString(data)
}
func decodeLibraryCursor(raw, version string, query url.Values) (int, error) {
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, kernel.BadAuthRequest("授权目录游标无效")
	}
	var cursor libraryCursor
	if err := json.Unmarshal(data, &cursor); err != nil || cursor.Offset < 0 || cursor.Offset > 100000000 || !libraryHashPattern.MatchString(cursor.Version) || !libraryHashPattern.MatchString(cursor.Filter) {
		return 0, kernel.BadAuthRequest("授权目录游标无效")
	}
	if cursor.Version != version || cursor.Filter != libraryFilterHash(query) {
		return 0, libraryCursorStale()
	}
	return cursor.Offset, nil
}
func libraryQuery(input url.Values) (url.Values, repository.InspirationLibraryFilter, int, error) {
	query := url.Values{}
	filter := repository.InspirationLibraryFilter{}
	limits := map[string]int{"media_type": 5, "category": 128, "model": 128, "search": 200, "sort": 16, "limit": 3, "cursor": 2048}
	for key, values := range input {
		limit, ok := limits[key]
		if !ok || len(values) != 1 {
			return nil, filter, 0, kernel.BadAuthRequest("授权目录包含未知或重复筛选参数")
		}
		value := strings.TrimSpace(values[0])
		if !utf8.ValidString(values[0]) || utf8.RuneCountInString(value) > limit || strings.IndexFunc(values[0], unicode.IsControl) >= 0 {
			return nil, filter, 0, kernel.BadAuthRequest("授权目录筛选参数无效")
		}
		if value != "" {
			query.Set(key, value)
		}
	}
	if query.Get("media_type") == "all" {
		query.Del("media_type")
	}
	if media := query.Get("media_type"); media != "" && media != "image" && media != "video" {
		return nil, filter, 0, kernel.BadAuthRequest("媒体筛选无效")
	}
	if query.Get("sort") == "" {
		query.Set("sort", "latest")
	}
	if query.Get("sort") != "latest" && query.Get("sort") != "featured" {
		return nil, filter, 0, kernel.BadAuthRequest("排序只支持 latest 或 featured")
	}
	limit := 20
	if value := query.Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 50 {
			return nil, filter, 0, kernel.BadAuthRequest("列表 limit 必须为 1 到 50")
		}
		limit = parsed
	}
	query.Set("limit", strconv.Itoa(limit))
	filter = repository.InspirationLibraryFilter{MediaType: query.Get("media_type"), Category: query.Get("category"), Model: query.Get("model"), Search: query.Get("search"), Featured: query.Get("sort") == "featured"}
	return query, filter, 0, nil
}
func libraryFacetQuery(input url.Values) (string, error) {
	for key, values := range input {
		if key != "media_type" || len(values) != 1 {
			return "", kernel.BadAuthRequest("分类只接受 media_type")
		}
	}
	media := strings.TrimSpace(input.Get("media_type"))
	if media == "all" {
		media = ""
	}
	if media != "" && media != "image" && media != "video" {
		return "", kernel.BadAuthRequest("媒体筛选无效")
	}
	return media, nil
}
