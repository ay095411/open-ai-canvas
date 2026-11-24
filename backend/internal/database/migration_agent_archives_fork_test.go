package database

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestMigrateForkV111AppendsAgentArchivesWithoutChangingHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "fork-v111.db")})
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
	legacyTime := time.Date(2026, 11, 22, 0, 0, 0, 0, time.UTC)
	legacyCount := 0
	for _, step := range schemaMigrations {
		if step.version > 111 {
			break
		}
		if err := step.apply(db); err != nil {
			t.Fatalf("prepare fork v%d: %v", step.version, err)
		}
		record := schemaMigration{Version: step.version, Name: step.name, Checksum: step.checksum, AppliedAt: legacyTime.Add(time.Duration(step.version) * time.Minute)}
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
		legacyCount++
	}
	// The current baseline includes new models; remove only archive-era fields
	// from this disposable fixture so v112 must create them during the upgrade.
	if err := db.Migrator().DropTable(&model.CloudAgentHistoryArchive{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.CloudAgentExecution{}, "HistoryCompacted"); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"HistoryCompacted", "CompactedAt"} {
		if err := db.Migrator().DropColumn(&model.CloudAgentExecution{}, field); err != nil {
			t.Fatal(err)
		}
	}
	if db.Migrator().HasTable(&model.CloudAgentHistoryArchive{}) || db.Migrator().HasColumn(&model.CloudAgentExecution{}, "HistoryCompacted") {
		t.Fatal("fixture must represent the pre-archive fork schema")
	}
	const owner = "legacy-owner"
	run := model.CloudAgentExecution{ID: "legacy-run", UserID: owner, Status: "succeeded", StateJSON: `{"note":"历史状态"}`}
	retainedRun := model.CloudAgentExecution{ID: "retained-run", UserID: "retained-owner", Status: "running", StateJSON: `{"keep":true}`}
	for _, record := range []*model.CloudAgentExecution{&run, &retainedRun} {
		if err := db.Omit("HistoryCompacted", "CompactedAt").Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	pi := model.CloudAgentPiSession{RunID: run.ID, UserID: owner, SessionJSONL: "历史会话\n"}
	event := model.CloudAgentEventRecord{RunID: run.ID, Sequence: 1, UserID: owner, EventJSON: `{"event":"完成"}`}
	message := model.CloudAgentMessageRecord{RunID: run.ID, Kind: "assistant", Sequence: 1, UserID: owner, MessageJSON: `{"text":"原消息"}`}
	mutation := model.CloudAgentCanvasMutation{ID: "legacy-mutation", RunID: run.ID, UserID: owner, BeforeJSON: `{"title":"原画布"}`}
	usage := model.AgentStorageUsage{UserID: retainedRun.UserID, StoredBytes: 777, UpdatedAt: legacyTime}
	library := model.InspirationLibraryEntry{Slug: "preserved-inspiration", PayloadJSON: `{"origin":"fixture"}`, ContentHash: "content", ImageHash: "image", Title: "preserved", Mode: "image", CreatedBy: owner, UpdatedBy: owner}
	for _, record := range []any{&pi, &event, &message, &mutation, &usage, &library} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	readLedger := func() []schemaMigration {
		t.Helper()
		var rows []schemaMigration
		if err := db.Order("version").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		return rows
	}
	before := readLedger()
	if len(before) != legacyCount || before[len(before)-1].Version != 111 {
		t.Fatalf("fixture must stop at the released fork v111 ledger: count=%d want=%d", len(before), legacyCount)
	}
	var beforeLibrary model.InspirationLibraryEntry
	if err := db.First(&beforeLibrary, "slug = ?", library.Slug).Error; err != nil {
		t.Fatal(err)
	}
	contentRows := []struct {
		stored any
		query  string
		key    any
		before any
	}{
		{stored: &model.CloudAgentPiSession{}, query: "run_id = ?", key: pi.RunID},
		{stored: &model.CloudAgentEventRecord{}, query: "run_id = ?", key: event.RunID},
		{stored: &model.CloudAgentMessageRecord{}, query: "run_id = ?", key: message.RunID},
		{stored: &model.CloudAgentCanvasMutation{}, query: "id = ?", key: mutation.ID},
	}
	for index := range contentRows {
		row := &contentRows[index]
		if err := db.First(row.stored, row.query, row.key).Error; err != nil {
			t.Fatal(err)
		}
		row.before = reflect.ValueOf(row.stored).Elem().Interface()
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade fork v111: %v", err)
	}
	after := readLedger()
	if len(after) != len(before)+1 || !reflect.DeepEqual(before, after[:len(before)]) {
		t.Fatal("archive upgrade changed an existing migration identity or timestamp")
	}
	archiveStep := after[len(after)-1]
	if archiveStep.Version != 112 || archiveStep.Name != "cloud_agent_history_archives" || archiveStep.Checksum != "sha256:cloud-agent-history-archives-v110-20261123" {
		t.Fatalf("archive migration was not appended with its upstream identity: %+v", archiveStep)
	}
	if !db.Migrator().HasTable(&model.CloudAgentHistoryArchive{}) || !db.Migrator().HasColumn(&model.CloudAgentExecution{}, "HistoryCompacted") || !db.Migrator().HasColumn(&model.CloudAgentExecution{}, "CompactedAt") || !db.Migrator().HasIndex(&model.CloudAgentExecution{}, "HistoryCompacted") {
		t.Fatal("archive table, fields or index were not created")
	}
	var upgradedRun model.CloudAgentExecution
	if err := db.First(&upgradedRun, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if upgradedRun.StateJSON != run.StateJSON || upgradedRun.Status != run.Status || upgradedRun.HistoryCompacted || upgradedRun.CompactedAt != nil {
		t.Fatalf("schema upgrade altered or compacted legacy history: %+v", upgradedRun)
	}
	for _, pair := range contentRows {
		if err := db.First(pair.stored, pair.query, pair.key).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(pair.before, reflect.ValueOf(pair.stored).Elem().Interface()) {
			t.Fatalf("schema upgrade changed existing %T content", pair.stored)
		}
	}
	var backfilled, retained model.AgentStorageUsage
	if err := db.First(&backfilled, "user_id = ?", owner).Error; err != nil {
		t.Fatal(err)
	}
	wantBytes := int64(len(run.StateJSON) + len(pi.SessionJSONL) + len(event.EventJSON) + len(message.MessageJSON) + len(mutation.BeforeJSON))
	if backfilled.StoredBytes != wantBytes {
		t.Fatalf("missing ledger not backfilled by UTF-8 byte length: got %d want %d", backfilled.StoredBytes, wantBytes)
	}
	if err := db.First(&retained, "user_id = ?", usage.UserID).Error; err != nil || retained.StoredBytes != usage.StoredBytes || !retained.UpdatedAt.Equal(usage.UpdatedAt) {
		t.Fatalf("authoritative ledger was overwritten: %+v %v", retained, err)
	}
	var preserved model.InspirationLibraryEntry
	if err := db.First(&preserved, "slug = ?", library.Slug).Error; err != nil || !reflect.DeepEqual(beforeLibrary, preserved) {
		t.Fatalf("unrelated inspiration business data changed: %+v %v", preserved, err)
	}
	var archives int64
	if err := db.Model(&model.CloudAgentHistoryArchive{}).Count(&archives).Error; err != nil || archives != 0 {
		t.Fatalf("schema upgrade must not compact runs: archives=%d err=%v", archives, err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repeat archive migration: %v", err)
	}
	if !reflect.DeepEqual(after, readLedger()) {
		t.Fatal("repeated migration changed identities or timestamps")
	}
	if err := db.First(&backfilled, "user_id = ?", owner).Error; err != nil || backfilled.StoredBytes != wantBytes {
		t.Fatalf("repeated migration changed ledger bytes: %+v %v", backfilled, err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 112 {
		t.Fatalf("unexpected archive schema status: %+v %v", status, err)
	}
}

func TestForkAgentStorageMigrationKeepsPublishedBehavior(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "storage-v105.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CloudAgentExecution{ID: "published-run", UserID: "owner", StateJSON: `{"state":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateAgentStorageLimits(db); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.AgentStorageUsage{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("published v105 must not newly backfill owners: count=%d err=%v", count, err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return reconcileAgentStorageUsage(tx) }); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.AgentStorageUsage{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("new reconciliation did not add a missing owner: count=%d err=%v", count, err)
	}
}
