#!/usr/bin/env bash
# scripts/backup-postgres.sh — Automated weekly PostgreSQL backup (REQ-021)
#
# Usage: ./scripts/backup-postgres.sh
# Cron:  See crontab.prod (REQ-050)
#
# Performs pg_dump with custom format for the RAG API database.
# Retains 30 days of backups with automated pruning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups/postgres"
RETENTION_DAYS=30
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/rag_${TIMESTAMP}.dump"
PG_CONTAINER="vectordb"

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

PG_USER="${POSTGRES_USER:?POSTGRES_USER not set — check .env.prod}"
PG_DB="${POSTGRES_DB:?POSTGRES_DB not set — check .env.prod}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting PostgreSQL backup..."

# Run pg_dump inside the container, pipe to host
docker exec "$PG_CONTAINER" pg_dump \
  -U "$PG_USER" \
  -d "$PG_DB" \
  --format=custom > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Prune old backups
echo "[$(date -Iseconds)] Pruning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "rag_*.dump" -mtime "+${RETENTION_DAYS}" -delete
REMAINING=$(find "$BACKUP_DIR" -name "rag_*.dump" | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] Retention: ${REMAINING} backup(s) remaining"

echo "[$(date -Iseconds)] PostgreSQL backup completed successfully"
