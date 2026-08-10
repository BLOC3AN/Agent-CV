package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
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
		profile:    json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Original","language":"vi","sections":{"intro":{"fullName":"Original User"}}}`),
		layout:     json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true}]}`),
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

func revisionCommitBody(cv json.RawMessage, layout json.RawMessage, source, message string) map[string]any {
	return map[string]any{"cv": cv, "layout": layout, "source": source, "message": message}
}

func TestCVCommitCreatesRevisionAndUpdatesContentAndLayoutTogether(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	updatedCV := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Committed","language":"vi","sections":{"intro":{"fullName":"Committed User"}}}`)
	updatedLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"summary","type":"summary","visible":true},{"id":"header","type":"header","visible":true}]}`)
	handler := NewServerWithDB(db, "").Routes()
	w := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(updatedCV, updatedLayout, "user", "Save draft"))
	if w.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		CV       map[string]any `json:"cv"`
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
	if response.CV["layout"] == nil || response.Revision.ProfileSnapshot["title"] != "Committed" || response.Revision.Layout["version"] != float64(1) {
		t.Fatalf("response does not contain committed CV and layout: %s", w.Body)
	}
	var currentProfile, currentCV, currentLayout []byte
	if err := db.QueryRow(`SELECT data FROM profiles WHERE id=$1`, f.profileID).Scan(&currentProfile); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT profile_snapshot, layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&currentCV, &currentLayout); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(currentProfile, updatedCV) || !jsonEqual(currentCV, updatedCV) || !jsonEqual(currentLayout, updatedLayout) {
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
		} `json:"cv"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.CV.Layout.Version != 1 || len(response.CV.Layout.Nodes) != 9 {
		t.Fatalf("legacy layout was not normalized: %s", w.Body)
	}
}

func TestCVRevisionPreviewAndRestorePreserveHistory(t *testing.T) {
	db := cvRevisionDB(t)
	f := createCVRevisionFixture(t, db)
	handler := NewServerWithDB(db, "").Routes()
	firstCV := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"First","language":"vi","sections":{"intro":{"fullName":"First User"}}}`)
	firstLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true}]}`)
	secondCV := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Second","language":"vi","sections":{"intro":{"fullName":"Second User"}}}`)
	secondLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"summary","type":"summary","visible":true}]}`)
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
	second := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/commit", f.token, revisionCommitBody(secondCV, secondLayout, "ai", "second"))
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
	restored := cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+f.cvID+"/revisions/"+firstResponse.Revision.ID+"/restore", f.token, nil)
	if restored.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", restored.Code, restored.Body)
	}
	var restoredResponse struct {
		Revision struct {
			Number           int    `json:"number"`
			Source           string `json:"source"`
			ParentRevisionID string `json:"parentRevisionId"`
		} `json:"revision"`
	}
	if err := json.Unmarshal(restored.Body.Bytes(), &restoredResponse); err != nil {
		t.Fatal(err)
	}
	if restoredResponse.Revision.Number != 3 || restoredResponse.Revision.Source != "restore" || restoredResponse.Revision.ParentRevisionID != firstResponse.Revision.ID {
		t.Fatalf("restore revision=%+v", restoredResponse.Revision)
	}
	var currentCV, currentLayout []byte
	if err := db.QueryRow(`SELECT profile_snapshot, layout FROM cv_documents WHERE id=$1`, f.cvID).Scan(&currentCV, &currentLayout); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(currentCV, firstCV) || !jsonEqual(currentLayout, firstLayout) {
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
	updatedCV := json.RawMessage(`{"schemaVersion":2,"id":"cv-revision","title":"Broken","language":"vi","sections":{"intro":{"fullName":"Broken User"}}}`)
	updatedLayout := json.RawMessage(`{"version":1,"nodes":[{"id":"footer","type":"footer","visible":true}]}`)
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
