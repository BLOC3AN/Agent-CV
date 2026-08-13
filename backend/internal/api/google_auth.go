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
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 600, Secure: secureCookies(r),
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
