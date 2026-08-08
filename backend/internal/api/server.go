package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
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
	mu   sync.RWMutex
	jobs map[string]*Job
}

func NewServer() *Server { return &Server{jobs: make(map[string]*Job)} }

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
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
	if _, err := io.Copy(io.Discard, file); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Không đọc được file"})
		return
	}

	id := r.FormValue("uploadId")
	if id == "" {
		id = newID()
	}
	job := &Job{ID: id, Kind: "parse_cv", Status: "queued", CreatedAt: time.Now().UTC()}
	s.mu.Lock()
	s.jobs[id] = job
	s.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": id, "queued": true})
}

func (s *Server) job(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/jobs/")
	s.mu.RLock()
	job := s.jobs[id]
	s.mu.RUnlock()
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy job"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

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
