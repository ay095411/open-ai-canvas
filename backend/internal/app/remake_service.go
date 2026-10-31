package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/remake"
	"yingce/backend/internal/repository"
)

func remakeError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &AppError{Status: 404, Code: 404, Message: "复刻项目或记录不存在", Reason: "remake_not_found"}
	}
	if errors.Is(err, repository.ErrRemakeConflict) {
		return &AppError{Status: 409, Code: 409, Message: err.Error(), Reason: "remake_version_conflict"}
	}
	return err
}

func (s *Service) requireRemake(userID, id string) (*model.RemakeProject, error) {
	if err := s.RequireFeature(FeatureVideoRemake); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, BadAuthRequest("缺少登录身份")
	}
	row, err := s.repo.RemakeProject(userID, id)
	return row, remakeError(err)
}

func (s *Service) validateRemakeSettings(userID string, settings RemakeSettings) error {
	if settings.SourceInMs < 0 || settings.SourceOutMs < 0 || (settings.SourceOutMs > 0 && (settings.SourceOutMs <= settings.SourceInMs || settings.SourceOutMs-settings.SourceInMs > 60_000)) {
		return BadAuthRequest("复刻区间需为有效的 60 秒以内视频片段")
	}
	if settings.AspectRatio != "9:16" && settings.AspectRatio != "16:9" && settings.AspectRatio != "1:1" {
		return BadAuthRequest("请选择有效画幅")
	}
	if settings.AudioMode != "original" && settings.AudioMode != "generated" && settings.AudioMode != "mute" {
		return BadAuthRequest("请选择有效音频模式")
	}
	if settings.Mode != "quick" && settings.Mode != "review" {
		return BadAuthRequest("请选择快速或精修模式")
	}
	if settings.BudgetMicrocredits < 0 || settings.BudgetMicrocredits > 1_000_000_000_000 {
		return BadAuthRequest("预算无效")
	}
	if utf8.RuneCountInString(settings.TargetDescription) > 2000 || utf8.RuneCountInString(settings.Style) > 2000 {
		return BadAuthRequest("主体或风格描述过长")
	}
	if len(settings.TargetResourceIDs) > 4 {
		return BadAuthRequest("同一主体最多选择四张参考图")
	}
	seen := map[string]bool{}
	for _, id := range settings.TargetResourceIDs {
		if id == "" || seen[id] {
			return BadAuthRequest("主体参考图无效或重复")
		}
		seen[id] = true
		resource, err := s.Resource(userID, id)
		if err != nil {
			return err
		}
		if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
			return BadAuthRequest("主体参考素材必须是图片")
		}
	}
	for _, choice := range []RemakeModelChoice{settings.Models.Text, settings.Models.Image, settings.Models.Video} {
		if choice.LogicalModelID != "" && (choice.ChannelID != "" || choice.ModelKey != "") {
			return BadAuthRequest("逻辑模型与渠道模型不能同时指定")
		}
		if (choice.ChannelID == "") != (choice.ModelKey == "") {
			return BadAuthRequest("渠道模型选择不完整")
		}
	}
	return nil
}

func remakeRefs(userID, projectID, kind string, ids ...string) []model.RemakeResourceReference {
	refs := []model.RemakeResourceReference{}
	for _, id := range ids {
		if id != "" {
			refs = append(refs, model.RemakeResourceReference{UserID: userID, ProjectID: projectID, ResourceID: id, Kind: kind})
		}
	}
	return refs
}

func (s *Service) CreateRemake(userID string, req CreateRemakeRequest) (RemakeDetail, error) {
	if err := s.RequireFeature(FeatureVideoRemake); err != nil {
		return RemakeDetail{}, err
	}
	if strings.TrimSpace(userID) == "" {
		return RemakeDetail{}, BadAuthRequest("缺少登录身份")
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || utf8.RuneCountInString(title) > 160 {
		return RemakeDetail{}, BadAuthRequest("复刻名称需为 1–160 个字符")
	}
	resource, err := s.Resource(userID, strings.TrimSpace(req.SourceResourceID))
	if err != nil {
		return RemakeDetail{}, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "video/") {
		return RemakeDetail{}, BadAuthRequest("请选择视频作为参考片")
	}
	if err := s.validateRemakeSettings(userID, req.Settings); err != nil {
		return RemakeDetail{}, err
	}
	row := model.RemakeProject{ID: newID(), UserID: userID, Title: title, SourceResourceID: resource.ID, SettingsJSON: remakeJSON(req.Settings), DraftVersion: 1, Status: "draft", Stage: "source", ShotsJSON: "[]"}
	refs := append(remakeRefs(userID, row.ID, "source", resource.ID), remakeRefs(userID, row.ID, "target", req.Settings.TargetResourceIDs...)...)
	if err := s.repo.CreateRemake(&row, refs); err != nil {
		return RemakeDetail{}, err
	}
	return s.RemakeDetail(userID, row.ID)
}

func (s *Service) ListRemakes(userID, query, status string, page, size int) (map[string]any, error) {
	if err := s.RequireFeature(FeatureVideoRemake); err != nil {
		return nil, err
	}
	if page < 1 || size < 1 || size > 100 || len(query) > 500 {
		return nil, BadAuthRequest("列表查询参数无效")
	}
	rows, count, err := s.repo.ListRemakes(userID, query, status, page, size)
	if err != nil {
		return nil, err
	}
	items := []RemakeProjectView{}
	for _, row := range rows {
		settings, err := parseRemakeSettings(row.SettingsJSON)
		if err != nil {
			return nil, err
		}
		items = append(items, RemakeProjectView{row, settings})
	}
	return map[string]any{"items": items, "total": count, "page": page, "pageSize": size}, nil
}

func (s *Service) remakeRunView(row model.RemakeRun) (RemakeRunView, error) {
	steps, err := s.repo.RemakeSteps(row.ID)
	if err != nil {
		return RemakeRunView{}, err
	}
	selections, err := parseRemakeSelections(row.SelectionsJSON)
	if err != nil {
		return RemakeRunView{}, err
	}
	view := RemakeRunView{RemakeRun: row, Steps: steps, Selections: selections, TotalSteps: len(steps)}
	for _, step := range steps {
		if step.Status == "succeeded" {
			view.CompletedSteps++
		}
	}
	return view, nil
}

func (s *Service) RemakeDetail(userID, id string) (RemakeDetail, error) {
	row, err := s.requireRemake(userID, id)
	if err != nil {
		return RemakeDetail{}, err
	}
	settings, err := parseRemakeSettings(row.SettingsJSON)
	if err != nil {
		return RemakeDetail{}, err
	}
	out := RemakeDetail{Project: RemakeProjectView{*row, settings}, Shots: []remake.SourceShot{}, Runs: []RemakeRunView{}}
	if row.AnalysisJSON != "" {
		var a remake.Analysis
		if err := json.Unmarshal([]byte(row.AnalysisJSON), &a); err != nil {
			return out, err
		}
		out.Analysis = &a
	}
	if row.ShotsJSON != "" {
		if err := json.Unmarshal([]byte(row.ShotsJSON), &out.Shots); err != nil {
			return out, err
		}
	}
	runs, err := s.repo.RemakeRuns(id)
	if err != nil {
		return out, err
	}
	for _, run := range runs {
		view, err := s.remakeRunView(run)
		if err != nil {
			return out, err
		}
		out.Runs = append(out.Runs, view)
		if out.ActiveRun == nil && !remakeRunTerminal(run.Status) {
			copy := view
			out.ActiveRun = &copy
		}
	}
	out.Takes, err = s.repo.RemakeTakes(id)
	if err != nil {
		return out, err
	}
	out.Exports, err = s.repo.RemakeExports(id)
	return out, err
}

func (s *Service) UpdateRemake(userID, id string, req UpdateRemakeRequest) (RemakeDetail, error) {
	row, err := s.requireRemake(userID, id)
	if err != nil {
		return RemakeDetail{}, err
	}
	fields := map[string]any{}
	refs := []model.RemakeResourceReference{}
	intervalChanged := false
	if req.Title != nil {
		value := strings.TrimSpace(*req.Title)
		if value == "" || utf8.RuneCountInString(value) > 160 {
			return RemakeDetail{}, BadAuthRequest("复刻名称无效")
		}
		fields["title"] = value
	}
	if req.Settings != nil {
		if err := s.validateRemakeSettings(userID, *req.Settings); err != nil {
			return RemakeDetail{}, err
		}
		fields["settings_json"] = remakeJSON(*req.Settings)
		refs = remakeRefs(userID, id, "target", req.Settings.TargetResourceIDs...)
		old, e := parseRemakeSettings(row.SettingsJSON)
		if e != nil {
			return RemakeDetail{}, e
		}
		if old.SourceInMs != req.Settings.SourceInMs || old.SourceOutMs != req.Settings.SourceOutMs {
			intervalChanged = true
			fields["analysis_json"] = ""
			fields["shots_json"] = "[]"
		}
	}
	if req.Shots != nil {
		if intervalChanged {
			return RemakeDetail{}, BadAuthRequest("修改参考片区间后请重新分析，不能同时保存旧分镜")
		}
		var analysis remake.Analysis
		if row.AnalysisJSON == "" || json.Unmarshal([]byte(row.AnalysisJSON), &analysis) != nil {
			return RemakeDetail{}, BadAuthRequest("请先完成参考片分析")
		}
		analysis.Shots = *req.Shots
		if err := remake.ValidateAnalysis(analysis); err != nil {
			return RemakeDetail{}, BadAuthRequest(err.Error())
		}
		for _, shot := range *req.Shots {
			if strings.TrimSpace(shot.Description) == "" || strings.TrimSpace(shot.ImagePrompt) == "" || strings.TrimSpace(shot.VideoPrompt) == "" || shot.KeyframeResourceID == "" {
				return RemakeDetail{}, BadAuthRequest("每个镜头必须包含描述、生成提示词和关键帧")
			}
			if shot.KeyframeResourceID != "" {
				resource, e := s.Resource(userID, shot.KeyframeResourceID)
				if e != nil {
					return RemakeDetail{}, e
				}
				if !strings.HasPrefix(resource.MimeType, "image/") {
					return RemakeDetail{}, BadAuthRequest("关键帧必须是图片")
				}
				refs = append(refs, remakeRefs(userID, id, "frame", shot.KeyframeResourceID)...)
			}
		}
		fields["shots_json"] = remakeJSON(*req.Shots)
	}
	if len(fields) == 0 {
		return RemakeDetail{}, BadAuthRequest("没有可保存的更改")
	}
	if err := s.repo.UpdateRemakeDraft(userID, id, req.ExpectedVersion, fields, refs); err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	return s.RemakeDetail(userID, id)
}

func (s *Service) DeleteRemake(userID, id string) error {
	if _, err := s.requireRemake(userID, id); err != nil {
		return err
	}
	return remakeError(s.repo.DeleteRemake(userID, id))
}

func remakeRunTerminal(status string) bool {
	return status == "completed" || status == "cancelled" || status == "failed"
}

func (s *Service) RemakeModels(userID string) (DramaModelCatalog, error) {
	if err := s.RequireFeature(FeatureVideoRemake); err != nil {
		return DramaModelCatalog{}, err
	}
	return s.DramaModelCatalog(userID)
}

func (s *Service) RemakeRunDetail(userID, projectID, runID string) (RemakeRunView, error) {
	if _, err := s.requireRemake(userID, projectID); err != nil {
		return RemakeRunView{}, err
	}
	run, err := s.repo.RemakeRun(userID, projectID, runID)
	if err != nil {
		return RemakeRunView{}, remakeError(err)
	}
	return s.remakeRunView(*run)
}

func (s *Service) StartRemake(userID, id string, req StartRemakeRequest) (RemakeDetail, error) {
	project, err := s.requireRemake(userID, id)
	if err != nil {
		return RemakeDetail{}, err
	}
	if req.IdempotencyKey == "" || len(req.IdempotencyKey) > 100 {
		return RemakeDetail{}, BadAuthRequest("请提供有效的幂等请求标识")
	}
	if existing, e := s.repo.RemakeRunByRequest(id, req.IdempotencyKey); e == nil {
		if existing.UserID != userID {
			return RemakeDetail{}, BadAuthRequest("运行归属不匹配")
		}
		return s.RemakeDetail(userID, id)
	} else if !errors.Is(e, gorm.ErrRecordNotFound) {
		return RemakeDetail{}, e
	}
	if req.Goal != "analysis" && req.Goal != "keyframes" && req.Goal != "complete" {
		return RemakeDetail{}, BadAuthRequest("执行目标无效")
	}
	if len(req.ShotIDs) > 0 {
		return RemakeDetail{}, BadAuthRequest("当前支持完整复刻和失败项重试，暂不支持独立重做指定镜头")
	}
	settings, err := parseRemakeSettings(project.SettingsJSON)
	if err != nil {
		return RemakeDetail{}, err
	}
	if err := s.validateRemakeSettings(userID, settings); err != nil {
		return RemakeDetail{}, err
	}
	if req.Mode != "" {
		settings.Mode = req.Mode
	}
	if settings.Mode != "quick" && settings.Mode != "review" {
		return RemakeDetail{}, BadAuthRequest("执行模式无效")
	}
	if settings.Models.Text.Empty() {
		return RemakeDetail{}, BadAuthRequest("请选择视频分析模型")
	}
	if req.Goal != "analysis" {
		if settings.Models.Image.Empty() || settings.Models.Video.Empty() {
			return RemakeDetail{}, BadAuthRequest("请选择图片和视频模型")
		}
		if strings.TrimSpace(settings.TargetDescription) == "" || len(settings.TargetResourceIDs) == 0 {
			return RemakeDetail{}, BadAuthRequest("请填写新主体描述并上传参考图")
		}
	}
	run := model.RemakeRun{ID: newID(), ProjectID: id, UserID: userID, IdempotencyKey: req.IdempotencyKey, SourceResourceID: project.SourceResourceID, DraftVersion: req.ExpectedVersion, Goal: req.Goal, Mode: settings.Mode, Status: "queued", Stage: "analysis", SettingsJSON: remakeJSON(settings), AnalysisJSON: project.AnalysisJSON, ShotsJSON: project.ShotsJSON, ShotIDsJSON: remakeJSON(req.ShotIDs), SelectionsJSON: "{}", SelectionVersion: 1, BudgetMicrocredits: settings.BudgetMicrocredits}
	if req.Goal == "analysis" {
		run.AnalysisJSON = ""
		run.ShotsJSON = "[]"
	}
	if err := s.repo.CreateRemakeRun(&run, req.ExpectedVersion); err != nil {
		if _, e := s.repo.RemakeRunByRequest(id, req.IdempotencyKey); e == nil {
			return s.RemakeDetail(userID, id)
		}
		return RemakeDetail{}, remakeError(err)
	}
	s.wakeRemakeScheduler()
	return s.RemakeDetail(userID, id)
}

func (s *Service) RemakeAction(userID, projectID, runID string, req RemakeActionRequest) (RemakeDetail, error) {
	if _, err := s.requireRemake(userID, projectID); err != nil {
		return RemakeDetail{}, err
	}
	run, err := s.repo.RemakeRun(userID, projectID, runID)
	if err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	switch req.Action {
	case "pause":
		err = s.repo.ControlRemakeRun(run.ID, []string{"queued", "running", "rendering"}, map[string]any{"status": "paused"})
	case "resume":
		err = s.repo.ControlRemakeRun(run.ID, []string{"paused", "needs_attention"}, map[string]any{"status": "running", "error": ""})
	case "cancel":
		steps, loadErr := s.repo.RemakeSteps(run.ID)
		if loadErr != nil {
			return RemakeDetail{}, loadErr
		}
		for _, step := range steps {
			if step.Status == "submitting" && step.TaskID == "" {
				return RemakeDetail{}, BadAuthRequest("任务提交状态尚未确认，请检查创作历史，确认后再重试取消")
			}
		}
		err = s.repo.ControlRemakeRun(run.ID, []string{"queued", "running", "rendering", "paused", "awaiting_review", "needs_attention", "partial_failed"}, map[string]any{"status": "cancelling"})
	case "approve_and_continue":
		if err = s.validateRemakeSelections(run); err == nil {
			err = s.repo.SaveRemakeSelections(run.ID, req.ExpectedSelectionVersion, run.SelectionsJSON, true)
		}
	case "retry_failed":
		err = s.retryRemakeRun(run)
	default:
		return RemakeDetail{}, BadAuthRequest("运行操作无效")
	}
	if err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	s.wakeRemakeScheduler()
	return s.RemakeDetail(userID, projectID)
}

func (s *Service) retryRemakeRun(run *model.RemakeRun) error {
	if run.Status != "partial_failed" {
		return BadAuthRequest("当前运行没有可安全重试的失败镜头")
	}
	steps, err := s.repo.RemakeSteps(run.ID)
	if err != nil {
		return err
	}
	retried := 0
	for _, step := range steps {
		if step.Status != "failed" {
			continue
		}
		if err := s.repo.UpdateRemakeStep(step.ID, map[string]any{"status": "pending", "task_id": "", "error": ""}); err != nil {
			return err
		}
		retried++
	}
	if retried == 0 {
		return BadAuthRequest("没有可重试的失败镜头")
	}
	if err := s.repo.ControlRemakeRun(run.ID, []string{"partial_failed"}, map[string]any{"status": "running", "error": "", "reserved_microcredits": 0}); err != nil {
		return err
	}
	return s.repo.UpdateRemakeProjectProgress(run.ProjectID, map[string]any{"status": "running", "error": ""})
}

func (s *Service) validateRemakeSelections(run *model.RemakeRun) error {
	selections, err := parseRemakeSelections(run.SelectionsJSON)
	if err != nil {
		return err
	}
	var units []remake.GenerationUnit
	if err := json.Unmarshal([]byte(run.UnitsJSON), &units); err != nil {
		return err
	}
	if len(units) == 0 || len(selections) != len(units) {
		return BadAuthRequest("请为本次运行的全部生成单元选择关键帧")
	}
	for _, unit := range units {
		selection := selections[unit.ID]
		if selection.ImageTakeID == "" {
			return BadAuthRequest("请为每个生成单元选择关键帧")
		}
		take, err := s.repo.RemakeTake(run.ProjectID, selection.ImageTakeID)
		if err != nil {
			return remakeError(err)
		}
		if take.RunID != run.ID || take.UnitID != unit.ID || take.Kind != "image" {
			return BadAuthRequest("关键帧与镜头不匹配")
		}
		if _, err := s.Resource(run.UserID, take.ResourceID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) SelectRemakeTakes(userID, projectID, runID string, req RemakeSelectionRequest) (RemakeDetail, error) {
	if _, err := s.requireRemake(userID, projectID); err != nil {
		return RemakeDetail{}, err
	}
	run, err := s.repo.RemakeRun(userID, projectID, runID)
	if err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	run.SelectionsJSON = remakeJSON(req.Selections)
	if err := s.validateRemakeSelections(run); err != nil {
		return RemakeDetail{}, err
	}
	if err := s.repo.SaveRemakeSelections(runID, req.ExpectedSelectionVersion, run.SelectionsJSON, false); err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	return s.RemakeDetail(userID, projectID)
}

func (s *Service) ExportRemake(userID, projectID string, req RemakeExportRequest) (RemakeDetail, error) {
	if _, err := s.requireRemake(userID, projectID); err != nil {
		return RemakeDetail{}, err
	}
	run, err := s.repo.RemakeRun(userID, projectID, req.RunID)
	if err != nil {
		return RemakeDetail{}, remakeError(err)
	}
	if run.Goal != "complete" {
		return RemakeDetail{}, BadAuthRequest("请先完成视频生成")
	}
	if run.Status == "completed" {
		return s.RemakeDetail(userID, projectID)
	}
	return RemakeDetail{}, BadAuthRequest(fmt.Sprintf("成片由运行自动合成，当前状态：%s", run.Status))
}
