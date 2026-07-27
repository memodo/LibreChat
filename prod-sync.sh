#!/usr/bin/env bash
# prod-sync.sh — Push locally-built artifacts to the production server.
#
# Mirrors the dev bind-mount paths from docker-compose.override.yml up to the
# prod server, where matching bind mounts in docker-compose.prod.yml make them
# effective inside the upstream LibreChat image.
#
# Prerequisites:
#   - `npm run build` has completed locally and produced:
#       packages/api/dist/, packages/data-schemas/dist/,
#       packages/data-provider/dist/, client/dist/
#   - guide-media/ holds the authored tutorial media to serve (getting-started/,
#     updates-*/); it is gitignored and travels only through this sync
#   - SSH key access to the prod server (PROD_HOST)
#   - docker-compose.prod.yml on the server has matching bind mounts
#
# Usage:
#   ./prod-sync.sh                       # sync and restart api
#   ./prod-sync.sh --dry-run             # preview only, no transfer
#   ./prod-sync.sh --no-restart          # sync but don't restart api
#   PROD_HOST=other-alias ./prod-sync.sh # override the default SSH target
#
# Env vars:
#   PROD_HOST   — SSH target, defaults to the Hetzner-personal ssh-config alias
#   PROD_PATH   — remote project root, defaults to /opt/docker/librechat

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_HOST="${PROD_HOST:-memodo-eng-prod}"
PROD_PATH="${PROD_PATH:-/opt/docker/librechat}"

DRY_RUN=()
RESTART=true
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=(--dry-run) ;;
    --no-restart) RESTART=false ;;
    -h|--help)
      sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

PATHS=(
  packages/api/dist
  packages/data-schemas/dist
  packages/data-provider/dist
  client/dist
  api/server
  # Authored tutorial media (getting-started/ + updates-*/), served via the
  # ./guide-media bind mount in docker-compose.prod.yml. Not a build output —
  # it ships only through this sync (gitignored), so it must travel here too.
  guide-media
)

# Catch "forgot to build" — every path the prod image expects bind-mounted
# must exist locally before we sync. Missing dist/ would silently nuke the
# remote dir via --delete and break the container on next restart.
for p in "${PATHS[@]}"; do
  if [ ! -d "$SCRIPT_DIR/$p" ]; then
    echo "ERROR: local path missing: $p" >&2
    echo "  Run 'npm run build' first (for dist/), and ensure guide-media/ is present." >&2
    exit 1
  fi
done

BRANCH=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
echo "[$(date -Iseconds)] Syncing to ${PROD_HOST}:${PROD_PATH}"
echo "  Local branch: ${BRANCH}"
if [ ${#DRY_RUN[@]} -gt 0 ]; then
  echo "  DRY RUN — no files will be transferred"
fi
echo

for p in "${PATHS[@]}"; do
  echo "→ ${p}/"
  rsync -avz --delete "${DRY_RUN[@]}" \
    "$SCRIPT_DIR/$p/" \
    "${PROD_HOST}:${PROD_PATH}/$p/"
  echo
done

if [ ${#DRY_RUN[@]} -gt 0 ]; then
  echo "[$(date -Iseconds)] Dry run complete. Re-run without --dry-run to apply."
  exit 0
fi

if [ "$RESTART" = true ]; then
  echo "[$(date -Iseconds)] Restarting api on ${PROD_HOST}..."
  ssh "$PROD_HOST" "cd '$PROD_PATH' && ./prod.sh restart api"
  echo "[$(date -Iseconds)] Done."
else
  echo "[$(date -Iseconds)] Sync complete. Skipping api restart (--no-restart)."
  echo "  Run manually:  ssh ${PROD_HOST} \"cd '${PROD_PATH}' && ./prod.sh restart api\""
fi
