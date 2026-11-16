package handler

import (
	"context"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

type publicInspirationGalleryService interface {
	InspirationGalleryPrompts(context.Context, url.Values) (*service.InspirationGalleryPage, error)
	InspirationGalleryPrompt(context.Context, string) (*service.InspirationGalleryDetail, error)
	InspirationGalleryFacets(context.Context, url.Values) (*service.InspirationGalleryFacets, error)
}

// Online examples retain their upstream identity, independently from the reviewed library.
func RegisterInspirationGalleryRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerInspirationGalleryRoutes(r, svc)
}

func registerInspirationGalleryRoutes(r *gin.RouterGroup, svc publicInspirationGalleryService) {
	public := r.Group("/public/inspirations/zzai-gallery")
	public.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !enforceRateLimit(c, "inspiration-gallery:"+c.ClientIP(), 60, time.Minute) {
			c.Abort()
			return
		}
		c.Next()
	})
	public.GET("/prompts", func(c *gin.Context) {
		query, err := url.ParseQuery(c.Request.URL.RawQuery)
		if err != nil {
			failService(c, service.BadAuthRequest("画廊筛选参数无效"))
			return
		}
		result, err := svc.InspirationGalleryPrompts(c.Request.Context(), query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.GET("/prompts/:slug", func(c *gin.Context) {
		if c.Request.URL.RawQuery != "" {
			failService(c, service.BadAuthRequest("画廊详情不接受查询参数"))
			return
		}
		result, err := svc.InspirationGalleryPrompt(c.Request.Context(), c.Param("slug"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.GET("/facets", func(c *gin.Context) {
		query, err := url.ParseQuery(c.Request.URL.RawQuery)
		if err != nil {
			failService(c, service.BadAuthRequest("画廊筛选参数无效"))
			return
		}
		result, err := svc.InspirationGalleryFacets(c.Request.Context(), query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
