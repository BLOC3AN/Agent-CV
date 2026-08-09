// Package pii giữ danh sách field PII dùng chung cho mọi tiến trình Go.
//
// Vì sao là một package riêng chứ không phải hằng số chép ở hai nơi: bản đầu
// chép tay, và bản chép ở worker viết nhầm "address" trong khi field thật tên
// là "location" — nên `location`, `name`, `dob`, `photo` vẫn đi kèm prompt suốt
// một thời gian dài mà không có lỗi nào được ném ra. Danh sách bảo mật mà chép
// tay thì sẽ trôi, và lúc trôi thì hỏng im lặng.
package pii

// ProfileKeys là các khoá trong `basics` KHÔNG BAO GIỜ được gửi tới model.
// Phải khớp PII_PATHS ở frontend/packages/schema/src/profile.ts và
// `redact_pii.required_local: true` trong config.yml.
var ProfileKeys = []string{"name", "email", "phone", "location", "dob", "photo"}

// RedactBasics xoá mọi khoá PII khỏi map `basics`, sửa tại chỗ.
func RedactBasics(basics map[string]any) {
	for _, key := range ProfileKeys {
		delete(basics, key)
	}
}
