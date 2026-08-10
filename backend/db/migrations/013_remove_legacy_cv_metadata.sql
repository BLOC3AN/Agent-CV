-- SP-5 final cleanup: V2 no longer carries conversion metadata.
-- The production document is already V2-only; remove the last fields that
-- existed solely to reconstruct the retired representation.

UPDATE profiles
SET data = data - '_meta' || jsonb_build_object(
  '_meta', COALESCE(data->'_meta', '{}'::jsonb) - 'originalLinks' - 'droppedFields'
)
WHERE data ? '_meta'
  AND ((data->'_meta') ? 'originalLinks' OR (data->'_meta') ? 'droppedFields');

UPDATE cv_documents
SET profile_snapshot = profile_snapshot - '_meta' || jsonb_build_object(
  '_meta', COALESCE(profile_snapshot->'_meta', '{}'::jsonb) - 'originalLinks' - 'droppedFields'
)
WHERE profile_snapshot ? '_meta'
  AND ((profile_snapshot->'_meta') ? 'originalLinks' OR (profile_snapshot->'_meta') ? 'droppedFields');
