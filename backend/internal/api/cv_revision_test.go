package api

import (
	"bytes"
	"compress/zlib"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"sync"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type cvRevisionFixture struct {
	userID, otherUserID, profileID, cvID, token, otherToken string
	profile                                                 json.RawMessage
	layout                                                  json.RawMessage
}

func cvRevisionDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:hragent_dev@localhost:5433/hragent"
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("revision test database unavailable: %v", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		t.Skipf("revision test database unavailable: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func createCVRevisionFixture(t *testing.T, db *sql.DB) cvRevisionFixture {
	t.Helper()
	f := cvRevisionFixture{
		token:      "cv-revision-" + t.Name(),
		otherToken: "cv-revision-other-" + t.Name(),
		profile:    validRevisionCV("Original", "Original User"),
		layout:     append(json.RawMessage(nil), defaultCVLayout...),
	}
	if err := db.QueryRow(`WITH u AS (INSERT INTO users(email) VALUES ($1) RETURNING id),
		p AS (INSERT INTO profiles(user_id,data,language) SELECT id,$2::jsonb,'vi' FROM u RETURNING id,user_id),
		c AS (INSERT INTO cv_documents(user_id,profile_id,profile_snapshot,layout,title,language)
		SELECT p.user_id,p.id,$2::jsonb,$3::jsonb,'Revision CV','vi' FROM p RETURNING id,user_id,profile_id)
		SELECT (SELECT id FROM u), (SELECT id FROM p), (SELECT id FROM c)`,
		f.token+"@example.com", string(f.profile), string(f.layout)).Scan(&f.userID, &f.profileID, &f.cvID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO users(email) VALUES ($1) RETURNING id`, f.otherToken+"@example.com").Scan(&f.otherUserID); err != nil {
		t.Fatal(err)
	}
	for _, session := range []struct{ userID, token string }{{f.userID, f.token}, {f.otherUserID, f.otherToken}} {
		if _, err := db.Exec(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, session.userID, tokenHash(session.token)); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id IN ($1,$2)`, f.userID, f.otherUserID) })
	return f
}

func orderedRevisionLayout(first ...string) json.RawMessage {
	requested := append([]string(nil), first...)
	seen := make(map[string]bool, len(requested))
	for _, kind := range requested {
		seen[kind] = true
	}
	for _, kind := range canonicalCVNodeTypes {
		if !seen[kind] {
			requested = append(requested, kind)
		}
	}
	nodes := make([]map[string]any, 0, len(requested))
	for _, kind := range requested {
		nodes = append(nodes, map[string]any{"id": kind, "type": kind, "visible": true})
	}
	raw, _ := json.Marshal(map[string]any{"version": 1, "nodes": nodes})
	return raw
}

func revisionLayoutWithItemOrder(kind string, itemOrder []string) json.RawMessage {
	var layout map[string]any
	if err := json.Unmarshal(orderedRevisionLayout(), &layout); err != nil {
		panic(err)
	}
	for _, value := range layout["nodes"].([]any) {
		node := value.(map[string]any)
		if node["type"] == kind {
			node["itemOrder"] = itemOrder
		}
	}
	raw, _ := json.Marshal(layout)
	return raw
}

func legacyRevisionLayoutWithoutActivities() json.RawMessage {
	var layout map[string]any
	if err := json.Unmarshal(orderedRevisionLayout(), &layout); err != nil {
		panic(err)
	}
	nodes := layout["nodes"].([]any)
	filtered := make([]any, 0, len(nodes)-1)
	for _, value := range nodes {
		if value.(map[string]any)["type"] != "activities" {
			filtered = append(filtered, value)
		}
	}
	layout["nodes"] = filtered
	raw, _ := json.Marshal(layout)
	return raw
}

func validRevisionCV(title, fullName string) json.RawMessage {
	raw, err := json.Marshal(map[string]any{
		"schemaVersion": 2, "id": "cv-revision", "title": title, "lastModified": "2026-08-10T00:00:00Z", "language": "vi",
		"sections": map[string]any{
			"intro":      map[string]any{"fullName": fullName, "title": "", "email": "", "phone": "", "location": "", "summary": ""},
			"experience": []any{}, "projects": []any{}, "education": []any{}, "skills": []any{}, "activities": []any{}, "certifications": []any{}, "languages": []any{},
		},
		"design":         map[string]any{"template": "modern", "accentColor": "#4F46E5", "font": "Roboto", "fontSize": 14, "spacing": "normal"},
		"activeSections": map[string]any{"intro": true, "experience": true, "projects": true, "education": true, "skills": true, "activities": true, "certifications": true, "languages": true},
		"layout":         map[string]any{"version": 1, "nodes": []any{}},
		"_meta":          map[string]any{"verified": map[string]any{}, "source": "manual", "canonical": map[string]any{}},
	})
	if err != nil {
		panic(err)
	}
	return raw
}

func cvRevisionRequest(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "hr_session", Value: token})
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SchemaVersionHeader, "2")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func cvMetadataPatchRequest(t *testing.T, handler http.Handler, path, token string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, path, bytes.NewBufferString(body))
	req.AddCookie(&http.Cookie{Name: "hr_session", Value: token})
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func decompressedPDFStreams(raw []byte) []byte {
	var content bytes.Buffer
	for len(raw) > 0 {
		marker := []byte("stream\n")
		start := bytes.Index(raw, marker)
		if start < 0 {
			marker = []byte("stream\r\n")
			start = bytes.Index(raw, marker)
		}
		if start < 0 {
			break
		}
		start += len(marker)
		end := bytes.Index(raw[start:], []byte("endstream"))
		if end < 0 {
			break
		}
		stream := bytes.TrimSpace(raw[start : start+end])
		if reader, err := zlib.NewReader(bytes.NewReader(stream)); err == nil {
			decoded, _ := io.ReadAll(reader)
			_ = reader.Close()
			content.Write(decoded)
		}
		raw = raw[start+end+len("endstream"):]
	}
	return content.Bytes()
}

func revisionCommitBody(cv json.RawMessage, layout json.RawMessage, source, message string) map[string]any {
	return revisionCommitBodyAt(cv, layout, source, message, 0)
}

func revisionCommitBodyAt(cv json.RawMessage, layout json.RawMessage, source, message string, baseRevision int) map[string]any {
	return map[string]any{"cv": cv, "layout": layout, "source": source, "message": message, "baseRevision": baseRevision}
}

func TestCVGetAndExportUseCVLocalSnapshotWhenProfileDiverges(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	diverged := validRevisionCV("Profile only", "Wrong profile content")
	if _, err := db.Exec(`UPDATE profiles SET data=$2::jsonb WHERE id=$1`, f.profileID, string(diverged)); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithDB(db, "").Routes()
	w := cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"Original User"`)) || bytes.Contains(w.Body.Bytes(), []byte(`"Wrong profile content"`)) {
		t.Fatalf("GET did not use CV-local snapshot: status=%d body=%s", w.Code, w.Body)
	}
	w = cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID+"/export", f.token, nil)
	pdfText := decompressedPDFStreams(w.Body.Bytes())
	if w.Code != http.StatusOK || !bytes.Contains(pdfText, []byte("Original User")) || bytes.Contains(pdfText, []byte("Wrong profile content")) {
		t.Fatalf("export did not use CV-local snapshot: status=%d body-prefix=%q", w.Code, w.Body.Bytes()[:min(w.Body.Len(), 200)])
	}
}

func TestCVCommitRejectsStaleBaseRevisionAndOnlyOneConcurrentWriterWins(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	responses := make([]*httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	for i := range responses {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			responses[index] = cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBodyAt(validRevisionCV(fmt.Sprintf("Writer %d", index), fmt.Sprintf("Writer %d", index)), f.layout, "user", "race", 0))
		}(i)
	}
	wait.Wait()
	statuses := []int{responses[0].Code, responses[1].Code}
	sort.Ints(statuses)
	if !reflect.DeepEqual(statuses, []int{http.StatusOK, http.StatusConflict}) {
		t.Fatalf("concurrent statuses=%v bodies=%q / %q", statuses, responses[0].Body, responses[1].Body)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("revision count=%d err=%v", count, err)
	}
}

func TestLegacyCVPatchCannotBypassExistingRevisionHistory(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, f.layout, "user", "first"))
	if w.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", w.Code, w.Body)
	}
	legacy := validRevisionCV("Bypass", "Bypass")
	w = cvRevisionRequest(t, handler, http.MethodPatch, "/api/cv/"+f.cvID, f.token, map[string]any{"cv": legacy})
	if w.Code != http.StatusConflict {
		t.Fatalf("legacy PATCH status=%d body=%s", w.Code, w.Body)
	}
	var stored []byte
	if err := db.QueryRow(`SELECT profile_snapshot FROM cv_documents WHERE id=$1`, f.cvID).Scan(&stored); err != nil || bytes.Contains(stored, []byte(`"Bypass"`)) {
		t.Fatalf("legacy PATCH changed revisioned snapshot: %s err=%v", stored, err)
	}
}

func TestCVCommitRejectsNoncanonicalLayoutAndUnknownItemReferences(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	cases := map[string]json.RawMessage{
		"missing nodes":    json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true}]}`),
		"duplicate nodes":  json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true},{"id":"header","type":"header","visible":true}]}`),
		"mismatched id":    json.RawMessage(`{"version":1,"nodes":[{"id":"hero","type":"header","visible":true}]}`),
		"unknown item ref": revisionLayoutWithItemOrder("experience", []string{"missing-experience"}),
	}
	for name, layout := range cases {
		t.Run(name, func(t *testing.T) {
			w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, layout, "user", name))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

func TestCVCommitCreatesRevisionAndUpdatesContentAndLayoutTogether(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	updatedCV := validRevisionCV("Committed", "Committed User")
	updatedLayout := orderedRevisionLayout("summary", "header")
	normalizedUpdatedCV, normalizedUpdatedLayout, err := normalizeCommittedCVPair(updatedCV, updatedLayout)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithDB(db, "").Routes()
	w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(updatedCV, updatedLayout, "user", "Save draft"))
	if w.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		CV struct {
			ProfileSnapshot map[string]any `json:"profileSnapshot"`
			Layout          map[string]any `json:"layout"`
			RevisionNumber  int            `json:"revisionNumber"`
		} `json:"cv"`
		Revision struct {
			ID              string         `json:"id"`
			Number          int            `json:"number"`
			Source          string         `json:"source"`
			Message         string         `json:"message"`
			ProfileSnapshot map[string]any `json:"profileSnapshot"`
			Layout          map[string]any `json:"layout"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Revision.ID == "" || response.Revision.Number != 1 || response.Revision.Source != "user" || response.Revision.Message != "Save draft" {
		t.Fatalf("revision=%+v", response.Revision)
	}
	if response.CV.Layout == nil || response.CV.RevisionNumber != response.Revision.Number || response.Revision.ProfileSnapshot["title"] != "Committed" || response.Revision.Layout["version"] != float64(1) || !reflect.DeepEqual(response.CV.ProfileSnapshot, response.Revision.ProfileSnapshot) || !reflect.DeepEqual(response.CV.Layout, response.Revision.Layout) {
		t.Fatalf("response does not contain committed CV and layout: %s", w.Body)
	}
	var currentProfile, currentCV, currentLayout []byte
	if err := db.QueryRow(`SELECT data FROM profiles WHERE id=$1`, f.profileID).Scan(&currentProfile); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT profile_snapshot, layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&currentCV, &currentLayout); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(currentProfile, f.profile) || !jsonEqual(currentCV, normalizedUpdatedCV) || !jsonEqual(currentLayout, normalizedUpdatedLayout) {
		t.Fatalf("current state was not updated together: profile=%s snapshot=%s layout=%s", currentProfile, currentCV, currentLayout)
	}
	w = cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID+"/revisions", f.token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", w.Code, w.Body)
	}
	var list struct {
		Revisions []struct {
			ID     string `json:"id"`
			Number int    `json:"number"`
			Source string `json:"source"`
		} `json:"revisions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Revisions) != 1 || list.Revisions[0].ID != response.Revision.ID || list.Revisions[0].Number != 1 || list.Revisions[0].Source != "user" {
		t.Fatalf("revision summaries=%s", w.Body)
	}
}

func TestCVRestoreRejectsStaleBaseWithoutChangingHistory(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	committed := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(validRevisionCV("First", "First User"), f.layout, "user", "first"))
	if committed.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", committed.Code, committed.Body)
	}
	var response struct {
		Revision struct {
			ID string `json:"id"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(committed.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	restored := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/revisions/"+response.Revision.ID+"/restore", f.token, map[string]any{"baseRevision": 0})
	if restored.Code != http.StatusConflict || !bytes.Contains(restored.Body.Bytes(), []byte(`CV_REVISION_CONFLICT`)) {
		t.Fatalf("stale restore status=%d body=%s", restored.Code, restored.Body)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("stale restore changed history count=%d err=%v", count, err)
	}
}

func TestCVRestoreNormalizesLegacyRevisionSnapshotAndLayout(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	committed := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(validRevisionCV("Legacy", "Legacy User"), f.layout, "user", "legacy"))
	if committed.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", committed.Code, committed.Body)
	}
	var committedResponse struct {
		Revision struct {
			ID string `json:"id"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(committed.Body.Bytes(), &committedResponse); err != nil {
		t.Fatal(err)
	}
	legacyLayout := legacyRevisionLayoutWithoutActivities()
	if _, err := db.Exec(`UPDATE cv_revisions SET layout=$2::jsonb,profile_snapshot=jsonb_set(profile_snapshot,'{layout}',$2::jsonb) WHERE id=$1`, committedResponse.Revision.ID, string(legacyLayout)); err != nil {
		t.Fatal(err)
	}
	preview := cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID+"/revisions/"+committedResponse.Revision.ID, f.token, nil)
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body)
	}
	var previewResponse struct {
		Revision struct {
			Layout struct {
				Nodes []any `json:"nodes"`
			} `json:"layout"`
			ProfileSnapshot struct {
				Layout struct {
					Nodes []any `json:"nodes"`
				} `json:"layout"`
			} `json:"profileSnapshot"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(preview.Body.Bytes(), &previewResponse); err != nil {
		t.Fatal(err)
	}
	if len(previewResponse.Revision.Layout.Nodes) != len(canonicalCVNodeTypes) || len(previewResponse.Revision.ProfileSnapshot.Layout.Nodes) != len(canonicalCVNodeTypes) {
		t.Fatalf("legacy preview was not canonicalized: %s", preview.Body)
	}
	restored := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/revisions/"+committedResponse.Revision.ID+"/restore", f.token, map[string]any{"baseRevision": 1})
	if restored.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", restored.Code, restored.Body)
	}
	var response struct {
		CV struct {
			Layout struct {
				Nodes []any `json:"nodes"`
			} `json:"layout"`
			ProfileSnapshot struct {
				Layout struct {
					Nodes []any `json:"nodes"`
				} `json:"layout"`
			} `json:"profileSnapshot"`
		} `json:"cv"`
	}
	if err := json.Unmarshal(restored.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.CV.Layout.Nodes) != len(canonicalCVNodeTypes) || len(response.CV.ProfileSnapshot.Layout.Nodes) != len(canonicalCVNodeTypes) {
		t.Fatalf("legacy restore was not canonicalized: %s", restored.Body)
	}
}

func TestCVCommitRejectsAnotherUsersCV(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.otherToken, revisionCommitBody(f.profile, f.layout, "user", "not allowed"))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("unauthorized commit created %d revisions", count)
	}
}

func TestCVCommitRejectsLayoutPropertiesOutsideSharedContract(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	invalidLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true,"itemOrder":[]}]}`)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, invalidLayout, "user", "invalid layout"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("invalid layout created %d revisions", count)
	}
}

func TestCVCommitRejectsNullItemOrder(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	invalidLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"experience","type":"experience","visible":true,"itemOrder":null}]}`)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, invalidLayout, "user", "invalid layout"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
}

func TestCVCommitRejectsEmptyItemIDAndItemOrderReference(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	var profile map[string]any
	if err := json.Unmarshal(f.profile, &profile); err != nil {
		t.Fatal(err)
	}
	sections := profile["sections"].(map[string]any)
	sections["experience"] = []any{map[string]any{"id": "", "title": "Engineer", "company": ""}}
	invalidProfile, _ := json.Marshal(profile)
	if w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(invalidProfile, f.layout, "user", "empty id")); w.Code != http.StatusBadRequest {
		t.Fatalf("empty item id status=%d body=%s", w.Code, w.Body)
	}
	if w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, revisionLayoutWithItemOrder("experience", []string{""}), "user", "empty ref")); w.Code != http.StatusBadRequest {
		t.Fatalf("empty item ref status=%d body=%s", w.Code, w.Body)
	}
}

func TestCVCommitNormalizesItemOrderAndGETReadsBackCanonicalSnapshot(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	var profile map[string]any
	if err := json.Unmarshal(f.profile, &profile); err != nil {
		t.Fatal(err)
	}
	profile["sections"].(map[string]any)["experience"] = []any{map[string]any{"id": "exp-1", "title": "Engineer", "company": "Acme"}}
	updated, _ := json.Marshal(profile)
	w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(updated, f.layout, "user", "ordered"))
	if w.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		Revision struct {
			Layout          json.RawMessage `json:"layout"`
			ProfileSnapshot json.RawMessage `json:"profileSnapshot"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || !bytes.Contains(response.Revision.Layout, []byte(`"exp-1"`)) || !bytes.Contains(response.Revision.ProfileSnapshot, []byte(`"exp-1"`)) {
		t.Fatalf("commit did not return normalized item order: %s", w.Body)
	}
	read := cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if read.Code != http.StatusOK || !bytes.Contains(read.Body.Bytes(), []byte(`"itemOrder":["exp-1"]`)) {
		t.Fatalf("GET did not read back canonical item order: status=%d body=%s", read.Code, read.Body)
	}
}

func TestCVCommitRejectsLayoutWithoutVisible(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	invalidLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header"}]}`)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(f.profile, invalidLayout, "user", "invalid layout"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
}

func TestCVCommitRejectsIncompletePublicCVSnapshot(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	incomplete := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Incomplete","language":"vi","sections":{"intro":{"fullName":"User"}}}`)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(incomplete, f.layout, "user", "invalid snapshot"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
}

func TestCVCommitNormalizesPublicCVDefaultsIntoRevisionSnapshot(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	defaultable := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Defaulted","lastModified":"2026-08-10T00:00:00Z","language":"vi","sections":{"intro":{"fullName":"User"}}}`)
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(defaultable, f.layout, "user", "default snapshot"))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		Revision struct {
			ProfileSnapshot map[string]any `json:"profileSnapshot"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	profile := response.Revision.ProfileSnapshot
	if profile["layout"] == nil || profile["design"] == nil || profile["activeSections"] == nil || profile["_meta"] == nil {
		t.Fatalf("revision profile is not a normalized public CV: %s", w.Body)
	}
	sections, ok := profile["sections"].(map[string]any)
	if !ok || sections["experience"] == nil || sections["languages"] == nil {
		t.Fatalf("revision sections are not defaulted: %s", w.Body)
	}
}

func TestCVMetadataPatchRejectsLayoutWithoutCorruptingCurrentCV(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	w := cvMetadataPatchRequest(t, NewServerWithDB(db, "").Routes(), "/api/cv/"+f.cvID, f.token, `{"layout":{"version":1,"nodes":[{"id":"header","type":"header"}]}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var stored []byte
	if err := db.QueryRow(`SELECT layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(stored, f.layout) {
		t.Fatalf("invalid metadata patch changed stored layout: %s", stored)
	}
}

func TestCVMetadataPatchCannotInitializeOrRewriteLayout(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	w := cvMetadataPatchRequest(t, NewServerWithDB(db, "").Routes(), "/api/cv/"+f.cvID, f.token, `{"layout":{}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var stored []byte
	if err := db.QueryRow(`SELECT layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(stored, f.layout) {
		t.Fatalf("metadata patch changed stored layout: %s", stored)
	}
}

func TestCVRoutesKeepMalformedIdentifiersAsBadRequests(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	requests := []struct {
		name, method, path string
		body               any
	}{
		{"current CV", http.MethodGet, "/api/cv/not-a-uuid", nil},
		{"commit CV", http.MethodPost, "/api/cv/not-a-uuid/commit", revisionCommitBody(f.profile, f.layout, "user", "bad id")},
		{"revision list", http.MethodGet, "/api/cv/not-a-uuid/revisions", nil},
		{"revision preview", http.MethodGet, "/api/cv/" + f.cvID + "/revisions/not-a-uuid", nil},
		{"revision restore", http.MethodPost, "/api/cv/" + f.cvID + "/revisions/not-a-uuid/restore", nil},
	}
	for _, request := range requests {
		t.Run(request.name, func(t *testing.T) {
			w := cvRevisionRequest(t, handler, request.method, request.path, f.token, request.body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

func TestCVGetNormalizesLegacyEmptyLayout(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	if _, err := db.Exec(`UPDATE cv_documents SET layout='{}'::jsonb WHERE id=$1`, f.cvID); err != nil {
		t.Fatal(err)
	}
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		CV struct {
			Layout struct {
				Version int   `json:"version"`
				Nodes   []any `json:"nodes"`
			} `json:"layout"`
			ProfileSnapshot struct {
				Layout struct {
					Version int   `json:"version"`
					Nodes   []any `json:"nodes"`
				} `json:"layout"`
			} `json:"profileSnapshot"`
		} `json:"cv"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.CV.Layout.Version != 1 || len(response.CV.Layout.Nodes) != len(canonicalCVNodeTypes) || response.CV.ProfileSnapshot.Layout.Version != 1 || len(response.CV.ProfileSnapshot.Layout.Nodes) != len(canonicalCVNodeTypes) {
		t.Fatalf("legacy layout was not normalized: %s", w.Body)
	}
}

func TestCVGetDoesNotHideLegacyLayoutWhenActiveSectionsAreAbsent(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	var profile map[string]any
	if err := json.Unmarshal(f.profile, &profile); err != nil {
		t.Fatal(err)
	}
	delete(profile, "activeSections")
	raw, _ := json.Marshal(profile)
	if _, err := db.Exec(`UPDATE cv_documents SET profile_snapshot=$2::jsonb,layout='{}'::jsonb WHERE id=$1`, f.cvID, string(raw)); err != nil {
		t.Fatal(err)
	}
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		CV struct {
			Layout struct {
				Nodes []struct {
					Visible bool `json:"visible"`
				} `json:"nodes"`
			} `json:"layout"`
		} `json:"cv"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	for index, node := range response.CV.Layout.Nodes {
		if !node.Visible {
			t.Fatalf("node %d was hidden by an absent compatibility flag: %s", index, w.Body)
		}
	}
}

func TestCVRevisionPreviewAndRestorePreserveHistory(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	firstCV := validRevisionCV("First", "First User")
	firstLayout := orderedRevisionLayout("header")
	normalizedFirstCV, normalizedFirstLayout, err := normalizeCommittedCVPair(firstCV, firstLayout)
	if err != nil {
		t.Fatal(err)
	}
	secondCV := validRevisionCV("Second", "Second User")
	secondLayout := orderedRevisionLayout("summary")
	first := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(firstCV, firstLayout, "user", "first"))
	if first.Code != http.StatusOK {
		t.Fatalf("first commit status=%d body=%s", first.Code, first.Body)
	}
	var firstResponse struct {
		Revision struct {
			ID string `json:"id"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstResponse); err != nil {
		t.Fatal(err)
	}
	second := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBodyAt(secondCV, secondLayout, "ai", "second", 1))
	if second.Code != http.StatusOK {
		t.Fatalf("second commit status=%d body=%s", second.Code, second.Body)
	}
	var secondResponse struct {
		Revision struct {
			ID string `json:"id"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondResponse); err != nil {
		t.Fatal(err)
	}
	preview := cvRevisionRequest(t, handler, http.MethodGet, "/api/cv/"+f.cvID+"/revisions/"+secondResponse.Revision.ID, f.token, nil)
	if preview.Code != http.StatusOK || !bytes.Contains(preview.Body.Bytes(), []byte(`"First"`)) || !bytes.Contains(preview.Body.Bytes(), []byte(`"Second"`)) {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body)
	}
	restored := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/revisions/"+firstResponse.Revision.ID+"/restore", f.token, map[string]any{"baseRevision": 2})
	if restored.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", restored.Code, restored.Body)
	}
	var restoredResponse struct {
		CV struct {
			ProfileSnapshot map[string]any `json:"profileSnapshot"`
			Layout          map[string]any `json:"layout"`
			RevisionNumber  int            `json:"revisionNumber"`
		} `json:"cv"`
		Revision struct {
			Number           int            `json:"number"`
			Source           string         `json:"source"`
			ParentRevisionID string         `json:"parentRevisionId"`
			ProfileSnapshot  map[string]any `json:"profileSnapshot"`
			Layout           map[string]any `json:"layout"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(restored.Body.Bytes(), &restoredResponse); err != nil {
		t.Fatal(err)
	}
	if restoredResponse.Revision.Number != 3 || restoredResponse.CV.RevisionNumber != 3 || restoredResponse.Revision.Source != "restore" || restoredResponse.Revision.ParentRevisionID != firstResponse.Revision.ID || !reflect.DeepEqual(restoredResponse.CV.ProfileSnapshot, restoredResponse.Revision.ProfileSnapshot) || !reflect.DeepEqual(restoredResponse.CV.Layout, restoredResponse.Revision.Layout) {
		t.Fatalf("restore revision=%+v", restoredResponse.Revision)
	}
	var currentCV, currentLayout []byte
	if err := db.QueryRow(`SELECT profile_snapshot, layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&currentCV, &currentLayout); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(currentCV, normalizedFirstCV) || !jsonEqual(currentLayout, normalizedFirstLayout) {
		t.Fatalf("restore current profile=%s layout=%s", currentCV, currentLayout)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("restore rewrote history; revisions=%d", count)
	}
}

func TestCVCommitRollsBackCurrentStateAndHistoryOnLayoutWriteFailure(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	if _, err := db.Exec(`CREATE OR REPLACE FUNCTION test_fail_revision_layout_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional layout write failure'; END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER test_fail_revision_layout_write_trigger BEFORE UPDATE OF layout ON cv_documents FOR EACH ROW EXECUTE FUNCTION test_fail_revision_layout_write()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TRIGGER IF EXISTS test_fail_revision_layout_write_trigger ON cv_documents`)
		_, _ = db.Exec(`DROP FUNCTION IF EXISTS test_fail_revision_layout_write()`)
	})
	updatedCV := validRevisionCV("Broken", "Broken User")
	updatedLayout := orderedRevisionLayout("footer")
	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(updatedCV, updatedLayout, "user", "must roll back"))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var currentProfile, currentCV, currentLayout []byte
	if err := db.QueryRow(`SELECT data FROM profiles WHERE id=$1`, f.profileID).Scan(&currentProfile); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT profile_snapshot, layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&currentCV, &currentLayout); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(currentProfile, f.profile) || !jsonEqual(currentCV, f.profile) || !jsonEqual(currentLayout, f.layout) {
		t.Fatalf("failed commit leaked current state: profile=%s snapshot=%s layout=%s", currentProfile, currentCV, currentLayout)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, f.cvID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed commit leaked %d revisions", count)
	}
}

func jsonEqual(a, b []byte) bool {
	var left, right any
	return json.Unmarshal(a, &left) == nil && json.Unmarshal(b, &right) == nil && reflect.DeepEqual(left, right)
}
