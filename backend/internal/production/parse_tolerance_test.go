package production

import (
	"encoding/json"
	"testing"
)

// 模型经常把时长写成 "3" 或 "3秒"，把角色、道具写成单个字符串。
// 这类偏差只该影响该字段的取值，不该让整集镜头作废。
func TestParseScriptToleratesFieldTypes(t *testing.T) {
	cases := []struct {
		name       string
		raw        string
		wantSecond float64
		wantCast   []string
	}{
		{"时长是数字", `{"shots":[{"action":"入内","durationSeconds":3}]}`, 3, nil},
		{"时长是数字字符串", `{"shots":[{"action":"入内","durationSeconds":"3"}]}`, 3, nil},
		{"时长带单位", `{"shots":[{"action":"入内","durationSeconds":"3秒"}]}`, 3, nil},
		{"时长带小数与空格", `{"shots":[{"action":"入内","durationSeconds":"约 3.5 秒"}]}`, 3.5, nil},
		{"时长是空对象", `{"shots":[{"action":"入内","durationSeconds":{}}]}`, 0, nil},
		{"角色是单个字符串", `{"shots":[{"action":"入内","characters":"陆天擎"}]}`, 0, []string{"陆天擎"}},
		{"角色数组混入数字", `{"shots":[{"action":"入内","characters":["甲",7,"乙"]}]}`, 0, []string{"甲", "7", "乙"}},
		{"场景是数字", `{"shots":[{"action":"入内","scene":7}]}`, 0, nil},
		{"对白是布尔", `{"shots":[{"action":"入内","dialogue":true,"speaker":"甲"}]}`, 0, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			shots, err := ParseScript(c.raw)
			if err != nil {
				t.Fatalf("parse failed: %v", err)
			}
			if len(shots) != 1 {
				t.Fatalf("want 1 shot, got %d", len(shots))
			}
			if shots[0].DurationSeconds != c.wantSecond {
				t.Fatalf("durationSeconds = %v, want %v", shots[0].DurationSeconds, c.wantSecond)
			}
			if c.wantCast != nil {
				if len(shots[0].Characters) != len(c.wantCast) {
					t.Fatalf("characters = %v, want %v", shots[0].Characters, c.wantCast)
				}
				for index := range c.wantCast {
					if shots[0].Characters[index] != c.wantCast[index] {
						t.Fatalf("characters = %v, want %v", shots[0].Characters, c.wantCast)
					}
				}
			}
		})
	}
}

// 结构瑕疵只影响 JSON 本身是否完整：尾逗号、缺失闭合括号、尾部混入正文都应被修补。
func TestExtractJSONObjectRepairsStructure(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"缺少数组闭合且混入正文", `{"shots":[{"action":"a"},{"action":"b"} distribute}`},
		{"尾部多一个花括号", `{"shots":[{"action":"a"}}`},
		{"尾部残留逗号", `{"shots":[{"action":"a",}]}`},
		{"输出被截断", `{"shots":[{"action":"a"},{"action":"b"`},
		{"尾部混入英文单词", `{"shots":[{"action":"a"}]} distribute`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			repaired, err := ExtractJSONObject(c.raw)
			if err != nil {
				t.Fatalf("expected repair, got %v", err)
			}
			if !json.Valid([]byte(repaired)) {
				t.Fatalf("repair produced invalid JSON: %s", repaired)
			}
			shots, err := ParseScript(repaired)
			if err != nil {
				t.Fatalf("repaired JSON must parse: %v (%s)", err, repaired)
			}
			if len(shots) == 0 {
				t.Fatalf("repaired JSON has no shots: %s", repaired)
			}
		})
	}
}

// 真实失败样本：模型把 scenes 数组的右括号写丢，还混入了一个英文词。
func TestExtractJSONObjectRepairsDroppedBracket(t *testing.T) {
	raw := `{"logline":"退役兵王","characters":[{"name":"陆天擎"}],"scenes":[` +
		`{"name":"宴会厅","appearance":"水晶吊灯"} distribute}`
	repaired, err := ExtractJSONObject(raw)
	if err != nil {
		t.Fatalf("expected repair, got %v", err)
	}
	bible, err := ParseBible(repaired)
	if err != nil {
		t.Fatalf("bible must parse after repair: %v", err)
	}
	if len(bible.Characters) != 1 || len(bible.Scenes) != 1 {
		t.Fatalf("unexpected bible: %+v", bible)
	}
}

// 合法输入必须原样返回，修补逻辑不能改写正常结果。
func TestExtractJSONObjectLeavesValidInputUntouched(t *testing.T) {
	cases := []string{
		`{"a":1}`,
		`{"a":1,"b":[1,2,3]}`,
		`{"a":"含,逗号与}括号的文本"}`,
		`{"a":{"b":{"c":true}},"d":null}`,
	}
	for _, raw := range cases {
		got, err := ExtractJSONObject(raw)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", raw, err)
		}
		if got != raw {
			t.Fatalf("valid input was rewritten: %q -> %q", raw, got)
		}
	}
}

// 完全不是 JSON 的输出仍然要报 ErrNoJSON，不能被补成空壳。
func TestExtractJSONObjectRejectsNonJSON(t *testing.T) {
	for _, raw := range []string{"没有 JSON", "{这不是 JSON", "以下是说明文字"} {
		if _, err := ExtractJSONObject(raw); err == nil {
			t.Fatalf("%q must not be repaired into JSON", raw)
		}
	}
	// 空对象是合法 JSON，内容够不够用交给下游判断，这里不该擅自报错。
	if got, err := ExtractJSONObject("{}"); err != nil || got != "{}" {
		t.Fatalf("empty object must stay valid: %q %v", got, err)
	}
}
