package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/hr-agent/backend/internal/pii"
	"github.com/hr-agent/backend/prompts"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type job struct {
	ID, Kind, UserID string
	Payload          []byte
	Attempts         int
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
	purgeOnce := time.Now().Add(-time.Hour)
	for {
		if time.Since(lastReap) >= 30*time.Second {
			if n, err := reapStale(db); err != nil {
				log.Printf("reaper: %v", err)
			} else if n > 0 {
				log.Printf("requeued %d stale jobs", n)
			}
			lastReap = time.Now()
		}
		if time.Since(purgeOnce) >= time.Hour {
			if n, err := purgeExpiredFiles(db, os.Getenv("STORAGE_ROOT")); err != nil {
				log.Printf("retention: %v", err)
			} else if n > 0 {
				log.Printf("retention: purged %d files", n)
			}
			purgeOnce = time.Now()
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
			markFailure(db, j, err)
		}
	}
}

func reapStale(db *sql.DB) (int64, error) {
	res, err := db.Exec(`UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, retry_at=now()+interval '5 seconds', error='WORKER_RESTART_RETRY' WHERE status='running' AND started_at < now() - interval '30 minutes' AND attempts < 3`)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	_, err = db.Exec(`UPDATE jobs SET status='failed', error='STALE: worker did not finish after 3 attempts', finished_at=now() WHERE status='running' AND started_at < now() - interval '30 minutes' AND attempts >= 3`)
	return n, err
}

func claim(ctx context.Context, db *sql.DB) (*job, error) {
	var j job
	var userID sql.NullString
	err := db.QueryRowContext(ctx, `WITH picked AS (SELECT id FROM jobs WHERE status='queued' AND (retry_at IS NULL OR retry_at <= now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='running',attempts=attempts+1,started_at=now(),retry_at=NULL WHERE id=(SELECT id FROM picked) RETURNING id,kind,user_id,payload,attempts`).Scan(&j.ID, &j.Kind, &userID, &j.Payload, &j.Attempts)
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

func retryableError(message string) bool {
	m := strings.ToUpper(message)
	return strings.Contains(m, "PDF_EXTRACT_FAILED") || strings.Contains(m, "MODEL_UNAVAILABLE") || strings.Contains(m, "TIMEOUT") || strings.Contains(m, "ECONN") || strings.Contains(m, "CONNECTION REFUSED")
}

func markFailure(db *sql.DB, j *job, err error) {
	message := err.Error()
	if retryableError(message) && j.Attempts < 3 {
		_, _ = db.Exec(`UPDATE jobs SET status='queued', error=$2, started_at=NULL, finished_at=NULL, retry_at=now() + (power(2, $3 - 1) * interval '5 seconds') WHERE id=$1 AND status='running'`, j.ID, message, j.Attempts)
		return
	}
	_, _ = db.Exec(`UPDATE jobs SET status='failed', error=$2, finished_at=now(), retry_at=NULL WHERE id=$1 AND status='running'`, j.ID, message)
}

func purgeExpiredFiles(db *sql.DB, root string) (int64, error) {
	rows, err := db.Query(`SELECT id,payload->>'storageKey' FROM jobs WHERE file_purged_at IS NULL AND payload ? 'storageKey' AND created_at < now()-interval '48 hours' ORDER BY created_at LIMIT 500`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var purged int64
	for rows.Next() {
		var id, key string
		if err := rows.Scan(&id, &key); err != nil {
			continue
		}
		var shared int
		if err := db.QueryRow(`SELECT count(*) FROM jobs WHERE payload->>'storageKey'=$1 AND id<>$2 AND file_purged_at IS NULL`, key, id).Scan(&shared); err != nil {
			continue
		}
		if shared == 0 {
			if err := os.Remove(filepath.Join(root, key)); err != nil && !os.IsNotExist(err) {
				continue
			}
		}
		if _, err := db.Exec(`UPDATE jobs SET file_purged_at=now() WHERE id=$1 AND file_purged_at IS NULL`, id); err == nil {
			purged++
		}
	}
	return purged, rows.Err()
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
		return fmt.Errorf("NO_CV_SECTIONS: Could not find CV sections such as education, experience or skills")
	}
	lang := detectLanguage(seg.Text)
	name := firstLine(seg.Text)
	if name == "" {
		name = "Chưa rõ tên"
	}
	introFields := map[string]any{"name": name}
	if email := firstMatch(seg.Text, `(?i)[\w.+-]+@[\w-]+(?:\.[\w-]+)+`); email != "" {
		introFields["email"] = email
	}
	if phone := firstPhone(seg.Text); phone != "" {
		introFields["phone"] = phone
	}
	if introduce := sectionText(seg.Merged["introduce"]); introduce != "" {
		introFields["introduce"] = introduce
	}
	profile := profileFromSegments(lang, seg.Merged, j.ID)
	intro, _ := profile["sections"].(map[string]any)
	introData, _ := intro["intro"].(map[string]any)
	for key, value := range introFields {
		switch key {
		case "name":
			introData["fullName"] = value
		case "introduce":
			introData["summary"] = value
		default:
			introData[key] = value
		}
	}
	raw := jsonString(profile)
	if err := validateImportedCV(raw); err != nil {
		return fmt.Errorf("PROFILE_CREATE_FAILED: %w", err)
	}
	var profileID string
	if err := db.QueryRowContext(ctx, `INSERT INTO profiles(user_id,data,language) VALUES($1,$2::jsonb,$3) RETURNING id`, j.UserID, raw, lang).Scan(&profileID); err != nil {
		return fmt.Errorf("PROFILE_CREATE_FAILED: %w", err)
	}
	// Job results are exposed through the job API and must stay metadata-only.
	// The full profile is stored in profiles.data; copying extracted sections
	// here duplicates names, email, phone and CV text into the queue result.
	result := jsonString(parseCVJobResult(profileID, lang, seg.Quality, seg.Reasons))
	_, err = db.ExecContext(ctx, `UPDATE jobs SET status='done',result=$2::jsonb,error=NULL,finished_at=now() WHERE id=$1`, j.ID, result)
	return err
}

// validateImportedCV keeps malformed parser output out of the V2-only
// profiles table. The database constraint remains the final safety net, but a
// parser regression should produce an actionable worker error instead of a
// raw SQLSTATE message.
func validateImportedCV(raw string) error {
	var document struct {
		SchemaVersion int `json:"schemaVersion"`
		Sections      struct {
			Intro struct {
				FullName string `json:"fullName"`
			} `json:"intro"`
			Experience     []json.RawMessage `json:"experience"`
			Projects       []json.RawMessage `json:"projects"`
			Education      []json.RawMessage `json:"education"`
			Skills         []json.RawMessage `json:"skills"`
			Activities     []json.RawMessage `json:"activities"`
			Certifications []json.RawMessage `json:"certifications"`
			Languages      []json.RawMessage `json:"languages"`
		} `json:"sections"`
	}
	if err := json.Unmarshal([]byte(raw), &document); err != nil {
		return fmt.Errorf("invalid V2 JSON: %w", err)
	}
	if document.SchemaVersion != 2 {
		return fmt.Errorf("import produced schemaVersion %d, want 2", document.SchemaVersion)
	}
	if document.Sections.Intro.FullName == "" &&
		len(document.Sections.Experience) == 0 &&
		len(document.Sections.Projects) == 0 &&
		len(document.Sections.Education) == 0 &&
		len(document.Sections.Skills) == 0 &&
		len(document.Sections.Activities) == 0 &&
		len(document.Sections.Certifications) == 0 &&
		len(document.Sections.Languages) == 0 {
		return errors.New("import produced no CV content")
	}
	return nil
}

func parseCVJobResult(profileID, language, quality string, warnings []string) map[string]any {
	return map[string]any{
		"profileId": profileID,
		"language":  language,
		"quality":   quality,
		"warnings":  warnings,
	}
}

// PDFKit has already separated the CV into deterministic sections. Persist
// those sections directly in the production CV v2 document.
func profileFromSegments(language string, merged map[string]string, id string) map[string]any {
	work := parseWork(merged["work"])
	education := parseEducation(merged["education"])
	skills := parseSkills(merged["skills"])
	activities := parseActivities(merged["activities"])
	certifications := parseCertifications(merged["certifications"])
	name := "Chưa rõ tên"
	sections := map[string]any{
		"intro": map[string]any{
			"fullName": name, "title": "", "email": "", "phone": "", "location": "", "summary": "",
		},
		"experience":     importedExperience(work),
		"projects":       []any{},
		"education":      importedEducation(education),
		"skills":         importedSkills(skills),
		"activities":     importedActivities(activities),
		"certifications": importedCertifications(certifications),
		"languages":      []any{},
	}
	return map[string]any{
		"schemaVersion": 2, "id": id, "title": name,
		"lastModified": time.Now().UTC().Format(time.RFC3339),
		"language":     language, "sections": sections,
		"design":         map[string]any{"template": "modern", "accentColor": "#4F46E5", "font": "Auto", "fontSize": 10.5, "sectionTitleFontSize": 13, "headerFontSize": 20, "paddingTop": 20, "paddingBottom": 20, "paddingLeft": 20, "paddingRight": 20, "pageMargin": 0, "lineHeight": 1.3, "textAlign": "left", "spacing": "normal"},
		"activeSections": map[string]any{"intro": true, "experience": true, "projects": true, "education": true, "skills": true, "activities": true, "certifications": true, "languages": true},
		"_meta":          map[string]any{"source": "pdf_import", "verified": map[string]any{}},
	}
}

func importedExperience(raw any) []any {
	items, _ := raw.([]any)
	out := make([]any, 0, len(items))
	for i, value := range items {
		item, _ := value.(map[string]any)
		out = append(out, map[string]any{"id": fmt.Sprintf("experience-%d", i), "title": stringOrEmpty(item["role"]), "company": stringOrEmpty(item["org"]), "startDate": stringOrEmpty(item["startDate"]), "endDate": stringOrEmpty(item["endDate"]), "current": false, "highlights": item["highlights"]})
	}
	return out
}

func stringOrEmpty(value any) string {
	text, _ := value.(string)
	return text
}

func importedEducation(raw any) []any {
	items, _ := raw.([]any)
	out := make([]any, 0, len(items))
	for i, value := range items {
		item, _ := value.(map[string]any)
		entry := map[string]any{"id": fmt.Sprintf("education-%d", i), "school": item["school"], "degree": item["degree"], "fieldOfStudy": "", "startDate": "", "endDate": "", "highlights": item["highlights"]}
		if gpa, ok := item["gpa"].(string); ok && gpa != "" {
			entry["gpa"] = gpa
		}
		out = append(out, entry)
	}
	return out
}

func importedSkills(raw any) []any {
	items, _ := raw.([]any)
	names := make([]any, 0, len(items))
	for _, value := range items {
		if item, ok := value.(map[string]any); ok {
			if name, ok := item["name"].(string); ok && name != "" {
				names = append(names, name)
			}
		}
	}
	if len(names) == 0 {
		return []any{}
	}
	return []any{map[string]any{"id": "skills-0", "category": "Skills", "skills": names}}
}

func importedActivities(raw any) []any {
	items, _ := raw.([]any)
	out := make([]any, 0, len(items))
	for i, value := range items {
		item, _ := value.(map[string]any)
		out = append(out, map[string]any{"id": fmt.Sprintf("activity-%d", i), "organization": item["name"], "role": "", "startDate": "", "endDate": "", "highlights": item["highlights"]})
	}
	return out
}

func importedCertifications(raw any) []any {
	items, _ := raw.([]any)
	out := make([]any, 0, len(items))
	for i, value := range items {
		item, _ := value.(map[string]any)
		out = append(out, map[string]any{"id": fmt.Sprintf("certification-%d", i), "name": item["name"], "issuer": "", "date": ""})
	}
	return out
}

func cleanLines(raw string) []string {
	var out []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

const bulletMarkers = "•▪▫◦●○◆◇■□▸▶►‣⁃➢✦✔✓*·-–—"

func stripBullet(line string) string {
	line = strings.TrimSpace(line)
	line = strings.TrimSpace(strings.TrimLeft(line, "•▪▫◦●○◆◇■□▸▶►‣⁃➢✦✔✓*·"))
	return strings.TrimSpace(strings.TrimLeft(line, "-–—"))
}

func startsBullet(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	first, _ := utf8.DecodeRuneInString(trimmed)
	return strings.ContainsRune(bulletMarkers, first)
}

// groupBullets turns extracted lines into one entry per bullet.
//
// PDF text extraction breaks a bullet at every VISUAL line, and only the first
// of those lines carries the marker. Appending each line as its own highlight
// therefore shreds one written point into several sentence fragments: measured
// on a real 3-page CV, an entry with 4 bullets produced 19 highlights, and the
// fragments are what the CV then renders as separate <li> items and what the AI
// patches address individually.
//
// A block with no marker anywhere keeps one highlight per line. There is
// nothing in the text to tell a wrapped line from a genuinely separate point,
// and guessing would merge real bullets in CVs that never used markers.
func groupBullets(lines []string) []any {
	marked := false
	for _, line := range lines {
		if startsBullet(line) {
			marked = true
			break
		}
	}

	out := []any{}
	for _, line := range lines {
		clean := stripBullet(line)
		if clean == "" {
			continue
		}
		if marked && !startsBullet(line) && len(out) > 0 {
			previous, _ := out[len(out)-1].(string)
			// A line broken mid-word keeps its hyphen attached: joining
			// "for high-" and "throughput" with a space would invent one.
			if strings.HasSuffix(previous, "-") {
				out[len(out)-1] = previous + clean
			} else {
				out[len(out)-1] = previous + " " + clean
			}
			continue
		}
		out = append(out, clean)
	}
	return out
}

func sectionText(raw string) string {
	lines := cleanLines(raw)
	if len(lines) > 0 && (strings.EqualFold(lines[0], "summary") || strings.EqualFold(lines[0], "profile") || strings.EqualFold(lines[0], "introduction")) {
		lines = lines[1:]
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}

func parseEducation(raw string) []any {
	lines := cleanLines(raw)
	if len(lines) > 0 && strings.EqualFold(lines[0], "education") {
		lines = lines[1:]
	}
	if len(lines) == 0 {
		return []any{}
	}
	item := map[string]any{"school": lines[0], "degree": "", "highlights": []any{}}
	var body []string
	for _, line := range lines[1:] {
		clean := stripBullet(line)
		lower := strings.ToLower(clean)
		switch {
		case strings.HasPrefix(lower, "graduated:"):
			item["degree"] = strings.TrimSpace(clean[len("Graduated:"):])
		case strings.HasPrefix(lower, "gpa:"):
			item["gpa"] = strings.TrimSpace(clean[len("GPA:"):])
		default:
			body = append(body, line)
		}
	}
	item["highlights"] = groupBullets(body)
	return []any{item}
}

// workDate nhận dòng ghi KHOẢNG thời gian của một chỗ làm — parseWork dùng nó
// làm mốc cắt giữa các chỗ làm.
//
// Phải là KHOẢNG, không phải một năm lẻ. Nới thành "dòng nào có năm" sẽ biến
// "Top 1 Marketing Research Competition 2024" và "Nguyen 2026 Campaign" thành
// mốc, và parseWork cắt nhầm giữa mục.
//
// Bản đầu chỉ hiểu tên tháng tiếng Anh và "YYYY - YYYY"/"YYYY - current". Đo
// trên 6 CV thật thì CV theo lối Việt trượt sạch — người dùng upload rồi thấy
// mục kinh nghiệm TRỐNG dù CV có đủ bốn chỗ làm (CV-30: 3/8 dòng ngày được
// nhận, CV-32: 0/7, CV-33: 0/3, CV-35: 0/1). Nay nhận thêm:
//
//	tháng/năm và tháng.năm   04/2025 - Present · 7.2025 - 12.2025
//	mốc "đang làm" tiếng Việt Hiện tại · Hiện nay · đến nay · nay
//	"to" và "đến" thay gạch  12/2024 to 06/2026
//
// Không dùng lookbehind: RE2 của Go không hỗ trợ. Không cần — `\b` trước phần
// ngày đã đủ để "GPA 3.45/4.0" không lọt.
var workDate = regexp.MustCompile(`(?i)\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b.*\b20\d{2}\b` +
	`|\b(?:\d{1,2}\s*[/.]\s*)?(?:19|20)\d{2}\s*(?:[–—-]|to|đ[eế]n)\s*` +
	`(?:(?:\d{1,2}\s*[/.]\s*)?(?:19|20)\d{2}|present|current|now|ongoing|hi[eệ]n\s*t[aạ]i|hi[eệ]n\s*nay|đ[eế]n\s*nay|nay)\b`)

// Tiêu đề mục kinh nghiệm. Phải nhận cả tiếng Việt: luật cũ chỉ so bằng với
// "experience" nên "WORK EXPERIENCE" và "KINH NGHIỆM" lọt vào ô tên công ty của
// chỗ làm đầu tiên (đo được trên CV-04, CV-10, CV-30, CV-35).
var workSectionHeading = regexp.MustCompile(`(?i)^(work(ing)?\s+)?(experiences?|employment)$` +
	`|^professional\s+(experiences?|background)$` +
	`|^kinh nghiệm(\s+làm việc)?$|^quá trình công tác$`)

// Dấu hiệu một dòng là TÊN TỔ CHỨC. Cố ý chặt: ngắn, không kết thúc bằng dấu
// chấm (loại câu văn), và có từ khoá tổ chức. Nới ra thì câu "…and Wholesale
// Banking." của CV-30 bị nhận là tên công ty.
var orgKeyword = regexp.MustCompile(`(?i)\b(ltd|jsc|inc|corp|corporation|company|co|group|holdings?` +
	`|bank|university|college|school|institute|academy|agency|studio|labs?` +
	`|công ty|cty|tnhh|cổ phần|tập đoàn|trường|đại học)\b`)

// Dấu phân cách giữa tên tổ chức và chức danh khi cả hai nằm CHUNG một dòng.
var orgRoleSeparator = regexp.MustCompile(`\s+[-–—|]\s+`)

func looksLikeOrg(line string) bool {
	return len(line) <= 60 && !strings.HasSuffix(line, ".") && orgKeyword.MatchString(line)
}

// looksLikeFragment nhận mảnh địa danh hoặc mẩu câu bị ngắt — thứ hay nằm ngay
// trên dòng ngày ở bố cục dạng C ("HCM,"). Gặp nó thì phải lùi về tìm đầu mục ở
// ĐẦU đoạn thay vì lấy dòng sát ngày.
func looksLikeFragment(line string) bool {
	return len(line) <= 6 || strings.HasSuffix(line, ",") || strings.HasSuffix(line, ".")
}

// roleFromDateLine lấy phần chữ còn lại của dòng ngày sau khi bỏ khoảng thời
// gian — ở bố cục dạng B chức danh nằm chung dòng với ngày.
func roleFromDateLine(line string) string {
	rest := strings.TrimSpace(workDate.ReplaceAllString(line, ""))
	rest = strings.Trim(rest, " |-–—•,;:")
	rest = strings.TrimSpace(rest)
	// "VN |" của CV-32 còn lại đúng "VN"; "HCM, VN | …" còn lại "HCM, VN".
	// Cả hai là địa danh, không phải chức danh. Dấu phẩy là dấu hiệu mạnh
	// nhất — chức danh hiếm khi có phẩy, địa danh thì gần như luôn có.
	if len(rest) < 8 || len(strings.Fields(rest)) < 2 || strings.Contains(rest, ",") {
		return ""
	}
	return rest
}

// parseWork cắt mục kinh nghiệm thành từng chỗ làm, lấy dòng-có-ngày làm mốc.
//
// Luật cũ lấy hai dòng CUỐI trước ngày làm (org, role). Đo trên CV thật thì chỉ
// một trong bốn bố cục đúng — vì chỉ ở bố cục đó đoạn giữa hai mốc dài đúng hai
// dòng:
//
//	A  CV-06   ORG / ROLE / NGÀY / •bullets
//	B  CV-30   ORG / ROLE|NGÀY / bullets KHÔNG ký hiệu
//	C  CV-32   "ORG - ROLE" / -bullets / địa danh / NGÀY
//	D  CV-35   ROLE / NGÀY / phòng ban / địa danh / ORG / •bullets
//
// Đầu mục nằm ở ĐẦU đoạn với A, C, D nhưng ở CUỐI đoạn với B — vì bullets của B
// không có ký hiệu nên đầu đoạn là văn xuôi. Phân biệt bằng dòng sát ngày: ở C
// đó là mảnh địa danh ("HCM,"), ở A/B/D là đầu mục thật.
func parseWork(raw string) []any {
	lines := cleanLines(raw)
	if len(lines) > 0 && workSectionHeading.MatchString(lines[0]) {
		lines = lines[1:]
	}
	var dates []int
	for i, line := range lines {
		if workDate.MatchString(line) {
			dates = append(dates, i)
		}
	}

	result := []any{}
	for n, date := range dates {
		start := 0
		if n > 0 {
			start = dates[n-1] + 1
		}
		// Đầu mục nằm ở đâu trong đoạn tuỳ vào việc NGÀY đứng đầu hay cuối một
		// chỗ làm — và điều đó đọc được từ chỗ gạch đầu dòng xuất hiện.
		//
		//   đoạn MỞ ĐẦU bằng gạch đầu dòng  → đó là phần mô tả của chỗ làm
		//     TRƯỚC (ngày đứng đầu mỗi chỗ làm, bố cục A/D). Đầu mục là các
		//     dòng sau gạch đầu dòng CUỐI CÙNG.
		//   đoạn mở đầu bằng dòng thường    → đầu mục đứng trước phần mô tả
		//     (ngày đứng cuối mỗi chỗ làm, bố cục C). Lấy các dòng trước gạch
		//     đầu dòng ĐẦU TIÊN.
		//   đoạn KHÔNG có gạch đầu dòng nào → phần mô tả là văn xuôi trần,
		//     không tách được (bố cục B); ở đó đầu mục nằm sát dòng ngày.
		//
		// Phải cắt theo vị trí gạch đầu dòng chứ không lọc từng dòng: gạch đầu
		// dòng của CV-32 xuống dòng nhiều lần và các dòng nối tiếp không mang
		// ký hiệu, nên lọc từng dòng sẽ để lọt thân bài vào vùng đầu mục.
		region := lines[start:date]
		firstBullet, lastBullet := -1, -1
		for i, line := range region {
			if isBulletLine(line) {
				if firstBullet < 0 {
					firstBullet = i
				}
				lastBullet = i
			}
		}
		var span []string
		// layDauDoan: lấy hai dòng ĐẦU của vùng thay vì hai dòng cuối.
		//
		// Chỉ đúng khi vùng là phần TRƯỚC gạch đầu dòng (bố cục C) — ở đó dòng
		// đầu chính là đầu mục. Khi vùng là phần SAU gạch đầu dòng cuối cùng
		// thì phải lấy hai dòng cuối: gạch đầu dòng của CV-06 xuống dòng nhiều
		// lần, và các dòng nối tiếp nằm ngay sau ký hiệu cuối cùng nên đứng
		// TRƯỚC đầu mục trong vùng đó.
		layDauDoan := false
		switch {
		case firstBullet < 0:
			span = nonBulletLines(region)
		case firstBullet == 0:
			span = nonBulletLines(region[lastBullet+1:])
		default:
			span, layDauDoan = nonBulletLines(region[:firstBullet]), true
		}
		// Bỏ mảnh địa danh / mẩu câu ở CUỐI đoạn. Bố cục dạng C chèn "HCM,"
		// giữa phần mô tả và dòng ngày; giữ lại thì nó thành chức danh.
		for len(span) > 1 && looksLikeFragment(span[len(span)-1]) {
			span = span[:len(span)-1]
		}
		if len(span) == 0 {
			continue
		}
		head := span[max(0, len(span)-2):]
		if layDauDoan {
			head = span[:min(2, len(span))]
		}

		end := len(lines)
		if n+1 < len(dates) {
			end = dates[n+1]
		}

		// Tên tổ chức có thể nằm SAU ngày (bố cục D). Chỉ soi vài dòng đầu:
		// đi xa hơn sẽ vớ phải văn xuôi của phần mô tả công việc.
		orgAfter := ""
		for _, line := range nonBulletLines(lines[date+1 : min(end, date+6)]) {
			if looksLikeOrg(line) {
				orgAfter = line
				break
			}
		}

		org, role := head[0], ""
		switch {
		case len(head) >= 2:
			role = head[len(head)-1]
			org = head[len(head)-2]
		default:
			if parts := orgRoleSeparator.Split(head[0], 2); len(parts) == 2 {
				org, role = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
			}
		}
		if fromDate := roleFromDateLine(lines[date]); fromDate != "" {
			// Chức danh trên dòng ngày là tín hiệu mạnh nhất; khi đó dòng đầu
			// mục là tên tổ chức chứ không phải chức danh.
			org, role = head[len(head)-1], fromDate
		}
		if orgAfter != "" {
			// Tên tổ chức tìm được sau ngày thắng mọi suy đoán từ đầu mục —
			// và khi đó KHÔNG tách "ORG - ROLE" nữa, cả dòng đầu mục là chức
			// danh ("Offering – Technical Sales Support").
			org = orgAfter
			if role == "" || strings.Contains(head[0], role) {
				role = head[0]
			}
		}
		if org == "" && role == "" {
			continue
		}

		bodyEnd := end
		if n+1 < len(dates) {
			trailing := nonBulletLines(lines[date+1 : end])
			if len(trailing) >= 2 {
				bodyEnd = end - 2
			}
		}
		highlights := groupBullets(lines[date+1 : bodyEnd])
		result = append(result, map[string]any{
			"org": org, "role": role, "startDate": lines[date], "highlights": highlights,
		})
	}
	return result
}

// isBulletLine báo dòng có mở đầu bằng ký hiệu gạch đầu dòng không.
func isBulletLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	r := []rune(trimmed)[0]
	return strings.ContainsRune(bulletMarkers, r)
}

func nonBulletLines(lines []string) []string {
	var out []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "•") && !strings.HasPrefix(line, "-") {
			out = append(out, line)
		}
	}
	return out
}

var activityHeading = regexp.MustCompile(`^20\d{2}\s*[–-]`)

func parseActivities(raw string) []any {
	lines := cleanLines(raw)
	if len(lines) > 0 && strings.EqualFold(lines[0], "activities") {
		lines = lines[1:]
	}
	result := []any{}
	var current map[string]any
	var body []string
	flush := func() {
		if current != nil {
			current["highlights"] = groupBullets(body)
			result = append(result, current)
		}
		body = nil
	}
	for _, line := range lines {
		clean := stripBullet(line)
		if activityHeading.MatchString(clean) {
			flush()
			name := clean
			if i := strings.Index(clean, "–"); i >= 0 {
				name = strings.TrimSpace(clean[i+len("–"):])
			} else if i := strings.Index(clean, "-"); i >= 0 {
				name = strings.TrimSpace(clean[i+1:])
			}
			current = map[string]any{"name": name}
			continue
		}
		if current == nil {
			current = map[string]any{"name": clean}
			continue
		}
		body = append(body, line)
	}
	flush()
	return result
}

func parseSkills(raw string) []any {
	result := []any{}
	for _, line := range cleanLines(raw) {
		clean := stripBullet(line)
		if strings.EqualFold(clean, "skills") {
			continue
		}
		if i := strings.Index(clean, ":"); i >= 0 {
			clean = clean[i+1:]
		}
		for _, token := range strings.FieldsFunc(clean, func(r rune) bool { return r == ',' || r == ';' }) {
			if name := strings.TrimSpace(token); name != "" {
				result = append(result, map[string]any{"name": name})
			}
		}
	}
	return result
}

func parseCertifications(raw string) []any {
	result := []any{}
	for _, line := range cleanLines(raw) {
		clean := stripBullet(line)
		if clean == "" || strings.EqualFold(clean, "certificate") || strings.HasPrefix(strings.ToLower(clean), "http") {
			continue
		}
		result = append(result, map[string]any{"name": clean})
	}
	return result
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
	score, matched, gaps := richMatchScore(ctx, profile, jd)
	degraded := true
	if semantic, ok := semanticScore(ctx, profile, jd); ok {
		degraded = false
		breakdown := score["breakdown"].(map[string]any)
		// Semantic evidence can rescue an exact-skill miss, but never lowers
		// deterministic keyword/taxonomy coverage.
		if semantic*100 > toFloat(breakdown["skills"]) {
			breakdown["skills"] = int(semantic * 100)
		}
		skills := toFloat(breakdown["skills"])
		keywords := toFloat(breakdown["keywords"])
		experience := toFloat(breakdown["experience"])
		education := toFloat(breakdown["education"])
		rubric := toFloat(breakdown["rubric"])
		score["overall"] = int(combineMatchBreakdown(map[string]any{"skills": skills, "keywords": keywords, "experience": experience, "education": education, "rubric": rubric}, len(score["missingAtsKeywords"].([]string)) > 0 || toFloat(breakdown["keywords"]) > 0))
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
	prompt := prompts.MustRender("gap_advice.user", map[string]string{"profile": compact, "jd": jd, "gaps": jsonString(gaps)})
	system := prompts.MustRender("gap_advice.system", nil)
	request := map[string]any{"messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": prompt}}, "temperature": 0.2, "max_tokens": 1200}
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
	pii.RedactDocument(obj)
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
	return map[string]any{"overall": overall, "breakdown": map[string]any{"keyword": overall, "semantic": 0, "rubric": 0}, "missingAtsKeywords": mapKeys(gaps), "degradedReason": "Semantic/model layer is not enabled in the Go worker"}, matched, gaps
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

// Chuỗi ứng viên cho số điện thoại. Cố ý RỘNG: việc loại bỏ do đếm chữ số và
// xét tiền tố ở firstPhone đảm nhiệm, không siết ở đây. Có cả dấu chấm vì
// "0978.830.871" là lối viết phổ biến — regex cũ thiếu nó nên bỏ sót hẳn.
var phoneCandidate = regexp.MustCompile(`\(?\+?\d[\d .()-]{7,}\d`)

// firstPhone lấy số điện thoại đầu tiên trông đáng tin trong text.
//
// Regex cũ `(?:\+|00)?[0-9][0-9 ()-]{7,}[0-9]` bắt mọi chuỗi 9+ ký tự gồm
// số/khoảng trắng/ngoặc/gạch, nên nó điền vào ô điện thoại những thứ như:
//
//	CV-31  2518815045    mã số sinh viên
//	CV-32  "2025 - 12"   một khoảng năm
//
// Hai điều kiện phân biệt được: SỐ CHỮ SỐ trong khoảng 9-13, và TIỀN TỐ là
// '+', '0' hoặc mã quốc gia 84. Mã sinh viên đủ 10 chữ số nhưng mở đầu bằng
// '2' nên trượt; khoảng năm "2022 - 2025" chỉ có 8 chữ số nên cũng trượt.
func firstPhone(s string) string {
	for _, raw := range phoneCandidate.FindAllString(s, -1) {
		raw = strings.TrimSpace(raw)
		digits := nonDigit.ReplaceAllString(raw, "")
		if len(digits) < 9 || len(digits) > 13 {
			continue
		}
		// TrimLeft cho dạng "(+84) 0795…": dấu ngoặc mở nằm trước dấu cộng.
		if strings.HasPrefix(strings.TrimLeft(raw, "("), "+") || strings.HasPrefix(digits, "0") || strings.HasPrefix(digits, "84") {
			return raw
		}
	}
	return ""
}

var nonDigit = regexp.MustCompile(`\D`)

// Tên mục hay bị nhầm thành họ tên vì nó đứng ở đầu CV.
var notAName = []string{
	"đầu trang", "summary", "experience", "education", "skills", "profile",
	"objective", "contact", "personal information", "personal details",
	"giới thiệu", "mục tiêu", "thông tin cá nhân", "hồ sơ",
}

// firstLine lấy dòng trông giống HỌ TÊN người nhất.
//
// Luật cũ là "dòng đầu tiên không chứa vài từ khoá mục". Nó chặn summary,
// experience, education, skills — nhưng KHÔNG chặn `profile`, và CV-31 mở đầu
// đúng bằng chữ "Profile" nên ô họ tên của người dùng hiện ra chữ đó.
//
// Mở rộng danh sách chặn thôi thì chưa đủ: dòng ngay sau của CV-31 là
// "Student ID: 2518815045". Nên thêm ràng buộc HÌNH DẠNG — tên người có 2-5
// từ, không chữ số, không dấu hai chấm/gạch/@, và mọi từ viết hoa chữ đầu
// (chốt chặn này loại "- Communicate well with").
//
// GIỚI HẠN đã biết: luật nào cũng chỉ đúng khi tên nằm gần đầu text. Trên
// CV-33 tên ở dòng 114/128 và CV-34 ở dòng 19/56 vì thứ tự đọc bị xáo — cùng
// gốc rễ với TestThuTuKhoiMotCot (đang xfail bên pdfkit), không phải lỗi ở đây.
func firstLine(s string) string {
	for _, x := range strings.Split(s, "\n") {
		x = strings.TrimSpace(x)
		if len(x) < 4 || len(x) > 60 {
			continue
		}
		lower := strings.ToLower(x)
		if slices.ContainsFunc(notAName, func(k string) bool { return strings.Contains(lower, k) }) {
			continue
		}
		if strings.ContainsAny(x, ":|@/•-–—0123456789") {
			continue
		}
		words := strings.Fields(x)
		if len(words) < 2 || len(words) > 5 {
			continue
		}
		if slices.ContainsFunc(words, func(w string) bool { return !startsUpper(w) }) {
			continue
		}
		return x
	}
	return ""
}

// startsUpper báo chữ cái ĐẦU TIÊN của từ có viết hoa không (bỏ qua ký tự
// không phải chữ ở đầu).
func startsUpper(word string) bool {
	for _, r := range word {
		if unicode.IsLetter(r) {
			return unicode.IsUpper(r)
		}
	}
	return false
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
