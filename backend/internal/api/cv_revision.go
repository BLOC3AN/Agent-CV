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
)

var (
	errCVNotFound       = errors.New("CV not found")
	errCVRevisionAbsent = errors.New("CV revision not found")
	errCVLayoutInvalid  = errors.New("CV layout is invalid")
)

var defaultCVLayout = json.RawMessage(`{"version":1,"nodes":[{"id":"header","type":"header","visible":true},{"id":"summary","type":"summary","visible":true},{"id":"experience","type":"experience","visible":true},{"id":"projects","type":"projects","visible":true},{"id":"education","type":"education","visible":true},{"id":"skills","type":"skills","visible":true},{"id":"certifications","type":"certifications","visible":true},{"id":"languages","type":"languages","visible":true},{"id":"footer","type":"footer","visible":true}]}`)

type cvLayoutNode struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Visible   bool            `json:"visible"`
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
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
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
		if node.ID == "" || !validCVNodeType(node.Type) {
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
	if err := validateCVV2(profile); err != nil {
		return CVRevision{}, err
	}
	normalizedLayout, err := normalizeCVLayout(layout)
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
	if _, err = tx.ExecContext(ctx, `UPDATE profiles SET data=$2::jsonb, updated_at=now() WHERE id=$1 AND user_id=$3`, locked.ProfileID, string(profile), userID); err != nil {
		return CVRevision{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE cv_documents SET profile_snapshot=$2::jsonb, layout=$3::jsonb, updated_at=now() WHERE id=$1 AND user_id=$4`, locked.ID, string(profile), string(normalizedLayout), userID); err != nil {
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
		locked.ID, number, string(profile), string(normalizedLayout), source, messageArg, parentArg))
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
	case errors.Is(err, errCVNotFound), errors.Is(err, errCVRevisionAbsent):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV hoặc revision"})
	case errors.Is(err, errSchemaV2Invalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cv phải là schemaVersion 2", "code": "SCHEMA_V2_INVALID"})
	case errors.Is(err, errCVLayoutInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "layout không hợp lệ"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không lưu được CV"})
	}
}
