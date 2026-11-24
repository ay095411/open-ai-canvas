package inspirations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/repository"
)

type videoRehearsalMarker struct {
	Purpose              string `json:"purpose"`
	DBSHA256             string `json:"dbSHA256"`
	SourceOpenedReadOnly bool   `json:"sourceOpenedReadOnly"`
}

func videoRehearsalDBPath(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("INSPIRATION_VIDEO_REHEARSAL_DB")
	if raw == "" {
		t.Skip("set INSPIRATION_VIDEO_REHEARSAL_DB to a marked complete backup copy for the domain-only runtime rehearsal")
	}
	if !filepath.IsAbs(raw) {
		t.Fatal("rehearsal requires an absolute backup-copy path")
	}
	resolved, err := filepath.EvalSymlinks(raw)
	if err != nil {
		t.Fatal("rehearsal backup copy cannot be resolved")
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil || filepath.Base(resolved) != "database-rehearsal.db" || !strings.Contains(strings.ToLower(filepath.ToSlash(resolved)), "/.local/cache/") {
		t.Fatal("rehearsal path must name database-rehearsal.db inside a resolved .local/cache directory")
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		t.Fatal("rehearsal requires an existing nonempty regular backup file")
	}
	markerBytes, err := os.ReadFile(filepath.Join(filepath.Dir(resolved), ".inspiration-video-rehearsal.json"))
	if err != nil {
		t.Fatal("rehearsal backup marker is missing")
	}
	var marker videoRehearsalMarker
	if err := json.Unmarshal(markerBytes, &marker); err != nil || marker.Purpose != "inspiration-video-sync-copy" || !marker.SourceOpenedReadOnly {
		t.Fatal("rehearsal marker does not describe an authorized read-only source backup")
	}
	bytes, err := os.ReadFile(resolved)
	if err != nil {
		t.Fatal("cannot read rehearsal backup to validate SHA256")
	}
	digest := sha256.Sum256(bytes)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), marker.DBSHA256) {
		t.Fatal("rehearsal backup SHA256 differs from its marker")
	}
	return resolved
}

func videoRehearsalDigestRows(t *testing.T, db *sql.DB, query string, args ...any) string {
	t.Helper()
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatal("cannot read rehearsal snapshot rows")
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal("cannot read rehearsal snapshot columns")
	}
	encodedRows := []string{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for index := range values {
			pointers[index] = &values[index]
		}
		if err := rows.Scan(pointers...); err != nil {
			t.Fatal("cannot scan rehearsal snapshot row")
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			t.Fatal("cannot encode rehearsal snapshot row")
		}
		encodedRows = append(encodedRows, string(encoded))
	}
	if rows.Err() != nil {
		t.Fatal("rehearsal snapshot row read failed")
	}
	sort.Strings(encodedRows)
	encoded, err := json.Marshal(struct {
		Columns []string
		Rows    []string
	}{columns, encodedRows})
	if err != nil {
		t.Fatal("cannot encode rehearsal snapshot")
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func videoRehearsalBusinessSnapshot(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		t.Fatal("cannot enumerate rehearsal business tables")
	}
	tables := []string{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			_ = rows.Close()
			t.Fatal("cannot read rehearsal table name")
		}
		tables = append(tables, table)
	}
	if rows.Err() != nil {
		_ = rows.Close()
		t.Fatal("cannot finish rehearsal table enumeration")
	}
	_ = rows.Close()
	result := map[string]string{}
	for _, table := range tables {
		if table == "inspiration_feed_entries" {
			continue
		}
		quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
		query := "SELECT * FROM " + quoted
		var args []any
		if table == "system_settings" {
			query += ` WHERE "key" <> ?`
			args = []any{stateKey}
		}
		result[table] = videoRehearsalDigestRows(t, db, query, args...)
	}
	return result
}

// This gated rehearsal never composes app or starts unrelated resource/queue workers.
func TestAutomaticVideoSyncRuntimeRehearsal(t *testing.T) {
	path := videoRehearsalDBPath(t)
	db, err := gorm.Open(sqlite.Open(path+"?mode=rw&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("cannot open authorized rehearsal copy")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal("cannot obtain rehearsal copy connection")
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	beforeSchema := videoRehearsalDigestRows(t, sqlDB, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
	beforeBusiness := videoRehearsalBusinessSnapshot(t, sqlDB)
	svc := New(repository.New(db), feedTestAdminGate{}, nil, nil)
	settings, err := svc.settings()
	if err != nil || !settings.Enabled {
		t.Fatal("runtime rehearsal requires the enabled existing feed configuration")
	}
	beforeState, err := svc.readState()
	if err != nil || beforeState.VideoLinks != nil {
		t.Fatal("runtime rehearsal copy must be an old sync state without video metadata")
	}
	if next := nextSyncAt(beforeState); next == nil || !svc.now().Before(*next) {
		t.Fatal("runtime rehearsal requires the old six-hour sync to be not yet due")
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncTimeout)
	defer cancel()
	svc.syncIfDue(ctx)
	state, err := svc.readState()
	if err != nil || state.VideoLinks == nil || state.VideoLinks.Version != 1 || len(state.VideoLinks.Entries) == 0 || state.VideoLinks.SyncedAt == nil || state.Trigger != TriggerSchedule {
		t.Fatal("scheduled bootstrap did not persist valid public video metadata")
	}
	for _, link := range state.VideoLinks.Entries {
		if !validVideoLink(link) {
			t.Fatal("runtime sync persisted an invalid video address")
		}
	}
	restarted := New(repository.New(db), feedTestAdminGate{}, nil, nil)
	feed, err := restarted.Feed()
	if err != nil || feed.VideoLinks == nil || !reflect.DeepEqual(feed.VideoLinks, state.VideoLinks) {
		t.Fatal("new domain instance could not read persisted runtime video metadata")
	}
	called := false
	restarted.sources = []source{{id: "seedance", load: func(context.Context, fetchFunc) (batch, error) {
		called = true
		return batch{}, errors.New("sentinel must not be fetched before the next scheduled sync")
	}}}
	restarted.syncIfDue(context.Background())
	if called {
		t.Fatal("runtime bootstrap repeated before its next due time")
	}
	afterState, err := restarted.readState()
	if err != nil || !reflect.DeepEqual(state, afterState) {
		t.Fatal("not-yet-due scheduled check wrote state")
	}
	afterSchema := videoRehearsalDigestRows(t, sqlDB, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
	afterBusiness := videoRehearsalBusinessSnapshot(t, sqlDB)
	if beforeSchema != afterSchema {
		t.Fatal("runtime video sync changed database structure")
	}
	if !reflect.DeepEqual(beforeBusiness, afterBusiness) {
		t.Fatal("runtime video sync changed unrelated business rows")
	}
	partialFailures := 0
	for _, result := range state.Sources {
		if result.Error != "" {
			partialFailures++
		}
	}
	t.Logf("videoLinks=%d feedEntries=%d businessTables=%d schemaUnchanged=true businessUnchanged=true restartRead=true notYetDueSkipped=true partialSourceFailures=%d", len(state.VideoLinks.Entries), len(feed.Entries), len(beforeBusiness), partialFailures)
}
