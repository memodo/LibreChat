#!/usr/bin/env bash
# prod.sh — Production Docker Compose helper (REQ-002)
#
# Wraps `docker compose` with the correct file merge order and production env file.
# Contains no secrets — safe to commit to version control.
#
# Usage:
#   ./prod.sh up -d          # Start all services in production mode
#   ./prod.sh down            # Stop all services
#   ./prod.sh restart api     # Restart a single service
#   ./prod.sh logs -f api     # Follow API logs
#   ./prod.sh ps              # List running services
#
# File merge order:
#   1. docker-compose.yml          — base service definitions
#   2. docker-compose.override.yml — dev overrides (networks, minio, librechat.yaml mount)
#   3. docker-compose.prod.yml     — production overrides (images, health checks, limits, auth)
#
# When -f flags are used, override.yml is NOT auto-loaded, so we list it explicitly.
# Production settings in docker-compose.prod.yml take precedence over dev overrides.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec docker compose \
  -f "${SCRIPT_DIR}/docker-compose.yml" \
  -f "${SCRIPT_DIR}/docker-compose.override.yml" \
  -f "${SCRIPT_DIR}/docker-compose.prod.yml" \
  --env-file "${SCRIPT_DIR}/.env.prod" \
  "$@"
