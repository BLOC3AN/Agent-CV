package main

// Structured matching parity with frontend/packages/matching. The worker keeps
// this code deterministic: the reasoner may parse a JD and write advice, but
// it never decides the score.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.yaml.in/yaml/v3"
)

type jdRequirements struct {
	Title            string   `json:"title"`
	Language         string   `json:"language"`
	RoleFamily       string   `json:"roleFamily"`
	Seniority        string   `json:"seniority"`
	YearsRequired    *float64 `json:"yearsRequired"`
	HardSkills       []string `json:"hardSkills"`
	SoftSkills       []string `json:"softSkills"`
	Responsibilities []string `json:"responsibilities"`
	AtsKeywords      []string `json:"atsKeywords"`
	Education        string   `json:"education"`
}

type taxonomyFile struct {
	Skills []taxonomySkill `yaml:"skills"`
}
type taxonomySkill struct {
	Canonical string            `yaml:"canonical"`
	Display   map[string]string `yaml:"display"`
	Kind      string            `yaml:"kind"`
	Aliases   []string          `yaml:"aliases"`
	Parent    string            `yaml:"parent"`
	Weight    float64           `yaml:"weight"`
}
type skillTaxonomy struct {
	byCanonical map[string]taxonomySkill
	byAlias     map[string]string
	aliases     []string
}

type profileChunk struct {
	Path string
	Text string
}

func normalizeMatch(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '#' || r == '+' {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func containsPhrase(haystack, needle string) bool {
	needle = normalizeMatch(needle)
	if needle == "" {
		return false
	}
	return strings.Contains(" "+normalizeMatch(haystack)+" ", " "+needle+" ")
}

func loadSkillTaxonomy() skillTaxonomy {
	root := os.Getenv("KB_ROOT")
	if root == "" {
		root = "kb"
	}
	path := filepath.Join(root, "taxonomy", "it-software.yaml")
	raw, err := os.ReadFile(path)
	if err != nil {
		return skillTaxonomy{byCanonical: map[string]taxonomySkill{}, byAlias: map[string]string{}}
	}
	var file taxonomyFile
	if yaml.Unmarshal(raw, &file) != nil {
		return skillTaxonomy{byCanonical: map[string]taxonomySkill{}, byAlias: map[string]string{}}
	}
	t := skillTaxonomy{byCanonical: map[string]taxonomySkill{}, byAlias: map[string]string{}}
	for _, skill := range file.Skills {
		if skill.Weight == 0 {
			skill.Weight = 1
		}
		t.byCanonical[skill.Canonical] = skill
		aliases := append([]string{skill.Canonical, skill.Display["vi"], skill.Display["en"]}, skill.Aliases...)
		for _, alias := range aliases {
			n := normalizeMatch(alias)
			if n == "" {
				continue
			}
			if _, exists := t.byAlias[n]; !exists {
				t.byAlias[n] = skill.Canonical
				t.aliases = append(t.aliases, n)
			}
		}
	}
	sort.Slice(t.aliases, func(i, j int) bool { return len(t.aliases[i]) > len(t.aliases[j]) })
	return t
}

func (t skillTaxonomy) canonicalize(text string) (string, bool) {
	n := normalizeMatch(text)
	if c, ok := t.byAlias[n]; ok {
		return c, true
	}
	for _, alias := range t.aliases {
		if containsPhrase(n, alias) {
			return t.byAlias[alias], true
		}
	}
	return "", false
}

func (t skillTaxonomy) extract(text string) []string {
	hay := normalizeMatch(text)
	found := map[string]bool{}
	for _, alias := range t.aliases {
		if !containsPhrase(hay, alias) {
			continue
		}
		canonical := t.byAlias[alias]
		found[canonical] = true
		hay = strings.ReplaceAll(hay, alias, " ")
	}
	out := make([]string, 0, len(found))
	for c := range found {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

func (t skillTaxonomy) ancestors(canonical string) []string {
	var out []string
	seen := map[string]bool{canonical: true}
	for {
		skill, ok := t.byCanonical[canonical]
		if !ok || skill.Parent == "" || seen[skill.Parent] {
			return out
		}
		out = append(out, skill.Parent)
		seen[skill.Parent] = true
		canonical = skill.Parent
	}
}

func appendChunk(out *[]profileChunk, path, text string) {
	if strings.TrimSpace(text) != "" {
		*out = append(*out, profileChunk{Path: path, Text: strings.TrimSpace(text)})
	}
}

func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func stringArray(v any) []string {
	var out []string
	if values, ok := v.([]any); ok {
		for _, value := range values {
			if s := stringValue(value); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func profileChunks(raw string) ([]profileChunk, map[string]any) {
	var p map[string]any
	if json.Unmarshal([]byte(raw), &p) != nil {
		return nil, map[string]any{}
	}
	// Giai đoạn chuyển tiếp SP-2→SP-5: hai hình dạng cùng đi qua worker này.
	// Nhận diện bằng sự có mặt của `sections`, không bằng cờ schemaVersion —
	// hồ sơ thiếu cờ không được phép rơi vào nhánh sai và trả về rỗng lặng lẽ.
	if sections, ok := p["sections"].(map[string]any); ok {
		return profileChunksV2(sections), p
	}
	var out []profileChunk
	basics, _ := p["basics"].(map[string]any)
	appendChunk(&out, "/basics/headline", stringValue(basics["headline"]))
	appendChunk(&out, "/basics/introduce", stringValue(basics["introduce"]))
	for _, item := range []struct{ key, name string }{{"skills", "name"}, {"work", "role"}, {"projects", "name"}} {
		items, _ := p[item.key].([]any)
		for i, rawItem := range items {
			m, _ := rawItem.(map[string]any)
			base := fmt.Sprintf("/%s/%d", item.key, i)
			appendChunk(&out, base+"/"+item.name, stringValue(m[item.name]))
			if item.key == "work" {
				appendChunk(&out, base+"/org", stringValue(m["org"]))
			}
			if item.key == "projects" {
				appendChunk(&out, base+"/tech", strings.Join(stringArray(m["tech"]), " · "))
			}
			for j, h := range stringArray(m["highlights"]) {
				appendChunk(&out, fmt.Sprintf("%s/highlights/%d", base, j), h)
			}
		}
	}
	for _, item := range []string{"languages", "certifications", "activities", "education"} {
		items, _ := p[item].([]any)
		for i, rawItem := range items {
			m, _ := rawItem.(map[string]any)
			base := fmt.Sprintf("/%s/%d", item, i)
			parts := []string{stringValue(m["name"]), stringValue(m["school"]), stringValue(m["degree"]), stringValue(m["major"]), stringValue(m["issuer"]), stringValue(m["role"]), stringValue(m["level"])}
			appendChunk(&out, base, strings.Join(strings.Fields(strings.Join(parts, " ")), " "))
			for j, h := range stringArray(m["highlights"]) {
				appendChunk(&out, fmt.Sprintf("%s/highlights/%d", base, j), h)
			}
		}
	}
	return out, p
}

// profileChunksV2 đọc hình dạng CV v2 (`sections.intro`, `sections.experience[]`,
// `sections.projects[]`, `sections.activities[]`, `sections.skills[]`) và trả về
// cùng kiểu profileChunk như nhánh v1, để richMatchScore/matchRequirement dùng
// chung mà không cần biết hồ sơ đến từ hình dạng nào.
func profileChunksV2(sections map[string]any) []profileChunk {
	var out []profileChunk
	if intro, ok := sections["intro"].(map[string]any); ok {
		appendChunk(&out, "/sections/intro/title", stringValue(intro["title"]))
		appendChunk(&out, "/sections/intro/summary", stringValue(intro["summary"]))
	}
	for _, section := range []struct{ key, name string }{
		{"experience", "title"}, {"projects", "name"}, {"activities", "organization"},
	} {
		items, _ := sections[section.key].([]any)
		for i, item := range items {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			base := fmt.Sprintf("/sections/%s/%d", section.key, i)
			appendChunk(&out, base+"/"+section.name, stringValue(m[section.name]))
			for j, h := range stringArray(m["highlights"]) {
				appendChunk(&out, fmt.Sprintf("%s/highlights/%d", base, j), h)
			}
		}
	}
	// skills v2 là nhóm: một mục sections.skills[i] chứa nhiều kỹ năng, nhưng
	// mỗi kỹ năng vẫn phải thành một chunk riêng để lớp keyword đối chiếu giữ
	// nguyên độ hạt hiện có (BR-57.1).
	groups, _ := sections["skills"].([]any)
	for i, group := range groups {
		m, ok := group.(map[string]any)
		if !ok {
			continue
		}
		for j, name := range stringArray(m["skills"]) {
			appendChunk(&out, fmt.Sprintf("/sections/skills/%d/skills/%d", i, j), name)
		}
	}
	return out
}

func parseJDRequirements(ctx context.Context, raw string) jdRequirements {
	var out jdRequirements
	prompt := `Read this job description and return ONLY JSON with fields title, language, roleFamily, seniority, yearsRequired, hardSkills, softSkills, responsibilities, atsKeywords, education. Use arrays for skills and responsibilities. Do not invent requirements. JD:
` + raw
	req := map[string]any{"messages": []map[string]string{{"role": "system", "content": "You extract structured job requirements. Return valid JSON only."}, {"role": "user", "content": prompt}}, "temperature": 0.1, "max_tokens": 1400, "response_format": map[string]any{"type": "json_object"}}
	if callReasonerJSON(ctx, req, &out) {
		return enrichJDRequirements(out, raw)
	}
	return enrichJDRequirements(heuristicJD(raw), raw)
}

func enrichJDRequirements(out jdRequirements, raw string) jdRequirements {
	tax := loadSkillTaxonomy()
	for _, canonical := range tax.extract(raw) {
		if skill, ok := tax.byCanonical[canonical]; ok {
			name := skill.Display["en"]
			if name == "" {
				name = canonical
			}
			out.HardSkills = appendUnique(out.HardSkills, name)
			out.AtsKeywords = appendUnique(out.AtsKeywords, name)
		}
	}
	if out.YearsRequired == nil {
		if m := regexp.MustCompile(`(?i)(?:at least|minimum|over|more than|từ|ít nhất)\s*(\d+(?:\.\d+)?)\s*(?:years?|năm)`).FindStringSubmatch(raw); len(m) == 2 {
			v, _ := strconv.ParseFloat(m[1], 64)
			out.YearsRequired = &v
		}
	}
	if out.Education == "" && regexp.MustCompile(`(?i)(bachelor|degree|đại học|cao đẳng|university|college)`).MatchString(raw) {
		out.Education = "degree"
	}
	return out
}

func appendUnique(items []string, value string) []string {
	for _, item := range items {
		if strings.EqualFold(normalizeMatch(item), normalizeMatch(value)) {
			return items
		}
	}
	return append(items, value)
}

func heuristicJD(raw string) jdRequirements {
	t := strings.ToLower(raw)
	out := jdRequirements{Title: "Job description", Seniority: "unknown", RoleFamily: "other"}
	if strings.Contains(t, "senior") {
		out.Seniority = "senior"
	} else if strings.Contains(t, "junior") {
		out.Seniority = "junior"
	} else if strings.Contains(t, "fresher") || strings.Contains(t, "graduate") {
		out.Seniority = "fresher"
	}
	if strings.Contains(t, "backend") {
		out.RoleFamily = "backend_developer"
	} else if strings.Contains(t, "frontend") {
		out.RoleFamily = "frontend_developer"
	} else if strings.Contains(t, "fullstack") {
		out.RoleFamily = "fullstack_developer"
	}
	for _, term := range []string{"react", "next.js", "node.js", "typescript", "javascript", "python", "java", "golang", "go", "docker", "kubernetes", "postgresql", "mysql", "redis", "aws", "git"} {
		if containsPhrase(raw, term) {
			out.HardSkills = appendUnique(out.HardSkills, term)
		}
	}
	return out
}

func weightedCoverage(matches []map[string]any, weights map[string]float64) *float64 {
	if len(matches) == 0 {
		return nil
	}
	var total, got float64
	for _, m := range matches {
		w := 1.0
		if v, ok := m["weight"].(float64); ok && v > 0 {
			w = v
		}
		total += w
		if m["matched"] == true {
			got += w
		}
	}
	if total == 0 {
		return nil
	}
	v := got / total * 100
	return &v
}

func matchRequirement(req string, tax skillTaxonomy, index map[string][]profileChunk, chunks []profileChunk) map[string]any {
	result := map[string]any{"requirement": req, "canonical": nil, "matched": false, "viaDescendant": nil, "evidence": []any{}, "weight": 1.0}
	if canonical, ok := tax.canonicalize(req); ok {
		result["canonical"] = canonical
		if e := index[canonical]; len(e) > 0 {
			result["matched"] = true
			result["evidence"] = evidenceFor(e, 3)
			if skill, ok := tax.byCanonical[canonical]; ok && skill.Weight > 0 {
				result["weight"] = skill.Weight
			}
			return result
		}
		for c, e := range index {
			for _, parent := range tax.ancestors(c) {
				if parent == canonical {
					result["matched"] = true
					result["viaDescendant"] = c
					result["evidence"] = evidenceFor(e, 2)
					return result
				}
			}
		}
	}
	var found []any
	for _, c := range chunks {
		if containsPhrase(c.Text, req) {
			found = append(found, map[string]any{"path": c.Path, "excerpt": excerptMatch(c.Text)})
		}
	}
	if len(found) > 0 {
		result["matched"] = true
		result["evidence"] = found[:minInt(3, len(found))]
	}
	return result
}

func evidenceFor(chunks []profileChunk, n int) []any {
	out := make([]any, 0, minInt(n, len(chunks)))
	for _, c := range chunks[:minInt(n, len(chunks))] {
		out = append(out, map[string]any{"path": c.Path, "excerpt": excerptMatch(c.Text), "score": 1.0})
	}
	return out
}
func excerptMatch(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 120 {
		return s
	}
	return s[:119] + "…"
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func richMatchScore(ctx context.Context, profile, rawJD string) (map[string]any, []map[string]any, []map[string]any) {
	chunks, p := profileChunks(profile)
	tax := loadSkillTaxonomy()
	jd := parseJDRequirements(ctx, rawJD)
	index := map[string][]profileChunk{}
	for _, c := range chunks {
		for _, canonical := range tax.extract(c.Text) {
			index[canonical] = append(index[canonical], c)
		}
	}
	hard, soft := []map[string]any{}, []map[string]any{}
	for _, req := range jd.HardSkills {
		hard = append(hard, matchRequirement(req, tax, index, chunks))
	}
	for _, req := range jd.SoftSkills {
		soft = append(soft, matchRequirement(req, tax, index, chunks))
	}
	atsMatched, atsMissing := []string{}, []string{}
	hay := strings.Join(func() []string {
		a := []string{}
		for _, c := range chunks {
			a = append(a, c.Text)
		}
		return a
	}(), " | ")
	for _, kw := range jd.AtsKeywords {
		if containsPhrase(hay, kw) {
			atsMatched = append(atsMatched, kw)
		} else {
			atsMissing = append(atsMissing, kw)
		}
	}
	parts := map[string]any{}
	hardScore := weightedCoverage(hard, nil)
	softScore := weightedCoverage(soft, nil)
	atsScore := any(nil)
	if len(jd.AtsKeywords) > 0 {
		atsScore = float64(len(atsMatched)) * 100 / float64(len(jd.AtsKeywords))
	}
	parts["hard"], parts["soft"], parts["ats"] = hardScore, softScore, atsScore
	var sum, weight float64
	for _, x := range []struct {
		v *float64
		w float64
	}{{hardScore, .6}, {softScore, .2}, {func() *float64 {
		if v, ok := atsScore.(float64); ok {
			return &v
		}
		return nil
	}(), .2}} {
		if x.v != nil {
			sum += *x.v * x.w
			weight += x.w
		}
	}
	keyword := 0.0
	if weight > 0 {
		keyword = sum / weight
	}
	matched := []map[string]any{}
	gaps := []map[string]any{}
	for _, list := range [][]map[string]any{hard, soft} {
		for _, m := range list {
			if m["matched"] == true {
				matched = append(matched, map[string]any{"requirement": m["requirement"], "evidence": m["evidence"], "strength": "strong"})
			} else {
				gaps = append(gaps, map[string]any{"id": "missing:" + stringValue(m["requirement"]), "requirement": m["requirement"], "severity": "high", "reason": "missing", "advice": nil, "kbRefs": []string{}})
			}
		}
	}
	experience := estimateProfileYears(p)
	if jd.YearsRequired != nil && *jd.YearsRequired > 0 {
		experience = minFloat(100, experience/(*jd.YearsRequired)*100)
	}
	education := 0.0
	items, _ := p["education"].([]any)
	if len(items) > 0 {
		education = 100
	}
	if jd.Education != "" && education > 0 {
		education = 60
		want := strings.Fields(strings.ToLower(jd.Education))
		if len(want) > 0 {
			want = want[:1]
		}
		for _, rawItem := range items {
			m, _ := rawItem.(map[string]any)
			text := strings.ToLower(strings.Join([]string{stringValue(m["degree"]), stringValue(m["major"]), stringValue(m["school"])}, " "))
			if len(want) > 0 && strings.Contains(text, want[0]) {
				education = 100
			}
		}
	}
	rubric, rubricGaps := scoreProfileRubric(p, jd)
	gaps = append(gaps, rubricGaps...)
	breakdown := map[string]any{"skills": int(keyword), "experience": int(experience), "education": int(education), "keywords": int(atsScoreFloat(atsScore)), "rubric": int(rubric)}
	score := map[string]any{"overall": int(combineMatchBreakdown(breakdown, atsScore != nil)), "breakdown": breakdown, "missingAtsKeywords": atsMissing, "degradedReason": "Semantic/model layer chưa bật trong Go worker"}
	return score, matched, gaps
}

func combineMatchBreakdown(b map[string]any, hasATS bool) float64 {
	total, weights := 0.0, 0.0
	for _, part := range []struct {
		key    string
		weight float64
	}{{"skills", .4}, {"keywords", .15}, {"experience", .1}, {"education", .05}, {"rubric", .3}} {
		if part.key == "keywords" && !hasATS {
			continue
		}
		total += toFloat(b[part.key]) * part.weight
		weights += part.weight
	}
	if weights == 0 {
		return 0
	}
	return total / weights
}

func atsScoreFloat(v any) float64 {
	if x, ok := v.(float64); ok {
		return x
	}
	return 0
}
func estimateProfileYears(p map[string]any) float64 {
	years := map[int]bool{}
	now := time.Now().Year()
	items, _ := p["work"].([]any)
	re := regexp.MustCompile(`(?:19|20)\d{2}`)
	for _, raw := range items {
		m, _ := raw.(map[string]any)
		period := stringValue(m["startDate"]) + " " + stringValue(m["endDate"])
		nums := re.FindAllString(period, -1)
		if len(nums) == 0 {
			continue
		}
		from, _ := strconv.Atoi(nums[0])
		to := from
		if len(nums) > 1 {
			to, _ = strconv.Atoi(nums[len(nums)-1])
		}
		if strings.Contains(strings.ToLower(period), "present") || strings.Contains(strings.ToLower(period), "nay") {
			to = now
		}
		for y := from; y <= to && y <= now; y++ {
			years[y] = true
		}
	}
	return float64(len(years))
}

type rubricFile struct {
	Rubrics []rubricDefinition `yaml:"rubrics"`
}
type rubricDefinition struct {
	Industry   string            `yaml:"industry"`
	RoleFamily string            `yaml:"role_family"`
	Seniority  string            `yaml:"seniority"`
	Criteria   []rubricCriterion `yaml:"criteria"`
}
type rubricCriterion struct {
	ID          string   `yaml:"id"`
	Type        string   `yaml:"type"`
	Path        string   `yaml:"path"`
	Matcher     string   `yaml:"matcher"`
	Min         *float64 `yaml:"min"`
	Max         *float64 `yaml:"max"`
	Weight      float64  `yaml:"weight"`
	Fields      []string `yaml:"fields"`
	Recommended []string `yaml:"recommended"`
	Rule        string   `yaml:"rule"`
}

func loadRubrics() []rubricDefinition {
	root := os.Getenv("KB_ROOT")
	if root == "" {
		root = "kb"
	}
	raw, err := os.ReadFile(filepath.Join(root, "seed", "it-software-vn.yaml"))
	if err != nil {
		return nil
	}
	var f rubricFile
	if yaml.Unmarshal(raw, &f) != nil {
		return nil
	}
	return f.Rubrics
}

func selectRubric(rubrics []rubricDefinition, jd jdRequirements) *rubricDefinition {
	for _, r := range rubrics {
		if r.Industry == "it_software" && r.RoleFamily == jd.RoleFamily && r.Seniority == jd.Seniority {
			return &r
		}
	}
	for _, r := range rubrics {
		if r.Industry == "it_software" && r.Seniority == jd.Seniority {
			return &r
		}
	}
	for _, r := range rubrics {
		if r.Industry == "it_software" {
			return &r
		}
	}
	return nil
}

func allHighlights(p map[string]any) []string {
	var out []string
	for _, key := range []string{"work", "projects", "education", "activities"} {
		items, _ := p[key].([]any)
		for _, raw := range items {
			m, _ := raw.(map[string]any)
			out = append(out, stringArray(m["highlights"])...)
		}
	}
	return out
}

var metricPattern = regexp.MustCompile(`(?i)\d+\s*(%|percent|phần trăm|người dùng|user|khách|bản ghi|record|request|req/s|rps|qps|ms|giây|s\b|phút|giờ|ngày|tuần|tháng|năm|lần|dự án|thành viên|nhân sự|ticket|đơn|giao dịch|triệu|nghìn|tỷ|k\b|m\b|gb|tb|mb)`)
var quantVerbPattern = regexp.MustCompile(`(?i)(tăng|giảm|rút ngắn|tiết kiệm|cải thiện|nâng|xử lý|phục vụ|quản lý|đạt|increase|reduce|improve|save|handle|serve|process|achiev)\w*[^.]{0,40}\d`)
var weakOpenerPattern = regexp.MustCompile(`(?i)^(chịu trách nhiệm|tham gia|được giao|hỗ trợ|phụ trách|làm việc|responsible for|participated|assisted|involved in|helped|worked on|was assigned)`)

func containsMetric(s string) bool {
	return metricPattern.MatchString(s) || quantVerbPattern.MatchString(s)
}
func startsAction(s string) bool {
	return strings.TrimSpace(s) != "" && !weakOpenerPattern.MatchString(strings.TrimSpace(s))
}

func estimatePages(p map[string]any) int {
	b, _ := p["basics"].(map[string]any)
	chars := len(stringValue(b["introduce"]))
	for _, h := range allHighlights(p) {
		chars += len(h)
	}
	for _, x := range []struct {
		key string
		n   int
	}{{"work", 60}, {"projects", 60}, {"education", 50}, {"skills", 12}} {
		items, _ := p[x.key].([]any)
		chars += len(items) * x.n
	}
	pages := (chars + 2599) / 2600
	if pages < 1 {
		return 1
	}
	return pages
}

func hasProfileField(p map[string]any, field string) bool {
	if strings.HasPrefix(field, "basics.links[") {
		want := strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(field, "basics.links[?(@.label=='"), "')]"))
		b, _ := p["basics"].(map[string]any)
		links, _ := b["links"].([]any)
		for _, raw := range links {
			m, _ := raw.(map[string]any)
			if strings.Contains(strings.ToLower(stringValue(m["label"])), want) {
				return true
			}
		}
		return false
	}
	parts := strings.Split(field, ".")
	var node any = p
	for _, part := range parts {
		m, ok := node.(map[string]any)
		if !ok {
			return false
		}
		node = m[part]
	}
	return strings.TrimSpace(stringValue(node)) != ""
}

func scoreProfileRubric(p map[string]any, jd jdRequirements) (float64, []map[string]any) {
	r := selectRubric(loadRubrics(), jd)
	if r == nil {
		return 0, nil
	}
	var total, weighted float64
	var gaps []map[string]any
	for _, c := range r.Criteria {
		if c.Type == "custom" || c.Weight <= 0 {
			continue
		}
		var actual float64
		passed := false
		switch c.Type {
		case "count":
			var n int
			if items, ok := p[strings.TrimPrefix(c.Path, "$.")].([]any); ok {
				n = len(items)
			}
			actual = float64(n)
			min := float64(0)
			if c.Min != nil {
				min = *c.Min
			}
			passed = actual >= min
			if min > 0 {
				actual = minFloat(100, actual/min*100)
			} else {
				actual = 100
			}
		case "ratio":
			h := allHighlights(p)
			hits := 0
			for _, x := range h {
				if (c.Matcher == "contains_number" && containsMetric(x)) || (c.Matcher == "starts_with_action_verb" && startsAction(x)) {
					hits++
				}
			}
			ratio := 0.0
			if len(h) > 0 {
				ratio = float64(hits) / float64(len(h))
			}
			min := 0.0
			if c.Min != nil {
				min = *c.Min
			}
			passed = ratio >= min
			if min > 0 {
				actual = minFloat(100, ratio/min*100)
			} else {
				actual = 100
			}
		case "page_count":
			pages := estimatePages(p)
			max := 99.0
			if c.Max != nil {
				max = *c.Max
			}
			passed = float64(pages) <= max
			actual = 100
			if !passed {
				actual = minFloat(100, 100-float64(pages-int(max))*40)
			}
		case "required_fields":
			got := 0
			for _, f := range c.Fields {
				if hasProfileField(p, f) {
					got++
				}
			}
			rec := 0
			for _, f := range c.Recommended {
				if hasProfileField(p, f) {
					rec++
				}
			}
			reqScore := 100.0
			if len(c.Fields) > 0 {
				reqScore = float64(got) / float64(len(c.Fields)) * 100
			}
			recScore := 100.0
			if len(c.Recommended) > 0 {
				recScore = float64(rec) / float64(len(c.Recommended)) * 100
			}
			actual = reqScore*.8 + recScore*.2
			passed = got == len(c.Fields)
		default:
			continue
		}
		score := actual
		if c.Type == "count" || c.Type == "ratio" { /* actual is already normalized */
		}
		weighted += score * c.Weight
		total += c.Weight
		if !passed {
			gaps = append(gaps, map[string]any{"id": "rubric:" + c.ID, "requirement": c.ID, "severity": "medium", "reason": "below_threshold", "advice": nil, "kbRefs": []string{}})
		}
	}
	if total == 0 {
		return 0, gaps
	}
	return weighted / total, gaps
}
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
