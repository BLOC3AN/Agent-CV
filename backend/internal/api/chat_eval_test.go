package api

// Bộ đo chất lượng đầu ra của model chat trên prompt hiện tại.
//
// Nó KHÔNG phải test hồi quy: nó gọi model thật nên chậm, tốn, và kết quả dao
// động giữa các lần chạy. Vì vậy nó tự bỏ qua trừ khi được bật rõ ràng.
//
//	CHAT_EVAL=1 HR_CONFIG_PATH=../../../config.yml MODEL_HOST=http://... \
//	  go test ./internal/api/ -run TestChatModelEval -v -timeout 30m
//
// Câu hỏi nó trả lời: output hỏng vì CẮT NGẮN hay vì model không theo luật?
// Hai nguyên nhân đó đòi hai cách chữa trái ngược nhau — nâng trần token, hay
// tách prompt thành hai lượt — nên đoán sai là làm sai kiến trúc.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Hồ sơ cố ý ở trạng thái thường gặp nhất của người dùng thật: junior, bullet
// mô tả nhiệm vụ chứ không có kết quả đo được, phần giới thiệu chung chung. Đó
// là hồ sơ mà năm trục hỏi và luật viết bullet có việc để làm.
const evalProfileJSON = `{
  "schemaVersion": 2,
  "id": "cv-eval-1",
  "title": "CV Backend Developer",
  "lastModified": "2026-08-14T00:00:00.000Z",
  "language": "vi",
  "sections": {
    "intro": {
      "fullName": "Trần Minh Quân",
      "email": "quan.tran@example.com",
      "phone": "0912345678",
      "location": "TP. Hồ Chí Minh",
      "title": "Backend Developer",
      "summary": "Lập trình viên backend, ham học hỏi, mong muốn phát triển sự nghiệp trong môi trường chuyên nghiệp.",
      "careerObjective": "Trở thành kỹ sư backend giỏi."
    },
    "experience": [
      {
        "id": "exp1",
        "title": "Backend Developer",
        "company": "Công ty TNHH Giải pháp ABC",
        "startDate": "2024-03",
        "current": true,
        "techStack": ["Go", "PostgreSQL", "Redis"],
        "highlights": [
          "Phát triển API cho hệ thống quản lý đơn hàng.",
          "Tham gia sửa lỗi và bảo trì hệ thống.",
          "Làm việc với team frontend để tích hợp API."
        ]
      }
    ],
    "projects": [
      {
        "id": "prj1",
        "name": "Hệ thống đặt lịch khám",
        "role": "Backend",
        "startDate": "2023-09",
        "endDate": "2023-12",
        "techStack": ["Node.js", "MongoDB"],
        "highlights": [
          "Xây dựng chức năng đặt lịch và nhắc lịch.",
          "Viết tài liệu API cho nhóm."
        ]
      }
    ],
    "education": [
      {
        "id": "edu1",
        "school": "Đại học Công nghệ Thông tin",
        "degree": "Kỹ sư",
        "fieldOfStudy": "Kỹ thuật phần mềm",
        "startDate": "2019-09",
        "endDate": "2023-06",
        "gpa": "3.1"
      }
    ],
    "skills": [
      {"id": "sk1", "category": "Ngôn ngữ", "skills": ["Go", "JavaScript"]},
      {"id": "sk2", "category": "Cơ sở dữ liệu", "skills": ["PostgreSQL", "MongoDB"]}
    ]
  }
}`

type evalCase struct {
	name     string
	language string
	message  string
	// expect là nhánh ta MONG ĐỢI, không phải nhánh bắt buộc. Model chọn khác
	// chưa chắc đã sai, nhưng lệch nhiều thì prompt đang dẫn sai hướng.
	expect string
}

var evalCases = []evalCase{
	{"sua-mot-bullet", "vi", "Viết lại gạch đầu dòng đầu tiên của phần kinh nghiệm cho mạnh hơn.", "patch"},
	{"them-mot-ky-nang", "vi", "Thêm Docker vào nhóm kỹ năng Ngôn ngữ.", "patch"},
	{"thieu-du-lieu", "vi", "Làm phần giới thiệu của tôi nổi bật hơn hẳn các ứng viên khác.", "clarify"},
	{"chi-hoi", "vi", "CV của tôi đang yếu ở chỗ nào?", "reply"},
	{"nguoi-dung-go-tieng-anh", "vi", "Rewrite my project bullets so they show impact.", "patch"},
	{"yeu-cau-rong", "vi", "Viết lại toàn bộ CV của tôi cho chuẩn tập đoàn đa quốc gia.", "patch"},
}

type evalRun struct {
	Case      string `json:"case"`
	Rep       int    `json:"rep"`
	LatencyMs int64  `json:"latencyMs"`
	RawBytes  int    `json:"rawBytes"`
	Kind      string `json:"kind"`
	Ops       int    `json:"ops"`
	Rejected  string `json:"rejected,omitempty"`
	ReplyLang string `json:"replyLang,omitempty"`
	Truncated bool   `json:"truncated"`
	Err       string `json:"err,omitempty"`
}

var vietnameseLetters = regexp.MustCompile(`[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]`)

func TestChatModelEval(t *testing.T) {
	if os.Getenv("CHAT_EVAL") == "" {
		t.Skip("đặt CHAT_EVAL=1 để chạy — bộ đo này gọi model thật")
	}
	reps := 3
	if v := os.Getenv("CHAT_EVAL_REPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			t.Fatalf("CHAT_EVAL_REPS không hợp lệ: %q", v)
		}
		reps = n
	}
	modelRef := os.Getenv("CHAT_EVAL_MODEL")
	if modelRef == "" {
		modelRef = "local.reasoner"
	}

	profile := []byte(evalProfileJSON)
	layout := []byte(orderedRevisionLayout())

	// Dụng cụ đo phải tự kiểm trước khi đo. Fixture hỏng thì validator từ chối
	// MỌI đề xuất, và bảng kết quả sẽ đổ lỗi cho model một cách rất thuyết phục.
	if _, err := normalizeCommittedCV(profile, layout); err != nil {
		t.Fatalf("fixture hồ sơ không hợp lệ (%v) — mọi lượt sẽ bị từ chối vì lý do này chứ không phải vì model", err)
	}
	if _, err := validateCVLayout(layout); err != nil {
		t.Fatalf("fixture layout không hợp lệ: %v", err)
	}

	runs := make([]evalRun, 0, len(evalCases)*reps)
	for _, tc := range evalCases {
		for rep := 1; rep <= reps; rep++ {
			runs = append(runs, runEvalCase(t, tc, rep, modelRef, profile, layout))
		}
	}

	reportEval(t, runs, modelRef, reps)
}

func runEvalCase(t *testing.T, tc evalCase, rep int, modelRef string, profile, layout []byte) evalRun {
	t.Helper()
	messages := []map[string]string{
		{"role": "system", "content": chatSystemPrompt(tc.language)},
		{"role": "user", "content": chatUserPrompt(profile, nil, nil, "", tc.message)},
	}
	// Trần thời gian rộng tay: mục đích là đo chất lượng, một lượt chậm vẫn là
	// dữ liệu, còn timeout ngắn biến nó thành số 0 giả.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	started := time.Now()
	answer, err := callChatModel(ctx, messages, modelRef)
	run := evalRun{Case: tc.name, Rep: rep, LatencyMs: time.Since(started).Milliseconds(), RawBytes: len(answer)}
	if err != nil {
		run.Kind, run.Err = "error", err.Error()
		t.Logf("%-24s rep%d  LỖI GỌI MODEL: %v", tc.name, rep, err)
		return run
	}

	out := parseChatModelOutput(answer)
	run.Kind = out.Kind
	// Đây là dấu hiệu phân biệt hai nguyên nhân hỏng: JSON bị cắt thì phần đuôi
	// không đóng ngoặc, còn model đi sai luật thì nó vẫn đóng ngoặc đầy đủ.
	if out.Kind == "unparsable" {
		run.Truncated = !strings.HasSuffix(strings.TrimSpace(answer), "}")
	}
	switch out.Kind {
	case "patch":
		run.Ops = len(out.Ops)
		// Ngôn ngữ của summary cũng là ngôn ngữ người dùng đọc — nhánh patch
		// chiếm phần lớn lưu lượng nên bỏ qua nó là bỏ qua chỗ dễ sai nhất.
		run.ReplyLang = detectLanguage(out.Summary)
		if err := validateChatProposalDocuments(profile, layout, out.Ops); err != nil {
			run.Rejected = err.Error()
		}
	case "reply":
		run.ReplyLang = detectLanguage(out.Text)
	case "clarify":
		run.ReplyLang = detectLanguage(string(out.Request))
	}

	// Số liệu tổng hợp không nói được model đã ĐỀ XUẤT GÌ. Giữ lại output thô để
	// còn đọc được bằng mắt — đó là chỗ duy nhất thấy được model có bịa hay không.
	if dir := os.Getenv("CHAT_EVAL_DUMP"); dir != "" {
		name := fmt.Sprintf("%s/%s.rep%d.json", dir, tc.name, rep)
		if err := os.WriteFile(name, []byte(answer), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	t.Logf("%-24s rep%d  %-11s %5dms %6dB ops=%-2d %s%s",
		tc.name, rep, run.Kind, run.LatencyMs, run.RawBytes, run.Ops,
		run.ReplyLang, truncatedNote(run))
	return run
}

func truncatedNote(run evalRun) string {
	notes := make([]string, 0, 2)
	if run.Truncated {
		notes = append(notes, "CẮT-NGẮN")
	}
	if run.Rejected != "" {
		notes = append(notes, "TỪ-CHỐI: "+run.Rejected)
	}
	if len(notes) == 0 {
		return ""
	}
	return "  " + strings.Join(notes, " | ")
}

func detectLanguage(text string) string {
	if vietnameseLetters.MatchString(text) {
		return "vi"
	}
	return "en?"
}

func reportEval(t *testing.T, runs []evalRun, modelRef string, reps int) {
	t.Helper()

	byKind := map[string]int{}
	rejected, truncated, opsOverCap := 0, 0, 0
	var totalLatency int64
	maxBytes := 0
	for _, r := range runs {
		byKind[r.Kind]++
		totalLatency += r.LatencyMs
		if r.Rejected != "" {
			rejected++
		}
		if r.Truncated {
			truncated++
		}
		if r.Ops > 20 {
			opsOverCap++
		}
		if r.RawBytes > maxBytes {
			maxBytes = r.RawBytes
		}
	}

	kinds := make([]string, 0, len(byKind))
	for k := range byKind {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)

	t.Log(strings.Repeat("─", 72))
	t.Logf("model=%s  lượt=%d (%d case × %d rep)", modelRef, len(runs), len(evalCases), reps)
	for _, k := range kinds {
		t.Logf("  kind %-11s %d", k, byKind[k])
	}
	t.Logf("  bị validator từ chối   %d/%d", rejected, len(runs))
	t.Logf("  output bị cắt ngắn     %d/%d", truncated, len(runs))
	t.Logf("  vượt trần 20 ops       %d/%d", opsOverCap, len(runs))
	t.Logf("  độ trễ trung bình      %dms", totalLatency/int64(len(runs)))
	t.Logf("  output dài nhất        %d byte", maxBytes)
	t.Log(strings.Repeat("─", 72))

	// unparsable KHÔNG kèm dấu cắt ngắn nghĩa là model đóng ngoặc đầy đủ mà vẫn
	// sai hình — đó mới là lúc tách prompt thành hai lượt có lý.
	if byKind["unparsable"] > 0 && truncated == 0 {
		t.Log("KẾT LUẬN: output hỏng mà KHÔNG bị cắt → model không theo được hợp đồng, nâng trần token vô ích")
	} else if truncated > 0 {
		t.Log("KẾT LUẬN: output hỏng vì bị CẮT NGẮN → nâng max_output hoặc siết độ dài rationale, đừng tách lượt")
	}

	if path := os.Getenv("CHAT_EVAL_OUT"); path != "" {
		blob, err := json.MarshalIndent(runs, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, blob, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("kết quả thô: %s", path)
	}

	if n := byKind["error"]; n == len(runs) {
		t.Fatalf("mọi lượt đều lỗi gọi model — bộ đo không chạy được, đừng đọc số ở trên")
	} else if n > 0 {
		t.Errorf("%d/%d lượt lỗi gọi model", n, len(runs))
	}
}
