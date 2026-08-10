package pii

import "testing"

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

// Metadata V2 được làm sạch ở migration cutover và không bị xoá khỏi prompt.
func TestRedactDocumentPreservesV2Meta(t *testing.T) {
	doc := map[string]any{
		"schemaVersion": float64(2),
		"sections": map[string]any{
			"intro": map[string]any{
				"fullName": "Ada", "email": "a@x.com", "phone": "090",
				"location": "Hà Nội", "avatarUrl": "https://cdn/x.jpg",
				"title": "CTO", "summary": "Mười năm",
			},
		},
		"_meta": map[string]any{
			"canonical": map[string]any{
				"Node.js":    "nodejs",
				"TypeScript": "typescript",
				"PostgreSQL": "postgresql",
			},
			// Những cái này giữ lại: không định danh, không phải PII
			"verified": map[string]any{
				"/sections/intro/fullName": true,
				"/sections/intro/phone":    false,
			},
			"source": "manual",
		},
	}

	RedactDocument(doc)

	// Kiểm tra sections.intro PII bị xoá
	intro := doc["sections"].(map[string]any)["intro"].(map[string]any)
	for _, key := range IntroKeys {
		if _, leaked := intro[key]; leaked {
			t.Fatalf("sections.intro.%s còn lại: %#v", key, doc)
		}
	}

	// Metadata V2 vẫn còn nguyên
	meta := doc["_meta"].(map[string]any)
	if _, ok := meta["canonical"]; !ok {
		t.Fatalf("_meta.canonical bị xoá nhầm: %#v", doc)
	}

	// Kiểm tra verified và source vẫn còn
	if verified, ok := meta["verified"].(map[string]any); !ok || len(verified) == 0 {
		t.Fatalf("_meta.verified bị xoá nhầm: %#v", doc)
	}
	if source, ok := meta["source"].(string); !ok || source != "manual" {
		t.Fatalf("_meta.source bị xoá nhầm: %#v", doc)
	}
}
