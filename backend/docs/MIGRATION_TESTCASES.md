# Test case migration Go backend

| ID | Scenario | Expected |
|---|---|---|
| MIG-API-01 | GET `/api/health` | 200, `ok=true`, service `backend-go` |
| MIG-API-02 | Upload thiếu file | 400, có `error` |
| MIG-API-03 | Upload file hợp lệ + uploadId A | 202, jobId A, status queued |
| MIG-API-04 | Upload lại cùng file + uploadId B | 202, jobId B khác A |
| MIG-API-05 | GET job tồn tại | 200, đúng jobId và status |
| MIG-API-06 | GET job không tồn tại | 404 |
| MIG-API-07 | Go backend không sẵn sàng | frontend không đánh dấu upload thành công |
| MIG-API-08 | Node route và Go route cùng input | response schema tương thích |
| MIG-AUTH-01 | Request magic link với email hợp lệ | 200, dev trả `devLink`, token được lưu dạng hash |
| MIG-AUTH-02 | Verify token hợp lệ hai lần | lần đầu tạo session/cookie, lần hai bị từ chối |
| MIG-PROFILE-01 | Tạo profile tiếng Anh | 201, `language=en`, dữ liệu không bị dịch |
| MIG-PROFILE-02 | Patch profile bằng RFC 6902 | 200, tạo revision mới |
| MIG-PROFILE-03 | Undo revision cuối | 200, profile quay về snapshot trước patch |
| MIG-CV-01 | Tạo CV thủ công | 201, tạo đồng thời profile và CV snapshot |
| MIG-CV-02 | GET/PATCH/DELETE CV | đúng snapshot, cập nhật metadata, xoá CV và profile |
| MIG-STRUCT-01 | Source root | chỉ còn README/config/env và metadata ẩn |
| MIG-STRUCT-02 | `go test ./...` | pass |

## Chạy

```bash
cd backend
go test ./...

# smoke test PostgreSQL + Docker backend
./scripts/build-go-image.sh
docker compose -f docker-compose.yml --env-file ../.env up -d --build backend
curl -fsS http://localhost:8080/api/health
```
