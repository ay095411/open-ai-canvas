package model

import "time"

// RemakeProject is an independent workspace; source and draft never belong to a canvas.
type RemakeProject struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"-" gorm:"size:36;index"`
	Title            string    `json:"title" gorm:"size:160"`
	SourceResourceID string    `json:"sourceResourceId" gorm:"size:36;index"`
	SettingsJSON     string    `json:"-" gorm:"type:text"`
	AnalysisJSON     string    `json:"-" gorm:"type:text"`
	ShotsJSON        string    `json:"-" gorm:"type:text"`
	DraftVersion     int64     `json:"draftVersion"`
	Status           string    `json:"status" gorm:"size:24;index"`
	Stage            string    `json:"stage" gorm:"size:24"`
	Error            string    `json:"error" gorm:"type:text"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type RemakeRevision struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID    string    `json:"projectId" gorm:"size:36;index"`
	UserID       string    `json:"-" gorm:"size:36;index"`
	DraftVersion int64     `json:"draftVersion"`
	SettingsJSON string    `json:"-" gorm:"type:text"`
	AnalysisJSON string    `json:"-" gorm:"type:text"`
	ShotsJSON    string    `json:"-" gorm:"type:text"`
	UnitsJSON    string    `json:"-" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt"`
}

type RemakeRun struct {
	ID                   string     `json:"id" gorm:"primaryKey;size:36"`
	ProjectID            string     `json:"projectId" gorm:"size:36;index;uniqueIndex:idx_remake_run_request,priority:1"`
	UserID               string     `json:"-" gorm:"size:36;index"`
	IdempotencyKey       string     `json:"-" gorm:"size:100;uniqueIndex:idx_remake_run_request,priority:2"`
	RevisionID           string     `json:"revisionId" gorm:"size:36"`
	SourceResourceID     string     `json:"sourceResourceId" gorm:"size:36"`
	DraftVersion         int64      `json:"draftVersion"`
	Goal                 string     `json:"goal" gorm:"size:24"`
	Mode                 string     `json:"mode" gorm:"size:16"`
	Status               string     `json:"status" gorm:"size:24;index"`
	Stage                string     `json:"stage" gorm:"size:24"`
	Error                string     `json:"error" gorm:"type:text"`
	SettingsJSON         string     `json:"-" gorm:"type:text"`
	AnalysisJSON         string     `json:"-" gorm:"type:text"`
	ShotsJSON            string     `json:"-" gorm:"type:text"`
	UnitsJSON            string     `json:"-" gorm:"type:text"`
	ShotIDsJSON          string     `json:"-" gorm:"type:text"`
	SelectionsJSON       string     `json:"-" gorm:"type:text"`
	SelectionVersion     int64      `json:"selectionVersion"`
	Approved             bool       `json:"approved"`
	BudgetMicrocredits   int64      `json:"budgetMicrocredits"`
	SpentMicrocredits    int64      `json:"spentMicrocredits"`
	ReservedMicrocredits int64      `json:"reservedMicrocredits"`
	LeaseOwner           string     `json:"-" gorm:"size:80"`
	LeaseExpiresAt       *time.Time `json:"-" gorm:"index"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type RemakeStep struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	RunID        string    `json:"runId" gorm:"size:36;uniqueIndex:idx_remake_step_key,priority:1;index"`
	ProjectID    string    `json:"projectId" gorm:"size:36;index"`
	StepKey      string    `json:"-" gorm:"size:100;uniqueIndex:idx_remake_step_key,priority:2"`
	Kind         string    `json:"kind" gorm:"size:24"`
	ShotID       string    `json:"shotId,omitempty" gorm:"size:64"`
	UnitID       string    `json:"unitId,omitempty" gorm:"size:80"`
	Status       string    `json:"status" gorm:"size:24;index"`
	TaskID       string    `json:"taskId,omitempty" gorm:"size:36;index"`
	Attempt      int       `json:"attempt"`
	AttemptsJSON string    `json:"-" gorm:"type:text"`
	InputHash    string    `json:"-" gorm:"size:64;index"`
	ResourceID   string    `json:"resourceId,omitempty" gorm:"size:36"`
	Error        string    `json:"error" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type RemakeTake struct {
	ID                  string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID           string    `json:"projectId" gorm:"size:36;index"`
	RunID               string    `json:"runId" gorm:"size:36;index"`
	StepID              string    `json:"-" gorm:"size:36;uniqueIndex"`
	ShotID              string    `json:"shotId" gorm:"size:64"`
	UnitID              string    `json:"unitId" gorm:"size:80"`
	Kind                string    `json:"kind" gorm:"size:16"`
	ResourceID          string    `json:"resourceId" gorm:"size:36;index"`
	TaskID              string    `json:"taskId" gorm:"size:36"`
	InputHash           string    `json:"-" gorm:"size:64;index"`
	RequestedDurationMs int64     `json:"requestedDurationMs"`
	DurationMs          int64     `json:"durationMs"`
	CreatedAt           time.Time `json:"createdAt"`
}

type RemakeExport struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID    string    `json:"projectId" gorm:"size:36;index"`
	RunID        string    `json:"runId" gorm:"size:36;index"`
	StepID       string    `json:"-" gorm:"size:36;uniqueIndex"`
	ResourceID   string    `json:"resourceId" gorm:"size:36;index"`
	SubtitleSRT  string    `json:"subtitleSrt" gorm:"type:text"`
	DurationMs   int64     `json:"durationMs"`
	ManifestJSON string    `json:"-" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt"`
}

type RemakeResourceReference struct {
	ProjectID  string    `json:"projectId" gorm:"primaryKey;size:36"`
	ResourceID string    `json:"resourceId" gorm:"primaryKey;size:36;index"`
	Kind       string    `json:"kind" gorm:"primaryKey;size:24"`
	UserID     string    `json:"-" gorm:"size:36;index"`
	CreatedAt  time.Time `json:"createdAt"`
}
