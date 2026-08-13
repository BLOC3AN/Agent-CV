package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// Token "-" của JSON Pointer nghĩa là "nối vào cuối mảng", nên nó CHỈ có nghĩa
// với op add. Trước đây validator từ chối đúng, nhưng báo "path không được hỗ
// trợ" — sai sự thật, vì chính path đó dùng với add thì hợp lệ. Thông báo sai
// khiến cả người dùng lẫn người sửa lỗi đi tìm nhầm chỗ.
func TestValidateChatProposalDocumentsNamesTheOpWhenAppendTokenUsedWithWrongOp(t *testing.T) {
	profile := validRevisionCV("CV", "Candidate")
	layout := append(json.RawMessage(nil), defaultCVLayout...)

	for _, op := range []string{"replace", "remove"} {
		t.Run(op, func(t *testing.T) {
			var ops []json.RawMessage
			raw := `[{"op":"` + op + `","path":"/sections/skills/0/skills/-","value":"Kubernetes","rationale":"Bổ sung kỹ năng","grounding":{"type":"user_message","ref":"x"}}]`
			if err := json.Unmarshal([]byte(raw), &ops); err != nil {
				t.Fatal(err)
			}
			err := validateChatProposalDocuments(profile, layout, ops)
			if err == nil {
				t.Fatalf("%s vào cuối mảng lẽ ra phải bị từ chối", op)
			}
			if !strings.Contains(err.Error(), op) {
				t.Errorf("thông báo phải nêu op %q, nhận: %v", op, err)
			}
			if !strings.Contains(err.Error(), "add") {
				t.Errorf("thông báo phải chỉ ra add mới là op dùng được, nhận: %v", err)
			}
		})
	}
}

// `validRevisionCV` để skills rỗng, mà nối vào cuối thì phải có sẵn nhóm để nối.
func revisionCVWithSkillGroup(t *testing.T) json.RawMessage {
	t.Helper()
	var cv map[string]any
	if err := json.Unmarshal(validRevisionCV("CV", "Candidate"), &cv); err != nil {
		t.Fatal(err)
	}
	sections := cv["sections"].(map[string]any)
	sections["skills"] = []any{map[string]any{"id": "skill-1", "category": "Backend", "skills": []any{"Go"}}}
	raw, err := json.Marshal(cv)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Cùng path ấy với add thì phải qua — nếu không thì thông báo trên là vô nghĩa.
func TestValidateChatProposalDocumentsAcceptsAppendingASkill(t *testing.T) {
	profile := revisionCVWithSkillGroup(t)
	layout := append(json.RawMessage(nil), defaultCVLayout...)
	var ops []json.RawMessage
	raw := `[{"op":"add","path":"/sections/skills/0/skills/-","value":"Kubernetes","rationale":"Bổ sung kỹ năng","grounding":{"type":"user_message","ref":"x"}}]`
	if err := json.Unmarshal([]byte(raw), &ops); err != nil {
		t.Fatal(err)
	}
	if err := validateChatProposalDocuments(profile, layout, ops); err != nil {
		t.Fatalf("thêm kỹ năng bằng add bị từ chối: %v", err)
	}
}

// Prompt dạy mô hình dùng path "/sections/skills/0/skills/-" nhưng không hề nói
// token đó bắt buộc đi với add, còn schema thì cho cả ba op với path bất kỳ.
// Mô hình chọn replace cho một yêu cầu "enhance" là suy luận tự nhiên, và đề
// xuất bị chặn ở tầng dưới. Luật phải nằm ngay cạnh chỗ dạy path.
func TestChatSystemPromptStatesAppendTokenRequiresAdd(t *testing.T) {
	for _, language := range []string{"vi", "en"} {
		prompt := chatSystemPrompt(language)
		index := strings.Index(prompt, "/-")
		if index == -1 {
			t.Fatalf("%s: prompt không còn dạy path nối mảng", language)
		}
		if !strings.Contains(prompt, `"-"`) || !strings.Contains(prompt, "add") {
			t.Fatalf("%s: prompt phải nêu rõ token \"-\" chỉ dùng với add", language)
		}
	}
}
