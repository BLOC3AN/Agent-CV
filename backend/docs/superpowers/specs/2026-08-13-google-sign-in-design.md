# Đăng nhập bằng Google

Ngày: 2026-08-13

## Bối cảnh

**Hôm nay production không đăng nhập được.** `authRequest` (`internal/api/server.go`) sinh
token, ghi vào `login_tokens`, rồi trả `{"ok": true, "sent": false}`. Trường `devLink` —
đường duy nhất để lấy được token — chỉ xuất hiện khi `NODE_ENV != production`. Quét toàn
repo không có mailer nào (SMTP, SendGrid, Resend, Mailgun, SES đều không). Nghĩa là trên
một máy chủ thật, người dùng bấm "gửi link" và không bao giờ nhận được gì.

Vì vậy Google sign-in không phải một tiện ích thêm vào: nó là **cách đăng nhập đầu tiên
chạy được ở production**, và nó bỏ qua luôn nhu cầu chọn, trả tiền và cấu hình một dịch
vụ email (SPF/DKIM, danh tiếng tên miền, thư vào spam).

Phần hạ tầng còn lại đã sẵn sàng:

- `users.email` là `citext UNIQUE` — định danh theo email đã là hợp đồng của hệ thống.
- `sessions` lưu **băm** của token chứ không phải JWT, nên đăng xuất có hiệu lực ngay
  (lý do ghi trong `006_sessions.sql`).
- `authVerify` đã có sẵn khuôn "xác thực xong → upsert user theo email → tạo session →
  set cookie `hr_session` → redirect về app". Google chỉ cần cắm vào đúng khuôn đó.

## Quyết định: Authorization Code redirect, không dùng thư viện

Hai hướng đã cân nhắc:

| | Authorization Code (chọn) | Google Identity Services |
|---|---|---|
| Frontend | một thẻ `<a>` | nạp script của Google, xử lý callback JS |
| Backend | đổi code lấy token qua `net/http` | tự xác minh chữ ký JWT qua JWKS |
| Rủi ro | phải giữ client secret | thêm script bên thứ ba trong trang, chạm CSP |
| Hợp với repo | trùng khít `authVerify` sẵn có | phải dựng thêm một lối đăng nhập khác hình |

Chọn Authorization Code. Trải nghiệm kém hơn không đáng kể, còn lượng thứ phải hiểu và
bảo trì thì ít hơn hẳn.

**Không thêm `golang.org/x/oauth2`.** `go.mod` hiện có đúng 5 dependency trực tiếp, không
framework, routing bằng `net/http` của Go 1.22. Luồng này viết bằng stdlib khoảng 50 dòng;
kéo một thư viện vào để tiết kiệm chừng đó là đổi sai chiều.

## Luồng

### `GET /api/auth/google/start`

1. Sinh `state` ngẫu nhiên (cùng cách sinh token như `newID()`).
2. Đặt `state` vào cookie httpOnly, `SameSite=Lax`, sống 10 phút.
3. Redirect tới `accounts.google.com/o/oauth2/v2/auth` với `client_id`, `redirect_uri`,
   `response_type=code`, `scope=openid email`, và `state`.

Dùng cookie thay vì một bảng DB cho `state`: nó chỉ sống trong một vòng redirect, không
cần bền vững, và không cần migration.

Cookie phải được **ghim vào host**. Trên HTTPS tên của nó là `__Host-hr_oauth_state`; trên
http thuần (dev cục bộ) trình duyệt từ chối tiền tố nên giữ tên trần `hr_oauth_state`.
Không có tiền tố, nửa cookie của phép đối chiếu double-submit là thứ kẻ khác GHI ĐƯỢC: một
subdomain anh em, hoặc kẻ trên đường truyền ở một origin plaintext cùng domain, đặt được
cookie cho domain cha rồi đưa nạn nhân một URL callback mang `state` khớp — nạn nhân âm
thầm đăng nhập vào tài khoản Google của chúng. Trình duyệt chỉ chấp nhận tiền tố khi cookie
có `Secure`, `Path=/` và không có `Domain`; `Path=/` rộng hơn mong muốn nhưng cookie chỉ
sống 10 phút. Callback đọc đúng cái tên mà `/start` đặt cho request cùng dạng — chấp nhận
cả tên trần trên HTTPS làm tiền tố thành đồ trang trí.

### `GET /api/auth/google/callback`

1. **Đối chiếu `state` với cookie.** Lệch hoặc thiếu → từ chối. Đây là chốt chặn CSRF; bỏ
   nó là cho phép kẻ khác ép nạn nhân đăng nhập vào tài khoản của chúng.
2. Đổi `code` lấy access token: `POST https://oauth2.googleapis.com/token`.
3. Lấy email: `GET https://www.googleapis.com/oauth2/v3/userinfo` với access token.
4. **Từ chối nếu `email_verified` là false.** Google có trả trường này; bỏ qua nó là mở
   đường chiếm tài khoản qua một email chưa được chứng minh sở hữu.
5. Upsert `users` theo email — đúng câu SQL `authVerify` đang dùng.
6. `startSession(w, r, userID)` → redirect về `APP_BASE_URL`.

Lấy email qua `userinfo` thay vì tự giải mã `id_token` để **không phải viết một dòng JWT
nào**. Trong luồng code, token đến thẳng từ Google qua TLS ở bước 2, nên nó đã đáng tin —
việc xác minh chữ ký chỉ cần thiết khi token đi vòng qua trình duyệt.

### Lỗi

Mọi thất bại đi qua `redirectLogin(w, r, reason)` sẵn có, với các lý do mới:
`google_state`, `google_denied`, `google_failed`, `email_unverified`. Người dùng quay lại
trang đăng nhập kèm lý do đọc được, thay vì một trang lỗi trắng.

Thiếu `GOOGLE_CLIENT_ID` hoặc `GOOGLE_CLIENT_SECRET` thì `/start` trả lỗi cấu hình rõ
ràng **trước khi** redirect — hỏng ở chỗ nhìn thấy được, không phải giữa đường ở phía
Google.

## Gộp tài khoản theo email

Người dùng từng vào bằng magic link rồi sau đó đăng nhập Google **cùng email** sẽ về đúng
tài khoản cũ, vì `users.email` là `UNIQUE` và cả hai đường đều upsert theo email.

An toàn: cả hai đường đều đã chứng minh quyền sở hữu email đó — magic link qua việc mở
được hộp thư, Google qua `email_verified`. Không có đường nào nhận email chưa xác minh.

## Một chỗ dọn có chủ đích

Phần đuôi của `authVerify` — tạo hàng trong `sessions`, set cookie `hr_session`, redirect
về `APP_BASE_URL` — tách thành `startSession(w, r, userID) error`, dùng chung cho cả hai
đường.

Không tách thì đoạn đó bị chép đôi, và lần sau ai sửa vòng đời cookie hay thời hạn phiên
sẽ chỉ sửa một nửa. Đây là loại trùng lặp im lặng gây lệch hành vi giữa hai lối đăng nhập.

## Magic link lui về chỉ-dev

`/api/auth/request` và `/api/auth/verify` trả 404 TRỪ KHI `MAGIC_LINK_DEV=true`.

Hôm nay chúng đã vô dụng ở production nhưng vẫn nhận request và vẫn ghi vào `login_tokens`
— hỏng một cách im lặng. Đóng hẳn thì nó hỏng ở chỗ nhìn thấy được. Bảng `login_tokens`
và toàn bộ mã giữ nguyên: dev và test vẫn cần một đường tạo phiên không phụ thuộc mạng
ngoài.

**Cổng phải hỏng-ĐÓNG, bằng biến của chính nó.** Bản thiết kế đầu tiên nói `NODE_ENV=
production` → 404, tức là suy ra "bật" từ việc *thiếu* một giá trị. Đó là hỏng-MỞ, và nó
đã thành lỗ thật: service `backend` trong `docker-compose.yml` không đặt `NODE_ENV=
production` bao giờ (nó nhận `NODE_ENV=development` từ `../.env`), nên cổng chưa từng
được lên đạn. Với `/api/auth/request` mở toang và `devLink` chứa token thô, bất kỳ ai gọi
được backend cũng đăng nhập được vào bất kỳ tài khoản nào.

Cổng đọc `MAGIC_LINK_DEV` và chỉ mở khi giá trị đúng bằng chuỗi `"true"`. Không đặt, gõ
sai, hay một môi trường lạ đều là ĐÓNG.

## Frontend

`LoginPage` thêm nút "Sign in with Google" — chỉ là `<a href="/api/auth/google/start">`,
không giữ state gì.

Form magic link — VÀ lời dẫn "nhập email, chúng tôi gửi đường dẫn" đi kèm nó — ẩn khi
không phải môi trường dev. Giữ lại lời dẫn mà ẩn form là bảo người dùng gõ vào một ô
không tồn tại. SPA không đọc được biến môi trường của máy
chủ, nên nó phải được **báo cho biết**: `GET /api/auth/session` — endpoint đã có, SPA đã
gọi sẵn khi khởi động — trả thêm một trường `magicLink: bool` ở cả hai nhánh
`authenticated` true và false. Máy chủ là nơi duy nhất biết sự thật này, và thêm một
trường vào một lượt gọi đã có thì rẻ hơn dựng route cấu hình mới.

Không suy ra bằng cách gọi thử `/api/auth/request` rồi xem có 404 không: như vậy là dùng
lỗi làm tín hiệu điều khiển, và nó ghi một hàng vào `login_tokens` mỗi lần mở trang đăng
nhập ở môi trường dev.

Chữ trên nút là nội dung giao diện nên vẫn dịch được (`messages.vi` / `messages.en`); mọi
thông báo lỗi vẫn tiếng Anh theo `messages.errors.ts`.

## Cấu hình

| Biến | Vai trò |
|---|---|
| `GOOGLE_CLIENT_ID` | định danh OAuth client |
| `GOOGLE_CLIENT_SECRET` | bí mật, chỉ nằm phía máy chủ |
| `GOOGLE_OAUTH_BASE` | gốc endpoint của Google; **chỉ để test tiêm được**, mặc định là endpoint thật |
| `APP_BASE_URL` | quyết định `redirect_uri`, đích redirect sau đăng nhập, và cờ Secure của cookie. **BẮT BUỘC** |
| `MAGIC_LINK_DEV` | mở magic link cho dev; chỉ `"true"` mới mở. **Không đặt ở production** |

`redirect_uri` là `${APP_BASE_URL}/api/auth/google/callback` và phải được đăng ký y hệt
trong Google Cloud Console — sai một ký tự là Google từ chối.

**Sửa lỗi của bản thiết kế đầu:** bảng này từng ghi `APP_BASE_URL` là "đã có". Sai — nó
chỉ tồn tại trong mã Go và test, không có trong `.env`, `.env.example`, hay khối
`environment:` nào. `appBaseURL()` vì vậy rơi về mặc định `http://localhost:3000` trên máy
chủ thật: `redirect_uri` gửi sang Google là URL localhost (Google đáp
`redirect_uri_mismatch`), `secureCookies()` mất đường dự phòng `https://`, và redirect sau
đăng nhập ném người dùng production về localhost. Do đó `/api/auth/google/start` phải **từ
chối bằng 503 khi `APP_BASE_URL` trống**, y như khi thiếu client ID — hỏng ở chỗ nhìn thấy
được, đúng nguyên tắc phần trên.

Thêm vào `.env.example`: `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` (rỗng),
`APP_BASE_URL`, `MAGIC_LINK_DEV=true`, và `GOOGLE_OAUTH_BASE` **để trống** kèm ghi chú
rằng nó chỉ dành cho test và tuyệt đối không đặt ở production — đặt nó là chuyển bước đổi
code, kèm `GOOGLE_CLIENT_SECRET`, sang một host của bên thứ ba.

Những biến này tới được container `backend` qua `env_file: ../.env`, **không** qua khối
`environment:`: `environment:` thắng `env_file`, mà phép thế `${VAR}` của compose chỉ đọc
shell và `.env` nằm cạnh file compose (`backend/.env`, không tồn tại) chứ không đọc
`../.env` — viết chúng vào `environment:` sẽ ghi đè giá trị thật bằng giá trị mặc định.

## Kiểm chứng

Endpoint của Google phải **tiêm được** qua `GOOGLE_OAUTH_BASE`; nếu không thì mọi test đều
phải gọi mạng thật và sẽ đỏ trên máy không có Internet.

Test viết trước theo TDD:

- `state` lệch → 403, không tạo phiên, không tạo user.
- Thiếu cookie `state` → 403.
- `email_verified: false` → từ chối, không tạo user.
- Callback thành công → có hàng trong `sessions`, cookie `hr_session` được set
  (`HttpOnly`, `SameSite=Lax`, `MaxAge` 30 ngày), redirect về `APP_BASE_URL`.
- Email đã tồn tại → dùng lại đúng `user.id`, `users` không sinh hàng thứ hai.
- Thiếu `GOOGLE_CLIENT_ID` → `/start` trả lỗi cấu hình, không redirect.
- Thiếu `APP_BASE_URL` → `/start` trả 503, không redirect.
- Không có DB → `/start` trả 503, không đẩy người dùng qua màn hình đồng ý của Google.
- Cookie `state`: `MaxAge=600`, `SameSite=Lax`, `HttpOnly`; trên HTTPS mang tên
  `__Host-hr_oauth_state` với `Secure`, `Path=/`, không `Domain`.
- Trên HTTPS, cookie `hr_oauth_state` tên trần khớp `state` → vẫn từ chối, không tạo phiên.
- **Tư thế mặc định — KHÔNG đặt biến môi trường nào:** `/api/auth/request` và
  `/api/auth/verify` trả 404, `/api/auth/session` báo `magicLink: false`. Test nào cũng tự
  đặt biến thì không test nào nói được cổng có bao giờ được lên đạn hay không.
- `MAGIC_LINK_DEV` với giá trị lạ (`"1"`, `"yes"`, `"True"`, `"development"`) → vẫn 404.
- `MAGIC_LINK_DEV=true` → hai endpoint mở lại, `magicLink: true`.
- `LoginPage` ẩn form magic link **và lời dẫn của nó** khi `magicLink: false`, luôn hiện
  nút Google.
- `startSession` sau khi tách: magic link vẫn tạo phiên và set cookie y như trước.

## Ngoài phạm vi

- Nhà cung cấp OAuth khác (GitHub, LinkedIn). Cấu trúc route để thêm được, nhưng không làm.
- Gắn nhiều nhà cung cấp vào một tài khoản. Email là định danh duy nhất; chưa cần bảng
  `identities`.
- Refresh token và gọi API Google thay mặt người dùng. Chỉ cần email để định danh, nên
  không lưu token của Google.
- Mailer thật. Nếu sau này muốn magic link chạy ở production thì đó là một việc riêng.
