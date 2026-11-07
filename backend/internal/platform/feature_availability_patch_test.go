package platform

import (
	"encoding/json"
	"testing"
)

func TestFeatureAvailabilityPatchStrictJSON(t *testing.T) {
	for _, raw := range []string{
		`null`, `[]`, `true`, `{}`, `{"unknown":true}`, `{"ecommerceEnabled":null}`,
		`{"ecommerceEnabled":"true"}`, `{"ecommerceEnabled":1}`, `{"ecommerceEnabled":{}}`,
		`{"ecommerceEnabled":true,"ecommerceEnabled":false}`, `{"ecommerceEnabled":true} {}`,
	} {
		t.Run(raw, func(t *testing.T) {
			var patch FeatureAvailabilityPatch
			if err := json.Unmarshal([]byte(raw), &patch); err == nil {
				t.Fatalf("invalid patch accepted: %s", raw)
			}
		})
	}
}

func TestFeatureAvailabilityPatchCoversEverySwitch(t *testing.T) {
	encoded, err := json.Marshal(FeatureAvailability{})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]bool
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for key := range fields {
		t.Run(key, func(t *testing.T) {
			encoded, err := json.Marshal(map[string]bool{key: true})
			if err != nil {
				t.Fatal(err)
			}
			var patch FeatureAvailabilityPatch
			if err := json.Unmarshal(encoded, &patch); err != nil {
				t.Fatal(err)
			}
			result, err := patch.apply(FeatureAvailability{})
			if err != nil {
				t.Fatal(err)
			}
			encoded, err = json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			var actual map[string]bool
			if err := json.Unmarshal(encoded, &actual); err != nil {
				t.Fatal(err)
			}
			for field, enabled := range actual {
				if enabled != (field == key) {
					t.Fatalf("patch %s unexpectedly changed %s to %v", key, field, enabled)
				}
			}
		})
	}
}
