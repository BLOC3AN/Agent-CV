package main

import (
	"strings"
	"testing"
)

// Lines exactly as PyMuPDF emits them for a real 3-page CV: the marker sits on
// the first line of each bullet only, wrapped lines carry no marker and no
// indentation, and one word is broken across a line at its hyphen.
const realWorkSection = `EXPERIENCE
iMESPRO
AI Engineer

December, 2025 – Current
• Microservices & Infrastructure Architecture: Designed the end-to-end architecture of iVision MLOps
platform, featuring an 11-microservice orchestration layer; established a resilient distributed storage layer
(MinIO S3-compatible) and a secure, session-based RBAC architecture for multi-tenant isolation.
• Edge AIoT Optimization & Knowledge Distillation: Led production Edge AI and TinyML initiatives
across resource-constrained hardware (Jetson Orin Nano, Rockchip RV1106, SG2002). Implemented
Knowledge Distillation (KD) frameworks using specialized object detection loss functions to transfer
knowledge from large YOLO teachers into ultra-lightweight student architectures (e.g., LeNet-variant
backbones and custom tiny detectors). Combined this with PyTorch, TensorFlow Lite, and TensorFlow
Lite Micro for INT8 quantization, achieving 5–10 FPS inference speed on ultra-low-power devices.
• Industrial AIoT and High-Performance Deployment: Deployed automated Quality Control (QC) stations at
the Tecomen factory for mass-production lines. Successfully automated real-time OK/NG classification for high-
throughput product streams with an end-to-end latency of under 300ms.
• Real-Time Monitoring and Production Observability: Built a high-concurrency training monitoring system
utilizing Redis Pub/Sub and WebSockets to stream live progress to end users.
bTaskee
AI Engineer
Jun, 2025 – December, 2025
• Built and deployed large language models (LLMs) using Qwen3, Gemini, OpenAI, and BAML from
Huggingface on top of vLLM for efficient inference.
`

func highlightsOf(t *testing.T, entry any) []any {
	t.Helper()
	item, ok := entry.(map[string]any)
	if !ok {
		t.Fatalf("entry is not a map: %#v", entry)
	}
	highlights, ok := item["highlights"].([]any)
	if !ok {
		t.Fatalf("highlights is not a list: %#v", item["highlights"])
	}
	return highlights
}

func TestParseWorkKeepsOneHighlightPerWrittenBullet(t *testing.T) {
	work := parseWork(realWorkSection)
	if len(work) != 2 {
		t.Fatalf("expected 2 experience entries, got %d", len(work))
	}

	highlights := highlightsOf(t, work[0])
	// The CV author wrote four bullets. Counting visual lines instead gave 19.
	if len(highlights) != 4 {
		t.Fatalf("expected 4 highlights for the written bullets, got %d:\n%#v", len(highlights), highlights)
	}

	first, _ := highlights[0].(string)
	want := "Microservices & Infrastructure Architecture: Designed the end-to-end architecture of iVision MLOps platform, featuring an 11-microservice orchestration layer; established a resilient distributed storage layer (MinIO S3-compatible) and a secure, session-based RBAC architecture for multi-tenant isolation."
	if first != want {
		t.Fatalf("wrapped lines were not rejoined into one bullet:\ngot:  %q\nwant: %q", first, want)
	}
}

func TestParseWorkJoinsAWordBrokenAtItsHyphen(t *testing.T) {
	highlights := highlightsOf(t, parseWork(realWorkSection)[0])
	third, _ := highlights[2].(string)

	// "high-" + "throughput" is one word split across lines; a space would
	// invent one that the CV never contained.
	if !strings.Contains(third, "for high-throughput product streams") {
		t.Fatalf("hyphen-broken word was not rejoined: %q", third)
	}
	if strings.Contains(third, "high- throughput") {
		t.Fatalf("a space was inserted into a hyphen-broken word: %q", third)
	}
}

func TestParseWorkKeepsLineSplitWhenTheCVUsesNoBulletMarkers(t *testing.T) {
	// Without a marker anywhere there is no signal separating a wrapped line
	// from a new point, so each line stays its own highlight.
	plain := `EXPERIENCE
ACME
Engineer
January, 2022 – May, 2022
Shipped the billing service
Cut deploy time in half
`
	highlights := highlightsOf(t, parseWork(plain)[0])
	if len(highlights) != 2 {
		t.Fatalf("expected 2 line-split highlights, got %d:\n%#v", len(highlights), highlights)
	}
}

func TestParseEducationAndActivitiesRejoinWrappedBullets(t *testing.T) {
	education := parseEducation(`EDUCATION
HCMUTE
GPA: 8.0
• Led the student research group across two semesters,
publishing one paper on edge inference.
`)
	eduHighlights := highlightsOf(t, education[0])
	if len(eduHighlights) != 1 {
		t.Fatalf("education: expected 1 highlight, got %d:\n%#v", len(eduHighlights), eduHighlights)
	}
	if education[0].(map[string]any)["gpa"] != "8.0" {
		t.Fatalf("education: GPA was lost while grouping bullets: %#v", education[0])
	}

	activities := parseActivities(`ACTIVITIES
2026 – Neura Agent
• Organised the internal AI reading group,
running weekly sessions for 30 engineers.
`)
	actHighlights := highlightsOf(t, activities[0])
	if len(actHighlights) != 1 {
		t.Fatalf("activities: expected 1 highlight, got %d:\n%#v", len(actHighlights), actHighlights)
	}
}
