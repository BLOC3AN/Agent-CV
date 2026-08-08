#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 BASELINE_DATABASE_URL STAGING_DATABASE_URL" >&2
  exit 2
fi

baseline="$1"
staging="$2"
tables=(users profiles cv_documents jobs profile_revisions match_analyses)

echo "table|baseline_count|staging_count|baseline_checksum|staging_checksum"
for table in "${tables[@]}"; do
  case "$table" in
    users) order="id,email" ;;
    profiles) order="id,user_id,data" ;;
    cv_documents) order="id,user_id,profile_id,profile_snapshot,language" ;;
    jobs) order="id,user_id,kind,status,payload,result,error,attempts" ;;
    profile_revisions) order="id,profile_id,patch,inverse,author" ;;
    match_analyses) order="id,cv_id,jd_id,score,matched,gaps,degraded" ;;
  esac
  query="SELECT count(*)::text || '|' || COALESCE(md5(string_agg(row_to_json(t)::text, '' ORDER BY ${order})), 'EMPTY') FROM ${table} t"
  left=$(psql "$baseline" -Atc "$query")
  right=$(psql "$staging" -Atc "$query")
  IFS='|' read -r left_count left_hash <<< "$left"
  IFS='|' read -r right_count right_hash <<< "$right"
  printf '%s|%s|%s|%s|%s\n' "$table" "$left_count" "$right_count" "$left_hash" "$right_hash"
done

echo
echo "Interpretation: counts/checksums must match for an in-place cutover."
echo "A mismatch is a review gate; this script never writes either database."
