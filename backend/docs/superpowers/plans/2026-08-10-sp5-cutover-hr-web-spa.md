# SP-5 — Cutover thật sang `hr-web-spa` và xuất PDF từ CV thật

## Mục tiêu

Đưa `frontend/apps/web-spa` trở thành service production duy nhất ở cổng
`3000`, bỏ service/container `hr-web` (Next) khỏi stack mặc định, và chỉ giữ
Next trong profile rollback trong thời gian theo dõi. Mọi kiểm thử xuất bản
phải dùng PDF thật trong:

```text
/home/hailt/Desktop/HR-agent/var/storage/
```

Không dùng `mockData` hoặc một CV bịa để kết luận cutover đã thành công.

## Dữ liệu kiểm thử thật

Hiện có 7 PDF text-layer:

| File | Nhận diện | Cách dùng |
|---|---|---|
| `storage/b8/*.pdf` | Le Thanh Hai | parse, builder, presentation, ATS |
| `storage/c3/*.pdf` | Quan Pham | parse, export, ownership |
| `storage/cf/*.pdf` | Sơn Trịnh | parse, tiếng Anh, export |
| `storage/d9/*.pdf` | Y Yen Nhi | parse, tiếng Anh, export |
| `storage/68/*.pdf` | boarding pass | phải kết thúc `NO_CV_SECTIONS`, không tạo profile |
| `storage/63/*.pdf` | Aptis | phải kết thúc `NO_CV_SECTIONS`, không tạo profile |
| `storage/b7/*.pdf` | tài liệu database | phải kết thúc `NO_CV_SECTIONS`, không tạo profile |

`b8`, `c3`, `cf`, `d9` tương ứng các testcase REAL-CV-01…04 trong
`GO_CUTOVER_TESTCASES.md`. Ba file còn lại là negative fixtures, không được
đưa vào hồ sơ thật.

## Phân kỳ bắt buộc

### 1. Chốt service và đường lùi

- Đổi service production từ `web`/`hr-web` thành `web-spa`/`hr-web-spa`.
- SPA giữ `3000:3000`, `BACKEND_URL=http://backend:8080`, volume `uploads`.
- Next không chạy mặc định; chỉ còn `web-next-rollback` trong profile
  `rollback`, ánh xạ `3001:3000`.
- Cập nhật mọi lệnh smoke test, healthcheck, tài liệu và container name để
  không còn ngầm gọi `hr-web`.
- Không xoá `frontend/apps/web` ngay. Chỉ xoá sau khi rollback window đóng và
  toàn bộ gate CUT-50…CUT-59 xanh.

### 2. Snapshot và đường lùi dữ liệu

- Backfill `profiles.data_v2` và `cv_documents.snapshot_v2` trong cùng lượt,
  idempotent.
- Chạy `db:pair-check` và `db:roundtrip-check` trước cutover.
- Chụp count/checksum read-only của users, profiles, CV, jobs, revisions và
  matches.
- Rollback phải dựng lại `profiles.data` từ v2 và xoá/khôi phục snapshot v2
  theo cùng một transaction window; không thử rollback trực tiếp trên DB sống.
- Chỉ mở cửa sổ cutover khi snapshot staging có thể khôi phục.

### 3. Xuất bản bằng renderer chung

- `/print/:cvId?variant=presentation|ats|thumbnail` SSR bằng component trong
  `@hr/templates`, dữ liệu v2 của đúng owner.
- `ats`: một cột, không màu nền/icon/bảng, DOM đọc tuần tự.
- `thumbnail`: chỉ dùng để chụp thumbnail, không hiển thị như bản CV đầy đủ.
- Playwright mở `/print/:cvId`, chờ font/render ổn định rồi tạo PDF thật vào
  thư mục kiểm thử dưới `var/exports/` (không ghi đè `var/storage`).
- Kiểm tra PDF bằng `pdfinfo`, `pdftotext` và screenshot: tên, email, section,
  ngôn ngữ và thứ tự nội dung phải đúng; không còn JSON hồ sơ trên giấy.
- Export của user khác/ID không tồn tại phải 401/404, không tạo artifact.

### 4. Gỡ đường AI/Next cũ sau khi SPA đã thay thế

- SPA chỉ dùng `/api/chat`, `/api/analyze`, `/api/kb`; không gọi
  `/api/ai/chat`, `/api/ai/quick-action`, `/api/ai/match-job`.
- Sau khi kiểm tra không còn consumer, xoá compat AI và test contract tương ứng.
- Port các flow còn thiếu của SP-5: guided flow, i18n vi/en và KB curator.
- Giữ `frontend/apps/web` nguyên trạng trong giai đoạn canary; chỉ xoá ở bước
  dọn dẹp sau cùng.

## Gate kiểm thử với PDF thật

Trước cutover:

```bash
cd frontend
npm run typecheck
npm test
npm run db:pair-check
npm run db:roundtrip-check

cd ../backend
go test ./...
go vet ./...
test -z "$(gofmt -l ./cmd ./internal)"
```

Sau đó chạy:

- REAL-CV-01…04: import → review → builder → print presentation/ATS.
- REAL-CV-05: ba PDF âm tính không tạo profile.
- CUT-03, CUT-08…10, CUT-20, CUT-25…36, CUT-42…59.
- `curl -fsS http://localhost:3000/api/health` phải đi qua SPA và Go.
- `docker compose -f backend/docker-compose.yml --profile rollback config`
  phải hiển thị được cả SPA production và target rollback mà không chiếm cùng
  cổng.

## Trình tự triển khai và rollback

1. Build/test SPA trên `3002` nếu cần debug, không đổi DB production.
2. Chạy staging với service `web-spa` ở `3000`, Next rollback ở `3001`.
3. Chạy toàn bộ gate và đối soát checksum.
4. Dừng ghi, chạy backfill snapshot v2, xác nhận `24/24` và checksum.
5. Mở ghi qua `hr-web-spa`; theo dõi health, auth, import, chat, analyze,
   proposal và export.
6. Nếu lỗi, dừng ghi, chạy rollback v2→v1 đã golden-test, bật profile Next ở
   `3001`, trỏ traffic về Next; không xoá artifact hoặc DB cũ trong cửa sổ này.
7. Chỉ sau thời gian ổn định mới xoá `hr-web-next-rollback`, `apps/web` và
   các package renderer cũ không còn consumer.

## Trạng thái hiện tại

SP-5 đã có commit nền tảng `e1a05f2`: SSR print, biến thể ATS/thumbnail,
`snapshot_v2` trong backfill và compose scaffold. Service production vẫn cần
đổi tên rõ thành `web-spa`/`hr-web-spa`, sau đó mới thực hiện Playwright và
cutover theo các gate trên.
