package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// Mọi chuỗi dưới đây là output THẬT của Qwen3.5-4B trong lần đo ngày
// 2026-08-14, không phải ví dụ nghĩ ra. Prompt đã cấm nói "đã cập nhật" mà model
// vẫn nói ở 12/18 lượt, nên chốt phải nằm ở máy chủ.
func TestNeutralizeProposalSummaryStripsCompletionClaims(t *testing.T) {
	measured := []string{
		"Đã cập nhật gạch đầu dòng đầu tiên trong phần kinh nghiệm để nhấn mạnh kết quả và tác động cụ thể.",
		"Đã cập nhật các bullet points trong dự án để nhấn mạnh tác động và kết quả cụ thể.",
		"Đã cập nhật phần giới thiệu để nhấn mạnh vào kinh nghiệm chuyên sâu.",
		"Đã cập nhật lại mục tiêu nghề nghiệp và tóm tắt để phù hợp với tiêu chuẩn MNC.",
	}
	for _, summary := range measured {
		got := neutralizeProposalSummary(summary)
		if strings.HasPrefix(got, "Đã ") {
			t.Fatalf("còn khẳng định đã làm xong: %q", got)
		}
		if !strings.HasPrefix(got, "Đề xuất ") {
			t.Fatalf("không chuyển sang dạng đề xuất: %q", got)
		}
	}
}

// Phần còn lại của câu phải giữ nguyên: nó là chỗ duy nhất người dùng đọc được
// model định làm gì trước khi mở bảng duyệt.
func TestNeutralizeProposalSummaryKeepsTheRestOfTheSentence(t *testing.T) {
	got := neutralizeProposalSummary("Đã cập nhật phần giới thiệu để nhấn mạnh kết quả.")
	if got != "Đề xuất cập nhật phần giới thiệu để nhấn mạnh kết quả." {
		t.Fatalf("câu bị đổi ngoài phần tiền tố: %q", got)
	}
}

// Câu vốn đã đúng thì không được đụng vào — "Thêm Docker vào nhóm kỹ năng" là
// output thật và nó không khẳng định điều gì sai.
func TestNeutralizeProposalSummaryLeavesHonestSummariesAlone(t *testing.T) {
	honest := "Thêm Docker vào nhóm kỹ năng Ngôn ngữ."
	if got := neutralizeProposalSummary(honest); got != honest {
		t.Fatalf("câu trung thực bị sửa: %q", got)
	}
}

// Con số không có trong hồ sơ lẫn lời người dùng là con số model tự nghĩ ra. Đây
// là kiểu bịa nguy hiểm nhất trong CV vì nó đọc như thành tích kiểm chứng được.
func TestDeriveGroundingFlagsInventedNumbers(t *testing.T) {
	sources := "Phát triển API cho hệ thống quản lý đơn hàng."
	value := "Tối ưu API, giảm thời gian phản hồi 40% cho 200000 người dùng."
	if got := deriveGroundingType(value, true, sources); got != "inference" {
		t.Fatalf("số bịa phải bị xếp inference, nhận %q", got)
	}
}

// Con số CÓ trong hồ sơ thì không phải bịa — viết lại câu quanh nó là việc hợp lệ.
func TestDeriveGroundingAcceptsNumbersAlreadyInTheProfile(t *testing.T) {
	sources := "Phát triển API cho hệ thống quản lý đơn hàng phục vụ 200000 người dùng."
	value := "Phát triển API quản lý đơn hàng phục vụ 200000 người dùng."
	if got := deriveGroundingType(value, true, sources); got == "inference" {
		t.Fatal("số đã có trong hồ sơ không được coi là bịa")
	}
}

// Đây là đoạn model THẬT SỰ đã sinh ra khi người dùng chỉ nói "làm phần giới
// thiệu nổi bật hơn" mà không cung cấp dữ liệu nào. Hồ sơ gốc không có một chữ
// nào về hiệu suất cao, chi phí vận hành hay dữ liệu thời gian thực.
func TestDeriveGroundingFlagsTheMeasuredFabrication(t *testing.T) {
	sources := "Lập trình viên backend, ham học hỏi, mong muốn phát triển sự nghiệp trong môi trường chuyên nghiệp. " +
		"Phát triển API cho hệ thống quản lý đơn hàng. Tham gia sửa lỗi và bảo trì hệ thống. " +
		"Làm phần giới thiệu của tôi nổi bật hơn hẳn các ứng viên khác."
	value := "Kỹ sư Backend chuyên sâu với kinh nghiệm xây dựng và tối ưu hóa các hệ thống API hiệu suất cao, " +
		"giúp giảm chi phí vận hành và cải thiện trải nghiệm người dùng. Điểm khác biệt là khả năng kết hợp " +
		"kiến trúc Go với cơ sở dữ liệu NoSQL để giải quyết các bài toán phức tạp về xử lý dữ liệu thời gian thực."
	if got := deriveGroundingType(value, true, sources); got != "inference" {
		t.Fatalf("đoạn bịa đo được phải bị xếp inference, nhận %q", got)
	}
}

// Viết lại một câu đã có, giữ nguyên dữ kiện, KHÔNG được coi là bịa — nếu không
// giao diện bỏ tick mọi đề xuất và cơ chế cảnh báo mất hết ý nghĩa.
func TestDeriveGroundingAcceptsFaithfulRewrite(t *testing.T) {
	sources := "Phát triển API cho hệ thống quản lý đơn hàng. Tham gia sửa lỗi và bảo trì hệ thống."
	value := "Phát triển và bảo trì API cho hệ thống quản lý đơn hàng."
	if got := deriveGroundingType(value, true, sources); got != "existing_field" {
		t.Fatalf("viết lại trung thành phải là existing_field, nhận %q", got)
	}
}

// Nội dung người dùng vừa cung cấp, ở một path chưa tồn tại, là user_message.
func TestDeriveGroundingCreditsTheUserMessage(t *testing.T) {
	sources := "Thêm Docker vào nhóm kỹ năng."
	if got := deriveGroundingType("Docker", false, sources); got != "user_message" {
		t.Fatalf("nội dung từ lời người dùng phải là user_message, nhận %q", got)
	}
}

func TestJSONPointerExists(t *testing.T) {
	profile := []byte(`{"sections":{"intro":{"summary":"S"},"skills":[{"skills":["Go"]}]}}`)
	cases := []struct {
		path string
		want bool
	}{
		{"/sections/intro/summary", true},
		{"/sections/intro/title", false},
		{"/sections/skills/0/skills/0", true},
		{"/sections/skills/0/skills/5", false},
		{"/sections/skills/9", false},
		{"/sections/skills/-", false},
	}
	for _, tc := range cases {
		if got := jsonPointerExists(profile, tc.path); got != tc.want {
			t.Fatalf("%s: nhận %v, mong đợi %v", tc.path, got, tc.want)
		}
	}
}

// Máy chủ phải GHI ĐÈ lời khai của model, không phải chỉ điền vào khi thiếu.
// Đo thật cho thấy model luôn khai "user_message", kể cả khi bịa.
func TestApplyDerivedGroundingOverridesTheModelClaim(t *testing.T) {
	profile := []byte(`{"sections":{"intro":{"summary":"Lập trình viên backend."}}}`)
	ops := []json.RawMessage{json.RawMessage(`{
		"op":"replace","path":"/sections/intro/summary",
		"value":"Kỹ sư đạt chứng chỉ quốc tế, tăng doanh thu 250% cho tập đoàn đa quốc gia.",
		"rationale":"nghe hay hơn",
		"grounding":{"type":"user_message","ref":"lời người dùng"},
		"kbRefs":[]
	}`)}

	patched := applyDerivedGrounding(ops, profile, "Lập trình viên backend.")

	var op struct {
		Grounding struct{ Type, Ref string } `json:"grounding"`
	}
	if err := json.Unmarshal(patched[0], &op); err != nil {
		t.Fatal(err)
	}
	if op.Grounding.Type != "inference" {
		t.Fatalf("lời khai của model không bị ghi đè: %q", op.Grounding.Type)
	}
	// ref là lời giải thích cho người đọc, không điều khiển giao diện — giữ nguyên.
	if op.Grounding.Ref != "lời người dùng" {
		t.Fatalf("ref bị đổi: %q", op.Grounding.Ref)
	}
}

// Op hỏng không được làm sập cả đề xuất: validator đã chặn chúng ở tầng trên,
// chốt này chỉ gắn nhãn.
func TestApplyDerivedGroundingSurvivesMalformedOps(t *testing.T) {
	ops := []json.RawMessage{json.RawMessage(`không phải json`), json.RawMessage(`{"op":"add"}`)}
	if got := applyDerivedGrounding(ops, []byte(`{}`), ""); len(got) != 2 {
		t.Fatalf("mất op: %d", len(got))
	}
}
