# Worker: BullMQ + Playwright (xuất PDF) — TDD §8.4.1, §12.3
#
# Image Playwright thay vì node:22 + cài chromium thủ công: nó đã có sẵn mọi
# thư viện hệ thống mà Chromium cần, và phiên bản browser khớp với package
# `playwright`. Lệch phiên bản là lỗi khó lần ra nhất của Playwright.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# ── Font tiếng Việt — BẮT BUỘC, không phải tuỳ chọn (TDD §8.4.1) ────────────
# Không có font có dấu thì Chromium in ra ô vuông ở mọi chữ "ữ", "ạ", "ế"…
# và lỗi chỉ lộ ra ở file PDF cuối cùng, không lộ trên màn hình dev.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-cjk \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Cài phụ thuộc trước, copy nguồn sau: sửa code không phải cài lại npm.
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/apps/web/package.json         apps/web/
COPY frontend/packages/schema/package.json  packages/schema/
COPY frontend/packages/ai/package.json      packages/ai/
COPY frontend/packages/db/package.json      packages/db/
COPY frontend/packages/kb/package.json      packages/kb/
COPY frontend/packages/matching/package.json packages/matching/
COPY frontend/packages/pdf/package.json     packages/pdf/
COPY frontend/packages/templates/package.json packages/templates/
COPY frontend/services/worker/package.json  services/worker/
# Phải copy package.json của MỌI workspace trong package-lock, kể cả workspace
# worker không dùng: thiếu một file thì npm coi lock là lệch và dừng. Trước đây
# thiếu `kb` và `matching` — đúng hai package worker gọi trong match_analysis.
RUN npm ci --omit=dev --ignore-scripts

# Các package dùng `main: ./src/index.ts` — chạy thẳng TypeScript bằng tsx,
# không có bước build trung gian (TDD §12.3).
RUN npm i -g tsx@4.19.2

COPY frontend/tsconfig.base.json frontend/tsconfig.json config.yml ./
COPY frontend/packages/  packages/
COPY frontend/services/worker/ services/worker/

# Thư mục lưu file upload khi STORAGE_DRIVER=local
RUN mkdir -p /app/var/storage
ENV STORAGE_ROOT=/app/var/storage

# Worker không nghe cổng nào — healthcheck kiểm tra tiến trình còn sống và
# kết nối được Redis, vì worker chết âm thầm thì job chỉ nằm im trong hàng đợi.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const{createClient}=require('redis')" 2>/dev/null || pgrep -f 'services/worker' >/dev/null || exit 1

CMD ["tsx", "services/worker/src/index.ts"]
