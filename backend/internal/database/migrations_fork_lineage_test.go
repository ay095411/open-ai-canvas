package database

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestMigrateSchemaFromForkV83PreservesHistory(t *testing.T) {
	testMigrateSchemaFromForkPreservesHistory(t, 83)
}

func TestMigrateSchemaFromForkV93PreservesHistory(t *testing.T) {
	testMigrateSchemaFromForkPreservesHistory(t, 93)
}

func testMigrateSchemaFromForkPreservesHistory(t *testing.T, forkVersion int64) {
	t.Helper()
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}

	// Pin the fork ledger independently of the current plan: upstream version 78
	// must never replace the already-applied video_remake migration.
	identities := []schemaMigration{
		{Version: 78, Name: "video_remake", Checksum: "sha256:video-remake-v78"},
		{Version: 79, Name: "drama_cast_voice_looks", Checksum: "sha256:drama-cast-voice-looks-v78-20261101"},
		{Version: 80, Name: "ecommerce_agent_and_knowledge", Checksum: "sha256:ecommerce-agent-and-knowledge-v79-20261101"},
		{Version: 81, Name: "payment_order_charge_method", Checksum: "sha256:payment-order-charge-method-v80-20261104"},
		{Version: 82, Name: "ark_portrait_assets", Checksum: "sha256:ark-portrait-assets-v81-20261104"},
		{Version: 83, Name: "token_cache_write_price", Checksum: "sha256:token-cache-write-price-v82-20261105"},
		{Version: 84, Name: "skill_admin_edits", Checksum: "sha256:skill-admin-edits-v83-20261105"},
		{Version: 85, Name: "token_price_rules", Checksum: "sha256:token-price-rules-v84-20261105"},
		{Version: 86, Name: "pose_library", Checksum: "sha256:pose-library-v85-20261105"},
		{Version: 87, Name: "ark_asset_groups", Checksum: "sha256:ark-asset-groups-v86-20261105"},
		{Version: 88, Name: "inspiration_feed", Checksum: "sha256:inspiration-feed-v87-20261105"},
		{Version: 89, Name: "reference_video_billing", Checksum: "sha256:reference-video-billing-v88-20261106"},
		{Version: 90, Name: "reference_video_cost_price", Checksum: "sha256:reference-video-cost-price-v89-20261106"},
		{Version: 91, Name: "drama_draft_form", Checksum: "sha256:drama-draft-form-v90-20261106"},
		{Version: 92, Name: "email_logs_and_notifications", Checksum: "sha256:email-logs-and-notifications-v91-20261106"},
		{Version: 93, Name: "drama_reference_controls", Checksum: "sha256:drama-reference-controls-v92"},
	}
	legacyAppliedAt := time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	for _, item := range schemaMigrations {
		if item.version > forkVersion {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatalf("prepare v%d: %v", item.version, err)
		}
		record := schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum}
		if item.version >= 78 {
			record = identities[item.version-78]
		}
		record.AppliedAt = legacyAppliedAt.Add(time.Duration(item.version) * time.Minute)
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
	}

	// The baseline uses current models; remove new tables so the upgrade must
	// actually create them, not merely append their migration records.
	newTables := []any{&model.PoseLibraryItem{}, &model.PoseLibrarySource{}, &model.ArkPortraitGroupGrant{}, &model.InspirationFeedEntry{}}
	if forkVersion == 93 {
		newTables = []any{&model.EcommerceRound{}, &model.ChannelWebsite{}, &model.SiteTrafficEvent{}, &model.MCPServerTemplate{}, &model.MCPConnection{}, &model.MCPToolExecution{}, &model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{}}
	}
	if err := db.Migrator().DropTable(newTables...); err != nil {
		t.Fatal(err)
	}
	readLedger := func() []schemaMigration {
		t.Helper()
		var records []schemaMigration
		if err := db.Order("version").Find(&records).Error; err != nil {
			t.Fatal(err)
		}
		return records
	}
	before := readLedger()
	if len(before) == 0 || before[len(before)-1].Version != forkVersion {
		t.Fatalf("fixture must stop at the fork's version %d", forkVersion)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade fork v%d: %v", forkVersion, err)
	}
	after := readLedger()
	if len(after) < len(before)+7 || !reflect.DeepEqual(before, after[:len(before)]) {
		t.Fatal("upgrade changed existing migration identities or AppliedAt values")
	}
	byVersion := make(map[int64]schemaMigration, len(after))
	for _, record := range after {
		byVersion[record.Version] = record
	}
	for _, expected := range identities {
		actual, ok := byVersion[expected.Version]
		if !ok || actual.Name != expected.Name || actual.Checksum != expected.Checksum || actual.AppliedAt.IsZero() {
			t.Fatalf("unexpected migration v%d: %+v, want %+v", expected.Version, actual, expected)
		}
	}
	for _, table := range newTables {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("upgrade did not create %T", table)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	if repeated := readLedger(); !reflect.DeepEqual(after, repeated) {
		t.Fatal("repeat migration changed the ledger or migration timestamps")
	}
}
