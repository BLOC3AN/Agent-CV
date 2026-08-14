package api

// Bỏ những op không áp được, giữ lại phần còn lại.
//
// Gặp thật trên production: model đề xuất 20 op cho phần chứng chỉ theo kiểu
//
//	remove  /sections/certifications/0
//	replace /sections/certifications/1/name
//	...
//	replace /sections/certifications/5/name
//
// Nó đánh số theo mảng BAN ĐẦU, nhưng JSON Patch áp TUẦN TỰ: xoá phần tử 0 xong
// thì mọi chỉ số phía sau tụt một bậc, nên tới `/certifications/5` thì mảng đã
// ngắn hơn và op đó chết. Trước bản vá, một op chết kéo theo cả 20 op bị vứt và
// người dùng nhận một câu tiếng Anh kèm chuỗi lỗi nội bộ.
//
// Đây KHÔNG phải bịa dữ kiện — 19 op kia hoàn toàn dùng được. Nên bỏ đúng cái
// hỏng, giữ phần còn lại, và nói cho người dùng biết cái nào bị bỏ.

import (
	"encoding/json"
	"strings"
)

// droppedOp là một op bị loại kèm lý do đọc được. Nó đi thẳng vào trường
// `rejected` của payload — trường này đã có trong giao thức từ trước nhưng chưa
// bao giờ được điền.
type droppedOp struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// keepApplicableOps thử áp từng op theo đúng thứ tự lên bản sao đang chạy của hồ
// sơ và layout. Op nào chết thì bỏ, tài liệu giữ nguyên trạng thái trước đó, rồi
// đi tiếp.
//
// Thử TUẦN TỰ chứ không kiểm từng op độc lập, vì tính áp được của một op phụ
// thuộc vào các op trước nó. Một op dựa vào op vừa bị bỏ sẽ tự chết theo và cũng
// bị bỏ — đó là hành vi đúng, không phải hệ quả phụ.
func keepApplicableOps(profileRaw, layoutRaw []byte, ops []json.RawMessage) ([]json.RawMessage, []droppedOp) {
	profile := append([]byte(nil), profileRaw...)
	layout := append([]byte(nil), layoutRaw...)
	kept := make([]json.RawMessage, 0, len(ops))
	var dropped []droppedOp

	for _, raw := range ops {
		var op map[string]any
		if json.Unmarshal(raw, &op) != nil {
			dropped = append(dropped, droppedOp{Path: "", Reason: "op không đọc được"})
			continue
		}
		path, _ := op["path"].(string)
		opName, _ := op["op"].(string)
		if path == "" || opName == "" {
			dropped = append(dropped, droppedOp{Path: path, Reason: "op thiếu op hoặc path"})
			continue
		}
		// Chặn path không được phép ở đây luôn, thay vì để nó giết cả đề xuất.
		if !allowedChatPatchPath(opName, path) {
			dropped = append(dropped, droppedOp{Path: path, Reason: reasonForDisallowedPath(opName, path)})
			continue
		}

		target, trial := profile, raw
		isLayout := strings.HasPrefix(path, "/layout/")
		if isLayout {
			rewritten := make(map[string]any, len(op))
			for k, v := range op {
				rewritten[k] = v
			}
			rewritten["path"] = strings.TrimPrefix(path, "/layout")
			blob, err := json.Marshal(rewritten)
			if err != nil {
				dropped = append(dropped, droppedOp{Path: path, Reason: "op không đóng gói lại được"})
				continue
			}
			target, trial = layout, blob
		}

		updated, err := applyJSONPatch(target, jsonRawArray([]json.RawMessage{trial}))
		if err != nil {
			dropped = append(dropped, droppedOp{Path: path, Reason: reasonForFailedApply(err)})
			continue
		}
		if isLayout {
			layout = updated
		} else {
			profile = updated
		}
		kept = append(kept, raw)
	}
	return kept, dropped
}

// reasonForFailedApply đổi lỗi của thư viện JSON Patch thành câu người đọc được.
//
// "doc is missing path" gần như luôn là lệch chỉ số sau một lần remove, chứ
// không phải model trỏ bừa — nói đúng nguyên nhân thì người dùng mới hiểu vì sao
// một đề xuất trông hợp lý lại bị bỏ.
func reasonForFailedApply(err error) string {
	text := err.Error()
	switch {
	case strings.Contains(text, "missing path"), strings.Contains(text, "missing value"):
		return "mục này không còn ở vị trí đó sau các thay đổi phía trên"
	case strings.Contains(text, "index"):
		return "vị trí trong danh sách không hợp lệ"
	default:
		return "không áp được vào CV"
	}
}

// droppedOpsPayload luôn trả một MẢNG, không bao giờ null: client khai kiểu
// `rejected` là mảng và `result.rejected.length` sẽ nổ nếu nhận null.
func droppedOpsPayload(dropped []droppedOp) []droppedOp {
	if dropped == nil {
		return []droppedOp{}
	}
	return dropped
}

func reasonForDisallowedPath(opName, path string) string {
	if allowed := allowedChatPatchOps(path); len(allowed) > 0 {
		return "thao tác " + opName + " không dùng được ở vị trí này"
	}
	return "vị trí này không sửa được"
}
