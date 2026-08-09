-- CV field naming: `basics.summary` is now `basics.introduce`.
-- Keep proposal/chat summaries unchanged; this migration only touches profiles.
UPDATE profiles
SET data = (data #- '{basics,summary}') ||
           jsonb_build_object(
             'basics',
             (data->'basics') || jsonb_build_object('introduce', data #> '{basics,summary}')
           )
WHERE data #> '{basics,summary}' IS NOT NULL
  AND data #> '{basics,introduce}' IS NULL;
