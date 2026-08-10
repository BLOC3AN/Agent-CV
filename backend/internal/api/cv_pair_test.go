package api

import (
	"encoding/json"
	"errors"
	"testing"
)

// Bốn ca khớp đúng bốn ca route-contract ở TestPatchCVV2RejectsMismatchedPair
// trong server_test.go, nhưng test ở đây gọi thẳng hàm thuần — không qua
// HTTP, không cần server, không cần DB. Đây là lưới an toàn thật cho logic,
// giống cvSnapshotForResponse ở cv_snapshot_test.go (Task 2).
func TestValidateCVPairRejectsMismatch(t *testing.T) {
	cases := []struct {
		name    string
		cv      json.RawMessage
		profile json.RawMessage
	}{
		{"profile phải là v1, không phải v2", json.RawMessage(`{"schemaVersion":2}`), json.RawMessage(`{"schemaVersion":2}`)},
		{"cv phải là v2, không phải v1", json.RawMessage(`{"schemaVersion":1}`), json.RawMessage(`{"schemaVersion":1}`)},
		{"thiếu hẳn profile", json.RawMessage(`{"schemaVersion":2}`), nil},
		{"thiếu hẳn cv", nil, json.RawMessage(`{"schemaVersion":1}`)},
		{"cv không có schemaVersion", json.RawMessage(`{"foo":"bar"}`), json.RawMessage(`{"schemaVersion":1}`)},
		{"profile không phải JSON hợp lệ", json.RawMessage(`{"schemaVersion":2}`), json.RawMessage(`không phải JSON`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateCVPair(tc.cv, tc.profile); err == nil {
				t.Fatalf("%s: muốn lỗi, nhận nil", tc.name)
			} else if !errors.Is(err, errSchemaPairInvalid) {
				t.Fatalf("%s: lỗi %v không phải errSchemaPairInvalid", tc.name, err)
			}
		})
	}
}

// Cặp đúng — cv là v2, profile là v1 — phải qua được, không báo lỗi.
func TestValidateCVPairAcceptsMatchingVersions(t *testing.T) {
	cv := json.RawMessage(`{"schemaVersion":2,"sections":{}}`)
	profile := json.RawMessage(`{"schemaVersion":1,"basics":{"name":"Ada"}}`)
	if err := validateCVPair(cv, profile); err != nil {
		t.Fatalf("cặp hợp lệ bị từ chối: %v", err)
	}
}

// hasSchemaVersion là mảnh kiểm tra nhỏ nhất: đúng một khoá, không parse cả
// tài liệu. Test riêng để chứng minh nó không âm thầm chấp nhận giá trị sai
// kiểu (chuỗi "2" thay vì số 2) hay JSON rỗng.
func TestHasSchemaVersion(t *testing.T) {
	if hasSchemaVersion(nil, 1) {
		t.Fatal("raw rỗng phải trả false")
	}
	if hasSchemaVersion(json.RawMessage(`{}`), 1) {
		t.Fatal("thiếu khoá schemaVersion phải trả false")
	}
	if hasSchemaVersion(json.RawMessage(`{"schemaVersion":"1"}`), 1) {
		t.Fatal("schemaVersion kiểu chuỗi không được coi là khớp số 1")
	}
	if !hasSchemaVersion(json.RawMessage(`{"schemaVersion":1,"basics":{}}`), 1) {
		t.Fatal("schemaVersion số 1 đúng phải trả true")
	}
}
