package handler

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"yingce/backend/internal/service"
)

func libraryOpenAPIDocument(t *testing.T) map[string]any {
	t.Helper()
	var document map[string]any
	if err := yaml.Unmarshal(openAPISpec, &document); err != nil {
		t.Fatalf("parse embedded OpenAPI: %v", err)
	}
	return document
}

func libraryOpenAPIAt(t *testing.T, value any, path ...string) any {
	t.Helper()
	for _, key := range path {
		object, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("OpenAPI %s is not an object: %T", strings.Join(path, "/"), value)
		}
		value, ok = object[key]
		if !ok {
			t.Fatalf("OpenAPI is missing %s", strings.Join(path, "/"))
		}
	}
	return value
}

func libraryOpenAPIProperties(t *testing.T, document map[string]any, schema any) map[string]any {
	t.Helper()
	object := schema.(map[string]any)
	properties := map[string]any{}
	if ref, ok := object["$ref"].(string); ok {
		if !strings.HasPrefix(ref, "#/") {
			t.Fatalf("unexpected external schema reference: %s", ref)
		}
		return libraryOpenAPIProperties(t, document, libraryOpenAPIAt(t, document, strings.Split(strings.TrimPrefix(ref, "#/"), "/")...))
	}
	if allOf, ok := object["allOf"].([]any); ok {
		for _, part := range allOf {
			for key, value := range libraryOpenAPIProperties(t, document, part) {
				properties[key] = value
			}
		}
	}
	if own, ok := object["properties"].(map[string]any); ok {
		for key, value := range own {
			properties[key] = value
		}
	}
	return properties
}

func libraryJSONFieldNames(value reflect.Type) []string {
	var names []string
	for index := 0; index < value.NumField(); index++ {
		field := value.Field(index)
		if field.Anonymous {
			names = append(names, libraryJSONFieldNames(field.Type)...)
			continue
		}
		if name := strings.Split(field.Tag.Get("json"), ",")[0]; name != "" && name != "-" {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}

func TestOpenAPIInspirationLibraryRoutesAndAuthentication(t *testing.T) {
	document := libraryOpenAPIDocument(t)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterInspirationLibraryRoutes(router.Group("/api"), &service.Service{})
	if len(router.Routes()) != 10 {
		t.Fatalf("expected ten library route operations, got %d", len(router.Routes()))
	}
	for _, route := range router.Routes() {
		path := strings.ReplaceAll(strings.TrimPrefix(route.Path, "/api"), ":slug", "{slug}")
		t.Run(route.Method+" "+path, func(t *testing.T) {
			operation := libraryOpenAPIAt(t, document, "paths", path, strings.ToLower(route.Method)).(map[string]any)
			security, ok := operation["security"].([]any)
			if !ok {
				t.Fatal("library operation must explicitly document its security boundary")
			}
			public := strings.HasPrefix(path, "/public/")
			if public && len(security) != 0 {
				t.Fatal("public library reads must not require a login")
			}
			if !public {
				if len(security) != 1 {
					t.Fatal("admin operation must require the session cookie")
				}
				libraryOpenAPIAt(t, security[0], "sessionCookie")
				libraryOpenAPIAt(t, operation, "responses", "401")
				libraryOpenAPIAt(t, operation, "responses", "403")
				if !strings.Contains(fmt.Sprint(operation["description"]), "管理员") {
					t.Fatal("admin operation must state its role requirement")
				}
			}
			libraryOpenAPIAt(t, operation, "responses", "200")
			libraryOpenAPIAt(t, operation, "responses", "400")
			if public {
				libraryOpenAPIAt(t, operation, "responses", "429")
			}
			if strings.HasSuffix(path, "/media") {
				libraryOpenAPIAt(t, operation, "responses", "206")
				libraryOpenAPIAt(t, operation, "responses", "416")
			}
		})
	}
}

func TestOpenAPIInspirationLibrarySchemaFieldsMatchGoContracts(t *testing.T) {
	document := libraryOpenAPIDocument(t)
	for name, value := range map[string]any{
		"InspirationLibraryCandidate":    service.InspirationLibraryCandidate{},
		"InspirationLibraryLicenseInput": service.InspirationLibraryLicense{},
		"InspirationLibraryRecord":       service.InspirationLibraryReviewRecord{},
		"InspirationLibraryReviewPage":   service.InspirationLibraryReviewPage{},
		"InspirationLibraryImportInput":  service.InspirationLibraryImport{},
		"InspirationLibraryImportResult": service.InspirationLibraryImportResult{},
		"InspirationLibraryReviewInput":  service.InspirationLibraryReview{},
		"InspirationLibrarySummary":      service.InspirationLibrarySummary{},
		"InspirationLibraryDetail":       service.InspirationLibraryDetail{},
		"InspirationLibraryPage":         service.InspirationLibraryPage{},
		"InspirationLibraryFacets":       service.InspirationLibraryFacets{},
		"InspirationLibraryResolveInput": service.InspirationLibraryResolve{},
		"InspirationLibraryResolved":     service.InspirationLibraryResolved{},
	} {
		t.Run(name, func(t *testing.T) {
			properties := libraryOpenAPIProperties(t, document, libraryOpenAPIAt(t, document, "components", "schemas", name))
			var actual []string
			for key := range properties {
				actual = append(actual, key)
			}
			slices.Sort(actual)
			if expected := libraryJSONFieldNames(reflect.TypeOf(value)); !reflect.DeepEqual(actual, expected) {
				t.Fatalf("schema fields = %v; Go JSON fields = %v", actual, expected)
			}
		})
	}
}

func TestOpenAPIInspirationLibraryWriteLimitsAndPublicRedaction(t *testing.T) {
	document := libraryOpenAPIDocument(t)
	schemas := libraryOpenAPIAt(t, document, "components", "schemas")
	for _, name := range []string{"InspirationLibraryCandidate", "InspirationLibraryLicenseInput", "InspirationLibraryImportInput", "InspirationLibraryReviewInput", "InspirationLibraryResolveInput"} {
		if libraryOpenAPIAt(t, schemas, name, "additionalProperties") != false {
			t.Errorf("%s must reject unknown request fields", name)
		}
	}
	for _, path := range [][]string{{"InspirationLibraryImportInput", "properties", "items", "maxItems"}, {"InspirationLibraryResolveInput", "properties", "ids", "maxItems"}} {
		if fmt.Sprint(libraryOpenAPIAt(t, schemas, path...)) != "100" {
			t.Errorf("%v must be limited to 100", path)
		}
	}
	if fmt.Sprint(libraryOpenAPIAt(t, schemas, "InspirationLibraryResolveInput", "properties", "ids", "minItems")) != "0" {
		t.Fatal("resolving an empty favorite list is valid")
	}
	summary := libraryOpenAPIProperties(t, document, libraryOpenAPIAt(t, schemas, "InspirationLibrarySummary"))
	if _, exposed := summary["prompt"]; exposed {
		t.Fatal("public summaries must not expose full prompts")
	}
	license := libraryOpenAPIProperties(t, document, libraryOpenAPIAt(t, schemas, "InspirationLibraryPublishedLicense"))
	for _, key := range []string{"evidence", "commercialUse", "redistribution"} {
		if _, exposed := license[key]; exposed {
			t.Errorf("public licenses must not expose internal field %s", key)
		}
	}
	if fmt.Sprint(libraryOpenAPIAt(t, schemas, "InspirationLibrarySummary", "properties", "sourceId", "enum")) != "[authorized-library]" {
		t.Fatal("reviewed library IDs must not impersonate online gallery IDs")
	}
}
