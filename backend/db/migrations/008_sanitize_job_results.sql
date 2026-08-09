-- Remove CV content accidentally duplicated in historical job results.
-- profiles.data remains the source of truth; jobs.result is an API-visible
-- status payload and must contain metadata only.

UPDATE jobs
SET result = CASE
  WHEN kind = 'parse_cv' THEN jsonb_build_object(
    'profileId', result->'profileId',
    'language', result->'language',
    'quality', result->'quality'
  )
  WHEN kind = 'match_analysis' THEN jsonb_build_object(
    'matchId', result->'matchId',
    'overall', result->'overall',
    'degraded', result->'degraded'
  )
  ELSE result
END
WHERE status = 'done'
  AND result IS NOT NULL
  AND kind IN ('parse_cv', 'match_analysis');
