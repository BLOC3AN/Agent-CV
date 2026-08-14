package api

import (
	"encoding/json"
	"strings"
	"testing"
)

const certProfile = `{"schemaVersion":2,"id":"cv","title":"CV","lastModified":"2026-08-14T00:00:00.000Z","language":"vi",
	"sections":{"intro":{"fullName":"Trần Minh Quân"},
	"certifications":[
		{"id":"c0","name":"Chứng chỉ A","issuer":"X","date":"2023"},
		{"id":"c1","name":"Chứng chỉ B","issuer":"Y","date":"2023"},
		{"id":"c2","name":"Chứng chỉ C","issuer":"Z","date":"2024"}]}}`

func op(t *testing.T, name, path string, value any) json.RawMessage {
	t.Helper()
	m := map[string]any{"op": name, "path": path, "rationale": "người dùng yêu cầu",
		"grounding": map[string]any{"type": "existing_field", "ref": "hồ sơ"}, "kbRefs": []string{}}
	if name != "remove" {
		m["value"] = value
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Dãy op THẬT từ production (openai.luna). Model đánh số theo mảng BAN ĐẦU,
// nhưng JSON Patch áp tuần tự: xoá phần tử 0 xong thì mọi chỉ số phía sau tụt
// một bậc, nên `/certifications/2/name` chết. Trước bản vá, một op chết kéo theo
// cả đề xuất và người dùng nhận câu tiếng Anh kèm chuỗi lỗi nội bộ.
func TestKeepsTheRestWhenIndexesShiftAfterRemove(t *testing.T) {
	ops := []json.RawMessage{
		op(t, "replace", "/sections/intro/fullName", "Trần Minh Quân"),
		op(t, "remove", "/sections/certifications/0", nil),
		op(t, "replace", "/sections/certifications/1/name", "Chứng chỉ C mới"),
		op(t, "replace", "/sections/certifications/2/name", "Không còn tồn tại"),
	}

	kept, dropped := keepApplicableOps([]byte(certProfile), []byte(orderedRevisionLayout()), ops)

	if len(kept) != 3 {
		t.Fatalf("phải giữ 3 op dùng được, giữ %d", len(kept))
	}
	if len(dropped) != 1 {
		t.Fatalf("phải bỏ đúng 1 op, bỏ %d: %#v", len(dropped), dropped)
	}
	if dropped[0].Path != "/sections/certifications/2/name" {
		t.Fatalf("bỏ nhầm op: %s", dropped[0].Path)
	}
	// Lý do phải nói đúng nguyên nhân: lệch chỉ số, không phải model trỏ bừa.
	if !strings.Contains(dropped[0].Reason, "không còn ở vị trí đó") {
		t.Fatalf("lý do không nói rõ nguyên nhân: %q", dropped[0].Reason)
	}
}

// Đề xuất mà mọi op đều áp được thì không được đụng vào.
func TestKeepsEverythingWhenNothingFails(t *testing.T) {
	ops := []json.RawMessage{
		op(t, "replace", "/sections/certifications/0/name", "A mới"),
		op(t, "replace", "/sections/certifications/1/name", "B mới"),
	}
	kept, dropped := keepApplicableOps([]byte(certProfile), []byte(orderedRevisionLayout()), ops)
	if len(kept) != 2 || len(dropped) != 0 {
		t.Fatalf("đề xuất lành lặn bị đụng vào: kept=%d dropped=%d", len(kept), len(dropped))
	}
}

// Path không được phép cũng chỉ làm rơi op đó, không giết cả đề xuất.
func TestDisallowedPathDropsOnlyThatOp(t *testing.T) {
	ops := []json.RawMessage{
		op(t, "replace", "/sections/certifications/0/name", "A mới"),
		op(t, "replace", "/sections/intro/bịaRa", "x"),
	}
	kept, dropped := keepApplicableOps([]byte(certProfile), []byte(orderedRevisionLayout()), ops)
	if len(kept) != 1 || len(dropped) != 1 {
		t.Fatalf("kept=%d dropped=%d", len(kept), len(dropped))
	}
	if dropped[0].Reason == "" {
		t.Fatal("op bị bỏ phải kèm lý do")
	}
}

// Op dựa vào một op vừa bị bỏ thì tự chết theo — đó là hành vi đúng, vì tài liệu
// không bao giờ ở trạng thái mà nó trông đợi.
func TestDependentOpFallsWithItsPrerequisite(t *testing.T) {
	ops := []json.RawMessage{
		op(t, "replace", "/sections/certifications/9/name", "không tồn tại"),
		op(t, "replace", "/sections/certifications/0/name", "A mới"),
	}
	kept, dropped := keepApplicableOps([]byte(certProfile), []byte(orderedRevisionLayout()), ops)
	if len(kept) != 1 || len(dropped) != 1 {
		t.Fatalf("kept=%d dropped=%d", len(kept), len(dropped))
	}
}

// Ca production thứ hai: `add .../highlights/-` hai lần bị chặn vì luật "mỗi path
// một lần". Token "-" nghĩa là NỐI VÀO CUỐI, không phải một vị trí — thêm hai
// gạch đầu dòng vào cùng một mục là yêu cầu bình thường và hai op không mâu
// thuẫn nhau.
func TestTwoAppendsToTheSameListAreAllowed(t *testing.T) {
	profile := []byte(`{"schemaVersion":2,"id":"cv","title":"CV","lastModified":"2026-08-14T00:00:00.000Z","language":"vi",
		"sections":{"intro":{"fullName":"Q"},
		"experience":[{"id":"e1","title":"Backend","company":"ABC","startDate":"2024-01","highlights":["Cũ."]}]}}`)
	ops := []json.RawMessage{
		op(t, "add", "/sections/experience/0/highlights/-", "Gạch đầu dòng mới 1."),
		op(t, "add", "/sections/experience/0/highlights/-", "Gạch đầu dòng mới 2."),
	}
	if err := validateChatProposalDocuments(profile, []byte(orderedRevisionLayout()), ops); err != nil {
		t.Fatalf("hai lần nối vào cuối cùng một mảng phải hợp lệ: %v", err)
	}
}

// Nhưng hai chỉnh sửa đá nhau trên CÙNG một ô vẫn phải bị chặn — đó mới là thứ
// luật trùng path sinh ra để ngăn.
func TestTwoEditsToTheSameFieldAreStillRejected(t *testing.T) {
	ops := []json.RawMessage{
		op(t, "replace", "/sections/certifications/0/name", "A"),
		op(t, "replace", "/sections/certifications/0/name", "B"),
	}
	if err := validateChatProposalDocuments([]byte(certProfile), []byte(orderedRevisionLayout()), ops); err == nil {
		t.Fatal("hai chỉnh sửa đá nhau trên cùng một ô phải bị chặn")
	}
}

func TestDroppedOpsPayloadIsNeverNull(t *testing.T) {
	blob, err := json.Marshal(droppedOpsPayload(nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(blob) != "[]" {
		t.Fatalf("client khai rejected là mảng, nhận %s", blob)
	}
}
