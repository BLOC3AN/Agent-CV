package main

// Lọc kbRefs do model khai.
//
// Cùng một lỗi đã vá ở đường chat: model tự khai nguồn và không ai kiểm.
// runGapAdvice đã đối chiếu gapId với danh sách gap thật, nhưng KBRefs thì đi
// thẳng ra `gap["kbRefs"]` — trong khi prompt gap_advice KHÔNG hề gửi KB cho
// model, nên mọi id nó trả về đều do nó nghĩ ra.
//
// Luật trích dẫn nằm ở chính KB: `mọi lời khuyên phải trích dẫn được về một
// người thật` (frontend/packages/kb/src/types.ts), và seed hiện tại tự ghi
// `status: draft` kèm dặn dò không được lấy chunk nào từ nó cho tới khi có HR
// thật review. Chốt này thi hành đúng câu đó.

import (
	"os"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v3"
)

type kbSeedFile struct {
	Source struct {
		ID     string `yaml:"id"`
		Status string `yaml:"status"`
	} `yaml:"source"`
	Guidelines []struct {
		ID string `yaml:"id"`
	} `yaml:"guidelines"`
}

// citableKBRefs trả về tập id được phép trích dẫn: chỉ guideline thuộc nguồn đã
// `status: active`. Nguồn draft hay pending_review không tính — chúng chưa có
// tác giả thật đứng tên, mà trích dẫn không tên thì không phải trích dẫn.
func citableKBRefs() map[string]bool {
	root := os.Getenv("KB_ROOT")
	if root == "" {
		root = "kb"
	}
	out := map[string]bool{}
	paths, err := filepath.Glob(filepath.Join(root, "seed", "*.yaml"))
	if err != nil {
		return out
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var file kbSeedFile
		if yaml.Unmarshal(raw, &file) != nil {
			continue
		}
		if file.Source.Status != "active" {
			continue
		}
		for _, g := range file.Guidelines {
			if g.ID != "" {
				out[g.ID] = true
			}
		}
	}
	return out
}

// filterKBRefs bỏ mọi id không trích dẫn được. Trả thêm số id bị bỏ để chỗ gọi
// còn ghi log — im lặng bỏ thì không ai biết model đang bịa nguồn ở mức nào.
func filterKBRefs(refs []string, citable map[string]bool) ([]string, int) {
	kept := make([]string, 0, len(refs))
	dropped := 0
	for _, ref := range refs {
		if citable[strings.TrimSpace(ref)] {
			kept = append(kept, ref)
			continue
		}
		dropped++
	}
	return kept, dropped
}
