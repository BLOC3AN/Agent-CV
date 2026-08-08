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
| MIG-STRUCT-01 | Source root | chỉ còn README/config/env và metadata ẩn |
| MIG-STRUCT-02 | `go test ./...` | pass |

## Chạy

```bash
cd backend
go test ./...
```
