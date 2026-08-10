// Package pii giữ danh sách field PII dùng chung cho mọi tiến trình Go.
//
// Vì sao là một package riêng chứ không phải hằng số chép ở hai nơi: bản đầu
// chép tay, và bản chép ở worker viết nhầm "address" trong khi field thật tên
// là "location" — nên `location`, `name`, `dob`, `photo` vẫn đi kèm prompt suốt
// một thời gian dài mà không có lỗi nào được ném ra. Danh sách bảo mật mà chép
// tay thì sẽ trôi, và lúc trôi thì hỏng im lặng.
package pii

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
// Production chỉ nhận CV v2; hồ sơ thiếu `sections` vẫn không được phép trở
// thành đường vòng đưa PII ra ngoài.
func RedactDocument(doc map[string]any) {
	if sections, ok := doc["sections"].(map[string]any); ok {
		if intro, ok := sections["intro"].(map[string]any); ok {
			RedactIntro(intro)
		}
	}
}
