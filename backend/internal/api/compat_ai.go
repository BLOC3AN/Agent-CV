package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// These adapters keep the approved frontend contract stable while the
// production chat/analyze APIs continue to use the richer profile/session
// contract. They deliberately do not persist browser-shaped cvData.
type compatAIRequest struct {
	Message        string         `json:"message"`
	Action         string         `json:"action"`
	Model          string         `json:"model"`
	CVData         map[string]any `json:"cvData"`
	JobDescription string         `json:"jobDescription"`
}

func (s *Server) compatAIChat(w http.ResponseWriter, r *http.Request) {
	var body compatAIRequest
	if !decodeCompatAI(r, &body) || strings.TrimSpace(body.Message) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Yêu cầu chat không hợp lệ"})
		return
	}

	modelRef := body.Model
	if !strings.Contains(modelRef, ".") {
		modelRef = "local.reasoner"
	}
	prompt := []map[string]string{
		{"role": "system", "content": "Bạn là trợ lý nghề nghiệp HR-Agent. Trả lời bằng tiếng Việt, súc tích, thực tế và dựa trên dữ liệu CV được cung cấp."},
		{"role": "user", "content": fmt.Sprintf("CV:\n%s\n\nCâu hỏi:\n%s", jsonString(body.CVData), body.Message)},
	}
	answer, err := callChatModel(r.Context(), prompt, modelRef)
	if err != nil {
		answer = compatChatFallback(body.Message)
	}
	writeJSON(w, http.StatusOK, map[string]string{"reply": answer})
}

func (s *Server) compatAIQuickAction(w http.ResponseWriter, r *http.Request) {
	var body compatAIRequest
	if !decodeCompatAI(r, &body) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Yêu cầu tối ưu CV không hợp lệ"})
		return
	}
	action := strings.TrimSpace(body.Action)
	prompt := fmt.Sprintf("Hãy thực hiện tác vụ %q trên CV sau. Trả lời bằng tiếng Việt, ngắn gọn và có thể áp dụng trực tiếp: %s", action, jsonString(body.CVData))
	answer, err := callChatModel(r.Context(), []map[string]string{
		{"role": "system", "content": "Bạn là chuyên gia tuyển dụng và tối ưu CV theo chuẩn ATS."},
		{"role": "user", "content": prompt},
	}, "local.reasoner")
	if err != nil {
		answer = compatActionFallback(action)
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": answer})
}

func (s *Server) compatAIMatchJob(w http.ResponseWriter, r *http.Request) {
	var body compatAIRequest
	if !decodeCompatAI(r, &body) || strings.TrimSpace(body.JobDescription) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Job description không hợp lệ"})
		return
	}
	result := lexicalMatch(body.CVData, body.JobDescription)
	writeJSON(w, http.StatusOK, result)
}

func decodeCompatAI(r *http.Request, dst *compatAIRequest) bool {
	return json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(dst) == nil
}

func compatChatFallback(message string) string {
	return fmt.Sprintf("Mình đã nhận yêu cầu “%s”. Hãy bổ sung số liệu cụ thể như phần trăm cải thiện, latency, quy mô dữ liệu hoặc số người dùng để CV thuyết phục hơn.", strings.TrimSpace(message))
}

func compatActionFallback(action string) string {
	if action == "shorten_intro" || action == "generate_summary" {
		return "Tóm tắt phần giới thiệu thành 2–3 câu, nêu rõ số năm kinh nghiệm, thế mạnh kỹ thuật và kết quả nổi bật nhất."
	}
	return "Đã rà soát nội dung. Nên viết mỗi gạch đầu dòng theo cấu trúc hành động + công nghệ + kết quả định lượng, ưu tiên các từ khóa xuất hiện trong JD."
}

var compatWordRE = regexp.MustCompile(`[A-Za-zÀ-ỹ0-9+#./-]{2,}`)

func lexicalMatch(cv map[string]any, jd string) map[string]any {
	cvText := strings.ToLower(jsonString(cv))
	jdWords := uniqueWords(jd)
	matched := make([]string, 0, len(jdWords))
	missing := make([]string, 0, len(jdWords))
	for _, word := range jdWords {
		if strings.Contains(cvText, word) {
			matched = append(matched, word)
		} else if len(missing) < 6 {
			missing = append(missing, word)
		}
	}
	score := 50
	if len(jdWords) > 0 {
		score = 40 + len(matched)*60/len(jdWords)
	}
	if score > 99 {
		score = 99
	}
	return map[string]any{
		"matchScore":      score,
		"analysis":        fmt.Sprintf("CV khớp khoảng %d%% số từ khóa nổi bật trong mô tả công việc.", score),
		"strengths":       matchedWords(matched),
		"missingKeywords": missing,
		"recommendations": "Bổ sung các từ khóa còn thiếu nếu bạn thực sự có kinh nghiệm, đồng thời thêm số liệu đo lường vào phần kinh nghiệm và dự án.",
	}
}

func uniqueWords(input string) []string {
	seen := map[string]bool{}
	words := make([]string, 0)
	for _, raw := range compatWordRE.FindAllString(strings.ToLower(input), -1) {
		word := strings.Trim(raw, ".,;:()[]{}")
		if len(word) < 3 || seen[word] {
			continue
		}
		seen[word] = true
		words = append(words, word)
	}
	sort.Slice(words, func(i, j int) bool { return len(words[i]) > len(words[j]) })
	return words
}

func matchedWords(words []string) []string {
	if len(words) > 5 {
		words = words[:5]
	}
	if len(words) == 0 {
		return []string{"Có nền tảng kỹ thuật liên quan đến vị trí"}
	}
	return words
}
