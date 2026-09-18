package gallery

import (
	_ "embed"
	"log"
)

//go:embed data/prompts.json
var defaultSeedData []byte

// InitDefaultDataIfEmpty 如果画廊数据库为空，自动加载内置的 1528 条提示词数据
func (s *Service) InitDefaultDataIfEmpty() {
	count, err := s.Count()
	if err != nil {
		log.Printf("[gallery] 检查条目数失败: %v", err)
		return
	}
	if count > 0 {
		return
	}
	if len(defaultSeedData) == 0 {
		return
	}
	log.Printf("[gallery] 检测到画廊表为空，正在导入默认提示词画廊数据...")
	imported, err := s.ImportFromJSONData(defaultSeedData)
	if err != nil {
		log.Printf("[gallery] 默认画廊数据导入失败: %v", err)
		return
	}
	log.Printf("[gallery] 成功导入 %d 条画廊数据", imported)
}
