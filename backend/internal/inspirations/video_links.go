package inspirations

import (
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

const maxVideoLinks = 5000

var (
	videoCaseIDPattern = regexp.MustCompile(`^seedance:[A-Za-z0-9][A-Za-z0-9._-]{0,190}$`)
	videoMediaPath     = regexp.MustCompile(`(?i)^(/media/(video|goodcase)/|/cases/|/supabase-legacy/case-media/).+\.mp4$`)
)

// VideoLink only supplements media for an identical official case and source URL.
type VideoLink struct {
	ID        string `json:"id"`
	SourceID  string `json:"sourceId"`
	SourceURL string `json:"sourceUrl"`
	VideoURL  string `json:"videoUrl"`
}

// VideoLinks is stored inside the existing sync-state JSON, not a new database field.
type VideoLinks struct {
	Version  int         `json:"version"`
	Entries  []VideoLink `json:"entries"`
	SyncedAt *time.Time  `json:"syncedAt,omitempty"`
}

func validVideoLink(link VideoLink) bool {
	if link.SourceID != "seedance" || !videoCaseIDPattern.MatchString(link.ID) || len(link.SourceURL) > maxURLLength || len(link.VideoURL) > maxURLLength {
		return false
	}
	source, err := url.Parse(link.SourceURL)
	if err != nil || source.Scheme != "https" || source.Host == "" || source.User != nil {
		return false
	}
	media, err := url.Parse(link.VideoURL)
	return err == nil && media.Scheme == "https" && media.Hostname() == "media.goodcase.ai" && media.Port() == "" && media.User == nil && !strings.ContainsAny(link.VideoURL, "?#") && videoMediaPath.MatchString(media.Path)
}

func extractSeedanceVideoLinks(cases []seedanceCase) ([]VideoLink, int, error) {
	byID := map[string]VideoLink{}
	conflicts := map[string]bool{}
	rejected := 0
	for _, item := range cases {
		if item.MediaType != "video" {
			continue
		}
		link := VideoLink{ID: "seedance:" + item.Slug, SourceID: "seedance", SourceURL: item.SourceURL, VideoURL: item.MediaURL}
		if !validVideoLink(link) || conflicts[link.ID] {
			rejected++
			continue
		}
		if previous, exists := byID[link.ID]; exists && previous != link {
			delete(byID, link.ID)
			conflicts[link.ID] = true
			rejected += 2
			continue
		}
		byID[link.ID] = link
	}
	if len(byID) == 0 {
		return nil, rejected, errors.New("cases.json 没有合法的公开视频地址，保留以前的视频映射")
	}
	if len(byID) > maxVideoLinks {
		return nil, rejected, errors.New("cases.json 视频地址数量超过上限，保留以前的视频映射")
	}
	return sortedVideoLinks(byID), rejected, nil
}

func sortedVideoLinks(byID map[string]VideoLink) []VideoLink {
	entries := make([]VideoLink, 0, len(byID))
	for _, link := range byID {
		entries = append(entries, link)
	}
	slices.SortFunc(entries, func(a, b VideoLink) int { return strings.Compare(a.ID, b.ID) })
	return entries
}

func cloneVideoLinks(links *VideoLinks) *VideoLinks {
	if links == nil || links.Version != 1 {
		return nil
	}
	copy := &VideoLinks{Version: 1, Entries: slices.Clone(links.Entries)}
	if links.SyncedAt != nil {
		at := *links.SyncedAt
		copy.SyncedAt = &at
	}
	return copy
}

func retainedVideoLinks(previous *VideoLinks) *VideoLinks {
	result := &VideoLinks{Version: 1, Entries: []VideoLink{}}
	if previous == nil || previous.Version != 1 {
		return result
	}
	byID := map[string]VideoLink{}
	for _, link := range previous.Entries {
		if validVideoLink(link) {
			byID[link.ID] = link
		}
	}
	if len(byID) > maxVideoLinks {
		return result
	}
	result.Entries = sortedVideoLinks(byID)
	if previous.SyncedAt != nil {
		at := *previous.SyncedAt
		result.SyncedAt = &at
	}
	return result
}

func mergeVideoLinks(previous *VideoLinks, entries []VideoLink, at time.Time) (*VideoLinks, error) {
	result := retainedVideoLinks(previous)
	byID := make(map[string]VideoLink, len(result.Entries)+len(entries))
	for _, link := range result.Entries {
		byID[link.ID] = link
	}
	for _, link := range entries {
		if validVideoLink(link) {
			byID[link.ID] = link
		}
	}
	if len(byID) > maxVideoLinks {
		return nil, errors.New("视频映射数量超过上限，保留以前的视频映射")
	}
	result.Entries = sortedVideoLinks(byID)
	result.SyncedAt = &at
	return result, nil
}
