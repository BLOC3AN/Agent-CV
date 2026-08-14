package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeSeed(t *testing.T, root, name, body string) {
	t.Helper()
	dir := filepath.Join(root, "seed")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Nguồn chưa có HR thật đứng tên thì không trích dẫn được. Seed hiện tại trong
// repo tự ghi status: draft kèm dặn dò không được lấy chunk nào từ nó — chốt này
// thi hành đúng câu đó thay vì để nó là lời dặn trong comment.
func TestCitableKBRefsIgnoresDraftSources(t *testing.T) {
	root := t.TempDir()
	writeSeed(t, root, "draft.yaml", `
source:
  id: seed-draft
  status: draft
guidelines:
  - id: g_bullet_formula
  - id: g_no_metric_fallback
`)
	t.Setenv("KB_ROOT", root)
	if got := citableKBRefs(); len(got) != 0 {
		t.Fatalf("nguồn draft không được trích dẫn, nhận: %v", got)
	}
}

func TestCitableKBRefsAcceptsActiveSources(t *testing.T) {
	root := t.TempDir()
	writeSeed(t, root, "active.yaml", `
source:
  id: seed-active
  status: active
guidelines:
  - id: g_bullet_formula
`)
	writeSeed(t, root, "draft.yaml", `
source:
  id: seed-draft
  status: draft
guidelines:
  - id: g_secret
`)
	t.Setenv("KB_ROOT", root)
	got := citableKBRefs()
	if !got["g_bullet_formula"] {
		t.Fatal("guideline của nguồn active phải trích dẫn được")
	}
	if got["g_secret"] {
		t.Fatal("guideline của nguồn draft lọt vào tập trích dẫn được")
	}
}

// KB_ROOT trỏ vào chỗ không có gì thì trả tập rỗng, không panic: worker vẫn phải
// chạy được khi thiếu KB, chỉ là không lời khuyên nào dẫn nguồn.
func TestCitableKBRefsSurvivesMissingKB(t *testing.T) {
	t.Setenv("KB_ROOT", filepath.Join(t.TempDir(), "không-tồn-tại"))
	if got := citableKBRefs(); len(got) != 0 {
		t.Fatalf("mong đợi rỗng, nhận %v", got)
	}
}

// Prompt gap_advice không gửi KB cho model, nên mọi id nó trả về đều là bịa.
// Đây là trạng thái THẬT của hệ thống hôm nay.
func TestFilterKBRefsDropsEverythingWhenNothingIsCitable(t *testing.T) {
	kept, dropped := filterKBRefs([]string{"g_bullet_formula", "kb-001", ""}, map[string]bool{})
	if len(kept) != 0 {
		t.Fatalf("không nguồn nào active mà vẫn giữ được ref: %v", kept)
	}
	if dropped != 3 {
		t.Fatalf("đếm sai số ref bị bỏ: %d", dropped)
	}
}

func TestFilterKBRefsKeepsCitableIDs(t *testing.T) {
	citable := map[string]bool{"g_bullet_formula": true}
	kept, dropped := filterKBRefs([]string{"g_bullet_formula", "g_bia_ra"}, citable)
	if len(kept) != 1 || kept[0] != "g_bullet_formula" {
		t.Fatalf("giữ sai: %v", kept)
	}
	if dropped != 1 {
		t.Fatalf("đếm sai số ref bị bỏ: %d", dropped)
	}
}

// Seed thật trong repo phải ở trạng thái draft — nếu ai đó bật nó sang active mà
// chưa điền author_name thì test này là chỗ dừng lại và đọc lại luật trích dẫn.
func TestRepositorySeedIsStillDraft(t *testing.T) {
	t.Setenv("KB_ROOT", "../../kb")
	if got := citableKBRefs(); len(got) != 0 {
		t.Fatalf("seed trong repo đã có nguồn active (%v) — kiểm tra author_name trước khi cho trích dẫn", got)
	}
}
