-- Preserve the user's explicit decline decisions alongside accepted proposal
-- indices. Settlement is an audit event only; it never writes a CV itself.
ALTER TABLE proposed_patches
  ADD COLUMN rejected_ops jsonb NOT NULL DEFAULT '[]';
