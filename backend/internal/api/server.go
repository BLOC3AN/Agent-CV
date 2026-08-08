package api

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
	mux.HandleFunc("GET /api/profiles/", s.getProfile)
	mux.HandleFunc("POST /api/uploads/cv", s.uploadCV)
	mux.HandleFunc("GET /api/jobs/", s.job)
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

func (s *Server) uploadCV(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "multipart form không hợp lệ"})
		return
	}
	file, _, err := r.FormFile("file")
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
				VALUES (NULLIF($1, '')::uuid, 'parse_cv', $3, $4::jsonb)
				ON CONFLICT (idempotency_key) DO UPDATE SET
					status = CASE WHEN jobs.status IN ('failed','cancelled') THEN 'queued' ELSE jobs.status END,
					payload = CASE WHEN jobs.status IN ('failed','cancelled') THEN EXCLUDED.payload ELSE jobs.payload END,
					error = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.error END,
					started_at = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.started_at END,
					finished_at = CASE WHEN jobs.status IN ('failed','cancelled') THEN NULL ELSE jobs.finished_at END
				RETURNING id, status
			) SELECT id, status FROM upsert`,
			userID, "parse_cv:"+userID+":"+id,
			jsonString(map[string]any{"storageKey": key, "filename": r.FormValue("filename"), "uploadId": id})).Scan(&jobID, &status)
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
