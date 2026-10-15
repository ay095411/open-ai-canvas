package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestUserCanvasLibraryPageIsBoundedAndScoped(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	for index := 0; index < 55; index++ {
		project := model.CanvasProject{ID: fmt.Sprintf("canvas-%02d", index), UserID: "owner", Title: fmt.Sprintf("Title %02d", index), PayloadJSON: `{"nodes":[{"id":"image","type":"image","metadata":{"storageKey":"resource:preview","content":"secret-inline-media","prompt":"secret-prompt"}}],"chatSessions":["secret-chat"]}`}
		if err := db.Create(&project).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.CanvasProject{ID: "foreign", UserID: "other", Title: "Foreign", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	page, err := service.UserCanvasProjectsPage("owner", 1, 999, "", "", "name")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Projects) != 50 || page.Total != 55 || !page.HasMore || page.PageSize != 50 {
		t.Fatalf("unexpected pagination: %+v", page)
	}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "foreign") {
		t.Fatal("page exposed full payload or another account")
	}
	last, err := service.UserCanvasProjectsPage("owner", 2, 50, "", "", "name")
	if err != nil || len(last.Projects) != 5 || last.HasMore {
		t.Fatalf("last page: %+v %v", last, err)
	}
	filtered, err := service.UserCanvasProjectsPage("owner", 1, 40, "", "Title 04", "name")
	if err != nil || filtered.Total != 1 || filtered.Projects[0].NodeCount != 1 {
		t.Fatalf("filter: %+v %v", filtered, err)
	}
}

// 「最近创建」区块走 sort=created：口径必须只看建立时间，不能被最后编辑时间影响。
func TestUserCanvasLibraryPageSortsByCreationTime(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for index := 0; index < 3; index++ {
		id := fmt.Sprintf("canvas-%d", index)
		project := model.CanvasProject{ID: id, UserID: "owner", Title: fmt.Sprintf("Title %d", index), PayloadJSON: `{"nodes":[]}`}
		if err := db.Create(&project).Error; err != nil {
			t.Fatal(err)
		}
		// 建立顺序与最后编辑顺序刻意相反：先建的反而最后被编辑，两种口径才区分得开。
		stamps := map[string]any{
			"created_at": base.Add(time.Duration(index) * time.Hour),
			"updated_at": base.Add(time.Duration(2-index) * time.Hour),
		}
		if err := db.Model(&model.CanvasProject{}).Where("id = ?", id).UpdateColumns(stamps).Error; err != nil {
			t.Fatal(err)
		}
	}
	created, err := service.UserCanvasProjectsPage("owner", 1, 10, "", "", "created")
	if err != nil {
		t.Fatal(err)
	}
	if len(created.Projects) != 3 || created.Projects[0].ID != "canvas-2" || created.Projects[2].ID != "canvas-0" {
		t.Fatalf("created sort must follow creation time: %+v", created.Projects)
	}
	updated, err := service.UserCanvasProjectsPage("owner", 1, 10, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Projects) != 3 || updated.Projects[0].ID != "canvas-0" {
		t.Fatalf("default sort must follow last edit: %+v", updated.Projects)
	}
}

func TestUserAssetsBatchIsBoundedAndScoped(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	for _, owner := range []string{"owner", "other"} {
		if err := db.Create(&model.Asset{ID: owner, UserID: owner, PayloadJSON: fmt.Sprintf(`{"id":%q}`, owner)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	assets, err := service.UserAssetsByIDs("owner", []string{"owner", "owner", "other", "missing"})
	if err != nil || len(assets) != 1 {
		t.Fatalf("unexpected assets: %s %v", assets, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(assets[0], &payload); err != nil || payload["id"] != "owner" {
		t.Fatalf("unexpected asset payload: %s %v", assets[0], err)
	}
	if _, ok := payload["tags"]; !ok {
		t.Fatalf("client payload missing tags: %s", assets[0])
	}
	empty, err := service.UserAssetsByIDs("owner", nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty IDs must not list account: %s %v", empty, err)
	}
	if _, err := service.UserAssetsByIDs("owner", make([]string, 101)); err == nil {
		t.Fatal("expected batch limit")
	}
	if _, err := service.UserAssetsByIDs("owner", []string{" "}); err == nil {
		t.Fatal("expected invalid ID error")
	}
}
