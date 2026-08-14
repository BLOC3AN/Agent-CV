package api

import (
	"encoding/json"
	"strings"
	"testing"
)

const guardProfile = `{"sections":{"experience":[{"highlights":["Phát triển API cho hệ thống quản lý đơn hàng."]}],"projects":[{"highlights":["Viết tài liệu API cho nhóm."]}]}}`

func opJSON(t *testing.T, path, value string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"op": "replace", "path": path, "value": value,
		"rationale": "r", "grounding": map[string]any{"type": "user_message", "ref": "x"}, "kbRefs": []string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Chuỗi này là output THẬT của Qwen3.5-4B khi được bảo viết lại bullet dự án.
// Hồ sơ không có con số nào; "30%" là model tự nghĩ ra.
func TestInventedNumbersCaughtInMeasuredOutput(t *testing.T) {
	ops := []json.RawMessage{opJSON(t, "/sections/projects/0/highlights/0",
		"Xây dựng chức năng đặt lịch và nhắc lịch, giúp giảm 30% số cuộc gọi hỗ trợ cho khách hàng.")}

	found := inventedNumbersInOps(ops, []byte(guardProfile), guardProfile)
	if len(found) != 1 {
		t.Fatalf("không bắt được số bịa: %#v", found)
	}
	if found[0].Numbers[0] != "30" {
		t.Fatalf("bắt sai con số: %v", found[0].Numbers)
	}
}

// Tô vẽ định tính KHÔNG bị đẩy sang clarify: nó vẫn là đề xuất kèm cảnh báo.
// Chặn tới mức hỏi lại cho mọi câu văn hoa là biến trợ lý thành cái máy tra hỏi.
func TestQualitativeEmbellishmentIsNotTreatedAsInventedNumber(t *testing.T) {
	ops := []json.RawMessage{opJSON(t, "/sections/experience/0/highlights/0",
		"Phát triển và tối ưu hóa API cho hệ thống quản lý đơn hàng, cải thiện hiệu suất tổng thể.")}

	if found := inventedNumbersInOps(ops, []byte(guardProfile), guardProfile); len(found) != 0 {
		t.Fatalf("tô vẽ định tính không được coi là bịa số: %#v", found)
	}
}

// Số có sẵn trong hồ sơ thì viết lại quanh nó là việc hợp lệ.
func TestNumbersAlreadyInProfileAreNotInvented(t *testing.T) {
	profile := `{"sections":{"experience":[{"highlights":["Phục vụ 200000 người dùng."]}]}}`
	ops := []json.RawMessage{opJSON(t, "/sections/experience/0/highlights/0", "Xây dựng API phục vụ 200000 người dùng.")}
	if found := inventedNumbersInOps(ops, []byte(profile), profile); len(found) != 0 {
		t.Fatalf("số đã có trong hồ sơ bị coi là bịa: %#v", found)
	}
}

// Người dùng vừa cung cấp con số trong tin nhắn thì nó có căn cứ.
func TestNumbersFromTheUserMessageAreNotInvented(t *testing.T) {
	ops := []json.RawMessage{opJSON(t, "/sections/experience/0/highlights/0", "Giảm thời gian phản hồi 40%.")}
	sources := guardProfile + "\nGiảm được 40% thời gian phản hồi, viết lại giúp tôi."
	if found := inventedNumbersInOps(ops, []byte(guardProfile), sources); len(found) != 0 {
		t.Fatalf("số người dùng cung cấp bị coi là bịa: %#v", found)
	}
}

func TestClarifyRequestAsksForTheRealNumber(t *testing.T) {
	findings := []inventedNumberFinding{{Path: "/sections/projects/0/highlights/0", Numbers: []string{"30"}}}
	raw := clarifyRequestForInventedNumbers(findings, "vi")

	var req struct {
		Reason     string `json:"reason"`
		TargetPath string `json:"targetPath"`
		Questions  []struct {
			ID, Question, Placeholder string
		} `json:"questions"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Questions) != 1 {
		t.Fatalf("mong đợi 1 câu hỏi, nhận %d", len(req.Questions))
	}
	// Hỏi bằng JSON Pointer thì không ai trả lời được.
	if strings.Contains(req.Questions[0].Question, "/sections/") {
		t.Fatalf("câu hỏi còn nguyên JSON Pointer: %q", req.Questions[0].Question)
	}
	if !strings.Contains(req.Questions[0].Question, "dự án") {
		t.Fatalf("câu hỏi không nói rõ chỗ nào: %q", req.Questions[0].Question)
	}
	// Chỉ số mảng đếm từ 0, người dùng đếm từ 1.
	if !strings.Contains(req.Questions[0].Question, "gạch đầu dòng 1") {
		t.Fatalf("chỉ số không đổi sang cách đếm của người dùng: %q", req.Questions[0].Question)
	}
	if req.TargetPath != "/sections/projects/0/highlights/0" {
		t.Fatalf("targetPath sai: %q", req.TargetPath)
	}
	if req.Reason == "" {
		t.Fatal("thiếu lý do — người dùng cần biết vì sao không nhận được đề xuất")
	}
}

// Prompt giới hạn model hỏi tối đa 3 câu; máy chủ tự hỏi cũng phải theo trần đó.
func TestClarifyRequestCapsAtThreeQuestions(t *testing.T) {
	findings := []inventedNumberFinding{
		{Path: "/sections/experience/0/highlights/0", Numbers: []string{"1"}},
		{Path: "/sections/experience/0/highlights/1", Numbers: []string{"2"}},
		{Path: "/sections/projects/0/highlights/0", Numbers: []string{"3"}},
		{Path: "/sections/projects/0/highlights/1", Numbers: []string{"4"}},
	}
	var req struct {
		Questions []json.RawMessage `json:"questions"`
	}
	if err := json.Unmarshal(clarifyRequestForInventedNumbers(findings, "vi"), &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Questions) != 3 {
		t.Fatalf("mong đợi trần 3 câu, nhận %d", len(req.Questions))
	}
}

func TestClarifyRequestFollowsTheRequestedLanguage(t *testing.T) {
	findings := []inventedNumberFinding{{Path: "/sections/intro/summary", Numbers: []string{"30"}}}
	en := string(clarifyRequestForInventedNumbers(findings, "en"))
	if !strings.Contains(en, "not in your CV") {
		t.Fatalf("client chọn tiếng Anh nhưng câu hỏi không phải tiếng Anh: %s", en)
	}
	// Ngôn ngữ lạ lùi về tiếng Việt, giống chatSystemPrompt.
	fallback := string(clarifyRequestForInventedNumbers(findings, "de"))
	if !strings.Contains(fallback, "CV của bạn") {
		t.Fatalf("ngôn ngữ lạ không lùi về tiếng Việt: %s", fallback)
	}
}

// Payload phải khớp hình dạng mà parseChatModelOutput và giao diện đang chờ, nếu
// không clarify tự dựng sẽ rơi vào nhánh xử lý lỗi.
func TestGeneratedClarifyMatchesTheModelOutputShape(t *testing.T) {
	findings := []inventedNumberFinding{{Path: "/sections/intro/summary", Numbers: []string{"30"}}}
	raw := clarifyRequestForInventedNumbers(findings, "vi")

	envelope, err := json.Marshal(map[string]any{"kind": "clarify", "request": json.RawMessage(raw)})
	if err != nil {
		t.Fatal(err)
	}
	out := parseChatModelOutput(string(envelope))
	if out.Kind != "clarify" || len(out.Request) == 0 {
		t.Fatalf("clarify tự dựng không qua được parseChatModelOutput: %#v", out)
	}
}
