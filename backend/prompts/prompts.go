// Package prompts giữ toàn bộ văn bản prompt gửi cho model.
//
// Văn bản nằm trong prompt_v1/*.md chứ không phải string literal trong mã: sửa
// câu chữ và sửa logic phải trông khác nhau trong diff, và người sửa prompt
// không nên phải mở mã nguồn Go.
//
// Nhúng bằng go:embed chứ không đọc từ đĩa: prompt là hợp đồng với
// chatResponseSchema, parseChatModelOutput và validateChatProposalDocuments —
// cả ba nằm trong binary. Để prompt trôi nổi bên ngoài là tạo ra khả năng nó
// lệch pha với validator mà không cơ chế nào phát hiện.
package prompts

import (
	"embed"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

//go:embed prompt_v1/*.md
var files embed.FS

// version là hằng số chứ không phải cấu hình. Đã nhúng vào binary thì đổi prompt
// vốn đã phải build lại; thêm một công tắc runtime chọn version chỉ tạo ra tổ
// hợp trạng thái không ai kiểm được. Khi thật sự có prompt_v2 cần chạy song song
// để so sánh thì thêm công tắc — lúc đó nó mới có việc để làm.
const version = "prompt_v1"

type prompt struct {
	body      string
	variables []string
}

type frontmatter struct {
	Name      string   `yaml:"name"`
	Version   string   `yaml:"version"`
	Variables []string `yaml:"variables"`
}

// Chỉ chữ thường và gạch dưới: giữ tập placeholder hẹp để không nhặt nhầm dấu
// ngoặc nhọn trong các ví dụ JSON mà prompt chat đầy rẫy.
var placeholderPattern = regexp.MustCompile(`{{([a-z_]+)}}`)

var loaded map[string]prompt

func init() {
	m, err := load()
	if err != nil {
		// Panic lúc khởi động, không phải lỗi runtime giữa một cuộc chat: đây là
		// tài sản đã nhúng trong binary nên sai thì `go test` phải đỏ, chứ không
		// phải người dùng gặp.
		panic("prompts: " + err.Error())
	}
	loaded = m
}

func load() (map[string]prompt, error) {
	entries, err := fs.ReadDir(files, version)
	if err != nil {
		return nil, err
	}
	out := make(map[string]prompt, len(entries))
	for _, entry := range entries {
		name := strings.TrimSuffix(entry.Name(), ".md")
		raw, err := fs.ReadFile(files, version+"/"+entry.Name())
		if err != nil {
			return nil, err
		}
		p, err := parse(name, string(raw))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", entry.Name(), err)
		}
		out[name] = p
	}
	return out, nil
}

func parse(name, raw string) (prompt, error) {
	head, body, err := splitFrontmatter(raw)
	if err != nil {
		return prompt{}, err
	}
	var meta frontmatter
	if err := yaml.Unmarshal([]byte(head), &meta); err != nil {
		return prompt{}, fmt.Errorf("frontmatter hỏng: %w", err)
	}
	if meta.Name != name {
		return prompt{}, fmt.Errorf("name %q không khớp tên file %q", meta.Name, name)
	}
	if meta.Version != version {
		return prompt{}, fmt.Errorf("version %q không khớp thư mục %q", meta.Version, version)
	}
	// Dấu xuống dòng cuối file là quy ước của file văn bản, không phải một phần
	// của prompt — không để nó lọt sang model.
	body = strings.TrimRight(body, " \t\n")
	if body == "" {
		return prompt{}, fmt.Errorf("thân prompt rỗng")
	}
	if err := checkVariables(meta.Variables, body); err != nil {
		return prompt{}, err
	}
	return prompt{body: body, variables: meta.Variables}, nil
}

func splitFrontmatter(raw string) (string, string, error) {
	const fence = "---\n"
	if !strings.HasPrefix(raw, fence) {
		return "", "", fmt.Errorf("thiếu frontmatter mở đầu")
	}
	rest := raw[len(fence):]
	end := strings.Index(rest, "\n"+fence)
	if end < 0 {
		return "", "", fmt.Errorf("frontmatter không được đóng")
	}
	return rest[:end+1], rest[end+len("\n"+fence):], nil
}

// checkVariables khoá tập placeholder trong thân bằng đúng danh sách khai báo.
// Đây là chốt bắt lỗi thường gặp nhất khi prompt sống ngoài mã: đổi tên
// placeholder trong file mà quên sửa call site, hoặc ngược lại.
func checkVariables(declared []string, body string) error {
	used := map[string]bool{}
	for _, m := range placeholderPattern.FindAllStringSubmatch(body, -1) {
		used[m[1]] = true
	}
	for _, name := range declared {
		if !used[name] {
			return fmt.Errorf("biến %q khai báo nhưng không dùng trong thân", name)
		}
		delete(used, name)
	}
	if len(used) > 0 {
		missing := make([]string, 0, len(used))
		for name := range used {
			missing = append(missing, name)
		}
		sort.Strings(missing)
		return fmt.Errorf("thân dùng biến chưa khai báo: %s", strings.Join(missing, ", "))
	}
	return nil
}

// Render thay biến vào một prompt. Trả lỗi khi thiếu biến hoặc truyền biến không
// khai báo, thay vì lặng lẽ gửi cho model một prompt còn nguyên {{profile}}.
func Render(name string, vars map[string]string) (string, error) {
	p, ok := loaded[name]
	if !ok {
		return "", fmt.Errorf("prompt không tồn tại: %s", name)
	}
	pairs := make([]string, 0, len(p.variables)*2)
	for _, v := range p.variables {
		value, ok := vars[v]
		if !ok {
			return "", fmt.Errorf("prompt %s: thiếu biến %q", name, v)
		}
		pairs = append(pairs, "{{"+v+"}}", value)
	}
	for k := range vars {
		if !contains(p.variables, k) {
			return "", fmt.Errorf("prompt %s: biến %q không được khai báo", name, k)
		}
	}
	// NewReplacer quét một lượt, không đệ quy: giá trị chứa "{{message}}" —
	// chẳng hạn hồ sơ do người dùng nhập — không bị thay tiếp.
	return strings.NewReplacer(pairs...).Replace(p.body), nil
}

// MustRender dùng ở call site nơi tập biến là hằng, để giữ nguyên chữ ký của các
// hàm dựng prompt. Cùng khuôn với regexp.MustCompile: điều kiện panic là lỗi lập
// trình, và nó được test khoá lại nên không đến được production.
func MustRender(name string, vars map[string]string) string {
	out, err := Render(name, vars)
	if err != nil {
		panic("prompts: " + err.Error())
	}
	return out
}

// Names trả tên mọi prompt đã nạp, đã sắp xếp. Dành cho test duyệt toàn bộ.
func Names() []string {
	out := make([]string, 0, len(loaded))
	for name := range loaded {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
