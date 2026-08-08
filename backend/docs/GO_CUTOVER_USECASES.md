# Use case — Go làm backend chính

Tài liệu này mô tả giai đoạn cutover, không chỉ việc build binary.

## UC-GO-01 — Đăng nhập và giữ session

1. Người dùng yêu cầu magic link.
2. Go lưu token hash, không lưu token thô.
3. Link hợp lệ tạo session trong PostgreSQL.
4. Link đã dùng/hết hạn không tạo session lần nữa.
5. Rollback: bật lại Node auth và giữ nguyên bảng `sessions`.

## UC-GO-02 — Upload lại cùng một file

1. Go nhận file và tạo `uploadId` mới cho mỗi lượt.
2. Content hash chỉ dùng làm storage key.
3. Job key dùng `userId + uploadId`.
4. Hai lượt upload cùng nội dung tạo hai job độc lập.
5. Nếu worker chết, job còn trạng thái bền vững trong PostgreSQL.

## UC-GO-03 — Chuyển profile/CV không mất dữ liệu

1. Go đọc profile JSON hiện tại.
2. Patch/revision/undo giữ nguyên JSON Pointer và language.
3. Snapshot CV không đổi khi profile gốc thay đổi.
4. So sánh số lượng và checksum bản ghi trước/sau cutover.

## UC-GO-04 — Chuyển job bất đồng bộ không chạy trùng

1. Job cũ được đọc từ PostgreSQL.
2. Go worker claim job bằng điều kiện trạng thái nguyên tử.
3. Redis/worker restart không tạo thêm job cùng idempotency key.
4. Job `failed` được retry, job `cancelled` không được chạy lại.

## UC-GO-05 — Fallback trong lúc canary

1. Một phần traffic được gửi sang Go bằng feature flag.
2. Lỗi 5xx/timeout vượt ngưỡng sẽ tự chuyển traffic về Node.
3. Không chạy song song hai writer cho cùng một thao tác.
4. Sau khi ổn định, tăng dần 10% → 50% → 100%.

## UC-GO-06 — Rollback

1. Dừng nhận request mới vào Go.
2. Chờ hoặc huỷ các job Go đang chạy theo chính sách.
3. Chuyển routing về Node.
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
