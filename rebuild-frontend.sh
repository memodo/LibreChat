#!/bin/bash
# Rebuild the LibreChat frontend locally and restart the Docker container
# so the bind-mounted client/dist is picked up.

set -e

echo "=== Stop containers ==="
docker compose down

echo ""
echo "=== Installing dependencies ==="
npm install

echo ""
echo "=== Building frontend ==="
npm run frontend

echo ""
echo "=== Restarting containers ==="
docker compose up

echo ""
echo "=== Done ==="
echo "Frontend rebuilt and containers restarted."
