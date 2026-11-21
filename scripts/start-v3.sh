#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
if [[ "$(node --version)" != "v${EXPECTED_NODE_VERSION}" ]]; then
  echo "V3 requires Node v${EXPECTED_NODE_VERSION}; select the pinned runtime before starting." >&2
  exit 1
fi
if [[ -z "${V3_DATABASE_URL:-}" ]]; then
  if [[ "${V3_USE_PROJECT_DATABASE:-}" != "true" || -z "${DATABASE_URL:-}" ]]; then
    echo "V3_DATABASE_URL is required unless V3_USE_PROJECT_DATABASE=true." >&2
    exit 1
  fi
  export V3_DATABASE_URL="$DATABASE_URL"
fi
export PORT="${PORT:-5000}"
export V3_WORKER_HEALTH_PORT="${V3_WORKER_HEALTH_PORT:-3001}"
export V3_API_DB_POOL_MAX="${V3_API_DB_POOL_MAX:-3}"
export V3_WORKER_DB_POOL_MAX="${V3_WORKER_DB_POOL_MAX:-2}"
exec process-compose --config process-compose.yaml --disable-dotenv --no-server \
  --ordered-shutdown up --tui=false
