package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"

	"gorm.io/gorm"
)

func ecommerceCreationTestService(t *testing.T) (*Service, *gorm.DB, string, CreationGuard) {
	t.Helper()
	s, db, id, guard := creationTestService(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled = true, true
	features.ImageWorkbenchEnabled, features.VideoWorkbenchEnabled = true, true
	saveAdmissionFeatures(t, s, features)
	return s, db, id, guard
}

func saveAdmissionFeatures(t *testing.T, s *Service, value FeatureAvailability) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
}

func TestEcommerceFeatureAliasesAndJSONSchema(t *testing.T) {
	s, _ := newFeatureAvailabilityTestService(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.EcommerceVideoEnabled = true, true
	saveAdmissionFeatures(t, s, features)
	for _, feature := range []string{FeatureEcommerce, FeatureEcommerceVideo} {
		if enabled, err := s.FeatureEnabled(feature); err != nil || !enabled {
			t.Fatalf("feature %q = %v, %v", feature, enabled, err)
		}
	}
	if _, err := s.FeatureEnabled("Ecommerce"); err == nil {
		t.Fatal("feature names must use the canonical case")
	}
	public, err := s.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(encoded, &schema); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"ecommerceEnabled", "ecommerceVideoEnabled"} {
		if value, ok := schema[field].(bool); !ok || !value {
			t.Fatalf("field %s = %#v", field, schema[field])
		}
	}
}

func TestEcommerceTaskAdmissionUsesOwnedProjectAndMediaKind(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	foreign := &model.EcommerceProject{ID: "foreign-commerce", UserID: "other", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
	if err := db.Create(foreign).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, taskType, mode, projectID, source, metadataProject, kind, want string
		ecommerce, image, video, ecommerceVideo                              bool
	}{
		{name: "project_without_source", taskType: "canvas_text", projectID: project.ID, image: true, video: true, want: "电商创作"},
		{name: "untrusted_source", taskType: "canvas_text", source: "ecommerce-agent", ecommerce: true, want: "必须关联"},
		{name: "foreign_project", taskType: "canvas_image", metadataProject: foreign.ID, ecommerce: true, image: true, want: "项目不存在"},
		{name: "unknown_project", taskType: "canvas_image", metadataProject: "unknown", ecommerce: true, image: true, want: "项目不存在"},
		{name: "inconsistent_project", taskType: "canvas_image", projectID: "another-project", metadataProject: project.ID, ecommerce: true, image: true, want: "项目不一致"},
		{name: "ecommerce_image_without_studio", taskType: "canvas_image", projectID: project.ID, ecommerce: true},
		{name: "metadata_image_without_studio", taskType: "canvas_image", metadataProject: project.ID, ecommerce: true},
		{name: "ecommerce_disabled_image", taskType: "canvas_image", projectID: project.ID, image: true, want: "电商创作"},
		{name: "video_as_text_type", taskType: "canvas_text", mode: "video", projectID: project.ID, ecommerce: true, video: true, want: "电商视频"},
		{name: "ecommerce_video_disabled", taskType: "canvas_video", projectID: project.ID, ecommerce: true, video: true, want: "电商视频"},
		{name: "persisted_video_kind", taskType: "canvas_text", kind: WorkbenchKindVideo, projectID: project.ID, ecommerce: true, video: true, want: "电商视频"},
		{name: "ecommerce_video_without_studio", taskType: "canvas_video", projectID: project.ID, ecommerce: true, ecommerceVideo: true},
		{name: "ecommerce_disabled_video", taskType: "canvas_video", projectID: project.ID, video: true, ecommerceVideo: true, want: "电商创作"},
		{name: "planning_without_media", taskType: "canvas_text", projectID: project.ID, ecommerce: true},
		{name: "studio_image_disabled", taskType: "canvas_image", kind: WorkbenchKindImage, ecommerce: true, want: "生图"},
		{name: "studio_image_enabled", taskType: "canvas_image", kind: WorkbenchKindImage, image: true},
		{name: "studio_video_disabled", taskType: "canvas_video", kind: WorkbenchKindVideo, ecommerce: true, ecommerceVideo: true, want: "视频暂未开放"},
		{name: "studio_video_enabled", taskType: "canvas_video", kind: WorkbenchKindVideo, video: true},
		{name: "ordinary_canvas_image", taskType: "canvas_image"},
		{name: "ordinary_canvas_video", taskType: "canvas_video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			features := defaultFeatureAvailability()
			features.EcommerceEnabled, features.ImageWorkbenchEnabled = tc.ecommerce, tc.image
			features.VideoWorkbenchEnabled, features.EcommerceVideoEnabled = tc.video, tc.ecommerceVideo
			saveAdmissionFeatures(t, s, features)
			input := map[string]any{"mode": tc.mode, "metadata": map[string]any{"source": tc.source, "ecommerceProjectId": tc.metadataProject}}
			err := s.requireTaskGenerationFeatures("user", tc.projectID, tc.taskType, "", tc.kind, input)
			if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("admission = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestEcommerceDisabledWritesKeepHistoryAndManualRetryGate(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusFailed, InputJSON: `{"mode":"text","config":{"channelId":"channel","model":"text-test"}}`}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	disabled := defaultFeatureAvailability()
	disabled.ImageWorkbenchEnabled, disabled.VideoWorkbenchEnabled = true, true
	saveAdmissionFeatures(t, s, disabled)
	checks := []func() error{
		func() error { _, err := s.CreateEcommerceProject("user"); return err },
		func() error {
			_, err := s.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{})
			return err
		},
		func() error {
			_, err := s.CreateEcommercePlanningTask("user", project.ID, CreateTaskRequest{})
			return err
		},
		func() error {
			_, err := s.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{})
			return err
		},
		func() error {
			_, err := s.AnalyzeEcommerceAgent(context.Background(), "user", ecommerceagent.Request{})
			return err
		},
		func() error {
			_, err := s.GenerateEcommerceAgent(context.Background(), "user", ecommerceagent.Request{}, func(ecommerceagent.Event) error { return nil })
			return err
		},
		func() error { _, err := s.RetryTask("user", task.ID); return err },
	}
	for index, check := range checks {
		var denied *AuthError
		if err := check(); !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("write %d = %v", index, err)
		}
	}
	if _, err := s.EcommerceProject("user", project.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EcommerceProjects("user"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Task("user", task.ID); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{WorkbenchKindImage, WorkbenchKindVideo} {
		if _, err := s.WorkbenchTasks("user", kind, false, 10); err != nil {
			t.Fatalf("history %s: %v", kind, err)
		}
	}
	if _, err := s.EcommerceManagedSkills(&model.User{ID: "admin", Role: model.UserRoleAdmin}); err != nil {
		t.Fatalf("admin configuration was gated: %v", err)
	}
}

func TestEcommerceMediaCreationAndRetryIndependentOfStudio(t *testing.T) {
	for _, kind := range []string{WorkbenchKindImage, WorkbenchKindVideo} {
		t.Run(kind, func(t *testing.T) {
			s, db, _, _ := ecommerceCreationTestService(t)
			project, err := s.CreateEcommerceProject("user")
			if err != nil {
				t.Fatal(err)
			}
			features := defaultFeatureAvailability()
			features.EcommerceEnabled, features.EcommerceVideoEnabled = true, true
			saveAdmissionFeatures(t, s, features)
			modelName, protocol := "gpt-image-2", model.ChannelInterfaceOpenAIImage
			parameters := map[string]any{"size": "1024x1024", "count": 1}
			if kind == WorkbenchKindVideo {
				modelName, protocol = "MiniMax-H3", model.ChannelInterfaceMiniMaxVideo
				parameters = map[string]any{"resolution": "480P", "ratio": "16:9", "seconds": 15}
			}
			profile := DefaultModelCapabilityConfigForModel(string(protocol), modelName)
			if kind == WorkbenchKindVideo {
				profile.Video.Operations = []string{"text_to_video", "image_to_video"}
				profile.Video.Resolutions = []string{"480P"}
				profile.Video.DefaultResolution = "480P"
			}
			for _, value := range []any{
				&model.ChannelModel{ID: "media-model", ChannelID: "channel", ModelKey: modelName, Capability: kind, Protocol: protocol, Enabled: true, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile)},
				&model.ChannelModelPriceTier{ID: "media-price", ChannelModelID: "media-model", SelectorKey: `{}`, SelectorJSON: `{}`, BillingMode: "fixed_request", UnitPriceMicrocredits: 10, PriceConfigured: true, Enabled: true},
				&model.Resource{ID: "foreign-reference", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
			} {
				if err := db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}
			req := WorkbenchTaskInput{Kind: kind, Prompt: "Show the product", Model: modelName, ChannelID: "channel", Parameters: parameters, EcommerceProjectID: project.ID}
			for _, mutate := range []func(*WorkbenchTaskInput){
				func(value *WorkbenchTaskInput) { value.EcommerceProjectID = "" },
				func(value *WorkbenchTaskInput) { value.EcommerceProjectID = "unknown" },
				func(value *WorkbenchTaskInput) { value.Model = "unavailable-model" },
				func(value *WorkbenchTaskInput) {
					value.References = []workbench.TaskReference{{ResourceID: "foreign-reference", Kind: "image"}}
				},
			} {
				invalid := req
				mutate(&invalid)
				if _, err := s.CreateWorkbenchTask("user", invalid, "", ""); err == nil {
					t.Fatalf("untrusted or standalone %s task was accepted: %+v", kind, invalid)
				}
			}
			var orders int64
			if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil || orders != 0 {
				t.Fatalf("rejected tasks created %d billing orders: %v", orders, err)
			}
			task, err := s.CreateWorkbenchTask("user", req, "", "")
			if err != nil {
				t.Fatal(err)
			}
			if task.ProjectID != project.ID || task.WorkbenchKind != kind || task.BillingOrderID == "" {
				t.Fatalf("task lost owned project, kind or billing: %+v", task)
			}
			if _, err := s.CancelTask(context.Background(), "user", task.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.RetryTask("other", task.ID); err == nil {
				t.Fatal("foreign task retry was accepted")
			}
			disabled := features
			if kind == WorkbenchKindImage {
				disabled.EcommerceEnabled, disabled.ImageWorkbenchEnabled = false, true
			} else {
				disabled.EcommerceVideoEnabled, disabled.VideoWorkbenchEnabled = false, true
			}
			saveAdmissionFeatures(t, s, disabled)
			if _, err := s.RetryTask("user", task.ID); err == nil {
				t.Fatal("standalone studio feature admitted a disabled ecommerce retry")
			}
			saveAdmissionFeatures(t, s, features)
			retried, err := s.RetryTask("user", task.ID)
			if err != nil || retried.ID != task.ID || retried.Status != model.TaskStatusQueued || retried.BillingOrderID == task.BillingOrderID {
				t.Fatalf("ecommerce retry = %+v, %v", retried, err)
			}
			// Regeneration reaches the same public task admission and model catalog.
			config := map[string]any{"channelId": "channel", "model": modelName, "size": "1024x1024"}
			if kind == WorkbenchKindVideo {
				config["size"], config["vquality"], config["videoSeconds"] = "16:9", "480P", "15"
			}
			input := map[string]any{
				"mode": kind, "config": config,
				"metadata": map[string]any{"source": "workbench", "workbenchKind": kind, "ecommerceProjectId": project.ID},
			}
			regenerated, err := s.CreateTask("user", CreateTaskRequest{ProjectID: project.ID, Type: "canvas_" + kind, Operation: task.Operation, Prompt: req.Prompt, Input: input})
			if err != nil || regenerated.ID == task.ID || regenerated.ProjectID != project.ID || regenerated.BillingOrderID == "" {
				t.Fatalf("ecommerce regeneration = %+v, %v", regenerated, err)
			}
		})
	}
}

func TestEcommerceAcceptedResultPersistenceAndCancellationStayOpen(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	project, err := s.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusQueued, Stage: "等待队列调度", InputJSON: `{}`}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	saveAdmissionFeatures(t, s, defaultFeatureAvailability())
	platform, _ := ecommerceagent.PlatformFor("淘宝")
	brief := ecommerceagent.Brief{Category: "耳机"}
	analysis := ecommerceagent.Analysis{Brief: brief, Recommendations: ecommerceagent.MockStyleRecommendations(brief, platform, "main", 3, "1:1")}
	if _, err := s.storeEcommerceWorkbenchDirections("user", project.ID, EcommerceDraft{ProductName: "耳机", Category: "数码", Platform: "taobao", ImageType: "main", Count: 3, Ratio: "1:1"}, analysis); err != nil {
		t.Fatalf("accepted result was gated: %v", err)
	}
	if _, err := s.CancelTask(context.Background(), "user", task.ID); err != nil {
		t.Fatalf("queued cancellation was gated: %v", err)
	}
}

type ecommerceQueuedExecutionProbe struct {
	*Service
	calls int
}

func (p *ecommerceQueuedExecutionProbe) processTask(context.Context, model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	p.calls++
	return nil, nil, errors.New("upstream timeout")
}

func TestEcommerceQueuedFeatureCheckPreservesAcceptedWork(t *testing.T) {
	for _, tc := range []struct {
		name, dispatch, requestID, kind, wantError string
		uncertain, ecommerce, ecommerceVideo       bool
		image, video                               bool
		wantCalls                                  int
	}{
		{name: "unsent"},
		{name: "uncertain_billing", uncertain: true},
		{name: "accepted", dispatch: "accepted", uncertain: true, wantCalls: 1},
		{name: "unknown", dispatch: "submission_unknown", uncertain: true, wantCalls: 1},
		{name: "provider_id", requestID: "accepted-request", uncertain: true, wantCalls: 1},
		{name: "ecommerce_image_studio_off", kind: WorkbenchKindImage, ecommerce: true, uncertain: true, wantCalls: 1},
		{name: "ecommerce_video_studio_off", kind: WorkbenchKindVideo, ecommerce: true, ecommerceVideo: true, uncertain: true, wantCalls: 1},
		{name: "ecommerce_image_off_studio_on", kind: WorkbenchKindImage, image: true},
		{name: "ecommerce_video_off_studio_on", kind: WorkbenchKindVideo, ecommerce: true, video: true, wantError: "电商视频"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			features := defaultFeatureAvailability()
			features.EcommerceEnabled, features.EcommerceVideoEnabled = tc.ecommerce, tc.ecommerceVideo
			features.ImageWorkbenchEnabled, features.VideoWorkbenchEnabled = tc.image, tc.video
			saveAdmissionFeatures(t, s, features)
			project := &model.EcommerceProject{ID: newID(), UserID: "user", DraftJSON: "{}", PlanJSON: "{}", Revision: 1}
			task := &model.Task{ID: newID(), UserID: "user", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: `{"mode":"text","config":{"channelId":"system","model":"test"}}`, RouteRun: 1, ProviderRequestID: tc.requestID}
			if tc.kind != "" {
				task.Type, task.WorkbenchKind = "canvas_"+tc.kind, tc.kind
				task.InputJSON = `{"mode":"` + tc.kind + `","config":{"channelId":"system","model":"test"}}`
			}
			order := &model.BillingOrder{ID: newID(), UserID: "user", TaskID: task.ID, IdempotencyKey: newID(), Status: model.BillingStatusReserved, AmountMicrocredits: 100, ReservedAmountMicrocredits: 100}
			if tc.name == "uncertain_billing" {
				order.Status = model.BillingStatusUncertain
			}
			if tc.wantCalls > 0 {
				order.ProviderRequestID = "accepted-request"
			}
			task.BillingOrderID = order.ID
			for _, value := range []any{project, task, order, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 900, ReservedMicrocredits: 100}} {
				if err := db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.dispatch != "" {
				attempt := &model.RouteAttempt{ID: newID(), TaskID: task.ID, RouteRun: 1, DispatchState: tc.dispatch, ProviderRequestID: "accepted-attempt", Status: "selected", AttemptNumber: 1}
				if err := db.Create(attempt).Error; err != nil {
					t.Fatal(err)
				}
			}
			claimed, err := s.repo.ClaimNextTask("worker", time.Minute)
			if err != nil || claimed == nil {
				t.Fatalf("claim = %v, %v", claimed, err)
			}
			probe := &ecommerceQueuedExecutionProbe{Service: s}
			s.taskRouteExecutor = &taskRouteExecutor{port: probe}
			_ = s.taskWorker().processClaimedTask(claimed, nil)
			stored, err := s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantError := tc.wantError
			if wantError == "" {
				wantError = "电商创作"
			}
			if probe.calls != tc.wantCalls || tc.wantCalls == 0 && !strings.Contains(stored.Error, wantError) {
				t.Fatalf("worker calls=%d error=%q", probe.calls, stored.Error)
			}
			bill, err := s.repo.BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantStatus := model.BillingStatusRefunded
			if tc.uncertain {
				wantStatus = model.BillingStatusUncertain
			}
			if bill.Status != wantStatus {
				t.Fatalf("billing = %s, want %s", bill.Status, wantStatus)
			}
		})
	}
}
