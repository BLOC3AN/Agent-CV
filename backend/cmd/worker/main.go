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
	lastReap := time.Now()
	for {
		if time.Since(lastReap) >= 30*time.Second {
			if n, err := reapStale(db); err != nil {
				log.Printf("reaper: %v", err)
			} else if n > 0 {
				log.Printf("requeued %d stale jobs", n)
			}
			lastReap = time.Now()
		}
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

func reapStale(db *sql.DB) (int64, error) {
	res, err := db.Exec(`UPDATE jobs SET status='queued', started_at=NULL, error='WORKER_RESTART_RETRY' WHERE status='running' AND started_at < now() - interval '10 minutes' AND attempts < 3`)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return n, err
}

func claim(ctx context.Context, db *sql.DB) (*job, error) {
	var j job
	var userID sql.NullString
	err := db.QueryRowContext(ctx, `WITH picked AS (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='running',attempts=attempts+1,started_at=COALESCE(started_at,now()) WHERE id=(SELECT id FROM picked) RETURNING id,kind,user_id,payload`).Scan(&j.ID, &j.Kind, &userID, &j.Payload)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if userID.Valid {
		j.UserID = userID.String
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
	if !looksLikeCV(seg.Merged) {
		return fmt.Errorf("NO_CV_SECTIONS: Không nhận ra mục CV như học vấn, kinh nghiệm hoặc kỹ năng")
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
	degraded := true
	if semantic, ok := semanticScore(ctx, profile, jd); ok {
		degraded = false
		keyword := toFloat(score["overall"])
		score["breakdown"].(map[string]any)["semantic"] = int(semantic * 100)
		score["overall"] = int(keyword*0.6 + semantic*40)
		delete(score, "degradedReason")
	}
	modelUsed := "go-semantic"
	if len(gaps) > 0 {
		if reordered, ok := rerankGaps(ctx, jd, gaps); ok {
			gaps = reordered
			modelUsed = "go-semantic+reranker"
		}
		if advices, ok := runGapAdvice(ctx, profile, jd, gaps); ok {
			for _, advice := range advices {
				for _, gap := range gaps {
					if gap["id"] == advice.GapID {
						gap["advice"] = advice.Advice
						gap["kbRefs"] = advice.KBRefs
					}
				}
			}
			modelUsed = "go-semantic+reasoner"
		}
	}
	scoreRaw := jsonString(score)
	matchedRaw := jsonString(matched)
	gapsRaw := jsonString(gaps)
	var matchID string
	if err := db.QueryRowContext(ctx, `INSERT INTO match_analyses(cv_id,jd_id,revision_id,score,matched,gaps,model_used,degraded) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8) ON CONFLICT (cv_id,jd_id,revision_id) DO UPDATE SET score=EXCLUDED.score,matched=EXCLUDED.matched,gaps=EXCLUDED.gaps,model_used=EXCLUDED.model_used,degraded=EXCLUDED.degraded,created_at=now() RETURNING id`, p.CVID, p.JDID, revision, scoreRaw, matchedRaw, gapsRaw, modelUsed, degraded).Scan(&matchID); err != nil {
		return err
	}
	result := jsonString(map[string]any{"matchId": matchID, "overall": score["overall"], "degraded": degraded})
	_, err := db.ExecContext(ctx, `UPDATE jobs SET status='done',result=$2::jsonb,error=NULL,finished_at=now() WHERE id=$1`, j.ID, result)
	return err
}

type gapAdvice struct {
	GapID  string   `json:"gapId"`
	Advice string   `json:"advice"`
	KBRefs []string `json:"kbRefs"`
}

func runGapAdvice(ctx context.Context, profile, jd string, gaps []map[string]any) ([]gapAdvice, bool) {
	compact := compactProfile(profile)
	prompt := "CV PROFILE (PII removed):\n" + compact + "\n\nJOB DESCRIPTION:\n" + jd + "\n\nGAPS:\n" + jsonString(gaps)
	request := map[string]any{"messages": []map[string]string{{"role": "system", "content": "You give concise CV improvement advice. Return JSON only: {\\\"advices\\\":[{\\\"gapId\\\":\\\"existing id\\\",\\\"advice\\\":\\\"actionable advice\\\",\\\"kbRefs\\\":[]}]}. Never invent gap IDs."}, {"role": "user", "content": prompt}}, "temperature": 0.2, "max_tokens": 1200}
	var response struct {
		Advices []gapAdvice `json:"advices"`
	}
	if !callReasonerJSON(ctx, request, &response) {
		return nil, false
	}
	known := map[string]bool{}
	for _, g := range gaps {
		if id, ok := g["id"].(string); ok {
			known[id] = true
		}
	}
	out := make([]gapAdvice, 0, len(response.Advices))
	for _, a := range response.Advices {
		if known[a.GapID] && strings.TrimSpace(a.Advice) != "" {
			out = append(out, a)
		}
	}
	return out, true
}

func compactProfile(raw string) string {
	var obj map[string]any
	if json.Unmarshal([]byte(raw), &obj) != nil {
		return raw
	}
	if basics, ok := obj["basics"].(map[string]any); ok {
		delete(basics, "email")
		delete(basics, "phone")
		delete(basics, "address")
	}
	return jsonString(obj)
}

func callReasonerJSON(ctx context.Context, request map[string]any, out any) bool {
	base := os.Getenv("MODEL_HOST")
	if base == "" {
		base = "http://100.68.50.41"
	}
	endpoint := strings.TrimRight(base, "/") + ":5011/v1/chat/completions"
	raw := jsonString(request)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(raw))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return false
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(body, &envelope) != nil || len(envelope.Choices) == 0 {
		return false
	}
	content := strings.TrimSpace(envelope.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimSuffix(strings.TrimSpace(content), "```")
	return json.Unmarshal([]byte(strings.TrimSpace(content)), out) == nil
}

func rerankGaps(ctx context.Context, query string, gaps []map[string]any) ([]map[string]any, bool) {
	base := os.Getenv("RERANKER_URL")
	if base == "" {
		host := os.Getenv("MODEL_HOST")
		if host == "" {
			host = "http://100.68.50.41"
		}
		base = strings.TrimRight(host, "/") + ":5014"
	}
	docs := make([]string, len(gaps))
	for i, g := range gaps {
		docs[i], _ = g["requirement"].(string)
	}
	reqBody := jsonString(map[string]any{"query": query, "documents": docs, "top_n": len(docs)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/v1/rerank", strings.NewReader(reqBody))
	if err != nil {
		return gaps, false
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return gaps, false
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return gaps, false
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	var out struct {
		Results []struct {
			Index int `json:"index"`
		} `json:"results"`
	}
	if json.Unmarshal(body, &out) != nil || len(out.Results) == 0 {
		return gaps, false
	}
	ordered := make([]map[string]any, 0, len(gaps))
	seen := map[int]bool{}
	for _, item := range out.Results {
		if item.Index >= 0 && item.Index < len(gaps) && !seen[item.Index] {
			ordered = append(ordered, gaps[item.Index])
			seen[item.Index] = true
		}
	}
	for i, g := range gaps {
		if !seen[i] {
			ordered = append(ordered, g)
		}
	}
	return ordered, true
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

func semanticScore(ctx context.Context, profile, jd string) (float64, bool) {
	base := os.Getenv("EMBEDDER_URL")
	if base == "" {
		host := os.Getenv("MODEL_HOST")
		if host == "" {
			host = "http://100.68.50.41"
		}
		base = strings.TrimRight(host, "/") + ":8003"
	}
	payload := jsonString(map[string]any{"texts": []string{profile, jd}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/embed-batch", strings.NewReader(payload))
	if err != nil {
		return 0, false
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, false
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return 0, false
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	var out struct {
		DenseVectors [][]float64 `json:"dense_vectors"`
	}
	if json.Unmarshal(body, &out) != nil || len(out.DenseVectors) < 2 {
		return 0, false
	}
	return cosine(out.DenseVectors[0], out.DenseVectors[1]), true
}

func cosine(a, b []float64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (sqrt(na) * sqrt(nb))
}
func sqrt(x float64) float64 {
	z := x
	if z <= 0 {
		return 0
	}
	for i := 0; i < 12; i++ {
		z = (z + x/z) / 2
	}
	return z
}
func toFloat(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case float64:
		return x
	}
	return 0
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

func looksLikeCV(sections map[string]string) bool {
	known := 0
	for _, key := range []string{"education", "work", "projects", "skills", "activities", "certifications", "languages"} {
		if strings.TrimSpace(sections[key]) != "" {
			known++
		}
	}
	return known > 0
}
func jsonString(v any) string { b, _ := json.Marshal(v); return string(b) }
