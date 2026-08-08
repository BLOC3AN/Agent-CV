-- HR-Agent — khởi tạo extension (TDD §7.2)
-- Chạy tự động khi container postgres tạo volume lần đầu.

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector: embedding bge-m3 1024 chiều
CREATE EXTENSION IF NOT EXISTS citext;   -- email không phân biệt hoa/thường (BR-11.1)
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Kiểm chứng nhanh: chiều vector phải khớp embedder (TC-INT-04)
DO $$
BEGIN
  PERFORM '[1,2,3]'::vector;
  RAISE NOTICE 'pgvector sẵn sàng';
END $$;
