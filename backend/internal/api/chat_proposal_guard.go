package api

// Hai chốt chặn cho đề xuất của model, đặt ở phía máy chủ vì đo thật cho thấy
// luật viết trong prompt không giữ được chúng:
//
//   - 12/18 lượt trả summary mở đầu "Đã cập nhật…" dù prompt cấm rõ ràng, và
//     summary đó đi thẳng vào khung chat — người dùng bị báo hồ sơ đã đổi trong
//     khi nó mới là đề xuất chờ duyệt.
//   - 29/29 op khai grounding "user_message", kể cả op bịa hẳn nội dung mới.
//
// Kết quả đầy đủ: docs/superpowers/specs/2026-08-14-do-chat-model-ket-qua.md
//
// Chốt ở đây tất định, không cần model hợp tác.

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode"
)

// Tiền tố khẳng định ĐÃ LÀM XONG, lấy từ output thật của model chứ không phải
// nghĩ ra. Vế phải là dạng đề xuất tương ứng; giữ nguyên phần còn lại của câu
// để người dùng vẫn đọc được model định làm gì.
var completionClaimPrefixes = []struct{ claim, proposal string }{
	{"Đã cập nhật lại ", "Đề xuất cập nhật "},
	{"Đã cập nhật ", "Đề xuất cập nhật "},
	{"Đã viết lại ", "Đề xuất viết lại "},
	{"Đã thêm ", "Đề xuất thêm "},
	{"Đã sửa ", "Đề xuất sửa "},
	{"Đã xoá ", "Đề xuất xoá "},
	{"Đã xóa ", "Đề xuất xoá "},
	{"Đã điều chỉnh ", "Đề xuất điều chỉnh "},
	{"Đã tối ưu ", "Đề xuất tối ưu "},
	{"Đã sắp xếp lại ", "Đề xuất sắp xếp lại "},
	{"Đã bổ sung ", "Đề xuất bổ sung "},
	{"I have updated ", "Proposed update to "},
	{"I've updated ", "Proposed update to "},
	{"Updated ", "Proposed update to "},
	{"Rewrote ", "Proposed rewrite of "},
	{"Added ", "Proposed addition of "},
	{"Removed ", "Proposed removal of "},
}

// neutralizeProposalSummary bỏ lời khẳng định đã hoàn thành khỏi summary.
//
// Câu này được lưu vào chat_messages và hiện trong khung chat, nên nó là phát
// ngôn của hệ thống về trạng thái hồ sơ. Model không được quyền nói sai về trạng
// thái đó, kể cả khi nó rất tự tin.
func neutralizeProposalSummary(summary string) string {
	trimmed := strings.TrimSpace(summary)
	for _, p := range completionClaimPrefixes {
		if strings.HasPrefix(trimmed, p.claim) {
			return p.proposal + strings.TrimPrefix(trimmed, p.claim)
		}
	}
	return trimmed
}

// Số liệu là thứ nguy hiểm nhất một CV có thể bịa: "giảm 40% thời gian phản hồi"
// đọc như thành tích và không ai kiểm được. Bắt riêng chúng.
var digitRun = regexp.MustCompile(`[0-9]+(?:[.,][0-9]+)*`)

// Tỉ lệ từ mới tối đa còn coi là viết lại chứ không phải bịa. Ngưỡng chọn thủ
// công, và hậu quả của việc đoán sai là NHẸ: op bị xếp "inference" chỉ mất tick
// sẵn trong giao diện, người dùng vẫn tick lại được. Chính vì hậu quả nhẹ nên
// thà nghiêm khắc hơn là dễ dãi.
const maxNovelWordRatio = 0.34

// deriveGroundingType tự suy ra nguồn của một giá trị đề xuất thay vì tin lời
// model khai. Trả về một trong ba giá trị mà chatResponseSchema cho phép.
//
// Giao diện dùng đúng trường này để bỏ tick sẵn những op "inference"
// (ChatPanel.tsx). Model không bao giờ tự khai "inference", nên nếu cứ tin nó
// thì cơ chế an toàn đó không bao giờ chạy.
func deriveGroundingType(value string, pathExists bool, sources string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "existing_field"
	}
	haystack := strings.ToLower(sources)

	// Một con số không có trong hồ sơ lẫn lời người dùng là con số model tự nghĩ
	// ra. Không có ngoại lệ nào đáng cho qua ở đây.
	for _, number := range digitRun.FindAllString(value, -1) {
		if !strings.Contains(haystack, strings.ToLower(number)) {
			return "inference"
		}
	}

	words := significantWords(value)
	if len(words) > 0 {
		novel := 0
		for _, w := range words {
			if !strings.Contains(haystack, w) {
				novel++
			}
		}
		if float64(novel)/float64(len(words)) > maxNovelWordRatio {
			return "inference"
		}
	}
	if pathExists {
		return "existing_field"
	}
	return "user_message"
}

// significantWords cắt chuỗi thành các từ đủ dài để mang nội dung. Ngưỡng 4 ký
// tự loại được hư từ tiếng Việt ("và", "của", "cho", "các") lẫn tiếng Anh
// ("the", "and", "for") mà không cần một danh sách stopword phải bảo trì.
func significantWords(text string) []string {
	fields := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if len([]rune(f)) >= 4 {
			out = append(out, f)
		}
	}
	return out
}

// proposalGroundingSources gom mọi thứ một đề xuất được phép dựa vào: hồ sơ hiện
// tại, câu trả lời cho các câu hỏi làm rõ, và tin nhắn của người dùng.
//
// Hồ sơ lấy bản CHƯA che PII: đây là kiểm phía máy chủ, và dùng bản đã che thì
// một đề xuất nhắc lại đúng dữ kiện có thật trong hồ sơ lại bị coi là bịa.
func proposalGroundingSources(profileRaw []byte, answers []map[string]string, message string) string {
	parts := []string{string(profileRaw), message}
	for _, answer := range answers {
		for _, value := range answer {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "\n")
}

// applyDerivedGrounding ghi đè grounding.type của mọi op bằng giá trị máy chủ tự
// suy ra. Giữ nguyên grounding.ref: nó là lời giải thích cho người đọc, không
// phải thứ điều khiển giao diện.
func applyDerivedGrounding(ops []json.RawMessage, profileRaw []byte, sources string) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(ops))
	for _, raw := range ops {
		var op map[string]any
		if json.Unmarshal(raw, &op) != nil {
			out = append(out, raw)
			continue
		}
		path, _ := op["path"].(string)
		grounding, ok := op["grounding"].(map[string]any)
		if !ok {
			out = append(out, raw)
			continue
		}
		grounding["type"] = deriveGroundingType(valueText(op["value"]), jsonPointerExists(profileRaw, path), sources)
		patched, err := json.Marshal(op)
		if err != nil {
			out = append(out, raw)
			continue
		}
		out = append(out, patched)
	}
	return out
}

// valueText gom mọi chữ trong value về một chuỗi. Value có thể là chuỗi, mảng
// chuỗi hoặc cả một object mục kinh nghiệm, và bịa nằm được ở bất kỳ nhánh nào.
func valueText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			parts = append(parts, valueText(item))
		}
		return strings.Join(parts, " ")
	case map[string]any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			parts = append(parts, valueText(item))
		}
		return strings.Join(parts, " ")
	default:
		blob, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(blob)
	}
}

// jsonPointerExists cho biết path đã có giá trị trong hồ sơ hay chưa — phân biệt
// "viết lại thứ đang có" với "thêm thứ chưa có".
func jsonPointerExists(raw []byte, path string) bool {
	if path == "" || path == "/" {
		return false
	}
	var node any
	if json.Unmarshal(raw, &node) != nil {
		return false
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		switch current := node.(type) {
		case map[string]any:
			next, ok := current[part]
			if !ok {
				return false
			}
			node = next
		case []any:
			index, err := parseArrayIndex(part)
			if err != nil || index >= len(current) {
				return false
			}
			node = current[index]
		default:
			return false
		}
	}
	return node != nil
}

func parseArrayIndex(part string) (int, error) {
	var index int
	for _, r := range part {
		if !unicode.IsDigit(r) {
			return 0, errNotAnIndex
		}
		index = index*10 + int(r-'0')
	}
	if part == "" {
		return 0, errNotAnIndex
	}
	return index, nil
}

var errNotAnIndex = &notAnIndexError{}

type notAnIndexError struct{}

func (*notAnIndexError) Error() string { return "not an array index" }
