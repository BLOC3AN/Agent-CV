package api

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateCVRejectsNonV2(t *testing.T) {
	cases := []struct {
		name string
		cv   json.RawMessage
	}{
		{"v1", json.RawMessage(`{"schemaVersion":1}`)},
		{"missing", nil},
		{"missing version", json.RawMessage(`{"foo":"bar"}`)},
		{"invalid json", json.RawMessage(`không phải JSON`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateCVPair(tc.cv); err == nil {
				t.Fatalf("%s: muốn lỗi, nhận nil", tc.name)
			} else if !errors.Is(err, errSchemaPairInvalid) {
				t.Fatalf("%s: lỗi %v không phải errSchemaPairInvalid", tc.name, err)
			}
		})
	}
}

func TestValidateCVAcceptsV2(t *testing.T) {
	cv := json.RawMessage(`{"schemaVersion":2,"sections":{}}`)
	if err := validateCVPair(cv); err != nil {
		t.Fatalf("CV v2 hợp lệ bị từ chối: %v", err)
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
