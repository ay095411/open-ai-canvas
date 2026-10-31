package app

import (
	"encoding/json"
	"yingce/backend/internal/model"
	"yingce/backend/internal/remake"
)

type RemakeModelChoice = DramaModelChoice
type RemakeModels struct {
	Text  RemakeModelChoice `json:"text"`
	Image RemakeModelChoice `json:"image"`
	Video RemakeModelChoice `json:"video"`
}
type RemakeSettings struct {
	SourceInMs         int64        `json:"sourceInMs"`
	SourceOutMs        int64        `json:"sourceOutMs"`
	TargetDescription  string       `json:"targetDescription"`
	TargetResourceIDs  []string     `json:"targetResourceIds"`
	Style              string       `json:"style"`
	AspectRatio        string       `json:"aspectRatio"`
	AudioMode          string       `json:"audioMode"`
	Mode               string       `json:"mode"`
	BudgetMicrocredits int64        `json:"budgetMicrocredits"`
	Models             RemakeModels `json:"models"`
	VideoResolution    string       `json:"videoResolution,omitempty"`
}

type CreateRemakeRequest struct {
	Title            string         `json:"title"`
	SourceResourceID string         `json:"sourceResourceId"`
	Settings         RemakeSettings `json:"settings"`
}
type UpdateRemakeRequest struct {
	ExpectedVersion int64                `json:"expectedVersion"`
	Title           *string              `json:"title"`
	Settings        *RemakeSettings      `json:"settings"`
	Shots           *[]remake.SourceShot `json:"shots"`
}
type StartRemakeRequest struct {
	ExpectedVersion int64    `json:"expectedVersion"`
	IdempotencyKey  string   `json:"idempotencyKey"`
	Goal            string   `json:"goal"`
	Mode            string   `json:"mode"`
	ShotIDs         []string `json:"shotIds"`
}
type RemakeActionRequest struct {
	Action                   string `json:"action"`
	ExpectedSelectionVersion int64  `json:"expectedSelectionVersion"`
}
type RemakeSelection struct {
	ImageTakeID string `json:"imageTakeId,omitempty"`
	VideoTakeID string `json:"videoTakeId,omitempty"`
}
type RemakeSelectionRequest struct {
	ExpectedSelectionVersion int64                      `json:"expectedSelectionVersion"`
	Selections               map[string]RemakeSelection `json:"selections"`
}
type RemakeExportRequest struct {
	RunID string `json:"runId"`
}
type RemakeProjectView struct {
	model.RemakeProject
	Settings RemakeSettings `json:"settings"`
}
type RemakeRunView struct {
	model.RemakeRun
	Selections     map[string]RemakeSelection `json:"selections"`
	Steps          []model.RemakeStep         `json:"steps"`
	CompletedSteps int                        `json:"completedSteps"`
	TotalSteps     int                        `json:"totalSteps"`
}
type RemakeDetail struct {
	Project   RemakeProjectView    `json:"project"`
	Analysis  *remake.Analysis     `json:"analysis"`
	Shots     []remake.SourceShot  `json:"shots"`
	Runs      []RemakeRunView      `json:"runs"`
	ActiveRun *RemakeRunView       `json:"activeRun"`
	Takes     []model.RemakeTake   `json:"takes"`
	Exports   []model.RemakeExport `json:"exports"`
}

func remakeJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}
func parseRemakeSettings(value string) (RemakeSettings, error) {
	var settings RemakeSettings
	err := json.Unmarshal([]byte(value), &settings)
	return settings, err
}
func parseRemakeSelections(value string) (map[string]RemakeSelection, error) {
	out := map[string]RemakeSelection{}
	if value == "" {
		return out, nil
	}
	err := json.Unmarshal([]byte(value), &out)
	return out, err
}
