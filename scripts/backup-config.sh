#!/usr/bin/env bash
# scripts/backup-config.sh — Daily configuration backup (REQ-022)
#
# Usage: ./scripts/backup-config.sh
# Cron:  See crontab.prod (REQ-050)
#
# Archives critical configuration files. Does NOT include .env.prod secrets
# in the archive name, but the archive CONTAINS .env.prod — treat as sensitive.
# Store off-host with the same security as database backups.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups/config"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/config_${TIMESTAMP}.tar.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting configuration backup..."

# List of files to back up (relative to project root)
CONFIG_FILES=(
  ".env"
  ".env.prod"
  "librechat.yaml"
  "docker-compose.override.yml"
  "docker-compose.prod.yml"
  "prod.sh"
  "crontab.prod"
)

# Build tar arguments — only include files that exist
TAR_ARGS=()
for f in "${CONFIG_FILES[@]}"; do
  if [ -f "${PROJECT_DIR}/${f}" ]; then
    TAR_ARGS+=("$f")
  else
    echo "[$(date -Iseconds)] WARNING: ${f} not found, skipping"
  fi
done

if [ ${#TAR_ARGS[@]} -eq 0 ]; then
  echo "[$(date -Iseconds)] ERROR: No configuration files found to back up"
  exit 1
fi

# Create the archive
tar -czf "$BACKUP_FILE" -C "$PROJECT_DIR" "${TAR_ARGS[@]}"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Prune old backups
echo "[$(date -Iseconds)] Pruning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "config_*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete
REMAINING=$(find "$BACKUP_DIR" -name "config_*.tar.gz" | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] Retention: ${REMAINING} backup(s) remaining"

echo "[$(date -Iseconds)] Configuration backup completed successfully"
