package app

import (
	"strings"
	"testing"
)

func TestParseAppearanceCarouselSlot(t *testing.T) {
	tests := []struct {
		slot   string
		itemID string
		kind   string
		ok     bool
	}{
		{slot: "carousel-ab12-video", itemID: "ab12", kind: "video", ok: true},
		{slot: "carousel-ab12-image", itemID: "ab12", kind: "image", ok: true},
		{slot: "carousel-ab12-poster", itemID: "ab12", kind: "poster", ok: true},
		{slot: "carousel--video", ok: false},
		{slot: "carousel-ab12", ok: false},
		{slot: "carousel-ab12-gif", ok: false},
		{slot: "video", ok: false},
		{slot: "logo", ok: false},
		{slot: "", ok: false},
	}
	for _, test := range tests {
		itemID, kind, ok := parseAppearanceCarouselSlot(test.slot)
		if ok != test.ok {
			t.Errorf("parseAppearanceCarouselSlot(%q) ok = %v, want %v", test.slot, ok, test.ok)
			continue
		}
		if !ok {
			continue
		}
		if itemID != test.itemID || kind != test.kind {
			t.Errorf("parseAppearanceCarouselSlot(%q) = (%q, %q), want (%q, %q)", test.slot, itemID, kind, test.itemID, test.kind)
		}
	}
}

func TestAppearanceCarouselAssetLimits(t *testing.T) {
	if size, err := AppearanceAssetMaxBytes("carousel-ab12-video"); err != nil || size != appearanceVideoMaxBytes {
		t.Fatalf("carousel video max bytes = %d, %v; want %d", size, err, appearanceVideoMaxBytes)
	}
	if size, err := AppearanceAssetMaxBytes("carousel-ab12-image"); err != nil || size != appearancePosterMaxBytes {
		t.Fatalf("carousel image max bytes = %d, %v; want %d", size, err, appearancePosterMaxBytes)
	}
	if _, err := AppearanceAssetMaxBytes("carousel-ab12-gif"); err == nil {
		t.Fatal("unknown carousel kind accepted")
	}
	if !appearanceSlotIsVideo("carousel-ab12-video") {
		t.Error("carousel video slot not treated as video")
	}
	if appearanceSlotIsVideo("carousel-ab12-image") || appearanceSlotIsVideo("carousel-ab12-poster") {
		t.Error("carousel image / poster slot treated as video")
	}
}

func TestNormalizeAppearanceCarousel(t *testing.T) {
	items, err := normalizeAppearanceCarousel([]AppearanceCarouselItem{
		{Kind: " ", Title: "  标题  ", Subtitle: "  副标题  ", MediaResourceID: " r1 "},
		{ID: "dup", Kind: "image", MediaResourceID: "r2"},
		{ID: "dup", Kind: "video", MediaResourceID: "r3", PosterResourceID: "p3"},
		{ID: "", Kind: "video", MediaResourceID: "r4", PosterResourceID: "p4"},
	})
	if err != nil {
		t.Fatalf("normalize returned error: %v", err)
	}
	if len(items) != 4 {
		t.Fatalf("normalized %d items, want 4", len(items))
	}
	if items[0].Kind != appearanceCarouselKindImage || items[0].Title != "标题" || items[0].Subtitle != "副标题" || items[0].MediaResourceID != "r1" {
		t.Errorf("first item not normalized: %+v", items[0])
	}
	if items[0].PosterResourceID != "" {
		t.Error("image item should not keep a poster reference")
	}
	if items[2].ID == items[1].ID {
		t.Error("duplicate ids were not de-duplicated")
	}
	if items[3].ID == "" {
		t.Error("empty id should be auto assigned")
	}

	if _, err := normalizeAppearanceCarousel([]AppearanceCarouselItem{{Kind: "gif"}}); err == nil {
		t.Fatal("unknown kind accepted")
	}
	tooLong := strings.Repeat("题", 41)
	if _, err := normalizeAppearanceCarousel([]AppearanceCarouselItem{{Kind: "image", Title: tooLong}}); err == nil {
		t.Fatal("over-long title accepted")
	}
	many := make([]AppearanceCarouselItem, appearanceCarouselMaxItems+1)
	if _, err := normalizeAppearanceCarousel(many); err == nil {
		t.Fatal("over-limit item count accepted")
	}
	empty, err := normalizeAppearanceCarousel(nil)
	if err != nil || empty != nil {
		t.Fatalf("nil input should yield nil, got %v, %v", empty, err)
	}
}

func TestPublicAppearanceCarousel(t *testing.T) {
	public_ := publicAppearanceCarousel([]AppearanceCarouselItem{
		{ID: "a", Kind: appearanceCarouselKindImage, MediaResourceID: "r-image", Title: "图片"},
		{ID: "b", Kind: appearanceCarouselKindVideo, MediaResourceID: "r-video", PosterResourceID: "r-poster", Title: "视频"},
		{ID: "c", Kind: appearanceCarouselKindImage},
	}, "rev1")
	if len(public_) != 2 {
		t.Fatalf("public carousel has %d items, want 2 (no-media entries are skipped)", len(public_))
	}
	if public_[0].Kind != appearanceCarouselKindImage || public_[0].PosterURL != "" {
		t.Errorf("image entry wrong: %+v", public_[0])
	}
	if !strings.Contains(public_[0].URL, "carousel-a-image") {
		t.Errorf("image url should point at its slot, got %q", public_[0].URL)
	}
	if public_[1].Kind != appearanceCarouselKindVideo || !strings.Contains(public_[1].URL, "carousel-b-video") || !strings.Contains(public_[1].PosterURL, "carousel-b-poster") {
		t.Errorf("video entry wrong: %+v", public_[1])
	}
	if public_ := publicAppearanceCarousel(nil, "rev1"); public_ != nil {
		t.Fatalf("nil input should yield nil, got %+v", public_)
	}
}

func TestAppearanceCarouselResourceIDLookup(t *testing.T) {
	value := AppearanceSetting{AuthCarousel: []AppearanceCarouselItem{
		{ID: "a", Kind: appearanceCarouselKindImage, MediaResourceID: "media-a"},
		{ID: "b", Kind: appearanceCarouselKindVideo, MediaResourceID: "media-b", PosterResourceID: "poster-b"},
	}}
	if got := appearanceResourceID(value, "carousel-a-image"); got != "media-a" {
		t.Errorf("carousel-a-image = %q, want media-a", got)
	}
	if got := appearanceResourceID(value, "carousel-b-video"); got != "media-b" {
		t.Errorf("carousel-b-video = %q, want media-b", got)
	}
	if got := appearanceResourceID(value, "carousel-b-poster"); got != "poster-b" {
		t.Errorf("carousel-b-poster = %q, want poster-b", got)
	}
	if got := appearanceResourceID(value, "carousel-missing-image"); got != "" {
		t.Errorf("unknown item should resolve to empty, got %q", got)
	}
	slots := appearanceAssetSlots(value)
	for _, want := range []string{"carousel-a-image", "carousel-b-video", "carousel-b-poster"} {
		found := false
		for _, slot := range slots {
			if slot == want {
				found = true
			}
		}
		if !found {
			t.Errorf("appearanceAssetSlots missing %q, got %v", want, slots)
		}
	}
}
