package prompts

import (
	"strings"
	"testing"
)

// Prompt sống ngoài mã thì mất đi thứ mà compiler vẫn làm hộ: không ai báo khi
// một file biến mất khỏi thư mục. Danh sách này là chỗ duy nhất biết đủ bộ gồm
// những gì, nên xoá một file mà quên xoá call site sẽ đỏ ở đây trước.
func TestLoadsEveryPromptInVersionDirectory(t *testing.T) {
	want := []string{
		"chat.system", "chat.user", "chat.user_hint",
		"gap_advice.system", "gap_advice.user",
		"jd_requirements.system", "jd_requirements.user",
	}
	got := Names()
	if len(got) != len(want) {
		t.Fatalf("nạp được %d prompt, mong đợi %d: %v", len(got), len(want), got)
	}
	for i, name := range want {
		if got[i] != name {
			t.Fatalf("prompt thứ %d là %q, mong đợi %q", i, got[i], name)
		}
	}
}

// Lỗi thường gặp nhất khi prompt nằm ngoài mã: đổi tên placeholder trong file mà
// quên sửa call site (hoặc ngược lại). init() đã chặn, nhưng chặn bằng panic thì
// chỉ thấy khi chạy — test này đóng luật lại thành một khẳng định đọc được.
func TestDeclaredVariablesMustMatchBody(t *testing.T) {
	cases := []struct {
		name      string
		declared  []string
		body      string
		wantError string
	}{
		{"khai báo nhưng không dùng", []string{"unused"}, "không có placeholder", "khai báo nhưng không dùng"},
		{"dùng nhưng chưa khai báo", nil, "xin chào {{name}}", "chưa khai báo"},
		{"khớp nhau", []string{"name"}, "xin chào {{name}}", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := checkVariables(tc.declared, tc.body)
			if tc.wantError == "" {
				if err != nil {
					t.Fatalf("mong đợi hợp lệ, nhận: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("mong đợi lỗi chứa %q, nhận: %v", tc.wantError, err)
			}
		})
	}
}

// Dấu ngoặc nhọn có mặt dày đặc trong các ví dụ JSON của prompt chat. Placeholder
// phải hẹp đủ để không nhặt nhầm chúng, nếu không mọi ví dụ JSON đều thành biến
// chưa khai báo và không file nào nạp được.
func TestJSONBracesAreNotPlaceholders(t *testing.T) {
	body := `Trả về {"kind":"reply","text":"..."} và {{name}}`
	if err := checkVariables([]string{"name"}, body); err != nil {
		t.Fatalf("ví dụ JSON bị hiểu nhầm thành placeholder: %v", err)
	}
}

// Thiếu biến phải là lỗi chứ không phải prompt còn nguyên {{profile}} gửi cho
// model — model sẽ trả lời một cách trôi chảy về một hồ sơ không tồn tại.
func TestRenderRejectsMissingVariable(t *testing.T) {
	out, err := Render("chat.system", nil)
	if err == nil {
		t.Fatalf("mong đợi lỗi, nhận prompt: %s", out)
	}
	if !strings.Contains(err.Error(), "thiếu biến") {
		t.Fatalf("lỗi không nói rõ thiếu biến: %v", err)
	}
}

// Biến thừa nghĩa là call site và file đang hiểu khác nhau. Im lặng bỏ qua thì
// giá trị đó biến mất khỏi prompt mà không ai biết.
func TestRenderRejectsUndeclaredVariable(t *testing.T) {
	_, err := Render("chat.system", map[string]string{"reply_in": "English", "lạc": "x"})
	if err == nil || !strings.Contains(err.Error(), "không được khai báo") {
		t.Fatalf("mong đợi lỗi biến không khai báo, nhận: %v", err)
	}
}

func TestRenderRejectsUnknownPrompt(t *testing.T) {
	if _, err := Render("không.có", nil); err == nil {
		t.Fatal("prompt không tồn tại phải trả lỗi")
	}
}

// Giá trị thay vào là dữ liệu người dùng nhập. Nếu phép thay chạy đệ quy thì một
// hồ sơ chứa chuỗi "{{message}}" sẽ tự chèn được nội dung vào chỗ khác của
// prompt — đúng hình dạng của prompt injection.
func TestRenderDoesNotSubstituteRecursively(t *testing.T) {
	out, err := Render("chat.user", map[string]string{
		"profile": "{{message}}", "history": "[]", "answers": "[]",
		"hint_block": "", "message": "XIN CHÀO",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "PROFILE:\n{{message}}") {
		t.Fatalf("giá trị bị thay tiếp một lần nữa:\n%s", out)
	}
	if strings.Count(out, "XIN CHÀO") != 1 {
		t.Fatalf("nội dung người dùng lọt vào chỗ thứ hai:\n%s", out)
	}
}

func TestParseRejectsMalformedFiles(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		wantError string
	}{
		{"không có frontmatter", "chỉ có thân\n", "thiếu frontmatter"},
		{"frontmatter không đóng", "---\nname: a\n", "không được đóng"},
		{"name lệch tên file", "---\nname: khác\nversion: prompt_v1\nvariables: []\n---\nthân\n", "không khớp tên file"},
		{"version lệch thư mục", "---\nname: a\nversion: prompt_v9\nvariables: []\n---\nthân\n", "không khớp thư mục"},
		{"thân rỗng", "---\nname: a\nversion: prompt_v1\nvariables: []\n---\n\n", "rỗng"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parse("a", tc.raw)
			if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("mong đợi lỗi chứa %q, nhận: %v", tc.wantError, err)
			}
		})
	}
}

// Dấu xuống dòng cuối file là quy ước của trình soạn thảo, không phải một phần
// của prompt.
func TestParseTrimsTrailingNewline(t *testing.T) {
	p, err := parse("a", "---\nname: a\nversion: prompt_v1\nvariables: []\n---\nmột dòng\n\n")
	if err != nil {
		t.Fatal(err)
	}
	if p.body != "một dòng" {
		t.Fatalf("thân prompt còn khoảng trắng thừa: %q", p.body)
	}
}
