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
	"time"
)

// Cookie giữ `state` của một vòng redirect. Dùng cookie chứ không phải bảng
// DB: nó chỉ sống giữa `/start` và `/callback`, không cần bền vững, và không
// cần migration.
const googleStateCookie = "hr_oauth_state"

// stateCookieShape quyết định tên và phạm vi cookie state theo từng request.
//
// Trên HTTPS phải dùng tiền tố `__Host-`: nó là thứ DUY NHẤT ghim cookie vào
// đúng host đã đặt nó. Thiếu nó, nửa cookie của phép đối chiếu double-submit
// là thứ kẻ khác GHI ĐƯỢC — một subdomain anh em, hoặc kẻ trên đường truyền ở
// một origin plaintext cùng domain, đặt `hr_oauth_state` cho domain cha rồi
// đưa nạn nhân một URL callback mang state khớp; nạn nhân âm thầm đăng nhập
// vào tài khoản Google của chúng.
//
// Trình duyệt chỉ chấp nhận tiền tố này khi cookie có `Secure`, `Path=/` và
// KHÔNG có `Domain`. `Path=/` rộng hơn mong muốn, nhưng cookie chỉ sống 10
// phút và đổi lại là ràng buộc host thật sự.
//
// Trên http thuần (dev cục bộ) trình duyệt từ chối tiền tố, nên giữ tên trần
// và phạm vi hẹp như cũ.
func stateCookieShape(r *http.Request) (name, path string, secure bool) {
	if secureCookies(r) {
		return "__Host-" + googleStateCookie, "/", true
	}
	return googleStateCookie, "/api/auth/google", false
}

// googleHTTPClient: http.DefaultClient không có timeout riêng — đường huỷ
// duy nhất là r.Context(), chỉ kích hoạt khi TRÌNH DUYỆT ngắt kết nối. Một
// endpoint token/userinfo của Google bị treo sẽ ghim goroutine vô thời hạn,
// một đòn bẩy cạn tài nguyên rẻ tiền trên endpoint không cần đăng nhập.
var googleHTTPClient = &http.Client{Timeout: 10 * time.Second}

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
	if s.db == nil {
		// `googleCallback` cũng chặn, nhưng chặn ở đó là quá muộn: người dùng
		// đã đi hết màn hình đồng ý của Google và đã trao quyền, rồi mới nhận
		// 503 ở đường về.
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Auth endpoints require PostgreSQL"})
		return
	}
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	// APP_BASE_URL quyết định `redirect_uri`. Không đặt thì mặc định
	// `http://localhost:3000` âm thầm thắng và Google trả
	// `redirect_uri_mismatch` — hỏng ở đây, chỗ nhìn thấy được, chứ không
	// redirect sang Google rồi để người dùng nhận một trang lỗi của Google mà
	// không hiểu vì sao.
	if clientID == "" || os.Getenv("GOOGLE_CLIENT_SECRET") == "" || os.Getenv("APP_BASE_URL") == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Google sign-in is not configured"})
		return
	}
	state := newID() + newID()
	cookieName, cookiePath, cookieSecure := stateCookieShape(r)
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: state, Path: cookiePath,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 600, Secure: cookieSecure,
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
	// Đọc ĐÚNG cái tên `/start` đã đặt cho request cùng dạng: trên HTTPS mà
	// chấp nhận cả tên trần thì tiền tố `__Host-` chỉ còn là đồ trang trí, vì
	// tên trần là tên kẻ tấn công ghi được.
	cookieName, cookiePath, cookieSecure := stateCookieShape(r)
	cookie, err := r.Cookie(cookieName)
	if state == "" || err != nil || cookie.Value != state {
		redirectLogin(w, r, "google_state")
		return
	}
	// State dùng một lần. Cookie xoá phải mang lại đủ thuộc tính của tiền tố,
	// nếu không trình duyệt từ chối luôn cả lệnh xoá.
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: cookiePath,
		MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: cookieSecure,
	})

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
	tokenRes, err := googleHTTPClient.Do(tokenReq)
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
	infoRes, err := googleHTTPClient.Do(infoReq)
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
