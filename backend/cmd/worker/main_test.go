package main

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testKBRoot(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	t.Setenv("KB_ROOT", filepath.Join(filepath.Dir(file), "..", "..", "kb"))
}

func TestDetectLanguagePreservesEnglishCV(t *testing.T) {
	got := detectLanguage("Sơn Trịnh\nSUMMARY\nSoftware Engineer with experience in React and Docker\n(đầu trang)")
	if got != "en" {
		t.Fatalf("language = %s, want en", got)
	}
}

func TestCosine(t *testing.T) {
	if got := cosine([]float64{1, 0}, []float64{1, 0}); got < .99 {
		t.Fatalf("cosine=%v", got)
	}
	if got := cosine([]float64{1, 0}, []float64{0, 1}); got > .01 {
		t.Fatalf("cosine=%v", got)
	}
}

func TestKeywordScoreDegradedIsExplainable(t *testing.T) {
	score, matched, gaps := keywordScore(`{"skills":["Go","Postgres"]}`, "Go Postgres React")
	if score["overall"] != 66 {
		t.Fatalf("overall=%v", score["overall"])
	}
	if len(matched) != 2 || len(gaps) != 1 {
		t.Fatalf("matched=%d gaps=%d", len(matched), len(gaps))
	}
}

func TestLooksLikeCVRejectsNonCVText(t *testing.T) {
	if looksLikeCV(map[string]string{"summary": "boarding pass"}) {
		t.Fatal("non-CV summary must be rejected")
	}
	if !looksLikeCV(map[string]string{"education": "Bachelor"}) {
		t.Fatal("education section must be accepted")
	}
}

func TestRetryableErrorClassification(t *testing.T) {
	for _, message := range []string{"PDF_EXTRACT_FAILED: timeout", "MODEL_UNAVAILABLE", "dial ECONNRESET"} {
		if !retryableError(message) {
			t.Fatalf("expected retryable: %q", message)
		}
	}
	for _, message := range []string{"NO_CV_SECTIONS", "FILE_MISSING", "CV_NOT_FOUND", "PROFILE_CREATE_FAILED: invalid uuid"} {
		if retryableError(message) {
			t.Fatalf("expected terminal: %q", message)
		}
	}
}

func TestParseCVJobResultIsMetadataOnly(t *testing.T) {
	result, err := json.Marshal(parseCVJobResult("profile-1", "vi", "good", []string{"low_quality"}))
	if err != nil {
		t.Fatal(err)
	}
	text := string(result)
	for _, pii := range []string{"Nguyễn Văn A", "a@example.com", "0901234567", "EXPERIENCE"} {
		if strings.Contains(text, pii) {
			t.Fatalf("job result contains CV content %q: %s", pii, text)
		}
	}
	var got map[string]any
	if err := json.Unmarshal(result, &got); err != nil {
		t.Fatal(err)
	}
	if got["profileId"] != "profile-1" || got["language"] != "vi" {
		t.Fatalf("unexpected metadata: %#v", got)
	}
	if _, ok := got["sections"]; ok {
		t.Fatal("job result must not include extracted sections")
	}
}

// compactProfile() dựng prompt gap_analysis. Nó phải che đúng sáu field PII
// mà PII_PATHS khai — bản đầu xoá khoá "address", một khoá không hề tồn tại
// trong hồ sơ, nên `location` cùng `name`, `dob`, `photo` vẫn đi kèm prompt.
func TestCompactProfileRemovesEveryPIIField(t *testing.T) {
	raw := `{"basics":{"name":"Nguyễn Văn A","email":"a@example.com",` +
		`"phone":"0901234567","location":"Hà Nội","dob":"1999-01-02",` +
		`"photo":"https://cdn.example/x.jpg","headline":"Kỹ sư AI"},` +
		`"work":[{"org":"FPT","role":"Engineer"}]}`

	compact := compactProfile(raw)

	for _, pii := range []string{
		"Nguyễn Văn A", "a@example.com", "0901234567",
		"Hà Nội", "1999-01-02", "cdn.example",
	} {
		if strings.Contains(compact, pii) {
			t.Fatalf("compactProfile giữ lại PII %q: %s", pii, compact)
		}
	}
	for _, kept := range []string{"Kỹ sư AI", "FPT", "Engineer"} {
		if !strings.Contains(compact, kept) {
			t.Fatalf("compactProfile xoá nhầm nội dung phi-PII %q: %s", kept, compact)
		}
	}
}

func TestProfileFromSegmentsKeepsCVSections(t *testing.T) {
	profile := profileFromSegments("en", map[string]string{
		"introduce":      "INTRODUCTION\nSoftware Engineer focused on Go",
		"education":      "EDUCATION\nHCMUTE\n• Graduated: Bachelor of Mechatronic Engineering\n• GPA: 7.18/10",
		"work":           "EXPERIENCE\niMESPRO\nAI Engineer\nDecember, 2025 – Current\n• Built MLOps platform",
		"activities":     "ACTIVITIES\n2026 – Neura Agent\n• Built an agent",
		"skills":         "SKILLS\n• Languages: Python, Go, Docker",
		"certifications": "CERTIFICATE\nIBM-Python for Data Science",
	})
	if len(profile["education"].([]any)) != 1 || len(profile["work"].([]any)) != 1 || len(profile["activities"].([]any)) != 1 {
		t.Fatalf("sections not preserved: %#v", profile)
	}
	if len(profile["skills"].([]any)) != 3 || len(profile["certifications"].([]any)) != 1 {
		t.Fatalf("skills/certifications not preserved: %#v", profile)
	}
	activities := profile["activities"].([]any)
	if activities[0].(map[string]any)["name"] != "Neura Agent" {
		t.Fatalf("activity heading was not decoded: %#v", activities[0])
	}
	basics := profile["basics"].(map[string]any)
	if basics["introduce"] != "Software Engineer focused on Go" {
		t.Fatalf("introduce field was not decoded: %#v", basics)
	}
	if _, legacy := basics["summary"]; legacy {
		t.Fatal("profile must not emit the legacy basics.summary field")
	}
}

func TestMatchingUsesTaxonomyDescendantsAndIntroduce(t *testing.T) {
	testKBRoot(t)
	tax := loadSkillTaxonomy()
	profile := `{"basics":{"introduce":"Backend engineer","headline":"Go"},"skills":[{"name":"Next.js"}]}`
	chunks, _ := profileChunks(profile)
	index := map[string][]profileChunk{}
	for _, chunk := range chunks {
		for _, canonical := range tax.extract(chunk.Text) {
			index[canonical] = append(index[canonical], chunk)
		}
	}
	match := matchRequirement("React", tax, index, chunks)
	if match["matched"] != true || match["viaDescendant"] != "nextjs" {
		t.Fatalf("taxonomy match=%#v", match)
	}
	if len(chunks) < 2 || chunks[0].Path != "/basics/headline" {
		t.Fatalf("profile chunks=%#v", chunks)
	}
}

func TestRubricParityScoresAutomaticCriteriaAndGaps(t *testing.T) {
	testKBRoot(t)
	profile := map[string]any{
		"basics":   map[string]any{"introduce": "Backend engineer", "email": "a@example.com", "phone": "0900000000", "links": []any{map[string]any{"label": "GitHub", "url": "https://github.com/a"}}},
		"projects": []any{map[string]any{"highlights": []any{"Built API for 2k users"}}, map[string]any{"highlights": []any{"Worked on service"}}},
		"work":     []any{}, "skills": []any{"Go", "Postgres"}, "education": []any{}, "activities": []any{},
	}
	jd := jdRequirements{RoleFamily: "backend_developer", Seniority: "fresher"}
	score, gaps := scoreProfileRubric(profile, jd)
	if score <= 0 || score >= 100 {
		t.Fatalf("rubric score=%v, want partial score", score)
	}
	found := false
	for _, gap := range gaps {
		if gap["id"] == "rubric:action_verb_start" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected action verb gap, got %#v", gaps)
	}
}

func TestHasProfileFieldDoesNotPanicWithoutLinks(t *testing.T) {
	if hasProfileField(map[string]any{"basics": map[string]any{}}, "basics.links[?(@.label=='GitHub')]") {
		t.Fatal("missing links must not match")
	}
}

// Con trỏ trong kết quả đối chiếu được hiển thị cho người dùng và dùng để nhảy
// tới đúng dòng trong CV. Trỏ sai đường dẫn thì tính năng "nhảy tới chỗ thiếu"
// đưa người dùng đi đâu đó không xác định.
func TestProfileChunksReadsV2Sections(t *testing.T) {
	v2 := map[string]any{
		"schemaVersion": float64(2),
		"sections": map[string]any{
			"intro": map[string]any{"title": "Kỹ sư AI", "summary": "Ba năm edge AI"},
			"experience": []any{map[string]any{
				"title": "Engineer", "company": "FPT",
				"highlights": []any{"Giảm 40% độ trễ"},
			}},
			"skills": []any{map[string]any{
				"category": "Ngôn ngữ", "skills": []any{"Go", "Python"},
			}},
		},
	}
	raw, err := json.Marshal(v2)
	if err != nil {
		t.Fatal(err)
	}

	// profileChunks nhận chuỗi JSON (không phải map) và trả về cả map đã parse;
	// đây là chữ ký thật của hàm trong matching.go, khác snippet gợi ý ban đầu.
	chunks, _ := profileChunks(string(raw))

	want := map[string]string{
		"/sections/intro/title":               "Kỹ sư AI",
		"/sections/intro/summary":             "Ba năm edge AI",
		"/sections/experience/0/highlights/0": "Giảm 40% độ trễ",
		"/sections/skills/0/skills/0":         "Go",
	}
	got := map[string]string{}
	for _, c := range chunks {
		got[c.Path] = c.Text
	}
	for path, text := range want {
		if got[path] != text {
			t.Fatalf("chunk %q = %q, want %q\ntoàn bộ: %#v", path, got[path], text, got)
		}
	}
}

// Hồ sơ v1 vẫn phải chạy: apps/web dùng nó tới SP-5.
func TestProfileChunksStillReadsV1(t *testing.T) {
	v1 := map[string]any{
		"basics": map[string]any{"headline": "Kỹ sư AI", "introduce": "Ba năm edge AI"},
		"work": []any{map[string]any{
			"role": "Engineer", "org": "FPT",
			"highlights": []any{"Giảm 40% độ trễ"},
		}},
	}
	raw, err := json.Marshal(v1)
	if err != nil {
		t.Fatal(err)
	}

	chunks, _ := profileChunks(string(raw))
	got := map[string]string{}
	for _, c := range chunks {
		got[c.Path] = c.Text
	}
	if got["/basics/headline"] != "Kỹ sư AI" || got["/work/0/highlights/0"] != "Giảm 40% độ trễ" {
		t.Fatalf("nhánh v1 hỏng: %#v", got)
	}
}
