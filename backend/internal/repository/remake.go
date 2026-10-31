package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

const RemakeResourceReferenceKind = "复刻项目引用"

var ErrRemakeConflict = errors.New("复刻内容或运行状态已变化，请刷新后重试")

func (r *Repository) RemakeProject(userID, id string) (*model.RemakeProject, error) {
	var row model.RemakeProject
	err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error
	return &row, err
}

func (r *Repository) ListRemakes(userID, query, status string, page, size int) ([]model.RemakeProject, int64, error) {
	q := r.db.Model(&model.RemakeProject{}).Where("user_id = ?", userID)
	if query != "" {
		q = q.Where("title LIKE ?", "%"+query+"%")
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	rows := []model.RemakeProject{}
	err := q.Order("updated_at desc").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	return rows, count, err
}

func (r *Repository) CreateRemake(row *model.RemakeProject, refs []model.RemakeResourceReference) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		if len(refs) > 0 {
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&refs).Error
		}
		return nil
	})
}

func (r *Repository) UpdateRemakeDraft(userID, id string, version int64, fields map[string]any, refs []model.RemakeResourceReference) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		fields["draft_version"] = version + 1
		fields["updated_at"] = time.Now()
		res := tx.Model(&model.RemakeProject{}).Where("id = ? AND user_id = ? AND draft_version = ?", id, userID, version).Updates(fields)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		if len(refs) > 0 {
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&refs).Error
		}
		return nil
	})
}

func (r *Repository) UpdateRemakeProjectProgress(id string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return r.db.Model(&model.RemakeProject{}).Where("id = ?", id).Updates(fields).Error
}

func (r *Repository) CopyRemakeAnalysis(projectID string, version int64, analysis, shots string) error {
	return r.db.Model(&model.RemakeProject{}).Where("id = ? AND draft_version = ?", projectID, version).
		Updates(map[string]any{"analysis_json": analysis, "shots_json": shots, "updated_at": time.Now()}).Error
}

func (r *Repository) DeleteRemake(userID, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var p model.RemakeProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&p).Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&model.RemakeRun{}).Where("project_id = ? AND status NOT IN ?", id, []string{"completed", "cancelled", "failed"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrProjectHasActiveTasks
		}
		for _, value := range []any{&model.RemakeStep{}, &model.RemakeTake{}, &model.RemakeExport{}, &model.RemakeRevision{}, &model.RemakeResourceReference{}, &model.RemakeRun{}} {
			if err := tx.Where("project_id = ?", id).Delete(value).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&p).Error
	})
}

func (r *Repository) RemakeRun(userID, projectID, id string) (*model.RemakeRun, error) {
	var row model.RemakeRun
	err := r.db.Where("id = ? AND project_id = ? AND user_id = ?", id, projectID, userID).First(&row).Error
	return &row, err
}

func (r *Repository) RemakeRunByID(id string) (*model.RemakeRun, error) {
	var row model.RemakeRun
	err := r.db.Where("id = ?", id).First(&row).Error
	return &row, err
}

func (r *Repository) RemakeRunByRequest(projectID, key string) (*model.RemakeRun, error) {
	var row model.RemakeRun
	err := r.db.Where("project_id = ? AND idempotency_key = ?", projectID, key).First(&row).Error
	return &row, err
}

func (r *Repository) RemakeRuns(projectID string) ([]model.RemakeRun, error) {
	rows := []model.RemakeRun{}
	err := r.db.Where("project_id = ?", projectID).Order("created_at desc").Limit(100).Find(&rows).Error
	return rows, err
}

func (r *Repository) CreateRemakeRun(row *model.RemakeRun, expectedVersion int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Updating the parent serializes concurrent start requests on SQLite and PostgreSQL.
		res := tx.Model(&model.RemakeProject{}).Where("id = ? AND user_id = ? AND draft_version = ?", row.ProjectID, row.UserID, expectedVersion).Update("updated_at", time.Now())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		var count int64
		if err := tx.Model(&model.RemakeRun{}).Where("project_id = ? AND status NOT IN ?", row.ProjectID, []string{"completed", "cancelled", "failed"}).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrRemakeConflict
		}
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		return tx.Model(&model.RemakeProject{}).Where("id = ?", row.ProjectID).Updates(map[string]any{"status": "running", "stage": row.Stage, "error": ""}).Error
	})
}

func (r *Repository) ActiveRemakeRuns(limit int) ([]model.RemakeRun, error) {
	rows := []model.RemakeRun{}
	err := r.db.Where("status IN ?", []string{"queued", "running", "rendering", "paused", "cancelling"}).Order("updated_at asc").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) ClaimRemakeRun(id, owner string, ttl time.Duration) (bool, error) {
	now := time.Now()
	until := now.Add(ttl)
	res := r.db.Model(&model.RemakeRun{}).Where("id = ? AND status IN ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)", id, []string{"queued", "running", "rendering", "paused", "cancelling"}, now).Updates(map[string]any{"lease_owner": owner, "lease_expires_at": until})
	return res.RowsAffected == 1, res.Error
}

func (r *Repository) ReleaseRemakeRun(id, owner string) error {
	return r.db.Model(&model.RemakeRun{}).Where("id = ? AND lease_owner = ?", id, owner).Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil}).Error
}

func (r *Repository) UpdateRemakeRun(id, owner string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	q := r.db.Model(&model.RemakeRun{}).Where("id = ?", id)
	if owner != "" {
		q = q.Where("lease_owner = ? AND lease_expires_at > ?", owner, time.Now())
	}
	res := q.Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrRemakeConflict
	}
	return nil
}

func (r *Repository) ControlRemakeRun(id string, allowed []string, fields map[string]any) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		fields["updated_at"] = time.Now()
		res := tx.Model(&model.RemakeRun{}).Where("id = ? AND status IN ?", id, allowed).Updates(fields)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		var run model.RemakeRun
		if err := tx.First(&run, "id = ?", id).Error; err != nil {
			return err
		}
		return tx.Model(&model.RemakeProject{}).Where("id = ?", run.ProjectID).Updates(map[string]any{"status": run.Status, "stage": run.Stage, "error": run.Error, "updated_at": time.Now()}).Error
	})
}

func (r *Repository) TransitionRemakeRun(id, owner string, allowed []string, fields map[string]any) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		fields["updated_at"] = time.Now()
		res := tx.Model(&model.RemakeRun{}).Where("id = ? AND lease_owner = ? AND lease_expires_at > ? AND status IN ?", id, owner, time.Now(), allowed).Updates(fields)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		var run model.RemakeRun
		if err := tx.First(&run, "id = ?", id).Error; err != nil {
			return err
		}
		return tx.Model(&model.RemakeProject{}).Where("id = ?", run.ProjectID).Updates(map[string]any{"status": run.Status, "stage": run.Stage, "error": run.Error, "updated_at": time.Now()}).Error
	})
}

// BeginRemakeStep serializes dispatch against pause/cancel and records uncertain submissions.
func (r *Repository) BeginRemakeStep(runID, owner, stepID string, reserved int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.RemakeRun{}).Where("id = ? AND lease_owner = ? AND lease_expires_at > ? AND status IN ?", runID, owner, time.Now(), []string{"queued", "running", "rendering"}).Updates(map[string]any{"reserved_microcredits": reserved, "updated_at": time.Now()})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		res = tx.Model(&model.RemakeStep{}).Where("id = ? AND run_id = ? AND status = ?", stepID, runID, "pending").Updates(map[string]any{"status": "submitting", "attempt": gorm.Expr("attempt + 1"), "updated_at": time.Now()})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		return nil
	})
}

// CommitRemakeStep keeps the output, settled cost and terminal step in one transaction.
// Replaying a completed task cannot add cost twice or lose an adopted resource.
func (r *Repository) CommitRemakeStep(runID, owner string, step *model.RemakeStep, cost int64, fields map[string]any, take *model.RemakeTake, output *model.RemakeExport) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var run model.RemakeRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND lease_owner = ? AND lease_expires_at > ?", runID, owner, time.Now()).First(&run).Error; err != nil {
			return err
		}
		res := tx.Model(&model.RemakeStep{}).Where("id = ? AND run_id = ? AND task_id = ? AND status IN ?", step.ID, runID, step.TaskID, []string{"running", "queued"}).Updates(map[string]any{"status": step.Status, "error": step.Error, "resource_id": step.ResourceID, "updated_at": time.Now()})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		var ref *model.RemakeResourceReference
		if take != nil {
			if err := tx.Create(take).Error; err != nil {
				return err
			}
			ref = &model.RemakeResourceReference{ProjectID: run.ProjectID, UserID: run.UserID, ResourceID: take.ResourceID, Kind: "take"}
		}
		if output != nil {
			if err := tx.Create(output).Error; err != nil {
				return err
			}
			ref = &model.RemakeResourceReference{ProjectID: run.ProjectID, UserID: run.UserID, ResourceID: output.ResourceID, Kind: "export"}
		}
		if ref != nil {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(ref).Error; err != nil {
				return err
			}
		}
		fields["spent_microcredits"] = run.SpentMicrocredits + cost
		fields["reserved_microcredits"] = 0
		fields["updated_at"] = time.Now()
		if run.Status == "cancelling" || (run.Status == "paused" && step.Kind != "render") {
			fields["status"] = run.Status
		}
		if err := tx.Model(&model.RemakeRun{}).Where("id = ?", runID).Updates(fields).Error; err != nil {
			return err
		}
		if err := tx.First(&run, "id = ?", runID).Error; err != nil {
			return err
		}
		if step.Kind == "analysis" && step.Status == "succeeded" {
			if err := tx.Model(&model.RemakeProject{}).Where("id = ? AND draft_version = ?", run.ProjectID, run.DraftVersion).Updates(map[string]any{"analysis_json": run.AnalysisJSON, "shots_json": run.ShotsJSON}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.RemakeProject{}).Where("id = ?", run.ProjectID).Updates(map[string]any{"status": run.Status, "stage": run.Stage, "error": run.Error, "updated_at": time.Now()}).Error
	})
}

func (r *Repository) SaveRemakeRevision(runID, owner string, revision *model.RemakeRevision) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.RemakeRun{}).Where("id = ? AND revision_id = '' AND lease_owner = ?", runID, owner).Updates(map[string]any{"revision_id": revision.ID, "units_json": revision.UnitsJSON, "shots_json": revision.ShotsJSON})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		return tx.Create(revision).Error
	})
}

func (r *Repository) RemakeSteps(runID string) ([]model.RemakeStep, error) {
	rows := []model.RemakeStep{}
	err := r.db.Where("run_id = ?", runID).Order("created_at asc, id asc").Find(&rows).Error
	return rows, err
}

func (r *Repository) CreateRemakeStep(row *model.RemakeStep) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error
}

func (r *Repository) UpdateRemakeStep(id string, fields map[string]any) error {
	fields["updated_at"] = time.Now()
	return r.db.Model(&model.RemakeStep{}).Where("id = ?", id).Updates(fields).Error
}

func (r *Repository) RemakeTakes(projectID string) ([]model.RemakeTake, error) {
	rows := []model.RemakeTake{}
	err := r.db.Where("project_id = ?", projectID).Order("created_at desc").Find(&rows).Error
	return rows, err
}

func (r *Repository) RemakeTake(projectID, id string) (*model.RemakeTake, error) {
	var row model.RemakeTake
	err := r.db.Where("project_id = ? AND id = ?", projectID, id).First(&row).Error
	return &row, err
}

func (r *Repository) SaveRemakeTake(take *model.RemakeTake, ref model.RemakeResourceReference) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(take).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ref).Error
	})
}

func (r *Repository) RemakeExports(projectID string) ([]model.RemakeExport, error) {
	rows := []model.RemakeExport{}
	err := r.db.Where("project_id = ?", projectID).Order("created_at desc").Find(&rows).Error
	return rows, err
}

func (r *Repository) SaveRemakeExport(out *model.RemakeExport, ref model.RemakeResourceReference) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(out).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ref).Error
	})
}

func (r *Repository) SaveRemakeSelections(runID string, expected int64, selectionJSON string, approve bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var run model.RemakeRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", runID).First(&run).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.RemakeStep{}).Where("run_id = ? AND kind IN ? AND (status <> ? OR task_id <> '')", runID, []string{"video", "render"}, "pending").Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrRemakeConflict
		}
		fields := map[string]any{"selections_json": selectionJSON, "selection_version": expected + 1, "updated_at": time.Now()}
		if approve {
			fields["approved"] = true
			fields["status"] = "running"
			fields["error"] = ""
			fields["goal"] = "complete"
		}
		res := tx.Model(&model.RemakeRun{}).Where("id = ? AND selection_version = ? AND status IN ?", runID, expected, []string{"awaiting_review", "paused"}).Updates(fields)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return ErrRemakeConflict
		}
		if approve {
			return tx.Model(&model.RemakeProject{}).Where("id = ?", run.ProjectID).Updates(map[string]any{"status": "running", "error": ""}).Error
		}
		return nil
	})
}

func (r *Repository) AddRemakeResourceReferences(refs []model.RemakeResourceReference) error {
	if len(refs) == 0 {
		return nil
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&refs).Error
}

func (r *Repository) RemakeResourceReferences(userID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	if len(resourceIDs) == 0 {
		return []ResourceDirectReference{}, nil
	}
	var rows []model.RemakeResourceReference
	if err := r.db.Where("user_id = ? AND resource_id IN ?", userID, resourceIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	refs := make([]ResourceDirectReference, 0, len(rows))
	for _, row := range rows {
		refs = append(refs, ResourceDirectReference{Kind: RemakeResourceReferenceKind, ID: row.ProjectID, Title: "一键复刻", ResourceID: row.ResourceID})
	}
	return refs, nil
}
