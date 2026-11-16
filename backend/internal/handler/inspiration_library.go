package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

type publicInspirationLibraryService interface {
	InspirationLibraryPrompts(context.Context, url.Values) (*service.InspirationLibraryPage, error)
	InspirationLibraryPrompt(context.Context, string) (*service.InspirationLibraryDetail, error)
	InspirationLibraryFacets(context.Context, url.Values) (*service.InspirationLibraryFacets, error)
	ResolveInspirationLibrary(context.Context, service.InspirationLibraryResolve) (*service.InspirationLibraryResolved, error)
	InspirationLibraryMedia(context.Context, string, string, string, int64) (*service.InspirationLibraryMediaContent, error)
}

func RegisterInspirationLibraryRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerPublicInspirationLibraryRoutes(r, svc)
	admin := r.Group("/admin/inspirations/library")
	admin.Use(func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() })
	admin.GET("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		query, err := inspirationLibraryQuery(c, "status", "page", "limit")
		if err != nil {
			failService(c, err)
			return
		}
		page, limit := 1, 20
		if query.Get("page") != "" {
			page, err = strconv.Atoi(query.Get("page"))
		}
		if err == nil && query.Get("limit") != "" {
			limit, err = strconv.Atoi(query.Get("limit"))
		}
		if err != nil {
			failService(c, service.BadAuthRequest("分页参数无效"))
			return
		}
		result, err := svc.AdminInspirationLibrary(c.Request.Context(), actor, query.Get("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.GET("/:slug", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if _, err := inspirationLibraryQuery(c); err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminInspirationLibraryDetail(c.Request.Context(), actor, c.Param("slug"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.POST("/import", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		if _, err := inspirationLibraryQuery(c); err != nil {
			failService(c, err)
			return
		}
		var input service.InspirationLibraryImport
		if err := inspirationLibraryJSON(c, 2<<20, &input); err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ImportInspirationLibrary(c.Request.Context(), actor, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.POST("/:slug/review", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		if _, err := inspirationLibraryQuery(c); err != nil {
			failService(c, err)
			return
		}
		var input service.InspirationLibraryReview
		if err := inspirationLibraryJSON(c, 8<<10, &input); err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ReviewInspirationLibrary(c.Request.Context(), actor, c.Param("slug"), input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.GET("/:slug/media", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		kind, hash, revision, err := inspirationLibraryMediaQuery(c)
		if err != nil {
			failService(c, err)
			return
		}
		content, err := svc.AdminInspirationLibraryMedia(c.Request.Context(), actor, c.Param("slug"), kind, hash, revision)
		if err != nil {
			failService(c, err)
			return
		}
		serveInspirationLibraryMedia(c, content)
	})
}

func registerPublicInspirationLibraryRoutes(r *gin.RouterGroup, svc publicInspirationLibraryService) {
	public := r.Group("/public/inspirations/library")
	public.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !enforceRateLimit(c, "inspiration-library:"+c.ClientIP(), 60, time.Minute) {
			c.Abort()
			return
		}
		c.Next()
	})
	public.GET("/prompts", func(c *gin.Context) {
		query, err := url.ParseQuery(c.Request.URL.RawQuery)
		if err != nil {
			failService(c, service.BadAuthRequest("筛选参数无效"))
			return
		}
		result, err := svc.InspirationLibraryPrompts(c.Request.Context(), query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.GET("/prompts/:slug", func(c *gin.Context) {
		if _, err := inspirationLibraryQuery(c); err != nil {
			failService(c, err)
			return
		}
		result, err := svc.InspirationLibraryPrompt(c.Request.Context(), c.Param("slug"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.GET("/facets", func(c *gin.Context) {
		query, err := url.ParseQuery(c.Request.URL.RawQuery)
		if err != nil {
			failService(c, service.BadAuthRequest("筛选参数无效"))
			return
		}
		result, err := svc.InspirationLibraryFacets(c.Request.Context(), query)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.POST("/resolve", func(c *gin.Context) {
		if _, err := inspirationLibraryQuery(c); err != nil {
			failService(c, err)
			return
		}
		var input service.InspirationLibraryResolve
		if err := inspirationLibraryJSON(c, 32<<10, &input); err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ResolveInspirationLibrary(c.Request.Context(), input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	public.GET("/prompts/:slug/media", func(c *gin.Context) {
		kind, hash, revision, err := inspirationLibraryMediaQuery(c)
		if err != nil {
			failService(c, err)
			return
		}
		content, err := svc.InspirationLibraryMedia(c.Request.Context(), c.Param("slug"), kind, hash, revision)
		if err != nil {
			failService(c, err)
			return
		}
		serveInspirationLibraryMedia(c, content)
	})
}

func inspirationLibraryQuery(c *gin.Context, allowed ...string) (url.Values, error) {
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		return nil, service.BadAuthRequest("查询参数无效")
	}
	keys := map[string]bool{}
	for _, key := range allowed {
		keys[key] = true
	}
	for key, values := range query {
		if !keys[key] || len(values) != 1 {
			return nil, service.BadAuthRequest("查询含未知或重复参数")
		}
	}
	return query, nil
}

func inspirationLibraryMediaQuery(c *gin.Context) (string, string, int64, error) {
	query, err := inspirationLibraryQuery(c, "kind", "hash", "revision")
	if err != nil {
		return "", "", 0, err
	}
	revision, err := strconv.ParseInt(query.Get("revision"), 10, 64)
	if err != nil || revision < 1 || revision > 9007199254740991 {
		return "", "", 0, service.BadAuthRequest("媒体版本无效")
	}
	return query.Get("kind"), query.Get("hash"), revision, nil
}

func inspirationLibraryJSON(c *gin.Context, maximum int64, destination any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maximum)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return service.BadAuthRequest("JSON 缺失、超限或包含未知字段")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return service.BadAuthRequest("只接受一个 JSON 对象")
	}
	return nil
}

func serveInspirationLibraryMedia(c *gin.Context, content *service.InspirationLibraryMediaContent) {
	if content == nil {
		failService(c, service.NotFound("授权媒体不可用"))
		return
	}
	c.Header("Content-Type", content.MimeType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "no-store")
	http.ServeContent(c.Writer, c.Request, "", time.Time{}, bytes.NewReader(content.Data))
}
