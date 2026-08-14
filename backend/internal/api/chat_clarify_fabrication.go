package api

// Biến một đề xuất chứa số liệu bịa thành câu hỏi.
//
// Đo thật trên Qwen3.5-4B: nhánh clarify chạy 0/18 lượt, kể cả kịch bản dựng
// riêng cho nó — model luôn chọn bịa thay vì hỏi. Nhưng máy chủ thì biết chắc
// khi nào nó bịa số, vì nó đối chiếu được với hồ sơ. Dùng đúng tín hiệu đó để
// hỏi thay cho model.
//
// Chỉ số liệu bịa mới bị chặn tới mức này. Bịa định tính ("cải thiện hiệu suất
// tổng thể") vẫn đi tiếp dưới dạng đề xuất kèm cảnh báo — nó là tô vẽ, còn số
// liệu bịa là thứ người dùng mang đi phỏng vấn rồi không giải thích được.

import (
	"encoding/json"
	"strings"
)

type inventedNumberFinding struct {
	Path    string
	Numbers []string
}

// inventedNumbersInOps duyệt op đã qua validator và chỉ ra chỗ nào mang số liệu
// không có trong hồ sơ lẫn lời người dùng.
func inventedNumbersInOps(ops []json.RawMessage, profileRaw []byte, sources string) []inventedNumberFinding {
	var out []inventedNumberFinding
	for _, raw := range ops {
		var op map[string]any
		if json.Unmarshal(raw, &op) != nil {
			continue
		}
		path, _ := op["path"].(string)
		verdict := deriveGrounding(valueText(op["value"]), jsonPointerExists(profileRaw, path), sources)
		if len(verdict.InventedNumbers) > 0 {
			out = append(out, inventedNumberFinding{Path: path, Numbers: verdict.InventedNumbers})
		}
	}
	return out
}

// Câu chữ cho người dùng đọc, theo ngôn ngữ giao diện client gửi lên — cùng cơ
// chế mà chatSystemPrompt dùng cho reply_in. Đây KHÔNG phải prompt (nó không bao
// giờ tới model) nên nó không nằm trong prompts/.
type clarifyWording struct {
	reason      string
	question    string
	placeholder string
}

var fabricationWording = map[string]clarifyWording{
	"vi": {
		reason:      "Bản viết lại có số liệu không có trong CV của bạn, nên tôi không đề xuất nó. Cho tôi con số thật thì tôi viết lại đúng chỗ đó.",
		question:    "Kết quả thật ở %s là bao nhiêu?",
		placeholder: "ví dụ: giảm từ 4,2s xuống 0,9s cho 200 nghìn bản ghi",
	},
	"en": {
		reason:      "The rewrite contained figures that are not in your CV, so I did not propose it. Give me the real numbers and I will rewrite that part.",
		question:    "What was the actual result for %s?",
		placeholder: "e.g. cut response time from 4.2s to 0.9s across 200k records",
	},
}

// clarifyRequestForInventedNumbers dựng payload clarify đúng hình dạng mà
// chatResponseSchema và giao diện đang chờ.
//
// Tối đa 3 câu hỏi: cùng trần mà prompt đặt cho model, và người dùng không trả
// lời nổi một danh sách dài hơn thế.
func clarifyRequestForInventedNumbers(findings []inventedNumberFinding, language string) json.RawMessage {
	wording, ok := fabricationWording[language]
	if !ok {
		wording = fabricationWording["vi"]
	}
	questions := make([]map[string]any, 0, 3)
	for _, f := range findings {
		if len(questions) == 3 {
			break
		}
		questions = append(questions, map[string]any{
			"id":          "evidence:" + f.Path,
			"question":    strings.Replace(wording.question, "%s", humanReadablePath(f.Path), 1),
			"placeholder": wording.placeholder,
		})
	}
	// targetPath nhận path đầu tiên: giao diện dùng nó để cuộn tới đúng chỗ, và
	// một câu trả lời gộp vẫn hơn không trỏ vào đâu cả.
	var targetPath any
	if len(findings) > 0 {
		targetPath = findings[0].Path
	}
	blob, err := json.Marshal(map[string]any{
		"reason":     wording.reason,
		"targetPath": targetPath,
		"questions":  questions,
	})
	if err != nil {
		return nil
	}
	return blob
}

// humanReadablePath đổi JSON Pointer thành cụm người đọc được. Hỏi "kết quả thật
// ở /sections/experience/0/highlights/2 là bao nhiêu" thì không ai trả lời được.
func humanReadablePath(path string) string {
	names := map[string]string{
		"experience": "kinh nghiệm", "projects": "dự án", "education": "học vấn",
		"activities": "hoạt động", "skills": "kỹ năng", "intro": "phần giới thiệu",
		"certifications": "chứng chỉ", "languages": "ngoại ngữ",
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) < 2 || parts[0] != "sections" {
		return path
	}
	name, ok := names[parts[1]]
	if !ok {
		name = parts[1]
	}
	if len(parts) >= 5 && parts[3] == "highlights" {
		return name + " — gạch đầu dòng " + incrementIndex(parts[4])
	}
	if len(parts) >= 4 {
		return name + " — " + parts[3]
	}
	return name
}

// incrementIndex đổi chỉ số mảng đếm-từ-0 sang thứ tự người dùng nhìn thấy.
func incrementIndex(part string) string {
	index, err := parseArrayIndex(part)
	if err != nil {
		return part
	}
	digits := ""
	for n := index + 1; n > 0; n /= 10 {
		digits = string(rune('0'+n%10)) + digits
	}
	if digits == "" {
		return "1"
	}
	return digits
}
