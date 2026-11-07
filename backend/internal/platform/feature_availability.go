package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const featureAvailabilitySettingKey = "feature_availability"

const (
	FeatureShortDrama            = "shortDrama"
	FeatureTaskCenter            = "taskCenter"
	FeatureCredits               = "credits"
	FeatureCustomChannels        = "customChannels"
	FeatureFrontendModels        = "frontendModels"
	FeaturePluginCenter          = "pluginCenter"
	FeatureSystemPlugins         = "systemPluginsVisibleToUsers"
	FeatureInspirationSources    = "inspirationSourcesVisible"
	FeatureTimelineTranscription = "timelineTranscription"
	FeatureImageWorkbench        = "imageWorkbench"
	FeatureVideoWorkbench        = "videoWorkbench"
	FeatureEcommerce             = "ecommerce"
	FeatureEcommerceVideo        = "ecommerceVideo"
	FeatureSiteAssistant         = "siteAssistant"
	FeatureVideoRemake           = "videoRemake"
	FeatureGlobalAgent           = "globalAgent"
)

type FeatureAvailability struct {
	WelcomeEnabled               bool `json:"welcomeEnabled"`
	ShortDramaEnabled            bool `json:"shortDramaEnabled"`
	TaskCenterEnabled            bool `json:"taskCenterEnabled"`
	CreditsEnabled               bool `json:"creditsEnabled"`
	CustomChannelsEnabled        bool `json:"customChannelsEnabled"`
	FrontendModelsEnabled        bool `json:"frontendModelsEnabled"`
	PluginCenterEnabled          bool `json:"pluginCenterEnabled"`
	SystemPluginsVisibleToUsers  bool `json:"systemPluginsVisibleToUsers"`
	InspirationSourcesVisible    bool `json:"inspirationSourcesVisible"`
	TimelineTranscriptionEnabled bool `json:"timelineTranscriptionEnabled"`
	ImageWorkbenchEnabled        bool `json:"imageWorkbenchEnabled"`
	VideoWorkbenchEnabled        bool `json:"videoWorkbenchEnabled"`
	EcommerceEnabled             bool `json:"ecommerceEnabled"`
	EcommerceVideoEnabled        bool `json:"ecommerceVideoEnabled"`
	SiteAssistantEnabled         bool `json:"siteAssistantEnabled"`
	VideoRemakeEnabled           bool `json:"videoRemakeEnabled"`
	GlobalAgentEnabled           bool `json:"globalAgentEnabled"`
}

// FeatureAvailabilityPatch contains only the switches explicitly submitted by
// an administrator. Omitted switches retain their value at commit time.
type FeatureAvailabilityPatch map[string]bool

func (p *FeatureAvailabilityPatch) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return kernel.BadAuthRequest("功能开放配置必须是 JSON 对象")
	}
	patch := FeatureAvailabilityPatch{}
	for decoder.More() {
		field, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := field.(string)
		if !ok {
			return kernel.BadAuthRequest("功能开放配置字段无效")
		}
		if _, exists := patch[key]; exists {
			return kernel.BadAuthRequest("功能开放配置字段不能重复")
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		enabled, ok := token.(bool)
		if !ok {
			return kernel.BadAuthRequest("功能开放配置必须使用布尔值")
		}
		patch[key] = enabled
	}
	if _, err := decoder.Token(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return kernel.BadAuthRequest("功能开放配置只能包含一个 JSON 对象")
	}
	if _, err := patch.apply(FeatureAvailability{}); err != nil {
		return err
	}
	*p = patch
	return nil
}

func (p FeatureAvailabilityPatch) apply(value FeatureAvailability) (FeatureAvailability, error) {
	if len(p) == 0 {
		return value, kernel.BadAuthRequest("请至少提交一个功能开放配置")
	}
	for key, enabled := range p {
		var field *bool
		switch key {
		case "welcomeEnabled":
			field = &value.WelcomeEnabled
		case "shortDramaEnabled":
			field = &value.ShortDramaEnabled
		case "taskCenterEnabled":
			field = &value.TaskCenterEnabled
		case "creditsEnabled":
			field = &value.CreditsEnabled
		case "customChannelsEnabled":
			field = &value.CustomChannelsEnabled
		case "frontendModelsEnabled":
			field = &value.FrontendModelsEnabled
		case "pluginCenterEnabled":
			field = &value.PluginCenterEnabled
		case "systemPluginsVisibleToUsers":
			field = &value.SystemPluginsVisibleToUsers
		case "inspirationSourcesVisible":
			field = &value.InspirationSourcesVisible
		case "timelineTranscriptionEnabled":
			field = &value.TimelineTranscriptionEnabled
		case "imageWorkbenchEnabled":
			field = &value.ImageWorkbenchEnabled
		case "videoWorkbenchEnabled":
			field = &value.VideoWorkbenchEnabled
		case "ecommerceEnabled":
			field = &value.EcommerceEnabled
		case "ecommerceVideoEnabled":
			field = &value.EcommerceVideoEnabled
		case "siteAssistantEnabled":
			field = &value.SiteAssistantEnabled
		case "videoRemakeEnabled":
			field = &value.VideoRemakeEnabled
		case "globalAgentEnabled":
			field = &value.GlobalAgentEnabled
		default:
			return value, kernel.BadAuthRequest("未知功能开放配置字段")
		}
		*field = enabled
	}
	return value, nil
}

type PublicFeatureAvailability struct {
	FeatureAvailability
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
}

func DefaultFeatureAvailability() FeatureAvailability {
	// 缺少配置代表尚未由运维接管；前台模型需要明确配置后才开放。
	// 首页素材来源署名默认不展示，署名义务仍由灵感库条目的来源标识承担，需要时由管理员开启。
	return FeatureAvailability{
		WelcomeEnabled:               true,
		ShortDramaEnabled:            true,
		TaskCenterEnabled:            true,
		CreditsEnabled:               true,
		CustomChannelsEnabled:        true,
		FrontendModelsEnabled:        false,
		PluginCenterEnabled:          true,
		SystemPluginsVisibleToUsers:  true,
		InspirationSourcesVisible:    false,
		TimelineTranscriptionEnabled: true,
		ImageWorkbenchEnabled:        false,
		VideoWorkbenchEnabled:        false,
		EcommerceEnabled:             false,
		EcommerceVideoEnabled:        false,
		SiteAssistantEnabled:         false,
		VideoRemakeEnabled:           false,
		GlobalAgentEnabled:           false,
	}
}

func (s *Service) FeatureAvailability() (*PublicFeatureAvailability, error) {
	setting, value, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	return publicFeatureAvailability(setting, value), nil
}

func (s *Service) AdminFeatureAvailability(actor *model.User) (*PublicFeatureAvailability, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	return s.FeatureAvailability()
}

func (s *Service) UpdateFeatureAvailability(actor *model.User, value FeatureAvailability) (*PublicFeatureAvailability, error) {
	return s.mutateFeatureAvailability(actor, func(FeatureAvailability) (FeatureAvailability, error) {
		return value, nil
	})
}

func (s *Service) PatchFeatureAvailability(actor *model.User, patch FeatureAvailabilityPatch) (*PublicFeatureAvailability, error) {
	return s.mutateFeatureAvailability(actor, patch.apply)
}

func (s *Service) mutateFeatureAvailability(actor *model.User, apply func(FeatureAvailability) (FeatureAvailability, error)) (*PublicFeatureAvailability, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	defaults, err := json.Marshal(DefaultFeatureAvailability())
	if err != nil {
		return nil, err
	}
	var value FeatureAvailability
	setting, err := s.repo.MutateSystemSettingWithAudit(featureAvailabilitySettingKey, string(defaults), func(current *model.SystemSetting) (*model.AdminAuditEvent, error) {
		before, err := decodeFeatureAvailability(current.ValueJSON)
		if err != nil {
			return nil, err
		}
		value, err = apply(before)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		metadata, err := json.Marshal(map[string]any{"before": before, "after": value})
		if err != nil {
			return nil, err
		}
		current.ValueJSON, current.UpdatedBy = string(encoded), actor.ID
		return &model.AdminAuditEvent{
			ID: kernel.NewID(), ActorUserID: actor.ID, Action: "feature_availability.update",
			TargetType: "system_setting", TargetID: featureAvailabilitySettingKey,
			Summary: "更新功能开放配置", MetadataJSON: string(metadata), CreatedAt: time.Now(),
		}, nil
	})
	if err != nil {
		return nil, err
	}
	return publicFeatureAvailability(setting, value), nil
}

func (s *Service) FeatureEnabled(feature string) (bool, error) {
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return false, err
	}
	switch feature {
	case FeatureShortDrama:
		return value.ShortDramaEnabled, nil
	case FeatureTaskCenter:
		return value.TaskCenterEnabled, nil
	case FeatureCredits:
		return value.CreditsEnabled, nil
	case FeatureCustomChannels:
		return value.CustomChannelsEnabled, nil
	case FeatureFrontendModels:
		return value.FrontendModelsEnabled, nil
	case FeaturePluginCenter:
		return value.PluginCenterEnabled, nil
	case FeatureSystemPlugins:
		return value.SystemPluginsVisibleToUsers, nil
	case FeatureInspirationSources:
		return value.InspirationSourcesVisible, nil
	case FeatureTimelineTranscription:
		return value.TimelineTranscriptionEnabled, nil
	case FeatureImageWorkbench:
		return value.ImageWorkbenchEnabled, nil
	case FeatureVideoWorkbench:
		return value.VideoWorkbenchEnabled, nil
	case FeatureEcommerce:
		return value.EcommerceEnabled, nil
	case FeatureEcommerceVideo:
		return value.EcommerceVideoEnabled, nil
	case FeatureSiteAssistant:
		return value.SiteAssistantEnabled, nil
	case FeatureVideoRemake:
		return value.VideoRemakeEnabled, nil
	case FeatureGlobalAgent:
		return value.GlobalAgentEnabled, nil
	default:
		return false, errors.New("未知功能开放配置")
	}
}

func (s *Service) RequireFeature(feature string) error {
	enabled, err := s.FeatureEnabled(feature)
	if err != nil {
		return err
	}
	if enabled {
		return nil
	}
	switch feature {
	case FeatureShortDrama:
		return kernel.Forbidden("短剧创作暂未开放")
	case FeatureTaskCenter:
		return kernel.Forbidden("任务中心暂未开放")
	case FeatureCredits:
		return kernel.Forbidden("积分功能暂未开放")
	case FeatureCustomChannels:
		return kernel.Forbidden("自定义渠道暂未开放")
	case FeatureFrontendModels:
		return kernel.Forbidden("前台模型目录暂未开放")
	case FeaturePluginCenter:
		return kernel.Forbidden("插件中心暂未开放")
	case FeatureSystemPlugins:
		return kernel.Forbidden("系统插件暂未向普通用户展示")
	case FeatureInspirationSources:
		return kernel.Forbidden("素材来源说明暂未开放")
	case FeatureTimelineTranscription:
		return kernel.Forbidden("字幕转写暂未开放")
	case FeatureImageWorkbench:
		return kernel.Forbidden("生图暂未开放")
	case FeatureVideoWorkbench:
		return kernel.Forbidden("视频暂未开放")
	case FeatureEcommerce:
		return kernel.Forbidden("电商创作暂未开放")
	case FeatureEcommerceVideo:
		return kernel.Forbidden("电商视频暂未开放")
	case FeatureSiteAssistant:
		return kernel.Forbidden("站内助手暂未开放")
	case FeatureVideoRemake:
		return kernel.Forbidden("一键复刻暂未开放")
	case FeatureGlobalAgent:
		return kernel.Forbidden("全局 Agent 暂未开放")
	default:
		return kernel.Forbidden("该功能暂未开放")
	}
}

func (s *Service) readFeatureAvailability() (*model.SystemSetting, FeatureAvailability, error) {
	setting, err := s.repo.SystemSetting(featureAvailabilitySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, DefaultFeatureAvailability(), nil
	}
	if err != nil {
		return nil, FeatureAvailability{}, err
	}
	value, err := decodeFeatureAvailability(setting.ValueJSON)
	return setting, value, err
}

func decodeFeatureAvailability(raw string) (FeatureAvailability, error) {
	// 缺省字段沿用其当前默认值，已有配置不因增加新字段而被整体清空。
	value := DefaultFeatureAvailability()
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &value) != nil {
		return FeatureAvailability{}, errors.New("功能开放配置格式无效")
	}
	return value, nil
}

func publicFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	result := &PublicFeatureAvailability{FeatureAvailability: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

// PublicFeatureAvailability projects the persisted feature flags without
// exposing the platform service internals to compatibility callers.
func ProjectFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	return publicFeatureAvailability(setting, value)
}
