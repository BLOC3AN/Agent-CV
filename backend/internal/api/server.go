package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	jsonpatch "github.com/evanphx/json-patch/v5"
	"github.com/phpdave11/gofpdf"
	"github.com/redis/go-redis/v9"
	"go.yaml.in/yaml/v3"
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
	redis       *redis.Client
}

type chatModelProposal struct {
	Summary string            `json:"summary"`
	Ops     []json.RawMessage `json:"ops"`
}

type chatModelOutput struct {
	Kind    string            `json:"kind"`
	Text    string            `json:"text"`
	Summary string            `json:"summary"`
	Ops     []json.RawMessage `json:"ops"`
}

func NewServer() *Server { return &Server{jobs: make(map[string]*Job)} }

// NewServerWithDB enables the production path. The zero-dependency constructor
// remains useful for unit tests and local smoke tests.
func NewServerWithDB(db *sql.DB, storageRoot string) *Server {
	var client *redis.Client
	if raw := os.Getenv("REDIS_URL"); raw != "" {
		if opts, err := redis.ParseURL(raw); err == nil {
			client = redis.NewClient(opts)
		}
	}
	return &Server{jobs: make(map[string]*Job), db: db, storageRoot: storageRoot, redis: client}
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
	mux.HandleFunc("POST /api/chat", s.chat)
	mux.HandleFunc("POST /api/chat/proposals/", s.chatProposal)
	// Compatibility endpoints used by the approved standalone frontend.
	mux.HandleFunc("POST /api/ai/chat", s.compatAIChat)
	mux.HandleFunc("POST /api/ai/quick-action", s.compatAIQuickAction)
	mux.HandleFunc("POST /api/ai/match-job", s.compatAIMatchJob)
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
	// Never trust a userId supplied by the browser. Ownership comes only from
	// the authenticated session, just like the Node route.
	userID := s.currentUserID(r)
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
	userID := s.currentUserID(r)
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
	if strings.HasSuffix(id, "/export") {
		s.exportCV(w, r, strings.TrimSuffix(id, "/export"))
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

func (s *Server) exportCV(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	variant := r.URL.Query().Get("variant")
	if variant != "ats" {
		variant = "presentation"
	}
	var title, language string
	var snapshot []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(c.title,'CV'), COALESCE(c.language, p.language, 'en'), p.data
		FROM cv_documents c JOIN profiles p ON p.id=c.profile_id
		WHERE c.id=$1 AND c.user_id=$2 AND p.user_id=$2`, id, userID).Scan(&title, &language, &snapshot); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(title, true)
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 18)
	pdf.Cell(0, 12, title)
	pdf.Ln(14)
	pdf.SetFont("Arial", "", 10)
	pdf.Cell(0, 7, "Language: "+language+" | Variant: "+variant)
	pdf.Ln(10)
	pdf.SetFont("Arial", "", 9)
	var pretty bytes.Buffer
	if json.Indent(&pretty, snapshot, "", "  ") == nil {
		for _, line := range strings.Split(pretty.String(), "\n") {
			pdf.MultiCell(0, 5, line, "", "L", false)
		}
	}
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không tạo được PDF"})
		return
	}
	safe := strings.NewReplacer("/", "-", " ", "-").Replace(title)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-%s.pdf\"", safe, variant))
	w.Header().Set("Content-Length", fmt.Sprint(out.Len()))
	_, _ = w.Write(out.Bytes())
}

func (s *Server) getCV(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var cv map[string]any = make(map[string]any)
	var profileRaw, themeRaw, layoutRaw []byte
	var cvID string
	var title, language, templateID string
	var updated time.Time
	err := s.db.QueryRowContext(r.Context(), `SELECT id, profile_snapshot, template_id, theme, layout, language, title, updated_at FROM cv_documents WHERE id = $1 AND user_id=$2`, id, userID).Scan(&cvID, &profileRaw, &templateID, &themeRaw, &layoutRaw, &language, &title, &updated)
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
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
	args = append(args, userID)
	err := s.db.QueryRowContext(r.Context(), "UPDATE cv_documents SET "+strings.Join(sets, ", ")+fmt.Sprintf(" WHERE id = $%d AND user_id = $%d RETURNING id", n, n+1), args...).Scan(&cvID)
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var profileID string
	if err = tx.QueryRowContext(r.Context(), `DELETE FROM cv_documents WHERE id = $1 AND user_id=$2 RETURNING profile_id`, id, userID).Scan(&profileID); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profiles WHERE id = $1 AND user_id=$2`, profileID, userID); err != nil {
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/profiles/")
	id = strings.TrimSuffix(id, "/")
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2`, id, userID).Scan(&raw); err == sql.ErrNoRows {
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
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
	if err = tx.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&old); err == sql.ErrNoRows {
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
	err = tx.QueryRowContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3 RETURNING id`, id, string(updated), userID).Scan(new(string))
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/profiles/"), "/"), "/")
	id, suffix := profilePath(r.URL.Path)
	if len(parts) == 3 && parts[1] == "revisions" {
		s.revisionPreview(w, r, id, parts[2])
		return
	}
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
	rows, err := s.db.QueryContext(r.Context(), `SELECT pr.id, pr.author, pr.patch, pr.created_at FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND p.user_id=$2 ORDER BY pr.id DESC LIMIT 50`, id, userID)
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
		opCount := 0
		if ops, ok := patch.([]any); ok {
			opCount = len(ops)
		}
		items = append(items, map[string]any{"id": fmt.Sprint(revisionID), "author": author, "createdAt": created, "opCount": opCount})
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": items})
}

func (s *Server) revisionPreview(w http.ResponseWriter, r *http.Request, profileID, revisionID string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Revision cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var patchRaw, inverseRaw []byte
	var author string
	var created time.Time
	if err := s.db.QueryRowContext(r.Context(), `SELECT pr.patch, pr.inverse, pr.author, pr.created_at FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id=$1 AND pr.id=$2 AND p.user_id=$3`, profileID, revisionID, userID).Scan(&patchRaw, &inverseRaw, &author, &created); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không có mốc lịch sử này"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Revision không hợp lệ"})
		return
	}
	var inverse struct {
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if json.Unmarshal(inverseRaw, &inverse) != nil || len(inverse.Snapshot) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Revision không hợp lệ"})
		return
	}
	afterRaw, err := applyJSONPatch(inverse.Snapshot, patchRaw)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Không dựng được bản CV của revision"})
		return
	}
	var before, after any
	if json.Unmarshal(inverse.Snapshot, &before) != nil || json.Unmarshal(afterRaw, &after) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Revision bị hỏng"})
		return
	}
	var ops any
	if json.Unmarshal(patchRaw, &ops) != nil {
		ops = []any{}
	}
	var newerCount int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id=$1 AND pr.id>$2 AND p.user_id=$3`, profileID, revisionID, userID).Scan(&newerCount); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không đọc được lịch sử"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisionId": fmt.Sprint(revisionID), "author": author, "createdAt": created, "ops": ops, "after": after, "before": before, "newerCount": newerCount})
}

func (s *Server) profileMutation(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
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
	err = tx.QueryRowContext(r.Context(), `SELECT pr.id, pr.inverse FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND p.user_id=$2 ORDER BY pr.id DESC LIMIT 1 FOR UPDATE`, id, userID).Scan(&revisionID, &inverse)
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
	if _, err = tx.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, string(snapshot.Snapshot), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không undo được profile"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profile_revisions WHERE id = $1 AND profile_id=$2`, revisionID, id); err != nil {
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2`, id, userID).Scan(&raw); err == sql.ErrNoRows {
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
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, updated, userID); err != nil {
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
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
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
	if err := s.db.QueryRowContext(r.Context(), `SELECT pr.inverse->'snapshot' FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND pr.id = $2 AND p.user_id=$3`, id, body.RevisionID, userID).Scan(&snapshot); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không có mốc lịch sử này"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Revision không hợp lệ"})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, string(snapshot), userID); err != nil {
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
	// A multipart field must never be able to impersonate another account.
	userID := s.currentUserID(r)
	if s.db != nil && userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
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
		userID := s.currentUserID(r)
		if userID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
			return
		}
		var job Job
		var result, errorText sql.NullString
		err := s.db.QueryRowContext(r.Context(), `SELECT id, kind, status, created_at, COALESCE(result::text, ''), COALESCE(error, '') FROM jobs WHERE id = $1 AND user_id=$2`, id, userID).
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
		userID := s.currentUserID(r)
		if userID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
			return
		}
		result, err := s.db.ExecContext(r.Context(), `UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND user_id=$2 AND status IN ('queued','running')`, id, userID)
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
	userID := s.currentUserID(r)
	if s.db != nil && userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
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
			err := s.db.QueryRowContext(r.Context(), `SELECT status, COALESCE(result::text,''), COALESCE(error,'') FROM jobs WHERE id = $1 AND user_id=$2`, id, userID).Scan(&status, &result, &errText)
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
		if status == "done" {
			fmt.Fprintf(w, "event: done\ndata: %s\n\n", encoded)
		} else if status == "failed" || status == "cancelled" {
			fmt.Fprintf(w, "event: failed\ndata: %s\n\n", encoded)
		} else {
			// UploadBox consumes the same progress contract as the Node route.
			pct := 0
			if status == "running" {
				pct = 50
			}
			progress := map[string]any{"pct": pct, "note": "Đang chuẩn bị", "status": status}
			if status == "running" {
				progress["note"] = "Đang xử lý CV…"
			}
			progressJSON, _ := json.Marshal(progress)
			fmt.Fprintf(w, "event: progress\ndata: %s\n\n", progressJSON)
		}
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
	if strings.HasSuffix(id, "/pages") {
		s.importPages(w, r, strings.TrimSuffix(id, "/pages"))
		return
	}
	if strings.HasSuffix(id, "/complete") {
		s.importComplete(w, r)
		return
	}
	s.importStatus(w, r, id)
}

// importStatus is the review-screen contract, not the generic job contract.
// Keeping this aggregation here is important: the frontend must not need to
// know that a completed import is backed by a job plus a profile row.
func (s *Server) importStatus(w http.ResponseWriter, r *http.Request, id string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var status string
	var resultRaw, errorRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT status, COALESCE(result,'{}'), COALESCE(error,'') FROM jobs WHERE id=$1 AND user_id=$2`, id, userID).Scan(&status, &resultRaw, &errorRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được job"})
		return
	}
	if status != "done" {
		var failure any
		if len(errorRaw) > 0 {
			failure = map[string]any{"code": "JOB_FAILED", "message": string(errorRaw)}
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": status, "error": failure, "ready": false})
		return
	}
	var result map[string]any
	_ = json.Unmarshal(resultRaw, &result)
	profileID, _ := result["profileId"].(string)
	if profileID == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Job không trả về profileId"})
		return
	}
	var profileRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id=$1`, profileID).Scan(&profileRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy hồ sơ"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không đọc được hồ sơ"})
		return
	}
	var profile map[string]any
	if json.Unmarshal(profileRaw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Hồ sơ không hợp lệ"})
		return
	}
	items, progress := reviewContract(profile)
	quality := map[string]any{"level": valueOr(result["quality"], "good"), "warning": result["qualityWarning"] == true, "reasons": stringSlice(result["reasons"]), "engine": result["engine"], "pages": intOr(result["pages"], 1)}
	writeJSON(w, http.StatusOK, map[string]any{"ready": true, "status": status, "profileId": profileID, "profile": profile, "items": items, "progress": progress, "quality": quality, "sections": result["sections"]})
}

func reviewContract(profile map[string]any) ([]map[string]any, map[string]any) {
	verified := map[string]any{}
	if meta, ok := profile["_meta"].(map[string]any); ok {
		if v, ok := meta["verified"].(map[string]any); ok {
			verified = v
		}
	}
	items := []map[string]any{{"kind": "basics", "path": "/basics", "title": "Thông tin cá nhân"}}
	for _, spec := range []struct{ key, kind string }{{"education", "education"}, {"work", "work"}, {"projects", "projects"}, {"certifications", "certifications"}, {"activities", "activities"}} {
		if rows, ok := profile[spec.key].([]any); ok {
			for i := range rows {
				items = append(items, map[string]any{"kind": spec.kind, "path": fmt.Sprintf("/%s/%d", spec.key, i), "title": fmt.Sprintf("%s %d", spec.kind, i+1)})
			}
		}
	}
	if rows, ok := profile["skills"].([]any); ok && len(rows) > 0 {
		items = append(items, map[string]any{"kind": "skills", "path": "/skills", "title": fmt.Sprintf("Kỹ năng (%d)", len(rows))})
	}
	if rows, ok := profile["languages"].([]any); ok && len(rows) > 0 {
		items = append(items, map[string]any{"kind": "languages", "path": "/languages", "title": fmt.Sprintf("Ngoại ngữ (%d)", len(rows))})
	}
	done := 0
	pending := []string{}
	for _, item := range items {
		path := item["path"].(string)
		if verified[path] == true {
			done++
		} else {
			pending = append(pending, path)
		}
	}
	return items, map[string]any{"done": done, "total": len(items), "complete": len(pending) == 0, "pending": pending}
}

func valueOr(v any, fallback any) any {
	if v == nil {
		return fallback
	}
	return v
}
func intOr(v any, fallback int) int {
	if n, ok := v.(float64); ok {
		return int(n)
	}
	return fallback
}
func stringSlice(v any) []string {
	out := []string{}
	if xs, ok := v.([]any); ok {
		for _, x := range xs {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func (s *Server) importPages(w http.ResponseWriter, r *http.Request, jobID string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var payload []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT payload FROM jobs WHERE id=$1 AND user_id=$2`, jobID, userID).Scan(&payload); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
		return
	}
	var p struct {
		StorageKey string `json:"storageKey"`
		Filename   string `json:"filename"`
	}
	if json.Unmarshal(payload, &p) != nil || p.StorageKey == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job không có file gốc"})
		return
	}
	data, err := os.ReadFile(filepath.Join(s.storageRoot, p.StorageKey))
	if err != nil {
		writeJSON(w, http.StatusGone, map[string]any{"expired": true, "pages": []any{}, "blocks": []any{}})
		return
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", p.Filename)
	_, _ = part.Write(data)
	_ = mw.Close()
	base := os.Getenv("PDFKIT_URL")
	if base == "" {
		base = "http://localhost:8100"
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(base, "/")+"/render?dpi=150&maxPages=20", &buf)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không gọi được PDFKit"})
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "PDFKit không khả dụng"})
		return
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode >= 300 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Không render được PDF"})
		return
	}
	var rendered struct {
		Pages []any `json:"pages"`
	}
	_ = json.Unmarshal(out, &rendered)
	writeJSON(w, http.StatusOK, map[string]any{"expired": false, "dpi": 150, "scale": 150.0 / 72.0, "pages": rendered.Pages, "blocks": []any{}})
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
	requestUserID := s.currentUserID(r)
	if requestUserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var userID, status string
	var resultRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT user_id, status, COALESCE(result,'{}') FROM jobs WHERE id = $1 AND user_id=$2`, id, requestUserID).Scan(&userID, &status, &resultRaw); err == sql.ErrNoRows {
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
	var profile map[string]any
	if json.Unmarshal(profileRaw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Hồ sơ không hợp lệ"})
		return
	}
	_, progress := reviewContract(profile)
	if progress["complete"] != true {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Còn mục chưa rà soát", "pending": progress["pending"], "progress": progress})
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
		if s.currentUserID(r) == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
			return
		}
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
	if strings.HasSuffix(cvID, "/stream") {
		s.streamAnalyze(w, r, strings.TrimSuffix(cvID, "/stream"))
		return
	}
	if cvID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV không hợp lệ"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var id, jdID string
	var scoreRaw, matchedRaw, gapsRaw []byte
	var degraded bool
	var created time.Time
	var title, seniority sql.NullString
	err := s.db.QueryRowContext(r.Context(), `SELECT m.id,m.score,m.matched,m.gaps,m.degraded,m.created_at,m.jd_id,j.requirements->>'title',j.requirements->>'seniority' FROM match_analyses m JOIN job_descriptions j ON j.id=m.jd_id JOIN cv_documents c ON c.id=m.cv_id WHERE m.cv_id=$1 AND c.user_id=$2 ORDER BY m.created_at DESC LIMIT 1`, cvID, userID).Scan(&id, &scoreRaw, &matchedRaw, &gapsRaw, &degraded, &created, &jdID, &title, &seniority)
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

func (s *Server) streamAnalyze(w http.ResponseWriter, r *http.Request, cvID string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}
	for i := 0; i < 60; i++ {
		var id string
		var score, matched, gaps []byte
		var degraded bool
		var created time.Time
		var jdID string
		var jdTitle, jdSeniority sql.NullString
		err := s.db.QueryRowContext(r.Context(), `SELECT m.id,m.score,m.matched,m.gaps,m.degraded,m.created_at,m.jd_id,j.requirements->>'title',j.requirements->>'seniority' FROM match_analyses m JOIN job_descriptions j ON j.id=m.jd_id JOIN cv_documents c ON c.id=m.cv_id WHERE m.cv_id=$1 AND c.user_id=$2 ORDER BY m.created_at DESC LIMIT 1`, cvID, userID).Scan(&id, &score, &matched, &gaps, &degraded, &created, &jdID, &jdTitle, &jdSeniority)
		if err == nil {
			var scoreV map[string]any
			var matchedV, gapsV any
			_ = json.Unmarshal(score, &scoreV)
			_ = json.Unmarshal(matched, &matchedV)
			_ = json.Unmarshal(gaps, &gapsV)
			pending := 0
			if gs, ok := gapsV.([]any); ok {
				for _, g := range gs {
					if gm, ok := g.(map[string]any); ok && gm["advice"] == nil {
						pending++
					}
				}
			}
			dataValue := map[string]any{"ready": true, "id": id, "jd": map[string]any{"id": jdID, "title": jdTitle.String, "seniority": jdSeniority.String}, "overall": scoreV["overall"], "breakdown": scoreV["breakdown"], "matched": matchedV, "gaps": gapsV, "missingAtsKeywords": scoreV["missingAtsKeywords"], "degraded": degraded, "degradedReason": scoreV["degradedReason"], "advicePending": pending, "createdAt": created}
			data, _ := json.Marshal(dataValue)
			fmt.Fprintf(w, "event: report\ndata: %s\n\n", data)
			if pending == 0 {
				fmt.Fprintf(w, "event: done\ndata: %s\n\n", data)
			}
			flusher.Flush()
			if pending == 0 {
				return
			}
		}
		fmt.Fprintf(w, "event: progress\ndata: {\"ready\":false}\n\n")
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if requestID == "" {
		requestID = newID()
	}
	w.Header().Set("X-Request-ID", requestID)
	log.Printf("chat start requestId=%s", requestID)
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Chat cần PostgreSQL"})
		return
	}
	var body struct {
		ProfileID string              `json:"profileId"`
		Message   string              `json:"message"`
		Answers   []map[string]string `json:"answers"`
		ModelRef  string              `json:"modelRef"`
		Hint      string              `json:"hint"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&body) != nil || body.ProfileID == "" || len(strings.TrimSpace(body.Message)) < 2 || len(body.Message) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body chat không hợp lệ"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var sessionID string
	err := s.db.QueryRowContext(r.Context(), `SELECT id FROM chat_sessions WHERE user_id=$1 AND profile_id=$2 ORDER BY updated_at DESC LIMIT 1`, userID, body.ProfileID).Scan(&sessionID)
	if err == sql.ErrNoRows {
		err = s.db.QueryRowContext(r.Context(), `INSERT INTO chat_sessions(user_id,profile_id) SELECT $1,p.id FROM profiles p WHERE p.id=$2 AND p.user_id=$1 RETURNING id`, userID, body.ProfileID).Scan(&sessionID)
	}
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy hồ sơ"})
		return
	}
	var userMessageID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'user',$2) RETURNING id`, sessionID, body.Message).Scan(&userMessageID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được tin nhắn"})
		return
	}
	history := []map[string]string{}
	rows, _ := s.db.QueryContext(r.Context(), `SELECT role,content FROM (SELECT role,content,created_at FROM chat_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12) recent ORDER BY created_at ASC`, sessionID)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var role, content string
			if rows.Scan(&role, &content) == nil {
				history = append(history, map[string]string{"role": role, "content": content})
			}
		}
	}
	// PostgreSQL remains the source of truth; Redis is a bounded, disposable
	// cache so a reload can restore the last ten messages without loading the
	// whole conversation.
	s.cacheChatMessages(r.Context(), userID, sessionID, history)
	profileRaw := []byte{}
	_ = s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id=$1 AND user_id=$2`, body.ProfileID, userID).Scan(&profileRaw)
	// Giữ cùng UX SSE với flow Node: gửi trạng thái ngay khi đã nhận và dựng
	// đủ context, thay vì để giao diện đứng ở "Đang kết nối" suốt lúc model chạy.
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	sendStep := func(label string) {
		payload, _ := json.Marshal(map[string]string{"label": label})
		fmt.Fprintf(w, "event: step\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
	}
	hint := ""
	if body.Hint != "" {
		hint = "\n\nGỢI Ý BIẾN ĐỔI TỪ GIAO DIỆN: " + body.Hint
	}
	prompt := []map[string]string{{"role": "system", "content": chatSystemPrompt()}, {"role": "user", "content": "PROFILE:\n" + string(profileRaw) + "\n\nHISTORY:\n" + jsonString(history) + hint + "\n\nUSER:\n" + body.Message}}
	sendStep("Đang hiểu yêu cầu của bạn")
	sendStep("Đang xem lại hồ sơ để trả lời")
	sendStep("Đang suy nghĩ")
	log.Printf("chat model request requestId=%s modelRef=%q hint=%q", requestID, body.ModelRef, body.Hint)
	answer, modelErr := callChatModel(r.Context(), prompt, body.ModelRef)
	if modelErr != nil {
		log.Printf("chat model unavailable requestId=%s modelRef=%q session=%s err=%v", requestID, body.ModelRef, sessionID, modelErr)
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant',$2)`, sessionID, "Model chưa khả dụng: "+modelErr.Error())
		payload, _ := json.Marshal(map[string]any{"kind": "error", "code": "MODEL_UNAVAILABLE", "message": "Model chưa khả dụng", "detail": modelErr.Error(), "requestId": requestID, "sessionId": sessionID})
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}
	modelOutput := parseChatModelOutput(answer)
	var assistantContent = modelOutput.Text
	if modelOutput.Kind == "patch" {
		modelOutput.Ops = normalizeChatProposalOps(modelOutput.Ops)
		if err := validateChatProposal(profileRaw, modelOutput.Ops); err != nil {
			modelOutput = chatModelOutput{Kind: "reply", Text: "Mình chưa thể tạo đề xuất an toàn từ yêu cầu này: " + err.Error()}
			assistantContent = modelOutput.Text
		} else {
			assistantContent = modelOutput.Summary
		}
	}
	var assistantID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant',$2) RETURNING id`, sessionID, assistantContent).Scan(&assistantID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được câu trả lời"})
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_sessions SET updated_at=now() WHERE id=$1`, sessionID)
	history = append(history, map[string]string{"role": "assistant", "content": assistantContent})
	s.cacheChatMessages(r.Context(), userID, sessionID, history)
	if modelOutput.Kind == "patch" {
		sendStep("Đang kiểm tra đề xuất")
		var proposalID string
		if err := s.db.QueryRowContext(r.Context(), `INSERT INTO proposed_patches(message_id,ops) VALUES($1,$2::jsonb) RETURNING id`, assistantID, jsonRawArray(modelOutput.Ops)).Scan(&proposalID); err != nil {
			modelOutput = chatModelOutput{Kind: "reply", Text: "Mình chưa lưu được đề xuất để bạn duyệt. Hồ sơ chưa thay đổi."}
			assistantContent = modelOutput.Text
			_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_messages SET content=$2 WHERE id=$1`, assistantID, assistantContent)
		} else {
			payload, _ := json.Marshal(map[string]any{"kind": "patch", "sessionId": sessionID, "messageId": assistantID, "userMessageId": userMessageID, "proposalId": proposalID, "summary": modelOutput.Summary, "ops": modelOutput.Ops, "rejected": []any{}})
			fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
			return
		}
	}
	payload, _ := json.Marshal(map[string]any{"kind": "reply", "text": assistantContent, "sessionId": sessionID, "messageId": assistantID, "userMessageId": userMessageID})
	fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
}

func chatSystemPrompt() string {
	return `Bạn là trợ lý chỉnh CV. Trả lời cùng ngôn ngữ với hồ sơ và chỉ trả về DUY NHẤT một object JSON hợp lệ.

Nếu người dùng chỉ hỏi hoặc muốn xem giải thích, trả:
{"kind":"reply","text":"..."}

Nếu người dùng yêu cầu sửa, viết lại, nhóm, sắp xếp hoặc cập nhật hồ sơ, KHÔNG được nói đã cập nhật. Hãy trả đề xuất để người dùng duyệt:
{"kind":"patch","summary":"...","ops":[{"op":"add|replace|remove","path":"/skills/0/group","value":"...","rationale":"...","grounding":{"type":"existing_field|user_message|kb|inference","ref":"..."},"kbRefs":[]}]}

Quy tắc bắt buộc: không tự ghi hồ sơ; không bịa dữ kiện; tối đa 20 ops; skills luôn là mảng các object có name và chỉ được dùng name, level, canonical, group; muốn nhóm skills thì cập nhật field group tại từng /skills/N. Phần giới thiệu cá nhân luôn dùng đường dẫn /basics/introduce. value bắt buộc với add/replace. Mỗi op/path chỉ xuất hiện một lần.`
}

func parseChatModelOutput(raw string) chatModelOutput {
	clean := strings.TrimSpace(raw)
	if strings.HasPrefix(clean, "```") {
		clean = strings.TrimPrefix(clean, "```")
		if i := strings.IndexByte(clean, '\n'); i >= 0 {
			clean = clean[i+1:]
		}
		clean = strings.TrimSuffix(strings.TrimSpace(clean), "```")
	}
	var out chatModelOutput
	if json.Unmarshal([]byte(clean), &out) != nil {
		return chatModelOutput{Kind: "reply", Text: raw}
	}
	if out.Kind == "patch" && out.Summary != "" && len(out.Ops) > 0 {
		return out
	}
	if out.Kind == "reply" && out.Text != "" {
		return out
	}
	return chatModelOutput{Kind: "reply", Text: raw}
}

func validateChatProposal(profileRaw []byte, ops []json.RawMessage) error {
	if len(ops) == 0 || len(ops) > 20 {
		return fmt.Errorf("số lượng thay đổi không hợp lệ")
	}
	seen := map[string]bool{}
	for _, raw := range ops {
		var op struct {
			Op        string          `json:"op"`
			Path      string          `json:"path"`
			Value     json.RawMessage `json:"value"`
			Rationale string          `json:"rationale"`
			Grounding struct {
				Type string `json:"type"`
				Ref  string `json:"ref"`
			} `json:"grounding"`
		}
		if json.Unmarshal(raw, &op) != nil || op.Op == "" || op.Path == "" {
			return fmt.Errorf("op không hợp lệ")
		}
		if op.Op != "add" && op.Op != "replace" && op.Op != "remove" {
			return fmt.Errorf("op %q không được hỗ trợ", op.Op)
		}
		if !strings.HasPrefix(op.Path, "/") || strings.Contains(op.Path, "[") || seen[op.Op+" "+op.Path] {
			return fmt.Errorf("path không hợp lệ hoặc bị trùng: %s", op.Path)
		}
		seen[op.Op+" "+op.Path] = true
		if op.Op != "remove" && len(op.Value) == 0 {
			return fmt.Errorf("op %s thiếu value", op.Path)
		}
		if len(op.Rationale) < 3 || op.Grounding.Type == "" || op.Grounding.Ref == "" {
			return fmt.Errorf("op %s thiếu rationale hoặc grounding", op.Path)
		}
		if strings.HasPrefix(op.Path, "/skills/") {
			tail := strings.TrimPrefix(op.Path, "/skills/")
			if strings.Contains(tail, "/") && !strings.HasSuffix(op.Path, "/name") && !strings.HasSuffix(op.Path, "/level") && !strings.HasSuffix(op.Path, "/canonical") && !strings.HasSuffix(op.Path, "/group") {
				return fmt.Errorf("skills chỉ được sửa name, level, canonical hoặc group")
			}
		}
	}
	updated, err := applyJSONPatch(profileRaw, jsonRawArray(ops))
	if err != nil {
		return fmt.Errorf("patch không áp dụng được: %v", err)
	}
	var profile struct {
		Skills []map[string]any `json:"skills"`
	}
	if json.Unmarshal(updated, &profile) != nil {
		return fmt.Errorf("hồ sơ sau patch không hợp lệ")
	}
	for _, skill := range profile.Skills {
		if _, ok := skill["name"].(string); !ok {
			return fmt.Errorf("mỗi skill phải có name dạng chuỗi")
		}
		for key := range skill {
			if key != "name" && key != "level" && key != "canonical" && key != "group" {
				return fmt.Errorf("field skill không được hỗ trợ: %s", key)
			}
		}
	}
	return nil
}

func normalizeChatProposalOps(ops []json.RawMessage) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(ops))
	for _, raw := range ops {
		var op map[string]any
		if json.Unmarshal(raw, &op) == nil {
			path, _ := op["path"].(string)
			// Models often use replace for an optional group field that is not
			// present yet. RFC 6902 add is also a replacement for an existing
			// object member, so it is safe for both cases.
			if op["op"] == "replace" && strings.HasPrefix(path, "/skills/") && strings.HasSuffix(path, "/group") {
				op["op"] = "add"
				if normalized, err := json.Marshal(op); err == nil {
					raw = normalized
				}
			}
		}
		out = append(out, raw)
	}
	return out
}

func (s *Server) cacheChatMessages(ctx context.Context, userID, sessionID string, messages []map[string]string) {
	if s.redis == nil || userID == "" || sessionID == "" {
		return
	}
	key := "chat:memory:" + userID + ":" + sessionID
	values := make([]interface{}, 0, len(messages))
	start := 0
	if len(messages) > 10 {
		start = len(messages) - 10
	}
	for _, message := range messages[start:] {
		values = append(values, jsonString(message))
	}
	pipe := s.redis.Pipeline()
	pipe.Del(ctx, key)
	if len(values) > 0 {
		pipe.RPush(ctx, key, values...)
	}
	pipe.Expire(ctx, key, 7*24*time.Hour)
	_, _ = pipe.Exec(ctx)
}

func (s *Server) chatProposal(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Proposal cần PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	proposalID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/chat/proposals/"), "/")
	var body struct {
		ProfileID string `json:"profileId"`
		Accept    []int  `json:"accept"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&body) != nil || proposalID == "" || body.ProfileID == "" || len(body.Accept) > 20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	var status, messageID string
	var opsRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT pp.status,pp.message_id,pp.ops FROM proposed_patches pp JOIN chat_messages cm ON cm.id=pp.message_id JOIN chat_sessions cs ON cs.id=cm.session_id JOIN profiles p ON p.id=cs.profile_id WHERE pp.id=$1 AND p.id=$2 AND p.user_id=$3`, proposalID, body.ProfileID, userID).Scan(&status, &messageID, &opsRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy đề xuất"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Proposal không hợp lệ"})
		return
	}
	if status != "pending" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Đề xuất này đã " + status})
		return
	}
	var all []json.RawMessage
	if json.Unmarshal(opsRaw, &all) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Ops proposal hỏng"})
		return
	}
	invalid := []int{}
	for _, i := range body.Accept {
		if i < 0 || i >= len(all) {
			invalid = append(invalid, i)
		}
	}
	if len(invalid) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "Chỉ số op không hợp lệ", "invalid": invalid})
		return
	}
	if len(body.Accept) == 0 {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE proposed_patches SET status='rejected',applied_ops='[]'::jsonb WHERE id=$1`, proposalID)
		writeJSON(w, http.StatusOK, map[string]any{"applied": 0, "status": "rejected"})
		return
	}
	selected := make([]json.RawMessage, 0, len(body.Accept))
	for _, i := range body.Accept {
		selected = append(selected, all[i])
	}
	patchRaw := jsonRawArray(selected)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer tx.Rollback()
	var old []byte
	if err = tx.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id=$1 AND user_id=$2 FOR UPDATE`, body.ProfileID, userID).Scan(&old); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy hồ sơ"})
		return
	}
	updated, err := applyJSONPatch(old, patchRaw)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Patch không áp dụng được: " + err.Error()})
		return
	}
	var revisionID int64
	if err = tx.QueryRowContext(r.Context(), `UPDATE profiles SET data=$2::jsonb WHERE id=$1 AND user_id=$3 RETURNING id`, body.ProfileID, string(updated), userID).Scan(new(string)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được hồ sơ"})
		return
	}
	var messageArg any
	if messageID != "" {
		messageArg = messageID
	}
	if err = tx.QueryRowContext(r.Context(), `INSERT INTO profile_revisions(profile_id,patch,inverse,author,message_id) VALUES($1,$2::jsonb,$3::jsonb,'ai',$4) RETURNING id`, body.ProfileID, string(patchRaw), jsonString(map[string]any{"snapshot": json.RawMessage(old)}), messageArg).Scan(&revisionID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được revision"})
		return
	}
	nextStatus := "partial"
	if len(body.Accept) == len(all) {
		nextStatus = "accepted"
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE proposed_patches SET status=$2,applied_ops=$3::jsonb WHERE id=$1`, proposalID, nextStatus, jsonString(body.Accept)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không settle được proposal"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được proposal"})
		return
	}
	var profile any
	_ = json.Unmarshal(updated, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"applied": len(selected), "rejected": []any{}, "revisionId": revisionID, "profile": profile, "status": nextStatus})
}

func jsonRawArray(values []json.RawMessage) []byte {
	if len(values) == 0 {
		return []byte("[]")
	}
	var b bytes.Buffer
	b.WriteByte('[')
	for i, v := range values {
		if i > 0 {
			b.WriteByte(',')
		}
		b.Write(v)
	}
	b.WriteByte(']')
	return b.Bytes()
}

type chatProviderConfig struct {
	Enabled   bool                       `yaml:"enabled"`
	BaseURL   string                     `yaml:"base_url"`
	APIKeyEnv string                     `yaml:"api_key_env"`
	Models    map[string]chatModelConfig `yaml:"models"`
}
type chatModelConfig struct {
	ModelID          string `yaml:"model_id"`
	Port             int    `yaml:"port"`
	StructuredOutput any    `yaml:"structured_output"`
	Thinking         string `yaml:"thinking"`
	ReasoningEffort  string `yaml:"reasoning_effort"`
}
type chatRuntimeConfig struct {
	Providers struct {
		Local    chatProviderConfig `yaml:"local"`
		OpenAI   chatProviderConfig `yaml:"openai"`
		DeepSeek chatProviderConfig `yaml:"deepseek"`
	} `yaml:"providers"`
}

func loadChatRuntimeConfig() (chatRuntimeConfig, error) {
	path := os.Getenv("HR_CONFIG_PATH")
	if path == "" {
		path = filepath.Join(".", "config.yml")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return chatRuntimeConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg chatRuntimeConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return chatRuntimeConfig{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	return cfg, nil
}

func splitModelRef(modelRef string) (string, string, error) {
	modelRef = strings.TrimSpace(modelRef)
	if modelRef == "" {
		modelRef = "local.reasoner"
	}
	parts := strings.SplitN(modelRef, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("modelRef không hợp lệ: %q", modelRef)
	}
	return parts[0], parts[1], nil
}

func callChatModel(ctx context.Context, messages []map[string]string, modelRef string) (string, error) {
	provider, alias, err := splitModelRef(modelRef)
	if err != nil {
		return "", err
	}
	cfg, err := loadChatRuntimeConfig()
	if err != nil {
		return "", err
	}
	var pc chatProviderConfig
	switch provider {
	case "local":
		pc = cfg.Providers.Local
	case "openai":
		pc = cfg.Providers.OpenAI
	case "deepseek":
		pc = cfg.Providers.DeepSeek
	default:
		return "", fmt.Errorf("provider không được cấu hình: %s", provider)
	}
	if !pc.Enabled {
		return "", fmt.Errorf("provider đã tắt: %s", provider)
	}
	mc, ok := pc.Models[alias]
	if !ok || mc.ModelID == "" {
		return "", fmt.Errorf("modelRef không được cấu hình: %s.%s", provider, alias)
	}
	if provider == "local" {
		return postLocalChat(ctx, messages, pc, mc)
	}
	return postCloudChat(ctx, messages, provider, pc, mc)
}

func postLocalChat(ctx context.Context, messages []map[string]string, pc chatProviderConfig, mc chatModelConfig) (string, error) {
	base := os.Getenv("MODEL_HOST")
	if base == "" {
		base = pc.BaseURL
	}
	if base == "" || mc.Port == 0 {
		return "", fmt.Errorf("local model thiếu base_url hoặc port")
	}
	endpoint := strings.TrimRight(base, "/") + ":" + fmt.Sprint(mc.Port) + "/v1/chat/completions"
	request := map[string]any{"model": mc.ModelID, "messages": messages, "temperature": 0.2, "max_tokens": 1800, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "cv_chat_result", "schema": chatResponseSchema()}}}
	return postChatCompletion(ctx, endpoint, request, "")
}

func postCloudChat(ctx context.Context, messages []map[string]string, provider string, pc chatProviderConfig, mc chatModelConfig) (string, error) {
	if pc.BaseURL == "" {
		return "", fmt.Errorf("provider %s thiếu base_url", provider)
	}
	key := strings.TrimSpace(os.Getenv(pc.APIKeyEnv))
	if key == "" {
		return "", fmt.Errorf("thiếu secret %s cho %s", pc.APIKeyEnv, provider)
	}
	endpoint := strings.TrimRight(pc.BaseURL, "/") + "/chat/completions"
	request := map[string]any{"model": mc.ModelID, "messages": messages}
	if provider == "openai" && strings.HasPrefix(mc.ModelID, "gpt-5") {
		request["max_completion_tokens"] = 1800
	} else {
		request["temperature"] = 0.2
		request["max_tokens"] = 1800
	}
	if provider == "openai" && strings.HasPrefix(mc.ModelID, "gpt-5") {
		// OpenAI's strict subset rejects the polymorphic patch schema; the
		// response is still validated by parseChatModelOutput and proposal guards.
		request["response_format"] = map[string]any{"type": "json_object"}
	} else if mc.StructuredOutput == "json_object" {
		request["response_format"] = map[string]any{"type": "json_object"}
	} else if mc.StructuredOutput == true {
		request["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "cv_chat_result", "strict": true, "schema": chatResponseSchema()}}
	}
	if mc.Thinking != "" {
		request["thinking"] = map[string]any{"type": mc.Thinking}
	}
	if mc.ReasoningEffort != "" {
		request["reasoning_effort"] = mc.ReasoningEffort
	}
	return postChatCompletion(ctx, endpoint, request, key)
}

func postChatCompletion(ctx context.Context, endpoint string, request map[string]any, apiKey string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(jsonString(request)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("model HTTP %d: %s", res.StatusCode, providerErrorMessage(body))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(body, &out) != nil || len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("empty model response")
	}
	return out.Choices[0].Message.Content, nil
}

func providerErrorMessage(body []byte) string {
	var out struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    any    `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &out) == nil && strings.TrimSpace(out.Error.Message) != "" {
		msg := strings.TrimSpace(out.Error.Message)
		if out.Error.Type != "" {
			msg = out.Error.Type + ": " + msg
		}
		if len(msg) > 400 {
			msg = msg[:400] + "..."
		}
		return msg
	}
	return "upstream provider rejected the request"
}

func chatResponseSchema() map[string]any {
	patchOp := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"op", "path", "value", "rationale", "grounding", "kbRefs"},
		"properties": map[string]any{
			"op":   map[string]any{"type": "string", "enum": []string{"add", "replace", "remove"}},
			"path": map[string]any{"type": "string"},
			"value": map[string]any{"anyOf": []any{
				map[string]any{"type": "string"}, map[string]any{"type": "number"},
				map[string]any{"type": "boolean"}, map[string]any{"type": "null"},
				map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				map[string]any{"type": "object", "additionalProperties": true},
			}},
			"rationale": map[string]any{"type": "string"},
			"grounding": map[string]any{
				"type": "object", "additionalProperties": false,
				"required": []string{"type", "ref"},
				"properties": map[string]any{
					"type": map[string]any{"type": "string", "enum": []string{"user_message", "existing_field", "kb", "inference"}},
					"ref":  map[string]any{"type": "string"},
				},
			},
			"kbRefs": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
	}
	// OpenAI structured outputs require a root object. Keep reply/patch in one
	// strict object; unused fields are empty for the other response kind.
	return map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"kind", "text", "summary", "ops"},
		"properties": map[string]any{
			"kind":    map[string]any{"type": "string", "enum": []string{"reply", "patch"}},
			"text":    map[string]any{"type": "string"},
			"summary": map[string]any{"type": "string"},
			"ops":     map[string]any{"type": "array", "maxItems": 20, "items": patchOp},
		},
	}
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
