package main

import "testing"

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
