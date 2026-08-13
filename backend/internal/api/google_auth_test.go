package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
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
		"state lệch":   {"code=good-code&state=s1", "s2"},
		"thiếu cookie": {"code=good-code&state=s1", ""},
		"thiếu state":  {"code=good-code", "s1"},
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

// http.DefaultClient không có timeout riêng — đường huỷ duy nhất là
// r.Context(), chỉ kích hoạt khi trình duyệt ngắt kết nối. Một endpoint Google
// bị treo sẽ ghim goroutine vô thời hạn, một đòn bẩy cạn tài nguyên rẻ tiền
// trên endpoint không cần đăng nhập.
func TestGoogleHTTPClientHasTimeout(t *testing.T) {
	if googleHTTPClient.Timeout != 10*time.Second {
		t.Fatalf("googleHTTPClient.Timeout = %v, muốn 10s", googleHTTPClient.Timeout)
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
