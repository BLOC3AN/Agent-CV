# Use case — Go làm backend duy nhất

Mục tiêu cuối cùng là toàn bộ business API và worker chạy bằng Go. Node/Next
chỉ còn UI; không dùng Node API hoặc Node worker làm runtime nghiệp vụ.

## UC-GO-01 — Đăng nhập và giữ session

1. Người dùng yêu cầu magic link.
2. Go lưu token hash, không lưu token thô.
3. Link hợp lệ tạo session trong PostgreSQL.
4. Link đã dùng/hết hạn không tạo session lần nữa.
5. Session phải tiếp tục hợp lệ sau khi restart Go; không có bước chuyển sang
   Node auth trong flow production.

## UC-GO-02 — Upload lại cùng một file

1. Go nhận file và tạo `uploadId` mới cho mỗi lượt.
2. Content hash chỉ dùng làm storage key.
3. Job key dùng `userId + uploadId`.
4. Hai lượt upload cùng nội dung tạo hai job độc lập.
5. Nếu worker chết, job còn trạng thái bền vững trong PostgreSQL và Go worker
   khác tiếp tục xử lý.

## UC-GO-03 — Chuyển profile/CV không mất dữ liệu

1. Go đọc profile JSON hiện tại.
2. Patch/revision/undo giữ nguyên JSON Pointer và language.
3. Snapshot CV không đổi khi profile gốc thay đổi.
4. So sánh số lượng và checksum bản ghi trước/sau cutover.
5. Mọi read/mutation đều đi qua Go và giữ nguyên HTTP contract v1.0.

## UC-GO-04 — Chuyển job bất đồng bộ không chạy trùng

1. Job cũ được đọc từ PostgreSQL.
2. Go worker claim job bằng điều kiện trạng thái nguyên tử.
3. Redis/worker restart không tạo thêm job cùng idempotency key.
4. Job `failed` được retry, job `cancelled` không được chạy lại.

## UC-GO-05 — Canary trước khi tắt fallback

1. Một phần traffic được gửi sang Go bằng feature flag.
2. Trong giai đoạn canary, lỗi 5xx/timeout phải dừng tăng traffic; fallback
   chỉ là biện pháp khẩn cấp trước khi Go được chứng nhận, không phải runtime
   bình thường.
3. Không chạy song song hai writer cho cùng một thao tác.
4. Sau khi ổn định, tăng dần 10% → 50% → 100%.

## UC-GO-06 — Rollback khẩn cấp trước khi Go-only

1. Dừng nhận request mới vào Go.
2. Chờ hoặc huỷ các job Go đang chạy theo chính sách.
3. Chuyển routing về Node chỉ khi có sự cố nghiêm trọng và có người phê duyệt.
4. Không rollback schema bằng cách xoá migration; chỉ rollback binary/routing.
5. Đối soát các job và revision phát sinh trong thời gian canary.

## UC-GO-07 — Trợ lý đề xuất và áp dụng thay đổi CV

1. Người dùng yêu cầu sửa CV; Go gửi hồ sơ và lịch sử vào model với JSON Schema
   bắt buộc.
2. Nếu chỉ hỏi, model trả `kind=reply`; hệ thống chỉ lưu tin nhắn, không sửa
   profile.
3. Nếu yêu cầu thay đổi, model trả `kind=patch`; Go validate JSON Patch theo
   `ProfileSchema`, lưu `proposed_patches` ở trạng thái `pending`, không ghi
   `profiles.data`.
4. Frontend hiển thị diff/proposal. Người dùng xác nhận thì gọi
   `/api/chat/proposals/:id` với các index được chọn.
5. Go kiểm tra ownership, lock profile, apply patch, tạo revision `ai`, settle
   proposal và trả profile mới. Nếu patch lỗi, profile và proposal không bị
   báo thành công giả.

## UC-GO-08 — Export PDF bằng Go

1. Người dùng gọi `GET /api/cv/:id/export?variant=presentation|ats`.
2. Go kiểm tra session và ownership của CV.
3. Go đọc `profile_snapshot`, `language` và `title` từ PostgreSQL.
4. Go render PDF tương ứng với variant, trả `application/pdf` và filename ổn
   định; không gọi Next, Playwright hoặc worker Node.
5. CV không tồn tại hoặc không thuộc user trả 404; lỗi render không tạo
   artifact giả và trả 5xx có thể theo dõi.

## UC-GO-09 — Go-only runtime

1. Middleware chuyển mọi `/api/*`, bao gồm export, tới Go.
2. Compose chỉ chạy Go API và Go worker cho nghiệp vụ; PDFKit chỉ là dependency
   tách text PDF nếu còn cần.
3. Tắt hoặc gỡ Node API/worker rollback route sau khi toàn bộ gate pass.
4. Smoke test kiểm tra không có request nghiệp vụ nào đi tới Next API route.

## UC-GO-10 — Bảo vệ PII trong job result

1. Go lưu hồ sơ đầy đủ trong `profiles.data`, được khóa theo `user_id`.
2. `jobs.result` chỉ chứa metadata cần cho UI: `profileId`, `language`,
   `quality`, `warnings` hoặc metric phân tích.
3. Không ghi tên, email, điện thoại, ngày sinh, text CV hoặc prompt/model
   payload vào `jobs.result`.
4. Job GET/SSE chỉ trả metadata và kết quả cần thiết; dữ liệu profile chỉ đọc
   qua resource đã kiểm tra ownership.
