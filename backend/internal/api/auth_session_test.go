package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// unsetenv gỡ HẲN một biến môi trường cho tới hết test. Khác với đặt chuỗi
// rỗng: tư thế mặc định của một cổng an toàn phải kiểm được bằng đúng cái
// trạng thái mà bản triển khai thật đang có — không ai đặt biến nào cả.
func unsetenv(t *testing.T, key string) {
	t.Helper()
	// t.Setenv đăng ký khôi phục giá trị gốc (hoặc gỡ hẳn nếu vốn không có)
	// khi test kết thúc; os.Unsetenv ngay sau đó không phá hỏng việc khôi phục.
	t.Setenv(key, "")
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
}

func magicLinkProbes() []struct{ method, path string } {
	return []struct{ method, path string }{
		{http.MethodPost, "/api/auth/request"},
		{http.MethodGet, "/api/auth/verify?token=x"},
	}
}

// Tư thế MẶC ĐỊNH — không một biến môi trường nào được đặt — phải là ĐÓNG.
//
// Mọi test khác đều tự đặt biến trước khi kiểm, nên chúng chỉ chứng minh cổng
// hoạt động KHI đã lên đạn, và không nói gì về chuyện nó có bao giờ được lên
// đạn trong bản triển khai thật hay không. Đúng khe hở đó đã để lọt một
// `/api/auth/request` mở toang: nó trả `devLink` chứa token thô, ai gọi cũng
// đăng nhập được vào bất kỳ tài khoản nào.
func TestMagicLinkIsClosedWithNoEnvironmentAtAll(t *testing.T) {
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()
	unsetenv(t, "MAGIC_LINK_DEV")
	unsetenv(t, "NODE_ENV")

	for _, probe := range magicLinkProbes() {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(probe.method, probe.path, nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s = %d, muốn 404 khi không có biến môi trường nào", probe.method, probe.path, w.Code)
		}
	}

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))
	var body struct {
		MagicLink *bool `json:"magicLink"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.MagicLink == nil {
		t.Fatal("thiếu trường magicLink")
	}
	if *body.MagicLink {
		t.Error("magicLink = true khi không có biến môi trường nào — SPA sẽ hiện form vô dụng")
	}
}

func TestMagicLinkIsDevOnly(t *testing.T) {
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()

	// Chỉ đúng chuỗi "true" mới mở. Gõ sai, viết hoa, hay một giá trị lạ đều
	// phải là ĐÓNG — cổng an toàn không được đoán ý người cấu hình.
	for _, value := range []string{"", "1", "yes", "True", "development", "production"} {
		t.Run("MAGIC_LINK_DEV="+value+" vẫn đóng", func(t *testing.T) {
			t.Setenv("MAGIC_LINK_DEV", value)
			for _, probe := range magicLinkProbes() {
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, httptest.NewRequest(probe.method, probe.path, nil))
				if w.Code != http.StatusNotFound {
					t.Errorf("%s %s = %d, muốn 404", probe.method, probe.path, w.Code)
				}
			}
		})
	}

	t.Run("MAGIC_LINK_DEV=true mở lại cho dev", func(t *testing.T) {
		t.Setenv("MAGIC_LINK_DEV", "true")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/verify?token=khong-ton-tai", nil))
		if w.Code == http.StatusNotFound {
			t.Fatalf("endpoint bị đóng dù đã bật MAGIC_LINK_DEV")
		}
	})
}

// TLS thường kết thúc ở reverse proxy (VPS sau nginx/Caddy), nên `r.TLS` là
// nil ở backend dù trình duyệt đang ở HTTPS. Cookie state/phiên phải vẫn được
// đánh dấu Secure trong trường hợp đó — thiếu nó, kẻ trên đường truyền ghi đè
// được cookie qua một request plaintext cùng host.
func TestSecureCookiesHonorsForwardedProtoAndAppBaseURL(t *testing.T) {
	for _, tc := range []struct {
		name           string
		forwardedProto string
		appBaseURL     string
		want           bool
	}{
		{"X-Forwarded-Proto https", "https", "http://localhost:3000", true},
		{"thuần http, APP_BASE_URL http", "", "http://localhost:3000", false},
		{"thuần http, APP_BASE_URL https", "", "https://example.com", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APP_BASE_URL", tc.appBaseURL)
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.forwardedProto != "" {
				r.Header.Set("X-Forwarded-Proto", tc.forwardedProto)
			}
			if got := secureCookies(r); got != tc.want {
				t.Errorf("secureCookies() = %v, muốn %v", got, tc.want)
			}
		})
	}
}

// SPA không đọc được biến môi trường của máy chủ nên nó phải được BÁO. Thiếu
// trường này thì trang đăng nhập hiện một form vô dụng ở production.
func TestAuthSessionReportsWhetherMagicLinkIsAvailable(t *testing.T) {
	db := cvRevisionDB(t)
	handler := NewServerWithDB(db, t.TempDir()).Routes()

	for _, tc := range []struct {
		magicLinkDev string
		want         bool
	}{{"", false}, {"true", true}} {
		t.Run("MAGIC_LINK_DEV="+tc.magicLinkDev, func(t *testing.T) {
			t.Setenv("MAGIC_LINK_DEV", tc.magicLinkDev)
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
