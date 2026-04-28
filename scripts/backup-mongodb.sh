#!/usr/bin/env bash
# scripts/backup-mongodb.sh — Automated daily MongoDB backup (REQ-019)
#
# Usage: ./scripts/backup-mongodb.sh
# Cron:  See crontab.prod (REQ-050)
#
# Performs mongodump of the LibreChat database with gzip compression.
# Retains 30 days of backups with automated pruning.
# After enabling MongoDB auth (REQ-006), credentials are read from .env.prod.
#
# Note (EDGE-006): mongodump without --oplog is not crash-consistent during
# active writes. Accepted risk for small deployment. Schedule during off-peak.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups/mongodb"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/librechat_${TIMESTAMP}.archive.gz"
MONGO_CONTAINER="chat-mongodb"

# Load credentials from .env.prod if it exists
ENV_FILE="${PROJECT_DIR}/.env.prod"
if [ -f "$ENV_FILE" ]; then
  # Skip bash readonly built-ins (UID/GID/EUID/...) so sourcing doesn't fail
  # under `set -e` if .env.prod has those names.
  set -a
  # shellcheck disable=SC1090
  source <(grep -vE '^\s*(UID|GID|EUID|PPID|BASHPID|SHELLOPTS|BASH_VERSINFO)=' "$ENV_FILE")
  set +a
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting MongoDB backup..."

# Build mongodump command with optional auth
DUMP_ARGS=(--archive --gzip --db LibreChat)
if [ -n "${MONGO_ADMIN_USER:-}" ] && [ -n "${MONGO_ADMIN_PASSWORD:-}" ]; then
  DUMP_ARGS+=(--username "$MONGO_ADMIN_USER" --password "$MONGO_ADMIN_PASSWORD" --authenticationDatabase admin)
fi

# Run mongodump inside the container, pipe archive to host
docker exec "$MONGO_CONTAINER" mongodump "${DUMP_ARGS[@]}" > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Prune old backups
echo "[$(date -Iseconds)] Pruning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "librechat_*.archive.gz" -mtime "+${RETENTION_DAYS}" -delete
REMAINING=$(find "$BACKUP_DIR" -name "librechat_*.archive.gz" | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] Retention: ${REMAINING} backup(s) remaining"

# REQ-025: Alert on failure (handled by exit code — cron MAILTO or wrapper catches it)
echo "[$(date -Iseconds)] MongoDB backup completed successfully"
