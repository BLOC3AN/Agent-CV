# HR-Agent

Ứng dụng dựng CV và phân tích độ khớp với JD cho sinh viên / fresher.
Monorepo npm workspaces: frontend Next.js ở `apps/web`, xử lý nền ở `services/worker`,
nghiệp vụ dùng chung nằm trong `packages/*`.

## Cấu trúc repo

```
HR-agent/
├── apps/web/            Next.js 15 (App Router) — UI + BFF. Chỉ ĐẨY việc vào hàng đợi
├── services/
│   ├── worker/          BullMQ: parse CV, export PDF, phân tích JD
│   └── pdfkit/          FastAPI + PyMuPDF: trích text + toạ độ từ PDF
├── packages/
│   ├── schema/          Zod: Profile, JD, Patch, KB — nguồn sự thật về dữ liệu
│   ├── ai/              Model Gateway: routing · budget · breaker · validate schema
│   ├── db/              Repository layer trên Postgres (profiles, jobs, chat, auth…)
│   ├── matching/        Scoring engine — THUẦN CODE, không gọi LLM
│   ├── kb/              Knowledge Base: selector + trích dẫn
│   ├── templates/       React component render CV (dùng chung cho preview và PDF)
│   └── pdf/             Playwright: render trang /print → PDF
├── db/migrations/       SQL migration (chạy bằng `npm run db:migrate`)
├── kb/seed/             Knowledge Base khởi tạo (YAML)
├── eval/                Bộ đánh giá trên CV/JD thật
├── config.yml           Nguồn sự thật về model & routing
└── docker-compose.yml   Postgres · Redis · pdfkit · web · worker
```

Chiều phụ thuộc: `apps/web` và `services/*` → `packages/*` → `packages/schema`.
Không có chiều ngược lại. Chỉ `packages/ai/src/providers/**` được phép gọi model server.
Quy tắc này được cưỡng chế bằng ESLint (`npm run lint`), không chỉ bằng quy ước.

## Yêu cầu

- Node.js `>=20.10`
- npm
- Docker + Docker Compose
- Kết nối tới model server nếu muốn dùng AI đầy đủ (`MODEL_HOST` trong `.env`)

## Chạy local

### 1. Cài dependencies

```bash
npm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env
```

Các biến cần đặt cho một lượt chạy local đầy đủ:

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgres://postgres:hragent_dev@localhost:5433/hragent` |
| `REDIS_URL` | ✅ | `redis://localhost:6380` |
| `PDFKIT_URL` | import PDF | `http://localhost:8100` |
| `STORAGE_ROOT` | ✅ | **Đường dẫn tuyệt đối.** Web và worker chạy ở thư mục làm việc khác nhau, đường dẫn tương đối làm web lưu file một nơi còn worker đọc nơi khác |
| `APP_URL` | đăng nhập | Gốc URL sinh magic link, và quyết định cookie phiên có cờ `secure` hay không ([apps/web/lib/auth.ts](apps/web/lib/auth.ts)) |
| `ALLOW_DEV_USER` | dev | `true` để bỏ qua đăng nhập khi chạy thử tay. **Không đặt ở production** — mọi hồ sơ sẽ dồn vào một tài khoản |
| `MODEL_HOST` | tính năng AI | Không có thì app vẫn chạy, chỉ degrade phần AI |
| `SMTP_URL` | gửi mail thật | Bỏ trống ở dev thì magic link được in ra console thay vì gửi đi ([apps/web/lib/mailer.ts](apps/web/lib/mailer.ts)). Ở `NODE_ENV=production` mà thiếu thì đăng nhập ném lỗi |
| `MAIL_FROM` | gửi mail thật | Mặc định `HR-Agent <no-reply@localhost>` |
| `WEB_BASE_URL` | export PDF | Worker dùng để mở trang `/print`. Mặc định `http://localhost:3000` |

### Model chat

Thanh tin nhắn cho phép chọn ba model: `Neura flash` (local, mặc định),
`Neura Pro` (OpenAI GPT-5.6 Luna) và `Neura Plus` (DeepSeek V4 Flash). Điền
`OPENAI_API_KEY` và `DEEPSEEK_API_KEY` trong `.env` để dùng hai provider cloud.
`.env` hiện tại có thể dùng tên cũ `DEEPSEAK_API_KEY`.

Trong lúc model đang sinh, nút `Dừng` sẽ huỷ luồng SSE ngay; sau đó có thể đổi
model hoặc sửa câu hỏi và gửi lại.
| `AUTH_SECRET` | `--profile full` | Chỉ docker-compose đọc; compose từ chối khởi động nếu trống |

### 3. Khởi động hạ tầng local

```bash
docker compose up -d postgres redis
npm run db:migrate
```

Nếu cần chức năng import PDF, chạy thêm service trích PDF:

```bash
docker compose --profile full up -d pdfkit
```

### 4. Nạp Knowledge Base

```bash
npm run kb:ingest
```

Bỏ qua bước này thì app vẫn chạy, nhưng mọi lời khuyên sẽ hiện dưới dạng
*"gợi ý chung của AI — chưa có nguồn"*: phần trích dẫn chuyên gia lấy dữ liệu
từ bảng KB, chưa nạp thì bảng rỗng.

### 5. Chạy web và worker

```bash
npm --workspace @hr/web run dev        # http://localhost:3000
npm --workspace @hr/worker run dev     # giữ chạy song song
```

Worker là bắt buộc cho parse CV, export PDF và phân tích JD — web chỉ đẩy việc
vào hàng đợi chứ không tự xử lý. Cả hai phải trỏ cùng một `STORAGE_ROOT` tuyệt đối.

Kiểm tra:

```bash
curl http://localhost:3000/api/health
```

Endpoint có thể báo `degraded: true` nếu model server chưa sẵn sàng; frontend
vẫn chạy được các phần không phụ thuộc AI.

## Workflow kiểm thử thủ công

```bash
npm run dev:restart
```

Script [scripts/dev-restart.sh](scripts/dev-restart.sh) tắt process đang giữ port
`3100`, **build lại** `apps/web`, nạp `.env`, rồi chạy `next start` tại
`http://localhost:3100`. Bước build lại là bắt buộc: sửa `packages/*` mà chỉ
restart thì `next start` vẫn chạy bundle cũ.

## Lệnh

```bash
npm run lint        # ESLint — gồm quy tắc phụ thuộc kiến trúc
npm run typecheck   # tsc cho packages/services/eval VÀ apps/web
npm run test        # unit + ui
npm run test:unit
npm run test:ui
npm run test:int    # CẦN hạ tầng sống: Postgres, Redis, model server, app ở :3100
npm run build:web
npm run eval        # bộ đánh giá trên CV/JD thật trong eval/
```

`npm run typecheck` chạy hai project riêng: `tsconfig.json` (packages, services,
eval, db) và `apps/web/tsconfig.json`. Chúng phải tách vì frontend cần `lib: DOM`
và `jsx: preserve`, còn code nền thì không.

## Reset database

```bash
npm run db:reset
```

> ⚠️ **Lệnh này xoá TẤT CẢ named volume của project**, không riêng Postgres:
> `pgdata` (database), `redisdata` (hàng đợi BullMQ) và `uploads`
> (**file CV người dùng đã tải lên**). `docker compose down -v` không nhận
> tham số để giới hạn theo service.
>
> Chỉ dùng cho dữ liệu dev. Muốn xoá riêng database:
> ```bash
> docker compose rm -sf postgres && docker volume rm hr-agent_pgdata
> docker compose up -d postgres && npm run db:migrate
> ```

## Chạy toàn bộ bằng Docker

```bash
docker compose --profile full up -d
```

Khởi động cả `web`, `worker` và `pdfkit`. Cần `AUTH_SECRET` trong `.env`,
nếu không compose từ chối khởi động.

Cả hai image build từ **gốc repo** (`context: .`) chứ không từ thư mục con:
các package nội bộ dùng `main: ./src/index.ts` nên image cần nguồn của
`packages/*`. [.dockerignore](.dockerignore) chặn `var/` và `eval/cv/` khỏi
build context — đó là CV thật của người dùng, không được vào image.

## Cổng local

| Service | Host port | Container port |
|---|---:|---:|
| Web | `3000` | `3000` |
| Web (`dev:restart`) | `3100` | — |
| Postgres | `5433` | `5432` |
| Redis | `6380` | `6379` |
| PDFKit | `8100` | `8000` |

Postgres và Redis lệch cổng mặc định để tránh xung đột với dịch vụ sẵn có trên máy dev.

## Tài liệu

| File | Nội dung |
|---|---|
| [docs/PRODUCT.md](docs/PRODUCT.md) | Thiết kế sản phẩm: bốn tình trạng người dùng, ba màn hình Home |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Thiết kế frontend: bản đồ màn hình, bố cục, kiến trúc state |
| [docs/TDD.md](docs/TDD.md) | Thiết kế kỹ thuật: gateway, ngân sách context, dữ liệu, luồng nghiệp vụ |
| [docs/USECASES.md](docs/USECASES.md) | Use case và business rule |
| [docs/TESTCASES.md](docs/TESTCASES.md) | Test case |
| [eval/README.md](eval/README.md) | Bộ đánh giá |
