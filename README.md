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

```bash
docker compose -f backend/docker-compose.yml --profile full up -d --build
```

Các service gồm Go backend, Next frontend, Postgres, Redis, PDFKit và worker
chuyển tiếp. Dev có giá trị `AUTH_SECRET` mặc định; production phải đặt secret
riêng trong `.env` hoặc secret manager.

## Tài liệu

- [Migration Go](backend/docs/MIGRATION_GO.md)
- [Migration use cases](backend/docs/MIGRATION_USECASES.md)
- [Migration test cases](backend/docs/MIGRATION_TESTCASES.md)
- [Product](backend/docs/PRODUCT.md)
- [TDD](backend/docs/TDD.md)
- [Use cases](backend/docs/USECASES.md)
- [Test cases](backend/docs/TESTCASES.md)
