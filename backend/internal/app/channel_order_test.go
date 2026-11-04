package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestVisualChannelOrderMetadataAndReadPermissions(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-a", Name: "测试渠道", Scope: model.ChannelScopeSystem, Enabled: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	models := []model.ChannelModel{
		{ID: "model-text", ChannelID: channel.ID, ModelKey: "text-call", ProviderModelKey: "provider-text-v2", DisplayName: "同名模型", ChannelLabel: "文本线路", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, Enabled: true, SortOrder: 10},
		{ID: "model-image", ChannelID: channel.ID, ModelKey: "image-call", ProviderModelKey: "provider-image-v1", DisplayName: "同名模型", ChannelLabel: "图片线路", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: false, SortOrder: 20},
		{ID: "model-unconfigured", ChannelID: channel.ID, ModelKey: "unconfigured-call", Enabled: false, SortOrder: 30},
		{ID: "model-other-channel", ChannelID: "channel-b", ModelKey: "other-call", DisplayName: "其他渠道模型", Enabled: true},
	}
	if err := db.Create(&models).Error; err != nil {
		t.Fatal(err)
	}
	for _, actor := range []*model.User{nil, {ID: "user", Role: model.UserRoleUser}} {
		for _, channelID := range []string{"", channel.ID} {
			if rows, err := svc.AdminChannelOrder(actor, channelID); err == nil || rows != nil {
				t.Fatalf("nonadmin received sorting metadata for %q: rows=%+v err=%v", channelID, rows, err)
			}
		}
	}
	rows, err := svc.AdminChannelOrder(admin, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected all three channel models, including disabled entries: %+v", rows)
	}
	for index, row := range rows {
		source := models[index]
		if row.ID != source.ID || row.ModelKey != source.ModelKey || row.ProviderModelKey != source.ProviderModelKey || row.Capability != source.Capability || row.Protocol != source.Protocol || row.ChannelLabel != source.ChannelLabel || row.Enabled != source.Enabled {
			t.Fatalf("sorting metadata does not identify the model at position %d: %+v", index, row)
		}
	}
	if rows[0].Name != "同名模型" || rows[1].Name != "同名模型" || rows[2].Name != "unconfigured-call" {
		t.Fatalf("model display names or identifier fallback changed: %+v", rows)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var payload []map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]any{"modelKey": "image-call", "providerModelKey": "provider-image-v1", "capability": "image", "protocol": "openai-image", "channelLabel": "图片线路", "enabled": false} {
		if payload[1][field] != want {
			t.Errorf("model JSON field %s = %v, want %v", field, payload[1][field], want)
		}
	}
	for _, field := range []string{"providerModelKey", "capability", "protocol", "channelLabel"} {
		if _, exists := payload[2][field]; exists {
			t.Errorf("unconfigured metadata %s should be omitted", field)
		}
	}
	channels, err := svc.AdminChannelOrder(admin, "")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err = json.Marshal(channels)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `[{"id":"channel-a","name":"测试渠道","enabled":true}]` {
		t.Fatalf("channel sorting response must not include model metadata: %s", encoded)
	}
}

func TestVisualChannelOrderAtomicSnapshotAndPermissions(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, id := range []string{"a", "b", "c"} {
		if err := db.Create(&model.ModelChannel{ID: id, Name: id, Scope: model.ChannelScopeSystem, Enabled: true}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := svc.AdminChannelOrder(admin, "")
	if err != nil {
		t.Fatal(err)
	}
	original := []string{}
	for _, row := range rows {
		original = append(original, row.ID)
	}
	req := ChannelOrderRequest{IDs: []string{"c", "a", "b"}, ExpectedIDs: original}
	if err := svc.SaveAdminChannelOrder(nil, "", req); err == nil {
		t.Fatal("nonadmin accepted")
	}
	if err := svc.SaveAdminChannelOrder(admin, "", req); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveAdminChannelOrder(admin, "", req); err == nil {
		t.Fatal("stale snapshot accepted")
	}
	bad := ChannelOrderRequest{IDs: []string{"c", "c", "b"}, ExpectedIDs: []string{"c", "a", "b"}}
	if err := svc.SaveAdminChannelOrder(admin, "", bad); err == nil {
		t.Fatal("duplicate accepted")
	}
	after, _ := svc.AdminChannelOrder(admin, "")
	if after[0].ID != "c" || after[1].ID != "a" {
		t.Fatal("failed save changed order")
	}
	for _, id := range []string{"m1", "m2"} {
		if err := db.Create(&model.ChannelModel{ID: id, ChannelID: "a", ModelKey: id, Enabled: true, PriceVersion: 7, CapabilityVersion: 4, UnitPriceMicrocredits: 123}).Error; err != nil {
			t.Fatal(err)
		}
	}
	models, _ := svc.AdminChannelOrder(admin, "a")
	expected := []string{models[0].ID, models[1].ID}
	if err := svc.SaveAdminChannelOrder(admin, "a", ChannelOrderRequest{IDs: []string{expected[1], expected[0]}, ExpectedIDs: expected}); err != nil {
		t.Fatal(err)
	}
	var stored []model.ChannelModel
	db.Find(&stored)
	for _, item := range stored {
		if item.PriceVersion != 7 || item.CapabilityVersion != 4 || item.UnitPriceMicrocredits != 123 || !item.Enabled {
			t.Fatal("model configuration changed")
		}
	}
	if err := svc.SaveAdminChannelOrder(admin, "b", ChannelOrderRequest{IDs: expected, ExpectedIDs: expected}); err == nil {
		t.Fatal("cross-channel accepted")
	}
}
