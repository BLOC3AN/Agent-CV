# HR-Agent

Ứng dụng dựng CV và phân tích độ khớp với JD cho sinh viên / fresher.

Phiên bản hiện tại: **1.0.1**

## Cấu trúc

```text
README.md
config.yml
.env.example
backend/
  cmd/                  Go entrypoints
  internal/             Go HTTP/API code
  db/                   migrations
  docs/                 product, TDD, use cases, test cases, migration notes
  legacy-node-services/ PDFKit dependency cho Go worker
frontend/
  apps/web/             React + Next.js UI
  packages/             schema, templates và thư viện dùng chung
```

Backend Go hiện là runtime nghiệp vụ duy nhất theo API contract. Frontend
React/Next.js chỉ đảm nhiệm UI; phần Node legacy đã được gỡ khỏi runtime.

## Chạy backend Go

```bash
cd backend
go test ./...
go run ./cmd/api
```

Backend hiện có vertical slice đầu tiên:

- `GET /api/health`
- `POST /api/uploads/cv`
- `GET /api/jobs/{jobId}`

Mỗi lần upload phải có `uploadId` riêng. Cùng một file ở hai lần upload khác
nhau không được dùng lại kết quả cũ.

## Chạy frontend và backend Go

```bash
cd frontend
npm install
npm run typecheck
npm run dev
```

Frontend dùng các package dùng chung cho UI/schema; API và worker production
đều chạy bằng Go. Quy ước và contract được ghi trong
[backend/docs/MIGRATION_GO.md](backend/docs/MIGRATION_GO.md).

## Docker Compose

Compose nằm ở `backend/docker-compose.yml`:

Để chạy đầy đủ stack và cho frontend gọi trực tiếp Go API:

```bash
BUILDX_BUILDER=default \
docker compose -f backend/docker-compose.yml --env-file .env \
  --profile full up -d --build
```

Sau khi chạy, mở [http://localhost:3000](http://localhost:3000).

### Đăng nhập khi test local

Hệ thống dùng magic link, không dùng mật khẩu:

1. Mở [http://localhost:3000/login](http://localhost:3000/login).
2. Nhập email bất kỳ hợp lệ, ví dụ `tester@example.com`.
3. Bấm **Gửi link đăng nhập**.
4. Vì local chưa cấu hình SMTP, màn hình sẽ hiện link đăng nhập trực tiếp.
   Bấm link đó để tạo session và quay về trang chủ.

Link có hiệu lực 15 phút; session giữ 30 ngày trên trình duyệt. Khi deploy
thật, cấu hình SMTP để link được gửi qua email thay vì hiển thị trên màn hình.

Nếu muốn gọi API kiểm tra nhanh:

```bash
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/auth/request \
  -H 'content-type: application/json' \
  -d '{"email":"tester@example.com"}'
```

Response local sẽ có trường `devLink`; mở trường này trong trình duyệt để đăng
nhập.

Kiểm tra trạng thái service:

```bash
docker compose -f backend/docker-compose.yml --profile full ps
```

Tắt stack:

```bash
docker compose -f backend/docker-compose.yml --profile full down
```

Nếu Docker đang chọn builder container bị lỗi DNS, dùng builder mặc định:

```bash
./backend/scripts/build-go-image.sh
BUILDX_BUILDER=default ./backend/scripts/build-all.sh
```

Hướng dẫn sửa DNS lâu dài cho Docker daemon: [`backend/docs/DOCKER_DNS.md`](backend/docs/DOCKER_DNS.md).

Các service gồm Go backend, Go worker, Next frontend, Postgres, Redis và PDFKit
(dependency tách text). Dev có giá trị `AUTH_SECRET` mặc định; production phải
đặt secret riêng trong `.env` hoặc secret manager.

Chat giữ lịch sử bền vững trong PostgreSQL và cache tối đa 10 tin gần nhất theo
`chat:memory:{userID}:{sessionID}` trong Redis (TTL 7 ngày). Khi một đề xuất
đang chờ duyệt, trả lời `OK`/`Đồng ý`/`Xác nhận` sẽ tự động áp dụng toàn bộ đề
xuất; mọi thay đổi vẫn đi qua endpoint proposal có kiểm tra ownership.

Khung chat dùng theme CV hiện tại (màu nhấn, font, cỡ chữ và giãn dòng), rộng
456px trên desktop. Nội dung assistant hỗ trợ Markdown/GFM, LaTeX (`$...$`,
`$$...$$`) và Mermaid code fence với `securityLevel: strict`.

Middleware luôn rewrite toàn bộ `/api/*` từ frontend sang Go backend. Next chỉ
render UI; không còn Node API fallback.

## Tài liệu

- [Migration Go](backend/docs/MIGRATION_GO.md)
- [Migration use cases](backend/docs/MIGRATION_USECASES.md)
- [Migration test cases](backend/docs/MIGRATION_TESTCASES.md)
- [Product](backend/docs/PRODUCT.md)
- [TDD](backend/docs/TDD.md)
- [Use cases](backend/docs/USECASES.md)
- [Test cases](backend/docs/TESTCASES.md)

## TODO — Go-only cutover

Runtime nghiệp vụ đã chuyển hoàn toàn sang Go và Node API/worker fallback đã
được gỡ. Các việc còn lại là kiểm thử staging và vận hành, được xác nhận bằng
[GO_CUTOVER_USECASES.md](backend/docs/GO_CUTOVER_USECASES.md) và
[GO_CUTOVER_TESTCASES.md](backend/docs/GO_CUTOVER_TESTCASES.md):

- Chạy integration/staging test với dữ liệu thật, gồm ownership, retry,
  retention, SSE, import, analyze, chat/proposal và export.
- Theo dõi các job Go và PDFKit dependency trong production; không có request
  nghiệp vụ nào được fallback sang Next.
