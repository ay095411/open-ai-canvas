package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"yingce/backend/internal/inspirations"
	"yingce/backend/internal/model"
)

// OpenRoot prevents object-key traversal and symlink escape from the local resource root.
// Publication binds the review to the real bytes, rather than a mutable resource URL.
func (s *Service) readInspirationLibraryMedia(ctx context.Context, reference, kind string) (*inspirations.LibraryMediaContent, error) {
	if !strings.HasPrefix(reference, "resource:") || (kind != "image" && kind != "video") {
		return nil, BadAuthRequest("媒体必须是本站图片或视频资源")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resource, err := s.repo.WithContext(ctx).Resource(strings.TrimPrefix(reference, "resource:"))
	if err != nil {
		return nil, NotFound("本站媒体资源不存在")
	}
	if resource.Status != model.ResourceStatusReady || resource.Provider != "local" || resource.Kind != kind {
		return nil, BadAuthRequest("授权目录只支持已就绪的本地图片或视频")
	}
	limit := int64(32 << 20)
	if kind == "video" {
		limit = 128 << 20
	}
	if resource.Size < 0 || resource.Size > limit || resource.ObjectKey == "" || filepath.IsAbs(resource.ObjectKey) {
		return nil, BadAuthRequest("媒体对象大小或路径无效")
	}
	root, err := os.OpenRoot(filepath.Join(s.dataDir, "resources"))
	if err != nil {
		return nil, NotFound("本站媒体文件不可用")
	}
	defer root.Close()
	file, err := root.Open(filepath.FromSlash(resource.ObjectKey))
	if err != nil {
		return nil, NotFound("本站媒体文件不可用")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return nil, BadAuthRequest("媒体必须是限制大小以内的普通文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, BadAuthRequest("媒体文件超过大小限制")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	declared, _, err := mime.ParseMediaType(resource.MimeType)
	actual := http.DetectContentType(data)
	if err != nil || declared != actual || (kind == "image" && declared != "image/png" && declared != "image/jpeg" && declared != "image/gif" && declared != "image/webp") || (kind == "video" && declared != "video/mp4" && declared != "video/webm") {
		return nil, BadAuthRequest("媒体实际内容与安全 MIME 不匹配；不支持 SVG 或未知格式")
	}
	hash := sha256.Sum256(data)
	return &inspirations.LibraryMediaContent{Data: data, MimeType: actual, Hash: hex.EncodeToString(hash[:])}, nil
}
