package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/remake"
	"yingce/backend/internal/repository"
)

const (
	remakeTickInterval = 4 * time.Second
	remakeLeaseTTL     = 10 * time.Minute
	remakeRunBatch     = 20
)

var remakeWake = struct {
	once sync.Once
	ch   chan struct{}
}{}

func remakeWakeChannel() chan struct{} {
	remakeWake.once.Do(func() { remakeWake.ch = make(chan struct{}, 1) })
	return remakeWake.ch
}

func (s *Service) wakeRemakeScheduler() {
	select {
	case remakeWakeChannel() <- struct{}{}:
	default:
	}
}

func (s *Service) startRemakeScheduler() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(remakeTickInterval)
		defer ticker.Stop()
		for {
			s.tickRemakeRuns(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-remakeWakeChannel():
			}
		}
	})
}

func (s *Service) tickRemakeRuns(ctx context.Context) {
	if s.IsDraining() {
		return
	}
	runs, err := s.repo.ActiveRemakeRuns(remakeRunBatch)
	if err != nil {
		slog.Warn("remake scheduler load failed", "error", err)
		return
	}
	for i := range runs {
		if ctx.Err() != nil {
			return
		}
		owner := "remake:" + newID()
		claimed, err := s.repo.ClaimRemakeRun(runs[i].ID, owner, remakeLeaseTTL)
		if err != nil || !claimed {
			continue
		}
		if err := s.advanceRemakeRun(ctx, runs[i].ID, owner); err != nil {
			slog.Warn("remake scheduler step failed", "run", runs[i].ID, "error", err)
		}
		if err := s.repo.ReleaseRemakeRun(runs[i].ID, owner); err != nil {
			slog.Warn("remake scheduler lease release failed", "run", runs[i].ID, "error", err)
		}
	}
}

func (s *Service) advanceRemakeRun(ctx context.Context, runID, owner string) error {
	run, err := s.repo.RemakeRunByID(runID)
	if err != nil {
		return err
	}
	if run.Status == "cancelling" {
		return s.cancelRemakeRun(run, owner)
	}
	steps, err := s.repo.RemakeSteps(run.ID)
	if err != nil {
		return err
	}
	for i := range steps {
		step := &steps[i]
		if step.Status == "submitting" && step.TaskID == "" {
			return s.pauseRemakeRun(run, owner, "任务已提交但关联记录未完成，请检查创作历史后再重试，避免重复扣费")
		}
		if step.TaskID == "" || (step.Status != "queued" && step.Status != "running") {
			continue
		}
		task, err := s.repo.Task(step.TaskID)
		if err != nil {
			return err
		}
		switch task.Status {
		case model.TaskStatusQueued, model.TaskStatusRunning:
			return nil
		case model.TaskStatusSucceeded:
			cost, err := s.remakeTaskCost(task)
			if err != nil {
				return err
			}
			if err := s.applyRemakeStep(run, step, task, cost, owner); err != nil {
				return s.failRemakeRun(run, step, owner, err.Error(), cost)
			}
			if run.Status == "paused" {
				return nil
			}
			return nil
		case model.TaskStatusFailed, model.TaskStatusCancelled:
			cost, err := s.remakeTaskCost(task)
			if err != nil {
				return err
			}
			return s.failRemakeRun(run, step, owner, firstNonEmpty(task.Error, "生成任务失败"), cost)
		}
	}
	if run.Status == "paused" {
		return nil
	}
	if run.Status != "queued" && run.Status != "running" && run.Status != "rendering" {
		return nil
	}
	return s.dispatchRemakeStep(ctx, run, steps, owner)
}

func (s *Service) dispatchRemakeStep(ctx context.Context, run *model.RemakeRun, steps []model.RemakeStep, owner string) error {
	if err := s.RequireFeature(FeatureVideoRemake); err != nil {
		return s.pauseRemakeRun(run, owner, err.Error())
	}
	settings, err := parseRemakeSettings(run.SettingsJSON)
	if err != nil {
		return err
	}
	analysis, err := s.remakeRunAnalysis(ctx, run, settings, owner)
	if err != nil {
		return s.pauseRemakeRun(run, owner, "参考片分析失败："+err.Error())
	}
	if !remakeAnalysisComplete(analysis) {
		step := remakeStepByKey(steps, "analysis")
		if step == nil {
			step = &model.RemakeStep{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, StepKey: "analysis", Kind: "analysis", Status: "pending", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := s.repo.CreateRemakeStep(step); err != nil {
				return err
			}
		}
		refs := make([]any, 0, len(analysis.Shots))
		for index, shot := range analysis.Shots {
			if _, err := s.Resource(run.UserID, shot.KeyframeResourceID); err != nil {
				return err
			}
			ref, err := s.dramaResourceReference(shot.KeyframeResourceID, fmt.Sprintf("镜头%d", index+1), "")
			if err != nil {
				return err
			}
			refs = append(refs, ref)
		}
		prompt := remake.AnalysisPrompt(analysis, settings.TargetDescription, settings.Style)
		req := remakeTaskRequest(run, settings.Models.Text, "text", "text", prompt, refs, map[string]any{"systemPrompt": "你是视频镜头分析器。只按给定格式返回 JSON。"}, step)
		if err := s.submitRemakeStep(run, step, req, 0, owner); err != nil {
			if errors.Is(err, repository.ErrRemakeConflict) {
				return err
			}
			return s.pauseRemakeRun(run, owner, err.Error())
		}
		return nil
	}
	if run.Goal == "analysis" {
		return s.finishRemakeRun(run, owner, "completed", "analysis", "")
	}
	if settings.AudioMode == "original" && !analysis.HasAudio {
		return s.pauseRemakeRun(run, owner, "参考片没有音轨，请取消本次运行并调整音频模式后重新启动")
	}
	if run.ShotsJSON != "" {
		if err := json.Unmarshal([]byte(run.ShotsJSON), &analysis.Shots); err != nil {
			return s.pauseRemakeRun(run, owner, "保存的分镜格式无效")
		}
		if err := remake.ValidateAnalysis(analysis); err != nil {
			return s.pauseRemakeRun(run, owner, err.Error())
		}
	}
	settings.SourceInMs, settings.SourceOutMs = analysis.SourceInMs, analysis.SourceOutMs
	run.SettingsJSON = remakeJSON(settings)
	if err := s.repo.UpdateRemakeRun(run.ID, owner, map[string]any{"settings_json": run.SettingsJSON}); err != nil {
		return err
	}
	if run.UnitsJSON == "" {
		profile, err := s.dramaVideoProfile(settings.Models.Video)
		if err != nil {
			return s.pauseRemakeRun(run, owner, "视频模型不可用："+err.Error())
		}
		if settings.AudioMode == "generated" && !profile.GenerateAudio {
			return s.pauseRemakeRun(run, owner, "所选模型不支持生成音轨，请取消运行并修改音轨或模型后重新启动")
		}
		units, err := remake.BuildUnits(analysis.Shots, profile.Durations.Values, profile.Durations.Min, profile.Durations.Max)
		if err != nil {
			return s.pauseRemakeRun(run, owner, err.Error())
		}
		revision := &model.RemakeRevision{ID: newID(), ProjectID: run.ProjectID, UserID: run.UserID, DraftVersion: run.DraftVersion, SettingsJSON: run.SettingsJSON, AnalysisJSON: run.AnalysisJSON, ShotsJSON: remakeJSON(analysis.Shots), UnitsJSON: remakeJSON(units), CreatedAt: time.Now()}
		if err := s.repo.SaveRemakeRevision(run.ID, owner, revision); err != nil {
			return err
		}
		run.RevisionID, run.UnitsJSON = revision.ID, revision.UnitsJSON
	}
	var units []remake.GenerationUnit
	if err := json.Unmarshal([]byte(run.UnitsJSON), &units); err != nil || len(units) == 0 {
		return s.pauseRemakeRun(run, owner, "复刻计划无效，请重新分析参考片")
	}
	if err := s.syncRemakeSteps(run, units, steps, owner); err != nil {
		return err
	}
	steps, err = s.repo.RemakeSteps(run.ID)
	if err != nil {
		return err
	}
	if err := s.submitNextRemakeTask(run, settings, analysis, units, steps, owner); err != nil {
		if errors.Is(err, repository.ErrRemakeConflict) {
			return err
		}
		return s.pauseRemakeRun(run, owner, err.Error())
	}
	return nil
}

func (s *Service) remakeRunAnalysis(ctx context.Context, run *model.RemakeRun, settings RemakeSettings, owner string) (remake.Analysis, error) {
	var analysis remake.Analysis
	if run.AnalysisJSON != "" {
		if err := json.Unmarshal([]byte(run.AnalysisJSON), &analysis); err != nil {
			return analysis, err
		}
		if remakeAnalysisComplete(analysis) || len(analysis.Shots) > 0 {
			return analysis, nil
		}
	}
	var err error
	analysis, err = s.inspectRemakeMedia(ctx, run.UserID, run.SourceResourceID, settings.SourceInMs, settings.SourceOutMs)
	if err != nil {
		return analysis, err
	}
	run.AnalysisJSON, run.ShotsJSON = remakeJSON(analysis), remakeJSON(analysis.Shots)
	if err := s.repo.UpdateRemakeRun(run.ID, owner, map[string]any{"analysis_json": run.AnalysisJSON, "shots_json": run.ShotsJSON, "stage": "analysis"}); err != nil {
		return analysis, err
	}
	refs := []model.RemakeResourceReference{}
	for _, shot := range analysis.Shots {
		refs = append(refs, remakeRefs(run.UserID, run.ProjectID, "frame", shot.KeyframeResourceID)...)
	}
	if err := s.repo.AddRemakeResourceReferences(refs); err != nil {
		return analysis, err
	}
	return analysis, nil
}

func remakeAnalysisComplete(analysis remake.Analysis) bool {
	if len(analysis.Shots) == 0 {
		return false
	}
	for _, shot := range analysis.Shots {
		if strings.TrimSpace(shot.Description) == "" || strings.TrimSpace(shot.ImagePrompt) == "" || strings.TrimSpace(shot.VideoPrompt) == "" {
			return false
		}
	}
	return true
}

func (s *Service) syncRemakeSteps(run *model.RemakeRun, units []remake.GenerationUnit, steps []model.RemakeStep, owner string) error {
	_ = owner
	for _, unit := range units {
		for _, kind := range []string{"image", "video"} {
			key := kind + ":" + unit.ID
			found := false
			for _, step := range steps {
				if step.StepKey == key {
					found = true
					break
				}
			}
			if found {
				continue
			}
			if kind == "video" && run.Status == "awaiting_review" {
				continue
			}
			if err := s.repo.CreateRemakeStep(&model.RemakeStep{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, StepKey: key, Kind: kind, ShotID: unit.SourceShotID, UnitID: unit.ID, Status: "pending", CreatedAt: time.Now(), UpdatedAt: time.Now()}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) submitNextRemakeTask(run *model.RemakeRun, settings RemakeSettings, analysis remake.Analysis, units []remake.GenerationUnit, steps []model.RemakeStep, owner string) error {
	selections, err := parseRemakeSelections(run.SelectionsJSON)
	if err != nil {
		return err
	}
	imagesDone := true
	for _, unit := range units {
		step := remakeStepByKey(steps, "image:"+unit.ID)
		if step == nil || step.Status != "succeeded" {
			imagesDone = false
			break
		}
	}
	if !imagesDone {
		for _, unit := range units {
			step := remakeStepByKey(steps, "image:"+unit.ID)
			if step == nil || step.Status == "succeeded" || step.Status == "running" || step.Status == "queued" {
				continue
			}
			shot := remakeShotByID(analysis.Shots, unit.SourceShotID)
			if shot == nil {
				return errors.New("生成单元缺少源镜头")
			}
			refs, err := s.remakeImageReferences(run.UserID, *shot, settings)
			if err != nil {
				return err
			}
			prompt := remake.KeyframePrompt(*shot, settings.TargetDescription, settings.Style)
			req := remakeTaskRequest(run, settings.Models.Image, "image", "image_to_image", prompt, refs, map[string]any{"size": settings.AspectRatio}, step)
			return s.submitRemakeStep(run, step, req, 0, owner)
		}
	}
	if !imagesDone {
		return nil
	}
	if run.Mode == "quick" && !run.Approved {
		takes, err := s.repo.RemakeTakes(run.ProjectID)
		if err != nil {
			return err
		}
		for _, unit := range units {
			var selected model.RemakeTake
			for _, take := range takes {
				if take.RunID == run.ID && take.UnitID == unit.ID && take.Kind == "image" {
					selected = take
					break
				}
			}
			if selected.ID == "" {
				return errors.New("关键帧任务完成但没有可用产物")
			}
			selections[unit.ID] = RemakeSelection{ImageTakeID: selected.ID}
		}
		if err := s.repo.UpdateRemakeRun(run.ID, owner, map[string]any{"approved": true, "selections_json": remakeJSON(selections)}); err != nil {
			return err
		}
		run.Approved, run.SelectionsJSON = true, remakeJSON(selections)
	}
	if !run.Approved {
		if run.Status != "awaiting_review" {
			return s.setRemakeRunState(run, owner, "awaiting_review", "review", "", map[string]any{"selections_json": remakeJSON(selections)})
		}
		return nil
	}
	if run.Goal == "keyframes" {
		return s.finishRemakeRun(run, owner, "completed", "keyframes", "")
	}
	videosDone := true
	for _, unit := range units {
		step := remakeStepByKey(steps, "video:"+unit.ID)
		if step == nil || step.Status != "succeeded" {
			videosDone = false
			break
		}
	}
	if !videosDone {
		for _, unit := range units {
			step := remakeStepByKey(steps, "video:"+unit.ID)
			if step == nil || step.Status == "succeeded" || step.Status == "running" || step.Status == "queued" {
				continue
			}
			selection := selections[unit.ID]
			take, err := s.repo.RemakeTake(run.ProjectID, selection.ImageTakeID)
			if err != nil || take.RunID != run.ID || take.UnitID != unit.ID || take.Kind != "image" {
				return errors.New("已选择的关键帧与生成单元不匹配")
			}
			shot := remakeShotByID(analysis.Shots, unit.SourceShotID)
			if shot == nil {
				return errors.New("生成单元缺少源镜头")
			}
			refs, err := s.remakeVideoReferences(run.UserID, take.ResourceID)
			if err != nil {
				return err
			}
			profile, err := s.dramaVideoProfile(settings.Models.Video)
			if err != nil {
				return err
			}
			operation := "text_to_video"
			if profile.supports("image_to_video") {
				operation = "image_to_video"
			} else if profile.supports("reference_to_video") {
				operation = "reference_to_video"
			} else {
				return errors.New("所选视频模型不支持关键帧参考生成")
			}
			config := map[string]any{"videoSeconds": strconv.Itoa(int(unit.RequestedDurationMs / 1000)), "videoGenerateAudio": strconv.FormatBool(settings.AudioMode == "generated" && profile.GenerateAudio)}
			screen := profile.screen(settings.AspectRatio, settings.VideoResolution)
			if screen.Issue != "" {
				return errors.New(screen.Issue)
			}
			screen.apply(config)
			prompt := remake.VideoPrompt(*shot, unit)
			return s.submitRemakeStep(run, step, remakeTaskRequest(run, settings.Models.Video, "video", operation, prompt, refs, config, step), 0, owner)
		}
	}
	if !videosDone {
		return nil
	}
	if step := remakeStepByKey(steps, "render"); step == nil || step.Status != "succeeded" {
		if step == nil {
			step = &model.RemakeStep{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, StepKey: "render", Kind: "render", Status: "pending", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := s.repo.CreateRemakeStep(step); err != nil {
				return err
			}
		}
		if step.Status == "running" || step.Status == "queued" || step.Status == "submitting" {
			return nil
		}
		timeline, err := s.remakeTimeline(run, settings, units, steps)
		if err != nil {
			return err
		}
		var task *model.Task
		if err := s.repo.BeginRemakeStep(run.ID, owner, step.ID, 0); err != nil {
			return err
		}
		if s.remakeTaskHook != nil {
			task, err = s.remakeTaskHook(run.UserID, CreateTaskRequest{Type: model.TaskTypeTimelineRender}, &timeline)
		} else {
			task, err = s.CreateTimelineRenderTask(run.UserID, TimelineRenderCreateRequest{Timeline: timeline})
			if err == nil {
				s.wakeTaskDispatcher()
			}
		}
		if err != nil {
			if resetErr := s.repo.UpdateRemakeStep(step.ID, map[string]any{"status": "pending", "error": truncateRunes(err.Error(), 500)}); resetErr != nil {
				return resetErr
			}
			return err
		}
		if err := s.repo.UpdateRemakeStep(step.ID, map[string]any{"status": "running", "task_id": task.ID}); err != nil {
			return err
		}
		return s.setRemakeRunState(run, owner, "rendering", "render", "", nil)
	}
	return nil
}

func (s *Service) remakeImageReferences(userID string, shot remake.SourceShot, settings RemakeSettings) ([]any, error) {
	ids := []string{shot.KeyframeResourceID}
	if shot.SubjectPresent {
		ids = append(ids, settings.TargetResourceIDs...)
	}
	refs := make([]any, 0, len(ids))
	for index, id := range ids {
		if _, err := s.Resource(userID, id); err != nil {
			return nil, err
		}
		name, role := fmt.Sprintf("参考图%d", index+1), ""
		if index == 0 {
			name, role = "原镜头构图", "composition"
		} else {
			name, role = fmt.Sprintf("目标主体%d", index), "subject"
		}
		ref, err := s.dramaResourceReference(id, name, role)
		if err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

func (s *Service) remakeVideoReferences(userID, imageID string) ([]any, error) {
	if _, err := s.Resource(userID, imageID); err != nil {
		return nil, err
	}
	ref, err := s.dramaResourceReference(imageID, "新主体关键帧", "first_frame")
	if err != nil {
		return nil, err
	}
	return []any{ref}, nil
}

func remakeTaskRequest(run *model.RemakeRun, choice RemakeModelChoice, capability, operation, prompt string, refs []any, config map[string]any, step *model.RemakeStep) CreateTaskRequest {
	if config == nil {
		config = map[string]any{}
	}
	if choice.ChannelID != "" {
		config["channelId"], config["model"], config["channelModelKey"] = choice.ChannelID, choice.ModelKey, choice.ModelKey
	}
	metadata := map[string]any{"source": "remake", "remakeProjectId": run.ProjectID, "remakeRunId": run.ID, "remakeStepId": step.ID, "remakeStepKey": step.StepKey}
	input := map[string]any{"config": config, "mode": capability, "prompt": prompt, "metadata": metadata}
	if len(refs) > 0 {
		input["referenceImages"] = refs
	}
	return CreateTaskRequest{Type: "canvas_" + capability, Operation: operation, Prompt: prompt, LogicalModelID: choice.LogicalModelID, Model: choice.ModelKey, Input: input}
}

func (s *Service) submitRemakeStep(run *model.RemakeRun, step *model.RemakeStep, req CreateTaskRequest, estimatedCost int64, owner string) error {
	if run.BudgetMicrocredits > 0 && estimatedCost == 0 && req.Type != model.TaskTypeTimelineRender {
		choice := RemakeModelChoice{LogicalModelID: req.LogicalModelID}
		if config, ok := req.Input["config"].(map[string]any); ok {
			choice.ChannelID, choice.ModelKey = stringValue(config["channelId"]), stringValue(config["model"])
		}
		intent := ModelRequestIntentFromTaskInput(req.Input, req.Type, req.Operation)
		quote, found := s.quoteDramaChoice(run.UserID, choice, intent)
		if !found {
			return errors.New("无法取得本次模型调用报价，未提交生成任务")
		}
		estimatedCost = quote
	}
	if run.BudgetMicrocredits > 0 && run.SpentMicrocredits+run.ReservedMicrocredits+estimatedCost > run.BudgetMicrocredits {
		return errors.New("预计费用将超过预算上限，请取消本次运行并调整预算后重新启动")
	}
	var task *model.Task
	if err := s.repo.BeginRemakeStep(run.ID, owner, step.ID, estimatedCost); err != nil {
		return err
	}
	run.ReservedMicrocredits = estimatedCost
	var err error
	if s.remakeTaskHook != nil {
		task, err = s.remakeTaskHook(run.UserID, req, nil)
	} else {
		task, err = s.CreateTask(run.UserID, req)
		if err == nil {
			s.wakeTaskDispatcher()
		}
	}
	if err != nil {
		if resetErr := s.repo.UpdateRemakeStep(step.ID, map[string]any{"status": "pending", "error": truncateRunes(err.Error(), 500)}); resetErr != nil {
			return resetErr
		}
		if estimatedCost > 0 {
			if resetErr := s.repo.UpdateRemakeRun(run.ID, owner, map[string]any{"reserved_microcredits": 0}); resetErr != nil {
				return resetErr
			}
			run.ReservedMicrocredits = 0
		}
		return err
	}
	if err := s.repo.UpdateRemakeStep(step.ID, map[string]any{"status": "running", "task_id": task.ID, "error": ""}); err != nil {
		return err
	}
	step.Status, step.TaskID = "running", task.ID
	return s.setRemakeRunState(run, owner, "running", step.Kind, "", nil)
}

func (s *Service) applyRemakeStep(run *model.RemakeRun, step *model.RemakeStep, task *model.Task, cost int64, owner string) error {
	spent := run.SpentMicrocredits + cost
	fields := map[string]any{"stage": step.Kind, "error": ""}
	var take *model.RemakeTake
	var output *model.RemakeExport
	switch step.Kind {
	case "analysis":
		var baseline remake.Analysis
		if err := json.Unmarshal([]byte(run.AnalysisJSON), &baseline); err != nil {
			return err
		}
		text, err := dramaTaskText(task)
		if err != nil {
			return err
		}
		analysis, err := remake.ParseAnalysis(text, baseline)
		if err != nil {
			return err
		}
		run.AnalysisJSON, run.ShotsJSON = remakeJSON(analysis), remakeJSON(analysis.Shots)
		fields["analysis_json"], fields["shots_json"] = run.AnalysisJSON, run.ShotsJSON
	case "image", "video":
		resourceID := dramaTaskResource(task)
		if resourceID == "" {
			return errors.New("生成任务没有返回已保存的媒体资源")
		}
		resource, err := s.Resource(run.UserID, resourceID)
		if err != nil {
			return err
		}
		want := "image/"
		if step.Kind == "video" {
			want = "video/"
		}
		if !strings.HasPrefix(resource.MimeType, want) || resource.Status != model.ResourceStatusReady {
			return errors.New("生成结果媒体类型无效或资源未就绪")
		}
		var units []remake.GenerationUnit
		if err := json.Unmarshal([]byte(run.UnitsJSON), &units); err != nil {
			return err
		}
		unit := remakeUnitByID(units, step.UnitID)
		if unit == nil {
			return errors.New("生成结果缺少对应镜头")
		}
		kind := step.Kind
		take = &model.RemakeTake{ID: newID(), ProjectID: run.ProjectID, RunID: run.ID, StepID: step.ID, ShotID: unit.SourceShotID, UnitID: unit.ID, Kind: kind, ResourceID: resourceID, TaskID: task.ID, RequestedDurationMs: unit.RequestedDurationMs, DurationMs: resource.DurationMs, InputHash: step.InputHash, CreatedAt: time.Now()}
		step.ResourceID = resourceID
		{
			selections, err := parseRemakeSelections(run.SelectionsJSON)
			if err != nil {
				return err
			}
			selection := selections[unit.ID]
			if kind == "image" {
				selection.ImageTakeID = take.ID
			} else {
				selection.VideoTakeID = take.ID
			}
			selections[unit.ID] = selection
			run.SelectionsJSON = remakeJSON(selections)
			fields["selections_json"] = run.SelectionsJSON
		}
	case "render":
		var result timelineRenderResult
		if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil || result.ResourceID == "" || result.DurationMs <= 0 {
			return errors.New("成片渲染未返回有效视频")
		}
		resource, err := s.Resource(run.UserID, result.ResourceID)
		if err != nil || !strings.HasPrefix(resource.MimeType, "video/") || resource.Status != model.ResourceStatusReady {
			return errors.New("成片资源无效或未就绪")
		}
		manifest, _ := json.Marshal(map[string]any{"revisionId": run.RevisionID, "shots": json.RawMessage(run.ShotsJSON), "units": json.RawMessage(run.UnitsJSON), "selections": json.RawMessage(run.SelectionsJSON)})
		output = &model.RemakeExport{ID: newID(), ProjectID: run.ProjectID, RunID: run.ID, StepID: step.ID, ResourceID: result.ResourceID, SubtitleSRT: result.SubtitleSRT, DurationMs: result.DurationMs, ManifestJSON: string(manifest), CreatedAt: time.Now()}
		step.ResourceID = output.ResourceID
		fields["status"], fields["stage"] = "completed", "complete"
	default:
		return fmt.Errorf("不支持的复刻步骤：%s", step.Kind)
	}
	if run.BudgetMicrocredits > 0 && spent > run.BudgetMicrocredits && step.Kind != "render" {
		fields["status"], fields["error"] = "needs_attention", "实际费用超过预算，已保存本项结果和费用并停止后续生成；请取消运行后调整预算"
	}
	step.Status, step.Error = "succeeded", ""
	return s.repo.CommitRemakeStep(run.ID, owner, step, cost, fields, take, output)
}

func (s *Service) remakeTaskCost(task *model.Task) (int64, error) {
	if task.BillingOrderID == "" {
		return 0, nil
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		return 0, err
	}
	if order.Status == model.BillingStatusRefunded {
		return 0, nil
	}
	return order.AmountMicrocredits, nil
}

func (s *Service) failRemakeRun(run *model.RemakeRun, step *model.RemakeStep, owner, reason string, cost int64) error {
	step.Status, step.Error = "failed", truncateRunes(reason, 500)
	status := "partial_failed"
	if run.Status == "cancelling" {
		status = "cancelling"
	}
	return s.repo.CommitRemakeStep(run.ID, owner, step, cost, map[string]any{"status": status, "stage": step.Kind, "error": step.Error}, nil, nil)
}

func (s *Service) pauseRemakeRun(run *model.RemakeRun, owner, reason string) error {
	return s.setRemakeRunState(run, owner, "needs_attention", run.Stage, reason, map[string]any{"reserved_microcredits": 0})
}

func (s *Service) finishRemakeRun(run *model.RemakeRun, owner, status, stage, reason string) error {
	return s.setRemakeRunState(run, owner, status, stage, reason, nil)
}

func (s *Service) setRemakeRunState(run *model.RemakeRun, owner, status, stage, reason string, extra map[string]any) error {
	fields := map[string]any{"status": status, "stage": stage, "error": truncateRunes(reason, 500)}
	for key, value := range extra {
		fields[key] = value
	}
	allowed := []string{"queued", "running", "rendering"}
	if status == "cancelled" {
		allowed = append(allowed, "cancelling")
	}
	if err := s.repo.TransitionRemakeRun(run.ID, owner, allowed, fields); err != nil {
		return err
	}
	run.Status, run.Stage, run.Error = status, stage, reason
	return s.repo.UpdateRemakeProjectProgress(run.ProjectID, map[string]any{"status": status, "stage": stage, "error": truncateRunes(reason, 500)})
}

func (s *Service) cancelRemakeRun(run *model.RemakeRun, owner string) error {
	steps, err := s.repo.RemakeSteps(run.ID)
	if err != nil {
		return err
	}
	pending := false
	for _, step := range steps {
		if step.TaskID == "" || (step.Status != "submitting" && step.Status != "queued" && step.Status != "running") {
			continue
		}
		task, err := s.repo.Task(step.TaskID)
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			if _, err := s.CancelTask(context.Background(), run.UserID, task.ID); err != nil {
				return err
			}
			pending = true
			continue
		}
		if task.Status == model.TaskStatusSucceeded {
			cost, err := s.remakeTaskCost(task)
			if err != nil {
				return err
			}
			if err := s.applyRemakeStep(run, &step, task, cost, owner); err != nil {
				if err := s.failRemakeRun(run, &step, owner, err.Error(), cost); err != nil {
					return err
				}
			}
		} else if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
			cost, err := s.remakeTaskCost(task)
			if err != nil {
				return err
			}
			step.Status, step.Error = "failed", firstNonEmpty(task.Error, "生成任务已取消")
			if err := s.repo.CommitRemakeStep(run.ID, owner, &step, cost, map[string]any{"status": "cancelling", "stage": run.Stage, "error": ""}, nil, nil); err != nil {
				return err
			}
		}
	}
	if pending {
		return nil
	}
	return s.setRemakeRunState(run, owner, "cancelled", run.Stage, "", map[string]any{"reserved_microcredits": 0})
}

func (s *Service) remakeTimeline(run *model.RemakeRun, settings RemakeSettings, units []remake.GenerationUnit, steps []model.RemakeStep) (renderProject, error) {
	w, h := remakeOutputSize(settings.AspectRatio)
	project := renderProject{Version: 2, Width: w, Height: h, Tracks: []renderTrack{{ID: "remake-video", Kind: "video"}}, Clips: []renderClip{}}
	byUnit := map[string]model.RemakeTake{}
	takes, err := s.repo.RemakeTakes(run.ProjectID)
	if err != nil {
		return project, err
	}
	for _, take := range takes {
		if take.RunID == run.ID && take.Kind == "video" {
			byUnit[take.UnitID] = take
		}
	}
	var timelineMs int64
	for index, unit := range units {
		step := remakeStepByKey(steps, "video:"+unit.ID)
		if step == nil || step.ResourceID == "" {
			return project, fmt.Errorf("第 %d 个生成单元缺少已采用视频", index+1)
		}
		take, ok := byUnit[unit.ID]
		if !ok {
			return project, fmt.Errorf("第 %d 个生成单元的视频记录不存在", index+1)
		}
		resource, err := s.Resource(run.UserID, take.ResourceID)
		if err != nil || !strings.HasPrefix(resource.MimeType, "video/") || resource.Status != model.ResourceStatusReady {
			return project, fmt.Errorf("第 %d 个生成单元的视频资源不可用", index+1)
		}
		if resource.DurationMs > 0 && resource.DurationMs < unit.TargetDurationMs {
			return project, fmt.Errorf("第 %d 个镜头的视频时长短于剪辑区间，无法合成完整成片", index+1)
		}
		project.Clips = append(project.Clips, renderClip{ID: unit.ID, Kind: "video", TrackID: "remake-video", StartMs: timelineMs, DurationMs: unit.TargetDurationMs, SourceStartMs: 0, SourceDurationMs: max(resource.DurationMs, unit.RequestedDurationMs), Volume: map[bool]float64{true: -1, false: 0}[settings.AudioMode == "mute" || settings.AudioMode == "original"], DirectMedia: &struct {
			ID         string `json:"id"`
			Kind       string `json:"kind"`
			StorageKey string `json:"storageKey"`
		}{ID: take.ResourceID, Kind: "video", StorageKey: "resource:" + take.ResourceID}})
		timelineMs += unit.TargetDurationMs
	}
	if settings.AudioMode == "original" {
		project.Tracks = append(project.Tracks, renderTrack{ID: "remake-audio", Kind: "audio"})
		project.Clips = append(project.Clips, renderClip{ID: "remake-original-audio", Kind: "audio", TrackID: "remake-audio", StartMs: 0, DurationMs: timelineMs, SourceStartMs: settings.SourceInMs, SourceDurationMs: settings.SourceOutMs - settings.SourceInMs, Volume: 1, DirectMedia: &struct {
			ID         string `json:"id"`
			Kind       string `json:"kind"`
			StorageKey string `json:"storageKey"`
		}{ID: run.SourceResourceID, Kind: "video", StorageKey: "resource:" + run.SourceResourceID}})
	}
	project.DurationMs = timelineMs
	return project, nil
}

func remakeOutputSize(ratio string) (int, int) {
	switch ratio {
	case "9:16":
		return 1080, 1920
	case "1:1":
		return 1080, 1080
	default:
		return 1920, 1080
	}
}

func remakeStepByKey(steps []model.RemakeStep, key string) *model.RemakeStep {
	for i := range steps {
		if steps[i].StepKey == key {
			return &steps[i]
		}
	}
	return nil
}

func remakeShotByID(shots []remake.SourceShot, id string) *remake.SourceShot {
	for i := range shots {
		if shots[i].ID == id {
			return &shots[i]
		}
	}
	return nil
}

func remakeUnitByID(units []remake.GenerationUnit, id string) *remake.GenerationUnit {
	for i := range units {
		if units[i].ID == id {
			return &units[i]
		}
	}
	return nil
}
