# Đăng nhập bằng Google — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng đăng nhập được bằng tài khoản Google — cách đăng nhập đầu tiên chạy được ở production, vì magic link không có mailer nên chưa bao giờ gửi được thư.

**Architecture:** Luồng Authorization Code chuẩn, viết bằng stdlib. `/api/auth/google/start` sinh `state`, cất vào cookie httpOnly, redirect sang Google. `/api/auth/google/callback` đối chiếu `state`, đổi `code` lấy access token, gọi `userinfo` lấy email, rồi cắm vào đúng khuôn `authVerify` đang dùng: upsert `users` theo email → tạo phiên → set cookie `hr_session` → redirect về app. Phần đuôi đó tách thành `startSession` để hai lối đăng nhập dùng chung.

**Tech Stack:** Go 1.22 (`net/http`, routing bằng pattern của `ServeMux`), PostgreSQL qua `database/sql` + pgx, React 19 + TypeScript, Vitest.

> **ĐÍNH CHÍNH SAU CODE REVIEW (2026-08-13).** Các đoạn mã bên dưới giữ nguyên làm hồ sơ
> thi công, nhưng bốn điểm đã bị thay thế — spec là nguồn đúng, không phải plan này:
>
> 1. `magicLinkEnabled()` là `os.Getenv("MAGIC_LINK_DEV") == "true"`, KHÔNG phải
>    `os.Getenv("NODE_ENV") != "production"`. Định nghĩa cũ hỏng-MỞ và trên thực tế chưa
>    từng được lên đạn: service `backend` nhận `NODE_ENV=development` từ `../.env`.
>    Mọi `t.Setenv("NODE_ENV", …)` trong plan này đổi thành `MAGIC_LINK_DEV`.
> 2. `/api/auth/google/start` từ chối bằng 503 khi `APP_BASE_URL` trống, và khi `s.db`
>    là nil.
> 3. Cookie `state` mang tên `__Host-hr_oauth_state` (kèm `Secure`, `Path=/`) khi
>    `secureCookies(r)`; tên trần chỉ dùng cho http thuần.
> 4. `LoginPage` ẩn `loginHint` cùng với form magic link.

## Global Constraints

- Spec nguồn: `backend/docs/superpowers/specs/2026-08-13-google-sign-in-design.md`. Mục "Ngoài phạm vi" của spec là ràng buộc, không phải gợi ý.
- **KHÔNG thêm dependency Go mới.** `go.mod` có đúng 5 dependency trực tiếp; luồng này viết bằng stdlib. Cụ thể: không `golang.org/x/oauth2`, không thư viện JWT.
- **Không giải mã `id_token`.** Email lấy qua `userinfo`. Trong luồng code, token đến thẳng từ Google qua TLS nên đã đáng tin; viết code xác minh JWT ở đây là thêm thứ phải bảo trì mà không mua thêm an toàn nào.
- **Từ chối khi `email_verified` là false.** Không có ngoại lệ.
- Lệnh Go chạy từ `backend/`. Lệnh frontend chạy từ `frontend/`.
- Test cần DOM ở frontend bắt buộc đuôi `*.ui.test.tsx`; test Go chạm DB dùng `cvRevisionDB(t)` và tự `t.Skipf` khi không có DB.
- **Thông báo lỗi luôn tiếng Anh** (cả Go lẫn frontend). Chữ trên nút là nội dung giao diện nên vẫn dịch qua `messages.vi` / `messages.en`.
- Không viết migration. Không thêm bảng nào.
- Không đụng `login_tokens` và mã magic link ngoài việc chặn ở production — dev và test vẫn cần một đường tạo phiên không phụ thuộc mạng ngoài.

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `backend/internal/api/server.go` | `startSession`, `appBaseURL`, `magicLinkEnabled`; chặn magic link ở production; `magicLink` trong `/api/auth/session` | 1 |
| `backend/internal/api/google_auth.go` (tạo) | Toàn bộ luồng Google: endpoint, `/start`, `/callback`, đổi code lấy email | 2 |
| `backend/internal/api/server.go` | Đăng ký hai route mới | 2 |
| `.env.example` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 2 |
| `frontend/apps/web-spa/src/lib/api.ts` | Trường `magicLink` trên `Session` | 3 |
| `frontend/apps/web-spa/src/lib/session.tsx` | Đưa `magicLink` ra context | 3 |
| `frontend/apps/web-spa/src/routes/LoginPage.tsx` | Nút Google; form magic link có điều kiện | 3 |
| `frontend/apps/web-spa/src/lib/i18n/messages.{vi,en}.ts` | Khoá `signInWithGoogle` | 3 |

Test:

| File | Task |
|---|---|
| `backend/internal/api/auth_session_test.go` (tạo) | 1 |
| `backend/internal/api/google_auth_test.go` (tạo) | 2 |
| `frontend/apps/web-spa/test/login-page.ui.test.tsx` (tạo) | 3 |

---

## Task 1: `startSession`, và magic link lui về chỉ-dev

Tách phần tạo phiên để Task 2 dùng lại, chặn magic link ở production, và cho SPA biết nó còn dùng được hay không.

**Files:**
- Modify: `backend/internal/api/server.go`
- Test: `backend/internal/api/auth_session_test.go` (tạo mới)

**Interfaces:**
- Consumes: không có.
- Produces (Task 2 dùng lại nguyên văn những tên này):
  - `func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) error`
  - `func appBaseURL() string` — trả `APP_BASE_URL` đã bỏ dấu `/` cuối, mặc định `http://localhost:3000`
  - `func magicLinkEnabled() bool`

- [ ] **Step 1: Viết test đỏ**

Tạo `backend/internal/api/auth_session_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMagicLinkIsDevOnly(t *testing.T) {
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()

	t.Run("production đóng cả hai endpoint", func(t *testing.T) {
		t.Setenv("NODE_ENV", "production")
		for _, probe := range []struct{ method, path string }{
			{http.MethodPost, "/api/auth/request"},
			{http.MethodGet, "/api/auth/verify?token=x"},
		} {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(probe.method, probe.path, nil))
			if w.Code != http.StatusNotFound {
				t.Errorf("%s %s = %d, muốn 404", probe.method, probe.path, w.Code)
			}
		}
	})

	t.Run("ngoài production vẫn mở", func(t *testing.T) {
		t.Setenv("NODE_ENV", "development")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/verify?token=khong-ton-tai", nil))
		if w.Code == http.StatusNotFound {
			t.Fatalf("endpoint bị đóng ngoài production")
		}
	})
}

// SPA không đọc được NODE_ENV của máy chủ nên nó phải được BÁO. Thiếu trường
// này thì trang đăng nhập hiện một form vô dụng ở production.
func TestAuthSessionReportsWhetherMagicLinkIsAvailable(t *testing.T) {
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()

	for _, tc := range []struct {
		nodeEnv string
		want    bool
	}{{"production", false}, {"development", true}} {
		t.Run(tc.nodeEnv, func(t *testing.T) {
			t.Setenv("NODE_ENV", tc.nodeEnv)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))

			var body struct {
				Authenticated bool  `json:"authenticated"`
				MagicLink     *bool `json:"magicLink"`
			}
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Authenticated {
				t.Fatal("request không có cookie mà lại báo đã đăng nhập")
			}
			if body.MagicLink == nil {
				t.Fatal("thiếu trường magicLink ở nhánh chưa đăng nhập")
			}
			if *body.MagicLink != tc.want {
				t.Errorf("magicLink = %v, muốn %v", *body.MagicLink, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend
go test ./internal/api/ -run 'TestMagicLinkIsDevOnly|TestAuthSessionReportsWhether' -v
```

Kỳ vọng: FAIL — endpoint vẫn trả khác 404 ở production, và `/api/auth/session` chưa có trường `magicLink`.

- [ ] **Step 3: Thêm ba hàm dùng chung**

Trong `backend/internal/api/server.go`, đặt ngay trên `func (s *Server) authRequest`:

```go
// appBaseURL là gốc của ứng dụng phía người dùng. Ba chỗ đang tự đọc biến môi
// trường này rồi tự cắt dấu `/` cuối; gom lại một chỗ để redirect và
// `redirect_uri` của OAuth không thể lệch nhau.
func appBaseURL() string {
	base := os.Getenv("APP_BASE_URL")
	if base == "" {
		base = "http://localhost:3000"
	}
	return strings.TrimRight(base, "/")
}

// magicLinkEnabled: magic link chỉ còn là đường đăng nhập của dev.
//
// Ở production nó vô dụng — repo không có mailer nào, `authRequest` luôn trả
// `"sent": false` — nhưng vẫn nhận request và vẫn ghi vào `login_tokens`. Hỏng
// im lặng như vậy tệ hơn hỏng ở chỗ nhìn thấy được.
func magicLinkEnabled() bool {
	return os.Getenv("NODE_ENV") != "production"
}

// startSession tạo phiên và gắn cookie. Dùng chung cho magic link và Google:
// chép đôi đoạn này nghĩa là lần sau sửa vòng đời phiên sẽ chỉ sửa một nửa.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) error {
	session := newID() + newID()
	if _, err := s.db.ExecContext(r.Context(), `
		INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
		VALUES ($1, $2, now() + interval '30 days', $3)`, tokenHash(session), userID, r.UserAgent()); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: "hr_session", Value: session, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600, Secure: r.TLS != nil})
	return nil
}
```

- [ ] **Step 4: Chặn magic link ở production**

Thêm vào đầu `authRequest`, ngay TRƯỚC kiểm tra `s.db == nil`:

```go
	if !magicLinkEnabled() {
		http.NotFound(w, r)
		return
	}
```

Thêm y hệt vào đầu `authVerify`, cũng ngay trước kiểm tra `s.db == nil`.

- [ ] **Step 5: Dùng `startSession` và `appBaseURL` trong `authVerify`**

Trong `authVerify`, thay đoạn từ `session := newID() + newID()` tới hết hàm bằng:

```go
	if err := s.startSession(w, r, userID); err != nil {
		http.Error(w, "Could not create the session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, appBaseURL(), http.StatusFound)
}
```

Trong `authRequest`, thay bốn dòng đọc `APP_BASE_URL` bằng một lời gọi `appBaseURL()`:

```go
	result := map[string]any{"ok": true, "sent": false}
	if os.Getenv("NODE_ENV") != "production" {
		result["devLink"] = appBaseURL() + "/api/auth/verify?token=" + url.QueryEscape(token)
	}
```

Trong `redirectLogin`, làm tương tự:

```go
func redirectLogin(w http.ResponseWriter, r *http.Request, reason string) {
	http.Redirect(w, r, appBaseURL()+"/login?error="+url.QueryEscape(reason), http.StatusFound)
}
```

- [ ] **Step 6: Báo `magicLink` trong `/api/auth/session`**

Thay thân `authSession` bằng:

```go
func (s *Server) authSession(w http.ResponseWriter, r *http.Request) {
	userID := s.currentUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "magicLink": magicLinkEnabled()})
		return
	}
	var email string
	if err := s.db.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "magicLink": magicLinkEnabled()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "email": email, "magicLink": magicLinkEnabled()})
}
```

- [ ] **Step 7: Chạy test, xác nhận xanh**

```bash
cd backend
go test ./internal/api/ -run 'TestMagicLinkIsDevOnly|TestAuthSessionReportsWhether' -v
```

Kỳ vọng: PASS.

- [ ] **Step 8: Chạy toàn bộ, build và vet**

```bash
cd backend
go build ./... && go vet ./... && go test ./...
```

Kỳ vọng: PASS toàn bộ. Test nào đỏ vì `/api/auth/session` giờ có thêm trường là kỳ vọng cũ đã lỗi thời — sửa kỳ vọng, đừng gỡ trường.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/api/server.go backend/internal/api/auth_session_test.go
git commit -m "refactor: tách startSession, magic link lui về chỉ-dev"
```

---

## Task 2: Luồng Google OAuth

**Files:**
- Create: `backend/internal/api/google_auth.go`
- Modify: `backend/internal/api/server.go` (chỉ thêm hai dòng đăng ký route)
- Modify: `.env.example`
- Test: `backend/internal/api/google_auth_test.go` (tạo mới)

**Interfaces:**
- Consumes từ Task 1: `s.startSession(w, r, userID) error`, `appBaseURL() string`.
- Produces: hai route `GET /api/auth/google/start` và `GET /api/auth/google/callback`. Không có API Go nào cho task sau dùng.

- [ ] **Step 1: Viết test đỏ**

Tạo `backend/internal/api/google_auth_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// fakeGoogle đóng vai cả ba endpoint của Google. Không có nó thì mọi test đều
// phải gọi mạng thật và sẽ đỏ trên máy không có Internet.
func fakeGoogle(t *testing.T, email string, verified bool) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("code") != "good-code" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"access_token": "at-1", "token_type": "Bearer"})
	})
	mux.HandleFunc("GET /oauth2/v3/userinfo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer at-1" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"email": email, "email_verified": verified})
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server.URL
}

func googleEnv(t *testing.T, base string) {
	t.Helper()
	t.Setenv("GOOGLE_CLIENT_ID", "client-1")
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret-1")
	t.Setenv("GOOGLE_OAUTH_BASE", base)
	t.Setenv("APP_BASE_URL", "http://localhost:3000")
}

func TestGoogleStartRedirectsWithStateCookie(t *testing.T) {
	googleEnv(t, fakeGoogle(t, "a@example.com", true))
	handler := NewServerWithDB(cvRevisionDB(t), t.TempDir()).Routes()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/google/start", nil))

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, muốn 302", w.Code)
	}
	target, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := target.Query().Get("state")
	if state == "" {
		t.Fatal("thiếu state trong URL redirect")
	}
	if got := target.Query().Get("redirect_uri"); got != "http://localhost:3000/api/auth/google/callback" {
		t.Errorf("redirect_uri = %q", got)
	}
	if got := target.Query().Get("scope"); got != "openid email" {
		t.Errorf("scope = %q", got)
	}
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "hr_oauth_state" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("không set cookie state")
	}
	if cookie.Value != state {
		t.Errorf("cookie state %q khác state trên URL %q", cookie.Value, state)
	}
	if !cookie.HttpOnly {
		t.Error("cookie state phải HttpOnly")
	}
}

func TestGoogleStartRefusesWhenNotConfigured(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	handler := NewServerWithDB(cvRevisionDB(t), t.TempDir()).Routes()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/google/start", nil))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, muốn 503 — hỏng ở chỗ nhìn thấy được chứ không phải giữa đường ở phía Google", w.Code)
	}
}

func callback(t *testing.T, handler http.Handler, query string, cookieState string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?"+query, nil)
	if cookieState != "" {
		r.AddCookie(&http.Cookie{Name: "hr_oauth_state", Value: cookieState})
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestGoogleCallbackRejectsBadState(t *testing.T) {
	googleEnv(t, fakeGoogle(t, "a@example.com", true))
	handler := NewServerWithDB(cvRevisionDB(t), t.TempDir()).Routes()

	for name, tc := range map[string]struct{ query, cookie string }{
		"state lệch":     {"code=good-code&state=s1", "s2"},
		"thiếu cookie":   {"code=good-code&state=s1", ""},
		"thiếu state":    {"code=good-code", "s1"},
	} {
		t.Run(name, func(t *testing.T) {
			w := callback(t, handler, tc.query, tc.cookie)
			if !strings.Contains(w.Header().Get("Location"), "error=google_state") {
				t.Fatalf("Location = %q, muốn lỗi google_state", w.Header().Get("Location"))
			}
			for _, c := range w.Result().Cookies() {
				if c.Name == "hr_session" && c.Value != "" {
					t.Fatal("tạo phiên dù state không hợp lệ")
				}
			}
		})
	}
}

func TestGoogleCallbackRejectsUnverifiedEmail(t *testing.T) {
	googleEnv(t, fakeGoogle(t, "unverified@example.com", false))
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()

	w := callback(t, handler, "code=good-code&state=s1", "s1")

	if !strings.Contains(w.Header().Get("Location"), "error=email_unverified") {
		t.Fatalf("Location = %q, muốn lỗi email_unverified", w.Header().Get("Location"))
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM users WHERE email = 'unverified@example.com'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("tạo tài khoản từ email chưa xác minh")
	}
}

func TestGoogleCallbackCreatesSessionAndReusesExistingUser(t *testing.T) {
	email := "google-" + newID() + "@example.com"
	googleEnv(t, fakeGoogle(t, email, true))
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE email = $1`, email) })

	w := callback(t, handler, "code=good-code&state=s1", "s1")

	if w.Code != http.StatusFound || w.Header().Get("Location") != "http://localhost:3000" {
		t.Fatalf("status=%d location=%q", w.Code, w.Header().Get("Location"))
	}
	var session *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "hr_session" {
			session = c
		}
	}
	if session == nil || session.Value == "" {
		t.Fatal("không set cookie hr_session")
	}
	if !session.HttpOnly || session.SameSite != http.SameSiteLaxMode || session.MaxAge != 30*24*3600 {
		t.Errorf("cookie phiên sai thuộc tính: %+v", session)
	}
	var userID string
	if err := db.QueryRow(`SELECT id FROM users WHERE email = $1`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	var sessions int
	if err := db.QueryRow(`SELECT count(*) FROM sessions WHERE user_id = $1`, userID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 1 {
		t.Fatalf("số phiên = %d, muốn 1", sessions)
	}

	// Đăng nhập lần hai bằng cùng email KHÔNG được tạo tài khoản thứ hai.
	callback(t, handler, "code=good-code&state=s2", "s2")
	var users int
	if err := db.QueryRow(`SELECT count(*) FROM users WHERE email = $1`, email).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("số tài khoản = %d, muốn 1 — email phải gộp về một tài khoản", users)
	}
}

func TestGoogleCallbackRejectsDeniedConsent(t *testing.T) {
	googleEnv(t, fakeGoogle(t, "a@example.com", true))
	handler := NewServerWithDB(cvRevisionDB(t), t.TempDir()).Routes()

	w := callback(t, handler, "error=access_denied&state=s1", "s1")

	if !strings.Contains(w.Header().Get("Location"), "error=google_denied") {
		t.Fatalf("Location = %q, muốn lỗi google_denied", w.Header().Get("Location"))
	}
}

func TestGoogleCallbackRejectsBadCode(t *testing.T) {
	googleEnv(t, fakeGoogle(t, "a@example.com", true))
	handler := NewServerWithDB(cvRevisionDB(t), t.TempDir()).Routes()

	w := callback(t, handler, "code=wrong-code&state=s1", "s1")

	if !strings.Contains(w.Header().Get("Location"), "error=google_failed") {
		t.Fatalf("Location = %q, muốn lỗi google_failed", w.Header().Get("Location"))
	}
}

// Giữ chữ ký JSON của fakeGoogle trung thực với Google thật.
func TestFakeGoogleUserinfoShapeMatchesGoogle(t *testing.T) {
	base := fakeGoogle(t, "a@example.com", true)
	req, _ := http.NewRequest(http.MethodGet, base+"/oauth2/v3/userinfo", nil)
	req.Header.Set("Authorization", "Bearer at-1")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info map[string]any
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if _, ok := info["email_verified"].(bool); !ok {
		t.Fatal("email_verified phải là bool như Google trả")
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd backend
go test ./internal/api/ -run TestGoogle -v
```

Kỳ vọng: FAIL — route `/api/auth/google/start` chưa tồn tại nên trả 404 thay vì 302.

- [ ] **Step 3: Viết `backend/internal/api/google_auth.go`**

```go
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Cookie giữ `state` của một vòng redirect. Dùng cookie chứ không phải bảng
// DB: nó chỉ sống giữa `/start` và `/callback`, không cần bền vững, và không
// cần migration.
const googleStateCookie = "hr_oauth_state"

// googleEndpoints trả ba URL của Google. `GOOGLE_OAUTH_BASE` CHỈ để test tiêm
// được — không có nó thì mọi test đều phải gọi mạng thật.
func googleEndpoints() (authURL, tokenURL, userinfoURL string) {
	if base := strings.TrimRight(os.Getenv("GOOGLE_OAUTH_BASE"), "/"); base != "" {
		return base + "/o/oauth2/v2/auth", base + "/token", base + "/oauth2/v3/userinfo"
	}
	return "https://accounts.google.com/o/oauth2/v2/auth",
		"https://oauth2.googleapis.com/token",
		"https://www.googleapis.com/oauth2/v3/userinfo"
}

func googleRedirectURI() string {
	return appBaseURL() + "/api/auth/google/callback"
}

func (s *Server) googleStart(w http.ResponseWriter, r *http.Request) {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	if clientID == "" || os.Getenv("GOOGLE_CLIENT_SECRET") == "" {
		// Hỏng ở đây, chỗ nhìn thấy được — chứ không redirect sang Google rồi
		// để người dùng nhận một trang lỗi của Google mà không hiểu vì sao.
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Google sign-in is not configured"})
		return
	}
	state := newID() + newID()
	http.SetCookie(w, &http.Cookie{
		Name: googleStateCookie, Value: state, Path: "/api/auth/google",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 600, Secure: r.TLS != nil,
	})
	authURL, _, _ := googleEndpoints()
	query := url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {googleRedirectURI()},
		"response_type": {"code"},
		"scope":         {"openid email"},
		"state":         {state},
	}
	http.Redirect(w, r, authURL+"?"+query.Encode(), http.StatusFound)
}

func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "Auth endpoints require PostgreSQL", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Query().Get("error") != "" {
		redirectLogin(w, r, "google_denied")
		return
	}
	// Đối chiếu state là chốt chặn CSRF: thiếu nó, kẻ khác ép được nạn nhân
	// đăng nhập vào tài khoản của chúng.
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie(googleStateCookie)
	if state == "" || err != nil || cookie.Value != state {
		redirectLogin(w, r, "google_state")
		return
	}
	// State dùng một lần.
	http.SetCookie(w, &http.Cookie{Name: googleStateCookie, Value: "", Path: "/api/auth/google", MaxAge: -1, HttpOnly: true})

	email, verified, err := googleEmailForCode(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		redirectLogin(w, r, "google_failed")
		return
	}
	if !verified {
		// Email chưa xác minh là đường chiếm tài khoản: ai đăng ký được một
		// địa chỉ chưa chứng minh sở hữu sẽ vào được tài khoản của người khác.
		redirectLogin(w, r, "email_unverified")
		return
	}

	var userID string
	if err := s.db.QueryRowContext(r.Context(), `
		INSERT INTO users (email) VALUES ($1)
		ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		RETURNING id`, email).Scan(&userID); err != nil {
		http.Error(w, "Could not create the account", http.StatusInternalServerError)
		return
	}
	if err := s.startSession(w, r, userID); err != nil {
		http.Error(w, "Could not create the session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, appBaseURL(), http.StatusFound)
}

// googleEmailForCode đổi authorization code lấy email đã xác minh.
//
// Lấy email qua `userinfo` thay vì giải mã `id_token`: trong luồng code, token
// đến thẳng từ Google qua TLS ở bước đổi code, nên nó đã đáng tin. Xác minh
// chữ ký JWT chỉ cần khi token đi vòng qua trình duyệt — viết code đó ở đây là
// thêm thứ phải bảo trì mà không mua thêm an toàn nào.
func googleEmailForCode(ctx context.Context, code string) (string, bool, error) {
	if code == "" {
		return "", false, fmt.Errorf("missing authorization code")
	}
	_, tokenURL, userinfoURL := googleEndpoints()

	form := url.Values{
		"code":          {code},
		"client_id":     {os.Getenv("GOOGLE_CLIENT_ID")},
		"client_secret": {os.Getenv("GOOGLE_CLIENT_SECRET")},
		"redirect_uri":  {googleRedirectURI()},
		"grant_type":    {"authorization_code"},
	}
	tokenReq, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", false, err
	}
	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenRes, err := http.DefaultClient.Do(tokenReq)
	if err != nil {
		return "", false, err
	}
	defer tokenRes.Body.Close()
	if tokenRes.StatusCode >= 300 {
		return "", false, fmt.Errorf("google token endpoint: %s", tokenRes.Status)
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if json.NewDecoder(io.LimitReader(tokenRes.Body, 64<<10)).Decode(&token) != nil || token.AccessToken == "" {
		return "", false, fmt.Errorf("google token response is invalid")
	}

	infoReq, err := http.NewRequestWithContext(ctx, http.MethodGet, userinfoURL, nil)
	if err != nil {
		return "", false, err
	}
	infoReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	infoRes, err := http.DefaultClient.Do(infoReq)
	if err != nil {
		return "", false, err
	}
	defer infoRes.Body.Close()
	if infoRes.StatusCode >= 300 {
		return "", false, fmt.Errorf("google userinfo endpoint: %s", infoRes.Status)
	}
	var info struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if json.NewDecoder(io.LimitReader(infoRes.Body, 64<<10)).Decode(&info) != nil || info.Email == "" {
		return "", false, fmt.Errorf("google userinfo response is invalid")
	}
	return strings.ToLower(strings.TrimSpace(info.Email)), info.EmailVerified, nil
}
```

- [ ] **Step 4: Đăng ký hai route**

Trong `backend/internal/api/server.go`, ngay dưới dòng `mux.HandleFunc("GET /api/auth/session", s.authSession)`:

```go
	mux.HandleFunc("GET /api/auth/google/start", s.googleStart)
	mux.HandleFunc("GET /api/auth/google/callback", s.googleCallback)
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

```bash
cd backend
go test ./internal/api/ -run TestGoogle -v
```

Kỳ vọng: PASS toàn bộ 7 bài.

- [ ] **Step 6: Thêm biến môi trường vào `.env.example`**

Thêm vào cuối `.env.example`:

```
# Đăng nhập Google (OAuth 2.0 Authorization Code).
# redirect_uri phải đăng ký trong Google Cloud Console ĐÚNG Y HỆT:
#   ${APP_BASE_URL}/api/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 7: Build, vet, chạy toàn bộ**

```bash
cd backend
go build ./... && go vet ./... && go test ./...
```

Kỳ vọng: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/api/google_auth.go backend/internal/api/google_auth_test.go backend/internal/api/server.go .env.example
git commit -m "feat: đăng nhập bằng Google qua Authorization Code"
```

---

## Task 3: Trang đăng nhập

**Files:**
- Modify: `frontend/apps/web-spa/src/lib/api.ts`
- Modify: `frontend/apps/web-spa/src/lib/session.tsx`
- Modify: `frontend/apps/web-spa/src/routes/LoginPage.tsx`
- Modify: `frontend/apps/web-spa/src/lib/i18n/messages.vi.ts`, `messages.en.ts`
- Test: `frontend/apps/web-spa/test/login-page.ui.test.tsx` (tạo mới)

**Interfaces:**
- Consumes từ Task 1: `GET /api/auth/session` trả thêm `magicLink: boolean`.
- Consumes từ Task 2: `GET /api/auth/google/start`.
- Produces: `Session.magicLink?: boolean`; `useSession()` trả thêm `magicLink: boolean` (mặc định `false` khi chưa nạp xong).

- [ ] **Step 1: Viết test đỏ**

Tạo `frontend/apps/web-spa/test/login-page.ui.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../src/routes/LoginPage'
import { SessionProvider } from '../src/lib/session'

const { getSession, logout, requestLogin } = vi.hoisted(() => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  requestLogin: vi.fn(),
}))

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  getSession,
  logout,
  requestLogin,
}))

afterEach(() => vi.clearAllMocks())

function renderLogin() {
  return render(
    <MemoryRouter>
      <SessionProvider><LoginPage /></SessionProvider>
    </MemoryRouter>,
  )
}

describe('trang đăng nhập', () => {
  it('luôn có nút Google trỏ thẳng vào luồng OAuth của máy chủ', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: false })
    renderLogin()

    const link = await screen.findByRole('link', { name: /google/i })
    expect(link).toHaveAttribute('href', '/api/auth/google/start')
  })

  /*
   * Ở production magic link không gửi được thư — repo không có mailer. Hiện một
   * form không bao giờ dẫn tới đâu là mời người dùng vào ngõ cụt.
   */
  it('ẩn form magic link khi máy chủ báo không dùng được', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: false })
    renderLogin()

    await screen.findByRole('link', { name: /google/i })
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('hiện form magic link khi máy chủ báo dùng được', async () => {
    getSession.mockResolvedValue({ authenticated: false, magicLink: true })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy())
    expect(screen.getByRole('link', { name: /google/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/login-page.ui.test.tsx
```

Kỳ vọng: FAIL — chưa có nút Google, và form Email luôn hiện.

- [ ] **Step 3: Thêm `magicLink` vào kiểu `Session`**

Trong `frontend/apps/web-spa/src/lib/api.ts`, sửa interface `Session`:

```ts
export interface Session {
  authenticated: boolean
  email?: string
  /**
   * Magic link chỉ còn dùng được ngoài production — máy chủ là nơi duy nhất
   * biết điều đó, nên nó phải báo xuống. Vắng mặt (máy chủ cũ) coi như tắt:
   * thà giấu một form còn dùng được hơn là mời người dùng vào một form hỏng.
   */
  magicLink?: boolean
}
```

- [ ] **Step 4: Đưa `magicLink` ra context**

Trong `frontend/apps/web-spa/src/lib/session.tsx`:

Thêm `magicLink: boolean` vào interface `SessionValue` (ngay dưới `status: Status;`), và `magicLink: false` vào object mặc định của `createContext`.

Thêm state và cập nhật nó:

```tsx
  const [magicLink, setMagicLink] = useState(false);
```

Trong `getSession().then((s) => {...})`, ngay sau `setEmail(s.email);`:

```tsx
      setMagicLink(s.magicLink === true);
```

Và trong provider:

```tsx
    <SessionContext.Provider value={{ status, email, magicLink, signOut }}>{children}</SessionContext.Provider>
```

- [ ] **Step 5: Thêm khoá i18n**

`frontend/apps/web-spa/src/lib/i18n/messages.vi.ts`, ngay dưới dòng `signIn:`:

```ts
  signInWithGoogle: 'Đăng nhập bằng Google',
```

`frontend/apps/web-spa/src/lib/i18n/messages.en.ts`, ngay dưới dòng `signIn:`:

```ts
  signInWithGoogle: 'Sign in with Google',
```

- [ ] **Step 6: Dựng nút Google và bọc form**

Trong `frontend/apps/web-spa/src/routes/LoginPage.tsx`:

Lấy `magicLink` ra khỏi hook — sửa dòng `const { status } = useSession();` thành:

```tsx
  const { status, magicLink } = useSession();
```

Chèn nút Google ngay TRƯỚC `<form onSubmit={submit} ...>`:

```tsx
        {/*
          Thẻ <a> thật chứ không phải fetch: luồng OAuth là một chuỗi redirect
          của trình duyệt, và cookie `state` phải được đặt trên chính điều
          hướng đó.
        */}
        <a
          href="/api/auth/google/start"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {t('signInWithGoogle')}
        </a>
```

Bọc `<form>` trong điều kiện: đổi dòng mở `<form onSubmit={submit} className="space-y-3">` thành

```tsx
        {magicLink && (
        <form onSubmit={submit} className="space-y-3">
```

và dòng đóng `</form>` (ngay trên dòng `{error && ...}`) thành

```tsx
        </form>
        )}
```

Khối `{sent && !error && (...)}` phía dưới — chứa `loginLinkSent` và `devLink` — chỉ hiện sau khi form được gửi, mà form đã bị ẩn, nên `sent` không bao giờ thành `true` ở production. Để nguyên, không cần bọc thêm.

Khối `{error && ...}` cũng để nguyên: `submit` không phải nguồn lỗi duy nhất trên trang này.

- [ ] **Step 7: Chạy test, xác nhận xanh**

```bash
cd frontend
npx vitest run --project ui apps/web-spa/test/login-page.ui.test.tsx
```

Kỳ vọng: PASS cả 3 bài.

- [ ] **Step 8: Chạy toàn bộ, typecheck, lint**

```bash
cd frontend
npm run test && npm run typecheck && npx eslint apps/web-spa/src/routes/LoginPage.tsx apps/web-spa/src/lib/session.tsx
```

Kỳ vọng: PASS. Test cũ nào giả lập `getSession` mà thiếu `magicLink` sẽ coi như `false` — nếu bài đó cần form Email thì thêm `magicLink: true` vào mock.

- [ ] **Step 9: Commit**

```bash
git add frontend/apps/web-spa/src/lib/api.ts frontend/apps/web-spa/src/lib/session.tsx \
  frontend/apps/web-spa/src/routes/LoginPage.tsx \
  frontend/apps/web-spa/src/lib/i18n/messages.vi.ts frontend/apps/web-spa/src/lib/i18n/messages.en.ts \
  frontend/apps/web-spa/test/login-page.ui.test.tsx
git commit -m "feat: nút đăng nhập Google, form magic link chỉ hiện khi dùng được"
```

---

## Kiểm chứng cuối

```bash
cd backend && go build ./... && go vet ./... && go test ./...
cd ../frontend && npm run test && npm run typecheck && npm run lint
```

Kiểm bằng tay trên máy thật, sau khi tạo OAuth client trong Google Cloud Console và điền `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` vào `.env`:

1. Mở `/login` → thấy nút Google; ở production không thấy form Email.
2. Bấm nút → sang màn hình chọn tài khoản của Google.
3. Chọn tài khoản → quay về gốc ứng dụng, đã đăng nhập, `hr_session` có trong cookie.
4. Đăng xuất rồi đăng nhập lại bằng cùng tài khoản → vào đúng dữ liệu cũ, `users` không sinh hàng thứ hai.
5. Bấm Từ chối ở màn hình Google → về `/login?error=google_denied`.
