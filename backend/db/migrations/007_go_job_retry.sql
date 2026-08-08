-- Retry scheduling for the Go worker.  The Node/BullMQ worker uses exponential
-- backoff; keeping the next eligible time in Postgres makes the Go path safe
-- across worker restarts too.
ALTER TABLE jobs ADD COLUMN retry_at timestamptz;
CREATE INDEX jobs_retry_idx ON jobs (status, retry_at, created_at)
  WHERE status = 'queued';
