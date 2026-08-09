package api

import (
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestApplyJSONPatch(t *testing.T) {
	document := []byte(`{"basics":{"name":"Old"},"language":"en"}`)
	ops := json.RawMessage(`[{"op":"replace","path":"/basics/name","value":"New"},{"op":"add","path":"/basics/headline","value":"Engineer"}]`)
	updated, err := applyJSONPatch(document, ops)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(updated, &got); err != nil {
		t.Fatal(err)
	}
	basics := got["basics"].(map[string]any)
	if basics["name"] != "New" || basics["headline"] != "Engineer" {
		t.Fatalf("unexpected profile: %#v", got)
	}
}

func TestChatModelRefsResolveFromConfig(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	configPath := filepath.Join(filepath.Dir(filename), "../../../config.yml")
	t.Setenv("HR_CONFIG_PATH", configPath)
	cfg, err := loadChatRuntimeConfig()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		ref      string
		provider chatProviderConfig
		alias    string
	}{
		{ref: "local.reasoner", provider: cfg.Providers.Local, alias: "reasoner"},
		{ref: "openai.luna", provider: cfg.Providers.OpenAI, alias: "luna"},
		{ref: "deepseek.v4", provider: cfg.Providers.DeepSeek, alias: "v4"},
	}
	for _, tc := range cases {
		provider, alias, err := splitModelRef(tc.ref)
		if err != nil || alias != tc.alias {
			t.Fatalf("%s parsed as %s.%s: %v", tc.ref, provider, alias, err)
		}
		if !tc.provider.Enabled {
			t.Fatalf("%s is disabled in config.yml", tc.ref)
		}
		model, exists := tc.provider.Models[tc.alias]
		if !exists || model.ModelID == "" {
			t.Fatalf("%s is missing model_id in config.yml", tc.ref)
		}
	}
	if os.Getenv("HR_CONFIG_PATH") != configPath {
		t.Fatal("HR_CONFIG_PATH was not set for the config-backed routing test")
	}
}

func TestChatPromptUsesIntroduceForCVField(t *testing.T) {
	prompt := chatSystemPrompt()
	if !strings.Contains(prompt, "/basics/introduce") {
		t.Fatal("chat prompt must identify the CV introduction field")
	}
	if strings.Contains(prompt, "/basics/summary") {
		t.Fatal("chat prompt must not instruct the model to write the legacy CV summary field")
	}
}

// config.yml khai `redact_pii.required_local: true` và
// `never_send_raw_pii: true`. Người dùng chọn được `openai.luna` hoặc
// `deepseek.v4` trong bộ chọn model, nên prompt này đi thẳng ra cloud —
// gửi PII kèm theo là vi phạm, và là loại vi phạm không ném lỗi ở đâu cả.
func TestChatPromptNeverCarriesPIIToModel(t *testing.T) {
	profile := []byte(`{"schemaVersion":1,"language":"vi","basics":{` +
		`"name":"Nguyễn Văn A","email":"a@example.com","phone":"0901234567",` +
		`"location":"Hà Nội","dob":"1999-01-02","photo":"https://cdn.example/x.jpg",` +
		`"headline":"Kỹ sư AI","introduce":"Ba năm làm edge AI"},` +
		`"work":[{"org":"FPT","role":"Engineer","highlights":["Giảm 40% độ trễ"]}]}`)

	prompt := chatUserPrompt(profile, nil, "", "Viết lại phần giới thiệu")

	for _, pii := range []string{
		"Nguyễn Văn A", "a@example.com", "0901234567",
		"Hà Nội", "1999-01-02", "cdn.example",
	} {
		if strings.Contains(prompt, pii) {
			t.Fatalf("prompt gửi model còn chứa PII %q:\n%s", pii, prompt)
		}
	}

	// Che quá tay cũng là hỏng: model mất ngữ cảnh thì đề xuất vô dụng.
	for _, kept := range []string{"Kỹ sư AI", "Ba năm làm edge AI", "Giảm 40% độ trễ"} {
		if !strings.Contains(prompt, kept) {
			t.Fatalf("prompt mất nội dung phi-PII %q:\n%s", kept, prompt)
		}
	}
}

// Model trả JSON Pointer trỏ vào hồ sơ thật. Nếu che PII bằng cách xoá luôn
// khoá `basics`, mọi con trỏ `/basics/...` model sinh ra đều trỏ vào hư không
// — đúng lỗi mà redactKeepShape() bên TypeScript đã ghi lại.
func TestRedactProfileForModelKeepsPointerShape(t *testing.T) {
	profile := []byte(`{"basics":{"name":"Ada","email":"ada@example.com","headline":"CTO"},"skills":[{"name":"Go"}]}`)

	redacted := redactProfileForModel(profile)

	var got map[string]any
	if err := json.Unmarshal(redacted, &got); err != nil {
		t.Fatalf("kết quả che PII không còn là JSON hợp lệ: %v", err)
	}
	basics, ok := got["basics"].(map[string]any)
	if !ok {
		t.Fatalf("khoá basics phải còn lại để con trỏ /basics/... có nghĩa: %s", redacted)
	}
	if _, leaked := basics["name"]; leaked {
		t.Fatalf("basics.name vẫn còn: %s", redacted)
	}
	if basics["headline"] != "CTO" {
		t.Fatalf("field phi-PII trong basics bị xoá nhầm: %s", redacted)
	}
	if len(got["skills"].([]any)) != 1 {
		t.Fatalf("mục ngoài basics phải giữ nguyên: %s", redacted)
	}
}

// Hồ sơ hỏng không được biến thành đường vòng đưa PII ra ngoài: parse thất bại
// thì trả rỗng chứ không trả lại nguyên bản.
func TestRedactProfileForModelFailsClosedOnInvalidJSON(t *testing.T) {
	if got := redactProfileForModel([]byte(`{"basics":{"email":"a@example.com"`)); len(got) != 0 {
		t.Fatalf("JSON hỏng phải trả rỗng, nhận: %s", got)
	}
}

func TestApplyJSONPatchRejectsMissingPath(t *testing.T) {
	_, err := applyJSONPatch([]byte(`{"basics":{}}`), []byte(`[{"op":"replace","path":"/missing","value":true}]`))
	if err == nil {
		t.Fatal("expected invalid patch error")
	}
}

func TestParseChatModelOutputPatch(t *testing.T) {
	got := parseChatModelOutput("```json\n{\"kind\":\"patch\",\"summary\":\"Nhóm skills\",\"ops\":[{\"op\":\"add\",\"path\":\"/skills/0/group\",\"value\":\"MLOps\",\"rationale\":\"Dễ quét hơn\",\"grounding\":{\"type\":\"existing_field\",\"ref\":\"/skills/0\"},\"kbRefs\":[]}]}\n```")
	if got.Kind != "patch" || len(got.Ops) != 1 || got.Summary != "Nhóm skills" {
		t.Fatalf("unexpected parsed proposal: %#v", got)
	}
}

func TestValidateChatProposalUsesProfileSkillShape(t *testing.T) {
	profile := []byte(`{"skills":[{"name":"Python"},{"name":"Redis"}]}`)
	valid := []json.RawMessage{json.RawMessage(`{"op":"add","path":"/skills/0/group","value":"Data","rationale":"Nhóm rõ hơn","grounding":{"type":"existing_field","ref":"/skills/0"},"kbRefs":[]}`)}
	if err := validateChatProposal(profile, valid); err != nil {
		t.Fatal(err)
	}
	invalid := []json.RawMessage{json.RawMessage(`{"op":"replace","path":"/skills/0","value":{"category":"Data","items":["Python"]},"rationale":"Đổi nhóm","grounding":{"type":"existing_field","ref":"/skills/0"},"kbRefs":[]}`)}
	if err := validateChatProposal(profile, invalid); err == nil {
		t.Fatal("expected category/items shape to be rejected")
	}
}

func TestCancelJob(t *testing.T) {
	s := NewServer()
	s.jobs["job-1"] = &Job{ID: "job-1", Kind: "parse_cv", Status: "queued", CreatedAt: time.Now()}
	r := httptest.NewRequest(http.MethodDelete, "/api/jobs/job-1", nil)
	w := httptest.NewRecorder()
	s.Routes().ServeHTTP(w, r)
	if w.Code != http.StatusOK || s.jobs["job-1"].Status != "cancelled" {
		t.Fatalf("cancel status=%d job=%s", w.Code, s.jobs["job-1"].Status)
	}
}

func TestHealth(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("health status = %d", w.Code)
	}
}

func TestExportRouteIsRegisteredInGoAPI(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv/00000000-0000-0000-0000-000000000000/export?variant=ats", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("export route status = %d, want %d when PostgreSQL is unavailable", w.Code, http.StatusServiceUnavailable)
	}
}

func TestUploadCreatesFreshJobForEachUploadID(t *testing.T) {
	s := NewServer()
	for _, id := range []string{"upload-a", "upload-b"} {
		var body strings.Builder
		mw := multipart.NewWriter(&body)
		_ = mw.WriteField("uploadId", id)
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", `form-data; name="file"; filename="cv.pdf"`)
		h.Set("Content-Type", "application/pdf")
		part, err := mw.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte("%PDF-1.7"))
		_ = mw.Close()

		r := httptest.NewRequest(http.MethodPost, "/api/uploads/cv", strings.NewReader(body.String()))
		r.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		s.Routes().ServeHTTP(w, r)
		if w.Code != http.StatusAccepted {
			t.Fatalf("upload status = %d", w.Code)
		}
	}
	if len(s.jobs) != 2 {
		t.Fatalf("jobs = %d, want 2", len(s.jobs))
	}
}

func TestReviewContractMatchesVerifiedPaths(t *testing.T) {
	profile := map[string]any{
		"basics":    map[string]any{"name": "Ada"},
		"education": []any{map[string]any{"school": "MIT"}},
		"skills":    []any{map[string]any{"name": "Go"}},
		"languages": []any{map[string]any{"name": "English"}},
		"_meta":     map[string]any{"verified": map[string]any{"/basics": true, "/education/0": true}},
	}
	items, progress := reviewContract(profile)
	if len(items) != 4 || progress["done"] != 2 || progress["complete"] != false {
		t.Fatalf("items=%d progress=%#v", len(items), progress)
	}
	if got := progress["pending"].([]string); len(got) != 2 || got[0] != "/skills" || got[1] != "/languages" {
		t.Fatalf("pending=%#v", got)
	}
}

func TestCVListItemOmitsEmptyJDTitle(t *testing.T) {
	at := time.Date(2026, 8, 9, 10, 30, 0, 0, time.UTC)

	withJD := cvListItem("cv-1", "CV Backend", at, "Junior Go Developer")
	if withJD["jdTitle"] != "Junior Go Developer" {
		t.Fatalf("jdTitle = %#v, want the job title", withJD["jdTitle"])
	}
	if withJD["updatedAt"] != "2026-08-09T10:30:00Z" {
		t.Fatalf("updatedAt = %#v, want RFC3339 in UTC", withJD["updatedAt"])
	}

	// CV không gắn tin tuyển dụng nào thì KHÔNG được có khoá jdTitle rỗng:
	// giao diện phân biệt "không gắn JD" bằng sự vắng mặt của khoá này.
	plain := cvListItem("cv-2", "CV chung", at, "")
	if _, exists := plain["jdTitle"]; exists {
		t.Fatalf("jdTitle must be absent when the CV has no job description: %#v", plain)
	}
}

func TestCVListRouteIsRegistered(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /api/cv status = %d, want %d when PostgreSQL is unavailable", w.Code, http.StatusServiceUnavailable)
	}
}

func TestAuthSessionReportsAnonymousWithoutCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("session status = %d, want 200 — the SPA asks this on every page load", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["authenticated"] != false {
		t.Fatalf("authenticated = %#v, want false", body["authenticated"])
	}
	if _, leaked := body["email"]; leaked {
		t.Fatalf("anonymous session must not carry an email: %#v", body)
	}
}
