-- SP-5 production cutover: v2 becomes the only stored CV representation.
-- This migration is intentionally irreversible.  Run pair/roundtrip checks
-- and take the database backup before applying it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='data_v2') THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE data_v2 IS NULL) THEN
      RAISE EXCEPTION 'cannot cut over: profiles.data_v2 still has NULL rows';
    END IF;
    IF EXISTS (SELECT 1 FROM cv_documents WHERE snapshot_v2 IS NULL) THEN
      RAISE EXCEPTION 'cannot cut over: cv_documents.snapshot_v2 still has NULL rows';
    END IF;

    ALTER TABLE profiles DROP COLUMN data;
    ALTER TABLE profiles RENAME COLUMN data_v2 TO data;
    ALTER TABLE profiles ALTER COLUMN data SET NOT NULL;
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_data_v2_version_chk;
    ALTER TABLE profiles ADD CONSTRAINT profiles_data_version_chk
      CHECK (data ? 'schemaVersion' AND data->>'schemaVersion' = '2');

    DROP INDEX IF EXISTS profiles_v2_ready_idx;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cv_documents' AND column_name='snapshot_v2') THEN
    ALTER TABLE cv_documents DROP COLUMN profile_snapshot;
    ALTER TABLE cv_documents RENAME COLUMN snapshot_v2 TO profile_snapshot;
    ALTER TABLE cv_documents ALTER COLUMN profile_snapshot SET NOT NULL;
  END IF;
END $$;
