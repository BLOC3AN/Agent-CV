package api

import (
	"encoding/json"
	"errors"
)

// errSchemaPairInvalid đánh dấu cặp cv/profile gửi từ client không đúng
// schemaVersion mong đợi. Ở package-level, giống errV2NotBackfilled trong
// cv_snapshot.go, để nơi gọi phân biệt được bằng errors.Is nếu sau này có
// nhiều loại lỗi khác cùng đi qua cùng một đường trả 400.
var errSchemaPairInvalid = errors.New("cặp cv/profile không đúng schemaVersion")

// validateCVPair kiểm cv là schemaVersion 2 và profile là schemaVersion 1 —
// đúng hình dạng mà saveCV() phía SPA gửi lên (frontend/apps/web-spa/src/lib/api.ts,
// Task 4): { cv: <v2>, profile: cvToProfile(cv) }.
//
// QUAN TRỌNG — giới hạn của hàm này, nói rõ để không ai hiểu nhầm nó chứng
// minh nhiều hơn thực tế: nó CHỈ chứng minh "đúng nhãn phiên bản mỗi bên",
// KHÔNG chứng minh "hai bên mô tả cùng một CV". Go không có bộ chuyển đổi
// (cvToProfile/profileToCV nằm ở frontend/packages/schema/src/cv-migrate.ts,
// TypeScript) nên không thể tự dựng lại một bên từ bên kia để so sánh. Một
// client cố ý gửi cv của người A ghép với profile của người B — cả hai đều
// đúng schemaVersion — sẽ lọt qua hàm này. Đây là giới hạn đã biết trước
// (xem "Quyết định nền" trong kế hoạch SP-3): việc phát hiện cặp lệch NỘI
// DUNG là một kiểm tra chỉ-đọc chạy sau khi ghi (Task 9 của kế hoạch), không
// phải một chốt chặn trước khi ghi — vì chốt chặn đó cần đúng bộ chuyển đổi
// mà server không có.
func validateCVPair(cvRaw, profileRaw json.RawMessage) error {
	if !hasSchemaVersion(cvRaw, 2) || !hasSchemaVersion(profileRaw, 1) {
		return errSchemaPairInvalid
	}
	return nil
}

// hasSchemaVersion kiểm đúng một khoá, không parse cả tài liệu: server không
// có schema của v2 (hay v1) và không nên giả vờ là có — parse toàn bộ document
// ở đây sẽ khiến hàm này âm thầm phụ thuộc vào hình dạng chi tiết mà chỉ
// frontend/packages/schema mới nên biết.
func hasSchemaVersion(raw json.RawMessage, want int) bool {
	if len(raw) == 0 {
		return false
	}
	var probe struct {
		SchemaVersion *int `json:"schemaVersion"`
	}
	if json.Unmarshal(raw, &probe) != nil || probe.SchemaVersion == nil {
		return false
	}
	return *probe.SchemaVersion == want
}
