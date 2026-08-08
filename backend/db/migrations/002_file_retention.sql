-- Xoá file gốc sau 48 giờ — TDD §15.2 R3, TC-SEC-05.
--
-- Vì sao cần một cột riêng thay vì suy từ `created_at`:
-- job đã dọn file và job chưa tới hạn đều không có gì phân biệt được ở bảng
-- hiện tại, nên mỗi lần chạy dọn dẹp sẽ thử xoá lại toàn bộ job cũ. Cột này
-- làm việc dọn dẹp trở nên idempotent và cho biết CHÍNH XÁC khi nào file biến
-- mất — thông tin mà màn hình rà soát cần để giải thích cho user.

ALTER TABLE jobs ADD COLUMN file_purged_at timestamptz;

-- Chỉ index phần chưa dọn: bảng jobs lớn dần theo thời gian nhưng số job cần
-- dọn ở mỗi lượt luôn nhỏ.
CREATE INDEX jobs_purge_idx ON jobs (created_at)
  WHERE file_purged_at IS NULL;
