package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errCVNotFound        = errors.New("CV not found")
	errCVRevisionAbsent  = errors.New("CV revision not found")
	errCVLayoutInvalid   = errors.New("CV layout is invalid")
	errCVSnapshotInvalid = errors.New("CV snapshot is invalid")
)

var defaultCVLayout = json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true},{"id":"summary","type":"summary","visible":true},{"id":"experience","type":"experience","visible":true},{"id":"projects","type":"projects","visible":true},{"id":"education","type":"education","visible":true},{"id":"skills","type":"skills","visible":true},{"id":"certifications","type":"certifications","visible":true},{"id":"languages","type":"languages","visible":true},{"id":"footer","type":"footer","visible":true}]}`)

type cvLayoutNode struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Visible   *bool           `json:"visible"`
	ItemOrder json.RawMessage `json:"itemOrder,omitempty"`
}

type cvLayout struct {
	Version int            `json:"version"`
	Nodes   []cvLayoutNode `json:"nodes"`
}

type CVRevisionSnapshot struct {
	ProfileSnapshot json.RawMessage `json:"profileSnapshot"`
	Layout          json.RawMessage `json:"layout"`
}

type CVRevision struct {
	ID               string          `json:"id"`
	Number           int             `json:"number"`
	CVID             string          `json:"cvId"`
	Source           string          `json:"source"`
	Message          *string         `json:"message,omitempty"`
	ParentRevisionID *string         `json:"parentRevisionId,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
	ProfileSnapshot  json.RawMessage `json:"profileSnapshot"`
	Layout           json.RawMessage `json:"layout"`
}

type CVRevisionSummary struct {
	ID               string    `json:"id"`
	Number           int       `json:"number"`
	CVID             string    `json:"cvId"`
	Source           string    `json:"source"`
	Message          *string   `json:"message,omitempty"`
	ParentRevisionID *string   `json:"parentRevisionId,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
}

type cvEnvelope struct {
	ID              string          `json:"id"`
	ProfileID       string          `json:"profileId"`
	Title           string          `json:"title"`
	TemplateID      string          `json:"templateId"`
	Theme           json.RawMessage `json:"theme"`
	Layout          json.RawMessage `json:"layout"`
	Language        string          `json:"language"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	ProfileSnapshot json.RawMessage `json:"profileSnapshot"`
	SchemaVersion   int             `json:"schemaVersion"`
}

type lockedCV struct {
	ID         string
	ProfileID  string
	Title      string
	TemplateID string
	Theme      json.RawMessage
	Language   string
}

func normalizeCVLayout(raw []byte) (json.RawMessage, error) {
	return parseCVLayout(raw, true)
}

func validateCVLayout(raw []byte) (json.RawMessage, error) {
	return parseCVLayout(raw, false)
}

func parseCVLayout(raw []byte, allowLegacyEmpty bool) (json.RawMessage, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		if !allowLegacyEmpty {
			return nil, errCVLayoutInvalid
		}
		return append(json.RawMessage(nil), defaultCVLayout...), nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var layout cvLayout
	if err := decoder.Decode(&layout); err != nil {
		return nil, errCVLayoutInvalid
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, errCVLayoutInvalid
	}
	if layout.Version != 1 || layout.Nodes == nil {
		return nil, errCVLayoutInvalid
	}
	for _, node := range layout.Nodes {
		if node.ID == "" || node.Visible == nil || !validCVNodeType(node.Type) {
			return nil, errCVLayoutInvalid
		}
		if len(node.ItemOrder) > 0 {
			if node.Type != "experience" && node.Type != "projects" && node.Type != "education" || string(node.ItemOrder) == "null" {
				return nil, errCVLayoutInvalid
			}
			var itemOrder []string
			if json.Unmarshal(node.ItemOrder, &itemOrder) != nil {
				return nil, errCVLayoutInvalid
			}
		}
	}
	return append(json.RawMessage(nil), raw...), nil
}

func validCVNodeType(kind string) bool {
	switch kind {
	case "header", "summary", "experience", "projects", "education", "skills", "certifications", "languages", "footer":
		return true
	default:
		return false
	}
}

func isInvalidCVIdentifier(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}

// normalizeCommittedCV materializes the public CV defaults before a revision
// becomes immutable API data. Existing profile PATCH validation remains the
// deliberately narrower v2 boundary for backwards compatibility.
func normalizeCommittedCV(raw, layout json.RawMessage) (json.RawMessage, error) {
	var cv map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&cv); err != nil || cv == nil {
		return nil, errCVSnapshotInvalid
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF || !hasSchemaVersion(raw, 2) {
		return nil, errCVSnapshotInvalid
	}
	if !requiredCVString(cv, "id") || !requiredCVString(cv, "title") || !requiredCVString(cv, "lastModified") {
		return nil, errCVSnapshotInvalid
	}
	language, ok := cv["language"].(string)
	if !ok || (language != "vi" && language != "en") {
		return nil, errCVSnapshotInvalid
	}
	sections, ok := cv["sections"].(map[string]any)
	if !ok || !normalizeCVSections(sections) || !normalizeCVDesign(cv) || !normalizeCVActiveSections(cv) || !normalizeCVMeta(cv) {
		return nil, errCVSnapshotInvalid
	}
	var layoutValue any
	if json.Unmarshal(layout, &layoutValue) != nil {
		return nil, errCVSnapshotInvalid
	}
	// The outer layout is authoritative for commits. Embed that normalized
	// value too, so snapshots fulfil the SPA's CV contract on every response.
	cv["layout"] = layoutValue
	normalized, err := json.Marshal(cv)
	if err != nil {
		return nil, errCVSnapshotInvalid
	}
	return normalized, nil
}

func requiredCVString(value map[string]any, key string) bool {
	_, ok := value[key].(string)
	return ok
}

func defaultCVString(value map[string]any, key, fallback string) bool {
	if _, exists := value[key]; !exists {
		value[key] = fallback
		return true
	}
	return requiredCVString(value, key)
}

func defaultCVBool(value map[string]any, key string, fallback bool) bool {
	if _, exists := value[key]; !exists {
		value[key] = fallback
		return true
	}
	_, ok := value[key].(bool)
	return ok
}

func defaultCVStringSlice(value map[string]any, key string) bool {
	if _, exists := value[key]; !exists {
		value[key] = []any{}
		return true
	}
	items, ok := value[key].([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

func normalizeCVSections(sections map[string]any) bool {
	intro, ok := sections["intro"].(map[string]any)
	if !ok || !requiredCVString(intro, "fullName") {
		return false
	}
	for _, key := range []string{"title", "email", "phone", "location", "summary"} {
		if !defaultCVString(intro, key, "") {
			return false
		}
	}
	for _, key := range []string{"website", "avatarUrl"} {
		if _, exists := intro[key]; exists && !requiredCVString(intro, key) {
			return false
		}
	}
	return normalizeCVItemArray(sections, "experience", cvItemRule{required: []string{"id", "title", "company"}, strings: []string{"startDate", "endDate"}, bools: []string{"current"}, stringSlices: []string{"highlights"}}) &&
		normalizeCVItemArray(sections, "projects", cvItemRule{required: []string{"id", "name"}, strings: []string{"role", "startDate", "endDate"}, optionalStrings: []string{"link"}, stringSlices: []string{"highlights"}}) &&
		normalizeCVItemArray(sections, "education", cvItemRule{required: []string{"id", "school"}, strings: []string{"degree", "fieldOfStudy", "startDate", "endDate"}, optionalStrings: []string{"gpa"}, stringSlices: []string{"highlights"}}) &&
		normalizeCVItemArray(sections, "skills", cvItemRule{required: []string{"id", "category"}, stringSlices: []string{"skills"}}) &&
		normalizeCVItemArray(sections, "activities", cvItemRule{required: []string{"id", "organization"}, strings: []string{"role", "startDate", "endDate"}, stringSlices: []string{"highlights"}}) &&
		normalizeCVItemArray(sections, "certifications", cvItemRule{required: []string{"id", "name"}, strings: []string{"issuer", "date"}, optionalStrings: []string{"link"}}) &&
		normalizeCVItemArray(sections, "languages", cvItemRule{required: []string{"id", "language"}, strings: []string{"proficiency"}})
}

type cvItemRule struct{ required, strings, optionalStrings, bools, stringSlices []string }

func normalizeCVItemArray(sections map[string]any, key string, rule cvItemRule) bool {
	value, exists := sections[key]
	if !exists {
		sections[key] = []any{}
		return true
	}
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, value := range items {
		item, ok := value.(map[string]any)
		if !ok || !normalizeCVItem(item, rule) {
			return false
		}
	}
	return true
}

func normalizeCVItem(item map[string]any, rule cvItemRule) bool {
	allowed := make(map[string]bool)
	for _, keys := range [][]string{rule.required, rule.strings, rule.optionalStrings, rule.bools, rule.stringSlices} {
		for _, key := range keys {
			allowed[key] = true
		}
	}
	for key := range item {
		if !allowed[key] {
			return false
		}
	}
	for _, key := range rule.required {
		if !requiredCVString(item, key) {
			return false
		}
	}
	for _, key := range rule.strings {
		if !defaultCVString(item, key, "") {
			return false
		}
	}
	for _, key := range rule.optionalStrings {
		if _, exists := item[key]; exists && !requiredCVString(item, key) {
			return false
		}
	}
	for _, key := range rule.bools {
		if !defaultCVBool(item, key, false) {
			return false
		}
	}
	for _, key := range rule.stringSlices {
		if !defaultCVStringSlice(item, key) {
			return false
		}
	}
	return true
}

func normalizeCVDesign(cv map[string]any) bool {
	value, exists := cv["design"]
	if !exists {
		value = map[string]any{}
		cv["design"] = value
	}
	design, ok := value.(map[string]any)
	if !ok || !defaultCVString(design, "accentColor", "#4F46E5") {
		return false
	}
	for key, fallback := range map[string]string{"template": "modern", "font": "Roboto", "spacing": "normal"} {
		if !defaultCVString(design, key, fallback) {
			return false
		}
	}
	if fontSize, exists := design["fontSize"]; exists {
		if _, ok := fontSize.(float64); !ok {
			return false
		}
	} else {
		design["fontSize"] = float64(14)
	}
	return (design["template"] == "modern" || design["template"] == "classic" || design["template"] == "professional") && (design["font"] == "Roboto" || design["font"] == "Open Sans" || design["font"] == "Lato") && (design["spacing"] == "condensed" || design["spacing"] == "normal" || design["spacing"] == "wide")
}

func normalizeCVActiveSections(cv map[string]any) bool {
	value, exists := cv["activeSections"]
	if !exists {
		value = map[string]any{}
		cv["activeSections"] = value
	}
	sections, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, key := range []string{"intro", "experience", "projects", "education", "skills", "activities", "certifications", "languages"} {
		if !defaultCVBool(sections, key, true) {
			return false
		}
	}
	return true
}

func normalizeCVMeta(cv map[string]any) bool {
	value, exists := cv["_meta"]
	if !exists {
		value = map[string]any{}
		cv["_meta"] = value
	}
	meta, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, key := range []string{"verified", "canonical"} {
		if _, exists := meta[key]; !exists {
			meta[key] = map[string]any{}
		}
		record, ok := meta[key].(map[string]any)
		if !ok {
			return false
		}
		for _, value := range record {
			if key == "verified" {
				if _, ok := value.(bool); !ok {
					return false
				}
			} else if _, ok := value.(string); !ok {
				return false
			}
		}
	}
	if !defaultCVString(meta, "source", "manual") {
		return false
	}
	return meta["source"] == "manual" || meta["source"] == "pdf_import" || meta["source"] == "ai_generated"
}

func (s *Server) loadCVEnvelope(ctx context.Context, userID, cvID string) (cvEnvelope, error) {
	var envelope cvEnvelope
	var profileRaw, layoutRaw []byte
	err := s.db.QueryRowContext(ctx, `SELECT c.id, c.profile_id, c.title, c.template_id, c.theme, c.layout, c.language, c.updated_at, p.data
		FROM cv_documents c LEFT JOIN profiles p ON p.id=c.profile_id AND p.user_id=$2
		WHERE c.id=$1 AND c.user_id=$2`, cvID, userID).Scan(
		&envelope.ID, &envelope.ProfileID, &envelope.Title, &envelope.TemplateID, &envelope.Theme, &layoutRaw, &envelope.Language, &envelope.UpdatedAt, &profileRaw)
	if err == sql.ErrNoRows {
		return cvEnvelope{}, errCVNotFound
	}
	if err != nil {
		return cvEnvelope{}, err
	}
	layout, err := normalizeCVLayout(layoutRaw)
	if err != nil {
		return cvEnvelope{}, err
	}
	_, schemaVersion, err := cvSnapshotForResponse(profileRaw)
	if err != nil {
		return cvEnvelope{}, err
	}
	envelope.Layout = layout
	envelope.ProfileSnapshot = append(json.RawMessage(nil), profileRaw...)
	envelope.SchemaVersion = schemaVersion
	return envelope, nil
}

func (s *Server) lockOwnedCV(ctx context.Context, tx *sql.Tx, userID, cvID string) (lockedCV, error) {
	var row lockedCV
	err := tx.QueryRowContext(ctx, `SELECT c.id, c.profile_id, c.title, c.template_id, c.theme, c.language
		FROM cv_documents c JOIN profiles p ON p.id=c.profile_id
		WHERE c.id=$1 AND c.user_id=$2 AND p.user_id=$2 FOR UPDATE`, cvID, userID).Scan(&row.ID, &row.ProfileID, &row.Title, &row.TemplateID, &row.Theme, &row.Language)
	if err == sql.ErrNoRows {
		return lockedCV{}, errCVNotFound
	}
	return row, err
}

func nextCVRevisionNumber(ctx context.Context, tx *sql.Tx, cvID string) (int, error) {
	var next int
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision_number), 0) + 1 FROM cv_revisions WHERE cv_id=$1`, cvID).Scan(&next)
	return next, err
}

func scanCVRevision(row interface{ Scan(...any) error }) (CVRevision, error) {
	var revision CVRevision
	if err := row.Scan(&revision.ID, &revision.Number, &revision.CVID, &revision.Source, &revision.Message, &revision.ParentRevisionID, &revision.CreatedAt, &revision.ProfileSnapshot, &revision.Layout); err != nil {
		return CVRevision{}, err
	}
	return revision, nil
}

func revisionSelect() string {
	return `SELECT id, revision_number, cv_id, source, message, parent_revision_id, created_at, profile_snapshot, layout FROM cv_revisions`
}

func (s *Server) commitCVRevision(ctx context.Context, userID, cvID string, profile, layout json.RawMessage, source, message string, parentRevisionID *string) (CVRevision, error) {
	normalizedLayout, err := validateCVLayout(layout)
	if err != nil {
		return CVRevision{}, err
	}
	normalizedProfile, err := normalizeCommittedCV(profile, normalizedLayout)
	if err != nil {
		return CVRevision{}, err
	}
	if source != "user" && source != "ai" && source != "restore" {
		return CVRevision{}, fmt.Errorf("invalid revision source")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CVRevision{}, err
	}
	defer func() { _ = tx.Rollback() }()
	locked, err := s.lockOwnedCV(ctx, tx, userID, cvID)
	if err != nil {
		return CVRevision{}, err
	}
	number, err := nextCVRevisionNumber(ctx, tx, locked.ID)
	if err != nil {
		return CVRevision{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE profiles SET data=$2::jsonb, updated_at=now() WHERE id=$1 AND user_id=$3`, locked.ProfileID, string(normalizedProfile), userID); err != nil {
		return CVRevision{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE cv_documents SET profile_snapshot=$2::jsonb, layout=$3::jsonb, updated_at=now() WHERE id=$1 AND user_id=$4`, locked.ID, string(normalizedProfile), string(normalizedLayout), userID); err != nil {
		return CVRevision{}, err
	}
	var messageArg any
	if message != "" {
		messageArg = message
	}
	var parentArg any
	if parentRevisionID != nil {
		parentArg = *parentRevisionID
	}
	revision, err := scanCVRevision(tx.QueryRowContext(ctx, `INSERT INTO cv_revisions(cv_id, revision_number, profile_snapshot, layout, source, message, parent_revision_id)
		VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) RETURNING id, revision_number, cv_id, source, message, parent_revision_id, created_at, profile_snapshot, layout`,
		locked.ID, number, string(normalizedProfile), string(normalizedLayout), source, messageArg, parentArg))
	if err != nil {
		return CVRevision{}, err
	}
	if err = tx.Commit(); err != nil {
		return CVRevision{}, err
	}
	return revision, nil
}

func (s *Server) restoreCVRevision(ctx context.Context, userID, cvID, revisionID string) (CVRevision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CVRevision{}, err
	}
	defer func() { _ = tx.Rollback() }()
	locked, err := s.lockOwnedCV(ctx, tx, userID, cvID)
	if err != nil {
		return CVRevision{}, err
	}
	target, err := scanCVRevision(tx.QueryRowContext(ctx, revisionSelect()+` WHERE cv_id=$1 AND id=$2`, locked.ID, revisionID))
	if err == sql.ErrNoRows {
		return CVRevision{}, errCVRevisionAbsent
	}
	if err != nil {
		return CVRevision{}, err
	}
	number, err := nextCVRevisionNumber(ctx, tx, locked.ID)
	if err != nil {
		return CVRevision{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE profiles SET data=$2::jsonb, updated_at=now() WHERE id=$1 AND user_id=$3`, locked.ProfileID, string(target.ProfileSnapshot), userID); err != nil {
		return CVRevision{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE cv_documents SET profile_snapshot=$2::jsonb, layout=$3::jsonb, updated_at=now() WHERE id=$1 AND user_id=$4`, locked.ID, string(target.ProfileSnapshot), string(target.Layout), userID); err != nil {
		return CVRevision{}, err
	}
	message := fmt.Sprintf("Restored revision %d", target.Number)
	parentID := target.ID
	revision, err := scanCVRevision(tx.QueryRowContext(ctx, `INSERT INTO cv_revisions(cv_id, revision_number, profile_snapshot, layout, source, message, parent_revision_id)
		VALUES ($1,$2,$3::jsonb,$4::jsonb,'restore',$5,$6) RETURNING id, revision_number, cv_id, source, message, parent_revision_id, created_at, profile_snapshot, layout`,
		locked.ID, number, string(target.ProfileSnapshot), string(target.Layout), message, parentID))
	if err != nil {
		return CVRevision{}, err
	}
	if err = tx.Commit(); err != nil {
		return CVRevision{}, err
	}
	return revision, nil
}

func (s *Server) listCVRevisions(ctx context.Context, userID, cvID string) ([]CVRevisionSummary, error) {
	if _, err := s.loadCVEnvelope(ctx, userID, cvID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, revision_number, cv_id, source, message, parent_revision_id, created_at FROM cv_revisions WHERE cv_id=$1 ORDER BY revision_number DESC`, cvID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CVRevisionSummary, 0)
	for rows.Next() {
		var item CVRevisionSummary
		if err := rows.Scan(&item.ID, &item.Number, &item.CVID, &item.Source, &item.Message, &item.ParentRevisionID, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) previewCVRevision(ctx context.Context, userID, cvID, revisionID string) (CVRevision, *CVRevisionSnapshot, error) {
	if _, err := s.loadCVEnvelope(ctx, userID, cvID); err != nil {
		return CVRevision{}, nil, err
	}
	revision, err := scanCVRevision(s.db.QueryRowContext(ctx, revisionSelect()+` WHERE cv_id=$1 AND id=$2`, cvID, revisionID))
	if err == sql.ErrNoRows {
		return CVRevision{}, nil, errCVRevisionAbsent
	}
	if err != nil {
		return CVRevision{}, nil, err
	}
	var before CVRevisionSnapshot
	err = s.db.QueryRowContext(ctx, `SELECT profile_snapshot, layout FROM cv_revisions WHERE cv_id=$1 AND revision_number<$2 ORDER BY revision_number DESC LIMIT 1`, cvID, revision.Number).Scan(&before.ProfileSnapshot, &before.Layout)
	if err == sql.ErrNoRows {
		return revision, nil, nil
	}
	if err != nil {
		return CVRevision{}, nil, err
	}
	return revision, &before, nil
}

func (s *Server) cvCommit(w http.ResponseWriter, r *http.Request, cvID string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	var body struct {
		CV      json.RawMessage `json:"cv"`
		Layout  json.RawMessage `json:"layout"`
		Source  string          `json:"source"`
		Message string          `json:"message"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body) != nil || len(body.CV) == 0 || len(body.Layout) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
		return
	}
	if body.Source != "user" && body.Source != "ai" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source không hợp lệ"})
		return
	}
	revision, err := s.commitCVRevision(r.Context(), userID, cvID, body.CV, body.Layout, body.Source, body.Message, nil)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	cv, err := s.loadCVEnvelope(r.Context(), userID, cvID)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cv": cv, "revision": revision})
}

func (s *Server) cvRevisionList(w http.ResponseWriter, r *http.Request, cvID string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	revisions, err := s.listCVRevisions(r.Context(), userID, cvID)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revisions})
}

func (s *Server) cvRevisionPreview(w http.ResponseWriter, r *http.Request, cvID, revisionID string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	revision, before, err := s.previewCVRevision(r.Context(), userID, cvID, revisionID)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	response := map[string]any{"revision": revision}
	if before != nil {
		response["before"] = before
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) cvRevisionRestore(w http.ResponseWriter, r *http.Request, cvID, revisionID string) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	revision, err := s.restoreCVRevision(r.Context(), userID, cvID, revisionID)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	cv, err := s.loadCVEnvelope(r.Context(), userID, cvID)
	if err != nil {
		s.writeCVRevisionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cv": cv, "revision": revision})
}

func (s *Server) writeCVRevisionError(w http.ResponseWriter, err error) {
	switch {
	case isInvalidCVIdentifier(err):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Mã CV hoặc revision không hợp lệ"})
	case errors.Is(err, errCVNotFound), errors.Is(err, errCVRevisionAbsent):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV hoặc revision"})
	case errors.Is(err, errSchemaV2Invalid), errors.Is(err, errCVSnapshotInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cv phải là schemaVersion 2", "code": "SCHEMA_V2_INVALID"})
	case errors.Is(err, errCVLayoutInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "layout không hợp lệ"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được CV"})
	}
}
