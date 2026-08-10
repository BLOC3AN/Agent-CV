package api

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateCVV2RejectsInvalidDocuments(t *testing.T) {
	cases := []struct {
		name string
		cv   json.RawMessage
	}{
		{"old-version", json.RawMessage(`{"schemaVersion":1}`)},
		{"missing", nil},
		{"missing version", json.RawMessage(`{"foo":"bar"}`)},
		{"invalid json", json.RawMessage(`không phải JSON`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateCVV2(tc.cv); err == nil {
				t.Fatalf("%s: muốn lỗi, nhận nil", tc.name)
			} else if !errors.Is(err, errSchemaV2Invalid) {
				t.Fatalf("%s: lỗi %v không phải errSchemaV2Invalid", tc.name, err)
			}
		})
	}
}

func TestValidateCVAcceptsV2(t *testing.T) {
	cv := json.RawMessage(`{"schemaVersion":2,"sections":{}}`)
	if err := validateCVV2(cv); err != nil {
		t.Fatalf("CV v2 hợp lệ bị từ chối: %v", err)
	}
}

// hasSchemaVersion là mảnh kiểm tra nhỏ nhất: đúng một khoá, không parse cả
// tài liệu. Test riêng để chứng minh nó không âm thầm chấp nhận giá trị sai
// kiểu (chuỗi "2" thay vì số 2) hay JSON rỗng.
func TestHasSchemaVersion(t *testing.T) {
	if hasSchemaVersion(nil, 2) {
		t.Fatal("raw rỗng phải trả false")
	}
	if hasSchemaVersion(json.RawMessage(`{}`), 2) {
		t.Fatal("thiếu khoá schemaVersion phải trả false")
	}
	if hasSchemaVersion(json.RawMessage(`{"schemaVersion":"2"}`), 2) {
		t.Fatal("schemaVersion kiểu chuỗi không được coi là khớp số 2")
	}
	if hasSchemaVersion(json.RawMessage(`{"schemaVersion":1}`), 2) {
		t.Fatal("schemaVersion cũ không được coi là V2")
	}
	if !hasSchemaVersion(json.RawMessage(`{"schemaVersion":2,"sections":{}}`), 2) {
		t.Fatal("schemaVersion số 2 đúng phải trả true")
	}
}
