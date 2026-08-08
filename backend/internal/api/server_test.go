package api

import (
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
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

func TestApplyJSONPatchRejectsMissingPath(t *testing.T) {
	_, err := applyJSONPatch([]byte(`{"basics":{}}`), []byte(`[{"op":"replace","path":"/missing","value":true}]`))
	if err == nil {
		t.Fatal("expected invalid patch error")
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
		"basics": map[string]any{"name": "Ada"},
		"education": []any{map[string]any{"school": "MIT"}},
		"skills": []any{map[string]any{"name": "Go"}},
		"languages": []any{map[string]any{"name": "English"}},
		"_meta": map[string]any{"verified": map[string]any{"/basics": true, "/education/0": true}},
	}
	items, progress := reviewContract(profile)
	if len(items) != 4 || progress["done"] != 2 || progress["complete"] != false {
		t.Fatalf("items=%d progress=%#v", len(items), progress)
	}
	if got := progress["pending"].([]string); len(got) != 2 || got[0] != "/skills" || got[1] != "/languages" {
		t.Fatalf("pending=%#v", got)
	}
}
