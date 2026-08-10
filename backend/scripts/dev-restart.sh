#!/usr/bin/env bash
# Khởi động lại web-spa cho kiểm thử thủ công / tích hợp.
#
# Tồn tại vì đã mắc HAI lần cùng một kiểu lỗi:
#   1. Sửa code → test vẫn hỏng vì SERVER CŨ chưa chết, còn giữ cổng
#   2. Sửa packages/* → test vẫn sai vì server chạy BUILD CŨ
# Cả hai đều làm log đọc được nhưng nói dối.
set -euo pipefail

PORT="${PORT:-3100}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$PROJECT_ROOT/frontend/apps/web-spa"

echo "→ tắt tiến trình đang giữ cổng $PORT"
fuser -k "$PORT/tcp" 2>/dev/null || true
sleep 2

echo "→ build lại (BẮT BUỘC sau khi sửa packages/*)"
npm run build > /tmp/web-spa-build.log 2>&1 || { tail -30 /tmp/web-spa-build.log; exit 1; }

set -a; [ ! -f "$PROJECT_ROOT/.env" ] || . "$PROJECT_ROOT/.env"; set +a
export APP_URL="http://localhost:$PORT"
export STORAGE_ROOT="${STORAGE_ROOT:-$PROJECT_ROOT/var/storage}"

echo "→ khởi động"
setsid env PORT="$PORT" npm run start > /tmp/web-spa.log 2>&1 < /dev/null &
disown

for i in $(seq 1 30); do
  if curl -sf -m 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "✓ sẵn sàng: http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done
echo "✗ không lên sau 30s"; tail -20 /tmp/web-spa.log; exit 1
