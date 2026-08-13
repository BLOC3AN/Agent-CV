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
