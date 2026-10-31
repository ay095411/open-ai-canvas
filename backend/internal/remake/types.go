package remake

const (
	MaxSourceDurationMs int64 = 60_000
	MaxSourceShots            = 20
)

// Analysis preserves media evidence separately from the editable generation plan.
type Analysis struct {
	SourceResourceID string       `json:"sourceResourceId"`
	SourceDurationMs int64        `json:"sourceDurationMs"`
	SourceInMs       int64        `json:"sourceInMs"`
	SourceOutMs      int64        `json:"sourceOutMs"`
	Width            int          `json:"width"`
	Height           int          `json:"height"`
	FPS              float64      `json:"fps"`
	HasAudio         bool         `json:"hasAudio"`
	Shots            []SourceShot `json:"shots"`
	Warnings         []string     `json:"warnings,omitempty"`
}

type SourceShot struct {
	ID                 string   `json:"id"`
	SourceInMs         int64    `json:"sourceInMs"`
	SourceOutMs        int64    `json:"sourceOutMs"`
	KeyframeMs         int64    `json:"keyframeMs"`
	KeyframeResourceID string   `json:"keyframeResourceId"`
	Description        string   `json:"description"`
	ShotSize           string   `json:"shotSize"`
	Camera             string   `json:"camera"`
	Motion             string   `json:"motion"`
	Dialogue           string   `json:"dialogue"`
	SubjectPresent     bool     `json:"subjectPresent"`
	SubjectDescription string   `json:"subjectDescription"`
	ImagePrompt        string   `json:"imagePrompt"`
	VideoPrompt        string   `json:"videoPrompt"`
	Warnings           []string `json:"warnings,omitempty"`
}

// GenerationUnit records billed generation duration independently of the edit.
type GenerationUnit struct {
	ID                  string `json:"id"`
	SourceShotID        string `json:"sourceShotId"`
	TargetDurationMs    int64  `json:"targetDurationMs"`
	RequestedDurationMs int64  `json:"requestedDurationMs"`
	SourceInMs          int64  `json:"sourceInMs"`
	SourceOutMs         int64  `json:"sourceOutMs"`
}
