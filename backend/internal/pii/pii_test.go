package pii

import "testing"

func TestRedactDocumentHandlesV1Shape(t *testing.T) {
	doc := map[string]any{
		"basics": map[string]any{"name": "Ada", "email": "a@x.com", "headline": "CTO"},
		"work":   []any{map[string]any{"org": "FPT"}},
	}

	RedactDocument(doc)

	basics := doc["basics"].(map[string]any)
	if _, leaked := basics["name"]; leaked {
		t.Fatalf("basics.name còn lại: %#v", doc)
	}
	if basics["headline"] != "CTO" {
		t.Fatalf("field phi-PII bị xoá nhầm: %#v", doc)
	}
}

func TestRedactDocumentHandlesV2Shape(t *testing.T) {
	doc := map[string]any{
		"schemaVersion": float64(2),
		"sections": map[string]any{
			"intro": map[string]any{
				"fullName": "Ada", "email": "a@x.com", "phone": "090",
				"location": "Hà Nội", "avatarUrl": "https://cdn/x.jpg",
				"title": "CTO", "summary": "Mười năm", "website": "https://ada.dev",
			},
		},
	}

	RedactDocument(doc)

	intro := doc["sections"].(map[string]any)["intro"].(map[string]any)
	for _, key := range IntroKeys {
		if _, leaked := intro[key]; leaked {
			t.Fatalf("sections.intro.%s còn lại: %#v", key, doc)
		}
	}
	// website và summary KHÔNG phải PII — model cần chúng để đề xuất có nghĩa.
	if intro["title"] != "CTO" || intro["summary"] != "Mười năm" || intro["website"] != "https://ada.dev" {
		t.Fatalf("nội dung nghề nghiệp bị xoá nhầm: %#v", doc)
	}
}

// Danh sách v2 phải khớp PII_PATHS_V2 ở frontend/packages/schema/src/cv.ts.
// Lệch một dòng là PII đi thẳng ra cloud mà không lỗi nào được ném ra.
func TestIntroKeysMatchSpecList(t *testing.T) {
	want := []string{"fullName", "email", "phone", "location", "avatarUrl"}
	if len(IntroKeys) != len(want) {
		t.Fatalf("IntroKeys = %v, want %v", IntroKeys, want)
	}
	for i, key := range want {
		if IntroKeys[i] != key {
			t.Fatalf("IntroKeys[%d] = %q, want %q", i, IntroKeys[i], key)
		}
	}
}
