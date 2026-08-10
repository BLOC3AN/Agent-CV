package api

import (
	"net/http"
	"strings"
)

// SchemaVersionHeader là cờ opt-in để nhận CV v2 thay vì hồ sơ v1.
//
// Mặc định là v1, và mặc định đó không được đổi cho tới lúc cutover ở SP-5:
// apps/web đọc v1 từ chính những endpoint này và đang phục vụ production.
// Trả v2 cho một client không xin nó là làm hỏng bản đang chạy.
const SchemaVersionHeader = "X-CV-Schema"

// Chỉ đúng chuỗi "2" mới là opt-in. Giá trị lạ rơi về v1 chứ không đoán:
// đoán sai chiều này thì client nhận hình dạng nó không biết đọc, và lỗi hiện
// ra ở tận tầng giao diện, cách xa nguyên nhân.
func wantsV2(r *http.Request) bool {
	return strings.TrimSpace(r.Header.Get(SchemaVersionHeader)) == "2"
}
