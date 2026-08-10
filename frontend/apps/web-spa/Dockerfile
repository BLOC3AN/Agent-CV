# SPA: Vite build ra tĩnh, Express phục vụ + proxy sang Go.
#
# Build từ GỐC repo, không phải từ apps/web-spa — `npm ci` cần package.json
# của mọi workspace mà package-lock khai:
#   docker compose up -d --build   (hoặc riêng: docker compose build web-spa)
#   (context: .. — xem docker-compose.yml)

# ── Giai đoạn build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/apps/web-spa/package.json         apps/web-spa/
COPY frontend/packages/schema/package.json      packages/schema/
COPY frontend/packages/kb/package.json          packages/kb/

RUN npm ci --ignore-scripts

COPY frontend/apps/web-spa/ apps/web-spa/
COPY frontend/packages/schema/ packages/schema/

WORKDIR /app/apps/web-spa
RUN npm run build

# ── Giai đoạn chạy ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# `server.cjs` được esbuild gói với `--packages=external`, nên express và các
# phụ thuộc runtime vẫn phải có mặt trong node_modules.
#
# KHÔNG `npm prune --omit=dev` ở đây. Prune cần package.json của MỌI workspace
# mà package-lock khai; stage này chỉ có node_modules và dist, nên npm sẽ thấy
# một cây workspace khuyết và gỡ nhầm. Image to hơn vài chục MB, đổi lại nó
# chạy đúng — cái giá đó chấp nhận được cho một service nội bộ.
COPY --from=builder /app/node_modules       ./node_modules
COPY --from=builder /app/apps/web-spa/dist  ./dist
COPY --from=builder /app/packages/schema    ./packages/schema

EXPOSE 3000
ENV PORT=3000

# Gọi /api/health nên healthcheck này đi xuyên qua Go — cố ý: container chỉ
# thật sự "khoẻ" khi cả proxy lẫn backend nó dựa vào đều sống. Hệ quả: backend
# chập chờn/restart sẽ làm web-spa cũng báo unhealthy dù tiến trình Express
# vẫn ổn — đừng nhầm đó là lỗi riêng của web-spa.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
