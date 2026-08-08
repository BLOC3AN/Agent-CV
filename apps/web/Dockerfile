# Web: Next.js 15 (App Router) — TDD §12.1
#
# Build từ GỐC repo, không phải từ apps/web:
#   docker compose --profile full up -d          (context: . — xem docker-compose.yml)
#
# Các package nội bộ dùng `main: ./src/index.ts` — TypeScript nguồn, không có
# bước build riêng. `next build` tự transpile chúng qua `transpilePackages`
# trong next.config.ts, nên image cần NGUỒN của packages/*, không phải dist.

# ── Giai đoạn build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# `npm ci` cần package.json của MỌI workspace mà package-lock khai, kể cả
# workspace mà web không dùng: thiếu một file thì lock bị coi là lệch và lệnh
# dừng ngay. Copy riêng từng file để sửa code không phải cài lại npm.
COPY package.json package-lock.json ./
COPY apps/web/package.json             apps/web/
COPY packages/schema/package.json      packages/schema/
COPY packages/ai/package.json          packages/ai/
COPY packages/db/package.json          packages/db/
COPY packages/kb/package.json          packages/kb/
COPY packages/matching/package.json    packages/matching/
COPY packages/pdf/package.json         packages/pdf/
COPY packages/templates/package.json   packages/templates/
COPY services/worker/package.json      services/worker/

# KHÔNG `--omit=dev`: `next build` cần typescript và @types/* để biên dịch.
# `--ignore-scripts` chặn postinstall của playwright tải browser ~400MB — web
# không render PDF, đó là việc của worker.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json tsconfig.json config.yml ./
COPY packages/          packages/
COPY services/worker/   services/worker/
COPY apps/web/          apps/web/

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:web

# ── Giai đoạn chạy ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app /app

# Bỏ devDependencies SAU khi build: vitest, playwright và @types/* chỉ cần lúc
# biên dịch. Prune ở đây chứ không cài hai lần — cài lại từ đầu sẽ phân giải ra
# cây phụ thuộc khác với cây vừa build xong.
#
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

# `typescript` phải QUAY LẠI sau khi prune, dù nó là devDependency.
# `next.config.ts` viết bằng TypeScript và `next start` đọc file config MỖI LẦN
# khởi động; không thấy tsc thì Next tự đi cài typescript BẰNG YARN lúc chạy —
# đo được: khởi động 111 giây thay vì 39, ghi vào container đang chạy, và chết
# hẳn ở nơi không có mạng ra ngoài.
#
# COPY chứ không `npm install`: stage này có NODE_ENV=production, nên npm coi
# typescript là devDependency và bỏ qua nó kể cả khi được gọi tên. Copy thẳng
# thì không phụ thuộc vào cách npm diễn giải môi trường, và lấy đúng phiên bản
# vừa dùng để build.
COPY --from=builder /app/node_modules/typescript /app/node_modules/typescript

# Thư mục file upload — web GHI, worker ĐỌC, dùng chung volume `uploads`.
# Đường dẫn phải khớp STORAGE_ROOT của worker, nếu không worker báo FILE_MISSING
# với mọi file web vừa lưu.
RUN mkdir -p /app/var/storage
ENV STORAGE_ROOT=/app/var/storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `--workspace` chứ không `cd apps/web`: giữ npm ở gốc để nó phân giải
# workspace đúng như lúc build.
CMD ["npm", "--workspace", "@hr/web", "run", "start"]
