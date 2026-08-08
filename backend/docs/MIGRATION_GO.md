# Migration backend sang Go

## Mục tiêu

Backend mới nằm ở `backend/`, frontend nằm ở `frontend/`. API Go giữ contract
HTTP ổn định để frontend có thể chuyển từng route mà không phải rewrite giao
diện cùng lúc.

## Trạng thái

`backend/cmd/api` hiện là vertical slice đầu tiên: health, upload job và đọc
trạng thái job. Nó dùng
`uploadId` riêng cho mỗi lượt upload, vì cùng một file không đồng nghĩa với
dùng lại kết quả cũ.

Phần Node cũ được giữ tạm trong `frontend/apps/web` server routes,
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
  `parse_cv` qua PDFKit và `match_analysis` bằng keyword scoring degraded mode.
  Kết quả được ghi lại vào `jobs`/`match_analyses`, không để job treo.

Go đã có production path với PostgreSQL và storage thật. Migration chưa hoàn
tất cho tới khi frontend đổi sang Go và các route/worker còn lại được chuyển.

## Còn lại cần chuyển

CV export, chat/proposals, semantic embedding/reranking, LLM gap advice,
OCR/image branch và `embed_profile` vẫn cần model/PDF adapter Go riêng.

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
5. Xóa route Node cũ sau khi production đã chuyển traffic.

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
