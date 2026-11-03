package app

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/production"
)

// 解析失败必须带上可定位的现场，否则「被截断」和「写坏括号」在界面上是同一句话。
func TestDescribeDramaParseFailureReportsTruncation(t *testing.T) {
	text := dramaText{Text: strings.Repeat("长", 200) + `"} distribute}`, FinishReason: "length"}
	err := describeDramaParseFailure(fmt.Errorf("分镜脚本解析失败：%w", production.ErrNoJSON), text)
	message := err.Error()
	for _, want := range []string{"分镜脚本解析失败", "共 214 字", "结束原因 length", "被截断", "尾部：", "distribute"} {
		if !strings.Contains(message, want) {
			t.Fatalf("missing %q in: %s", want, message)
		}
	}
	// failJob 只保留 500 字，诊断信息必须留在预算内。
	if runes := len([]rune(message)); runes > 500 {
		t.Fatalf("message too long: %d runes", runes)
	}
	// 包装不能丢掉原始错误类型，否则上层无法再分类。
	if !errors.Is(err, production.ErrNoJSON) {
		t.Fatal("underlying error must stay wrapped")
	}
}

// 正常结束时不该提示调大输出上限，那是误导。
func TestDescribeDramaParseFailureWithoutTruncation(t *testing.T) {
	text := dramaText{Text: `{"shots":[` + strings.Repeat("x", 50), FinishReason: "stop"}
	message := describeDramaParseFailure(fmt.Errorf("分镜脚本解析失败：%w", production.ErrNoJSON), text).Error()
	if strings.Contains(message, "被截断") {
		t.Fatalf("stop reason must not claim truncation: %s", message)
	}
	if !strings.Contains(message, "结束原因 stop") {
		t.Fatalf("finish reason must be reported: %s", message)
	}
}

// 上游没给结束原因时只报长度与尾部，不能编造结束原因。
func TestDescribeDramaParseFailureWithoutFinishReason(t *testing.T) {
	text := dramaText{Text: `{"shots":[`}
	message := describeDramaParseFailure(fmt.Errorf("分镜脚本解析失败：%w", production.ErrNoJSON), text).Error()
	if strings.Contains(message, "结束原因") {
		t.Fatalf("finish reason must be absent when upstream omits it: %s", message)
	}
	if !strings.Contains(message, "共 10 字") {
		t.Fatalf("length must be reported: %s", message)
	}
}
