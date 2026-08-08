-- Khoá ổn định cho nguồn tri thức — UC-61.
--
-- `kb_sources` chỉ có khoá chính sinh tự động, nên nạp lại cùng một file YAML
-- sẽ tạo nguồn thứ hai, và cả hai cùng xuất hiện trong lời khuyên. `slug` lấy
-- từ `source.id` trong file, do người viết KB đặt và giữ nguyên qua các lần sửa.
ALTER TABLE kb_sources ADD COLUMN slug text;

UPDATE kb_sources SET slug = id::text WHERE slug IS NULL;

ALTER TABLE kb_sources
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT kb_sources_slug_key UNIQUE (slug);
