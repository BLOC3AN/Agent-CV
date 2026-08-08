#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

# The container builder in this workstation cannot resolve registry DNS.
# The default Docker builder can, and is also the normal CI path.
export BUILDX_BUILDER=${BUILDX_BUILDER:-default}
docker compose -f backend/docker-compose.yml --env-file .env --profile full build "$@"
