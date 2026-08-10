-- Immutable, CV-scoped history. A revision records the content and the
-- structured layout together, so a restore never mixes two saved versions.
CREATE TABLE cv_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_id              uuid NOT NULL REFERENCES cv_documents(id) ON DELETE CASCADE,
  revision_number    integer NOT NULL CHECK (revision_number > 0),
  profile_snapshot   jsonb NOT NULL,
  layout             jsonb NOT NULL,
  source             text NOT NULL CHECK (source IN ('user', 'ai', 'restore')),
  parent_revision_id uuid REFERENCES cv_revisions(id) ON DELETE RESTRICT,
  message            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cv_id, revision_number)
);

CREATE INDEX cv_revisions_newest_idx ON cv_revisions (cv_id, revision_number DESC);
