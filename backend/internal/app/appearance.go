package app

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const appearanceSettingKey = "appearance"

const (
	AppearanceAssetLogo        = "logo"
	AppearanceAssetDarkLogo    = "logo-dark"
	AppearanceAssetVideo       = "video"
	AppearanceAssetPoster      = "poster"
	AppearanceAssetUpdateImage = "update-image"
	AppearanceAssetUpdateVideo = "update-video"
)

const (
	appearanceSchemaVersion        = 11
	appearanceLogoMaxBytes   int64 = 5 << 20
	appearancePosterMaxBytes int64 = 10 << 20
	appearanceVideoMaxBytes  int64 = 256 << 20
)

// 登录弹窗左侧轮播。媒体不进固定枚举槽位，而是按「条目 ID + 类型」拼出来，
// 例如 carousel-8f3a1c-video：这样既不用给每个条目单独开一条下发路由，
// 又能直接复用现有的上传校验、Range 下发与 CDN 中转。
const (
	appearanceCarouselSlotPrefix = "carousel-"
	appearanceCarouselKindImage  = "image"
	appearanceCarouselKindVideo  = "video"
	appearanceCarouselMaxItems   = 8
)

// AppearanceCarouselItem 是登录弹窗轮播里的一条内容：一张图或一段视频，配标题与副标题。
// 图片条目只用 MediaResourceID；视频条目可以再配一张 PosterResourceID 作为首帧，
// 视频尚未起播（或用户偏好减少动效）时顶上。
type AppearanceCarouselItem struct {
	ID               string `json:"id"`
	Kind             string `json:"kind"`
	MediaResourceID  string `json:"mediaResourceId"`
	PosterResourceID string `json:"posterResourceId"`
	Title            string `json:"title"`
	Subtitle         string `json:"subtitle"`
}

// PublicAppearanceCarouselItem 是下发给匿名访客的形态：资源 ID 换成可直接播放的地址。
type PublicAppearanceCarouselItem struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	URL       string `json:"url"`
	PosterURL string `json:"posterUrl"`
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle"`
}

// parseAppearanceCarouselSlot 解开 carousel-<id>-<image|video|poster>。
// 条目 ID 由前端生成（crypto.randomUUID 截断），这里只要求非空、无连字符冲突。
func parseAppearanceCarouselSlot(slot string) (itemID string, kind string, ok bool) {
	if !strings.HasPrefix(slot, appearanceCarouselSlotPrefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(slot, appearanceCarouselSlotPrefix)
	for _, candidate := range []string{appearanceCarouselKindImage, appearanceCarouselKindVideo, "poster"} {
		suffix := "-" + candidate
		if strings.HasSuffix(rest, suffix) {
			id := strings.TrimSuffix(rest, suffix)
			if id == "" {
				return "", "", false
			}
			return id, candidate, true
		}
	}
	return "", "", false
}

func appearanceCarouselSlot(itemID string, kind string) string {
	return appearanceCarouselSlotPrefix + itemID + "-" + kind
}

const (
	defaultAppearanceBrandName = "Navo AI"
	defaultAppearanceBrandSlug = "open-ai-canvas"
	defaultAppearanceSkinID    = "classic"
	defaultAppearanceLogoURL   = "/logo.svg"
	// 登录页影片改用仓库内置素材（web/public/auth/），不再依赖外部 CDN：
	// 外链会随第三方失效，也会把首屏起播时间交给别人的服务器。
	defaultAppearanceVideoURL  = "/auth/login-hero.mp4"
	defaultAppearancePosterURL = "/auth/login-hero-poster.jpg"
	defaultAppearanceHeroTitle = "让一个故事，\n从文字走向银幕。"
	defaultRedeemPurchaseURL   = "" // 默认不配置购买链接，前端为空时不展示入口
)

type AppearanceSetting struct {
	Updates                   UpdateAnnouncement       `json:"updates"`
	Canvas                    CanvasAppearance         `json:"canvas"`
	SchemaVersion             int                      `json:"schemaVersion"`
	BrandName                 string                   `json:"brandName"`
	BrandSlug                 string                   `json:"brandSlug"`
	AuthHeroTitle             string                   `json:"authHeroTitle"`
	AuthHeroDescription       string                   `json:"authHeroDescription"`
	LogoResourceID            string                   `json:"logoResourceId"`
	DarkLogoResourceID        string                   `json:"darkLogoResourceId"`
	LogoFrameEnabled          bool                     `json:"logoFrameEnabled"`
	AuthVideoResourceID       string                   `json:"authVideoResourceId"`
	AuthVideoPosterResourceID string                   `json:"authVideoPosterResourceId"`
	AuthCarousel              []AppearanceCarouselItem `json:"authCarousel"`
	AuthVideoAutoplay         bool                     `json:"authVideoAutoplay"`
	SkinID                    string                   `json:"skinId"`
	SkinThemes                []AppearanceSkinTheme    `json:"skinThemes"`
	SEOTitle                  string                   `json:"seoTitle"`
	SEODescription            string                   `json:"seoDescription"`
	SEOKeywords               string                   `json:"seoKeywords"`
	FooterCopyright           string                   `json:"footerCopyright"`
	ICPFilingEnabled          bool                     `json:"icpFilingEnabled"`
	ICPFilingNumber           string                   `json:"icpFilingNumber"`
	RedeemPurchaseURL         string                   `json:"redeemPurchaseUrl"`
}

type PublicAppearanceSetting struct {
	Updates                   UpdateAnnouncement             `json:"updates"`
	Canvas                    CanvasAppearance               `json:"canvas"`
	SchemaVersion             int                            `json:"schemaVersion"`
	BrandName                 string                         `json:"brandName"`
	BrandSlug                 string                         `json:"brandSlug"`
	AuthHeroTitle             string                         `json:"authHeroTitle"`
	AuthHeroDescription       string                         `json:"authHeroDescription"`
	LogoURL                   string                         `json:"logoUrl"`
	DarkLogoURL               string                         `json:"darkLogoUrl"`
	LogoFrameEnabled          bool                           `json:"logoFrameEnabled"`
	AuthVideoURL              string                         `json:"authVideoUrl"`
	AuthVideoPosterURL        string                         `json:"authVideoPosterUrl"`
	AuthCarousel              []PublicAppearanceCarouselItem `json:"authCarousel"`
	AuthVideoAutoplay         bool                           `json:"authVideoAutoplay"`
	SkinID                    string                         `json:"skinId"`
	ActiveSkin                AppearanceSkinTheme            `json:"activeSkin"`
	SEOTitle                  string                         `json:"seoTitle"`
	SEODescription            string                         `json:"seoDescription"`
	SEOKeywords               string                         `json:"seoKeywords"`
	FooterCopyright           string                         `json:"footerCopyright"`
	ICPFilingEnabled          bool                           `json:"icpFilingEnabled"`
	ICPFilingNumber           string                         `json:"icpFilingNumber"`
	RedeemPurchaseURL         string                         `json:"redeemPurchaseUrl"`
	LogoConfigured            bool                           `json:"logoConfigured"`
	DarkLogoConfigured        bool                           `json:"darkLogoConfigured"`
	AuthVideoConfigured       bool                           `json:"authVideoConfigured"`
	AuthVideoPosterConfigured bool                           `json:"authVideoPosterConfigured"`
	Configured                bool                           `json:"configured"`
	Revision                  string                         `json:"revision"`
	UpdatedAt                 time.Time                      `json:"updatedAt,omitempty"`
}

type AdminAppearanceSetting struct {
	AppearanceSetting
	Public     PublicAppearanceSetting `json:"public"`
	Configured bool                    `json:"configured"`
	UpdatedBy  string                  `json:"updatedBy,omitempty"`
	CreatedAt  time.Time               `json:"createdAt,omitempty"`
	UpdatedAt  time.Time               `json:"updatedAt,omitempty"`
}

func defaultAppearanceSetting() AppearanceSetting {
	return AppearanceSetting{
		Updates:           UpdateAnnouncement{Releases: []UpdateRelease{}},
		Canvas:            defaultCanvasAppearance(),
		SchemaVersion:     appearanceSchemaVersion,
		BrandName:         defaultAppearanceBrandName,
		BrandSlug:         defaultAppearanceBrandSlug,
		AuthHeroTitle:     defaultAppearanceHeroTitle,
		AuthCarousel:      []AppearanceCarouselItem{},
		AuthVideoAutoplay: true,
		LogoFrameEnabled:  true,
		SkinID:            defaultAppearanceSkinID,
		SkinThemes:        defaultAppearanceSkinThemes(),
		RedeemPurchaseURL: defaultRedeemPurchaseURL,
	}
}

func AppearanceAssetMaxBytes(slot string) (int64, error) {
	slot = strings.TrimSpace(slot)
	if _, kind, ok := parseAppearanceCarouselSlot(slot); ok {
		if kind == appearanceCarouselKindVideo {
			return appearanceVideoMaxBytes, nil
		}
		return appearancePosterMaxBytes, nil
	}
	switch strings.TrimSpace(slot) {
	case AppearanceAssetLogo, AppearanceAssetDarkLogo:
		return appearanceLogoMaxBytes, nil
	case AppearanceAssetPoster, AppearanceAssetUpdateImage:
		return appearancePosterMaxBytes, nil
	case AppearanceAssetVideo, AppearanceAssetUpdateVideo:
		return appearanceVideoMaxBytes, nil
	default:
		return 0, BadAuthRequest("外观资源类型无效")
	}
}

func appearanceSlotIsVideo(slot string) bool {
	if _, kind, ok := parseAppearanceCarouselSlot(slot); ok {
		return kind == appearanceCarouselKindVideo
	}
	return slot == AppearanceAssetVideo || slot == AppearanceAssetUpdateVideo
}

func appearanceAssetSlots(value AppearanceSetting) []string {
	slots := []string{AppearanceAssetLogo, AppearanceAssetDarkLogo, AppearanceAssetVideo, AppearanceAssetPoster}
	for _, item := range value.AuthCarousel {
		if item.MediaResourceID != "" {
			slots = append(slots, appearanceCarouselSlot(item.ID, item.Kind))
		}
		if item.PosterResourceID != "" && item.Kind == appearanceCarouselKindVideo {
			slots = append(slots, appearanceCarouselSlot(item.ID, "poster"))
		}
	}
	return slots
}

func (s *Service) Appearance() (*PublicAppearanceSetting, error) {
	setting, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	value = s.resolveAvailableAppearanceAssets(value)
	return publicAppearanceSetting(setting, value), nil
}

func (s *Service) AdminAppearance(actor *model.User) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	value = s.resolveAvailableAppearanceAssets(value)
	result := &AdminAppearanceSetting{
		AppearanceSetting: value,
		Public:            *publicAppearanceSetting(setting, value),
		Configured:        setting != nil,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result, nil
}

func (s *Service) UpdateAppearance(actor *model.User, value AppearanceSetting) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	value.SchemaVersion = appearanceSchemaVersion
	value.Canvas.AvatarBundleResourceID = strings.TrimSpace(value.Canvas.AvatarBundleResourceID)
	canvas, canvasErr := normalizeCanvasAppearance(value.Canvas)
	if canvasErr != nil {
		return nil, canvasErr
	}
	value.Canvas = canvas
	updates, updatesErr := normalizeUpdateAnnouncement(value.Updates)
	if updatesErr != nil {
		return nil, updatesErr
	}
	value.Updates = updates
	value.BrandName = strings.TrimSpace(value.BrandName)
	value.BrandSlug = strings.ToLower(strings.TrimSpace(value.BrandSlug))
	value.AuthHeroTitle = normalizeAppearanceCopy(value.AuthHeroTitle)
	value.AuthHeroDescription = normalizeAppearanceCopy(value.AuthHeroDescription)
	value.LogoResourceID = strings.TrimSpace(value.LogoResourceID)
	value.DarkLogoResourceID = strings.TrimSpace(value.DarkLogoResourceID)
	value.AuthVideoResourceID = strings.TrimSpace(value.AuthVideoResourceID)
	value.AuthVideoPosterResourceID = strings.TrimSpace(value.AuthVideoPosterResourceID)
	carousel, carouselErr := normalizeAppearanceCarousel(value.AuthCarousel)
	if carouselErr != nil {
		return nil, carouselErr
	}
	value.AuthCarousel = carousel
	value.SkinID = strings.TrimSpace(value.SkinID)
	if len(value.SkinThemes) == 0 {
		value.SkinThemes = defaultAppearanceSkinThemes()
	}
	value.SkinThemes = normalizeAppearanceSkinThemes(value.SkinThemes)
	value.SEOTitle = normalizeAppearanceSingleLine(value.SEOTitle)
	value.SEODescription = normalizeAppearanceCopy(value.SEODescription)
	value.SEOKeywords = normalizeAppearanceSingleLine(value.SEOKeywords)
	value.FooterCopyright = normalizeAppearanceSingleLine(value.FooterCopyright)
	value.ICPFilingNumber = normalizeAppearanceSingleLine(value.ICPFilingNumber)
	value.RedeemPurchaseURL = strings.TrimSpace(value.RedeemPurchaseURL)
	if err := validateAppearanceSetting(value); err != nil {
		return nil, err
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	current, before, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	if value.Canvas.Live2DResourceID != "" {
		entry, err := s.validateLive2DResource(actor, value.Canvas.Live2DResourceID, before.Canvas.Live2DResourceID)
		if err != nil {
			return nil, err
		}
		value.Canvas.Live2DEntry = entry
	}
	if value.Canvas.AvatarBundleResourceID != "" {
		manifest, err := s.validateAgentAvatarBundleResource(actor, value.Canvas.AvatarBundleResourceID, before.Canvas.AvatarBundleResourceID)
		if err != nil {
			return nil, err
		}
		for _, clip := range value.Canvas.AvatarClipStates {
			if _, exists := manifest.Clips[clip]; !exists {
				return nil, BadAuthRequest("状态映射引用的动画不存在：" + clip)
			}
		}
	}
	if err := s.validateUpdateAnnouncementResources(actor, value.Updates, before.Updates); err != nil {
		return nil, err
	}
	for _, candidate := range []struct {
		slot       string
		resourceID string
		currentID  string
	}{
		{slot: AppearanceAssetLogo, resourceID: value.LogoResourceID, currentID: before.LogoResourceID},
		{slot: AppearanceAssetDarkLogo, resourceID: value.DarkLogoResourceID, currentID: before.DarkLogoResourceID},
		{slot: AppearanceAssetVideo, resourceID: value.AuthVideoResourceID, currentID: before.AuthVideoResourceID},
		{slot: AppearanceAssetPoster, resourceID: value.AuthVideoPosterResourceID, currentID: before.AuthVideoPosterResourceID},
	} {
		if err := s.validateAppearanceResource(actor, candidate.slot, candidate.resourceID, candidate.currentID); err != nil {
			return nil, err
		}
	}
	// 轮播条目数量可变，塞不进上面那个固定字面量，单独走一遍同样的校验。
	for _, item := range value.AuthCarousel {
		currentMedia, currentPoster := "", ""
		for _, existing := range before.AuthCarousel {
			if existing.ID == item.ID {
				currentMedia, currentPoster = existing.MediaResourceID, existing.PosterResourceID
			}
		}
		if err := s.validateAppearanceResource(actor, appearanceCarouselSlot(item.ID, item.Kind), item.MediaResourceID, currentMedia); err != nil {
			return nil, err
		}
		if item.Kind == appearanceCarouselKindVideo {
			if err := s.validateAppearanceResource(actor, appearanceCarouselSlot(item.ID, "poster"), item.PosterResourceID, currentPoster); err != nil {
				return nil, err
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "appearance.update", "system_setting", appearanceSettingKey, "更新外观配置", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return s.AdminAppearance(actor)
}

func (s *Service) ResetAppearance(actor *model.User) (*AdminAppearanceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	_, before, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteSystemSetting(appearanceSettingKey); err != nil {
		return nil, err
	}
	after := defaultAppearanceSetting()
	if err := s.appendAdminAudit(actor, "appearance.reset", "system_setting", appearanceSettingKey, "恢复 Navo AI 默认品牌标识", map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return s.AdminAppearance(actor)
}

func (s *Service) UploadAppearanceAsset(actor *model.User, slot string, header *multipart.FileHeader) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	mimeType, err := validateAppearanceUpload(slot, header)
	if err != nil {
		return nil, err
	}
	// UploadResource otherwise trusts a non-empty declared MIME. Replace it with
	// the sniffed value so the persisted resource contract matches the bytes.
	header.Header.Set("Content-Type", mimeType)
	kind := "image"
	if appearanceSlotIsVideo(slot) {
		kind = "video"
	}
	var resource *model.Resource
	// Logos are tiny, installation-owned assets. Keep them in the server's
	// persistent resource directory so their availability and cost do not
	// depend on the administrator's currently selected object storage.
	if slot == AppearanceAssetLogo || slot == AppearanceAssetDarkLogo {
		resource, err = s.uploadLocalResource(actor.ID, header, kind, 0, 0, 0)
	} else {
		resource, err = s.UploadResource(actor.ID, header, kind, 0, 0, 0)
	}
	if err != nil {
		return nil, err
	}
	resource.PublicURL = ""
	return resource, nil
}

func (s *Service) OpenAppearanceAsset(slot string, rangeHeader string) (*ResourceStream, error) {
	_, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	resourceID := appearanceResourceID(value, slot)
	if resourceID == "" {
		return nil, NotFound("未配置该外观资源")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("外观资源不存在")
		}
		return nil, err
	}
	if err := validateAppearanceResourceType(slot, resource); err != nil {
		return nil, err
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) PrepareAppearanceAssetDelivery(slot string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	_, value, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	resourceID := appearanceResourceID(value, slot)
	if resourceID == "" {
		return nil, NotFound("未配置该外观资源")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("外观资源不存在")
		}
		return nil, err
	}
	if err := validateAppearanceResourceType(slot, resource); err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

func (s *Service) appearanceResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := make(map[string][]AdminResourceReferenceView)
	_, value, err := s.readAppearance()
	if err != nil {
		// Invalid appearance JSON must fail closed for deletion. The caller turns
		// this sentinel into a visible blocked reference instead of deleting files.
		for _, resourceID := range resourceIDs {
			result[resourceID] = []AdminResourceReferenceView{{Kind: "外观", ID: appearanceSettingKey, Title: "外观配置无法读取"}}
		}
		return result
	}
	candidates := []struct {
		resourceID string
		title      string
	}{
		{resourceID: value.LogoResourceID, title: "浅色模式品牌 Logo"},
		{resourceID: value.DarkLogoResourceID, title: "深色模式品牌 Logo"},
		{resourceID: value.AuthVideoResourceID, title: "登录页品牌视频"},
		{resourceID: value.AuthVideoPosterResourceID, title: "登录页视频封面"},
		{resourceID: value.Canvas.Live2DResourceID, title: "画布 Agent Live2D 形象"},
		{resourceID: value.Canvas.AvatarBundleResourceID, title: "画布 Agent 动画包"},
	}
	for _, release := range value.Updates.Releases {
		for _, block := range release.Blocks {
			if block.ResourceID != "" {
				candidates = append(candidates, struct {
					resourceID string
					title      string
				}{block.ResourceID, "更新公告 " + release.Version})
			}
		}
	}
	for index, item := range value.AuthCarousel {
		if item.MediaResourceID != "" {
			candidates = append(candidates, struct {
				resourceID string
				title      string
			}{item.MediaResourceID, fmt.Sprintf("登录轮播第 %d 项", index+1)})
		}
		if item.PosterResourceID != "" {
			candidates = append(candidates, struct {
				resourceID string
				title      string
			}{item.PosterResourceID, fmt.Sprintf("登录轮播第 %d 项封面", index+1)})
		}
	}
	wanted := make(map[string]struct{}, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		wanted[resourceID] = struct{}{}
	}
	for _, candidate := range candidates {
		if candidate.resourceID == "" {
			continue
		}
		if _, exists := wanted[candidate.resourceID]; exists {
			result[candidate.resourceID] = appendUniqueAdminResourceReference(result[candidate.resourceID], AdminResourceReferenceView{Kind: "外观", ID: appearanceSettingKey, Title: candidate.title})
		}
	}
	return result
}

func (s *Service) readAppearance() (*model.SystemSetting, AppearanceSetting, error) {
	setting, err := s.repo.SystemSetting(appearanceSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultAppearanceSetting(), nil
	}
	if err != nil {
		return nil, AppearanceSetting{}, err
	}
	value := defaultAppearanceSetting()
	// Decode stored themes without reusing built-in slice entries: omitted
	// fields must be migrated according to each stored theme's identity.
	value.SkinThemes = nil
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, AppearanceSetting{}, errors.New("外观配置格式无效")
	}
	value.SchemaVersion = appearanceSchemaVersion
	value.BrandName = strings.TrimSpace(value.BrandName)
	if value.BrandName == "" {
		value.BrandName = defaultAppearanceBrandName
	}
	value.BrandSlug = strings.ToLower(strings.TrimSpace(value.BrandSlug))
	if value.BrandSlug == "" {
		value.BrandSlug = defaultAppearanceBrandSlug
	}
	value.AuthHeroTitle = normalizeAppearanceCopy(value.AuthHeroTitle)
	if value.AuthHeroTitle == "" {
		value.AuthHeroTitle = defaultAppearanceHeroTitle
	}
	value.AuthHeroDescription = normalizeAppearanceCopy(value.AuthHeroDescription)
	if carousel, carouselErr := normalizeAppearanceCarousel(value.AuthCarousel); carouselErr == nil {
		value.AuthCarousel = carousel
	} else {
		// 存量配置里出现非法条目时整段丢弃，不让一条坏数据把登录弹窗打空。
		// 用空切片而不是 nil：nil 序列化成 null，前端拿到 null 直接 .map 就崩，
		// 整页退化成「无法读取外观配置」。
		value.AuthCarousel = []AppearanceCarouselItem{}
	}
	// 存量 JSON 里可能写着 "releases":null，解码后是 nil slice，同样会下发成 null。
	if value.Updates.Releases == nil {
		value.Updates.Releases = []UpdateRelease{}
	}
	value.SkinID = strings.TrimSpace(value.SkinID)
	if value.SkinID == "" {
		value.SkinID = defaultAppearanceSkinID
	}
	if len(value.SkinThemes) == 0 {
		value.SkinThemes = defaultAppearanceSkinThemes()
	}
	value.SkinThemes = normalizeAppearanceSkinThemes(value.SkinThemes)
	value.SEOTitle = normalizeAppearanceSingleLine(value.SEOTitle)
	value.SEODescription = normalizeAppearanceCopy(value.SEODescription)
	value.SEOKeywords = normalizeAppearanceSingleLine(value.SEOKeywords)
	value.FooterCopyright = normalizeAppearanceSingleLine(value.FooterCopyright)
	value.ICPFilingNumber = normalizeAppearanceSingleLine(value.ICPFilingNumber)
	value.RedeemPurchaseURL = strings.TrimSpace(value.RedeemPurchaseURL)
	return setting, value, nil
}

// resolveAvailableAppearanceAssets prevents stale resource references from
// being advertised to anonymous clients or echoed back into the admin editor.
// Remote objects are not probed on every appearance request; the frontend has
// its own load-error fallback for objects that disappear outside the system.
func (s *Service) resolveAvailableAppearanceAssets(value AppearanceSetting) AppearanceSetting {
	for _, slot := range appearanceAssetSlots(value) {
		resourceID := appearanceResourceID(value, slot)
		if resourceID == "" || s.appearanceAssetAvailable(slot, resourceID) {
			continue
		}
		itemID, kind, carousel := parseAppearanceCarouselSlot(slot)
		switch {
		case carousel:
			// 轮播里失效的那一条只清掉自己的资源引用，其余条目照常下发。
			for index := range value.AuthCarousel {
				if value.AuthCarousel[index].ID != itemID {
					continue
				}
				if kind == "poster" {
					value.AuthCarousel[index].PosterResourceID = ""
				} else {
					value.AuthCarousel[index].MediaResourceID = ""
				}
			}
		case slot == AppearanceAssetLogo:
			value.LogoResourceID = ""
		case slot == AppearanceAssetDarkLogo:
			value.DarkLogoResourceID = ""
		case slot == AppearanceAssetVideo:
			value.AuthVideoResourceID = ""
		case slot == AppearanceAssetPoster:
			value.AuthVideoPosterResourceID = ""
		}
	}
	if value.Canvas.AvatarBundleResourceID != "" && !s.agentAvatarBundleAvailable(value.Canvas.AvatarBundleResourceID) {
		value.Canvas.AvatarBundleResourceID = ""
	}
	return value
}

func (s *Service) appearanceAssetAvailable(slot string, resourceID string) bool {
	resource, err := s.repo.Resource(resourceID)
	if err != nil || validateAppearanceResourceType(slot, resource) != nil {
		return false
	}
	if resource.Provider != "local" {
		return true
	}
	info, err := os.Stat(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	return err == nil && !info.IsDir()
}

// normalizeAppearanceCarousel 收口登录轮播条目：类型白名单、文案长度、ID 唯一。
// 还没上传媒体的条目留在配置里（管理员可能先写标题再补素材），下发给访客时再按空地址过滤。
func normalizeAppearanceCarousel(items []AppearanceCarouselItem) ([]AppearanceCarouselItem, error) {
	if len(items) == 0 {
		// 空轮播一律用空切片（不是 nil）：nil 序列化成 null，落库与下发都会让前端 .map 崩。
		return []AppearanceCarouselItem{}, nil
	}
	if len(items) > appearanceCarouselMaxItems {
		return nil, BadAuthRequest(fmt.Sprintf("登录轮播最多 %d 条", appearanceCarouselMaxItems))
	}
	result := make([]AppearanceCarouselItem, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		if item.ID == "" {
			item.ID = fmt.Sprintf("item-%d", index+1)
		}
		if _, exists := seen[item.ID]; exists {
			item.ID = fmt.Sprintf("%s-%d", item.ID, index+1)
		}
		seen[item.ID] = struct{}{}
		item.Kind = strings.ToLower(strings.TrimSpace(item.Kind))
		if item.Kind == "" {
			item.Kind = appearanceCarouselKindImage
		}
		if item.Kind != appearanceCarouselKindImage && item.Kind != appearanceCarouselKindVideo {
			return nil, BadAuthRequest("登录轮播条目类型只能是图片或视频")
		}
		item.MediaResourceID = strings.TrimSpace(item.MediaResourceID)
		item.PosterResourceID = strings.TrimSpace(item.PosterResourceID)
		if item.Kind != appearanceCarouselKindVideo {
			// 图片条目没有首帧概念，残留的封面引用一并清掉，免得下发出用不上的地址。
			item.PosterResourceID = ""
		}
		item.Title = normalizeAppearanceSingleLine(item.Title)
		item.Subtitle = normalizeAppearanceSingleLine(item.Subtitle)
		if utf8.RuneCountInString(item.Title) > 40 {
			return nil, BadAuthRequest(fmt.Sprintf("登录轮播第 %d 条标题不能超过 40 个字符", index+1))
		}
		if utf8.RuneCountInString(item.Subtitle) > 60 {
			return nil, BadAuthRequest(fmt.Sprintf("登录轮播第 %d 条副标题不能超过 60 个字符", index+1))
		}
		result = append(result, item)
	}
	return result, nil
}

func validateAppearanceSetting(value AppearanceSetting) error {
	if value.BrandName == "" || utf8.RuneCountInString(value.BrandName) > 40 {
		return BadAuthRequest("品牌名称必须为 1 到 40 个字符")
	}
	for _, char := range value.BrandName {
		if unicode.IsControl(char) {
			return BadAuthRequest("品牌名称不能包含控制字符")
		}
	}
	if !validAppearanceBrandSlug(value.BrandSlug) {
		return BadAuthRequest("英文品牌标识须为 1 到 48 位小写字母、数字或连字符，且不能以连字符开头或结尾")
	}
	if err := validateAppearanceCopy(value.AuthHeroTitle, "登录页主标题", 80, true); err != nil {
		return err
	}
	if err := validateAppearanceCopy(value.AuthHeroDescription, "登录页说明文案", 160, false); err != nil {
		return err
	}
	if err := validateAppearanceSkinThemes(value.SkinThemes, value.SkinID); err != nil {
		return err
	}
	for _, field := range []struct {
		value string
		label string
		max   int
	}{
		{value.SEOTitle, "SEO 标题", 70},
		{value.SEODescription, "SEO 描述", 200},
		{value.SEOKeywords, "SEO 关键词", 300},
		{value.FooterCopyright, "版权信息", 160},
		{value.ICPFilingNumber, "备案号", 64},
	} {
		if err := validateAppearanceCopy(field.value, field.label, field.max, false); err != nil {
			return err
		}
	}
	if value.ICPFilingEnabled && value.ICPFilingNumber == "" {
		return BadAuthRequest("显示备案号前请先填写备案号")
	}
	if value.RedeemPurchaseURL != "" {
		parsed, err := url.Parse(value.RedeemPurchaseURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return BadAuthRequest("兑换码购买链接必须是有效的 HTTPS 地址")
		}
	}
	if len(value.Canvas.AvatarBundleResourceID) > 80 {
		return BadAuthRequest("Agent 动画包资源 ID 无效")
	}
	for _, resourceID := range []string{value.LogoResourceID, value.DarkLogoResourceID, value.AuthVideoResourceID, value.AuthVideoPosterResourceID} {
		if len(resourceID) > 80 {
			return BadAuthRequest("外观资源 ID 无效")
		}
	}
	return nil
}

func normalizeAppearanceCopy(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n"))
}

func normalizeAppearanceSingleLine(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", " "), "\r", " "))
}

func validAppearanceBrandSlug(value string) bool {
	if len(value) == 0 || len(value) > 48 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

func validateAppearanceCopy(value string, label string, maxRunes int, required bool) error {
	if required && value == "" {
		return BadAuthRequest(label + "不能为空")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s不能超过 %d 个字符", label, maxRunes))
	}
	for _, char := range value {
		if unicode.IsControl(char) && char != '\n' {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

func (s *Service) validateAppearanceResource(actor *model.User, slot string, resourceID string, currentID string) error {
	if resourceID == "" {
		return nil
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		return BadAuthRequest("选择的外观资源不存在")
	}
	if resourceID != currentID && resource.UserID != actor.ID {
		return Forbidden("只能使用当前管理员上传的外观资源")
	}
	return validateAppearanceResourceType(slot, resource)
}

func validateAppearanceResourceType(slot string, resource *model.Resource) error {
	if resource == nil || resource.Status != model.ResourceStatusReady {
		return BadAuthRequest("外观资源尚未上传完成")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(resource.MimeType, ";")[0]))
	allowed := appearanceAllowedMIMETypes(slot)
	if _, exists := allowed[mimeType]; !exists {
		return BadAuthRequest("外观资源文件类型不受支持")
	}
	if appearanceSlotIsVideo(slot) && resource.Kind != "video" {
		return BadAuthRequest("该外观资源必须是视频")
	}
	if !appearanceSlotIsVideo(slot) && resource.Kind != "image" {
		return BadAuthRequest("Logo 和视频封面必须是图片资源")
	}
	return nil
}

func validateAppearanceUpload(slot string, header *multipart.FileHeader) (string, error) {
	maxBytes, err := AppearanceAssetMaxBytes(slot)
	if err != nil {
		return "", err
	}
	if header == nil || header.Size <= 0 || header.Size > maxBytes {
		return "", BadAuthRequest(fmt.Sprintf("%s大小必须在 %dMB 以内", appearanceAssetLabel(slot), maxBytes>>20))
	}
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]byte, 512)
	read, readErr := file.Read(buffer)
	if readErr != nil && read == 0 {
		return "", BadAuthRequest("外观资源内容无法读取")
	}
	mimeType := detectAppearanceMIME(slot, buffer[:read], header.Size)
	if _, exists := appearanceAllowedMIMETypes(slot)[mimeType]; !exists {
		return "", BadAuthRequest(appearanceAssetLabel(slot) + "文件类型不受支持")
	}
	return mimeType, nil
}

func detectAppearanceMIME(slot string, data []byte, fileSize int64) string {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if !appearanceSlotIsVideo(slot) || mimeType == "video/mp4" || len(data) < 12 {
		return mimeType
	}
	// Go's generic sniffer only recognises a subset of MP4 compatible brands.
	// Accept a structurally valid ISO Base Media File Format `ftyp` first box,
	// which covers common `isom`, `iso2`, `avc1`, `M4V ` and similar MP4 files.
	boxSize := int64(binary.BigEndian.Uint32(data[:4]))
	if string(data[4:8]) == "ftyp" && boxSize >= 12 && boxSize%4 == 0 && boxSize <= fileSize {
		return "video/mp4"
	}
	return mimeType
}

func appearanceAllowedMIMETypes(slot string) map[string]struct{} {
	if appearanceSlotIsVideo(slot) {
		return map[string]struct{}{"video/mp4": {}, "video/webm": {}}
	}
	return map[string]struct{}{"image/png": {}, "image/jpeg": {}, "image/webp": {}}
}

func appearanceAssetLabel(slot string) string {
	if _, kind, ok := parseAppearanceCarouselSlot(slot); ok {
		switch kind {
		case appearanceCarouselKindVideo:
			return "登录轮播视频"
		case "poster":
			return "登录轮播视频封面"
		default:
			return "登录轮播图片"
		}
	}
	switch slot {
	case AppearanceAssetLogo:
		return "浅色模式品牌 Logo"
	case AppearanceAssetDarkLogo:
		return "深色模式品牌 Logo"
	case AppearanceAssetPoster:
		return "视频封面"
	case AppearanceAssetVideo:
		return "品牌视频"
	case AppearanceAssetUpdateImage:
		return "公告图片"
	case AppearanceAssetUpdateVideo:
		return "公告视频"
	default:
		return "外观资源"
	}
}

func appearanceResourceID(value AppearanceSetting, slot string) string {
	if itemID, kind, ok := parseAppearanceCarouselSlot(slot); ok {
		for _, item := range value.AuthCarousel {
			if item.ID != itemID {
				continue
			}
			if kind == "poster" {
				return item.PosterResourceID
			}
			return item.MediaResourceID
		}
		return ""
	}
	switch slot {
	case AppearanceAssetLogo:
		return value.LogoResourceID
	case AppearanceAssetDarkLogo:
		return value.DarkLogoResourceID
	case AppearanceAssetVideo:
		return value.AuthVideoResourceID
	case AppearanceAssetPoster:
		return value.AuthVideoPosterResourceID
	default:
		return ""
	}
}

// publicAppearanceCarousel 把资源 ID 换成可直接播放的地址；还没上传媒体的条目直接跳过，
// 于是「配了一半」的条目不会在访客那里占一格空白。
func publicAppearanceCarousel(items []AppearanceCarouselItem, revision string) []PublicAppearanceCarouselItem {
	if len(items) == 0 {
		// 用空切片而不是 nil：nil 会被序列化成 null，前端 carousel.map 立刻崩溃。
		return []PublicAppearanceCarouselItem{}
	}
	result := make([]PublicAppearanceCarouselItem, 0, len(items))
	for _, item := range items {
		if item.MediaResourceID == "" {
			continue
		}
		kind := appearanceCarouselKindImage
		if item.Kind == appearanceCarouselKindVideo {
			kind = appearanceCarouselKindVideo
		}
		entry := PublicAppearanceCarouselItem{
			ID:       item.ID,
			Kind:     kind,
			URL:      appearanceAssetURL(appearanceCarouselSlot(item.ID, kind), revision),
			Title:    item.Title,
			Subtitle: item.Subtitle,
		}
		if kind == appearanceCarouselKindVideo && item.PosterResourceID != "" {
			entry.PosterURL = appearanceAssetURL(appearanceCarouselSlot(item.ID, "poster"), revision)
		}
		result = append(result, entry)
	}
	if len(result) == 0 {
		return []PublicAppearanceCarouselItem{}
	}
	return result
}

func publicAppearanceSetting(setting *model.SystemSetting, value AppearanceSetting) *PublicAppearanceSetting {
	revision := "builtin"
	if setting != nil {
		revision = strconv.FormatInt(setting.UpdatedAt.UTC().UnixNano(), 36)
	}
	result := &PublicAppearanceSetting{
		Updates:             publicUpdateAnnouncement(value.Updates, revision),
		Canvas:              value.Canvas,
		SchemaVersion:       appearanceSchemaVersion,
		BrandName:           value.BrandName,
		BrandSlug:           value.BrandSlug,
		AuthHeroTitle:       value.AuthHeroTitle,
		AuthHeroDescription: value.AuthHeroDescription,
		LogoURL:             defaultAppearanceLogoURL,
		DarkLogoURL:         defaultAppearanceLogoURL,
		LogoFrameEnabled:    value.LogoFrameEnabled,
		AuthVideoURL:        defaultAppearanceVideoURL,
		AuthVideoPosterURL:  defaultAppearancePosterURL,
		AuthVideoAutoplay:   value.AuthVideoAutoplay,
		SkinID:              value.SkinID,
		ActiveSkin:          activeAppearanceSkin(value.SkinThemes, value.SkinID),
		SEOTitle:            effectiveAppearanceSEOTitle(value),
		SEODescription:      effectiveAppearanceSEODescription(value),
		SEOKeywords:         value.SEOKeywords,
		FooterCopyright:     effectiveAppearanceCopyright(value),
		ICPFilingEnabled:    value.ICPFilingEnabled && value.ICPFilingNumber != "",
		ICPFilingNumber:     value.ICPFilingNumber,
		RedeemPurchaseURL:   safeAppearancePurchaseURL(value.RedeemPurchaseURL),
		Configured:          setting != nil,
		Revision:            revision,
	}
	if setting != nil {
		result.UpdatedAt = setting.UpdatedAt
	}
	result.AuthCarousel = publicAppearanceCarousel(value.AuthCarousel, revision)
	if value.LogoResourceID != "" || value.DarkLogoResourceID != "" {
		result.LogoConfigured = true
		if value.LogoResourceID != "" {
			result.LogoURL = appearanceAssetURL(AppearanceAssetLogo, revision)
		} else {
			result.LogoURL = appearanceAssetURL(AppearanceAssetDarkLogo, revision)
		}
		if value.DarkLogoResourceID != "" {
			result.DarkLogoConfigured = true
			result.DarkLogoURL = appearanceAssetURL(AppearanceAssetDarkLogo, revision)
		} else {
			result.DarkLogoURL = result.LogoURL
		}
		if value.LogoResourceID == "" {
			result.LogoURL = result.DarkLogoURL
		}
	}
	if value.AuthVideoResourceID != "" {
		result.AuthVideoConfigured = true
		result.AuthVideoURL = appearanceAssetURL(AppearanceAssetVideo, revision)
		if value.AuthVideoPosterResourceID == "" {
			// A custom video must not briefly reveal the built-in poster while its
			// first frame loads. An optional custom poster may be configured below.
			result.AuthVideoPosterURL = ""
		}
	}
	if value.AuthVideoPosterResourceID != "" {
		result.AuthVideoPosterConfigured = true
		result.AuthVideoPosterURL = appearanceAssetURL(AppearanceAssetPoster, revision)
	}
	return result
}

func safeAppearancePurchaseURL(value string) string {
	candidate := strings.TrimSpace(value)
	if candidate == "" {
		return ""
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	return parsed.String()
}

func effectiveAppearanceSEOTitle(value AppearanceSetting) string {
	if value.SEOTitle != "" {
		return value.SEOTitle
	}
	return value.BrandName
}

func effectiveAppearanceSEODescription(value AppearanceSetting) string {
	if value.SEODescription != "" {
		return value.SEODescription
	}
	return value.BrandName + "，面向 AI 影视与短剧创作的工作台。"
}

func effectiveAppearanceCopyright(value AppearanceSetting) string {
	if value.FooterCopyright != "" {
		return value.FooterCopyright
	}
	return fmt.Sprintf("© %d %s. All rights reserved.", time.Now().Year(), value.BrandName)
}

func (s *Service) appearanceBrandName() string {
	brandName, _ := s.appearanceIdentity()
	return brandName
}

func (s *Service) appearanceIdentity() (string, string) {
	_, value, err := s.readAppearance()
	if err != nil || strings.TrimSpace(value.BrandName) == "" {
		return defaultAppearanceBrandName, defaultAppearanceBrandSlug
	}
	return value.BrandName, value.BrandSlug
}

func appearanceAssetURL(slot string, revision string) string {
	return "/api/public/appearance/assets/" + url.PathEscape(slot) + "?v=" + url.QueryEscape(revision)
}
