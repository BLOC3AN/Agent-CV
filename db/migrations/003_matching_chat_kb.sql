-- M3 + M4 + M5 — TDD §7 (lược đồ), §8.2, §8.3, §10.
--
-- Gộp ba nhóm bảng vào một migration vì chúng tham chiếu lẫn nhau:
-- `chat_sessions.jd_id` → `job_descriptions`, `match_analyses` cần cả hai.
-- Tách ra thì thứ tự chạy trở thành ràng buộc ngầm, dễ sai khi dựng lại từ đầu.

-- ── Kết quả đối chiếu JD ───────────────────────────────────────────────────
CREATE TABLE match_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id       uuid NOT NULL REFERENCES cv_documents(id) ON DELETE CASCADE,
  jd_id       uuid NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  -- Ảnh chụp bản sửa CV tại thời điểm phân tích. BR-42.4 cache theo
  -- (cv_revision, jd_id): sửa CV xong phải phân tích LẠI, không dùng kết quả cũ.
  revision_id bigint REFERENCES profile_revisions(id),
  score       jsonb NOT NULL,
  matched     jsonb NOT NULL DEFAULT '[]',
  gaps        jsonb NOT NULL DEFAULT '[]',
  citations   jsonb NOT NULL DEFAULT '[]',
  model_used  text,
  -- Lớp ngữ nghĩa có bị tắt không (embedder chết) — hiển thị cho user biết
  degraded    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_cv_idx ON match_analyses (cv_id, created_at DESC);
CREATE UNIQUE INDEX match_cache_idx ON match_analyses (cv_id, jd_id, revision_id);

-- ── Chat & patch ───────────────────────────────────────────────────────────
CREATE TABLE chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  jd_id       uuid REFERENCES job_descriptions(id) ON DELETE SET NULL,
  title       text,
  -- §6.4 bước 3: lịch sử dài quá ngân sách 12.000 token thì nén phần cũ
  compacted_summary         text,
  compacted_upto_message_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_profile_idx ON chat_sessions (profile_id, updated_at DESC);

CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','assistant','system')),
  content     text NOT NULL,
  token_count int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_idx ON chat_messages (session_id, created_at);

CREATE TABLE proposed_patches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  ops         jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','rejected','partial')),
  applied_ops jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patches_message_idx ON proposed_patches (message_id);

-- ── Knowledge Base ─────────────────────────────────────────────────────────
CREATE TABLE kb_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  -- BẮT BUỘC: mọi lời khuyên phải trích dẫn được về một người thật (§10.4).
  -- Không có tên tác giả thì không hiện được "Theo [Tên] — [Chức danh]".
  author_name  text NOT NULL,
  author_title text,
  file_key     text,
  language     text NOT NULL DEFAULT 'vi',
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','pending_review','active','archived')),
  version      int  NOT NULL DEFAULT 1,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('guideline','exemplar','red_flag','clarifying_question')),
  text         text NOT NULL,
  breadcrumb   text,
  -- Mảng chứ không phải một giá trị: một hướng dẫn thường áp dụng cho nhiều
  -- ngành/cấp bậc. Lọc bằng toán tử `&&` của Postgres, không cần bảng nối.
  industry     text[] NOT NULL DEFAULT '{}',
  role_family  text[] NOT NULL DEFAULT '{}',
  seniority    text[] NOT NULL DEFAULT '{}',
  section      text[] NOT NULL DEFAULT '{}',
  language     text NOT NULL DEFAULT 'vi',
  token_count  int,
  -- Dùng khi phải cắt bớt cho vừa ngân sách (§6.4) — giữ đoạn quan trọng trước
  priority     int NOT NULL DEFAULT 50,
  embedding    vector(1024),
  tsv          tsvector,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- GIN cho mảng: `WHERE industry && ARRAY['it_software']` là truy vấn chính
CREATE INDEX kb_industry_idx    ON kb_chunks USING gin (industry);
CREATE INDEX kb_role_idx        ON kb_chunks USING gin (role_family);
CREATE INDEX kb_seniority_idx   ON kb_chunks USING gin (seniority);
CREATE INDEX kb_section_idx     ON kb_chunks USING gin (section);
CREATE INDEX kb_tsv_idx         ON kb_chunks USING gin (tsv);
CREATE INDEX kb_source_idx      ON kb_chunks (source_id);

-- Chỉ mục vector CHỈ trên hàng đã có embedding. Giai đoạn 1 chưa nhúng KB
-- (chọn bằng SQL filter là đủ — §10.2), nên phần lớn hàng còn NULL.
CREATE INDEX kb_embedding_idx ON kb_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- tsvector tự cập nhật. Dùng cấu hình 'simple': Postgres không có bộ tách từ
-- tiếng Việt, và 'english' sẽ cắt gốc sai trên chữ Việt.
CREATE OR REPLACE FUNCTION kb_chunks_tsv() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', coalesce(NEW.text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_chunks_tsv_trg
  BEFORE INSERT OR UPDATE OF text ON kb_chunks
  FOR EACH ROW EXECUTE FUNCTION kb_chunks_tsv();

CREATE TRIGGER chat_sessions_touch
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
