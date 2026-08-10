package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
)

func createChatProposal(t *testing.T, db *sql.DB, fixture cvRevisionFixture, ops json.RawMessage) string {
	t.Helper()
	var sessionID, messageID, proposalID string
	if err := db.QueryRow(`INSERT INTO chat_sessions(user_id,profile_id,title) VALUES($1,$2,'AI draft') RETURNING id`, fixture.userID, fixture.profileID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO chat_messages(session_id,role,content) VALUES($1,'assistant','Đề xuất AI') RETURNING id`, sessionID).Scan(&messageID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO proposed_patches(message_id,cv_id,draft_token,profile_snapshot,layout_snapshot,ops) VALUES($1,$2,'draft-1',$3::jsonb,$4::jsonb,$5::jsonb) RETURNING id`, messageID, fixture.cvID, string(fixture.profile), string(fixture.layout), string(ops)).Scan(&proposalID); err != nil {
		t.Fatal(err)
	}
	return proposalID
}

func TestSelectChatProposalOpsAuditsAcceptedAndRejectedIndices(t *testing.T) {
	all := []json.RawMessage{json.RawMessage(`{"path":"/zero"}`), json.RawMessage(`{"path":"/one"}`), json.RawMessage(`{"path":"/two"}`)}
	selected, accepted, rejected, err := selectChatProposalOps(all, []int{2, 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || string(selected[0]) != string(all[2]) || string(selected[1]) != string(all[0]) {
		t.Fatalf("selected=%s", jsonRawArray(selected))
	}
	if !equalIntSlices(accepted, []int{2, 0}) || !equalIntSlices(rejected, []int{1}) {
		t.Fatalf("accepted=%v rejected=%v", accepted, rejected)
	}
}

func TestChatProposalSettlementAuditsDraftSelectionWithoutMutatingPersistedCV(t *testing.T) {
	db := cvRevisionDB(t)
	fixture := createCVRevisionFixture(t, db)
	ops := json.RawMessage(`[
		{"op":"replace","path":"/sections/intro/fullName","value":"AI draft","rationale":"Cập nhật tên hiển thị","grounding":{"type":"user_message","ref":"Người dùng yêu cầu"}},
		{"op":"replace","path":"/sections/intro/summary","value":"Tóm tắt mới","rationale":"Làm rõ phần giới thiệu","grounding":{"type":"user_message","ref":"Người dùng yêu cầu"}}
	]`)
	proposalID := createChatProposal(t, db, fixture, ops)
	var beforeProfile []byte
	var beforeProfileRevisions, beforeCVRevisions int
	if err := db.QueryRow(`SELECT data FROM profiles WHERE id=$1`, fixture.profileID).Scan(&beforeProfile); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM profile_revisions WHERE profile_id=$1`, fixture.profileID).Scan(&beforeProfileRevisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, fixture.cvID).Scan(&beforeCVRevisions); err != nil {
		t.Fatal(err)
	}

	handler := NewServerWithDB(db, "").Routes()
	w := cvRevisionRequest(t, handler, http.MethodPost, "/api/chat/proposals/"+proposalID, fixture.token, map[string]any{"profileId": fixture.profileID, "cvId": fixture.cvID, "draftToken": "draft-1", "accept": []int{0}})
	if w.Code != http.StatusOK {
		t.Fatalf("settle status=%d body=%s", w.Code, w.Body)
	}
	var response struct {
		Applied     int               `json:"applied"`
		Status      string            `json:"status"`
		SelectedOps []json.RawMessage `json:"selectedOps"`
		Accepted    []int             `json:"accepted"`
		Rejected    []int             `json:"rejected"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Applied != 1 || response.Status != "partial" || len(response.SelectedOps) != 1 || !equalIntSlices(response.Accepted, []int{0}) || !equalIntSlices(response.Rejected, []int{1}) {
		t.Fatalf("unexpected settlement response: %s", w.Body)
	}

	var status string
	var acceptedRaw, rejectedRaw, afterProfile []byte
	if err := db.QueryRow(`SELECT status,applied_ops,rejected_ops FROM proposed_patches WHERE id=$1`, proposalID).Scan(&status, &acceptedRaw, &rejectedRaw); err != nil {
		t.Fatal(err)
	}
	if status != "partial" || !jsonEqual(acceptedRaw, []byte(`[0]`)) || !jsonEqual(rejectedRaw, []byte(`[1]`)) {
		t.Fatalf("proposal audit status=%s accepted=%s rejected=%s", status, acceptedRaw, rejectedRaw)
	}
	if err := db.QueryRow(`SELECT data FROM profiles WHERE id=$1`, fixture.profileID).Scan(&afterProfile); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(beforeProfile, afterProfile) {
		t.Fatalf("settlement mutated profile: before=%s after=%s", beforeProfile, afterProfile)
	}
	var afterProfileRevisions, afterCVRevisions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM profile_revisions WHERE profile_id=$1`, fixture.profileID).Scan(&afterProfileRevisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM cv_revisions WHERE cv_id=$1`, fixture.cvID).Scan(&afterCVRevisions); err != nil {
		t.Fatal(err)
	}
	if afterProfileRevisions != beforeProfileRevisions || afterCVRevisions != beforeCVRevisions {
		t.Fatalf("settlement created revisions: profile=%d cv=%d", afterProfileRevisions, afterCVRevisions)
	}

	aiDraft := validRevisionCV("AI draft", "AI draft")
	w = cvRevisionRequest(t, handler, http.MethodPost, "/api/cv/"+fixture.cvID+"/commit", fixture.token, revisionCommitBody(aiDraft, fixture.layout, "ai", "Cập nhật tên hiển thị"))
	if w.Code != http.StatusOK {
		t.Fatalf("AI save status=%d body=%s", w.Code, w.Body)
	}
	var source, message string
	if err := db.QueryRow(`SELECT source,message FROM cv_revisions WHERE cv_id=$1`, fixture.cvID).Scan(&source, &message); err != nil {
		t.Fatal(err)
	}
	if source != "ai" || message != "Cập nhật tên hiển thị" {
		t.Fatalf("AI revision source=%q message=%q", source, message)
	}
}

func TestChatProposalSettlementRejectsMalformedStoredOperationVisibly(t *testing.T) {
	db := cvRevisionDB(t)
	fixture := createCVRevisionFixture(t, db)
	proposalID := createChatProposal(t, db, fixture, json.RawMessage(`[{"op":"move","path":"/sections/intro/fullName","rationale":"Không hợp lệ","grounding":{"type":"user_message","ref":"x"}}]`))

	w := cvRevisionRequest(t, NewServerWithDB(db, "").Routes(), http.MethodPost, "/api/chat/proposals/"+proposalID, fixture.token, map[string]any{"profileId": fixture.profileID, "cvId": fixture.cvID, "draftToken": "draft-1", "accept": []int{0}})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body["error"] == "" {
		t.Fatalf("malformed proposal error was not visible: %s", w.Body)
	}
}

func TestValidateChatProposalDocumentsRejectsUnregisteredAndDestructivePaths(t *testing.T) {
	profile := validRevisionCV("CV", "Candidate")
	layout := append(json.RawMessage(nil), defaultCVLayout...)
	cases := map[string]json.RawMessage{
		"unknown intro field":      json.RawMessage(`[{"op":"add","path":"/sections/intro/customField","value":"hidden","rationale":"Không được hỗ trợ","grounding":{"type":"user_message","ref":"x"}}]`),
		"forbidden design padding": json.RawMessage(`[{"op":"add","path":"/design/padding","value":24,"rationale":"Không được hỗ trợ","grounding":{"type":"user_message","ref":"x"}}]`),
		"legacy visibility flag":   json.RawMessage(`[{"op":"replace","path":"/activeSections/experience","value":false,"rationale":"Dùng layout visibility","grounding":{"type":"user_message","ref":"x"}}]`),
		"remove registered node":   json.RawMessage(`[{"op":"remove","path":"/layout/nodes/2","rationale":"Không được xóa node","grounding":{"type":"user_message","ref":"x"}}]`),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			var ops []json.RawMessage
			if err := json.Unmarshal(raw, &ops); err != nil {
				t.Fatal(err)
			}
			if err := validateChatProposalDocuments(profile, layout, ops); err == nil {
				t.Fatalf("path unexpectedly accepted: %s", raw)
			}
		})
	}
}

func TestValidateChatProposalDocumentsAcceptsCanonicalTypedFieldAndHide(t *testing.T) {
	profile := validRevisionCV("CV", "Candidate")
	layout := append(json.RawMessage(nil), defaultCVLayout...)
	var ops []json.RawMessage
	if err := json.Unmarshal([]byte(`[
		{"op":"add","path":"/sections/intro/availability","value":"Two weeks","rationale":"Thêm thông tin sẵn sàng","grounding":{"type":"user_message","ref":"x"}},
		{"op":"replace","path":"/layout/nodes/2/visible","value":false,"rationale":"Ẩn thay vì xóa","grounding":{"type":"user_message","ref":"x"}}
	]`), &ops); err != nil {
		t.Fatal(err)
	}
	if err := validateChatProposalDocuments(profile, layout, ops); err != nil {
		t.Fatalf("canonical proposal rejected: %v", err)
	}
}

func equalIntSlices(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
