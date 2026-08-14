package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
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

	"github.com/hr-agent/backend/internal/pii"
	"github.com/hr-agent/backend/prompts"

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
	Request json.RawMessage   `json:"request"`
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
	mux.HandleFunc("GET /api/auth/session", s.authSession)
	mux.HandleFunc("GET /api/auth/google/start", s.googleStart)
	mux.HandleFunc("GET /api/auth/google/callback", s.googleCallback)
	mux.HandleFunc("PATCH /api/profiles/", s.patchProfile)
	mux.HandleFunc("GET /api/profiles/", s.profileSubresource)
	mux.HandleFunc("POST /api/profiles/", s.profileMutation)
	mux.HandleFunc("GET /api/cv", s.listCV)
	mux.HandleFunc("POST /api/cv", s.createCV)
	mux.HandleFunc("GET /api/cv/", s.cvRoute)
	mux.HandleFunc("PATCH /api/cv/", s.cvRoute)
	mux.HandleFunc("DELETE /api/cv/", s.cvRoute)
	mux.HandleFunc("POST /api/cv/", s.cvRoute)
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

func (s *Server) createCV(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV endpoints require PostgreSQL"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Full name is required"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	if body.Language != "en" {
		body.Language = "vi"
	}
	intro := map[string]any{"fullName": strings.TrimSpace(body.Name)}
	if strings.TrimSpace(body.Headline) != "" {
		intro["title"] = strings.TrimSpace(body.Headline)
	}
	if strings.TrimSpace(body.Email) != "" {
		intro["email"] = strings.TrimSpace(body.Email)
	}
	if strings.TrimSpace(body.Phone) != "" {
		intro["phone"] = strings.TrimSpace(body.Phone)
	}
	profile := map[string]any{
		"schemaVersion": 2,
		"id":            newID(),
		"title":         strings.TrimSpace(body.Name),
		"lastModified":  time.Now().UTC().Format(time.RFC3339),
		"language":      body.Language,
		"sections": map[string]any{
			"intro": intro, "experience": []any{}, "projects": []any{},
			"education": []any{}, "skills": []any{}, "activities": []any{},
			"certifications": []any{}, "languages": []any{},
		},
		"design":         map[string]any{"template": "modern", "accentColor": "#4F46E5", "font": "Auto", "fontSize": 10.5, "sectionTitleFontSize": 13, "headerFontSize": 20, "paddingTop": 20, "paddingBottom": 20, "paddingLeft": 20, "paddingRight": 20, "pageMargin": 0, "lineHeight": 1.3, "textAlign": "left", "spacing": "normal"},
		"activeSections": map[string]any{"intro": true, "experience": true, "projects": true, "education": true, "skills": true, "activities": true, "certifications": true, "languages": true},
		"_meta":          map[string]any{"source": "manual", "verified": map[string]any{}},
	}
	profileJSON := jsonString(profile)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer tx.Rollback()
	var profileID, cvID string
	if err = tx.QueryRowContext(r.Context(), `INSERT INTO profiles (user_id, data, language) VALUES ($1,$2::jsonb,$3) RETURNING id`, userID, profileJSON, body.Language).Scan(&profileID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not create the profile"})
		return
	}
	if err = tx.QueryRowContext(r.Context(), `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`, userID, profileID, profileJSON, strings.TrimSpace(body.Name), body.Language).Scan(&cvID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not create the CV"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the CV"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"cvId": cvID, "profileId": profileID})
}

func (s *Server) cvRoute(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/cv/"), "/")
	parts := strings.Split(path, "/")
	id := parts[0]

	// Validate the v2 document before touching PostgreSQL.
	var cvV2 json.RawMessage
	if r.Method == http.MethodPatch && wantsV2(r) {
		var body struct {
			CV json.RawMessage `json:"cv"`
		}
		// io.LimitReader khớp mức patchProfile dùng cho body lớn nhất khác
		// trong file (2MB): thiếu nó, chốt chặn rẻ đặt sớm để từ chối input
		// xấu lại trở thành chỗ đọc nhiều nhất vào bộ nhớ trước khi từ chối.
		if json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			return
		}
		if err := validateCVV2(body.CV); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "cv must be schemaVersion 2",
				"code":  "SCHEMA_V2_INVALID",
			})
			return
		}
		cvV2 = body.CV
	}

	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV endpoints require PostgreSQL"})
		return
	}
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
		return
	}
	if len(parts) == 2 && parts[1] == "export" {
		s.exportCV(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "commit" && r.Method == http.MethodPost {
		s.cvCommit(w, r, id)
		return
	}
	if len(parts) == 2 && parts[1] == "revisions" && r.Method == http.MethodGet {
		s.cvRevisionList(w, r, id)
		return
	}
	if len(parts) == 3 && parts[1] == "revisions" && r.Method == http.MethodGet {
		s.cvRevisionPreview(w, r, id, parts[2])
		return
	}
	if len(parts) == 4 && parts[1] == "revisions" && parts[3] == "restore" && r.Method == http.MethodPost {
		s.cvRevisionRestore(w, r, id, parts[2])
		return
	}
	if len(parts) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Route not found"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.getCV(w, r, id)
	case http.MethodPatch:
		if cvV2 != nil {
			s.patchCVPair(w, r, id, cvV2)
		} else {
			s.patchCV(w, r, id)
		}
	case http.MethodDelete:
		s.deleteCV(w, r, id)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func (s *Server) exportCV(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	variant := r.URL.Query().Get("variant")
	if variant != "ats" {
		variant = "presentation"
	}
	var title, language string
	var snapshot []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(c.title,'CV'), COALESCE(c.language, p.language, 'en'), c.profile_snapshot
		FROM cv_documents c JOIN profiles p ON p.id=c.profile_id
		WHERE c.id=$1 AND c.user_id=$2 AND p.user_id=$2`, id, userID).Scan(&title, &language, &snapshot); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "CV not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not generate the PDF"})
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
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	cv, err := s.loadCVEnvelope(r.Context(), userID, id)
	if errors.Is(err, errCVNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	if err != nil {
		if isInvalidCVIdentifier(err) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
			return
		}
		if errors.Is(err, errV2NotBackfilled) {
			// Không im lặng trả dữ liệu khác schema: client chỉ đọc CV v2.
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "This CV has no v2 revision yet. Run `npm run db:backfill-v2` and try again.",
				"code":  "V2_NOT_BACKFILLED",
			})
			return
		}
		// Dữ liệu hoặc layout có mặt nhưng hỏng JSON: không trả response nửa vời.
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the CV data"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cv": cv})
}

func (s *Server) patchCV(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var body struct {
		Title      *string         `json:"title"`
		TemplateID *string         `json:"templateId"`
		Theme      json.RawMessage `json:"theme"`
		Layout     json.RawMessage `json:"layout"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 512<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	if len(body.Layout) > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Layout changes must go through Save so a revision is created", "code": "CV_REVISION_REQUIRED"})
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
	if len(sets) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Nothing to change"})
		return
	}
	args = append(args, id)
	var cvID string
	args = append(args, userID)
	err := s.db.QueryRowContext(r.Context(), "UPDATE cv_documents SET "+strings.Join(sets, ", ")+fmt.Sprintf(" WHERE id = $%d AND user_id = $%d RETURNING id", n, n+1), args...).Scan(&cvID)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not update the CV"})
		return
	}
	s.getCV(w, r, cvID)
}

// patchCVPair ghi tài liệu CV v2 duy nhất trong một transaction.
//
// Sau SP-5, data là bản v2 duy nhất và ghi vẫn nằm trong một transaction.
func (s *Server) patchCVPair(w http.ResponseWriter, r *http.Request, id string, cvV2 json.RawMessage) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer func() { _ = tx.Rollback() }()

	// AND p.user_id = $2 là phòng thủ có chủ đích, không phải điều kiện thừa
	// — cùng mức cẩn trọng exportCV và nhánh đọc v2 của getCV (Task 2) đã
	// dùng: cv_documents.user_id == profiles.user_id (qua profile_id) là bất
	// biến ở tầng ứng dụng, KHÔNG có ràng buộc DB nào ép nó (xem 001_core.sql).
	// Đây là đường GHI, nên còn quan trọng hơn đường đọc.
	var profileID string
	var layoutRaw []byte
	var revisionCount int
	if err := tx.QueryRowContext(r.Context(),
		`SELECT c.profile_id,c.layout,(SELECT COUNT(*) FROM cv_revisions r WHERE r.cv_id=c.id) FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
			 WHERE c.id = $1 AND c.user_id = $2 AND p.user_id = $2 FOR UPDATE OF c`, id, userID).Scan(&profileID, &layoutRaw, &revisionCount); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "CV not found"})
		return
	}
	if revisionCount > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This CV already has history. Use Save so a revision is created.", "code": "CV_REVISION_REQUIRED"})
		return
	}
	legacyLayout, err := normalizeCVLayout(layoutRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid layout"})
		return
	}
	normalizedCV, normalizedLayout, err := normalizeCommittedCVPair(cvV2, legacyLayout)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE profiles SET data=$2::jsonb, updated_at=now() WHERE id=$1 AND user_id=$3`,
		profileID, string(normalizedCV), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not write the profile"})
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE cv_documents SET profile_snapshot=$2::jsonb,layout=$3::jsonb,updated_at=now() WHERE id=$1 AND user_id=$4`,
		id, string(normalizedCV), string(normalizedLayout), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not write the CV"})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) deleteCV(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer tx.Rollback()
	var profileID string
	if err = tx.QueryRowContext(r.Context(), `DELETE FROM cv_documents WHERE id = $1 AND user_id=$2 RETURNING profile_id`, id, userID).Scan(&profileID); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "CV not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profiles WHERE id = $1 AND user_id=$2`, profileID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not delete the profile"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the CV deletion"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/profiles/")
	id = strings.TrimSuffix(id, "/")
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2`, id, userID).Scan(&raw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid profile id"})
		return
	}
	var profile any
	if json.Unmarshal(raw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Profile is corrupt"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) patchProfile(w http.ResponseWriter, r *http.Request) {
	id, suffix := profilePath(r.URL.Path)
	if suffix != "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Route not found"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var body struct {
		Ops       json.RawMessage `json:"ops"`
		Author    string          `json:"author"`
		MessageID string          `json:"messageId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body) != nil || len(body.Ops) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	var ops []any
	if json.Unmarshal(body.Ops, &ops) != nil || len(ops) == 0 || len(ops) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid ops"})
		return
	}
	if body.Author == "" {
		body.Author = "user"
	}
	if body.Author != "user" && body.Author != "ai" && body.Author != "import" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid author"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer tx.Rollback()
	var old []byte
	if err = tx.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&old); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid profile id"})
		return
	}
	updated, err := applyJSONPatch(old, body.Ops)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Patch could not be applied: " + err.Error()})
		return
	}
	var revisionID int64
	var messageArg any
	if body.MessageID != "" {
		messageArg = body.MessageID
	}
	err = tx.QueryRowContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3 RETURNING id`, id, string(updated), userID).Scan(new(string))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the profile"})
		return
	}
	err = tx.QueryRowContext(r.Context(), `INSERT INTO profile_revisions (profile_id, patch, inverse, author, message_id) VALUES ($1,$2::jsonb,$3::jsonb,$4,$5) RETURNING id`, id, string(body.Ops), jsonString(map[string]any{"snapshot": json.RawMessage(old)}), body.Author, messageArg).Scan(&revisionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the revision"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the profile"})
		return
	}
	var profile any
	_ = json.Unmarshal(updated, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "revisionId": revisionID, "applied": len(ops), "rejected": []any{}})
}

func (s *Server) profileSubresource(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
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
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Route not found"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT pr.id, pr.author, pr.patch, pr.created_at FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND p.user_id=$2 ORDER BY pr.id DESC LIMIT 50`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid profile id"})
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Revision endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var patchRaw, inverseRaw []byte
	var author string
	var created time.Time
	if err := s.db.QueryRowContext(r.Context(), `SELECT pr.patch, pr.inverse, pr.author, pr.created_at FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id=$1 AND pr.id=$2 AND p.user_id=$3`, profileID, revisionID, userID).Scan(&patchRaw, &inverseRaw, &author, &created); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "No such history entry"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid revision"})
		return
	}
	var inverse struct {
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if json.Unmarshal(inverseRaw, &inverse) != nil || len(inverse.Snapshot) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid revision"})
		return
	}
	afterRaw, err := applyJSONPatch(inverse.Snapshot, patchRaw)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Could not rebuild the CV for this revision"})
		return
	}
	var before, after any
	if json.Unmarshal(inverse.Snapshot, &before) != nil || json.Unmarshal(afterRaw, &after) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Revision is corrupt"})
		return
	}
	var ops any
	if json.Unmarshal(patchRaw, &ops) != nil {
		ops = []any{}
	}
	var newerCount int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id=$1 AND pr.id>$2 AND p.user_id=$3`, profileID, revisionID, userID).Scan(&newerCount); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not read the history"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisionId": fmt.Sprint(revisionID), "author": author, "createdAt": created, "ops": ops, "after": after, "before": before, "newerCount": newerCount})
}

func (s *Server) profileMutation(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
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
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Route not found"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer tx.Rollback()
	var revisionID int64
	var inverse []byte
	err = tx.QueryRowContext(r.Context(), `SELECT pr.id, pr.inverse FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND p.user_id=$2 ORDER BY pr.id DESC LIMIT 1 FOR UPDATE`, id, userID).Scan(&revisionID, &inverse)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Nothing to undo"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid profile id"})
		return
	}
	var snapshot struct {
		Snapshot json.RawMessage `json:"snapshot"`
	}
	if json.Unmarshal(inverse, &snapshot) != nil || len(snapshot.Snapshot) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid revision"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, string(snapshot.Snapshot), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not undo the profile"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM profile_revisions WHERE id = $1 AND profile_id=$2`, revisionID, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not update the history"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the undo"})
		return
	}
	var profile any
	_ = json.Unmarshal(snapshot.Snapshot, &profile)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Server) verifyProfile(w http.ResponseWriter, r *http.Request, id string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	var body struct {
		Paths    []string `json:"paths"`
		Verified *bool    `json:"verified"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&body) != nil || len(body.Paths) == 0 || len(body.Paths) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	verified := true
	if body.Verified != nil {
		verified = *body.Verified
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var raw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id = $1 AND user_id=$2`, id, userID).Scan(&raw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid profile id"})
		return
	}
	var profile map[string]any
	if json.Unmarshal(raw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Profile is corrupt"})
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
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid path"})
			return
		}
		marks[path] = verified
	}
	meta["verified"] = marks
	profile["_meta"] = meta
	updated := jsonString(profile)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, updated, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the confirmation"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "progress": map[string]any{"complete": verified}})
}

func (s *Server) revertProfile(w http.ResponseWriter, r *http.Request, id string) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Profile endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var body struct {
		RevisionID string `json:"revisionId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || body.RevisionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing revisionId"})
		return
	}
	var snapshot []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT pr.inverse->'snapshot' FROM profile_revisions pr JOIN profiles p ON p.id=pr.profile_id WHERE pr.profile_id = $1 AND pr.id = $2 AND p.user_id=$3`, id, body.RevisionID, userID).Scan(&snapshot); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "No such history entry"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid revision"})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE profiles SET data = $2::jsonb WHERE id = $1 AND user_id=$3`, id, string(snapshot), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not restore the profile"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid multipart form"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing file"})
		return
	}
	defer file.Close()
	bytes, err := io.ReadAll(io.LimitReader(file, 12<<20+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not read the file"})
		return
	}
	if len(bytes) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "File is empty"})
		return
	}
	if len(bytes) > 12<<20 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "File exceeds 12MB"})
		return
	}
	if len(bytes) < 4 || string(bytes[:4]) != "%PDF" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "File is not a PDF"})
		return
	}

	id := r.FormValue("uploadId")
	if id == "" {
		id = newID()
	}
	// A multipart field must never be able to impersonate another account.
	userID := s.currentUserID(r)
	if s.db != nil && userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	key := contentKey(bytes)
	if s.storageRoot != "" {
		if err := os.MkdirAll(s.storageRoot, 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not create storage"})
			return
		}
		if err := os.WriteFile(filepath.Join(s.storageRoot, key), bytes, 0o644); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the file"})
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
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not create the job"})
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
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
			return
		}
		var job Job
		var result, errorText sql.NullString
		err := s.db.QueryRowContext(r.Context(), `SELECT id, kind, status, created_at, COALESCE(result::text, ''), COALESCE(error, '') FROM jobs WHERE id = $1 AND user_id=$2`, id, userID).
			Scan(&job.ID, &job.Kind, &job.Status, &job.CreatedAt, &result, &errorText)
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the job"})
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
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request, id string) {
	if s.db != nil {
		userID := s.currentUserID(r)
		if userID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
			return
		}
		result, err := s.db.ExecContext(r.Context(), `UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND user_id=$2 AND status IN ('queued','running')`, id, userID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid job id"})
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Job cannot be cancelled"})
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
	writeJSON(w, http.StatusConflict, map[string]string{"error": "Job cannot be cancelled"})
}

func (s *Server) streamJob(w http.ResponseWriter, r *http.Request, id string) {
	userID := s.currentUserID(r)
	if s.db != nil && userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Streaming is not supported"})
		return
	}
	for {
		var status string
		var result, errText sql.NullString
		if s.db != nil {
			err := s.db.QueryRowContext(r.Context(), `SELECT status, COALESCE(result::text,''), COALESCE(error,'') FROM jobs WHERE id = $1 AND user_id=$2`, id, userID).Scan(&status, &result, &errText)
			if err == sql.ErrNoRows {
				fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Job not found\"}\n\n")
				flusher.Flush()
				return
			}
		} else {
			s.mu.RLock()
			job := s.jobs[id]
			if job == nil {
				s.mu.RUnlock()
				fmt.Fprint(w, "event: error\ndata: {\"error\":\"Job not found\"}\n\n")
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid job id"})
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var status string
	var resultRaw, errorRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT status, COALESCE(result,'{}'), COALESCE(error,'') FROM jobs WHERE id=$1 AND user_id=$2`, id, userID).Scan(&status, &resultRaw, &errorRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the job"})
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Job did not return a profileId"})
		return
	}
	var profileRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT data FROM profiles WHERE id=$1`, profileID).Scan(&profileRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the profile"})
		return
	}
	var profile map[string]any
	if json.Unmarshal(profileRaw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Invalid profile"})
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
	sections, _ := profile["sections"].(map[string]any)
	intro, _ := sections["intro"].(map[string]any)
	title, _ := intro["fullName"].(string)
	items := []map[string]any{{"kind": "intro", "path": "/sections/intro", "title": valueOrString(title, "Thông tin cá nhân")}}
	for _, spec := range []struct{ key, kind string }{{"education", "education"}, {"experience", "experience"}, {"projects", "projects"}, {"certifications", "certifications"}, {"activities", "activities"}} {
		if rows, ok := sections[spec.key].([]any); ok {
			for i := range rows {
				items = append(items, map[string]any{"kind": spec.kind, "path": fmt.Sprintf("/sections/%s/%d", spec.key, i), "title": fmt.Sprintf("%s %d", spec.kind, i+1)})
			}
		}
	}
	if rows, ok := sections["skills"].([]any); ok && len(rows) > 0 {
		items = append(items, map[string]any{"kind": "skills", "path": "/sections/skills", "title": fmt.Sprintf("Kỹ năng (%d)", len(rows))})
	}
	if rows, ok := sections["languages"].([]any); ok && len(rows) > 0 {
		items = append(items, map[string]any{"kind": "languages", "path": "/sections/languages", "title": fmt.Sprintf("Ngoại ngữ (%d)", len(rows))})
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

func valueOrString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var payload []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT payload FROM jobs WHERE id=$1 AND user_id=$2`, jobID, userID).Scan(&payload); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	}
	var p struct {
		StorageKey string `json:"storageKey"`
		Filename   string `json:"filename"`
	}
	if json.Unmarshal(payload, &p) != nil || p.StorageKey == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job has no source file"})
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not reach PDFKit"})
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "PDFKit is unavailable"})
		return
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode >= 300 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Could not render the PDF"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid job id"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Import endpoints require PostgreSQL"})
		return
	}
	requestUserID := s.currentUserID(r)
	if requestUserID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var userID, status string
	var resultRaw []byte
	if err := s.db.QueryRowContext(r.Context(), `SELECT user_id, status, COALESCE(result,'{}') FROM jobs WHERE id = $1 AND user_id=$2`, id, requestUserID).Scan(&userID, &status, &resultRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid job id"})
		return
	}
	if status != "done" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Job is in state " + status})
		return
	}
	var result map[string]any
	_ = json.Unmarshal(resultRaw, &result)
	profileID, _ := result["profileId"].(string)
	if profileID == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Job has no profile"})
		return
	}
	var existing string
	if err := s.db.QueryRowContext(r.Context(), `SELECT id FROM cv_documents WHERE profile_id = $1 ORDER BY created_at LIMIT 1`, profileID).Scan(&existing); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"cvId": existing, "created": false})
		return
	}
	var profileRaw []byte
	var language, title string
	if err := s.db.QueryRowContext(r.Context(), `SELECT data, language, COALESCE(data->'sections'->'intro'->>'fullName','CV của tôi') FROM profiles WHERE id = $1`, profileID).Scan(&profileRaw, &language, &title); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	}
	var profile map[string]any
	if json.Unmarshal(profileRaw, &profile) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Invalid profile"})
		return
	}
	_, progress := reviewContract(profile)
	if progress["complete"] != true {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Some sections are still unreviewed", "pending": progress["pending"], "progress": progress})
		return
	}
	var cvID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO cv_documents (user_id, profile_id, profile_snapshot, title, language) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`, userID, profileID, string(profileRaw), title, language).Scan(&cvID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not create the CV"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"cvId": cvID, "created": true})
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Account endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var body struct {
		ConfirmEmail string `json:"confirmEmail"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || strings.TrimSpace(body.ConfirmEmail) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing confirmation"})
		return
	}
	var email string
	if err := s.db.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil || !strings.EqualFold(strings.TrimSpace(body.ConfirmEmail), email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The confirmation email does not match the signed-in account."})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not delete the account"})
		return
	}
	s.authLogout(w, r)
}

func (s *Server) kbRoute(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "KB endpoints require PostgreSQL"})
		return
	}
	if r.Method == http.MethodPatch {
		if s.currentUserID(r) == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
			return
		}
		s.patchKB(w, r)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT s.id, s.title, s.author_name, s.author_title, s.language, s.status, s.version, (SELECT count(*) FROM kb_chunks c WHERE c.source_id=s.id) FROM kb_sources s ORDER BY s.created_at DESC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the KB"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	if body.Status != nil && *body.Status == "active" && (body.AuthorName == nil || strings.TrimSpace(*body.AuthorName) == "" || *body.AuthorName == "Chưa có người duyệt") {
		var author string
		_ = s.db.QueryRowContext(r.Context(), `SELECT author_name FROM kb_sources WHERE id=$1`, body.SourceID).Scan(&author)
		if strings.TrimSpace(author) == "" || author == "Chưa có người duyệt" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Cannot activate without an accountable reviewer"})
			return
		}
	}
	result, err := s.db.ExecContext(r.Context(), `UPDATE kb_sources SET status=COALESCE($2,status), author_name=COALESCE($3,author_name), author_title=COALESCE($4,author_title) WHERE id=$1`, body.SourceID, body.Status, body.AuthorName, body.AuthorTitle)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Could not update the source"})
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Source not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) kbCitations(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "KB endpoints require PostgreSQL"})
		return
	}
	var body struct {
		ChunkIDs []string `json:"chunkIds"`
		Language string   `json:"language"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || len(body.ChunkIDs) > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analyze endpoints require PostgreSQL"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The job description is too short, or the request body is invalid"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	if body.Language != "en" {
		body.Language = "vi"
	}
	var owns string
	if err := s.db.QueryRowContext(r.Context(), `SELECT id FROM cv_documents WHERE id=$1 AND user_id=$2`, body.CVID, userID).Scan(&owns); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "CV not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
		return
	}
	var jdID, jobID string
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO job_descriptions (user_id, raw_text, source_url, language) VALUES ($1,$2,NULLIF($3,''),$4) RETURNING id`, userID, body.JDText, body.SourceURL, body.Language).Scan(&jdID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the job description"})
		return
	}
	payload := jsonString(map[string]any{"cvId": body.CVID, "jdId": jdID, "createVariant": body.CreateVariant})
	key := "match_analysis:" + body.CVID + ":" + jdID
	err = s.db.QueryRowContext(r.Context(), `INSERT INTO jobs (user_id, kind, idempotency_key, payload) VALUES ($1,'match_analysis',$2,$3::jsonb) ON CONFLICT (idempotency_key) DO UPDATE SET status=jobs.status RETURNING id`, userID, key, payload).Scan(&jobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not create the analysis job"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID, "cvId": body.CVID, "jdId": jdID, "variantCreated": false, "queued": true})
}

func (s *Server) getAnalyze(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Analyze endpoints require PostgreSQL"})
		return
	}
	cvID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/analyze/"), "/")
	if strings.HasSuffix(cvID, "/stream") {
		s.streamAnalyze(w, r, strings.TrimSuffix(cvID, "/stream"))
		return
	}
	if cvID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid CV id"})
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
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Chat endpoints require PostgreSQL"})
		return
	}
	var body struct {
		ProfileID  string              `json:"profileId"`
		CVID       string              `json:"cvId"`
		DraftToken string              `json:"draftToken"`
		Draft      json.RawMessage     `json:"draft"`
		Layout     json.RawMessage     `json:"layout"`
		Message    string              `json:"message"`
		Answers    []map[string]string `json:"answers"`
		ModelRef   string              `json:"modelRef"`
		// Ngôn ngữ giao diện của người dùng — quyết định mô hình trả lời tiếng gì.
		Language string `json:"language"`
		Hint     string `json:"hint"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&body) != nil || body.ProfileID == "" || body.CVID == "" || body.DraftToken == "" || len(body.Draft) == 0 || len(body.Layout) == 0 || len(strings.TrimSpace(body.Message)) < 2 || len(body.Message) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chat request body"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	var cvProfileID string
	if err := s.db.QueryRowContext(r.Context(), `SELECT profile_id FROM cv_documents WHERE id=$1 AND profile_id=$2 AND user_id=$3`, body.CVID, body.ProfileID, userID).Scan(&cvProfileID); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "CV not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the CV"})
		return
	}
	if cvProfileID != body.ProfileID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "This CV does not belong to this profile"})
		return
	}
	if _, err := normalizeCommittedCV(body.Draft, body.Layout); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid draft: " + err.Error()})
		return
	}
	var sessionID string
	err := s.db.QueryRowContext(r.Context(), `SELECT id FROM chat_sessions WHERE user_id=$1 AND profile_id=$2 ORDER BY updated_at DESC LIMIT 1`, userID, body.ProfileID).Scan(&sessionID)
	if err == sql.ErrNoRows {
		err = s.db.QueryRowContext(r.Context(), `INSERT INTO chat_sessions(user_id,profile_id) SELECT $1,p.id FROM profiles p WHERE p.id=$2 AND p.user_id=$1 RETURNING id`, userID, body.ProfileID).Scan(&sessionID)
	}
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Profile not found"})
		return
	}
	var userMessageID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'user',$2) RETURNING id`, sessionID, body.Message).Scan(&userMessageID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the message"})
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
	profileRaw := append([]byte(nil), body.Draft...)
	// Giữ cùng UX SSE với flow Node: gửi trạng thái ngay khi đã nhận và dựng
	// đủ context, thay vì để giao diện đứng ở "Đang kết nối" suốt lúc model chạy.
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	// Gửi MÃ chứ không phải câu chữ: client dịch sang ngôn ngữ của nó. Gửi câu
	// tiếng Việt thì giao diện tiếng Anh hiện tiếng Việt, và mỗi lần sửa câu ở
	// đây là client hết khớp.
	sendStep := func(label string) {
		payload, _ := json.Marshal(map[string]string{"label": label})
		fmt.Fprintf(w, "event: step\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
	}
	// profileRaw giữ nguyên PII cho validateChatProposal và applyJSONPatch bên
	// dưới — hai bước đó chạy trên máy chủ. Chỉ bản gửi model mới bị che.
	prompt := []map[string]string{{"role": "system", "content": chatSystemPrompt(body.Language)}, {"role": "user", "content": chatUserPrompt(profileRaw, history, body.Answers, body.Hint, body.Message)}}
	sendStep("UNDERSTANDING")
	sendStep("REVIEWING_PROFILE")
	sendStep("THINKING")
	log.Printf("chat model request requestId=%s modelRef=%q hint=%q", requestID, body.ModelRef, body.Hint)
	answer, modelErr := callChatModel(r.Context(), prompt, body.ModelRef)
	if modelErr != nil {
		log.Printf("chat model unavailable requestId=%s modelRef=%q session=%s err=%v", requestID, body.ModelRef, sessionID, modelErr)
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant',$2)`, sessionID, "The model is unavailable: "+modelErr.Error())
		payload, _ := json.Marshal(map[string]any{"kind": "error", "code": "MODEL_UNAVAILABLE", "message": "The model is unavailable", "detail": modelErr.Error(), "requestId": requestID, "sessionId": sessionID})
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}
	modelOutput := parseChatModelOutput(answer)
	// Output hỏng thường là JSON bị cắt vì chạm giới hạn token. Ghi log nguyên
	// văn (đã cắt bớt) để còn chẩn đoán được, nhưng KHÔNG đưa nó ra giao diện —
	// người dùng không đọc được một khối JSON thô.
	if modelOutput.Kind == "unparsable" {
		// Ghi ĐUÔI chứ không phải đầu: output bị cắt thì chỗ hỏng luôn nằm ở
		// cuối, và độ dài cho biết ngay có chạm trần token hay không.
		tail := answer
		if len(tail) > 400 {
			tail = "…" + tail[len(tail)-400:]
		}
		log.Printf("chat model output unparsable requestId=%s modelRef=%q session=%s len=%d tail=%q", requestID, body.ModelRef, sessionID, len(answer), tail)
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant',$2)`, sessionID, "MODEL_OUTPUT_UNPARSABLE")
		payload, _ := json.Marshal(map[string]any{"kind": "error", "code": "MODEL_OUTPUT_UNPARSABLE", "message": "The model returned data we could not read", "requestId": requestID, "sessionId": sessionID})
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}
	var assistantContent = modelOutput.Text
	if modelOutput.Kind == "clarify" && len(modelOutput.Request) > 0 {
		payload, _ := json.Marshal(map[string]any{"kind": "clarify", "request": json.RawMessage(modelOutput.Request), "sessionId": sessionID, "userMessageId": userMessageID})
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}
	if modelOutput.Kind == "patch" {
		if err := validateChatProposalDocuments(profileRaw, body.Layout, modelOutput.Ops); err != nil {
			// Ghi lại op bị chặn: người dùng chỉ thấy câu từ chối, còn muốn biết
			// mô hình thật sự đã đề xuất gì thì không còn dấu vết nào khác.
			log.Printf("chat proposal rejected requestId=%s modelRef=%q session=%s err=%v ops=%s", requestID, body.ModelRef, sessionID, err, jsonRawArray(modelOutput.Ops))
			modelOutput = chatModelOutput{Kind: "reply", Text: "I could not build a safe proposal from this request: " + err.Error()}
			assistantContent = modelOutput.Text
		} else {
			// Máy chủ tự suy ra nguồn của từng op thay vì tin lời model khai. Đo
			// thật cho thấy model khai "user_message" ở cả 29/29 op, kể cả op bịa
			// hẳn nội dung, nên cơ chế bỏ tick sẵn op "inference" của giao diện
			// chưa từng chạy một lần nào.
			modelOutput.Ops = applyDerivedGrounding(modelOutput.Ops, profileRaw, proposalGroundingSources(profileRaw, body.Answers, body.Message))
			// Summary là phát ngôn của hệ thống về trạng thái hồ sơ, không phải
			// của model. Nó nói "Đã cập nhật…" ở 12/18 lượt trong khi hồ sơ chưa
			// hề đổi và người dùng còn chưa bấm duyệt.
			modelOutput.Summary = neutralizeProposalSummary(modelOutput.Summary)
			assistantContent = modelOutput.Summary
		}
	}
	var assistantID string
	if err := s.db.QueryRowContext(r.Context(), `INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant',$2) RETURNING id`, sessionID, assistantContent).Scan(&assistantID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the reply"})
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_sessions SET updated_at=now() WHERE id=$1`, sessionID)
	history = append(history, map[string]string{"role": "assistant", "content": assistantContent})
	s.cacheChatMessages(r.Context(), userID, sessionID, history)
	if modelOutput.Kind == "patch" {
		sendStep("CHECKING_PROPOSAL")
		var proposalID string
		if err := s.db.QueryRowContext(r.Context(), `INSERT INTO proposed_patches(message_id,cv_id,draft_token,profile_snapshot,layout_snapshot,ops) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) RETURNING id`, assistantID, body.CVID, body.DraftToken, string(body.Draft), string(body.Layout), jsonRawArray(modelOutput.Ops)).Scan(&proposalID); err != nil {
			modelOutput = chatModelOutput{Kind: "reply", Text: "I could not save the proposal for your review. Your profile is unchanged."}
			assistantContent = modelOutput.Text
			_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_messages SET content=$2 WHERE id=$1`, assistantID, assistantContent)
		} else {
			payload, _ := json.Marshal(map[string]any{"kind": "patch", "sessionId": sessionID, "messageId": assistantID, "userMessageId": userMessageID, "proposalId": proposalID, "cvId": body.CVID, "draftToken": body.DraftToken, "summary": modelOutput.Summary, "ops": modelOutput.Ops, "rejected": []any{}})
			fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
			return
		}
	}
	payload, _ := json.Marshal(map[string]any{"kind": "reply", "text": assistantContent, "sessionId": sessionID, "messageId": assistantID, "userMessageId": userMessageID})
	fmt.Fprintf(w, "event: result\ndata: %s\n\n", payload)
}

// Bỏ PII nhưng GIỮ NGUYÊN hình dạng hồ sơ.
//
// Xoá hẳn khoá cũ thì nhẹ hơn, nhưng model trả JSON Pointer trỏ vào hồ
// sơ thật; mất một section là mọi con trỏ `/sections/...` trỏ vào hư không và đề
// xuất không áp dụng được — cùng lỗi mà redactKeepShape() bên TypeScript đã
// ghi lại sau khi đo trên model thật.
//
// Parse hỏng thì trả rỗng chứ không trả nguyên bản: hồ sơ dị dạng không được
// trở thành đường vòng đưa PII ra ngoài.
func redactProfileForModel(raw []byte) []byte {
	var obj map[string]any
	if json.Unmarshal(raw, &obj) != nil {
		return nil
	}
	pii.RedactDocument(obj)
	out, err := json.Marshal(obj)
	if err != nil {
		return nil
	}
	return out
}

// Dựng phần user của prompt chat. Tách khỏi handler để test chứng minh được
// PII không lọt ra — chốt chặn nằm ở đây thì không ai quên gọi nó.
func chatUserPrompt(profileRaw []byte, history []map[string]string, answers []map[string]string, hint, message string) string {
	hintBlock := ""
	if hint != "" {
		// "\n\n" ở đây là khoảng cách giữa hai khối, không phải chữ của prompt —
		// chữ nằm trong chat.user_hint.md.
		hintBlock = "\n\n" + prompts.MustRender("chat.user_hint", map[string]string{"hint": hint})
	}
	return prompts.MustRender("chat.user", map[string]string{
		"profile":    string(redactProfileForModel(profileRaw)),
		"history":    jsonString(history),
		"answers":    jsonString(answers),
		"hint_block": hintBlock,
		"message":    message,
	})
}

// chatSystemPrompt dựng system prompt với ngôn ngữ dự phòng cho câu trả lời.
//
// Model bám theo ngôn ngữ người dùng đang gõ; language ở đây chỉ là phương án
// dự phòng khi không xác định được điều đó — tin nhắn quá ngắn, hay chỉ là một
// đường dẫn. Bản trước để client quyết tuyệt đối, nên người dùng gõ tiếng Anh
// trong giao diện tiếng Việt vẫn nhận trả lời tiếng Việt.
//
// Ngôn ngữ lạ hoặc rỗng lùi về tiếng Việt: client cũ không gửi trường này, và
// im lặng giữ nguyên hành vi cũ vẫn hơn là trả lời bằng thứ tiếng bất ngờ.
//
// Tên ngôn ngữ viết bằng tiếng Anh vì cả prompt viết bằng tiếng Anh — trộn một
// nhãn tiếng Việt vào giữa là đưa cho model đúng thứ nhập nhằng mà nó phải
// phân giải.
func chatSystemPrompt(language string) string {
	replyIn := "Vietnamese"
	if language == "en" {
		replyIn = "English"
	}
	return prompts.MustRender("chat.system", map[string]string{"reply_in": replyIn})
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
	// Văn bản thuần vẫn là câu trả lời hợp lệ; chỉ khi output TRÔNG như JSON mà
	// hỏng thì mới là lỗi. Mô hình bị cắt giữa chừng vì chạm giới hạn token rơi
	// vào đúng đây, và bản trước đổ nguyên văn khối JSON đó ra khung chat.
	looksLikeJSON := strings.HasPrefix(clean, "{")
	var out chatModelOutput
	if json.Unmarshal([]byte(clean), &out) != nil {
		if looksLikeJSON {
			return chatModelOutput{Kind: "unparsable"}
		}
		return chatModelOutput{Kind: "reply", Text: raw}
	}
	if out.Kind == "patch" && out.Summary != "" && len(out.Ops) > 0 {
		return out
	}
	if out.Kind == "clarify" && len(out.Request) > 0 {
		return out
	}
	if out.Kind == "reply" && out.Text != "" {
		return out
	}
	// JSON hợp lệ nhưng không khớp hình dạng nào — không có gì để hiển thị.
	return chatModelOutput{Kind: "unparsable"}
}

func validateChatProposal(profileRaw []byte, ops []json.RawMessage) error {
	if len(ops) == 0 || len(ops) > 20 {
		return fmt.Errorf("invalid number of changes")
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
			return fmt.Errorf("invalid op")
		}
		if op.Op != "add" && op.Op != "replace" && op.Op != "remove" {
			return fmt.Errorf("op %q is not supported", op.Op)
		}
		if !strings.HasPrefix(op.Path, "/") || strings.Contains(op.Path, "[") || seen[op.Op+" "+op.Path] {
			return fmt.Errorf("invalid or duplicate path: %s", op.Path)
		}
		seen[op.Op+" "+op.Path] = true
		if op.Op != "remove" && len(op.Value) == 0 {
			return fmt.Errorf("op %s is missing value", op.Path)
		}
		if len(op.Rationale) < 3 || op.Grounding.Type == "" || op.Grounding.Ref == "" {
			return fmt.Errorf("op %s is missing rationale or grounding", op.Path)
		}
		// Skills are grouped in CV v2: sections.skills[i] = {category, skills:[string]}.
		if strings.HasPrefix(op.Path, "/sections/skills/") {
			tail := strings.TrimPrefix(op.Path, "/sections/skills/")
			parts := strings.Split(tail, "/")
			okTail := len(parts) == 1 ||
				(len(parts) == 2 && (parts[1] == "category" || parts[1] == "skills")) ||
				(len(parts) == 3 && parts[1] == "skills")
			if !okTail {
				return fmt.Errorf("sections/skills only allows editing category or skills: %s", op.Path)
			}
		}
	}
	updated, err := applyJSONPatch(profileRaw, jsonRawArray(ops))
	if err != nil {
		return fmt.Errorf("patch could not be applied: %v", err)
	}
	var profile struct {
		Sections struct {
			Skills []map[string]any `json:"skills"`
		} `json:"sections"`
	}
	if json.Unmarshal(updated, &profile) != nil {
		return fmt.Errorf("the profile is invalid after the patch")
	}
	for _, group := range profile.Sections.Skills {
		if category, ok := group["category"]; ok {
			if _, ok := category.(string); !ok {
				return fmt.Errorf("category in sections.skills must be a string")
			}
		}
		if rawSkills, ok := group["skills"]; ok {
			list, ok := rawSkills.([]any)
			if !ok {
				return fmt.Errorf("skills in sections.skills must be an array of strings")
			}
			for _, item := range list {
				if _, ok := item.(string); !ok {
					return fmt.Errorf("every skill in sections.skills must be a string")
				}
			}
		}
		for key := range group {
			if key != "id" && key != "category" && key != "skills" {
				return fmt.Errorf("unsupported skill group field: %s", key)
			}
		}
	}
	return nil
}

// validateChatProposalDocuments validates the complete documents that the
// proposal was created from. Profile and layout are separate JSON documents in
// storage, so layout pointers are stripped before patching the layout and the
// shared commit contract validates the resulting pair together.
func validateChatProposalDocuments(profileRaw, layoutRaw []byte, ops []json.RawMessage) error {
	profileOps := make([]json.RawMessage, 0, len(ops))
	layoutOps := make([]json.RawMessage, 0, len(ops))
	for _, raw := range ops {
		var op struct {
			Op   string `json:"op"`
			Path string `json:"path"`
		}
		if json.Unmarshal(raw, &op) != nil || op.Path == "" {
			return fmt.Errorf("invalid op")
		}
		if !allowedChatPatchPath(op.Op, op.Path) {
			// Path có thể đúng mà chỉ sai op: token "-" của JSON Pointer nghĩa là
			// "nối vào cuối mảng" nên chỉ có nghĩa với add. Báo "path không được
			// hỗ trợ" trong trường hợp đó là sai sự thật, và nó đẩy cả người dùng
			// lẫn người sửa lỗi đi tìm nhầm chỗ.
			if allowed := allowedChatPatchOps(op.Path); len(allowed) > 0 {
				return fmt.Errorf("op %q cannot be used with path %s; this path only accepts: %s", op.Op, op.Path, strings.Join(allowed, ", "))
			}
			return fmt.Errorf("unsupported path: %s", op.Path)
		}
		if strings.HasPrefix(op.Path, "/layout/") {
			var value map[string]any
			if json.Unmarshal(raw, &value) != nil {
				return fmt.Errorf("invalid op")
			}
			value["path"] = strings.TrimPrefix(op.Path, "/layout")
			patched, err := json.Marshal(value)
			if err != nil {
				return fmt.Errorf("invalid op")
			}
			layoutOps = append(layoutOps, patched)
		} else if op.Path == "/layout" {
			return fmt.Errorf("the whole layout cannot be replaced")
		} else {
			profileOps = append(profileOps, raw)
		}
	}
	if len(ops) == 0 || len(ops) > 20 {
		return fmt.Errorf("invalid number of changes")
	}
	if len(profileOps) > 0 {
		if err := validateChatProposal(profileRaw, profileOps); err != nil {
			return err
		}
	}
	if len(layoutOps) > 0 {
		if err := validateChatProposal(layoutRaw, layoutOps); err != nil {
			return err
		}
	}
	updatedProfile, err := applyJSONPatch(profileRaw, jsonRawArray(profileOps))
	if err != nil {
		return fmt.Errorf("the CV is invalid after the patch: %v", err)
	}
	updatedLayout, err := applyJSONPatch(layoutRaw, jsonRawArray(layoutOps))
	if err != nil {
		return fmt.Errorf("the layout is invalid after the patch: %v", err)
	}
	if _, err := normalizeCommittedCV(updatedProfile, updatedLayout); err != nil {
		return fmt.Errorf("the CV is invalid after the patch: %v", err)
	}
	if _, err := validateCVLayout(updatedLayout); err != nil {
		return fmt.Errorf("the layout is invalid after the patch: %v", err)
	}
	return nil
}

func allowedChatPatchPath(op, path string) bool {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) == 3 && parts[0] == "sections" && parts[1] == "intro" {
		return stringIn(parts[2], "fullName", "title", "email", "phone", "location", "website", "summary", "careerObjective", "availability", "avatarUrl")
	}
	sectionFields := map[string][]string{
		"experience": {"id", "title", "company", "startDate", "endDate", "current", "teamSize", "techStack", "highlights"},
		"projects":   {"id", "name", "role", "startDate", "endDate", "link", "teamSize", "techStack", "contribution", "highlights"},
		"education":  {"id", "school", "degree", "fieldOfStudy", "startDate", "endDate", "gpa", "highlights"},
		"skills":     {"id", "category", "skills"}, "activities": {"id", "organization", "role", "startDate", "endDate", "highlights"},
		"certifications": {"id", "name", "issuer", "date", "link"}, "languages": {"id", "language", "proficiency"},
	}
	if len(parts) >= 3 && parts[0] == "sections" && sectionFields[parts[1]] != nil {
		if parts[2] == "-" {
			return len(parts) == 3 && op == "add"
		}
		if !decimalPathPart(parts[2]) {
			return false
		}
		if len(parts) == 3 {
			return true
		}
		if len(parts) == 4 {
			return stringIn(parts[3], sectionFields[parts[1]]...)
		}
		if len(parts) == 5 && stringIn(parts[3], "highlights", "skills", "techStack") {
			return decimalPathPart(parts[4]) || parts[4] == "-" && op == "add"
		}
	}
	if len(parts) == 2 && parts[0] == "design" {
		return stringIn(parts[1], "template", "accentColor", "font", "fontSize", "bodyFontSize", "sectionTitleFontSize", "headerFontSize", "spacing", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "pageMargin", "lineHeight", "textAlign")
	}
	if len(parts) >= 2 && parts[0] == "layout" && parts[1] == "nodes" {
		if len(parts) == 2 {
			return op == "replace"
		}
		if len(parts) < 4 || !decimalPathPart(parts[2]) {
			return false
		}
		if len(parts) == 4 && parts[3] == "visible" {
			return op == "replace"
		}
		if parts[3] == "itemOrder" {
			if len(parts) == 4 {
				return op == "add" || op == "replace"
			}
			if len(parts) == 5 {
				return decimalPathPart(parts[4]) || parts[4] == "-" && op == "add"
			}
		}
	}
	return false
}

// allowedChatPatchOps liệt kê những op mà path này chấp nhận. Rỗng nghĩa là
// path thật sự không được hỗ trợ; khác rỗng nghĩa là lỗi nằm ở op, không ở path.
func allowedChatPatchOps(path string) []string {
	allowed := make([]string, 0, 3)
	for _, candidate := range []string{"add", "replace", "remove"} {
		if allowedChatPatchPath(candidate, path) {
			allowed = append(allowed, candidate)
		}
	}
	return allowed
}

func decimalPathPart(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return value == "0" || value[0] != '0'
}

func stringIn(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Proposal endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	proposalID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/chat/proposals/"), "/")
	var body struct {
		ProfileID  string `json:"profileId"`
		CVID       string `json:"cvId"`
		DraftToken string `json:"draftToken"`
		Accept     []int  `json:"accept"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&body) != nil || proposalID == "" || body.ProfileID == "" || body.CVID == "" || body.DraftToken == "" || len(body.Accept) > 20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open a transaction"})
		return
	}
	defer tx.Rollback()
	var status string
	var opsRaw, profileRaw, layoutRaw []byte
	var proposalCVID, proposalToken string
	if err := tx.QueryRowContext(r.Context(), `SELECT pp.status,pp.ops,pp.cv_id,pp.draft_token,pp.profile_snapshot,pp.layout_snapshot FROM proposed_patches pp JOIN chat_messages cm ON cm.id=pp.message_id JOIN chat_sessions cs ON cs.id=cm.session_id JOIN profiles p ON p.id=cs.profile_id JOIN cv_documents c ON c.id=pp.cv_id AND c.profile_id=p.id WHERE pp.id=$1 AND p.id=$2 AND p.user_id=$3 AND c.id=$4 FOR UPDATE OF pp`, proposalID, body.ProfileID, userID, body.CVID).Scan(&status, &opsRaw, &proposalCVID, &proposalToken, &profileRaw, &layoutRaw); err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Proposal not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid proposal"})
		return
	}
	if status != "pending" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This proposal is already " + status})
		return
	}
	if proposalCVID != body.CVID || proposalToken != body.DraftToken {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "The draft has changed. Ask for a new proposal based on the current draft."})
		return
	}
	var all []json.RawMessage
	if json.Unmarshal(opsRaw, &all) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Proposal ops are corrupt"})
		return
	}
	selected, accepted, rejected, err := selectChatProposalOps(all, body.Accept)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid op index: " + err.Error()})
		return
	}
	if len(body.Accept) == 0 {
		result, err := tx.ExecContext(r.Context(), `UPDATE proposed_patches SET status='rejected',applied_ops='[]'::jsonb,rejected_ops=$2::jsonb WHERE id=$1 AND status='pending'`, proposalID, jsonString(rejected))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not settle the proposal"})
			return
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "This proposal has already been settled"})
			return
		}
		if err := tx.Commit(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the proposal"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"applied": 0, "accepted": accepted, "rejected": rejected, "status": "rejected", "selectedOps": []any{}})
		return
	}
	if err := validateChatProposalDocuments(profileRaw, layoutRaw, selected); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Invalid proposal: " + err.Error()})
		return
	}
	nextStatus := "partial"
	if len(rejected) == 0 {
		nextStatus = "accepted"
	}
	result, err := tx.ExecContext(r.Context(), `UPDATE proposed_patches SET status=$2,applied_ops=$3::jsonb,rejected_ops=$4::jsonb WHERE id=$1 AND status='pending'`, proposalID, nextStatus, jsonString(accepted), jsonString(rejected))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not settle the proposal"})
		return
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This proposal has already been settled"})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not commit the proposal"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"applied": len(selected), "accepted": accepted, "rejected": rejected, "selectedOps": selected, "status": nextStatus})
}

func selectChatProposalOps(all []json.RawMessage, accept []int) ([]json.RawMessage, []int, []int, error) {
	selected := make([]json.RawMessage, 0, len(accept))
	accepted := make([]int, 0, len(accept))
	seen := make(map[int]bool, len(accept))
	for _, i := range accept {
		if i < 0 || i >= len(all) {
			return nil, nil, nil, fmt.Errorf("op index %d is out of range", i)
		}
		if seen[i] {
			return nil, nil, nil, fmt.Errorf("op index %d is duplicated", i)
		}
		seen[i] = true
		selected = append(selected, all[i])
		accepted = append(accepted, i)
	}
	rejected := make([]int, 0, len(all)-len(accepted))
	for i := range all {
		if !seen[i] {
			rejected = append(rejected, i)
		}
	}
	return selected, accepted, rejected, nil
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
	MaxOutput        int    `yaml:"max_output"`
}

// chatMaxOutputTokens đọc trần output từ config, KHÔNG có giá trị mặc định.
//
// Bản trước ghim cứng 1800 ở hai chỗ trong code, và đó là gốc của hai lỗi thật:
// prompt cho phép tới 20 ops, đo thật một op ≈ 140 token, nên một yêu cầu rộng
// cần ~2800 token và bị cắt giữa chừng thành JSON hỏng; model reasoning thì
// tiêu hết ngân sách đó cho phần suy luận rồi trả về rỗng.
//
// Thiếu `max_output` là lỗi cấu hình và phải nói ra. Một con số mặc định im
// lặng chính là thứ vừa gây ra sự cố — nó nằm trong code nên không ai nhìn thấy
// và không ai sửa được từ config.
//
// Đây là TRẦN, không phải lượng bị tính tiền: nhà cung cấp chỉ tính token thật
// sinh ra.
func chatMaxOutputTokens(mc chatModelConfig) (int, error) {
	if mc.MaxOutput <= 0 {
		return 0, fmt.Errorf("model %q is missing max_output in config.yml", mc.ModelID)
	}
	return mc.MaxOutput, nil
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
		return "", "", fmt.Errorf("invalid modelRef: %q", modelRef)
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
		return "", fmt.Errorf("provider is not configured: %s", provider)
	}
	if !pc.Enabled {
		return "", fmt.Errorf("provider is disabled: %s", provider)
	}
	mc, ok := pc.Models[alias]
	if !ok || mc.ModelID == "" {
		return "", fmt.Errorf("modelRef is not configured: %s.%s", provider, alias)
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
		return "", fmt.Errorf("local model is missing base_url or port")
	}
	maxOutput, err := chatMaxOutputTokens(mc)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(base, "/") + ":" + fmt.Sprint(mc.Port) + "/v1/chat/completions"
	request := map[string]any{"model": mc.ModelID, "messages": messages, "temperature": 0.2, "max_tokens": maxOutput, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "cv_chat_result", "schema": chatResponseSchema()}}}
	return postChatCompletion(ctx, endpoint, request, "")
}

func postCloudChat(ctx context.Context, messages []map[string]string, provider string, pc chatProviderConfig, mc chatModelConfig) (string, error) {
	if pc.BaseURL == "" {
		return "", fmt.Errorf("provider %s is missing base_url", provider)
	}
	key := strings.TrimSpace(os.Getenv(pc.APIKeyEnv))
	if key == "" {
		return "", fmt.Errorf("missing secret %s for %s", pc.APIKeyEnv, provider)
	}
	maxOutput, err := chatMaxOutputTokens(mc)
	if err != nil {
		return "", err
	}
	endpoint := strings.TrimRight(pc.BaseURL, "/") + "/chat/completions"
	request := map[string]any{"model": mc.ModelID, "messages": messages}
	if provider == "openai" && strings.HasPrefix(mc.ModelID, "gpt-5") {
		request["max_completion_tokens"] = maxOutput
	} else {
		request["temperature"] = 0.2
		request["max_tokens"] = maxOutput
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

// secureCookies quyết định cookie có nên mang cờ Secure hay không.
//
// TLS thường kết thúc ở reverse proxy (VPS sau nginx/Caddy/load balancer),
// nên `r.TLS` là nil ở backend dù trình duyệt đang ở HTTPS. Cookie mất cờ
// Secure trong trường hợp đó mở đường cho kẻ trên đường truyền ghi đè nó qua
// một request plaintext cùng host — dùng chung cho cookie state OAuth và
// cookie phiên, không được chép đôi logic này.
func secureCookies(r *http.Request) bool {
	return r.TLS != nil ||
		r.Header.Get("X-Forwarded-Proto") == "https" ||
		strings.HasPrefix(appBaseURL(), "https://")
}

// appBaseURL là gốc của ứng dụng phía người dùng. Ba chỗ đang tự đọc biến môi
// trường này rồi tự cắt dấu `/` cuối; gom lại một chỗ để redirect và
// `redirect_uri` của OAuth không thể lệch nhau.
func appBaseURL() string {
	base := os.Getenv("APP_BASE_URL")
	if base == "" {
		base = "http://localhost:3000"
	}
	return strings.TrimRight(base, "/")
}

// magicLinkEnabled: magic link chỉ còn là đường đăng nhập của dev.
//
// Ở production nó vô dụng — repo không có mailer nào, `authRequest` luôn trả
// `"sent": false` — nhưng vẫn nhận request, vẫn ghi vào `login_tokens`, và vẫn
// trả `devLink` chứa token thô. Ai gọi được endpoint này cũng đăng nhập được
// vào BẤT KỲ tài khoản nào.
//
// Vì vậy cổng phải HỎNG-ĐÓNG, và phải có biến của chính nó. Suy ra từ
// `NODE_ENV != "production"` là hỏng-mở: biến không được đặt, gõ sai, hay một
// môi trường lạ đều thành "bật" — và bản triển khai thật KHÔNG đặt
// `NODE_ENV=production` ở service backend, nên cổng chưa từng được lên đạn.
// Chỉ đúng chuỗi "true" mới mở.
func magicLinkEnabled() bool {
	return os.Getenv("MAGIC_LINK_DEV") == "true"
}

// startSession tạo phiên và gắn cookie. Dùng chung cho magic link và Google:
// chép đôi đoạn này nghĩa là lần sau sửa vòng đời phiên sẽ chỉ sửa một nửa.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) error {
	session := newID() + newID()
	if _, err := s.db.ExecContext(r.Context(), `
		INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
		VALUES ($1, $2, now() + interval '30 days', $3)`, tokenHash(session), userID, r.UserAgent()); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: "hr_session", Value: session, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600, Secure: secureCookies(r)})
	return nil
}

func (s *Server) authRequest(w http.ResponseWriter, r *http.Request) {
	if !magicLinkEnabled() {
		http.NotFound(w, r)
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Auth endpoints require PostgreSQL"})
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body) != nil || !strings.Contains(body.Email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid email"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	token := newID() + newID()
	_, err := s.db.ExecContext(r.Context(), `
		INSERT INTO login_tokens (token_hash, email, expires_at)
		VALUES ($1, $2, now() + interval '15 minutes')`, tokenHash(token), email)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not create the sign-in link"})
		return
	}
	// Không cần kiểm `magicLinkEnabled()` lần nữa: hàm đã trả 404 ở đầu nếu tắt.
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"sent":    false,
		"devLink": appBaseURL() + "/api/auth/verify?token=" + url.QueryEscape(token),
	})
}

func (s *Server) authVerify(w http.ResponseWriter, r *http.Request) {
	if !magicLinkEnabled() {
		http.NotFound(w, r)
		return
	}
	if s.db == nil {
		http.Error(w, "Auth endpoints require PostgreSQL", http.StatusServiceUnavailable)
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
		http.Error(w, "Could not authenticate", http.StatusInternalServerError)
		return
	}
	err = s.db.QueryRowContext(r.Context(), `
		INSERT INTO users (email) VALUES ($1)
		ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		RETURNING id`, email).Scan(&userID)
	if err != nil {
		http.Error(w, "Could not create the account", http.StatusInternalServerError)
		return
	}
	if err := s.startSession(w, r, userID); err != nil {
		http.Error(w, "Could not create the session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, appBaseURL(), http.StatusFound)
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
	http.Redirect(w, r, appBaseURL()+"/login?error="+url.QueryEscape(reason), http.StatusFound)
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

// cvListItem dựng một dòng cho danh sách CV.
//
// Chỉ metadata: danh sách không đọc nội dung hồ sơ, nên nó không phụ thuộc
// schema chi tiết — thay đổi schema không phải sửa hàm này.
func cvListItem(id, title string, updated time.Time, jdTitle string) map[string]any {
	item := map[string]any{
		"id":        id,
		"title":     title,
		"updatedAt": updated.UTC().Format(time.RFC3339),
	}
	if jdTitle != "" {
		item["jdTitle"] = jdTitle
	}
	return item
}

func (s *Server) listCV(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CV endpoints require PostgreSQL"})
		return
	}
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not signed in"})
		return
	}
	// Tên tin tuyển dụng nằm trong `requirements`, không phải cột riêng —
	// bảng job_descriptions không có cột title.
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT c.id, COALESCE(c.title, 'CV'), c.updated_at,
		       COALESCE(j.requirements->>'title', '')
		  FROM cv_documents c
		  LEFT JOIN job_descriptions j ON j.id = c.jd_id
		 WHERE c.user_id = $1
		 ORDER BY c.updated_at DESC`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the CV list"})
		return
	}
	defer rows.Close()

	// Khởi tạo rỗng chứ không để nil: nil serialize thành `null`, và giao diện
	// phải phân biệt "chưa có CV nào" với "gọi hỏng".
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, jdTitle string
		var updated time.Time
		if err := rows.Scan(&id, &title, &updated, &jdTitle); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the CV list"})
			return
		}
		items = append(items, cvListItem(id, title, updated, jdTitle))
	}
	if rows.Err() != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read the CV list"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// authSession cho SPA biết nó đang là ai.
//
// LUÔN trả 200, kể cả khi chưa đăng nhập. Đây là câu hỏi mỗi lần tải trang;
// trả 401 cho một câu hỏi bình thường sẽ khiến mọi lớp xử lý lỗi phía trình
// duyệt phải có một ngoại lệ riêng cho đúng endpoint này.
func (s *Server) authSession(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "magicLink": magicLinkEnabled()})
		return
	}
	var email string
	if err := s.db.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "magicLink": magicLinkEnabled()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "email": email, "magicLink": magicLinkEnabled()})
}
