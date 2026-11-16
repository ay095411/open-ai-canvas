package inspirations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type libraryTestGate struct {
	sequence int
	fail     bool
}

func (g *libraryTestGate) RequireAdmin(actor *model.User) error {
	if actor == nil || actor.Role != model.UserRoleAdmin {
		return kernel.Forbidden("admin only")
	}
	return nil
}
func (g *libraryTestGate) NewAudit(actor *model.User, action, slug string, metadata any) (*model.AdminAuditEvent, error) {
	if g.fail {
		return nil, errors.New("audit unavailable")
	}
	g.sequence++
	data, _ := json.Marshal(metadata)
	return &model.AdminAuditEvent{ID: fmt.Sprint(g.sequence), ActorUserID: actor.ID, Action: action, TargetID: slug, MetadataJSON: string(data)}, nil
}

func libraryTestSetup(t *testing.T) (*Library, *gorm.DB, *model.User, *libraryTestGate, map[string][]byte) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.InspirationLibraryEntry{}, &model.AdminAuditEvent{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"cover", "clip"} {
		if err := db.Create(&model.Resource{ID: id, Provider: "local", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	gate := &libraryTestGate{}
	data := map[string][]byte{"resource:cover": []byte("reviewed image bytes"), "resource:clip": []byte("reviewed video bytes")}
	library := NewLibrary(repository.New(db), gate, func(_ context.Context, reference, kind string) (*LibraryMediaContent, error) {
		bytes, ok := data[reference]
		if !ok {
			return nil, kernel.NotFound("media missing")
		}
		hash := sha256.Sum256(bytes)
		return &LibraryMediaContent{Data: bytes, MimeType: kind + "/test", Hash: hex.EncodeToString(hash[:])}, nil
	})
	library.now = func() time.Time { return time.Unix(100, 0) }
	return library, db, &model.User{ID: "admin", Role: model.UserRoleAdmin}, gate, data
}

func libraryTestCandidate(slug string) LibraryCandidate {
	yes := true
	license := LibraryLicense{Name: "Creator permission", URL: "https://creator.example/license", Attribution: "Original Creator — licensed", Rightsholder: "Original Creator", Evidence: "Creator's written permission explicitly covers commercial display and redistribution", CommercialUse: &yes, Redistribution: &yes}
	return LibraryCandidate{Slug: slug, Title: "Authorized portrait", Prompt: "Exact licensed prompt", PromptZH: "许可提示词原文", Image: "resource:cover", Mode: "image", Category: "portrait", Model: "Local model", Tags: []string{"cinematic"}, SourceURL: "https://creator.example/work/1", Author: "Original Creator", PromptLicense: license, MediaLicense: license, MediaReviewed: true, Width: 768, Height: 1024}
}

func libraryTestImport(t *testing.T, l *Library, actor *model.User, candidates ...LibraryCandidate) {
	t.Helper()
	if _, err := l.Import(context.Background(), actor, LibraryImport{Items: candidates}); err != nil {
		t.Fatal(err)
	}
}
func libraryTestApprove(t *testing.T, l *Library, actor *model.User, slug string) *LibraryReviewRecord {
	t.Helper()
	row, err := l.AdminDetail(context.Background(), actor, slug)
	if err != nil {
		t.Fatal(err)
	}
	reviewed, err := l.Review(context.Background(), actor, slug, LibraryReview{Revision: row.Revision, Action: "approve", Reason: "Verified written permission and local media"})
	if err != nil {
		t.Fatal(err)
	}
	return reviewed
}

func TestLibraryDefaultEmptyAndPendingNotPublic(t *testing.T) {
	l, _, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	for _, phase := range []string{"empty", "pending"} {
		if phase == "pending" {
			libraryTestImport(t, l, admin, libraryTestCandidate("portrait"))
		}
		page, err := l.Prompts(ctx, url.Values{})
		if err != nil || page.Total != 0 || len(page.Items) != 0 || page.PolicyVersion != LibraryPolicyVersion {
			t.Fatalf("%s: %#v %v", phase, page, err)
		}
		if _, err := l.Detail(ctx, "portrait"); err == nil {
			t.Fatal("unapproved detail leaked")
		}
		facets, err := l.Facets(ctx, url.Values{})
		if err != nil || facets.Total != 0 || len(facets.Categories) != 0 {
			t.Fatalf("pending facets: %#v %v", facets, err)
		}
	}
}

func TestLibraryImportStrictValidationAndAtomicBatch(t *testing.T) {
	l, db, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	cases := []struct {
		name   string
		mutate func(*LibraryCandidate)
	}{
		{"license missing", func(c *LibraryCandidate) { c.PromptLicense.Name = "" }},
		{"rightsholder missing", func(c *LibraryCandidate) { c.MediaLicense.Rightsholder = "" }},
		{"rights omitted", func(c *LibraryCandidate) { c.MediaLicense.Redistribution = nil }},
		{"remote media", func(c *LibraryCandidate) { c.Image = "https://creator.example/cover.jpg" }},
		{"invalid source", func(c *LibraryCandidate) { c.SourceURL = "http://creator.example/work" }},
		{"source token", func(c *LibraryCandidate) { c.SourceURL = "https://creator.example/work?token=private" }},
		{"video without clip", func(c *LibraryCandidate) { c.Mode = "video" }},
		{"image with clip", func(c *LibraryCandidate) { c.VideoURL = "resource:clip" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			candidate := libraryTestCandidate("invalid")
			test.mutate(&candidate)
			if _, err := l.Import(ctx, admin, LibraryImport{Items: []LibraryCandidate{libraryTestCandidate("valid"), candidate}}); err == nil {
				t.Fatal("invalid import accepted")
			}
			var count int64
			db.Model(&model.InspirationLibraryEntry{}).Count(&count)
			if count != 0 {
				t.Fatal("batch partially written")
			}
		})
	}
	if _, err := l.Import(ctx, admin, LibraryImport{Items: []LibraryCandidate{libraryTestCandidate("duplicate"), libraryTestCandidate("duplicate")}}); err == nil {
		t.Fatal("duplicate accepted")
	}
}

func TestLibraryAdminAuthorizationAndAuditRollback(t *testing.T) {
	l, db, admin, gate, _ := libraryTestSetup(t)
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := l.Import(ctx, user, LibraryImport{Items: []LibraryCandidate{libraryTestCandidate("entry")}}); err == nil {
		t.Fatal("non-admin import accepted")
	}
	if _, err := l.AdminPage(ctx, user, "", 1, 20); err == nil {
		t.Fatal("non-admin page accepted")
	}
	if _, err := l.AdminDetail(ctx, user, "entry"); err == nil {
		t.Fatal("non-admin detail accepted")
	}
	if _, err := l.Review(ctx, user, "entry", LibraryReview{Revision: 1, Action: "approve", Reason: "ok"}); err == nil {
		t.Fatal("non-admin review accepted")
	}
	gate.fail = true
	if _, err := l.Import(ctx, admin, LibraryImport{Items: []LibraryCandidate{libraryTestCandidate("entry")}}); err == nil {
		t.Fatal("audit failure ignored")
	}
	var count int64
	db.Model(&model.InspirationLibraryEntry{}).Count(&count)
	if count != 0 {
		t.Fatal("failed audit left candidate")
	}
	gate.fail = false
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	gate.fail = true
	if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: 1, Action: "approve", Reason: "ok"}); err == nil {
		t.Fatal("review audit failure ignored")
	}
	row, _ := l.AdminDetail(ctx, admin, "entry")
	if row.Status != "pending" || row.Revision != 1 {
		t.Fatal("review failed rollback")
	}
}

func TestLibraryApprovalRequiresRightsEvidenceAndMediaReview(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*LibraryCandidate)
	}{
		{"commercial false", func(c *LibraryCandidate) { no := false; c.PromptLicense.CommercialUse = &no }},
		{"redistribution false", func(c *LibraryCandidate) { no := false; c.MediaLicense.Redistribution = &no }},
		{"evidence missing", func(c *LibraryCandidate) { c.PromptLicense.Evidence = "" }},
		{"media unreviewed", func(c *LibraryCandidate) { c.MediaReviewed = false }},
		{"competitor source", func(c *LibraryCandidate) { c.SourceURL = "https://api.seedance.nz/prompt-gallery" }},
		{"competitor model", func(c *LibraryCandidate) { c.Model = "Seedance 2" }},
		{"human watermark association", func(c *LibraryCandidate) { c.CompetitorAssociation = true }},
		{"exception evidence missing", func(c *LibraryCandidate) { c.CompetitorAssociation = true; c.CompetitorException = true }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			l, _, admin, _, _ := libraryTestSetup(t)
			candidate := libraryTestCandidate("entry")
			test.mutate(&candidate)
			libraryTestImport(t, l, admin, candidate)
			if _, err := l.Review(context.Background(), admin, "entry", LibraryReview{Revision: 1, Action: "approve", Reason: "review"}); err == nil {
				t.Fatal("approval incorrectly accepted")
			}
		})
	}
	l, _, admin, _, _ := libraryTestSetup(t)
	candidate := libraryTestCandidate("exception")
	candidate.CompetitorAssociation = true
	candidate.CompetitorException = true
	candidate.CompetitorEvidence = "Rights holder expressly authorizes reuse with original creator credit"
	libraryTestImport(t, l, admin, candidate)
	libraryTestApprove(t, l, admin, "exception")
}

func TestLibraryPublicationSummaryAttributionAndResolve(t *testing.T) {
	l, _, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	approved := libraryTestApprove(t, l, admin, "entry")
	page, err := l.Prompts(ctx, url.Values{})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("page: %#v %v", page, err)
	}
	data, _ := json.Marshal(page.Items[0])
	for _, secret := range []string{"Exact licensed prompt", "许可提示词原文", "evidence", "commercialUse"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("summary leaked %s: %s", secret, data)
		}
	}
	entry := page.Items[0]
	if entry.ID != "authorized-library:entry" || entry.Authorization.Revision != approved.Revision || entry.Authorization.PromptLicense.Rightsholder != "Original Creator" || entry.GalleryURL != "https://creator.example/work/1" || !strings.HasPrefix(entry.Image, "/api/public/inspirations/library/prompts/entry/media?") {
		t.Fatalf("wrong public contract: %#v", entry)
	}
	detail, err := l.Detail(ctx, "entry")
	if err != nil || detail.Prompt != "Exact licensed prompt" {
		t.Fatal("detail body unavailable")
	}
	resolved, err := l.Resolve(ctx, LibraryResolve{IDs: []string{"zzai-gallery:old", "authorized-library:entry", "authorized-library:entry", "authorized-library:unknown"}})
	if err != nil || len(resolved.Items) != 1 {
		t.Fatalf("resolve: %#v %v", resolved, err)
	}
	facets, err := l.Facets(ctx, url.Values{})
	if err != nil || facets.Total != 1 || len(facets.Categories) != 1 {
		t.Fatal("approved facets unavailable")
	}
}

func TestLibraryUpdateReapprovalRevocationAndCAS(t *testing.T) {
	l, _, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	candidate := libraryTestCandidate("entry")
	libraryTestImport(t, l, admin, candidate)
	approved := libraryTestApprove(t, l, admin, "entry")
	result, err := l.Import(ctx, admin, LibraryImport{Items: []LibraryCandidate{candidate}})
	if err != nil || result.Unchanged != 1 {
		t.Fatal("repeat import not idempotent")
	}
	row, _ := l.AdminDetail(ctx, admin, "entry")
	if row.Revision != approved.Revision || row.Status != "approved" {
		t.Fatal("identical import reset approval")
	}
	candidate.Prompt += " changed"
	result, err = l.Import(ctx, admin, LibraryImport{Items: []LibraryCandidate{candidate}})
	if err != nil || result.Updated != 1 {
		t.Fatal("update unavailable")
	}
	row, _ = l.AdminDetail(ctx, admin, "entry")
	if row.Status != "pending" || row.PublishedAt != nil || row.ReviewedAt != nil {
		t.Fatal("update retained authorization")
	}
	if _, err := l.Detail(ctx, "entry"); err == nil {
		t.Fatal("changed candidate remained published")
	}
	approved = libraryTestApprove(t, l, admin, "entry")
	if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: approved.Revision - 1, Action: "reject", Reason: "stale"}); err == nil {
		t.Fatal("stale review accepted")
	}
	if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: approved.Revision, Action: "reject", Reason: "Rights revoked"}); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Detail(ctx, "entry"); err == nil {
		t.Fatal("revoked detail exposed")
	}
	resolved, _ := l.Resolve(ctx, LibraryResolve{IDs: []string{"authorized-library:entry"}})
	if len(resolved.Items) != 0 {
		t.Fatal("revoked favorite exposed")
	}
	if _, err := l.Media(ctx, nil, false, "entry", "image", approved.ImageHash, approved.Revision); err == nil {
		t.Fatal("revoked media exposed")
	}
}

func TestLibraryCursorBindingAndLiteralSearch(t *testing.T) {
	l, _, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	for _, slug := range []string{"alpha", "beta", "gamma"} {
		candidate := libraryTestCandidate(slug)
		candidate.Title = "100% " + slug
		libraryTestImport(t, l, admin, candidate)
		libraryTestApprove(t, l, admin, slug)
	}
	page, err := l.Prompts(ctx, url.Values{"limit": {"1"}})
	if err != nil || page.NextCursor == "" {
		t.Fatal("cursor missing")
	}
	next, err := l.Prompts(ctx, url.Values{"limit": {"1"}, "cursor": {page.NextCursor}})
	if err != nil || next.Items[0].ID == page.Items[0].ID {
		t.Fatal("cursor repeats entry")
	}
	if _, err := l.Prompts(ctx, url.Values{"limit": {"2"}, "cursor": {page.NextCursor}}); err == nil {
		t.Fatal("cursor not bound to limit")
	}
	row, _ := l.AdminDetail(ctx, admin, "gamma")
	l.Review(ctx, admin, "gamma", LibraryReview{Revision: row.Revision, Action: "reject", Reason: "withdrawn"})
	if _, err := l.Prompts(ctx, url.Values{"limit": {"1"}, "cursor": {page.NextCursor}}); err == nil {
		t.Fatal("stale catalog cursor accepted")
	}
	page, err = l.Prompts(ctx, url.Values{"search": {"%"}})
	if err != nil || page.Total != 2 {
		t.Fatal("literal search failed")
	}
	page, err = l.Prompts(ctx, url.Values{"search": {"_"}})
	if err != nil || page.Total != 0 {
		t.Fatal("LIKE wildcard escaped incorrectly")
	}
	for _, query := range []url.Values{{"sort": {"random"}}, {"limit": {"1", "2"}}, {"source": {"old"}}, {"search": {"a\n"}}} {
		if _, err := l.Prompts(ctx, query); err == nil {
			t.Fatalf("invalid query accepted: %v", query)
		}
	}
}

func TestLibraryMediaHashIsolationAndAdminPreview(t *testing.T) {
	l, _, admin, _, data := libraryTestSetup(t)
	ctx := context.Background()
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	pending, _ := l.AdminDetail(ctx, admin, "entry")
	if _, err := l.Media(ctx, admin, true, "entry", "image", pending.ImageHash, pending.Revision); err != nil {
		t.Fatal("pending admin preview unavailable", err)
	}
	if _, err := l.Media(ctx, nil, true, "entry", "image", pending.ImageHash, pending.Revision); err == nil {
		t.Fatal("anonymous admin preview allowed")
	}
	data["resource:cover"] = []byte("changed before review")
	if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: 1, Action: "approve", Reason: "review"}); err == nil {
		t.Fatal("mutated bytes approved")
	}
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	approved := libraryTestApprove(t, l, admin, "entry")
	if _, err := l.Media(ctx, nil, false, "entry", "image", approved.ImageHash, approved.Revision); err != nil {
		t.Fatal(err)
	}
	data["resource:cover"] = []byte("changed after approval")
	if _, err := l.Media(ctx, nil, false, "entry", "image", approved.ImageHash, approved.Revision); err == nil {
		t.Fatal("mutated public bytes exposed")
	}
}

func TestLibraryDamagedCandidateCanBeRetracted(t *testing.T) {
	l, db, admin, _, _ := libraryTestSetup(t)
	ctx := context.Background()
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	approved := libraryTestApprove(t, l, admin, "entry")
	if err := db.Model(&model.InspirationLibraryEntry{}).Where("slug = ?", "entry").Update("payload_json", "invalid JSON").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: approved.Revision, Action: "reject", Reason: "Corrupt record withdrawn"}); err != nil {
		t.Fatal("damaged candidate cannot be withdrawn", err)
	}
	var row model.InspirationLibraryEntry
	db.First(&row, "slug = ?", "entry")
	if row.Status != "rejected" {
		t.Fatal("withdrawal did not persist")
	}
}

func TestLibraryReviewMediaReferencesRetainedUntilRejection(t *testing.T) {
	l, db, admin, _, _ := libraryTestSetup(t)
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	repo := repository.New(db)
	if err := repo.RequireNoInspirationLibraryReferences([]string{"cover"}); err == nil {
		t.Fatal("pending media unprotected")
	}
	approved := libraryTestApprove(t, l, admin, "entry")
	if err := repo.RequireNoInspirationLibraryReferences([]string{"cover"}); err == nil {
		t.Fatal("approved media unprotected")
	}
	resource, err := repo.Resource("cover")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteAdminResources([]model.Resource{*resource}, nil, []model.AdminAuditEvent{{ID: "deletion"}}); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatal("admin delete failed to protect approved media", err)
	}
	if err := repo.DeleteDetachedResources([]model.Resource{*resource}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatal("orphan cleanup failed to protect approved media", err)
	}
	if err := repo.DeleteAssetsAndResources("owner", []string{"asset"}, []string{"cover"}, nil, true); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatal("asset purge failed to protect approved media", err)
	}
	l.Review(context.Background(), admin, "entry", LibraryReview{Revision: approved.Revision, Action: "reject", Reason: "withdrawn"})
	if err := repo.RequireNoInspirationLibraryReferences([]string{"cover"}); err != nil {
		t.Fatal("rejected media not released")
	}
}

func TestLibraryMediaRechecksPublicationAfterRead(t *testing.T) {
	l, _, admin, _, _ := libraryTestSetup(t)
	libraryTestImport(t, l, admin, libraryTestCandidate("entry"))
	approved := libraryTestApprove(t, l, admin, "entry")
	reader := l.media
	l.media = func(ctx context.Context, reference, kind string) (*LibraryMediaContent, error) {
		content, err := reader(ctx, reference, kind)
		if err != nil {
			return nil, err
		}
		if _, err := l.Review(ctx, admin, "entry", LibraryReview{Revision: approved.Revision, Action: "reject", Reason: "Revoked during media read"}); err != nil {
			return nil, err
		}
		return content, nil
	}
	if _, err := l.Media(context.Background(), nil, false, "entry", "image", approved.ImageHash, approved.Revision); err == nil {
		t.Fatal("concurrent withdrawal not rechecked")
	}
}
