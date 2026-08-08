# HR-Agent

Ứng dụng dựng CV và phân tích độ khớp với JD cho sinh viên / fresher.

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
  legacy-node-services/ PDFKit chuyển tiếp
frontend/
  apps/web/             React + Next.js UI
  packages/             schema, templates và runtime chuyển tiếp
  services/worker/      worker Node chuyển tiếp
```

Backend Go đang được chuyển dần theo API contract. Frontend React/Next.js và
Tailwind CSS được giữ ổn định trong lúc migration; phần Node legacy không mở
rộng thêm.

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

## Chạy frontend legacy trong giai đoạn chuyển tiếp

```bash
cd frontend
npm install
npm run typecheck
npm run dev
```

Frontend hiện vẫn dùng một số package và worker Node cũ để giữ chức năng. Các
route sẽ được chuyển sang Go theo quy trình trong
[backend/docs/MIGRATION_GO.md](backend/docs/MIGRATION_GO.md).

## Docker Compose

Compose nằm ở `backend/docker-compose.yml`:

Để chạy đầy đủ stack và cho frontend gọi trực tiếp Go API:

```bash
GO_API_CUTOVER=true \
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

Các service gồm Go backend, Next frontend, Postgres, Redis, PDFKit và worker
chuyển tiếp. Dev có giá trị `AUTH_SECRET` mặc định; production phải đặt secret
riêng trong `.env` hoặc secret manager.

Chat giữ lịch sử bền vững trong PostgreSQL và cache tối đa 10 tin gần nhất theo
`chat:memory:{userID}:{sessionID}` trong Redis (TTL 7 ngày). Khi một đề xuất
đang chờ duyệt, trả lời `OK`/`Đồng ý`/`Xác nhận` sẽ tự động áp dụng toàn bộ đề
xuất; mọi thay đổi vẫn đi qua endpoint proposal có kiểm tra ownership.

Khung chat dùng theme CV hiện tại (màu nhấn, font, cỡ chữ và giãn dòng), rộng
456px trên desktop. Nội dung assistant hỗ trợ Markdown/GFM, LaTeX (`$...$`,
`$$...$$`) và Mermaid code fence với `securityLevel: strict`.

`GO_API_CUTOVER=true` là cờ để middleware rewrite toàn bộ `/api/*` từ frontend
sang Go backend. Đặt `false` để rollback về Node API route trong giai đoạn
chuyển tiếp.

## Tài liệu

- [Migration Go](backend/docs/MIGRATION_GO.md)
- [Migration use cases](backend/docs/MIGRATION_USECASES.md)
- [Migration test cases](backend/docs/MIGRATION_TESTCASES.md)
- [Product](backend/docs/PRODUCT.md)
- [TDD](backend/docs/TDD.md)
- [Use cases](backend/docs/USECASES.md)
- [Test cases](backend/docs/TESTCASES.md)
