package database

import (
	"reflect"
	"testing"
)

func TestForkMigrationPlanAppendsTeamSchema(t *testing.T) {
	if CurrentSchemaVersion != 112 {
		t.Fatalf("fork schema version = %d, want 112", CurrentSchemaVersion)
	}
	// These identities have already been published by the fork. New upstream
	// migrations must append after them, never replace the same version.
	expected := []schemaMigration{
		{Version: 78, Name: "video_remake", Checksum: "sha256:video-remake-v78"},
		{Version: 103, Name: "wechat_oauth", Checksum: "sha256:wechat-oauth-v102"},
		{Version: 104, Name: "mcp_tenant_boundaries", Checksum: "sha256:mcp-tenant-boundaries-v103"},
		{Version: 105, Name: "agent_storage_limits", Checksum: "sha256:agent-storage-limits-v104"},
		{Version: 106, Name: "authorized_inspiration_library", Checksum: "sha256:authorized-inspiration-library-v106"},
		{Version: 107, Name: "image_usage_billing", Checksum: "sha256:image-usage-billing-v105"},
		{Version: 108, Name: "team_workspaces", Checksum: "sha256:team-workspaces-v106"},
		{Version: 109, Name: "company_workgroups", Checksum: "sha256:company-workgroups-v107"},
		{Version: 110, Name: "shared_workspace_content", Checksum: "sha256:shared-workspace-content-v108"},
		{Version: 111, Name: "model_protocol_releases", Checksum: "sha256:model-protocol-releases-v109"},
		{Version: 112, Name: "cloud_agent_history_archives", Checksum: "sha256:cloud-agent-history-archives-v110-20261123"},
	}
	byVersion := make(map[int64]migration, len(schemaMigrations))
	for _, step := range schemaMigrations {
		if _, exists := byVersion[step.version]; exists {
			t.Fatalf("duplicate migration version %d", step.version)
		}
		byVersion[step.version] = step
	}
	for _, identity := range expected {
		step, exists := byVersion[identity.Version]
		if !exists || step.name != identity.Name || step.checksum != identity.Checksum || step.apply == nil {
			t.Fatalf("migration v%d changed identity: %+v, want %+v", identity.Version, step, identity)
		}
	}
}

func TestModelsIncludeTeamAndForkDomains(t *testing.T) {
	want := map[string]bool{
		"Team": false, "TeamMembership": false, "TeamInvitation": false,
		"CreditTransfer": false, "TeamAssetPublication": false,
		"InspirationLibraryEntry": false, "CloudAgentHistoryArchive": false, "RemakeProject": false,
		"RemakeRevision": false, "RemakeRun": false, "RemakeStep": false,
		"RemakeTake": false, "RemakeExport": false, "RemakeResourceReference": false,
	}
	for _, item := range Models() {
		name := reflect.TypeOf(item).Elem().Name()
		if _, exists := want[name]; exists {
			if want[name] {
				t.Fatalf("Models includes %s more than once", name)
			}
			want[name] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("Models is missing %s", name)
		}
	}
}
