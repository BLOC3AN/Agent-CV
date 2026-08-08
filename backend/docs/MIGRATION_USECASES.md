# Use case migration Go backend

## UC-MIG-01 — Health check backend Go

**Actor:** web/orchestrator

1. Gọi `GET /api/health`.
2. Backend trả HTTP 200 và `{"ok":true,"service":"backend-go"}`.
3. Monitoring đánh dấu backend sẵn sàng.

**Failure:** timeout hoặc status khác 200 → không chuyển traffic sang Go.

## UC-MIG-02 — Tạo job upload CV mới

**Actor:** người dùng

1. Frontend tạo `uploadId` mới cho mỗi lần chọn file.
2. Gọi `POST /api/uploads/cv` với multipart field `file` và `uploadId`.
3. Backend tạo job `parse_cv` với trạng thái `queued`.
4. Backend trả `202` và `jobId`.

**Business rule:** cùng một file nhưng khác `uploadId` là hai lượt xử lý độc lập.

## UC-MIG-03 — Theo dõi job

1. Frontend gọi `GET /api/jobs/{jobId}`.
2. Backend trả một trong `queued`, `running`, `done`, `failed`, `cancelled`.
3. Frontend không được hiển thị hoàn tất nếu chưa có `done` và kết quả hợp lệ.

## UC-MIG-04 — Rollback route

1. So sánh contract test Node và Go.
2. Nếu Go sai schema hoặc latency vượt ngưỡng, giữ route Node.
3. Chỉ xóa route Node sau khi Go pass integration test và canary.
