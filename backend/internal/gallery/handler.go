package gallery

import (
	"io"
	"net/http"
	"strconv"

	"infinite-canvas/backend/internal/model"

	"github.com/gin-gonic/gin"
)

type AuthProvider interface {
	CurrentUser(c *gin.Context) (*model.User, error)
	RequireAdmin(actor *model.User) error
	IsGalleryEnabled() bool
}

// RegisterRoutes 注册画廊相关的所有 API
func RegisterRoutes(r *gin.RouterGroup, svc *Service, auth AuthProvider) {
	galleryGroup := r.Group("/gallery")
	{
		galleryGroup.GET("/items", func(c *gin.Context) {
			if !auth.IsGalleryEnabled() {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "画廊功能暂未开放"})
				return
			}
			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "30"))
			mediaType := c.Query("media_type")
			model := c.Query("model")
			tag := c.Query("tag")
			keyword := c.Query("keyword")

			filter := QueryFilter{
				MediaType:  mediaType,
				Model:      model,
				Tag:        tag,
				Keyword:    keyword,
				OnlyActive: true,
				Page:       page,
				PageSize:   pageSize,
			}

			result, err := svc.ListPrompts(filter)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": result, "msg": "ok"})
		})

		galleryGroup.GET("/facets", func(c *gin.Context) {
			if !auth.IsGalleryEnabled() {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "画廊功能暂未开放"})
				return
			}
			facets, err := svc.GetFacets()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": facets, "msg": "ok"})
		})

		galleryGroup.GET("/items/:slug", func(c *gin.Context) {
			if !auth.IsGalleryEnabled() {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "画廊功能暂未开放"})
				return
			}
			slug := c.Param("slug")
			item, err := svc.GetPromptDetail(slug)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "条目不存在"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": item, "msg": "ok"})
		})

		galleryGroup.POST("/items/:id/copy", func(c *gin.Context) {
			id64, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			_ = svc.RecordCopy(uint(id64))
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": true, "msg": "ok"})
		})
	}

	// 管理端路由
	adminGroup := r.Group("/admin/gallery")
	{
		adminGroup.GET("/items", func(c *gin.Context) {
			user, err := auth.CurrentUser(c)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
				return
			}
			if err := auth.RequireAdmin(user); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
				return
			}

			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "30"))
			mediaType := c.Query("media_type")
			model := c.Query("model")
			tag := c.Query("tag")
			keyword := c.Query("keyword")

			filter := QueryFilter{
				MediaType:  mediaType,
				Model:      model,
				Tag:        tag,
				Keyword:    keyword,
				OnlyActive: false, // 管理员可查看全部
				Page:       page,
				PageSize:   pageSize,
			}

			result, err := svc.ListPrompts(filter)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": result, "msg": "ok"})
		})

		adminGroup.PUT("/items/:id", func(c *gin.Context) {
			user, err := auth.CurrentUser(c)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
				return
			}
			if err := auth.RequireAdmin(user); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
				return
			}
			id64, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var req UpdatePromptRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
				return
			}
			if err := svc.UpdatePromptByAdmin(user, uint(id64), req); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": true, "msg": "ok"})
		})

		adminGroup.PATCH("/items/:id/active", func(c *gin.Context) {
			user, err := auth.CurrentUser(c)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
				return
			}
			if err := auth.RequireAdmin(user); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
				return
			}
			id64, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var body struct {
				IsActive bool `json:"is_active"`
			}
			if err := c.ShouldBindJSON(&body); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
				return
			}
			if err := svc.SetActiveByAdmin(user, uint(id64), body.IsActive); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": true, "msg": "ok"})
		})

		adminGroup.DELETE("/items/:id", func(c *gin.Context) {
			user, err := auth.CurrentUser(c)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
				return
			}
			if err := auth.RequireAdmin(user); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
				return
			}
			id64, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := svc.DeleteByAdmin(user, uint(id64)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": true, "msg": "ok"})
		})

		adminGroup.POST("/import", func(c *gin.Context) {
			user, err := auth.CurrentUser(c)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
				return
			}
			if err := auth.RequireAdmin(user); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
				return
			}
			file, _, err := c.Request.FormFile("file")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "缺少上传文件: " + err.Error()})
				return
			}
			defer file.Close()
			bytes, err := io.ReadAll(file)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败: " + err.Error()})
				return
			}
			count, err := svc.ImportFromJSONData(bytes)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "解析或导入失败: " + err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"imported_count": count}, "msg": "ok"})
		})
	}
}
