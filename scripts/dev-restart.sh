#!/usr/bin/env bash
# Khởi động lại Next cho kiểm thử thủ công / tích hợp.
#
# Tồn tại vì đã mắc HAI lần cùng một kiểu lỗi:
#   1. Sửa code → test vẫn hỏng vì SERVER CŨ chưa chết, còn giữ cổng
#   2. Sửa packages/* → test vẫn sai vì `next start` chạy BUILD CŨ
# Cả hai đều làm log đọc được nhưng nói dối.
set -euo pipefail

PORT="${PORT:-3100}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/web"

echo "→ tắt tiến trình đang giữ cổng $PORT"
fuser -k "$PORT/tcp" 2>/dev/null || true
sleep 2

echo "→ build lại (BẮT BUỘC sau khi sửa packages/*)"
npx next build > /tmp/next-build.log 2>&1 || { tail -30 /tmp/next-build.log; exit 1; }

set -a; . "$ROOT/.env"; set +a
export APP_URL="http://localhost:$PORT"
# next start chạy trong apps/web nên cwd khác worker — ép tuyệt đối để hai bên
# trỏ cùng một thư mục file upload
export STORAGE_ROOT="${STORAGE_ROOT:-$ROOT/var/storage}"

echo "→ khởi động"
setsid npx next start -p "$PORT" > /tmp/next.log 2>&1 < /dev/null &
disown

for i in $(seq 1 30); do
  if curl -sf -m 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "✓ sẵn sàng: http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done
echo "✗ không lên sau 30s"; tail -20 /tmp/next.log; exit 1
