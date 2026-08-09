# HR-Agent — SPA (web-spa)

Giao diện SPA (Vite + React) của HR-Agent, phục vụ tại cổng `3002`. Lớp Express
phía trước chỉ làm hai việc: phục vụ file tĩnh (production) hoặc Vite dev
middleware (development), và chuyển tiếp mọi request `/api/*` sang backend Go.

## Chạy cục bộ

**Yêu cầu:** Node.js >= 20.10

1. Cài phụ thuộc (từ `frontend/`): `npm install`
2. Cấu hình `BACKEND_URL` trong `.env` nếu backend Go không chạy ở
   `http://localhost:8080` (xem `.env.example`).
3. Chạy: `npm run dev` (trong `frontend/apps/web-spa/`)
