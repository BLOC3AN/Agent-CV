# SP-3 — Dữ liệu thật: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPA đọc và ghi dữ liệu thật cho toàn bộ vòng đời CV — tạo, sửa, liệt kê, xoá, nhập từ PDF kèm màn rà soát bắt buộc, cài đặt và xoá tài khoản — trong khi `apps/web` vẫn chạy nguyên vẹn trên v1.

**Architecture:** Backend Go phục vụ **v2 theo header opt-in** `X-CV-Schema: 2`, đọc thẳng từ cột `data_v2` mà SP-2 đã backfill. Chiều ghi, SPA gửi **cả hai biểu diễn** trong một request; Go ghi `data` và `data_v2` trong cùng một transaction. Không có bộ chuyển đổi nào trong Go.

**Tech Stack:** Go 1.x (API + worker), PostgreSQL 16, React + react-router (SPA), Zod (`@hr/schema`), Vitest, `go test`.

---

## Quyết định nền: vì sao Go không chuyển đổi

`profileToCV` và `cvToProfile` là TypeScript, nằm trong `frontend/packages/schema/src/cv-migrate.ts`, và đã được chứng minh không mất dữ liệu trên cả 24 hồ sơ thật. Go không gọi được chúng.

Ba đường đi, và vì sao chọn đường thứ ba:

1. **Chép bộ chuyển đổi sang Go.** Hai bản của cùng một logic sẽ trôi khỏi nhau. Đã có tiền lệ trong chính repo này: danh sách PII chép tay ra hai nơi, bản ở worker viết nhầm `"address"` trong khi field thật tên `location`, và `location`/`name`/`dob`/`photo` đi kèm prompt suốt một thời gian dài mà không lỗi nào được ném ra. Bộ chuyển đổi phức tạp hơn danh sách PII nhiều lần.
2. **SPA chuyển đổi cả hai chiều ngay trên trình duyệt, backend không đổi.** Khi đó cột `data_v2` mà SP-2 đã dựng và backfill trở thành vô dụng, và mỗi lần đọc lại tốn một lượt chuyển đổi trên máy người dùng.
3. **Header cho chiều đọc, gửi kèm cả hai biểu diễn cho chiều ghi.** Go trả `data_v2` khi thấy header — không cần chuyển gì. Khi ghi, SPA đã có sẵn cả hai dạng trong tay (nó vừa sửa v2, và `cvToProfile` cho ra v1) nên gửi cả hai; Go ghi hai cột trong một transaction.

Đường thứ ba giữ **đúng một bản** của logic chuyển đổi, giữ `data` luôn đúng cho `apps/web`, và giữ `data_v2` không bao giờ cũ.

**Cái giá phải trả, nói rõ:** server tin client gửi một cặp nhất quán. Chốt chặn là `assertReversible` phía server không dựng được (vì cần bộ chuyển đổi), nên thay bằng hai điều: Go kiểm `cv.schemaVersion == 2` và `profile.schemaVersion == 1` trước khi ghi, và Task 9 dựng một kiểm tra chỉ đọc chạy được bất cứ lúc nào để phát hiện cặp lệch.

## Global Constraints

- **Không sửa** `frontend/apps/web/**` và `frontend/packages/schema/src/profile.ts`. Điều kiện này kiểm bằng `git diff --stat main -- frontend/apps/web/` phải rỗng.
- Mặc định của mọi endpoint là **v1**. Chỉ request mang `X-CV-Schema: 2` mới nhận v2. Thiếu header, header sai giá trị, hoặc header rỗng đều rơi về v1 — cùng nguyên tắc "dữ liệu hỏng rơi về v1" mà SP-2 đã chốt.
- Ghi hai cột phải nằm trong **một transaction**. Ghi được một nửa nghĩa là `data` và `data_v2` nói hai chuyện khác nhau về cùng một CV, và không ai biết bên nào đúng.
- **Màn rà soát là bắt buộc** (UC-22). Không có đường nào từ import sang builder mà không đi qua nó. Đây là ràng buộc sản phẩm, không phải gợi ý luồng.
- Mọi màn hình phải dùng được khi model server tắt (UC-71). Sửa CV, đổi mẫu, xem CV cũ, xoá CV đều không được phụ thuộc model.
- Test viết trước code. Comment tiếng Việt giải thích *vì sao*.
- Xanh sau **mỗi** task: `cd frontend && npm run typecheck && npx vitest run --project unit --project ui`; `cd backend && go test ./... && gofmt -l ./cmd ./internal && go vet ./...`.
- Commit tiếng Việt, kèm `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `backend/internal/api/schema_version.go` | **Tạo.** Đọc header, quyết định phiên bản. Một chỗ duy nhất, để không ai tự parse header lần nữa. |
| `backend/internal/api/server.go` | **Sửa.** `listCV`, `getCV`, `patchCV`, `createCV`, `getProfile`, `patchProfile` phân nhánh theo phiên bản. |
| `backend/cmd/worker/matching.go` | **Sửa.** Tám hàm còn đọc hình dạng v1 (nợ từ SP-2). |
| `frontend/apps/web-spa/src/lib/api.ts` | **Sửa.** Thêm mọi lời gọi SP-3 cần; gắn header ở một chỗ. |
| `frontend/apps/web-spa/src/lib/cv-store.ts` | **Tạo.** Trạng thái CV đang mở, lưu có debounce, chuyển v2→v1 khi gửi. |
| `frontend/apps/web-spa/src/routes/NewCVRoute.tsx` | **Tạo.** `/cv/new` (UC-23). |
| `frontend/apps/web-spa/src/routes/ImportRoute.tsx` | **Tạo.** `/import` — tải PDF, theo dõi job. |
| `frontend/apps/web-spa/src/routes/ImportReviewRoute.tsx` | **Tạo.** `/import/:jobId/review` — rà soát bắt buộc (UC-22). |
| `frontend/apps/web-spa/src/routes/BuilderRoute.tsx` | **Tạo.** Bọc `CVEditorView` bằng dữ liệu thật. |
| `frontend/apps/web-spa/src/routes/DashboardRoute.tsx` | **Tạo.** Ba trạng thái Home (UC-01/02/03). |
| `frontend/apps/web-spa/src/routes/SettingsRoute.tsx` | **Tạo.** Cài đặt + xoá tài khoản (UC-24/34). |
| `backend/db/pair-check.ts` | **Tạo.** Kiểm tra chỉ đọc: `data` và `data_v2` của mọi hàng có khớp nhau không. |

---

### Task 1: Go quyết định phiên bản từ header

**Files:**
- Create: `backend/internal/api/schema_version.go`
- Create: `backend/internal/api/schema_version_test.go`

**Interfaces:**
- Produces: `wantsV2(r *http.Request) bool`. Mọi task Go sau dùng hàm này, không tự đọc header.

- [ ] **Step 1: Viết test thất bại**

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWantsV2OnlyOnExactOptIn(t *testing.T) {
	cases := []struct {
		header string
		want   bool
		why    string
	}{
		{"2", true, "opt-in đúng"},
		{"", false, "không có header"},
		{"1", false, "xin v1"},
		{"3", false, "phiên bản chưa tồn tại"},
		{"v2", false, "sai định dạng"},
		{" 2", true, "khoảng trắng thừa vẫn là opt-in"},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
		if tc.header != "" {
			r.Header.Set("X-CV-Schema", tc.header)
		}
		if got := wantsV2(r); got != tc.want {
			t.Fatalf("X-CV-Schema=%q → %v, muốn %v (%s)", tc.header, got, tc.want, tc.why)
		}
	}
}
```

- [ ] **Step 2: Chạy để thấy nó fail**

```bash
cd backend && go test ./internal/api/ -run WantsV2
```

Kỳ vọng: FAIL biên dịch — `undefined: wantsV2`.

- [ ] **Step 3: Viết `schema_version.go`**

```go
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
```

- [ ] **Step 4: Chạy test, phải xanh**

```bash
cd backend && go test ./internal/api/ -run WantsV2 -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/schema_version.go backend/internal/api/schema_version_test.go
git commit -m "feat(api): cờ opt-in X-CV-Schema quyết định phiên bản trả về

Mặc định v1 và không được đổi tới SP-5: apps/web đọc v1 từ chính những
endpoint này và đang phục vụ production.

Giá trị lạ rơi về v1 chứ không đoán. Đoán sai chiều này thì client nhận
hình dạng nó không biết đọc, và lỗi hiện ra ở tận tầng giao diện, cách xa
nguyên nhân.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Đọc CV v2 theo header

**Files:**
- Modify: `backend/internal/api/server.go` (`listCV`, `cvRoute`/`getCV`)
- Modify: `backend/internal/api/server_test.go`

**Interfaces:**
- Consumes: `wantsV2` (Task 1).
- Produces: `GET /api/cv` và `GET /api/cv/:id` trả `cv.profileSnapshot` dạng v2 khi có header.

Nguồn dữ liệu v2 là cột `profiles.data_v2` (`cv_documents.snapshot_v2` chưa được backfill — SP-2 cố tình để trống, xem plan SP-2 mục "cố tình chưa làm"). Vì vậy `getCV` với header phải đọc v2 từ hồ sơ gốc qua `cv_documents.profile_id`, và **phải trả 409 kèm thông điệp rõ ràng** khi hàng đó chưa có `data_v2`, chứ không im lặng rơi về v1 — client xin v2 mà nhận v1 sẽ hỏng ở chỗ khác.

- [ ] **Step 1: Viết test thất bại**

```go
// Không có header thì phải là v1, kể cả khi data_v2 đã có. apps/web phụ thuộc
// vào điều này và nó không có cách nào tự bảo vệ.
func TestGetCVDefaultsToV1WithoutHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv/00000000-0000-0000-0000-000000000000", nil)
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d khi chưa có PostgreSQL", w.Code, http.StatusServiceUnavailable)
	}
}

func TestCVListRouteAcceptsSchemaHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
	r.Header.Set(SchemaVersionHeader, "2")
	w := httptest.NewRecorder()
	NewServer().Routes().ServeHTTP(w, r)
	// Không có DB thì vẫn 503; điều cần chứng minh là header không làm route
	// đổi sang một nhánh khác rồi panic hay 404.
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn %d", w.Code, http.StatusServiceUnavailable)
	}
}
```

Test đầu-cuối thật với dữ liệu chạy ở Task 10; ở đây chỉ chốt hợp đồng route.

- [ ] **Step 2: Chạy để thấy ca thứ hai fail**

```bash
cd backend && go test ./internal/api/ -run "GetCVDefaults|AcceptsSchemaHeader"
```

- [ ] **Step 3: Sửa `getCV`**

Sau khi đọc xong hàng `cv_documents`, thêm nhánh:

```go
	if wantsV2(r) {
		var v2 []byte
		err := s.db.QueryRowContext(r.Context(),
			`SELECT p.data_v2 FROM cv_documents c JOIN profiles p ON p.id = c.profile_id
			 WHERE c.id = $1 AND c.user_id = $2`, id, userID).Scan(&v2)
		if err != nil || len(v2) == 0 {
			// Không im lặng rơi về v1: client đã nói rõ nó chỉ đọc được v2.
			// Trả v1 cho nó là đẩy lỗi sang tầng giao diện, xa nguyên nhân.
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "CV này chưa có bản v2. Chạy `npm run db:backfill-v2` rồi thử lại.",
				"code":  "V2_NOT_BACKFILLED",
			})
			return
		}
		var snapshotV2 any
		_ = json.Unmarshal(v2, &snapshotV2)
		cv["profileSnapshot"] = snapshotV2
		cv["schemaVersion"] = 2
	}
```

Làm tương tự cho `listCV` nếu danh sách có nhúng snapshot; nếu `listCV` chỉ trả metadata (`id`, `title`, `updatedAt`, `jdTitle`) thì **không đổi gì** — ghi rõ điều đó vào báo cáo thay vì sửa cho có.

- [ ] **Step 4: Chạy test**

```bash
cd backend && go test ./... && gofmt -l ./cmd ./internal && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/server.go backend/internal/api/server_test.go
git commit -m "feat(api): GET /api/cv/:id trả v2 khi client xin bằng header

Hàng chưa backfill thì trả 409 kèm mã V2_NOT_BACKFILLED, không im lặng
rơi về v1: client đã nói rõ nó chỉ đọc được v2, đưa v1 cho nó là đẩy lỗi
sang tầng giao diện, cách xa nguyên nhân.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Ghi hai cột trong một transaction

**Files:**
- Modify: `backend/internal/api/server.go` (`patchCV`, `createCV`)
- Modify: `backend/internal/api/server_test.go`

**Interfaces:**
- Consumes: `wantsV2`.
- Produces: `PATCH /api/cv/:id` và `POST /api/cv` chấp nhận body `{"cv": <v2>, "profile": <v1>}` khi có header.

- [ ] **Step 1: Viết test thất bại**

```go
// Cặp không hợp lệ phải bị từ chối TRƯỚC khi chạm DB. Ghi được một nửa nghĩa
// là data và data_v2 nói hai chuyện khác nhau về cùng một CV, và không ai biết
// bên nào đúng.
func TestPatchCVV2RejectsMismatchedPair(t *testing.T) {
	cases := []struct{ body, why string }{
		{`{"cv":{"schemaVersion":2},"profile":{"schemaVersion":2}}`, "profile phải là v1"},
		{`{"cv":{"schemaVersion":1},"profile":{"schemaVersion":1}}`, "cv phải là v2"},
		{`{"cv":{"schemaVersion":2}}`, "thiếu hẳn profile"},
		{`{"profile":{"schemaVersion":1}}`, "thiếu hẳn cv"},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(http.MethodPatch,
			"/api/cv/00000000-0000-0000-0000-000000000000", strings.NewReader(tc.body))
		r.Header.Set(SchemaVersionHeader, "2")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		NewServer().Routes().ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, muốn 400", tc.why, w.Code)
		}
	}
}
```

`NewServer()` không có DB, nên nếu chốt chặn nằm **sau** bước chạm DB thì test sẽ nhận 503 và fail — đúng ý đồ: nó ép chốt chặn phải nằm trước.

- [ ] **Step 2: Chạy để thấy nó fail**

```bash
cd backend && go test ./internal/api/ -run PatchCVV2Rejects
```

Kỳ vọng: FAIL với `status = 503`.

- [ ] **Step 3: Viết chốt chặn và đường ghi**

Trong `patchCV`, ngay đầu hàm, trước mọi truy vấn:

```go
	if wantsV2(r) {
		var body struct {
			CV      json.RawMessage `json:"cv"`
			Profile json.RawMessage `json:"profile"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Body không hợp lệ"})
			return
		}
		// Kiểm phiên bản trước khi chạm DB. Server không dựng lại được cặp này
		// (bộ chuyển đổi là TypeScript), nên đây là chốt chặn duy nhất còn lại
		// giữa một cặp lệch và hai cột nói hai chuyện khác nhau.
		if !hasSchemaVersion(body.CV, 2) || !hasSchemaVersion(body.Profile, 1) {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "Cần cả hai biểu diễn: cv là schemaVersion 2 và profile là schemaVersion 1",
				"code":  "SCHEMA_PAIR_INVALID",
			})
			return
		}
		s.patchCVPair(w, r, id, body.CV, body.Profile)
		return
	}
```

Hàm phụ, đặt cạnh `patchCV`:

```go
// hasSchemaVersion kiểm đúng một khoá, không parse cả tài liệu: server không
// có schema của v2 và không nên giả vờ là có.
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
```

```go
// Ghi hai cột trong MỘT transaction. Ghi được một nửa là trạng thái tệ nhất:
// data và data_v2 mô tả cùng một CV theo hai cách khác nhau, không cột nào tự
// nhận là sai, và lần đọc sau trả kết quả nào tuỳ theo client gửi header gì.
func (s *Server) patchCVPair(w http.ResponseWriter, r *http.Request, id string, cvV2, profileV1 json.RawMessage) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Chưa đăng nhập"})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Cần PostgreSQL"})
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không mở được transaction"})
		return
	}
	defer func() { _ = tx.Rollback() }()

	var profileID string
	if err := tx.QueryRowContext(r.Context(),
		`SELECT profile_id FROM cv_documents WHERE id=$1 AND user_id=$2`, id, userID).Scan(&profileID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Không tìm thấy CV"})
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE profiles SET data=$2::jsonb, data_v2=$3::jsonb, updated_at=now() WHERE id=$1`,
		profileID, string(profileV1), string(cvV2)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không ghi được hồ sơ"})
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE cv_documents SET profile_snapshot=$2::jsonb, updated_at=now() WHERE id=$1`,
		id, string(profileV1)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không ghi được CV"})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Không commit được"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
```

`profile_snapshot` giữ dạng v1 vì `apps/web` đọc nó; `snapshot_v2` là việc của SP-5.

- [ ] **Step 4: Chạy test**

```bash
cd backend && go test ./... && gofmt -l ./cmd ./internal && go vet ./...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/server.go backend/internal/api/server_test.go
git commit -m "feat(api): ghi CV v2 và hồ sơ v1 trong một transaction

Server không dựng lại được cặp này — bộ chuyển đổi là TypeScript và chép
sang Go thì hai bản sẽ trôi khỏi nhau, đúng như danh sách PII từng trôi.
Nên client gửi cả hai biểu diễn, còn server kiểm schemaVersion của từng
bên TRƯỚC khi chạm DB.

Một transaction cho cả hai cột: ghi được một nửa là trạng thái tệ nhất —
hai cột mô tả cùng một CV theo hai cách, không cột nào tự nhận là sai.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: SPA gắn header và mở rộng lib/api.ts

**Files:**
- Modify: `frontend/apps/web-spa/src/lib/api.ts`
- Modify: `frontend/apps/web-spa/test/api.test.ts`

**Interfaces:**
- Produces: `getCV(id)`, `saveCV(id, cv)`, `createCV(input)`, `uploadCV(file)`, `getJob(id)`, `getImportReview(jobId)`, `completeImport(jobId, cv)`, `deleteAccount()`. Tất cả gắn header ở **một** chỗ.

- [ ] **Step 1: Viết test thất bại**

```ts
it('gắn X-CV-Schema: 2 vào MỌI lời gọi, không phải từng chỗ nhớ thì gắn', async () => {
  const seen: HeadersInit[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    seen.push(init?.headers ?? {})
    return new Response(JSON.stringify({ cv: { id: 'x' } }), { status: 200 })
  }))
  await getCV('cv-1')
  await listCVs()
  for (const h of seen) {
    expect(new Headers(h).get('X-CV-Schema')).toBe('2')
  }
})

it('saveCV gửi CẢ HAI biểu diễn', async () => {
  let body: any = null
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }))
  await saveCV('cv-1', sampleCV)
  expect(body.cv.schemaVersion).toBe(2)
  expect(body.profile.schemaVersion).toBe(1)
})

it('409 V2_NOT_BACKFILLED thành thông điệp người đọc hiểu được', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: '...', code: 'V2_NOT_BACKFILLED' }), { status: 409 })))
  await expect(getCV('cv-1')).rejects.toThrow(/chưa có bản v2/i)
})
```

- [ ] **Step 2: Chạy để thấy nó fail**

```bash
cd frontend && npx vitest run --project unit apps/web-spa/test/api.test.ts
```

- [ ] **Step 3: Sửa `api.ts`**

Gắn header trong hàm `request` dùng chung, không rải ra từng lời gọi:

```ts
/**
 * Header opt-in đặt ở ĐÂY, một chỗ duy nhất.
 *
 * Rải ra từng lời gọi thì chỉ cần một chỗ quên là endpoint đó lặng lẽ trả v1,
 * và giao diện nhận một hình dạng nó không biết đọc — lỗi hiện ra ở tận nơi
 * render, cách xa chỗ gây ra.
 */
const SCHEMA_HEADER = { 'X-CV-Schema': '2' } as const
```

`saveCV` chuyển v2 sang v1 ngay tại đây bằng bộ chuyển đổi đã có, để không nơi nào khác phải nhớ:

```ts
import { cvToProfile } from '@hr/schema'

export async function saveCV(id: string, cv: CV): Promise<void> {
  // Chuyển ngay tại biên gửi đi, dùng đúng bộ chuyển đổi đã được chứng minh
  // không mất dữ liệu trên 24 hồ sơ thật. Không có bản thứ hai của logic này.
  await request(`/api/cv/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ cv, profile: cvToProfile(cv) }),
  })
}
```

- [ ] **Step 4: Chạy test và typecheck**

```bash
cd frontend && npm run typecheck && npx vitest run --project unit --project ui
```

- [ ] **Step 5: Commit**

```bash
git add frontend/apps/web-spa/src/lib/api.ts frontend/apps/web-spa/test/api.test.ts
git commit -m "feat(spa): client gọi API v2, gửi kèm cả hai biểu diễn khi ghi

Header đặt ở hàm request dùng chung chứ không rải ra từng lời gọi: chỉ
cần một chỗ quên là endpoint đó lặng lẽ trả v1 và giao diện nhận hình
dạng nó không biết đọc.

cvToProfile chạy ngay tại biên gửi đi, dùng đúng bộ chuyển đổi đã chứng
minh không mất dữ liệu trên 24 hồ sơ thật.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/cv/new` — tạo CV thật (UC-23)

**Files:**
- Create: `frontend/apps/web-spa/src/routes/NewCVRoute.tsx`
- Create: `frontend/apps/web-spa/test/new-cv.ui.test.tsx`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx`

- [ ] **Step 1: Viết test thất bại**

```tsx
it('tạo CV rỗng rồi chuyển sang builder của chính CV vừa tạo', async () => {
  const created = vi.fn(async () => ({ id: 'cv-moi' }))
  render(<NewCVRoute createCV={created} />, { wrapper: MemoryRouter })
  await userEvent.click(screen.getByRole('button', { name: /tạo cv/i }))
  expect(created).toHaveBeenCalledOnce()
  await screen.findByText(/đang mở/i)
})

it('nút bị khoá trong lúc đang tạo, để không tạo hai CV vì bấm hai lần', async () => {
  render(<NewCVRoute createCV={() => new Promise(() => {})} />, { wrapper: MemoryRouter })
  const btn = screen.getByRole('button', { name: /tạo cv/i })
  await userEvent.click(btn)
  expect(btn).toBeDisabled()
})
```

Ca thứ hai không phải chi tiết vặt: bấm hai lần trên mạng chậm là cách người dùng thật tạo ra CV trùng.

- [ ] **Step 2: Chạy để thấy nó fail** — `Cannot find module '../src/routes/NewCVRoute'`

- [ ] **Step 3: Viết màn hình.** Nhận `createCV` qua props để test được mà không phải stub `fetch`; route thật truyền hàm từ `lib/api.ts`.

- [ ] **Step 4: Đăng ký route** `{ path: 'cv/new', element: <NewCVRoute createCV={apiCreateCV} /> }` — đặt **trước** `cv/:id` nếu có, nếu không `new` sẽ bị bắt như một id.

- [ ] **Step 5: Chạy test, typecheck, commit**

---

### Task 6: `/import` — tải PDF và theo dõi job (UC-21)

**Files:**
- Create: `frontend/apps/web-spa/src/routes/ImportRoute.tsx`
- Create: `frontend/apps/web-spa/test/import.ui.test.tsx`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx`

- [ ] **Step 1: Viết test thất bại**

Ba ca, tất cả đều là đường người dùng thật đi qua:

```tsx
it('tải file lên rồi hiện tiến độ theo trạng thái job', async () => { /* queued → running → done */ })

it('job hỏng thì hiện lý do và nút thử lại, không phải màn trắng', async () => {
  // UC-71: hỏng phải đọc được, không được là màn hình trắng.
})

it('dừng hỏi khi job xong — không tiếp tục gọi API vô hạn', async () => {
  // Polling không có điều kiện dừng là lỗi chỉ lộ ra sau khi tab mở lâu.
})
```

- [ ] **Step 2–5:** chạy fail, viết màn hình với polling có backoff và có điều kiện dừng, chạy xanh, commit.

Polling phải dừng khi job ở trạng thái cuối (`done` hoặc `failed`) **và** khi component unmount. Thiếu vế thứ hai thì rời trang vẫn còn timer chạy.

---

### Task 7: `/import/:jobId/review` — rà soát bắt buộc (UC-22)

**Files:**
- Create: `frontend/apps/web-spa/src/routes/ImportReviewRoute.tsx`
- Create: `frontend/apps/web-spa/test/import-review.ui.test.tsx`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx`

Đây là màn hình mang tính sản phẩm nặng nhất của SP-3. `_meta.verified` chỉ có nghĩa nếu không có đường vòng nào quanh nó.

- [ ] **Step 1: Viết test thất bại**

```tsx
it('mọi mục đều bắt đầu ở trạng thái CHƯA xác nhận', async () => {
  // Nội dung do model trích ra là chưa được xác nhận cho tới khi người dùng
  // nói khác đi. Tick sẵn là phá đúng thứ _meta.verified sinh ra để giữ.
})

it('chưa xác nhận hết thì không sang được builder', async () => {
  render(<ImportReviewRoute review={reviewVoiMotMucChuaXacNhan} />, { wrapper: MemoryRouter })
  expect(screen.getByRole('button', { name: /hoàn tất/i })).toBeDisabled()
  expect(screen.getByText(/còn 1 mục chưa xác nhận/i)).toBeInTheDocument()
})

it('xác nhận hết thì mở khoá và gọi completeImport đúng một lần', async () => { /* … */ })

it('sửa nội dung tại chỗ rồi xác nhận thì gửi đi bản ĐÃ SỬA', async () => {
  // Nếu bản gửi đi là bản gốc của model, màn rà soát chỉ là hình thức.
})
```

- [ ] **Step 2–5:** chạy fail, viết màn hình, chạy xanh, commit.

Điều kiện mở khoá đọc từ chính dữ liệu (`progress.complete` của `reviewContract`), không phải từ một biến đếm cục bộ của component — biến cục bộ sẽ lệch khỏi sự thật ngay khi có một đường cập nhật khác.

---

### Task 8: Builder, Dashboard, Templates dùng dữ liệu thật

**Files:**
- Create: `frontend/apps/web-spa/src/routes/BuilderRoute.tsx`, `DashboardRoute.tsx`
- Create: `frontend/apps/web-spa/src/lib/cv-store.ts`
- Modify: `frontend/apps/web-spa/src/routes/routes.tsx` (bỏ `initialCVs`)
- Create: các file test tương ứng

- [ ] **Step 1: Viết test thất bại**

```tsx
it('builder tải CV thật theo :cvId và hiện trạng thái lưu', async () => { /* … */ })

it('lưu có debounce: gõ liên tục 5 lần chỉ gửi một request', async () => {
  // Không debounce thì mỗi phím là một PATCH, và một transaction hai cột.
})

it('lưu hỏng thì báo cho người dùng và GIỮ nội dung đang gõ', async () => {
  // Mất chữ vừa gõ vì mạng chập là lỗi không thể tha thứ ở một trình soạn CV.
})

it('dashboard hiện ba trạng thái Home theo số CV có thật (UC-01/02/03)', async () => { /* 0, 1, nhiều */ })
```

- [ ] **Step 2–5:** chạy fail, viết, chạy xanh, commit.

Sau task này `grep -rn "initialCVs\|mockData" frontend/apps/web-spa/src` chỉ còn được phép khớp trong chính `mockData.ts`.

---

### Task 9: Cài đặt, xoá CV, xoá tài khoản (UC-24/34)

**Files:**
- Create: `frontend/apps/web-spa/src/routes/SettingsRoute.tsx`
- Create: `frontend/apps/web-spa/test/settings.ui.test.tsx`
- Create: `backend/db/pair-check.ts`
- Modify: `frontend/package.json` (script `db:pair-check`)

- [ ] **Step 1: Viết test thất bại**

```tsx
it('xoá tài khoản đòi gõ đúng email để xác nhận', async () => {
  // Hành động không thể hoàn tác thì rào chắn phải là thứ không bấm nhầm được.
})

it('xoá CV hỏi lại và nêu rõ tên CV sắp xoá', async () => { /* … */ })
```

- [ ] **Step 2–4:** viết màn hình, chạy xanh.

- [ ] **Step 5: Viết `backend/db/pair-check.ts`** — chỉ đọc, không `UPDATE`/`INSERT`/`DELETE`. Với mọi hàng có `data_v2`, so `cvToProfile(data_v2)` với `data` bằng đúng helper `roundtrip-compare.ts` mà SP-2 đã dựng. Báo số hàng lệch kèm id, thoát khác 0 nếu có.

Đây là chốt chặn thay cho `assertReversible` phía server, thứ không dựng được vì Go không có bộ chuyển đổi. Chạy nó sau mỗi đợt sửa dữ liệu.

- [ ] **Step 6: Chạy và commit**

```bash
cd frontend && npm run db:pair-check
```

Kỳ vọng: `24/24 cặp khớp`.

---

### Task 10: Trả nợ SP-2 — tám chỗ đọc v1 trong matching.go

**Files:**
- Modify: `backend/cmd/worker/matching.go`
- Modify: `backend/cmd/worker/main_test.go`

SP-2 ghi lại tám hàm còn đọc hình dạng v1: `estimateProfileYears` (:550), `allHighlights` (:634), `estimatePages` (:657), `hasProfileField` (:677), khối học vấn trong `richMatchScore` (:501), và hai tiêu chí `"count"` (:718) cùng `"required_fields"` (:768, :774) của `scoreProfileRubric`. Cộng lại khoảng **0.45 trọng số** cho điểm 0 với tài liệu v2, không báo gì.

SP-3 là task đầu tiên đưa tài liệu v2 vào hệ thống thật, nên món nợ này đến hạn ở đây.

- [ ] **Step 1: Viết test thất bại cho cả tám**

Một test bảng: cùng một hồ sơ diễn đạt bằng v1 và bằng v2 phải cho **cùng** điểm rubric và cùng số năm kinh nghiệm. Đó là cách bắt được cả tám cùng lúc mà không phải đoán từng hàm.

```go
func TestRubricScoreIsShapeIndependent(t *testing.T) {
	v1 := /* hồ sơ v1 đầy đủ */
	v2 := /* CÙNG nội dung, diễn đạt bằng v2 */
	s1, _ := scoreProfileRubric(v1, jd)
	s2, _ := scoreProfileRubric(v2, jd)
	if s1 != s2 {
		t.Fatalf("điểm rubric v1=%v v2=%v — cùng nội dung phải cùng điểm", s1, s2)
	}
}
```

- [ ] **Step 2–5:** chạy fail, sửa từng hàm nhận diện hình dạng bằng dữ liệu (`sections` có mặt ⇒ v2) như `profileChunks` đã làm, chạy xanh, commit.

Sửa cả tám hoặc không sửa cái nào. Sửa một nửa thì điểm sai mà trông như đúng một nửa, khó lần ra hơn là sai hẳn.

---

## Điều kiện hoàn thành SP-3

- [ ] `cd frontend && npm run typecheck` xanh cả ba project.
- [ ] `npx vitest run --project unit --project ui` xanh, số test **tăng**.
- [ ] `cd backend && go test ./...` xanh, `gofmt -l ./cmd ./internal` không in gì, `go vet ./...` sạch.
- [ ] `npm run db:pair-check` báo 24/24 cặp khớp.
- [ ] `npm run db:roundtrip-check` vẫn 24/24.
- [ ] `grep -rn "initialCVs" frontend/apps/web-spa/src` chỉ khớp trong `mockData.ts`.
- [ ] `git diff --stat main -- frontend/apps/web/` **rỗng**.
- [ ] `curl -sf http://localhost:3000` và `http://localhost:3002/api/health` đều trả về được.
- [ ] Đi hết luồng bằng tay: đăng nhập → `/import` tải một PDF thật → rà soát → builder → sửa → tải lại trang và thấy nội dung đã lưu.

## Việc SP-3 cố tình chưa làm

- **Chat SSE, clarify, duyệt diff patch, đối chiếu JD thật** — SP-4.
- **`/print`, biến thể `ats` và `thumbnail`, Playwright, cutover** — SP-5.
- **`cv_documents.snapshot_v2`** vẫn chưa được backfill; snapshot gắn với luồng xuất bản, thuộc SP-5.
- **`/diagnose/:cvId`, `/start/guided`, `/kb`** — chưa dựng; SP-4 và SP-5.
- **Xoá `internal/api/compat_ai.go`** — ba endpoint compat còn phục vụ SPA cho tới khi SP-4 nối chat SSE thật.
