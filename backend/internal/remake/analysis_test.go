package remake

import (
	"strings"
	"testing"
)

func baselineAnalysis() Analysis {
	return Analysis{
		SourceResourceID: "source",
		SourceDurationMs: 3000,
		SourceInMs:       500,
		SourceOutMs:      2500,
		Width:            1920,
		Height:           1080,
		Shots: []SourceShot{
			{ID: "shot-1", SourceInMs: 500, SourceOutMs: 1500, KeyframeMs: 1000},
			{ID: "shot-2", SourceInMs: 1500, SourceOutMs: 2500, KeyframeMs: 2000},
		},
	}
}

func TestValidateAnalysisRequiresExactOrderedCoverage(t *testing.T) {
	analysis := baselineAnalysis()
	if err := ValidateAnalysis(analysis); err != nil {
		t.Fatalf("valid analysis rejected: %v", err)
	}

	analysis.Shots[1].SourceInMs++
	if err := ValidateAnalysis(analysis); err == nil {
		t.Fatal("analysis with a gap was accepted")
	}
}

func TestParseAnalysisOnlyAddsSemantics(t *testing.T) {
	analysis := baselineAnalysis()
	output := `{"shots":[` +
		`{"id":"shot-1","description":"红色饮料瓶置于桌面","shotSize":"近景","camera":"平视","motion":"静止","dialogue":"","subjectPresent":true,"subjectDescription":"红色饮料瓶","imagePrompt":"替换主体并保持桌面构图","videoPrompt":"瓶身有水珠，镜头轻微推进","warnings":[]},` +
		`{"id":"shot-2","description":"手拿起饮料瓶","shotSize":"中景","camera":"俯视","motion":"手部动作（推测）","dialogue":"","subjectPresent":true,"subjectDescription":"红色饮料瓶","imagePrompt":"替换主体并保持俯拍构图","videoPrompt":"手拿起瓶子","warnings":["动作来自代表帧推测"]}` +
		`]}`

	parsed, err := ParseAnalysis(output, analysis)
	if err != nil {
		t.Fatalf("valid semantic analysis rejected: %v", err)
	}
	if parsed.Shots[0].SourceInMs != analysis.Shots[0].SourceInMs || parsed.Shots[1].SourceOutMs != analysis.Shots[1].SourceOutMs {
		t.Fatal("model output changed physical source boundaries")
	}
	if parsed.Shots[0].Description == "" || !parsed.Shots[0].SubjectPresent {
		t.Fatal("semantic fields were not applied")
	}

	if _, err := ParseAnalysis(strings.TrimSuffix(output, "}"), analysis); err == nil {
		t.Fatal("truncated JSON was accepted")
	}
}
