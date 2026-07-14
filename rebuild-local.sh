#!/bin/bash
# Rebuild every LibreChat workspace whose dist/ is bind-mounted into the
# container, and restart Docker so the fresh dist/ dirs are picked up. Use
# after editing any source under packages/*/src/ or client/src/.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Stop containers ==="
docker compose down

echo ""
echo "=== Smart-reinstall (install if lockfile changed, Turborepo build) ==="
npm run smart-reinstall

echo ""
# Build metadata for Settings -> About (support triage), for local parity with
# prod.sh/test.sh. Resolved from the host repo; guarded so a missing repo can't
# abort under `set -e`. docker-compose.override.yml consumes these via ${VAR:-}.
export BUILD_COMMIT="$(git -C "${SCRIPT_DIR}" rev-parse HEAD 2>/dev/null || true)"
export BUILD_BRANCH="$(git -C "${SCRIPT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
export BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "=== Restarting containers ==="
docker compose up

echo ""
echo "=== Done ==="
echo "Workspace dists rebuilt and containers restarted."
