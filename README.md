# HR-Agent

Ứng dụng dựng CV và phân tích độ khớp với JD cho sinh viên / fresher. Repo này là monorepo Node.js, frontend nằm ở `apps/web` và chạy bằng Next.js.

## Yêu cầu

- Node.js `>=20.10`
- npm
- Docker + Docker Compose
- Kết nối tới model server nếu muốn dùng AI đầy đủ (`MODEL_HOST` trong `.env`)

## Chạy frontend local

### 1. Cài dependencies

```bash
npm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env
```

Sửa ít nhất các biến này trong `.env`:

```bash
DATABASE_URL=postgres://postgres:hragent_dev@localhost:5433/hragent
REDIS_URL=redis://localhost:6380
PDFKIT_URL=http://localhost:8100
ALLOW_DEV_USER=true
STORAGE_ROOT=/home/hailt/Desktop/HR-agent/var/storage
```

`STORAGE_ROOT` phải là đường dẫn tuyệt đối. Web và worker chạy ở thư mục làm việc khác nhau, nên đường dẫn tương đối sẽ làm web lưu file một nơi còn worker đọc nơi khác.

### 3. Khởi động hạ tầng local

Chạy Postgres và Redis:

```bash
docker compose up -d postgres redis
```

Chạy migration:

```bash
npm run db:migrate
```

Nếu cần chức năng import PDF, chạy thêm service trích PDF:

```bash
docker compose --profile full up -d pdfkit
```

### 4. Chạy frontend

```bash
npm --workspace @hr/web run dev
```

Mở:

```text
http://localhost:3000
```

Kiểm tra health endpoint:

```bash
curl http://localhost:3000/api/health
```

Endpoint có thể báo `degraded: true` nếu model server chưa sẵn sàng, nhưng frontend vẫn chạy được các phần không phụ thuộc AI.

## Chạy worker cho import / export

Các tác vụ như parse CV, export PDF và xử lý queue cần worker:

```bash
npm --workspace @hr/worker run dev
```

Giữ worker chạy song song với frontend. Với workflow này, `STORAGE_ROOT` của web và worker phải trỏ cùng một thư mục tuyệt đối.

## Workflow kiểm thử thủ công

Repo có sẵn script build lại và chạy Next ở port `3100`:

```bash
npm run dev:restart
```

Script này:

- tắt process đang giữ port `3100`
- build lại `apps/web`
- load `.env`
- đặt `ALLOW_DEV_USER=true` nếu chưa có
- chạy app tại `http://localhost:3100`

## Lệnh hữu ích

```bash
npm run typecheck
npm run test
npm run test:unit
npm run test:ui
npm run build:web
```

Reset database local:

```bash
npm run db:reset
```

Lệnh này xoá volume Postgres của project rồi chạy lại migration, nên chỉ dùng cho dữ liệu dev.

## Cổng local

| Service | Host port | Container port |
|---|---:|---:|
| Web | `3000` | `3000` |
| Postgres | `5433` | `5432` |
| Redis | `6380` | `6379` |
| PDFKit | `8100` | `8000` |

## Tài liệu liên quan

- [docs/FRONTEND.md](docs/FRONTEND.md)
- [docs/TDD.md](docs/TDD.md)
- [docs/USECASES.md](docs/USECASES.md)
- [docs/TESTCASES.md](docs/TESTCASES.md)
