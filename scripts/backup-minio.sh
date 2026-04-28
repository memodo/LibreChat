#!/usr/bin/env bash
# scripts/backup-minio.sh — Automated daily MinIO backup (REQ-020)
#
# Usage: ./scripts/backup-minio.sh
# Cron:  See crontab.prod (REQ-050)
#
# Uses a minio/mc container to mirror MinIO data to local backup directory.
# Credentials are passed via -e flags (EDGE-007: env vars are NOT available
# inside the container by default).
# Retains 30 days of backups with automated pruning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups/minio"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DEST="${BACKUP_DIR}/${TIMESTAMP}"

# Load credentials from .env.prod
ENV_FILE="${PROJECT_DIR}/.env.prod"
if [ -f "$ENV_FILE" ]; then
  # Skip bash readonly built-ins (UID/GID/EUID/...) so sourcing doesn't fail
  # under `set -e` if .env.prod has those names.
  set -a
  # shellcheck disable=SC1090
  source <(grep -vE '^\s*(UID|GID|EUID|PPID|BASHPID|SHELLOPTS|BASH_VERSINFO)=' "$ENV_FILE")
  set +a
fi

MINIO_USER="${MINIO_ROOT_USER:?MINIO_ROOT_USER not set — check .env.prod}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD not set — check .env.prod}"

# Create backup directory
mkdir -p "$BACKUP_DEST"

echo "[$(date -Iseconds)] Starting MinIO backup..."

# Run mc mirror using a temporary minio/mc container on the default network
# EDGE-007: Pass credentials explicitly via -e flags
docker run --rm \
  --network "$(docker inspect chat-mongodb --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)" \
  -e "MC_HOST_myminio=http://${MINIO_USER}:${MINIO_PASS}@minio:9000" \
  -v "${BACKUP_DEST}:/backup" \
  minio/mc:RELEASE.2025-03-12T17-29-24Z \
  mirror myminio/librechat /backup

BACKUP_SIZE=$(du -sh "$BACKUP_DEST" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_DEST ($BACKUP_SIZE)"

# Prune old backups (each backup is a directory named by timestamp)
echo "[$(date -Iseconds)] Pruning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
REMAINING=$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] Retention: ${REMAINING} backup(s) remaining"

echo "[$(date -Iseconds)] MinIO backup completed successfully"
