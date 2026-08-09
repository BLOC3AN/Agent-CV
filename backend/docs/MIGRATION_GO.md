# Migration backend sang Go

## Mục tiêu

Backend mới nằm ở `backend/`, frontend nằm ở `frontend/`. API Go giữ contract
HTTP ổn định để frontend có thể chuyển từng route mà không phải rewrite giao
diện cùng lúc.

## Trạng thái

`backend/cmd/api` và `backend/cmd/worker` hiện đã có production path cho
auth, upload/job, profile/CV, KB, analyze, chat reply/proposal/apply, export PDF, parse CV và
keyword/semantic matching. Các CV thật trong `var/storage` đã được chạy qua
worker Go. Import review, import complete, job SSE (`progress/done/failed`),
analyze SSE (`report/done`) và proposal JSON Patch cũng đã khớp contract mà
frontend đang dùng.

Next chỉ còn phần UI; business API và worker production chạy bằng Go. PDFKit
Python được giữ như dependency tách text PDF. Không mở rộng legacy; mỗi luồng
mới phải có implementation và test ở Go trước.

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

### Chat memory và xác nhận đề xuất

- PostgreSQL là source of truth cho `chat_sessions` và `chat_messages`. Một
  profile chỉ dùng lại session gần nhất của đúng `userID + profileID`, nên
  lượt nhắn tiếp theo (ví dụ `OK`) không bị tách khỏi ngữ cảnh cũ.
- Redis lưu một bản cache tối đa 10 message gần nhất tại
  `chat:memory:{userID}:{sessionID}`, TTL 7 ngày. Cache mất không làm mất lịch
  sử dụng vì lịch sử vẫn đọc từ PostgreSQL.
- Khi frontend đang có proposal, các câu xác nhận chính xác `OK`, `Yes`,
  `Đồng ý`, `Xác nhận` (và biến thể không dấu) sẽ gọi endpoint proposal với
  toàn bộ operation. Không có proposal thì `OK` vẫn được gửi như một câu chat
  bình thường.

Frontend hiển thị nội dung assistant bằng Markdown/GFM, KaTeX và Mermaid
(`securityLevel: strict`); khung chat kế thừa theme CV và rộng 456px trên
desktop.


Go đã có production path với PostgreSQL và storage thật. Migration chưa hoàn
tất cho tới khi frontend đổi sang Go và các route/worker còn lại được chuyển.

## Còn lại cần chuyển

Các edge case còn phải hoàn tất trước khi xóa Node route là ownership/authorization
đầy đủ cho mọi read/mutation, retry/retention parity, export PDF qua Go và đối
soát staging. Go đã được khóa ownership theo session cho resource người dùng;
các gate còn lại phải được chạy trên staging bằng CUT-44 đến CUT-58 trước khi
tháo rollback route. `embed_profile` không nằm trong flow cutover hiện tại;
semantic matching đã có fallback degraded và LLM advice/reranker đã chạy trong
worker Go.

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
5. Các route Node cũ đã được xóa sau khi contract test, staging đối soát và
   rollback window đạt; Go là runtime nghiệp vụ duy nhất.

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

Đối soát read-only giữa snapshot trước cutover và staging:

```bash
./backend/scripts/reconcile-staging.sh \
  "$BASELINE_DATABASE_URL" "$STAGING_DATABASE_URL"
```

Script in count/checksum theo bảng; chỉ mismatch là phải dừng cutover và điều
tra, không tự sửa hoặc xóa dữ liệu.

Use case và gate trước khi Go làm backend chính nằm ở
[`GO_CUTOVER_USECASES.md`](GO_CUTOVER_USECASES.md) và
[`GO_CUTOVER_TESTCASES.md`](GO_CUTOVER_TESTCASES.md). Không chuyển 100% traffic
chỉ dựa trên việc image build thành công.

Frontend hiện luôn rewrite toàn bộ `/api/*` sang Go; Next chỉ render UI. Smoke
test đã xác nhận `/api/health`, magic-link request, upload/job và export đi qua
Go. Node API fallback đã được gỡ khỏi runtime.
