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
	document := []byte(`{"sections":{"intro":{"fullName":"Old"}},"language":"en"}`)
	ops := json.RawMessage(`[{"op":"replace","path":"/sections/intro/fullName","value":"New"},{"op":"add","path":"/sections/intro/title","value":"Engineer"}]`)
	updated, err := applyJSONPatch(document, ops)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(updated, &got); err != nil {
		t.Fatal(err)
	}
	intro := got["sections"].(map[string]any)["intro"].(map[string]any)
	if intro["fullName"] != "New" || intro["title"] != "Engineer" {
		t.Fatalf("unexpected profile: %#v", got)
	}
}

func TestSelectChatProposalOpsReturnsStructuredOpsWithoutApplyingThem(t *testing.T) {
	all := []json.RawMessage{
		json.RawMessage(`{"op":"replace","path":"/sections/intro/fullName","value":"New"}`),
		json.RawMessage(`{"op":"add","path":"/sections/intro/title","value":"Engineer"}`),
	}

	selected, accepted, rejected, err := selectChatProposalOps(all, []int{1})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 1 || string(selected[0]) != string(all[1]) {
		t.Fatalf("unexpected selected ops: %s", jsonRawArray(selected))
	}
	if !equalIntSlices(accepted, []int{1}) || !equalIntSlices(rejected, []int{0}) {
		t.Fatalf("unexpected audit indices: accepted=%v rejected=%v", accepted, rejected)
	}
	// Selection is deliberately only serialization/validation. Applying the
	// returned ops is the SPA draft's responsibility; this helper must not need
	// or mutate a profile document.
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
	prompt := chatSystemPrompt("vi")
	if !strings.Contains(prompt, "/sections/intro/summary") {
		t.Fatal("chat prompt must identify the v2 introduction field")
	}
}

// Prompt production phải dạy đúng đường dẫn của CV v2 và giữ được tính năng nhắm vào
// từng gạch đầu dòng — đó là điều kiện để màn duyệt diff còn gì đáng duyệt.

func TestChatSystemPromptUsesSectionPointers(t *testing.T) {
	prompt := chatSystemPrompt("vi")
	if !strings.Contains(prompt, "/sections/intro/summary") {
		t.Fatal("prompt phải dạy đường dẫn giới thiệu của v2")
	}
	if !strings.Contains(prompt, "/sections/experience/0/highlights/") {
		t.Fatal("prompt phải chỉ rõ cách nhắm vào một gạch đầu dòng")
	}
}

func TestChatSystemPromptV2SupportsClarifyWithoutInventingFacts(t *testing.T) {
	if !strings.Contains(chatSystemPrompt("vi"), `"kind":"clarify"`) {
		t.Fatal("v2 prompt must support clarify responses")
	}
	out := parseChatModelOutput(`{"kind":"clarify","request":{"reason":"Cần số liệu","targetPath":null,"questions":[{"id":"metric","question":"Có bao nhiêu user?"}]}}`)
	if out.Kind != "clarify" || len(out.Request) == 0 {
		t.Fatalf("unexpected clarify output: %#v", out)
	}
}

func TestChatUserPromptIncludesAnswers(t *testing.T) {
	prompt := chatUserPrompt([]byte(`{"sections":{"intro":{"summary":"Engineer"}}}`), nil, []map[string]string{{"question": "Có số liệu không?", "answer": "Không có"}}, "", "Viết lại")
	if !strings.Contains(prompt, "Không có") {
		t.Fatalf("answers missing from prompt: %s", prompt)
	}
}

// V2 không được để PII lọt ra prompt. Prompt phải giữ lại title, summary,
// website và metadata nghề nghiệp cho model
// có ngữ cảnh để đề xuất có ý nghĩa.
func TestChatPromptNeverCarriesPIIToModelForV2(t *testing.T) {
	profile := []byte(`{
		"schemaVersion":2,"language":"vi",
		"sections":{
			"intro":{
				"fullName":"Nguyễn Văn A","email":"a@example.com","phone":"0901234567",
				"location":"Hà Nội","avatarUrl":"https://cdn.example/avatar.jpg",
				"title":"Kỹ sư AI","summary":"Ba năm làm edge AI","website":"https://ada.dev"
			}
		},
		"_meta":{
			"canonical":{"Node.js":"nodejs","TypeScript":"typescript"},
			"verified":{"\/sections\/intro\/fullName":true},
			"source":"manual"
		}
	}`)

	prompt := chatUserPrompt(profile, nil, nil, "", "Viết lại phần giới thiệu")

	// PII từ sections.intro không được lọt ra
	for _, pii := range []string{
		"Nguyễn Văn A", "a@example.com", "0901234567", // sections.intro PII
		"Hà Nội", "cdn.example/avatar.jpg", // sections.intro PII
		// canonical là dữ liệu matching, không phải PII
	} {
		if strings.Contains(prompt, pii) {
			t.Fatalf("prompt gửi model còn chứa PII %q:\n%s", pii, prompt)
		}
	}

	// Nội dung nghề nghiệp, metadata matching và trạng thái xác nhận phải còn lại
	for _, kept := range []string{
		"Kỹ sư AI", "Ba năm làm edge AI", "https://ada.dev", // title, summary, website
		"nodejs", "typescript", // canonical
		"manual", // _meta.source
	} {
		if !strings.Contains(prompt, kept) {
			t.Fatalf("prompt mất nội dung phi-PII %q:\n%s", kept, prompt)
		}
	}
}

// Model trả JSON Pointer trỏ vào hồ sơ thật. Nếu che PII bằng cách xoá luôn
// `sections.intro`, mọi con trỏ `/sections/intro/...` model sinh ra đều trỏ
// vào hư không.
func TestRedactProfileForModelKeepsPointerShape(t *testing.T) {
	profile := []byte(`{"schemaVersion":2,"sections":{"intro":{"fullName":"Ada","email":"ada@example.com","title":"CTO"},"skills":[{"id":"skills-0","category":"Language","skills":["Go"]}]}}`)

	redacted := redactProfileForModel(profile)

	var got map[string]any
	if err := json.Unmarshal(redacted, &got); err != nil {
		t.Fatalf("kết quả che PII không còn là JSON hợp lệ: %v", err)
	}
	sections, ok := got["sections"].(map[string]any)
	if !ok {
		t.Fatalf("khoá sections phải còn lại để con trỏ /sections/... có nghĩa: %s", redacted)
	}
	intro, ok := sections["intro"].(map[string]any)
	if !ok {
		t.Fatalf("sections.intro phải còn lại: %s", redacted)
	}
	if _, leaked := intro["fullName"]; leaked {
		t.Fatalf("sections.intro.fullName vẫn còn: %s", redacted)
	}
	if intro["title"] != "CTO" || len(sections["skills"].([]any)) != 1 {
		t.Fatalf("nội dung phi-PII bị xoá nhầm: %s", redacted)
	}
}

// Hồ sơ hỏng không được biến thành đường vòng đưa PII ra ngoài: parse thất bại
// thì trả rỗng chứ không trả lại nguyên bản.
func TestRedactProfileForModelFailsClosedOnInvalidJSON(t *testing.T) {
	if got := redactProfileForModel([]byte(`{"sections":{"intro":{"email":"a@example.com"}`)); len(got) != 0 {
		t.Fatalf("JSON hỏng phải trả rỗng, nhận: %s", got)
	}
}

func TestApplyJSONPatchRejectsMissingPath(t *testing.T) {
	_, err := applyJSONPatch([]byte(`{"sections":{"intro":{}}}`), []byte(`[{"op":"replace","path":"/missing","value":true}]`))
	if err == nil {
		t.Fatal("expected invalid patch error")
	}
}

func TestParseChatModelOutputPatch(t *testing.T) {
	got := parseChatModelOutput(`{"kind":"patch","summary":"Nhóm skills","ops":[{"op":"add","path":"/sections/skills/0/category","value":"MLOps","rationale":"Dễ quét hơn","grounding":{"type":"existing_field","ref":"/sections/skills/0"},"kbRefs":[]}]}`)
	if got.Kind != "patch" || len(got.Ops) != 1 || got.Summary != "Nhóm skills" {
		t.Fatalf("unexpected parsed proposal: %#v", got)
	}
}

// v2 gom skills theo category: sections.skills[i] = {category, skills:[string]}.
// Skills V2 được gom theo category và phải giữ đúng hình dạng của nhóm.
func TestValidateChatProposalUsesV2SkillShape(t *testing.T) {
	profile := []byte(`{"sections":{"skills":[{"category":"Ngôn ngữ","skills":["Go"]}]}}`)

	valid := []json.RawMessage{json.RawMessage(`{"op":"add","path":"/sections/skills/0/skills/-","value":"Python","rationale":"Thêm kỹ năng mới nhắc trong tin nhắn","grounding":{"type":"user_message","ref":"tin nhắn người dùng"},"kbRefs":[]}`)}
	if err := validateChatProposal(profile, valid); err != nil {
		t.Fatal(err)
	}

	// Sai tên field: "items" thay vì "skills" — chốt chặn cấu trúc sau patch phải bắt được.
	wrongShape := []json.RawMessage{json.RawMessage(`{"op":"replace","path":"/sections/skills/0","value":{"category":"Data","items":["Python"]},"rationale":"Đổi nhóm kỹ năng","grounding":{"type":"existing_field","ref":"/sections/skills/0"},"kbRefs":[]}`)}
	if err := validateChatProposal(profile, wrongShape); err == nil {
		t.Fatal("expected category/items shape to be rejected for v2")
	}

	// Field lạ ở độ sâu con trỏ — không phải category cũng không phải skills.
	unknownField := []json.RawMessage{json.RawMessage(`{"op":"add","path":"/sections/skills/0/label","value":"Ưu tiên","rationale":"Đánh dấu nhóm ưu tiên","grounding":{"type":"user_message","ref":"tin nhắn người dùng"},"kbRefs":[]}`)}
	if err := validateChatProposal(profile, unknownField); err == nil {
		t.Fatal("expected unknown sections/skills field to be rejected")
	}
}

func TestValidateChatProposalDocumentsValidatesProfileAndLayoutSeparately(t *testing.T) {
	profile := validRevisionCV("Draft", "User")
	layout := orderedRevisionLayout()
	var layoutValue map[string]any
	if err := json.Unmarshal(layout, &layoutValue); err != nil {
		t.Fatal(err)
	}
	nodes := layoutValue["nodes"].([]any)
	nodes[0], nodes[1] = nodes[1], nodes[0]
	reorder, _ := json.Marshal(map[string]any{"op": "replace", "path": "/layout/nodes", "value": nodes, "rationale": "Reorder sections", "grounding": map[string]any{"type": "user_message", "ref": "request"}})
	valid := []json.RawMessage{
		json.RawMessage(`{"op":"replace","path":"/sections/intro/summary","value":"Updated","rationale":"Clarify summary","grounding":{"type":"user_message","ref":"request"}}`),
		json.RawMessage(`{"op":"replace","path":"/layout/nodes/0/visible","value":false,"rationale":"Hide header","grounding":{"type":"user_message","ref":"request"}}`),
		reorder,
	}
	if err := validateChatProposalDocuments(profile, layout, valid); err != nil {
		t.Fatal(err)
	}
	invalidSection := []json.RawMessage{json.RawMessage(`{"op":"replace","path":"/sections/intro","value":false,"rationale":"Break intro","grounding":{"type":"user_message","ref":"request"}}`)}
	if err := validateChatProposalDocuments(profile, layout, invalidSection); err == nil {
		t.Fatal("expected invalid intro section to be rejected")
	}
	invalidItem := []json.RawMessage{json.RawMessage(`{"op":"add","path":"/sections/skills/-","value":{"id":"skills-1","category":"Data","skills":[7]},"rationale":"Break skills","grounding":{"type":"user_message","ref":"request"}}`)}
	if err := validateChatProposalDocuments(profile, layout, invalidItem); err == nil {
		t.Fatal("expected invalid skill item to be rejected")
	}
	invalidLayout := []json.RawMessage{json.RawMessage(`{"op":"replace","path":"/layout/nodes/0","value":{"id":"header","type":"unknown","visible":true},"rationale":"Break layout","grounding":{"type":"user_message","ref":"request"}}`)}
	if err := validateChatProposalDocuments(profile, layout, invalidLayout); err == nil {
		t.Fatal("expected invalid layout to be rejected")
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
		"schemaVersion": 2,
		"sections": map[string]any{
			"intro":     map[string]any{"fullName": "Ada"},
			"education": []any{map[string]any{"school": "MIT"}},
			"skills":    []any{map[string]any{"category": "Skills"}},
			"languages": []any{map[string]any{"language": "English"}},
		},
		"_meta": map[string]any{"verified": map[string]any{"/sections/intro": true, "/sections/education/0": true}},
	}
	items, progress := reviewContract(profile)
	if len(items) != 4 || progress["done"] != 2 || progress["complete"] != false {
		t.Fatalf("items=%d progress=%#v", len(items), progress)
	}
	if got := progress["pending"].([]string); len(got) != 2 || got[0] != "/sections/skills" || got[1] != "/sections/languages" {
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

// Không có header vẫn giữ mã trạng thái ổn định khi PostgreSQL chưa có.
func TestGetCVWithoutHeaderKeepsServiceUnavailable(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv/00000000-0000-0000-0000-000000000000", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d khi chưa có PostgreSQL", w.Code, http.StatusServiceUnavailable)
	}
}

// Header X-CV-Schema: 2 không được làm route rẽ sang nhánh khác rồi panic
// hay trả 404 — không có DB thì vẫn phải là 503 giống hệt không có header.
func TestCVListRouteAcceptsSchemaHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
	r.Header.Set(SchemaVersionHeader, "2")
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d", w.Code, http.StatusServiceUnavailable)
	}
}

// CV không phải v2 phải bị từ chối trước khi chạm DB.
func TestPatchCVRejectsNonV2(t *testing.T) {
	cases := []struct{ body, why string }{
		{`{"cv":{"schemaVersion":1}}`, "cv phải là v2"},
		{`{}`, "thiếu cv"},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(http.MethodPatch,
			"/api/cv/00000000-0000-0000-0000-000000000000", strings.NewReader(tc.body))
		r.Header.Set(SchemaVersionHeader, "2")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		NewServer().Routes().ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, muốn 400", tc.why, w.Code)
		}
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: response không phải JSON: %v", tc.why, err)
		}
		if body["code"] != "SCHEMA_V2_INVALID" {
			t.Fatalf("%s: code = %q, muốn SCHEMA_V2_INVALID", tc.why, body["code"])
		}
	}
}

func TestAllowedChatPatchPathAcceptsTypographyFields(t *testing.T) {
	for _, field := range []string{"font", "bodyFontSize", "sectionTitleFontSize", "headerFontSize"} {
		if !allowedChatPatchPath("replace", "/design/"+field) {
			t.Fatalf("design field %q should be accepted", field)
		}
	}
}

// Không có header thì PATCH vẫn giữ hành vi service-unavailable khi chưa có DB.
func TestPatchCVWithoutHeaderStaysServiceUnavailable(t *testing.T) {
	r := httptest.NewRequest(http.MethodPatch,
		"/api/cv/00000000-0000-0000-0000-000000000000", strings.NewReader(`{"title":"x"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d khi chưa có PostgreSQL", w.Code, http.StatusServiceUnavailable)
	}
}

// CV V2 đúng định dạng nhưng không có DB phải rơi đúng vào chốt
// "CV cần PostgreSQL" — 503, không phải 400.
func TestPatchCVV2ValidPairWithoutDBIsServiceUnavailable(t *testing.T) {
	body := `{"cv":{"schemaVersion":2,"sections":{}}}`
	r := httptest.NewRequest(http.MethodPatch,
		"/api/cv/00000000-0000-0000-0000-000000000000", strings.NewReader(body))
	r.Header.Set(SchemaVersionHeader, "2")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d — cặp hợp lệ nhưng chưa có PostgreSQL", w.Code, http.StatusServiceUnavailable)
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

// Mô hình trước đây được bảo "trả lời cùng ngôn ngữ với hồ sơ", nên nó luôn
// đáp tiếng Việt với một CV tiếng Việt — kể cả khi người dùng đã chuyển giao
// diện sang tiếng Anh. Ngôn ngữ trả lời phải theo LỰA CHỌN CỦA NGƯỜI DÙNG,
// và chỉ client mới biết lựa chọn đó.
func TestChatSystemPromptFollowsRequestedLanguage(t *testing.T) {
	en := chatSystemPrompt("en")
	if !strings.Contains(en, "English") {
		t.Fatalf("prompt tiếng Anh phải yêu cầu trả lời bằng tiếng Anh:\n%s", en)
	}
	vi := chatSystemPrompt("vi")
	if !strings.Contains(vi, "tiếng Việt") {
		t.Fatalf("prompt tiếng Việt phải yêu cầu trả lời bằng tiếng Việt:\n%s", vi)
	}
	// Ngôn ngữ lạ hoặc rỗng lùi về tiếng Việt — giữ nguyên hành vi của client cũ.
	if chatSystemPrompt("") != vi || chatSystemPrompt("de") != vi {
		t.Fatal("ngôn ngữ lạ phải lùi về tiếng Việt")
	}
}

// Nhãn tiến trình bắn qua SSE phải là MÃ, không phải câu tiếng Việt. Client tra
// mã sang chữ của nó; gửi câu chữ thì giao diện tiếng Anh hiện tiếng Việt, và
// mọi lần backend sửa câu là client hết khớp.
func TestChatStepLabelsAreCodes(t *testing.T) {
	source, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatalf("không đọc được server.go: %v", err)
	}
	for _, viLabel := range []string{"Đang suy nghĩ", "Đang hiểu yêu cầu của bạn", "Đang xem lại hồ sơ để trả lời", "Đang kiểm tra đề xuất"} {
		if strings.Contains(string(source), `sendStep("`+viLabel+`")`) {
			t.Fatalf("sendStep còn gửi câu tiếng Việt %q thay vì mã", viLabel)
		}
	}
	for _, code := range []string{"THINKING", "UNDERSTANDING", "REVIEWING_PROFILE", "CHECKING_PROPOSAL"} {
		if !strings.Contains(string(source), `sendStep("`+code+`")`) {
			t.Fatalf("thiếu mã tiến trình %q", code)
		}
	}
}
