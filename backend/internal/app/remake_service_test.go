package app

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/remake"
)

func newRemakeTestProject(t *testing.T, mode string) (*Service, *fakeDramaBackend, RemakeDetail) {
	t.Helper()
	svc, fake := newDramaTestService(t)
	sqlDB, err := fake.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := fake.db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: remakeJSON(map[string]bool{"videoRemakeEnabled": true})}).Error; err != nil {
		t.Fatal(err)
	}
	svc.remakeTaskHook = fake.submit
	source := fake.resource("usr-drama", "video", "video/mp4")
	target := fake.resource("usr-drama", "image", "image/png")
	settings := RemakeSettings{SourceOutMs: 4000, TargetDescription: "新主体", TargetResourceIDs: []string{target}, AspectRatio: "9:16", AudioMode: "mute", Mode: mode, Models: RemakeModels{Text: fakeDramaModels.Text, Image: fakeDramaModels.Image, Video: fakeDramaModels.Video}}
	detail, err := svc.CreateRemake("usr-drama", CreateRemakeRequest{Title: "测试复刻", SourceResourceID: source, Settings: settings})
	if err != nil {
		t.Fatal(err)
	}
	analysis := remake.Analysis{SourceResourceID: source, SourceDurationMs: 4000, SourceOutMs: 4000, Width: 1080, Height: 1920, FPS: 25, Shots: []remake.SourceShot{
		{ID: "shot-01", SourceOutMs: 2000, KeyframeMs: 1000, KeyframeResourceID: fake.resource("usr-drama", "image", "image/png"), Description: "近景", ImagePrompt: "旧提示词", VideoPrompt: "慢推镜头", SubjectPresent: true, SubjectDescription: "原主体"},
		{ID: "shot-02", SourceInMs: 2000, SourceOutMs: 4000, KeyframeMs: 3000, KeyframeResourceID: fake.resource("usr-drama", "image", "image/png"), Description: "远景", ImagePrompt: "保持构图", VideoPrompt: "固定镜头"},
	}}
	if err := svc.repo.CopyRemakeAnalysis(detail.Project.ID, 1, remakeJSON(analysis), remakeJSON(analysis.Shots)); err != nil {
		t.Fatal(err)
	}
	detail, err = svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	return svc, fake, detail
}

func tickRemakeTest(t *testing.T, svc *Service, runID string, count int) {
	t.Helper()
	for range count {
		run, err := svc.repo.RemakeRunByID(runID)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Contains([]string{"queued", "running", "rendering", "paused", "cancelling"}, run.Status) {
			return
		}
		owner := "test-worker"
		claimed, err := svc.repo.ClaimRemakeRun(runID, owner, time.Minute)
		if err != nil || !claimed {
			t.Fatalf("claim: %v %v", claimed, err)
		}
		err = svc.advanceRemakeRun(context.Background(), runID, owner)
		releaseErr := svc.repo.ReleaseRemakeRun(runID, owner)
		if err != nil || releaseErr != nil {
			t.Fatalf("advance: %v; release: %v", err, releaseErr)
		}
	}
}

func TestRemakeReviewUsesEditedShotsAndCompletes(t *testing.T) {
	svc, fake, detail := newRemakeTestProject(t, "review")
	detail.Shots[0].ImagePrompt = "用户编辑后的镜头提示词"
	updated, err := svc.UpdateRemake("usr-drama", detail.Project.ID, UpdateRemakeRequest{ExpectedVersion: 1, Shots: &detail.Shots})
	if err != nil {
		t.Fatal(err)
	}
	started, err := svc.StartRemake("usr-drama", detail.Project.ID, StartRemakeRequest{ExpectedVersion: updated.Project.DraftVersion, IdempotencyKey: "review", Goal: "complete"})
	if err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, started.ActiveRun.ID, 8)
	reviewed, err := svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := reviewed.ActiveRun
	if run == nil || run.Status != "awaiting_review" || fake.byKind["image"] != 2 || fake.byKind["video"] != 0 {
		t.Fatalf("review gate: %+v / %v", run, fake.byKind)
	}
	if !strings.Contains(fake.requests[0].Prompt, "用户编辑后的镜头提示词") {
		t.Fatal("generation ignored edited draft")
	}
	selected, err := svc.SelectRemakeTakes("usr-drama", detail.Project.ID, run.ID, RemakeSelectionRequest{ExpectedSelectionVersion: run.SelectionVersion, Selections: run.Selections})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RemakeAction("usr-drama", detail.Project.ID, run.ID, RemakeActionRequest{Action: "approve_and_continue", ExpectedSelectionVersion: selected.ActiveRun.SelectionVersion}); err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, run.ID, 9)
	result, err := svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.ActiveRun != nil || result.Project.Status != "completed" || len(result.Exports) != 1 || fake.byKind["video"] != 2 || fake.byKind["render"] != 1 {
		t.Fatalf("pipeline: %+v / %v", result, fake.byKind)
	}
	if fake.renders[0].DurationMs != 4000 || len(fake.renders[0].Clips) != 2 {
		t.Fatalf("timeline: %+v", fake.renders[0])
	}
}

func TestRemakeQuickRunIsIdempotentAndScoped(t *testing.T) {
	svc, fake, detail := newRemakeTestProject(t, "quick")
	request := StartRemakeRequest{ExpectedVersion: 1, IdempotencyKey: "quick", Goal: "complete"}
	first, err := svc.StartRemake("usr-drama", detail.Project.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.StartRemake("usr-drama", detail.Project.ID, request)
	if err != nil || second.ActiveRun.ID != first.ActiveRun.ID || len(second.Runs) != 1 {
		t.Fatalf("idempotency: %v", err)
	}
	if _, err := svc.RemakeDetail("another-user", detail.Project.ID); err == nil {
		t.Fatal("cross-user read accepted")
	}
	request.IdempotencyKey = "concurrent"
	if _, err := svc.StartRemake("usr-drama", detail.Project.ID, request); err == nil {
		t.Fatal("parallel run accepted")
	}
	tickRemakeTest(t, svc, first.ActiveRun.ID, 15)
	result, err := svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil || result.Project.Status != "completed" || fake.byKind["render"] != 1 {
		t.Fatalf("quick pipeline: %v / %+v", err, result.ActiveRun)
	}
}

func TestRemakeAnalysisDoesNotRequireAudio(t *testing.T) {
	svc, _, detail := newRemakeTestProject(t, "review")
	settings := detail.Project.Settings
	settings.AudioMode = "original"
	run := model.RemakeRun{ID: "analysis-only", ProjectID: detail.Project.ID, UserID: "usr-drama", IdempotencyKey: "analysis", DraftVersion: 1, Status: "running", Goal: "analysis", SettingsJSON: remakeJSON(settings), AnalysisJSON: remakeJSON(detail.Analysis), ShotsJSON: remakeJSON(detail.Shots), SelectionsJSON: "{}"}
	if err := svc.repo.CreateRemakeRun(&run, 1); err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, run.ID, 1)
	saved, err := svc.repo.RemakeRunByID(run.ID)
	if err != nil || saved.Status != "completed" {
		t.Fatalf("silent analysis: %+v %v", saved, err)
	}
}

func TestRemakeImageReferencesRespectSubjectBinding(t *testing.T) {
	svc, _, detail := newRemakeTestProject(t, "review")
	refs, err := svc.remakeImageReferences("usr-drama", detail.Shots[1], detail.Project.Settings)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 {
		t.Fatalf("empty shot got %d references, want only its composition frame", len(refs))
	}
	refs, err = svc.remakeImageReferences("usr-drama", detail.Shots[0], detail.Project.Settings)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("bound shot got %d references, want composition plus replacement subject", len(refs))
	}
}

func TestRemakeCancelAccountsCompletedTaskBeforeStopping(t *testing.T) {
	svc, fake, detail := newRemakeTestProject(t, "quick")
	started, err := svc.StartRemake("usr-drama", detail.Project.ID, StartRemakeRequest{ExpectedVersion: 1, IdempotencyKey: "cancel", Goal: "complete"})
	if err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, started.ActiveRun.ID, 1)
	if _, err := svc.RemakeAction("usr-drama", detail.Project.ID, started.ActiveRun.ID, RemakeActionRequest{Action: "cancel"}); err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, started.ActiveRun.ID, 1)
	result, err := svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.ActiveRun != nil || result.Project.Status != "cancelled" || len(result.Takes) != 1 || fake.byKind["image"] != 1 || fake.byKind["video"] != 0 {
		t.Fatalf("cancel state: %+v / %v", result.ActiveRun, fake.byKind)
	}
}

func TestRemakeRejectsSelectionsFromAnotherRun(t *testing.T) {
	svc, fake, detail := newRemakeTestProject(t, "review")
	started, err := svc.StartRemake("usr-drama", detail.Project.ID, StartRemakeRequest{ExpectedVersion: 1, IdempotencyKey: "review", Goal: "complete"})
	if err != nil {
		t.Fatal(err)
	}
	tickRemakeTest(t, svc, started.ActiveRun.ID, 5)
	current, err := svc.RemakeDetail("usr-drama", detail.Project.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := current.ActiveRun
	var units []remake.GenerationUnit
	if err := json.Unmarshal([]byte(run.UnitsJSON), &units); err != nil {
		t.Fatal(err)
	}
	stale := model.RemakeTake{ID: "stale", RunID: "old-run", ProjectID: detail.Project.ID, StepID: "old-step", Kind: "image", UnitID: units[0].ID, ResourceID: fake.resource("usr-drama", "image", "image/png")}
	if err := fake.db.Create(&stale).Error; err != nil {
		t.Fatal(err)
	}
	run.Selections[units[0].ID] = RemakeSelection{ImageTakeID: stale.ID}
	if _, err := svc.SelectRemakeTakes("usr-drama", detail.Project.ID, run.ID, RemakeSelectionRequest{ExpectedSelectionVersion: run.SelectionVersion, Selections: run.Selections}); err == nil {
		t.Fatal("stale selection accepted")
	}
}
