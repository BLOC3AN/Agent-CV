//go:build integration

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

func integrationDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:hragent_dev@localhost:5433/hragent"
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("integration database unavailable: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Skipf("integration database unavailable: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

type integrationFixture struct {
	userID, otherUserID, profileID, cvID, token string
}

func createIntegrationFixture(t *testing.T, db *sql.DB, backfilled bool) integrationFixture {
	t.Helper()
	f := integrationFixture{token: "integration-token-" + t.Name()}
	profileV1 := `{"schemaVersion":1,"basics":{"name":"Integration User","email":"integration@example.com","phone":"0900000000"},"work":[]}`
	profileV2 := `{"schemaVersion":2,"id":"cv-integration","title":"Integration","language":"vi","sections":{"intro":{"fullName":"Integration User"}}}`
	dataV2 := "NULL"
	if backfilled {
		dataV2 = "$3::jsonb"
	}
	args := []any{}
	if backfilled {
		args = append(args, profileV2)
	}
	query := `WITH u AS (INSERT INTO users(email) VALUES ($1) RETURNING id),
	 p AS (INSERT INTO profiles(user_id,data,data_v2,language) SELECT id,$2::jsonb,` + dataV2 + `,'vi' FROM u RETURNING id,user_id),
	 c AS (INSERT INTO cv_documents(user_id,profile_id,profile_snapshot,title,language)
	 SELECT p.user_id,p.id,$2::jsonb,'Integration CV','vi' FROM p RETURNING id,user_id,profile_id)
	 SELECT (SELECT id FROM u), (SELECT id FROM p), (SELECT id FROM c)`
	args = append([]any{f.token + "@example.com", profileV1}, args...)
	if err := db.QueryRow(query, args...).Scan(&f.userID, &f.profileID, &f.cvID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, f.userID, tokenHash(f.token)); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO users(email) VALUES ($1) RETURNING id`, f.token+"-other@example.com").Scan(&f.otherUserID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM users WHERE id IN ($1,$2)`, f.userID, f.otherUserID)
	})
	return f
}

func integrationRequest(t *testing.T, handler http.Handler, method, path, token string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "hr_session", Value: token})
	req.Header.Set("X-CV-Schema", "2")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestIntegrationPatchCVPairIsAtomic(t *testing.T) {
	db := integrationDB(t)
	f := createIntegrationFixture(t, db, true)
	_, err := db.Exec(`CREATE OR REPLACE FUNCTION test_fail_cv_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional second update failure'; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TRIGGER test_fail_cv_update_trigger BEFORE UPDATE ON cv_documents FOR EACH ROW EXECUTE FUNCTION test_fail_cv_update()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TRIGGER IF EXISTS test_fail_cv_update_trigger ON cv_documents`)
		_, _ = db.Exec(`DROP FUNCTION IF EXISTS test_fail_cv_update()`)
	})
	body := []byte(`{"cv":{"schemaVersion":2},"profile":{"schemaVersion":1,"basics":{}}}`)
	w := integrationRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPatch, "/api/cv/"+f.cvID, f.token, body)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var got string
	if err := db.QueryRow(`SELECT data::text FROM profiles WHERE id=$1`, f.profileID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	profileV1 := `{"schemaVersion":1,"basics":{"name":"Integration User","email":"integration@example.com","phone":"0900000000"},"work":[]}`
	var restored, original any
	if json.Unmarshal([]byte(got), &restored) != nil || json.Unmarshal([]byte(profileV1), &original) != nil || !reflect.DeepEqual(restored, original) {
		t.Fatalf("profile changed after failed pair update: %s", got)
	}
}

func TestIntegrationGetCVNotBackfilledReturnsConflict(t *testing.T) {
	db := integrationDB(t)
	f := createIntegrationFixture(t, db, false)
	w := integrationRequest(t, NewServerWithDB(db, "").Routes(), http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["code"] != "V2_NOT_BACKFILLED" {
		t.Fatalf("body=%s", w.Body)
	}
}

func TestIntegrationGetCVRejectsMismatchedProfileOwner(t *testing.T) {
	db := integrationDB(t)
	f := createIntegrationFixture(t, db, true)
	if _, err := db.Exec(`UPDATE cv_documents SET user_id=$1 WHERE id=$2`, f.userID, f.cvID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE profiles SET user_id=$1 WHERE id=$2`, f.otherUserID, f.profileID); err != nil {
		t.Fatal(err)
	}
	w := integrationRequest(t, NewServerWithDB(db, "").Routes(), http.MethodGet, "/api/cv/"+f.cvID, f.token, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s; expected no v2 content for mismatched owner", w.Code, w.Body)
	}
}
