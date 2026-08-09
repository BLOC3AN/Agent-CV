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

// RedactDocument phải xoá _meta.originalLinks, droppedFields, canonical chứa PII.
// Giữ lại _meta.verified và _meta.source chứ không định danh.
func TestRedactDocumentHandlesV2MetaWithRealPII(t *testing.T) {
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
			// originalLinks từ v1.basics.links — chứa URL có nhãn
			"originalLinks": []any{
				map[string]any{"url": "https://linkedin.com/in/ada", "label": "LinkedIn"},
				map[string]any{"url": "https://github.com/ada", "label": "GitHub"},
			},
			// droppedFields lưu giá trị bị xoá: /basics/dob, /basics/photo, /basics/summary
			"droppedFields": map[string]any{
				"/basics/dob":                   "1990-05-15",
				"/basics/photo":                 "https://cdn/photo.jpg",
				"/_unrecognized/basics/summary": "(đầu trang) LE THANH HAI 0964525151• lethhai3003@gmail.com • https://www.linkedin.com/in/hailt8/",
			},
			// canonical lưu danh sách tên kỹ năng
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

	// Kiểm tra _meta.originalLinks, droppedFields, canonical bị xoá
	meta := doc["_meta"].(map[string]any)
	if _, leaked := meta["originalLinks"]; leaked {
		t.Fatalf("_meta.originalLinks còn lại (chứa URL): %#v", doc)
	}
	if _, leaked := meta["droppedFields"]; leaked {
		t.Fatalf("_meta.droppedFields còn lại (chứa dob, photo, summary với PII): %#v", doc)
	}
	if _, leaked := meta["canonical"]; leaked {
		t.Fatalf("_meta.canonical còn lại: %#v", doc)
	}

	// Kiểm tra verified và source vẫn còn
	if verified, ok := meta["verified"].(map[string]any); !ok || len(verified) == 0 {
		t.Fatalf("_meta.verified bị xoá nhầm: %#v", doc)
	}
	if source, ok := meta["source"].(string); !ok || source != "manual" {
		t.Fatalf("_meta.source bị xoá nhầm: %#v", doc)
	}
}
