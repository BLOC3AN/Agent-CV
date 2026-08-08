# Testcase — Go cutover

## Gate bắt buộc trước khi tắt Node

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| CUT-01 | `go test ./...` | Pass, không test flaky |
| CUT-02 | Frontend typecheck/build | Pass |
| CUT-03 | Auth request → verify → logout | Session tạo/xoá đúng; token dùng lại bị từ chối |
| CUT-04 | Upload cùng PDF hai lần với hai `uploadId` | Hai job ID khác nhau; storage không ghi đè sai |
| CUT-05 | Upload PDF sai magic bytes | 415; không tạo job |
| CUT-06 | Upload vượt 12 MB | 413; không tạo job |
| CUT-07 | Job GET/DELETE/SSE | Trạng thái queued → cancelled hoặc terminal đúng contract |
| CUT-08 | Profile create/get | JSON và `language` giữ nguyên |
| CUT-09 | Profile patch/revision/undo | Dữ liệu quay đúng snapshot trước patch |
| CUT-10 | CV create/get/patch/delete | Snapshot, metadata và cascade xoá đúng |
| CUT-11 | Restart Go container giữa job | Job không mất trong PostgreSQL |
| CUT-12 | Redis restart | Không tạo job trùng; hệ thống báo queued/degraded rõ ràng |
| CUT-13 | Model server timeout | Job failed có mã lỗi; không kẹt running vô hạn |
| CUT-14 | PDF không có text layer | Chuyển đúng nhánh OCR/manual, không dịch CV ngoài ý muốn |
| CUT-15 | CV tiếng Anh | Prompt/result giữ `language=en`, không tự dịch sang tiếng Việt |
| CUT-16 | Patch AI chứa field cấm/PII | Bị reject, profile không đổi |
| CUT-17 | Hai request patch đồng thời | Không mất update; revision order xác định |
| CUT-18 | Canary lỗi 5xx/timeout | Routing fallback về Node, không mất session/job |
| CUT-19 | Rollback sau khi có job đang chạy | Không có job chạy song song hoặc bị tạo bản sao |
| CUT-20 | Đối soát dữ liệu sau cutover | Count/checksum profiles, CV, jobs, revisions khớp trước cutover |

## Lệnh kiểm tra tối thiểu

```bash
cd backend
go test ./...
./scripts/build-go-image.sh
cd ..
BUILDX_BUILDER=default ./backend/scripts/build-all.sh
docker compose -f backend/docker-compose.yml --env-file .env config --quiet
curl -fsS http://localhost:8080/api/health
```

Không tắt Node chỉ vì các lệnh build pass; phải chạy hết CUT-03 đến CUT-20
trên database staging hoặc bản snapshot có thể khôi phục.
