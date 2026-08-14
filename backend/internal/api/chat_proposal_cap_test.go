package api

import (
	"encoding/json"
	"fmt"
	"testing"
)

func capOps(n int) []json.RawMessage {
	ops := make([]json.RawMessage, 0, n)
	for i := 0; i < n; i++ {
		ops = append(ops, json.RawMessage(fmt.Sprintf(`{"op":"replace","path":"/sections/experience/0/highlights/%d"}`, i)))
	}
	return ops
}

// Gặp thật trong app: trợ lý hỏi "muốn tôi đề xuất chỉnh sửa cho từng phần
// không?", người dùng đáp "có", model sinh 43 op — đúng thứ vừa được đồng ý — và
// máy chủ ném sạch cả 43 kèm câu tiếng Anh "invalid number of changes".
//
// 32/43 op đó mang grounding existing_field, tức viết lại có căn cứ. Vứt hết là
// vứt việc thật vì một con số trần.
func TestTrimKeepsWorkInsteadOfDiscardingIt(t *testing.T) {
	kept, proposed := trimToProposalCap(capOps(43))
	if proposed != 43 {
		t.Fatalf("số đã đề xuất phải giữ nguyên để báo cho người dùng: %d", proposed)
	}
	if len(kept) != maxChatProposalOps {
		t.Fatalf("phải cắt về đúng trần, nhận %d", len(kept))
	}
}

// Cắt theo tiền tố, không chọn lọc: JSON Patch áp tuần tự nên bỏ một op ở giữa
// làm lệch chỉ số mảng của mọi op sau nó.
func TestTrimTakesThePrefixInOrder(t *testing.T) {
	kept, _ := trimToProposalCap(capOps(25))
	for i, raw := range kept {
		var op struct{ Path string }
		if json.Unmarshal(raw, &op) != nil {
			t.Fatal("op hỏng")
		}
		want := fmt.Sprintf("/sections/experience/0/highlights/%d", i)
		if op.Path != want {
			t.Fatalf("op thứ %d là %q, mong đợi %q — thứ tự bị đảo", i, op.Path, want)
		}
	}
}

func TestTrimLeavesProposalsUnderTheCapAlone(t *testing.T) {
	kept, proposed := trimToProposalCap(capOps(3))
	if len(kept) != 3 || proposed != 3 {
		t.Fatalf("đề xuất dưới trần bị đụng vào: kept=%d proposed=%d", len(kept), proposed)
	}
}

// Sau khi cắt, đề xuất phải qua được validator — trước đây chính validator này
// là chỗ ném cả 43 op đi.
func TestTrimmedProposalPassesTheValidator(t *testing.T) {
	highlights := make([]string, 0, 30)
	for i := 0; i < 30; i++ {
		highlights = append(highlights, fmt.Sprintf("Gạch đầu dòng cũ %d.", i))
	}
	blob, err := json.Marshal(highlights)
	if err != nil {
		t.Fatal(err)
	}
	profile := []byte(`{"schemaVersion":2,"id":"cv","title":"CV","lastModified":"2026-08-14T00:00:00.000Z","language":"vi",
		"sections":{"intro":{"fullName":"Trần Minh Quân"},
		"experience":[{"id":"exp1","title":"Backend","company":"ABC","startDate":"2024-01","highlights":` + string(blob) + `}]}}`)
	layout := []byte(orderedRevisionLayout())

	// Path phải khác nhau: validator cấm một path xuất hiện hai lần, đúng như
	// luật ghi trong chat.system.md.
	ops := make([]json.RawMessage, 0, 30)
	for i := 0; i < 30; i++ {
		ops = append(ops, json.RawMessage(fmt.Sprintf(
			`{"op":"replace","path":"/sections/experience/0/highlights/%d","value":"Gạch đầu dòng mới %d.","rationale":"người dùng yêu cầu","grounding":{"type":"existing_field","ref":"hồ sơ"},"kbRefs":[]}`, i, i)))
	}
	if err := validateChatProposalDocuments(profile, layout, ops); err == nil {
		t.Fatal("30 op lẽ ra phải vượt trần")
	}
	trimmed, proposed := trimToProposalCap(ops)
	if proposed != 30 {
		t.Fatalf("proposed sai: %d", proposed)
	}
	if err := validateChatProposalDocuments(profile, layout, trimmed); err != nil {
		t.Fatalf("đề xuất đã cắt vẫn bị từ chối: %v", err)
	}
}
