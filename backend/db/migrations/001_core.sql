-- HR-Agent — schema lõi. TDD §7.2.
-- Chạy: npm run db:migrate

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ── Người dùng ──────────────────────────────────────────────────────────────
CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext UNIQUE NOT NULL,           -- BR-11.1 không phân biệt hoa/thường
  locale     text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- ── Profile: nguồn sự thật duy nhất (TDD A2) ────────────────────────────────
CREATE TABLE profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data           jsonb NOT NULL,
  schema_version int  NOT NULL DEFAULT 1,
  language       text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi', 'en')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_user_idx ON profiles (user_id);

-- Lịch sử dạng PATCH, không snapshot đầy đủ → nhẹ, và dựng lại được mọi thời điểm.
-- `author` phân biệt thay đổi của người và của AI (UC-54, BR-54.1).
CREATE TABLE profile_revisions (
  id          bigserial PRIMARY KEY,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  patch       jsonb NOT NULL,                  -- RFC 6902
  inverse     jsonb NOT NULL DEFAULT '[]',     -- patch nghịch đảo → undo O(1)
  author      text NOT NULL CHECK (author IN ('user', 'ai', 'import')),
  message_id  uuid,                            -- truy vết về lượt chat nào
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_revisions_profile_idx ON profile_revisions (profile_id, id DESC);

-- ── JD ──────────────────────────────────────────────────────────────────────
CREATE TABLE job_descriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  raw_text     text NOT NULL,
  source_url   text,
  language     text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi', 'en')),
  requirements jsonb,
  industry     text,
  role_family  text,
  seniority    text,
  embedding    vector(1024),                   -- bge-m3 dense
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jd_user_idx ON job_descriptions (user_id);

-- ── CV = snapshot Profile + cách trình bày ──────────────────────────────────
CREATE TABLE cv_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Snapshot để CV đã xuất không đổi khi Profile thay đổi sau đó
  profile_snapshot jsonb NOT NULL,
  revision_id      bigint REFERENCES profile_revisions(id),
  template_id      text  NOT NULL DEFAULT 'elegant',
  theme            jsonb NOT NULL DEFAULT '{}',
  layout           jsonb NOT NULL DEFAULT '{}', -- CẤU TRÚC, không phải toạ độ (TDD A2)
  jd_id            uuid REFERENCES job_descriptions(id) ON DELETE SET NULL,
  language         text  NOT NULL DEFAULT 'vi',
  title            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cv_user_idx ON cv_documents (user_id, updated_at DESC);

CREATE TABLE export_artifacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id      uuid NOT NULL REFERENCES cv_documents(id) ON DELETE CASCADE,
  variant    text NOT NULL CHECK (variant IN ('presentation', 'ats')),
  file_key   text NOT NULL,
  bytes      int,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Job bất đồng bộ ─────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  -- BR-72.1: cùng input → cùng job, không xử lý lại
  idempotency_key text UNIQUE NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed','cancelled')),
  payload         jsonb NOT NULL DEFAULT '{}',
  result          jsonb,
  error           text,
  attempts        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX jobs_status_idx ON jobs (status, created_at);
CREATE INDEX jobs_user_idx ON jobs (user_id, created_at DESC);

-- ── Telemetry ───────────────────────────────────────────────────────────────
-- TDD §15.2 R6: KHÔNG lưu nội dung prompt/response, chỉ metric.
CREATE TABLE llm_calls (
  id                bigserial PRIMARY KEY,
  task              text NOT NULL,
  provider          text NOT NULL,
  model             text NOT NULL,
  latency_ms        int,
  prompt_tokens     int,
  completion_tokens int,
  schema_valid      boolean,
  attempts          int,
  escalated         boolean,
  truncated         boolean,
  error_code        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_task_idx ON llm_calls (task, created_at DESC);

-- ── updated_at tự động ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER cv_touch BEFORE UPDATE ON cv_documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
