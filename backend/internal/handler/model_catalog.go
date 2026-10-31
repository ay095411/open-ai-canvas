package handler

import (
	"errors"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterModelCatalogRoutes 注册统一模型目录路由
func RegisterModelCatalogRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/model-catalog/quote", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelModelQuoteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型报价请求格式错误"))
			return
		}
		quote, err := svc.QuoteChannelModel(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"quote": quote})
	})
	r.GET("/model-catalog", func(c *gin.Context) {
		// 创作首页对游客开放目录：登录用户按其分组过滤，游客按默认分组的可见性与价格展示。
		// 目录仍只包含系统渠道的公开读模型；任务创建、报价与渠道中转各自另有登录与分组校验。
		user, err := currentUser(c, svc)
		if err != nil {
			catalog, guestErr := svc.ModelCatalogForGuest(nil)
			if guestErr != nil {
				failService(c, guestErr)
				return
			}
			ok(c, catalog)
			return
		}
		catalog, err := svc.ModelCatalogForUser(user, nil)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, catalog)
	})

	r.POST("/model-catalog/available", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型能力请求格式错误"))
			return
		}
		catalog, err := svc.ModelCatalogForUser(user, &intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, catalog)
	})

}
