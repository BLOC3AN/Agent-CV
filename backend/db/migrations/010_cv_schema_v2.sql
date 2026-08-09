-- CV schema v2 — spec 2026-08-09 §2.4.
--
-- CHỈ THÊM, không sửa và không xoá gì. `apps/web` đọc `profiles.data` theo v1
-- và phải phục vụ production tới SP-5; đổi tại chỗ là làm chết nó ngay.
--
-- SP-5 lật công tắc: đổi tên `data_v2` thành `data` và bỏ cột cũ. Tới lúc đó
-- mới xoá, không sớm hơn.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS data_v2 jsonb;

ALTER TABLE cv_documents
  ADD COLUMN IF NOT EXISTS snapshot_v2 jsonb;

-- Chỉ đánh index phần đã backfill: giai đoạn chuyển tiếp phần lớn hàng còn NULL.
CREATE INDEX IF NOT EXISTS profiles_v2_ready_idx
  ON profiles (id) WHERE data_v2 IS NOT NULL;

-- Hàng nào có data_v2 thì bắt buộc đúng phiên bản. Chặn ngay tại tầng lưu trữ,
-- không đợi tầng ứng dụng phát hiện.
ALTER TABLE profiles
  ADD CONSTRAINT profiles_data_v2_version_chk
  CHECK (data_v2 IS NULL OR (data_v2->>'schemaVersion') = '2');
