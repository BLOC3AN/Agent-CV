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
