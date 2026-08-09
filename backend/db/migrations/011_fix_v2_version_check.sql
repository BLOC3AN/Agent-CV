-- Vá lỗ hổng của constraint thêm ở 010: 010 đã apply và ghi vào
-- schema_migrations rồi, không sửa lại file đó — sửa bằng migration mới.
--
-- `data_v2 ->> 'schemaVersion'` trả về NULL khi key không tồn tại (ví dụ
-- `data_v2 = '{}'`), không phải lỗi. Điều kiện cũ là
--   data_v2 IS NULL OR (data_v2->>'schemaVersion') = '2'
-- và `FALSE OR NULL` trong SQL là NULL — CHECK coi NULL là "chấp nhận", không
-- phải "từ chối". Nghĩa là `data_v2 = '{}'` (thiếu hẳn schemaVersion) lọt qua
-- constraint dù rõ ràng không phải v2 hợp lệ — đúng thứ constraint này được
-- thêm vào để chặn.
--
-- Sửa bằng cách đòi hỏi tường minh key phải TỒN TẠI (`?` operator) trước khi
-- so sánh giá trị, để `{}` bị từ chối thay vì lọt qua như NULL.
ALTER TABLE profiles
  DROP CONSTRAINT profiles_data_v2_version_chk;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_data_v2_version_chk
  CHECK (data_v2 IS NULL OR (data_v2 ? 'schemaVersion' AND data_v2->>'schemaVersion' = '2'));
