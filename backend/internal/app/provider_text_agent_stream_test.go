package app

import "testing"

// 输出被截断时必须能从结果里看出来，否则「模型写坏格式」和「模型没写完」
// 在日志里完全一样，只能靠猜。
func TestStreamingParserRecordsFinishReason(t *testing.T) {
	cases := []struct {
		name     string
		protocol string
		frames   []string
		want     string
	}{
		{
			name:     "chat-completion 的 length",
			protocol: "chat-completion",
			frames: []string{
				`data: {"choices":[{"delta":{"content":"{\"shots\":"}}]}`,
				`data: {"choices":[{"delta":{},"finish_reason":"length"}]}`,
			},
			want: "length",
		},
		{
			name:     "claude 的 max_tokens",
			protocol: "claude-api",
			frames: []string{
				`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"片段"}}`,
				`data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}`,
			},
			want: "max_tokens",
		},
		{
			name:     "responses 的 incomplete_details",
			protocol: "responses",
			frames: []string{
				`data: {"type":"response.output_text.delta","delta":"片段"}`,
				`data: {"type":"response.completed","response":{"incomplete_details":{"reason":"max_output_tokens"}}}`,
			},
			want: "max_output_tokens",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			parser := newStreamingAgentParser(c.protocol, nil)
			for _, frame := range c.frames {
				parser.consumeFrame(frame)
			}
			result, err := parser.result()
			if err != nil {
				t.Fatalf("result failed: %v", err)
			}
			if got := result["finishReason"]; got != c.want {
				t.Fatalf("finishReason = %v, want %q", got, c.want)
			}
		})
	}
}

// 正常结束时也要带着结束原因，避免调用方把「正常结束」误判为未知。
func TestStreamingParserRecordsNormalStop(t *testing.T) {
	parser := newStreamingAgentParser("chat-completion", nil)
	parser.consumeFrame(`data: {"choices":[{"delta":{"content":"完成"}}]}`)
	parser.consumeFrame(`data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`)
	result, err := parser.result()
	if err != nil {
		t.Fatal(err)
	}
	if result["finishReason"] != "stop" {
		t.Fatalf("finishReason = %v, want stop", result["finishReason"])
	}
}

// 上游没给结束原因时不能凭空编一个。
func TestStreamingParserOmitsMissingFinishReason(t *testing.T) {
	parser := newStreamingAgentParser("chat-completion", nil)
	parser.consumeFrame(`data: {"choices":[{"delta":{"content":"只有正文"}}]}`)
	result, err := parser.result()
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := result["finishReason"]; exists {
		t.Fatalf("finishReason must be absent, got %v", result["finishReason"])
	}
}
