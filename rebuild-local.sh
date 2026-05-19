#!/bin/bash
# Rebuild every LibreChat workspace whose dist/ is bind-mounted into the
# container, and restart Docker so the fresh dist/ dirs are picked up. Use
# after editing any source under packages/*/src/ or client/src/.

set -e

echo "=== Stop containers ==="
docker compose down

echo ""
echo "=== Smart-reinstall (install if lockfile changed, Turborepo build) ==="
npm run smart-reinstall

echo ""
echo "=== Restarting containers ==="
docker compose up

echo ""
echo "=== Done ==="
echo "Workspace dists rebuilt and containers restarted."
