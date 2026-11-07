package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterFeatureAvailabilityRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/public/welcome", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		setting, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"welcomeEnabled": setting.WelcomeEnabled})
	})

	r.GET("/features", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		// 公开：功能开关同时决定游客侧栏的菜单显隐，无敏感数据。
		// （/public/welcome 已经公开同一个配置，这里没有再拦的理由。）
		setting, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})

	r.GET("/admin/settings/features", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminFeatureAvailability(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})

	r.PATCH("/admin/settings/features", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.FeatureAvailabilityPatch
		decoder := json.NewDecoder(c.Request.Body)
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			failService(c, service.BadAuthRequest("功能开放配置只能包含一个 JSON 对象"))
			return
		}
		setting, err := svc.PatchFeatureAvailability(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})
}

// 功能守卫先校验登录态再判断开放状态，避免关闭功能时改变未登录请求的认证语义。
func RequireFeature(svc *service.Service, feature string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		if err := svc.RequireFeature(feature); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}
