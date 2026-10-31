package remake

import "testing"

func TestBuildUnitsUsesDeclaredDurationsAndPreservesTimeline(t *testing.T) {
	shots := []SourceShot{{ID: "shot-1", SourceInMs: 0, SourceOutMs: 5500}}
	units, err := BuildUnits(shots, []int{5, 3}, 3, 5)
	if err != nil {
		t.Fatalf("build units: %v", err)
	}
	if len(units) != 2 {
		t.Fatalf("got %d units, want 2", len(units))
	}
	if units[0].TargetDurationMs != 5000 || units[0].RequestedDurationMs != 5000 {
		t.Fatalf("first unit durations = %d/%d, want 5000/5000", units[0].TargetDurationMs, units[0].RequestedDurationMs)
	}
	if units[1].SourceInMs != units[0].SourceOutMs || units[1].SourceOutMs != 5500 || units[1].RequestedDurationMs != 3000 {
		t.Fatalf("second unit does not continue the source timeline: %#v", units[1])
	}
}

func TestBuildUnitsRejectsUnsupportedProviderDurations(t *testing.T) {
	shots := []SourceShot{{ID: "shot-1", SourceInMs: 0, SourceOutMs: 1000}}
	if _, err := BuildUnits(shots, []int{0}, 1, 5); err == nil {
		t.Fatal("zero-second provider duration was accepted")
	}
}
