package api

import (
	"errors"
	"testing"
)

// Không có header (wantV2=false) thì phải là v1, kể cả khi v2Raw đã có sẵn —
// đây là đường giữ apps/web sống, nên cần khẳng định rõ ràng, không suy diễn
// từ các test khác.
func TestCVSnapshotForResponseDefaultsToV1(t *testing.T) {
	v1Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":1}`)
	v2Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":2}`)

	snapshot, schemaVersion, err := cvSnapshotForResponse(v1Raw, v2Raw, false)
	if err != nil {
		t.Fatalf("err = %v, muốn nil", err)
	}
	if schemaVersion != 1 {
		t.Fatalf("schemaVersion = %d, muốn 1", schemaVersion)
	}
	got, ok := snapshot.(map[string]any)
	if !ok {
		t.Fatalf("snapshot = %#v, muốn map", snapshot)
	}
	if got["schemaVersion"] != float64(1) {
		t.Fatalf("snapshot không phải bản v1: %#v", got)
	}
}

// wantV2=true và data_v2 có sẵn thì phải trả đúng nội dung v2, schemaVersion=2.
func TestCVSnapshotForResponseReturnsV2WhenBackfilled(t *testing.T) {
	v1Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":1}`)
	v2Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":2}`)

	snapshot, schemaVersion, err := cvSnapshotForResponse(v1Raw, v2Raw, true)
	if err != nil {
		t.Fatalf("err = %v, muốn nil", err)
	}
	if schemaVersion != 2 {
		t.Fatalf("schemaVersion = %d, muốn 2", schemaVersion)
	}
	got, ok := snapshot.(map[string]any)
	if !ok {
		t.Fatalf("snapshot = %#v, muốn map", snapshot)
	}
	if got["schemaVersion"] != float64(2) {
		t.Fatalf("snapshot không phải bản v2: %#v", got)
	}
}

// wantV2=true nhưng data_v2 rỗng/NULL (v2Raw nil hoặc []byte{}) — hồ sơ chưa
// backfill. Phải là errV2NotBackfilled cụ thể (errors.Is), không phải "có lỗi
// nào đó" — một lỗi parse JSON khác cũng "có lỗi" nhưng là bug khác hẳn, và
// không được kèm theo snapshot nào cả (im lặng rơi về v1 là chính xác điều
// cấm).
func TestCVSnapshotForResponseErrorsWhenNotBackfilled(t *testing.T) {
	v1Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":1}`)

	for name, v2Raw := range map[string][]byte{"nil": nil, "rỗng": {}} {
		t.Run(name, func(t *testing.T) {
			snapshot, schemaVersion, err := cvSnapshotForResponse(v1Raw, v2Raw, true)
			if !errors.Is(err, errV2NotBackfilled) {
				t.Fatalf("err = %v, muốn errV2NotBackfilled", err)
			}
			if snapshot != nil {
				t.Fatalf("snapshot = %#v, muốn nil khi chưa backfill", snapshot)
			}
			if schemaVersion != 0 {
				t.Fatalf("schemaVersion = %d, muốn 0 khi có lỗi", schemaVersion)
			}
		})
	}
}

// wantV2=true và data_v2 có mặt nhưng là JSON hỏng — phải là lỗi, không phải
// response nửa vời (snapshot rỗng nhưng err=nil), và KHÔNG được lẫn với
// errV2NotBackfilled vì đây là bug dữ liệu khác hẳn "chưa backfill".
func TestCVSnapshotForResponseErrorsOnMalformedV2JSON(t *testing.T) {
	v1Raw := []byte(`{"basics":{"name":"An"},"schemaVersion":1}`)
	v2Raw := []byte(`{not valid json`)

	snapshot, schemaVersion, err := cvSnapshotForResponse(v1Raw, v2Raw, true)
	if err == nil {
		t.Fatal("err = nil, muốn lỗi parse")
	}
	if errors.Is(err, errV2NotBackfilled) {
		t.Fatalf("err không được là errV2NotBackfilled cho JSON hỏng: %v", err)
	}
	if snapshot != nil {
		t.Fatalf("snapshot = %#v, muốn nil khi parse lỗi", snapshot)
	}
	if schemaVersion != 0 {
		t.Fatalf("schemaVersion = %d, muốn 0 khi có lỗi", schemaVersion)
	}
}
