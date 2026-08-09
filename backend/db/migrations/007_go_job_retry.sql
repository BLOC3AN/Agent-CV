-- Retry scheduling for the Go worker. Keeping the next eligible time in
-- Postgres makes retries safe across worker restarts too.
ALTER TABLE jobs ADD COLUMN retry_at timestamptz;
CREATE INDEX jobs_retry_idx ON jobs (status, retry_at, created_at)
  WHERE status = 'queued';
