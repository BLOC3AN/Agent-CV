# Migration backend sang Go

## Mục tiêu

Backend mới nằm ở `backend/`, frontend nằm ở `frontend/`. API Go giữ contract
HTTP ổn định để frontend có thể chuyển từng route mà không phải rewrite giao
diện cùng lúc.

## Trạng thái

`backend/cmd/api` và `backend/cmd/worker` hiện đã có production path cho
auth, upload/job, profile/CV, KB, analyze, chat reply, export PDF, parse CV và
keyword/semantic matching. Các CV thật trong `var/storage` đã được chạy qua
worker Go. Import review, import complete, job SSE (`progress/done/failed`),
analyze SSE (`report/done`) và proposal JSON Patch cũng đã khớp contract mà
frontend đang dùng.

Phần Node cũ vẫn được giữ trong `frontend/apps/web` server routes,
`frontend/services/worker` và các package dùng
chung để bảo toàn chức năng trong giai đoạn chuyển tiếp. Không mở rộng phần
legacy; mỗi luồng mới phải có implementation và test ở Go trước.

## Đã chuyển sang Go

- `GET /api/health`
- `POST /api/auth/request`, `GET /api/auth/verify`, `POST /api/auth/logout`
- `POST /api/uploads/cv`: kiểm tra PDF, giới hạn 12 MB, lưu storage volume và
  tạo job bền vững trong PostgreSQL; mỗi `uploadId` là một lượt upload độc lập.
- `GET /api/jobs/{id}`: đọc trạng thái job từ PostgreSQL.
- Go worker claim job bằng PostgreSQL `FOR UPDATE SKIP LOCKED`, xử lý
  `parse_cv` qua PDFKit và `match_analysis` bằng keyword + embedding; khi
  embedding/model không khả dụng, kết quả được đánh dấu degraded.
  Kết quả được ghi lại vào `jobs`/`match_analyses`, không để job treo.

Go đã có production path với PostgreSQL và storage thật. Migration chưa hoàn
tất cho tới khi frontend đổi sang Go và các route/worker còn lại được chuyển.

## Còn lại cần chuyển

Các edge case còn phải hoàn tất trước khi xóa Node route là ownership/authorization
đầy đủ cho mọi read/mutation, retry/retention parity và đối soát staging.
`embed_profile` và OCR/image branch nằm ngoài phạm vi hiện tại; semantic matching
đã có fallback degraded và LLM advice/reranker đã chạy trong worker Go.

Image Go được build offline từ binary local:

```bash
./backend/scripts/build-go-image.sh
docker compose -f backend/docker-compose.yml build backend
docker compose -f backend/docker-compose.yml up -d backend
```

## Quy tắc chuyển route

1. Viết contract test cho route hiện tại.
2. Viết handler Go tương đương.
3. Chuyển frontend gọi backend Go.
4. Chạy contract/integration test.
5. Xóa route Node cũ sau khi contract test, staging đối soát và rollback window
   đều đạt; hiện tại Node route vẫn là rollback safety net.

## Chạy backend Go

```bash
cd backend
go test ./...
go run ./cmd/api
# build binary used by the offline Docker image
./scripts/build-go-image.sh
```

Docker image Go dùng `scratch` và binary local để không phụ thuộc registry ở
bước build. Cần chạy script build binary trước `docker compose build backend`.

Để build cả stack trên máy đang có builder container lỗi DNS:

```bash
./backend/scripts/build-go-image.sh
BUILDX_BUILDER=default ./backend/scripts/build-all.sh
```

Use case và gate trước khi Go làm backend chính nằm ở
[`GO_CUTOVER_USECASES.md`](GO_CUTOVER_USECASES.md) và
[`GO_CUTOVER_TESTCASES.md`](GO_CUTOVER_TESTCASES.md). Không chuyển 100% traffic
chỉ dựa trên việc image build thành công.

Frontend cutover hiện được bảo vệ bởi `GO_API_CUTOVER` (mặc định `false`). Smoke
test thực tế với flag `true` đã xác nhận `/api/health`, magic-link request và
upload/job đi qua Go trong khi trang Next vẫn render bình thường. Khi bật cờ,
middleware rewrite toàn bộ `/api/*` sang Go; khi tắt cờ, Node route vẫn phục vụ
rollback.
