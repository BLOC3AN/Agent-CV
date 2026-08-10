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

func TestValidateImportedCVRequiresV2Document(t *testing.T) {
	if err := validateImportedCV(`{"schemaVersion":1,"sections":{}}`); err == nil {
		t.Fatal("expected non-production document to be rejected")
	}
	if err := validateImportedCV(`{"schemaVersion":2,"sections":{"intro":{"fullName":"Ada"}}}`); err != nil {
		t.Fatalf("valid V2 document rejected: %v", err)
	}
}

func TestValidateImportedCVRejectsContentlessDocument(t *testing.T) {
	raw := `{"schemaVersion":2,"sections":{"intro":{"fullName":""},"experience":[],"projects":[],"education":[],"skills":[],"activities":[],"certifications":[],"languages":[]}}`
	if err := validateImportedCV(raw); err == nil {
		t.Fatal("contentless import must not be marked successful")
	}
}

// compactProfile() dựng prompt gap_analysis. Nó phải che đúng sáu field PII
// mà PII_PATHS khai — bản đầu xoá khoá "address", một khoá không hề tồn tại
// trong hồ sơ, nên `location` cùng `name`, `dob`, `photo` vẫn đi kèm prompt.
func TestCompactProfileRemovesEveryPIIField(t *testing.T) {
	raw := `{"schemaVersion":2,"sections":{"intro":{"fullName":"Nguyễn Văn A","email":"a@example.com",` +
		`"phone":"0901234567","location":"Hà Nội","avatarUrl":"https://cdn.example/x.jpg",` +
		`"title":"Kỹ sư AI"},"experience":[{"company":"FPT","title":"Engineer"}]}}`

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
	}, "test-cv")
	sections := profile["sections"].(map[string]any)
	if len(sections["education"].([]any)) != 1 || len(sections["experience"].([]any)) != 1 || len(sections["activities"].([]any)) != 1 {
		t.Fatalf("sections not preserved: %#v", profile)
	}
	if len(sections["skills"].([]any)) != 1 || len(sections["certifications"].([]any)) != 1 {
		t.Fatalf("skills/certifications not preserved: %#v", profile)
	}
	activities := sections["activities"].([]any)
	if activities[0].(map[string]any)["organization"] != "Neura Agent" {
		t.Fatalf("activity heading was not decoded: %#v", activities[0])
	}
	intro := sections["intro"].(map[string]any)
	if _, legacy := intro["summary"]; !legacy {
		t.Fatal("intro summary field missing")
	}
}

func TestParsedSectionsUseEmptyArraysInsteadOfNullHighlights(t *testing.T) {
	education := parseEducation("EDUCATION\nHCMUTE\nGPA: 8.0")
	eduItem := education[0].(map[string]any)
	if eduItem["highlights"] == nil {
		t.Fatal("education highlights must be [] rather than null")
	}
	activities := parseActivities("ACTIVITIES\n2026 – Neura Agent\nLead")
	activity := activities[0].(map[string]any)
	if activity["highlights"] == nil {
		t.Fatal("activity highlights must be [] rather than null")
	}
}

func TestMatchingUsesTaxonomyDescendantsAndIntroduce(t *testing.T) {
	testKBRoot(t)
	tax := loadSkillTaxonomy()
	profile := `{"schemaVersion":2,"sections":{"intro":{"summary":"Backend engineer","title":"Go"},"skills":[{"id":"skills-0","category":"Framework","skills":["Next.js"]}]}}`
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
	if len(chunks) < 2 || chunks[0].Path != "/sections/intro/title" {
		t.Fatalf("profile chunks=%#v", chunks)
	}
}

func TestRubricParityScoresAutomaticCriteriaAndGaps(t *testing.T) {
	testKBRoot(t)
	profile := map[string]any{"schemaVersion": float64(2), "sections": map[string]any{
		"intro":      map[string]any{"summary": "Backend engineer", "email": "a@example.com", "phone": "0900000000", "website": "https://github.com/a"},
		"projects":   []any{map[string]any{"highlights": []any{"Built API for 2k users"}}, map[string]any{"highlights": []any{"Worked on service"}}},
		"experience": []any{}, "skills": []any{map[string]any{"skills": []any{"Go", "Postgres"}}}, "education": []any{}, "activities": []any{},
	}}
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

func TestRubricScoreUsesV2Content(t *testing.T) {
	testKBRoot(t)
	v2 := map[string]any{
		"schemaVersion": float64(2),
		"sections": map[string]any{
			"intro":      map[string]any{"summary": "Backend engineer", "email": "a@example.com", "phone": "0900000000"},
			"experience": []any{map[string]any{"title": "Engineer", "company": "FPT", "startDate": "2022", "endDate": "2024", "highlights": []any{"Built API for 2k users"}}},
			"projects":   []any{map[string]any{"highlights": []any{"Built service for 100 users"}}, map[string]any{"highlights": []any{"Designed Go API"}}},
			"education":  []any{}, "activities": []any{}, "skills": []any{},
		},
	}
	jd := jdRequirements{RoleFamily: "backend_developer", Seniority: "fresher"}
	score, _ := scoreProfileRubric(v2, jd)
	if score <= 0 {
		t.Fatalf("rubric score v2=%v, want positive score", score)
	}
	if got := estimateProfileYears(v2); got != 3 {
		t.Fatalf("experience years v2=%v, want 3", got)
	}
}

func TestHasProfileFieldDoesNotPanicWithoutLinks(t *testing.T) {
	if hasProfileField(map[string]any{"schemaVersion": float64(2), "sections": map[string]any{"intro": map[string]any{}}}, "intro.website") {
		t.Fatal("missing website must not match")
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
			"education": []any{map[string]any{
				"school": "Đại học Bách Khoa", "degree": "Cử nhân", "fieldOfStudy": "Khoa học máy tính",
				"highlights": []any{"Tốt nghiệp loại giỏi"},
			}},
			"certifications": []any{map[string]any{
				"name": "AWS Certified Solutions Architect", "issuer": "Amazon Web Services",
			}},
			"languages": []any{map[string]any{
				"language": "Tiếng Anh", "proficiency": "Thành thạo",
			}},
			"activities": []any{map[string]any{
				"organization": "Neura Agent", "role": "Trưởng nhóm",
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

	// Mỗi pointer dưới đây được hiển thị cho người dùng và dùng để nhảy tới đúng
	// dòng trong CV, nên phải khớp field cụ thể (vd. .../education/0/school),
	// không phải một khối gộp xấp xỉ.
	want := map[string]string{
		"/sections/intro/title":               "Kỹ sư AI",
		"/sections/intro/summary":             "Ba năm edge AI",
		"/sections/experience/0/highlights/0": "Giảm 40% độ trễ",
		"/sections/experience/0/company":      "FPT",
		"/sections/education/0/school":        "Đại học Bách Khoa",
		"/sections/education/0/degree":        "Cử nhân",
		"/sections/education/0/fieldOfStudy":  "Khoa học máy tính",
		"/sections/education/0/highlights/0":  "Tốt nghiệp loại giỏi",
		"/sections/certifications/0/name":     "AWS Certified Solutions Architect",
		"/sections/certifications/0/issuer":   "Amazon Web Services",
		"/sections/languages/0/language":      "Tiếng Anh",
		"/sections/languages/0/proficiency":   "Thành thạo",
		"/sections/activities/0/organization": "Neura Agent",
		"/sections/activities/0/role":         "Trưởng nhóm",
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
