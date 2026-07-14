#!/usr/bin/env bash
# test.sh — Test-environment Docker Compose helper (chat-test.memodo.de)
#
# Mirrors prod.sh, then layers docker-compose.test.yml on top. Builds the api
# from source (docker-compose.prod.yml) and applies the test app-config overlay.
# Contains no secrets — safe to commit.
#
# Usage:
#   ./test.sh build api      # Build the from-source image (Node 24)
#   ./test.sh up -d          # Start the test stack
#   ./test.sh down           # Stop the test stack
#   ./test.sh logs -f api    # Follow API logs
#   ./test.sh ps             # List running services
#
# File merge order:
#   1. docker-compose.yml          — base service definitions
#   2. docker-compose.override.yml — networks, minio, librechat.yaml mount, from-source build
#   3. docker-compose.prod.yml     — production hardening / limits / from-source build
#   4. docker-compose.test.yml     — test overlay (.env.test app-config overrides)
#
# Secrets/DB creds come from the clone's .env.prod (interpolation + the /app/.env
# mount); .env.test (loaded via env_file in the test overlay) layers the test-only
# app config (domain, local login, SSO off) on top.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# UID is a bash readonly built-in; GID is not. Mirror prod.sh.
export UID
export GID="${GID:-$(id -g)}"

# Build metadata surfaced in Settings -> About for support triage. Resolved on the
# host (the container image ships no .git — .dockerignore excludes it) and passed to
# the api service via compose interpolation. Guarded with `|| true` so a missing git
# repo never aborts the deploy under `set -e`; empty values fall through cleanly.
export BUILD_COMMIT="$(git -C "${SCRIPT_DIR}" rev-parse HEAD 2>/dev/null || true)"
export BUILD_BRANCH="$(git -C "${SCRIPT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
export BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

exec docker compose \
  -f "${SCRIPT_DIR}/docker-compose.yml" \
  -f "${SCRIPT_DIR}/docker-compose.override.yml" \
  -f "${SCRIPT_DIR}/docker-compose.prod.yml" \
  -f "${SCRIPT_DIR}/docker-compose.test.yml" \
  --env-file "${SCRIPT_DIR}/.env.prod" \
  "$@"
