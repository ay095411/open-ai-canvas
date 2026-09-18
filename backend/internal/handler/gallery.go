package handler

import (
	"infinite-canvas/backend/internal/gallery"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type galleryAuthAdapter struct {
	svc *service.Service
}

func (a *galleryAuthAdapter) CurrentUser(c *gin.Context) (*model.User, error) {
	return currentUser(c, a.svc)
}

func (a *galleryAuthAdapter) RequireAdmin(actor *model.User) error {
	return a.svc.RequireAdmin(actor)
}

func (a *galleryAuthAdapter) IsGalleryEnabled() bool {
	enabled, err := a.svc.FeatureEnabled(service.FeatureGallery)
	if err != nil {
		return false
	}
	return enabled
}

func RegisterGalleryRoutes(api *gin.RouterGroup, svc *service.Service) {
	if svc == nil || svc.Gallery() == nil {
		return
	}
	adapter := &galleryAuthAdapter{svc: svc}
	gallery.RegisterRoutes(api, svc.Gallery(), adapter)
}
