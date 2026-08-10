package api

import (
	"encoding/json"
	"errors"
	"fmt"
)

// errV2NotBackfilled đánh dấu trường hợp client xin v2 nhưng hồ sơ chưa được
// backfill. Là biến ở package-level để handler phân biệt được bằng errors.Is
// thay vì chỉ biết "có lỗi" — một lỗi parse JSON cũng "có lỗi" nhưng là bug khác.
var errV2NotBackfilled = errors.New("CV này chưa có bản v2")

// cvSnapshotForResponse quyết định trả snapshot nào (v1 hay v2) cho một CV.
//
// Tách khỏi handler để test được mà không cần Postgres, không cần request,
// không cần session: handler chỉ còn việc lấy hai cột thô (v1Raw luôn có,
// v2Raw có thể rỗng/nil khi client không xin v2 hoặc hồ sơ chưa backfill)
// rồi gọi hàm này và dịch kết quả sang HTTP response.
func cvSnapshotForResponse(v1Raw, v2Raw []byte, wantV2 bool) (snapshot any, schemaVersion int, err error) {
	if !wantV2 {
		// Mặc định là v1. Giữ nguyên hành vi cũ: bỏ qua lỗi parse thay vì fail —
		// profileRaw đến từ cột jsonb nên luôn là JSON hợp lệ trong thực tế, và
		// đường mặc định này phải byte-identical với trước khi có v2.
		var v1 any
		_ = json.Unmarshal(v1Raw, &v1)
		return v1, 1, nil
	}

	// Client đã xin v2 rõ ràng: không có data_v2 (nil hoặc rỗng) nghĩa là hồ sơ
	// chưa backfill — không được im lặng rơi về v1, phải báo lỗi phân biệt được.
	if len(v2Raw) == 0 {
		return nil, 0, errV2NotBackfilled
	}

	var v2 any
	if err := json.Unmarshal(v2Raw, &v2); err != nil {
		// data_v2 có mặt nhưng không parse được: đây là lỗi dữ liệu, không phải
		// "chưa backfill" — không được gộp chung vào errV2NotBackfilled, và
		// không được trả response nửa vời (snapshot rỗng nhưng status 200).
		return nil, 0, fmt.Errorf("parse profiles.data_v2: %w", err)
	}
	return v2, 2, nil
}
