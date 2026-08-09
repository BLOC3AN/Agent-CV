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

// IntroKeys là các khoá PII trong `sections.intro` của CV v2.
// Phải khớp PII_PATHS_V2 ở frontend/packages/schema/src/cv.ts.
//
// `website` và `summary` KHÔNG có ở đây: chúng là nội dung nghề nghiệp, model
// cần đọc để đề xuất có nghĩa. Che quá tay cũng là hỏng, chỉ theo hướng khác.
var IntroKeys = []string{"fullName", "email", "phone", "location", "avatarUrl"}

// RedactIntro xoá mọi khoá PII khỏi `sections.intro` của v2, sửa tại chỗ.
func RedactIntro(intro map[string]any) {
	for _, key := range IntroKeys {
		delete(intro, key)
	}
}

// RedactDocument nhận diện hình dạng rồi che đúng chỗ.
//
// Nhận diện bằng dữ liệu chứ không bằng cờ phiên bản: trong giai đoạn chuyển
// tiếp, hồ sơ v1 và v2 cùng đi qua một binary, và một hồ sơ thiếu
// `schemaVersion` không được phép trở thành hồ sơ không bị che.
func RedactDocument(doc map[string]any) {
	if sections, ok := doc["sections"].(map[string]any); ok {
		if intro, ok := sections["intro"].(map[string]any); ok {
			RedactIntro(intro)
		}
	}
	if basics, ok := doc["basics"].(map[string]any); ok {
		RedactBasics(basics)
	}
}
