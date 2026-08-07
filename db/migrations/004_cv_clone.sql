-- Bản CV nhân bản theo JD — UC-33, TDD §8.5 (quyết định D12).
--
-- `cloned_from` cần cho BR-33.2: dán lại CÙNG một JD phải mở bản đã tạo, không
-- sinh bản thứ hai. Không có cột này thì không phân biệt được "bản cho JD-A tạo
-- từ CV gốc" với "bản cho JD-A tạo từ một bản sao khác".
ALTER TABLE cv_documents
  ADD COLUMN cloned_from uuid REFERENCES cv_documents(id) ON DELETE SET NULL;

CREATE INDEX cv_clone_idx ON cv_documents (jd_id, cloned_from)
  WHERE jd_id IS NOT NULL;
