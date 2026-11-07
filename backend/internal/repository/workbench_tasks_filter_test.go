package repository

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestTasksWithWorkbenchKindRequiresMatchingTaskType(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.EcommerceProject{}); err != nil {
		t.Fatal(err)
	}

	legacyImage := `{"metadata":{"source":"workbench","workbenchKind":"image"}}`
	legacyVideo := `{"metadata":{"source":"workbench","workbenchKind":"video"}}`
	createdAt := time.Now()
	tasks := []model.Task{
		{ID: "image-column", UserID: "user", Type: "canvas_image", WorkbenchKind: "image", InputJSON: `{}`, CreatedAt: createdAt},
		{ID: "image-legacy", UserID: "user", Type: "canvas_image", InputJSON: legacyImage, CreatedAt: createdAt.Add(time.Second)},
		{ID: "video-column", UserID: "user", Type: "canvas_video", WorkbenchKind: "video", InputJSON: `{}`, CreatedAt: createdAt.Add(2 * time.Second)},
		{ID: "video-legacy", UserID: "user", Type: "canvas_video", InputJSON: legacyVideo, CreatedAt: createdAt.Add(3 * time.Second)},
		{ID: "wrong-column-kind", UserID: "user", Type: "canvas_video", WorkbenchKind: "image", InputJSON: `{}`, CreatedAt: createdAt.Add(4 * time.Second)},
		{ID: "wrong-legacy-type", UserID: "user", Type: "canvas_video", InputJSON: legacyImage, CreatedAt: createdAt.Add(5 * time.Second)},
		{ID: "wrong-source", UserID: "user", Type: "canvas_image", InputJSON: `{"metadata":{"source":"canvas","workbenchKind":"image"}}`, CreatedAt: createdAt.Add(6 * time.Second)},
		{ID: "other-user", UserID: "other", Type: "canvas_image", InputJSON: legacyImage, CreatedAt: createdAt.Add(7 * time.Second)},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	for _, tc := range []struct {
		kind string
		want map[string]bool
	}{
		{kind: "image", want: map[string]bool{"image-column": true, "image-legacy": true}},
		{kind: "video", want: map[string]bool{"video-column": true, "video-legacy": true}},
	} {
		got, err := repo.TasksWithWorkbenchKind("user", 50, "", false, tc.kind)
		if err != nil {
			t.Fatalf("list %s tasks: %v", tc.kind, err)
		}
		if len(got) != len(tc.want) {
			t.Fatalf("%s task IDs = %#v, want %d tasks", tc.kind, got, len(tc.want))
		}
		for _, task := range got {
			if !tc.want[task.ID] {
				t.Errorf("%s list included unexpected task %q (type=%q kind=%q)", tc.kind, task.ID, task.Type, task.WorkbenchKind)
			}
			delete(tc.want, task.ID)
		}
		if len(tc.want) != 0 {
			t.Errorf("%s list omitted expected task IDs: %#v", tc.kind, tc.want)
		}
	}
}

func TestTasksWithWorkbenchKindExcludesEcommerceOwnership(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		testIndependentWorkbenchHistory(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		testIndependentWorkbenchHistory(t, ecommerceBatchTestPostgres(t))
	})
}

func testIndependentWorkbenchHistory(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.Task{}, &model.EcommerceProject{}); err != nil {
		t.Fatal(err)
	}
	project := model.EcommerceProject{ID: "ecommerce-project", UserID: "user", Name: "Product", Status: "draft", DraftJSON: "{}", PlanJSON: "{}"}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	createdAt := time.Now()
	for _, kind := range []string{model.WorkbenchKindImage, model.WorkbenchKindVideo} {
		legacy := fmt.Sprintf(`{"metadata":{"source":"workbench","workbenchKind":%q}}`, kind)
		ecommerce := fmt.Sprintf(`{"metadata":{"source":"workbench","workbenchKind":%q,"ecommerceProjectId":"deleted-project"}}`, kind)
		task := func(id, marker, input, projectID string, active bool) model.Task {
			createdAt = createdAt.Add(time.Second)
			status := model.TaskStatusSucceeded
			if active {
				status = model.TaskStatusRunning
			}
			return model.Task{ID: kind + "-" + id, UserID: "user", Type: "canvas_" + kind, WorkbenchKind: marker, InputJSON: input, ProjectID: projectID, Status: status, CreatedAt: createdAt}
		}
		tasks := []model.Task{
			task("column", kind, "{}", "", true),
			task("legacy", "", legacy, "", false),
			task("non-ecommerce-project", kind, "{}", "canvas-project", false),
			task("null-marker", kind, `{"metadata":{"ecommerceProjectId":null}}`, "", false),
			task("blank-marker", kind, `{"metadata":{"ecommerceProjectId":"  "}}`, "", false),
			// These newer ecommerce rows must be excluded before applying LIMIT.
			task("ecommerce-column", kind, ecommerce, "", true),
			task("ecommerce-legacy", "", ecommerce, "", true),
			task("ecommerce-project-only", kind, "{}", project.ID, true),
			task("ecommerce-source", kind, `{"metadata":{"source":"ecommerce-agent"}}`, "", true),
		}
		other := task("other-user", kind, "{}", "", true)
		other.UserID = "other"
		tasks = append(tasks, other)
		if err := db.Create(&tasks).Error; err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			name       string
			limit      int
			activeOnly bool
			want       []string
		}{
			{"history", 100, false, []string{"blank-marker", "null-marker", "non-ecommerce-project", "legacy", "column"}},
			{"limit", 2, false, []string{"blank-marker", "null-marker"}},
			{"active", 100, true, []string{"column"}},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				got, err := repo.TasksWithWorkbenchKind("user", tc.limit, "", tc.activeOnly, kind)
				if err != nil {
					t.Fatal(err)
				}
				ids := make([]string, len(got))
				for index, item := range got {
					ids[index] = item.ID
				}
				want := make([]string, len(tc.want))
				for index, id := range tc.want {
					want[index] = kind + "-" + id
				}
				if !slices.Equal(ids, want) {
					t.Fatalf("task IDs = %v, want %v", ids, want)
				}
			})
		}
	}
	all, err := repo.Tasks("user", 100, "", false)
	if err != nil || len(all) != 18 {
		t.Fatalf("unified task list = %d tasks, %v", len(all), err)
	}
	projectTasks, err := repo.Tasks("user", 100, project.ID, false)
	if err != nil || len(projectTasks) != 2 {
		t.Fatalf("ecommerce project tasks = %d tasks, %v", len(projectTasks), err)
	}
	if _, err := repo.TaskForUser("user", "image-ecommerce-column"); err != nil {
		t.Fatalf("ecommerce task reference became unreadable: %v", err)
	}
}
