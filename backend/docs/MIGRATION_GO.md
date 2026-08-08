# Migration backend sang Go

## Mục tiêu

Backend mới nằm ở `backend/`, frontend nằm ở `frontend/`. API Go giữ contract
HTTP ổn định để frontend có thể chuyển từng route mà không phải rewrite giao
diện cùng lúc.

## Trạng thái

`backend/cmd/api` hiện là vertical slice đầu tiên: health và upload job. Nó dùng
`uploadId` riêng cho mỗi lượt upload, vì cùng một file không đồng nghĩa với
dùng lại kết quả cũ.

Phần Node cũ được giữ tạm trong `frontend/services/worker` và các package dùng
chung để bảo toàn chức năng trong giai đoạn chuyển tiếp. Không mở rộng phần
legacy; mỗi luồng mới phải có implementation và test ở Go trước.

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
```
