package inspirations

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const LibraryPolicyVersion = "licensed-v1"
const LibrarySourceID = "authorized-library"

type LibraryLicense struct {
	Name           string `json:"name"`
	URL            string `json:"url"`
	Attribution    string `json:"attribution"`
	Evidence       string `json:"evidence"`
	Rightsholder   string `json:"rightsholder"`
	CommercialUse  *bool  `json:"commercialUse"`
	Redistribution *bool  `json:"redistribution"`
}

type LibraryCandidate struct {
	Slug                  string         `json:"slug"`
	Title                 string         `json:"title"`
	Description           string         `json:"description"`
	Prompt                string         `json:"prompt"`
	PromptZH              string         `json:"promptZh,omitempty"`
	Image                 string         `json:"image"`
	VideoURL              string         `json:"videoUrl,omitempty"`
	Mode                  string         `json:"mode"`
	Category              string         `json:"category,omitempty"`
	Tags                  []string       `json:"tags,omitempty"`
	Model                 string         `json:"model,omitempty"`
	Width                 int            `json:"width,omitempty"`
	Height                int            `json:"height,omitempty"`
	Featured              bool           `json:"featured,omitempty"`
	SourceURL             string         `json:"sourceUrl"`
	Author                string         `json:"author"`
	PromptLicense         LibraryLicense `json:"promptLicense"`
	MediaLicense          LibraryLicense `json:"mediaLicense"`
	CompetitorException   bool           `json:"competitorException"`
	CompetitorAssociation bool           `json:"competitorAssociation,omitempty"`
	CompetitorEvidence    string         `json:"competitorEvidence,omitempty"`
	MediaReviewed         bool           `json:"mediaReviewed"`
}

type LibraryReviewRecord struct {
	LibraryCandidate
	ContentHash  string     `json:"contentHash"`
	ImageHash    string     `json:"imageHash"`
	VideoHash    string     `json:"videoHash,omitempty"`
	Revision     int64      `json:"revision"`
	Status       string     `json:"status"`
	ReviewReason string     `json:"reviewReason"`
	ReviewedBy   string     `json:"reviewedBy,omitempty"`
	ReviewedAt   *time.Time `json:"reviewedAt,omitempty"`
	PublishedAt  *time.Time `json:"publishedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}
type LibraryReviewPage struct {
	Items []LibraryReviewRecord `json:"items"`
	Total int64                 `json:"total"`
	Page  int                   `json:"page"`
	Limit int                   `json:"limit"`
}
type LibraryImport struct {
	Items []LibraryCandidate `json:"items"`
}
type LibraryImportResult struct {
	Created   int `json:"created"`
	Updated   int `json:"updated"`
	Unchanged int `json:"unchanged"`
}
type LibraryReview struct {
	Revision int64  `json:"revision"`
	Action   string `json:"action"`
	Reason   string `json:"reason"`
}
type LibraryPublishedLicense struct {
	Name         string `json:"name"`
	URL          string `json:"url"`
	Attribution  string `json:"attribution"`
	Rightsholder string `json:"rightsholder"`
}
type LibraryAuthorization struct {
	PolicyVersion string                  `json:"policyVersion"`
	ContentHash   string                  `json:"contentHash"`
	Revision      int64                   `json:"revision"`
	PromptLicense LibraryPublishedLicense `json:"promptLicense"`
	MediaLicense  LibraryPublishedLicense `json:"mediaLicense"`
}
type LibrarySummary struct {
	GalleryEntry
	Authorization LibraryAuthorization `json:"authorization"`
}
type LibraryDetail struct {
	LibrarySummary
	Prompt   string `json:"prompt"`
	PromptZH string `json:"promptZh,omitempty"`
}
type LibraryPage struct {
	Items         []LibrarySummary `json:"items"`
	Total         int64            `json:"total"`
	NextCursor    string           `json:"nextCursor,omitempty"`
	PolicyVersion string           `json:"policyVersion"`
}
type LibraryFacets struct {
	Categories    []string `json:"categories"`
	Models        []string `json:"models"`
	Tags          []string `json:"tags"`
	Total         int64    `json:"total"`
	PolicyVersion string   `json:"policyVersion"`
}
type LibraryResolve struct {
	IDs []string `json:"ids"`
}
type LibraryResolved struct {
	Items         []LibrarySummary `json:"items"`
	PolicyVersion string           `json:"policyVersion"`
}

// LibraryMediaContent is read from controlled local resources only, never remote links.
type LibraryMediaContent struct {
	Data     []byte
	MimeType string
	Hash     string
}

var libraryResourcePattern = regexp.MustCompile(`^resource:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`)
var libraryHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func libraryText(value string, maximum int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || len(value) > maximum || (required && value == "") || strings.ContainsRune(value, '\x00') {
		return "", kernel.BadAuthRequest("授权素材字段缺失或超过限制")
	}
	return value, nil
}
func libraryURL(value string) (string, error) {
	value, err := libraryText(value, 4096, true)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return "", kernel.BadAuthRequest("来源与许可链接必须是不含凭据的 HTTPS 地址")
	}
	for key := range u.Query() {
		switch strings.ToLower(key) {
		case "token", "api_key", "apikey", "password", "secret", "signature", "access_token":
			return "", kernel.BadAuthRequest("来源与许可链接不能包含敏感凭据")
		}
	}
	return u.String(), nil
}
func normalizeLibraryLicense(license LibraryLicense) (LibraryLicense, error) {
	var err error
	for _, field := range []struct {
		value    *string
		maximum  int
		required bool
	}{{&license.Name, 500, true}, {&license.Attribution, 2000, true}, {&license.Rightsholder, 500, true}, {&license.Evidence, 16384, false}} {
		*field.value, err = libraryText(*field.value, field.maximum, field.required)
		if err != nil {
			return license, err
		}
	}
	license.URL, err = libraryURL(license.URL)
	if err != nil {
		return license, err
	}
	if license.CommercialUse == nil || license.Redistribution == nil {
		return license, kernel.BadAuthRequest("必须明确声明许可是否覆盖商用展示和再分发")
	}
	return license, nil
}
func normalizeLibraryCandidate(candidate LibraryCandidate) (LibraryCandidate, error) {
	if err := validateGallerySlug(candidate.Slug); err != nil {
		return candidate, err
	}
	var err error
	for _, field := range []struct {
		value    *string
		maximum  int
		required bool
	}{{&candidate.Title, 500, true}, {&candidate.Description, 16384, false}, {&candidate.Prompt, 200000, true}, {&candidate.PromptZH, 200000, false}, {&candidate.Author, 500, true}, {&candidate.Category, 128, false}, {&candidate.Model, 128, false}, {&candidate.CompetitorEvidence, 16384, false}} {
		*field.value, err = libraryText(*field.value, field.maximum, field.required)
		if err != nil {
			return candidate, err
		}
	}
	if candidate.Mode != "image" && candidate.Mode != "video" {
		return candidate, kernel.BadAuthRequest("授权素材只支持 image 或 video")
	}
	if !libraryResourcePattern.MatchString(candidate.Image) || (candidate.VideoURL != "" && !libraryResourcePattern.MatchString(candidate.VideoURL)) || (candidate.Mode == "video" && candidate.VideoURL == "") || (candidate.Mode == "image" && candidate.VideoURL != "") {
		return candidate, kernel.BadAuthRequest("媒体必须引用已上传的本站 resource:ID；视频需要独立视频资源，不接受远程热链")
	}
	if candidate.Width < 0 || candidate.Height < 0 || candidate.Width > 20000 || candidate.Height > 20000 {
		return candidate, kernel.BadAuthRequest("素材尺寸无效")
	}
	if len(candidate.Tags) > 50 {
		return candidate, kernel.BadAuthRequest("标签最多 50 个")
	}
	seen := map[string]bool{}
	tags := []string{}
	for _, tag := range candidate.Tags {
		tag, err = libraryText(tag, 128, true)
		if err != nil {
			return candidate, err
		}
		if !seen[tag] {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	candidate.Tags = tags
	candidate.SourceURL, err = libraryURL(candidate.SourceURL)
	if err != nil {
		return candidate, err
	}
	candidate.PromptLicense, err = normalizeLibraryLicense(candidate.PromptLicense)
	if err != nil {
		return candidate, err
	}
	candidate.MediaLicense, err = normalizeLibraryLicense(candidate.MediaLicense)
	return candidate, err
}
func libraryCanApprove(candidate LibraryCandidate) error {
	for _, license := range []LibraryLicense{candidate.PromptLicense, candidate.MediaLicense} {
		if !*license.CommercialUse || !*license.Redistribution || utf8.RuneCountInString(license.Evidence) < 12 {
			return kernel.BadAuthRequest("提示词和媒体均需要覆盖商用展示、再分发的明确许可及具体审核证据")
		}
	}
	if !candidate.MediaReviewed {
		return kernel.BadAuthRequest("必须人工核验媒体权利、署名、人物及水印关联")
	}
	association := candidate.CompetitorAssociation
	identity := strings.ToLower(strings.Join([]string{candidate.SourceURL, candidate.Author, candidate.Model, candidate.Title, candidate.Description, candidate.Prompt, candidate.PromptZH, candidate.PromptLicense.URL, candidate.PromptLicense.Rightsholder, candidate.PromptLicense.Attribution, candidate.MediaLicense.URL, candidate.MediaLicense.Rightsholder, candidate.MediaLicense.Attribution}, " "))
	for _, marker := range []string{"seedance", "zzai", "zhenzhen-", "youmind", "runninghub", "liblib", "lovart", "jimeng", "dreamina", "hailuo", "kling", "即梦", "海螺", "可灵"} {
		if strings.Contains(identity, marker) {
			association = true
		}
	}
	if association && (!candidate.CompetitorException || utf8.RuneCountInString(candidate.CompetitorEvidence) < 12) {
		return kernel.BadAuthRequest("竞品模型、域、作者或水印关联默认拒绝，例外必须提交具体授权证据并保留必要署名")
	}
	return nil
}
func libraryContentHash(candidate LibraryCandidate, imageHash, videoHash string) (string, string, error) {
	payload, err := json.Marshal(candidate)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(append(append(payload, '\n'), []byte(imageHash+":"+videoHash)...))
	return string(payload), hex.EncodeToString(digest[:]), nil
}
func libraryRecord(row *model.InspirationLibraryEntry) (LibraryReviewRecord, error) {
	var candidate LibraryCandidate
	if err := json.Unmarshal([]byte(row.PayloadJSON), &candidate); err != nil {
		return LibraryReviewRecord{}, err
	}
	return LibraryReviewRecord{LibraryCandidate: candidate, ContentHash: row.ContentHash, ImageHash: row.ImageHash, VideoHash: row.VideoHash, Revision: row.Revision, Status: row.Status, ReviewReason: row.ReviewReason, ReviewedBy: row.ReviewedBy, ReviewedAt: row.ReviewedAt, PublishedAt: row.PublishedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}, nil
}
func libraryPublished(row *model.InspirationLibraryEntry) (LibraryDetail, error) {
	record, err := libraryRecord(row)
	if err != nil {
		return LibraryDetail{}, err
	}
	candidate, err := normalizeLibraryCandidate(record.LibraryCandidate)
	if err != nil {
		return LibraryDetail{}, err
	}
	if err := libraryCanApprove(candidate); err != nil {
		return LibraryDetail{}, err
	}
	_, contentHash, err := libraryContentHash(candidate, row.ImageHash, row.VideoHash)
	if err != nil {
		return LibraryDetail{}, err
	}
	if contentHash != row.ContentHash || !libraryHashPattern.MatchString(row.ImageHash) || (candidate.Mode == "video" && !libraryHashPattern.MatchString(row.VideoHash)) {
		return LibraryDetail{}, kernel.NotFound("授权素材版本暂不可用")
	}
	mediaURL := func(kind, hash string) string {
		return "/api/public/inspirations/library/prompts/" + url.PathEscape(row.Slug) + "/media?" + url.Values{"kind": {kind}, "hash": {hash}, "revision": {fmtRevision(row.Revision)}}.Encode()
	}
	entry := GalleryEntry{ID: LibrarySourceID + ":" + row.Slug, Slug: row.Slug, SourceID: LibrarySourceID, Title: candidate.Title, Description: candidate.Description, Image: mediaURL("image", row.ImageHash), Mode: candidate.Mode, Category: candidate.Category, Tags: candidate.Tags, Width: candidate.Width, Height: candidate.Height, Model: candidate.Model, Featured: candidate.Featured, Credit: candidate.Author, SourceURL: candidate.SourceURL, GalleryURL: candidate.SourceURL, PublishedAt: row.PublishedAt}
	if candidate.VideoURL != "" {
		entry.VideoURL = mediaURL("video", row.VideoHash)
	}
	if candidate.Width > 0 && candidate.Height > 0 {
		divisor := galleryGCD(candidate.Width, candidate.Height)
		entry.Ratio = fmtRevision(int64(candidate.Width/divisor)) + ":" + fmtRevision(int64(candidate.Height/divisor))
	}
	license := func(value LibraryLicense) LibraryPublishedLicense {
		return LibraryPublishedLicense{Name: value.Name, URL: value.URL, Attribution: value.Attribution, Rightsholder: value.Rightsholder}
	}
	return LibraryDetail{LibrarySummary: LibrarySummary{GalleryEntry: entry, Authorization: LibraryAuthorization{PolicyVersion: LibraryPolicyVersion, ContentHash: row.ContentHash, Revision: row.Revision, PromptLicense: license(candidate.PromptLicense), MediaLicense: license(candidate.MediaLicense)}}, Prompt: candidate.Prompt, PromptZH: candidate.PromptZH}, nil
}
