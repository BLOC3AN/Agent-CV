-- Phiên đăng nhập & magic link — UC-11, X-1.
--
-- Vì sao lưu ở DB chứ không chỉ ký JWT: đăng xuất phải có hiệu lực NGAY. JWT
-- tự chứa thì chỉ hết hạn theo thời gian, và một token bị lộ vẫn dùng được cho
-- tới lúc hết hạn — không chấp nhận được với dữ liệu chứa PII (TDD §15).

CREATE TABLE sessions (
  -- Băm của token, KHÔNG phải token. Rò cả bảng này cũng không đăng nhập được
  -- vào tài khoản nào (cùng lý do như lưu mật khẩu đã băm).
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Magic link: token dùng MỘT LẦN, hết hạn 15 phút (UC-11 bước 3).
CREATE TABLE login_tokens (
  token_hash text PRIMARY KEY,
  email      citext NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Đánh dấu đã dùng thay vì xoá: bấm lại link cũ phải báo "đã dùng rồi",
  -- khác hẳn với "link không tồn tại" (có thể là dấu hiệu bị dò token).
  used_at    timestamptz
);
CREATE INDEX login_tokens_expires_idx ON login_tokens (expires_at);
