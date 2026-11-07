package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestWorkbenchHistoryKeepsEcommerceTasksInTheirProject(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	tasks := []model.Task{
		{ID: "studio-history", UserID: "user", Type: "canvas_image", WorkbenchKind: "image", InputJSON: `{}`, Status: model.TaskStatusSucceeded},
		{ID: "ecommerce-history", UserID: "user", ProjectID: project.ID, Type: "canvas_image", WorkbenchKind: "image", InputJSON: `{"metadata":{"source":"workbench","workbenchKind":"image"}}`, Status: model.TaskStatusSucceeded},
	}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	features := defaultFeatureAvailability()
	features.EcommerceEnabled = false
	features.ImageWorkbenchEnabled = false
	saveAdmissionFeatures(t, s, features)

	studio, err := s.WorkbenchTasks("user", "image", false, 100)
	if err != nil || len(studio) != 1 || studio[0].ID != "studio-history" {
		t.Fatalf("independent studio history = %#v, %v", studio, err)
	}
	all, err := s.TasksWithOptions("user", TaskListOptions{Limit: 100})
	if err != nil || len(all) != 2 {
		t.Fatalf("unified history = %#v, %v", all, err)
	}
	linked, err := s.TasksWithOptions("user", TaskListOptions{Limit: 100, ProjectID: project.ID})
	if err != nil || len(linked) != 1 || linked[0].ID != "ecommerce-history" {
		t.Fatalf("ecommerce project history = %#v, %v", linked, err)
	}
	if _, err := s.Task("user", "ecommerce-history"); err != nil {
		t.Fatalf("existing ecommerce task reference failed: %v", err)
	}
	if _, err := s.Task("other", "ecommerce-history"); err == nil {
		t.Fatal("another user read the ecommerce task")
	}
}
