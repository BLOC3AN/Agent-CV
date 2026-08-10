-- Bind a proposal to the exact CV draft that produced it. These columns stay
-- nullable for proposals created before Task 6; the new API rejects such rows
-- safely instead of settling them against a different document.
ALTER TABLE proposed_patches
  ADD COLUMN cv_id uuid REFERENCES cv_documents(id) ON DELETE CASCADE,
  ADD COLUMN draft_token text,
  ADD COLUMN profile_snapshot jsonb,
  ADD COLUMN layout_snapshot jsonb;

CREATE INDEX proposed_patches_cv_idx ON proposed_patches (cv_id, created_at DESC);
