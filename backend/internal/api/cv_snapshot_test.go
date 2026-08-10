package api

import (
	"errors"
	"testing"
)

func TestCVSnapshotForResponseReturnsV2(t *testing.T) {
	snapshot, schemaVersion, err := cvSnapshotForResponse([]byte(`{"schemaVersion":2,"sections":{}}`))
	if err != nil {
		t.Fatalf("err = %v, muốn nil", err)
	}
	if schemaVersion != 2 {
		t.Fatalf("schemaVersion = %d, muốn 2", schemaVersion)
	}
	if snapshot == nil {
		t.Fatal("snapshot = nil")
	}
}

func TestCVSnapshotForResponseErrorsWhenMissing(t *testing.T) {
	for name, raw := range map[string][]byte{"nil": nil, "rỗng": {}} {
		t.Run(name, func(t *testing.T) {
			snapshot, schemaVersion, err := cvSnapshotForResponse(raw)
			if !errors.Is(err, errV2NotBackfilled) {
				t.Fatalf("err = %v, muốn errV2NotBackfilled", err)
			}
			if snapshot != nil || schemaVersion != 0 {
				t.Fatalf("snapshot=%#v schemaVersion=%d", snapshot, schemaVersion)
			}
		})
	}
}

func TestCVSnapshotForResponseErrorsOnMalformedJSON(t *testing.T) {
	_, schemaVersion, err := cvSnapshotForResponse([]byte(`{not valid json`))
	if err == nil || errors.Is(err, errV2NotBackfilled) {
		t.Fatalf("err = %v, muốn lỗi JSON riêng", err)
	}
	if schemaVersion != 0 {
		t.Fatalf("schemaVersion = %d, muốn 0", schemaVersion)
	}
}
