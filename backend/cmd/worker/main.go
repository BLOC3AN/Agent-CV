package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type job struct {
	ID, Kind, UserID string
	Payload          []byte
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}
	log.Printf("go worker ready")
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		j, err := claim(ctx, db)
		cancel()
		if err != nil {
			log.Printf("claim: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		if j == nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if err := process(context.Background(), db, j); err != nil {
			log.Printf("job %s failed: %v", j.ID, err)
			_, _ = db.Exec(`UPDATE jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1`, j.ID, err.Error())
		}
	}
}

func claim(ctx context.Context, db *sql.DB) (*job, error) {
	var j job
	err := db.QueryRowContext(ctx, `WITH picked AS (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='running', attempts=attempts+1, started_at=COALESCE(started_at,now()) WHERE id=(SELECT id FROM picked) RETURNING id,kind,user_id,payload`).Scan(&j.ID, &j.Kind, &j.UserID, &j.Payload)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func process(ctx context.Context, db *sql.DB, j *job) error {
	switch j.Kind {
	case "parse_cv":
		return parseCV(ctx, db, j)
	case "match_analysis":
		return matchAnalysis(ctx, db, j)
	default:
		return fmt.Errorf("GO_UNKNOWN_KIND: %s", j.Kind)
	}
}

func parseCV(ctx context.Context, db *sql.DB, j *job) error {
	var p struct{ StorageKey, Filename string }
	if err := json.Unmarshal(j.Payload, &p); err != nil || p.StorageKey == "" {
		return fmt.Errorf("BAD_PAYLOAD")
	}
	root := os.Getenv("STORAGE_ROOT")
	data, err := os.ReadFile(filepath.Join(root, p.StorageKey))
	if err != nil {
		return fmt.Errorf("FILE_MISSING: %w", err)
	}
	seg, err := pdfSegment(ctx, data, p.Filename)
	if err != nil {
		return fmt.Errorf("PDF_EXTRACT_FAILED: %w", err)
	}
	lang := detectLanguage(seg.Text)
	name := firstLine(seg.Text)
	if name == "" {
		name = "Chưa rõ tên"
	}
	basics := map[string]any{"name": name}
	if email := firstMatch(seg.Text, `(?i)[\w.+-]+@[\w-]+(?:\.[\w-]+)+`); email != "" {
		basics["email"] = email
	}
	if phone := firstMatch(seg.Text, `(?:\+|00)?[0-9][0-9 ()-]{7,}[0-9]`); phone != "" {
		basics["phone"] = strings.TrimSpace(phone)
	}
	profile := map[string]any{"schemaVersion": 1, "language": lang, "basics": basics, "summary": seg.Text, "_meta": map[string]any{"source": "pdf_import", "verified": map[string]any{}, "degraded": seg.Quality != "good"}}
	raw := jsonString(profile)
	var profileID string
	if err := db.QueryRowContext(ctx, `INSERT INTO profiles(user_id,data,language) VALUES($1,$2::jsonb,$3) RETURNING id`, j.UserID, raw, lang).Scan(&profileID); err != nil {
		return fmt.Errorf("PROFILE_CREATE_FAILED: %w", err)
	}
	result := jsonString(map[string]any{"profileId": profileID, "language": lang, "quality": seg.Quality, "warnings": seg.Reasons, "sections": seg.Merged})
	_, err = db.ExecContext(ctx, `UPDATE jobs SET status='done',result=$2::jsonb,error=NULL,finished_at=now() WHERE id=$1`, j.ID, result)
	return err
}

type segmentResult struct {
	Text    string            `json:"text"`
	Quality string            `json:"quality"`
	Reasons []string          `json:"reasons"`
	Merged  map[string]string `json:"merged"`
}

func pdfSegment(ctx context.Context, data []byte, filename string) (segmentResult, error) {
	var out segmentResult
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return out, err
	}
	if _, err = part.Write(data); err != nil {
		return out, err
	}
	if err = mw.Close(); err != nil {
		return out, err
	}
	base := os.Getenv("PDFKIT_URL")
	if base == "" {
		base = "http://localhost:8100"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/segment", &buf)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		return out, fmt.Errorf("pdfkit %s: %s", res.Status, string(body))
	}
	err = json.Unmarshal(body, &out)
	return out, err
}

func matchAnalysis(ctx context.Context, db *sql.DB, j *job) error {
	var p struct{ CVID, JDID string }
	if json.Unmarshal(j.Payload, &p) != nil || p.CVID == "" || p.JDID == "" {
		return fmt.Errorf("BAD_PAYLOAD")
	}
	var profile, jd string
	var revision sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT p.data::text FROM cv_documents c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1`, p.CVID).Scan(&profile); err != nil {
		return fmt.Errorf("CV_NOT_FOUND")
	}
	if err := db.QueryRowContext(ctx, `SELECT raw_text FROM job_descriptions WHERE id=$1`, p.JDID).Scan(&jd); err != nil {
		return fmt.Errorf("JD_NOT_FOUND")
	}
	score, matched, gaps := keywordScore(profile, jd)
	scoreRaw := jsonString(score)
	matchedRaw := jsonString(matched)
	gapsRaw := jsonString(gaps)
	var matchID string
	if err := db.QueryRowContext(ctx, `INSERT INTO match_analyses(cv_id,jd_id,revision_id,score,matched,gaps,model_used,degraded) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,'go-keyword',true) ON CONFLICT (cv_id,jd_id,revision_id) DO UPDATE SET score=EXCLUDED.score,matched=EXCLUDED.matched,gaps=EXCLUDED.gaps,created_at=now() RETURNING id`, p.CVID, p.JDID, revision, scoreRaw, matchedRaw, gapsRaw).Scan(&matchID); err != nil {
		return err
	}
	result := jsonString(map[string]any{"matchId": matchID, "overall": score["overall"], "degraded": true})
	_, err := db.ExecContext(ctx, `UPDATE jobs SET status='done',result=$2::jsonb,error=NULL,finished_at=now() WHERE id=$1`, j.ID, result)
	return err
}

func keywordScore(profile, jd string) (map[string]any, []map[string]any, []map[string]any) {
	pt := tokens(profile)
	jt := tokens(jd)
	matched := []map[string]any{}
	gaps := []map[string]any{}
	for k := range jt {
		if pt[k] {
			matched = append(matched, map[string]any{"id": k, "requirement": k, "evidence": "keyword"})
		} else {
			gaps = append(gaps, map[string]any{"id": k, "requirement": k, "severity": "medium", "reason": "Không tìm thấy từ khoá tương ứng", "advice": nil, "kbRefs": []string{}})
		}
	}
	overall := 0
	if len(jt) > 0 {
		overall = len(matched) * 100 / len(jt)
	}
	return map[string]any{"overall": overall, "breakdown": map[string]any{"keyword": overall, "semantic": 0, "rubric": 0}, "missingAtsKeywords": mapKeys(gaps), "degradedReason": "Semantic/model layer chưa bật trong Go worker"}, matched, gaps
}
func tokens(s string) map[string]bool {
	m := map[string]bool{}
	for _, x := range regexp.MustCompile(`[a-zA-Z0-9+#.-]{2,}`).FindAllString(strings.ToLower(s), -1) {
		m[x] = true
	}
	return m
}
func mapKeys(v []map[string]any) []string {
	r := make([]string, 0, len(v))
	for _, x := range v {
		if k, ok := x["id"].(string); ok {
			r = append(r, k)
		}
	}
	return r
}
func firstLine(s string) string {
	for _, x := range strings.Split(s, "\n") {
		x = strings.TrimSpace(x)
		lower := strings.ToLower(x)
		if len(x) >= 2 && len(x) <= 100 && !strings.Contains(lower, "đầu trang") && !strings.Contains(lower, "summary") && !strings.Contains(lower, "experience") && !strings.Contains(lower, "education") && !strings.Contains(lower, "skills") && !strings.Contains(x, "|") && !strings.Contains(x, "@") {
			return x
		}
	}
	return ""
}
func detectLanguage(s string) string {
	lower := strings.ToLower(s)
	viTerms := []string{"kinh nghiệm", "học vấn", "kỹ năng", "thực tập", "công ty", "dự án", "chứng chỉ", "hoạt động", "ngoại ngữ"}
	enTerms := []string{"experience", "education", "skills", "internship", "company", "projects", "certifications", "activities", "languages", "summary"}
	vi, en := 0, 0
	for _, term := range viTerms {
		vi += strings.Count(lower, term)
	}
	for _, term := range enTerms {
		en += strings.Count(lower, term)
	}
	diacritics := 0
	for _, r := range lower {
		if strings.ContainsRune("ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ", r) {
			diacritics++
		}
	}
	if vi > en || (vi == en && diacritics >= 3) {
		return "vi"
	}
	return "en"
}

func firstMatch(text, expression string) string {
	re := regexp.MustCompile(expression)
	return re.FindString(text)
}
func jsonString(v any) string { b, _ := json.Marshal(v); return string(b) }
