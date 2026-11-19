package handler

import (
	"reflect"
	"testing"

	"yingce/backend/internal/platform"
)

func TestOpenAPIFeaturePatchIncludesTeamAndForkSwitches(t *testing.T) {
	document := libraryOpenAPIDocument(t)
	request := libraryOpenAPIAt(t, document, "paths", "/admin/settings/features", "patch", "requestBody", "content", "application/json", "schema")
	properties := libraryOpenAPIProperties(t, document, request)
	fields := libraryJSONFieldNames(reflect.TypeOf(platform.FeatureAvailability{}))
	if len(properties) != len(fields) {
		t.Fatalf("feature patch describes %d switches, want %d", len(properties), len(fields))
	}
	for _, field := range fields {
		if libraryOpenAPIAt(t, properties, field, "type") != "boolean" {
			t.Errorf("feature %s must be a boolean switch", field)
		}
	}
	if libraryOpenAPIAt(t, document, "components", "schemas", "FeatureAvailabilityPatch", "additionalProperties") != false {
		t.Fatal("feature patch must reject unknown switches")
	}
	if libraryOpenAPIAt(t, properties, "teamsEnabled", "default") != false {
		t.Fatal("team workspaces must default to disabled")
	}
	if security := libraryOpenAPIAt(t, document, "paths", "/features", "get", "security").([]any); len(security) != 0 {
		t.Fatal("feature availability is public, including guest sidebar hydration")
	}
}
