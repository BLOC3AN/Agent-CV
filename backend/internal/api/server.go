package api

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	jsonpatch "github.com/evanphx/json-patch/v5"
)

type Job struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Status    string         `json:"status"`
	CreatedAt time.Time      `json:"createdAt"`
	Result    map[string]any `json:"result,omitempty"`
	Error     any            `json:"error,omitempty"`
}

type Server struct {
	mu          sync.RWMutex
	jobs        map[string]*Job
	db          *sql.DB
	storageRoot string
}

func NewServer() *Server { return &Server{jobs: make(map[string]*Job)} }

// NewServerWithDB enables the production path. The zero-dependency constructor
// remains useful for unit tests and local smoke tests.
func NewServerWithDB(db *sql.DB, storageRoot string) *Server {
	return &Server{jobs: make(map[string]*Job), db: db, storageRoot: storageRoot}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/auth/request", s.authRequest)
	mux.HandleFunc("GET /api/auth/verify", s.authVerify)
	mux.HandleFunc("POST /api/auth/logout", s.authLogout)
	mux.HandleFunc("POST /api/profiles", s.createProfile)
	mux.HandleFunc("PATCH /api/profiles/", s.patchProfile)
	mux.HandleFunc("GET /api/profiles/", s.profileSubresource)
	mux.HandleFunc("POST /api/profiles/", s.profileMutation)
	mux.HandleFunc("POST /api/cv", s.createCV)
	mux.HandleFunc("GET /api/cv/", s.cvRoute)
	mux.HandleFunc("PATCH /api/cv/", s.cvRoute)
	mux.HandleFunc("DELETE /api/cv/", s.cvRoute)
	mux.HandleFunc("POST /api/uploads/cv", s.uploadCV)
	mux.HandleFunc("GET /api/jobs/", s.job)
	mux.HandleFunc("DELETE /api/jobs/", s.job)
	mux.HandleFunc("GET /api/imports/", s.importRoute)
	mux.HandleFunc("POST /api/imports/", s.importComplete)
	mux.HandleFunc("DELETE /api/account", s.deleteAccount)
	mux.HandleFunc("GET /api/kb", s.kbRoute)
	mux.HandleFunc("PATCH /api/kb", s.kbRoute)
	mux.HandleFunc("POST /api/kb/citations", s.kbCitations)
	mux.HandleFunc("POST /api/analyze", s.startAnalyze)
	mux.HandleFunc("GET /api/analyze/", s.getAnalyze)
	return withJSON(mux)
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "backend-go"})
}

func (s *Server) createProfile(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	var body struct {
		Profile json.RawMessage `json:"profile"`
		UserID  string          `json:"userId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body) != nil || len(body.Profile) == 0 || string(body.Profile) == "null" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Profile không hợp lệ"})
		return
	}
	userID := strings.TrimSpace(body.UserID)
	if userID == "" {
		userID = s.currentUserID(r)
	}
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var id, language string
	var profile map[string]any
	if json.Unmarshal(body.Profile, &profile) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Profile phải là object JSON"})
		return
	}
	language, _ = profile["language"].(string)
	if language != "en" {
		language = "vi"
	}
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO profiles (user_id, data, language) VALUES ($1, $2::jsonb, $3) RETURNING id`, userID, string(body.Profile), language).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không tạo được profile"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "profile": profile})
}

func (s *Server) createCV(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV cần PostgreSQL"})
		return
	}
	var body struct {
		Name     string `json:"name"`
		Headline string `json:"headline"`
		Email    string `json:"email"`
		Phone    string `json:"phone"`
		Language string `json:"language"`
		UserID   string `json:"userId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&body) != nil || strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Bạn cần điền họ tên"})
		return
	}
	userID := strings.TrimSpace(body.UserID)
	if userID == "" {
		userID = s.currentUserID(r)
	}
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	if body.Language != "en" {
		body.Language = "vi"
	}
	basics := map[string]any{"name": strings.TrimSpace(body.Name)}
	if strings.TrimSpace(body.Headline) != "" {
		basics["headline"] = strings.TrimSpace(body.Headline)
	}
	if strings.TrimSpace(body.Email) != "" {
		basics["email"] = strings.TrimSpace(body.Email)
	}
	if strings.TrimSpace(body.Phone) != "" {
		basics["phone"] = strings.TrimSpace(body.Phone)
	}
	profile := map[string]any{"schemaVersion": 1, "language": body.Language, "basics": basics, "_meta": map[string]any{"source": "manual", "verified": map[string]any{}}}
	profileJSON := jsonString(profile)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var profileID, cvID string
	if err = tx.QueryRowContext(r.Context(), `INSERT INTO profiles (user_id, data, language) VALUES ($1,$2::jsonb,$3) RETURNING id`, userID, profileJSON, body.Language).Scan(&profileID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không tạo được profile"})
		return
	}
	if err = tx.QueryRowContext(r.Context(), `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`, userID, profileID, profileJSON, strings.TrimSpace(body.Name), body.Language).Scan(&cvID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không tạo được CV"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được CV"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"cvId": cvID, "profileId": profileID})
}

func (s *Server) cvRoute(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV cần PostgreSQL"})
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/cv/"), "/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.getCV(w, r, id)
	case http.MethodPatch:
		s.patchCV(w, r, id)
	case http.MethodDelete:
		s.deleteCV(w, r, id)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method không hỗ trợ"})
	}
}

func (s *Server) getCV(w http.ResponseWriter, r *http.Request, id string) {
	var cv map[string]any = make(map[string]any)
	var profileRaw, themeRaw, layoutRaw []byte
	var cvID string
	var title, language, templateID string
	var updated time.Time
	err := s.db.QueryRowContext(r.Context(), `SELECT id, profile_snapshot, template_id, theme, layout, language, title, updated_at FROM cv_documents WHERE id = $1`, id).Scan(&cvID, &profileRaw, &templateID, &themeRaw, &layoutRaw, &language, &title, &updated)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	cv["id"] = cvID
	var snapshot, theme, layout any
	_ = json.Unmarshal(profileRaw, &snapshot)
	_ = json.Unmarshal(themeRaw, &theme)
	_ = json.Unmarshal(layoutRaw, &layout)
	cv["profileSnapshot"] = snapshot
	cv["templateId"] = templateID
	cv["theme"] = theme
	cv["layout"] = layout
	cv["language"] = language
	cv["title"] = title
	cv["updatedAt"] = updated
	writeJSON(w, http.StatusOK, map[string]any{"cv": cv})
}

func (s *Server) patchCV(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Title      *string         `json:"title"`
		TemplateID *string         `json:"templateId"`
		Theme      json.RawMessage `json:"theme"`
		Layout     json.RawMessage `json:"layout"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 512<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	sets, args := []string{}, []any{}
	n := 1
	if body.Title != nil {
		sets = append(sets, fmt.Sprintf("title = $%d", n))
		args = append(args, *body.Title)
		n++
	}
	if body.TemplateID != nil {
		sets = append(sets, fmt.Sprintf("template_id = $%d", n))
		args = append(args, *body.TemplateID)
		n++
	}
	if len(body.Theme) > 0 {
		sets = append(sets, fmt.Sprintf("theme = $%d::jsonb", n))
		args = append(args, string(body.Theme))
		n++
	}
	if len(body.Layout) > 0 {
		sets = append(sets, fmt.Sprintf("layout = $%d::jsonb", n))
		args = append(args, string(body.Layout))
		n++
	}
	if len(sets) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không có gì để đổi"})
		return
	}
	args = append(args, id)
	var cvID string
	err := s.db.QueryRowContext(r.Context(), "UPDATE cv_documents SET "+strings.Join(sets, ", ")+fmt.Sprintf(" WHERE id = $%d RETURNING id", n), args...).Scan(&cvID)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không cập nhật được CV"})
		return
	}
	s.getCV(w, r, cvID)
}

func (s *Server) deleteCV(w http.ResponseWriter, r *http.Request, id string) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var profileID string
	if err = tx.QueryRowContext(r.Context(), `DELETE FROM cv_documents WHERE id = $1 RETURNING profile_id`, id).Scan(&profileID); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profiles WHERE id = $1`, profileID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không xóa được profile"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được xóa CV"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/profiles/")
	id = strings.TrimSuffix(id, "/")
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1`, id).Scan(&raw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã profile không hợp lệ"})
		return
	}
	var profile any
	if json.Unmarshal(raw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Profile bị hỏng"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) patchProfile(w http.ResponseWriter, r *http.Request) {
	id, suffix := profilePath(r.URL.Path)
	if suffix != "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy route"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	var body struct {
		Ops       json.RawMessage `json:"ops"`
		Author    string          `json:"author"`
		MessageID string          `json:"messageId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body) != nil || len(body.Ops) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	var ops []any
	if json.Unmarshal(body.Ops, &ops) != nil || len(ops) == 0 || len(ops) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ops không hợp lệ"})
		return
	}
	if body.Author == "" {
		body.Author = "user"
	}
	if body.Author != "user" && body.Author != "ai" && body.Author != "import" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "author không hợp lệ"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var old []byte
	if err = tx.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 FOR UPDATE`, id).Scan(&old); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã profile không hợp lệ"})
		return
	}
	updated, err := applyJSONPatch(old, body.Ops)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Patch không áp dụng được: " + err.Error()})
		return
	}
	var revisionID int64
	var messageArg any
	if body.MessageID != "" {
		messageArg = body.MessageID
	}
	err = tx.QueryRowContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 RETURNING id`, id, string(updated)).Scan(new(string))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được profile"})
		return
	}
	err = tx.QueryRowContext(r.Context(), `INSERT INTO profile_revisions (profile_id, patch, inverse, author, message_id) VALUES ($1,$2::jsonb,$3::jsonb,$4,$5) RETURNING id`, id, string(body.Ops), jsonString(map[string]any{"snapshot": json.RawMessage(old)}), body.Author, messageArg).Scan(&revisionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được revision"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được profile"})
		return
	}
	var profile any
	_ = json.Unmarshal(updated, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "revisionId": revisionID, "applied": len(ops), "rejected": []any{}})
}

func (s *Server) profileSubresource(w http.ResponseWriter, r *http.Request) {
	id, suffix := profilePath(r.URL.Path)
	if suffix == "" {
		s.getProfile(w, r)
		return
	}
	if suffix != "revisions" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy route"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, author, patch, created_at FROM profile_revisions WHERE profile_id = $1 ORDER BY id DESC`, id)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã profile không hợp lệ"})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var revisionID int64
		var author string
		var patchRaw []byte
		var created time.Time
		if rows.Scan(&revisionID, &author, &patchRaw, &created) != nil {
			continue
		}
		var patch any
		_ = json.Unmarshal(patchRaw, &patch)
		items = append(items, map[string]any{"id": revisionID, "author": author, "patch": patch, "createdAt": created})
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": items})
}

func (s *Server) profileMutation(w http.ResponseWriter, r *http.Request) {
	id, suffix := profilePath(r.URL.Path)
	if suffix == "verify" {
		s.verifyProfile(w, r, id)
		return
	}
	if suffix == "revert" {
		s.revertProfile(w, r, id)
		return
	}
	if suffix != "undo" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy route"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var revisionID int64
	var inverse []byte
	err = tx.QueryRowContext(r.Context(), `SELECT id, inverse FROM profile_revisions WHERE profile_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`, id).Scan(&revisionID, &inverse)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Không có gì để hoàn tác"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã profile không hợp lệ"})
		return
	}
	var snapshot struct {
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if json.Unmarshal(inverse, &snapshot) != nil || len(snapshot.Snapshot) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Revision không hợp lệ"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1`, id, string(snapshot.Snapshot)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không undo được profile"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profile_revisions WHERE id = $1`, revisionID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không cập nhật lịch sử"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được undo"})
		return
	}
	var profile any
	_ = json.Unmarshal(snapshot.Snapshot, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) verifyProfile(w http.ResponseWriter, r *http.Request, id string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	var body struct {
		Paths    []string `json:"paths"`
		Verified *bool    `json:"verified"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&body) != nil || len(body.Paths) == 0 || len(body.Paths) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	verified := true
	if body.Verified != nil {
		verified = *body.Verified
	}
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1`, id).Scan(&raw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy hồ sơ"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã profile không hợp lệ"})
		return
	}
	var profile map[string]any
	if json.Unmarshal(raw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Profile bị hỏng"})
		return
	}
	meta, _ := profile["_meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	marks, _ := meta["verified"].(map[string]any)
	if marks == nil {
		marks = map[string]any{}
	}
	for _, path := range body.Paths {
		if !strings.HasPrefix(path, "/") {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Path không hợp lệ"})
			return
		}
		marks[path] = verified
	}
	meta["verified"] = marks
	profile["_meta"] = meta
	updated := jsonString(profile)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1`, id, updated); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được xác nhận"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "progress": map[string]any{"complete": verified}})
}

func (s *Server) revertProfile(w http.ResponseWriter, r *http.Request, id string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile cần PostgreSQL"})
		return
	}
	var body struct {
		RevisionID string `json:"revisionId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || body.RevisionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Thiếu revisionId"})
		return
	}
	var snapshot []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT inverse->'snapshot' FROM profile_revisions WHERE profile_id = $1 AND id = $2`, id, body.RevisionID).Scan(&snapshot); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không có mốc lịch sử này"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Revision không hợp lệ"})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1`, id, string(snapshot)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không khôi phục được profile"})
		return
	}
	var profile any
	_ = json.Unmarshal(snapshot, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func profilePath(path string) (string, string) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(path, "/api/profiles/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", ""
	}
	suffix := ""
	if len(parts) > 1 {
		suffix = parts[1]
	}
	return parts[0], suffix
}

func applyJSONPatch(document, rawOps []byte) ([]byte, error) {
	patch, err := jsonpatch.DecodePatch(rawOps)
	if err != nil {
		return nil, err
	}
	return patch.Apply(document)
}

func (s *Server) uploadCV(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "multipart form không hợp lệ"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Thiếu file"})
		return
	}
	defer file.Close()
	bytes, err := io.ReadAll(io.LimitReader(file, 12<<20+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không đọc được file"})
		return
	}
	if len(bytes) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "File rỗng"})
		return
	}
	if len(bytes) > 12<<20 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "File vượt 12MB"})
		return
	}
	if len(bytes) < 4 || string(bytes[:4]) != "%PDF" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "File không phải PDF"})
		return
	}

	id := r.FormValue("uploadId")
	if id == "" {
		id = newID()
	}
	userID := strings.TrimSpace(r.FormValue("userId"))
	if userID == "" {
		userID = s.currentUserID(r)
	}
	key := contentKey(bytes)
	if s.storageRoot != "" {
		if err := os.MkdirAll(s.storageRoot, 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được storage"})
			return
		}
		if err := os.WriteFile(filepath.Join(s.storageRoot, key), bytes, 0o644); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được file"})
			return
		}
	}

	if s.db != nil {
		var jobID string
		var status string
		err := s.db.QueryRowContext(r.Context(), `
			WITH prev AS (SELECT status FROM jobs WHERE idempotency_key = $3), upsert AS (
				INSERT INTO jobs (user_id, kind, idempotency_key, payload)
				VALUES (NULLIF($1, '')::uuid, 'parse_cv', $2, $3::jsonb)
				ON CONFLICT (idempotency_key) DO UPDATE SET
					status = CASE WHEN jobs.status IN ('failed','cancelled') THEN 'queued' ELSE jobs.status END,
					payload = CASE WHEN jobs.status IN ('failed','cancelled') THEN EXCLUDED.payload ELSE jobs.payload END,
					error = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.error END,
					started_at = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.started_at END,
					finished_at = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.finished_at END
				RETURNING id, status
			) SELECT id, status FROM upsert`,
			userID, "parse_cv:"+userID+":"+id,
			jsonString(map[string]any{"storageKey": key, "filename": header.Filename, "uploadId": id})).Scan(&jobID, &status)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được job"})
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID, "queued": status == "queued", "uploadId": id})
		return
	}

	job := &Job{ID: id, Kind: "parse_cv", Status: "queued", CreatedAt: time.Now().UTC()}
	s.mu.Lock()
	s.jobs[id] = job
	s.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": id, "queued": true})
}

func (s *Server) job(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/jobs/")
	if strings.HasSuffix(id, "/stream") {
		s.streamJob(w, r, strings.TrimSuffix(id, "/stream"))
		return
	}
	if r.Method == http.MethodDelete {
		s.cancelJob(w, r, id)
		return
	}
	if s.db != nil {
		var job Job
		var result, errorText sql.NullString
		err := s.db.QueryRowContext(r.Context(), `SELECT id, kind, status, created_at, COALESCE(result::text, ''), COALESCE(error, '') FROM jobs WHERE id = $1`, id).
			Scan(&job.ID, &job.Kind, &job.Status, &job.CreatedAt, &result, &errorText)
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được job"})
			return
		}
		if result.Valid && result.String != "" {
			_ = json.Unmarshal([]byte(result.String), &job.Result)
		}
		if errorText.Valid && errorText.String != "" {
			job.Error = errorText.String
		}
		writeJSON(w, http.StatusOK, job)
		return
	}
	s.mu.RLock()
	job := s.jobs[id]
	s.mu.RUnlock()
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request, id string) {
	if s.db != nil {
		result, err := s.db.ExecContext(r.Context(), `UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status IN ('queued','running')`, id)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã job không hợp lệ"})
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Job không thể huỷ"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if job := s.jobs[id]; job != nil && (job.Status == "queued" || job.Status == "running") {
		job.Status = "cancelled"
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})
		return
	}
	writeJSON(w, http.StatusConflict, map[string]string{"error": "Job không thể huỷ"})
}

func (s *Server) streamJob(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Streaming không được hỗ trợ"})
		return
	}
	for {
		var status string
		var result, errText sql.NullString
		if s.db != nil {
			err := s.db.QueryRowContext(r.Context(), `SELECT status, COALESCE(result::text,''), COALESCE(error,'') FROM jobs WHERE id = $1`, id).Scan(&status, &result, &errText)
			if err == sql.ErrNoRows {
				fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Không tìm thấy job\"}\n\n")
				flusher.Flush()
				return
			}
		} else {
			s.mu.RLock()
			job := s.jobs[id]
			if job == nil {
				s.mu.RUnlock()
				fmt.Fprint(w, "event: error\ndata: {\"error\":\"Không tìm thấy job\"}\n\n")
				flusher.Flush()
				return
			}
			status = job.Status
			s.mu.RUnlock()
		}
		data := map[string]any{"id": id, "status": status}
		if result.Valid && result.String != "" {
			var resultValue any
			_ = json.Unmarshal([]byte(result.String), &resultValue)
			data["result"] = resultValue
		}
		if errText.Valid && errText.String != "" {
			data["error"] = errText.String
		}
		encoded, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: job\ndata: %s\n\n", encoded)
		flusher.Flush()
		if status == "done" || status == "failed" || status == "cancelled" {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (s *Server) importRoute(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/imports/"), "/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã job không hợp lệ"})
		return
	}
	if strings.HasSuffix(id, "/complete") {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "Import complete chưa chuyển sang Go"})
		return
	}
	r.URL.Path = "/api/jobs/" + id
	s.job(w, r)
}

func (s *Server) importComplete(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/imports/"), "/complete"), "/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã job không hợp lệ"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import cần PostgreSQL"})
		return
	}
	var userID, status string
	var resultRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT user_id, status, COALESCE(result,'{}') FROM jobs WHERE id = $1`, id).Scan(&userID, &status, &resultRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã job không hợp lệ"})
		return
	}
	if status != "done" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Job đang ở trạng thái " + status})
		return
	}
	var result map[string]any
	_ = json.Unmarshal(resultRaw, &result)
	profileID, _ := result["profileId"].(string)
	if profileID == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Job không có hồ sơ"})
		return
	}
	var existing string
	if err := s.db.QueryRowContext(r.Context(), `SELECT id FROM cv_documents WHERE profile_id = $1 ORDER BY created_at LIMIT 1`, profileID).Scan(&existing); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"cvId": existing, "created": false})
		return
	}
	var profileRaw []byte
	var language, title string
	if err := s.db.QueryRowContext(r.Context(), `SELECT data, language, COALESCE(data->'basics'->>'name','CV của tôi') FROM profiles WHERE id = $1`, profileID).Scan(&profileRaw, &language, &title); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy hồ sơ"})
		return
	}
	var cvID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`, userID, profileID, string(profileRaw), title, language).Scan(&cvID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được CV"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"cvId": cvID, "created": true})
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Account cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var body struct {
		ConfirmEmail string `json:"confirmEmail"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || strings.TrimSpace(body.ConfirmEmail) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Thiếu xác nhận"})
		return
	}
	var email string
	if err := s.db.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil || !strings.EqualFold(strings.TrimSpace(body.ConfirmEmail), email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Email xác nhận không khớp với tài khoản đang đăng nhập."})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không xoá được tài khoản"})
		return
	}
	s.authLogout(w, r)
}

func (s *Server) kbRoute(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "KB cần PostgreSQL"})
		return
	}
	if r.Method == http.MethodPatch {
		s.patchKB(w, r)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT s.id, s.title, s.author_name, s.author_title, s.language, s.status, s.version, (SELECT count(*) FROM kb_chunks c WHERE c.source_id=s.id) FROM kb_sources s ORDER BY s.created_at DESC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được KB"})
		return
	}
	defer rows.Close()
	sources := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, author, language, status string
		var authorTitle sql.NullString
		var version, count int
		if rows.Scan(&id, &title, &author, &authorTitle, &language, &status, &version, &count) != nil {
			continue
		}
		sources = append(sources, map[string]any{"id": id, "title": title, "authorName": author, "authorTitle": authorTitle.String, "language": language, "status": status, "version": version, "chunkCount": count, "canActivate": strings.TrimSpace(author) != "" && author != "Chưa có người duyệt"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) patchKB(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SourceID    string  `json:"sourceId"`
		Status      *string `json:"status"`
		AuthorName  *string `json:"authorName"`
		AuthorTitle *string `json:"authorTitle"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || body.SourceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	if body.Status != nil && *body.Status == "active" && (body.AuthorName == nil || strings.TrimSpace(*body.AuthorName) == "" || *body.AuthorName == "Chưa có người duyệt") {
		var author string
		_ = s.db.QueryRowContext(r.Context(), `SELECT author_name FROM kb_sources WHERE id=$1`, body.SourceID).Scan(&author)
		if strings.TrimSpace(author) == "" || author == "Chưa có người duyệt" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Chưa thể kích hoạt khi thiếu người chịu trách nhiệm"})
			return
		}
	}
	result, err := s.db.ExecContext(r.Context(), `UPDATE kb_sources SET status=COALESCE($2,status), author_name=COALESCE($3,author_name), author_title=COALESCE($4,author_title) WHERE id=$1`, body.SourceID, body.Status, body.AuthorName, body.AuthorTitle)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không cập nhật được nguồn"})
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy nguồn"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) kbCitations(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "KB cần PostgreSQL"})
		return
	}
	var body struct {
		ChunkIDs []string `json:"chunkIds"`
		Language string   `json:"language"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || len(body.ChunkIDs) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	if body.Language != "en" {
		body.Language = "vi"
	}
	citations := make([]map[string]any, 0)
	for _, id := range body.ChunkIDs {
		var text, title, author, authorTitle string
		err := s.db.QueryRowContext(r.Context(), `SELECT c.text,s.title,s.author_name,COALESCE(s.author_title,'') FROM kb_chunks c JOIN kb_sources s ON s.id=c.source_id WHERE (c.id::text=$1 OR c.breadcrumb=$1) AND c.language=$2 AND s.status='active'`, id, body.Language).Scan(&text, &title, &author, &authorTitle)
		if err == nil {
			citations = append(citations, map[string]any{"chunkId": id, "text": text, "title": title, "authorName": author, "authorTitle": authorTitle})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"citations": citations})
}

func (s *Server) startAnalyze(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analyze cần PostgreSQL"})
		return
	}
	var body struct {
		CVID          string `json:"cvId"`
		JDText        string `json:"jdText"`
		SourceURL     string `json:"sourceUrl"`
		Language      string `json:"language"`
		CreateVariant bool   `json:"createVariant"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil || body.CVID == "" || len(strings.TrimSpace(body.JDText)) < 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mô tả công việc quá ngắn hoặc body không hợp lệ"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	if body.Language != "en" {
		body.Language = "vi"
	}
	var owns string
	if err := s.db.QueryRowContext(r.Context(), `SELECT id FROM cv_documents WHERE id=$1 AND user_id=$2`, body.CVID, userID).Scan(&owns); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	var jdID, jobID string
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO job_descriptions (user_id, raw_text, source_url, language) VALUES ($1,$2,NULLIF($3,''),$4) RETURNING id`, userID, body.JDText, body.SourceURL, body.Language).Scan(&jdID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được JD"})
		return
	}
	payload := jsonString(map[string]any{"cvId": body.CVID, "jdId": jdID, "createVariant": body.CreateVariant})
	key := "match_analysis:" + body.CVID + ":" + jdID
	err = s.db.QueryRowContext(r.Context(), `INSERT INTO jobs (user_id, kind, idempotency_key, payload) VALUES ($1,'match_analysis',$2,$3::jsonb) ON CONFLICT (idempotency_key) DO UPDATE SET status=jobs.status RETURNING id`, userID, key, payload).Scan(&jobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được job phân tích"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID, "cvId": body.CVID, "jdId": jdID, "variantCreated": false, "queued": true})
}

func (s *Server) getAnalyze(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analyze cần PostgreSQL"})
		return
	}
	cvID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/analyze/"), "/")
	if cvID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	var id, jdID string
	var scoreRaw, matchedRaw, gapsRaw []byte
	var degraded bool
	var created time.Time
	var title, seniority sql.NullString
	err := s.db.QueryRowContext(r.Context(), `SELECT m.id,m.score,m.matched,m.gaps,m.degraded,m.created_at,m.jd_id,j.requirements->>'title',j.requirements->>'seniority' FROM match_analyses m JOIN job_descriptions j ON j.id=m.jd_id WHERE m.cv_id=$1 ORDER BY m.created_at DESC LIMIT 1`, cvID).Scan(&id, &scoreRaw, &matchedRaw, &gapsRaw, &degraded, &created, &jdID, &title, &seniority)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusOK, map[string]bool{"ready": false})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	var score map[string]any
	var matched, gaps any
	_ = json.Unmarshal(scoreRaw, &score)
	_ = json.Unmarshal(matchedRaw, &matched)
	_ = json.Unmarshal(gapsRaw, &gaps)
	writeJSON(w, http.StatusOK, map[string]any{"ready": true, "id": id, "jd": map[string]any{"id": jdID, "title": title.String, "seniority": seniority.String}, "overall": score["overall"], "breakdown": score["breakdown"], "matched": matched, "gaps": gaps, "missingAtsKeywords": score["missingAtsKeywords"], "degraded": degraded, "degradedReason": score["degradedReason"], "createdAt": created})
}

func (s *Server) authRequest(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Auth cần PostgreSQL"})
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || !strings.Contains(body.Email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Email không hợp lệ"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	token := newID() + newID()
	_, err := s.db.ExecContext(r.Context(), `
		INSERT INTO login_tokens (token_hash, email, expires_at)
		VALUES ($1, $2, now() + interval '15 minutes')`, tokenHash(token), email)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được link đăng nhập"})
		return
	}
	base := os.Getenv("APP_BASE_URL")
	if base == "" {
		base = "http://localhost:3000"
	}
	result := map[string]any{"ok": true, "sent": false}
	if os.Getenv("NODE_ENV") != "production" {
		result["devLink"] = strings.TrimRight(base, "/") + "/api/auth/verify?token=" + url.QueryEscape(token)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) authVerify(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Auth cần PostgreSQL", http.StatusServiceUnavailable)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		redirectLogin(w, r, "not_found")
		return
	}
	var email, userID string
	err := s.db.QueryRowContext(r.Context(), `
		UPDATE login_tokens SET used_at = now()
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING email`, tokenHash(token)).Scan(&email)
	if err == sql.ErrNoRows {
		redirectLogin(w, r, "expired")
		return
	}
	if err != nil {
		http.Error(w, "Không xác thực được", http.StatusInternalServerError)
		return
	}
	err = s.db.QueryRowContext(r.Context(), `
		INSERT INTO users (email) VALUES ($1)
		ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		RETURNING id`, email).Scan(&userID)
	if err != nil {
		http.Error(w, "Không tạo được tài khoản", http.StatusInternalServerError)
		return
	}
	session := newID() + newID()
	_, err = s.db.ExecContext(r.Context(), `
		INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
		VALUES ($1, $2, now() + interval '30 days', $3)`, tokenHash(session), userID, r.UserAgent())
	if err != nil {
		http.Error(w, "Không tạo được phiên", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "hr_session", Value: session, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600, Secure: r.TLS != nil})
	base := os.Getenv("APP_BASE_URL")
	if base == "" {
		base = "http://localhost:3000"
	}
	http.Redirect(w, r, strings.TrimRight(base, "/"), http.StatusFound)
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if s.db != nil {
		if c, err := r.Cookie("hr_session"); err == nil {
			_, _ = s.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, tokenHash(c.Value))
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "hr_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) currentUserID(r *http.Request) string {
	if s.db == nil {
		return ""
	}
	c, err := r.Cookie("hr_session")
	if err != nil {
		return ""
	}
	var id string
	if s.db.QueryRowContext(r.Context(), `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`, tokenHash(c.Value)).Scan(&id) != nil {
		return ""
	}
	return id
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func redirectLogin(w http.ResponseWriter, r *http.Request, reason string) {
	base := os.Getenv("APP_BASE_URL")
	if base == "" {
		base = "http://localhost:3000"
	}
	http.Redirect(w, r, strings.TrimRight(base, "/")+"/login?error="+url.QueryEscape(reason), http.StatusFound)
}

func contentKey(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return "cv-" + hex.EncodeToString(sum[:]) + ".pdf"
}

func jsonString(v any) string { b, _ := json.Marshal(v); return string(b) }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(b)
}
