#!/usr/bin/env bash
# scripts/backup-offhost.sh — Sync local backups to off-host storage (REQ-023)
#
# Syncs the local backups directory to a remote location for disaster recovery.
# Runs daily after all local backup scripts complete (crontab.prod: 4:00 AM).
#
# Supports two modes (configure via OFF_HOST_MODE in .env.prod):
#   1. rsync  — SSH-based sync to a remote server
#   2. s3     — AWS S3 / S3-compatible (e.g., second MinIO instance, Backblaze B2)
#
# Prerequisites:
#   - rsync mode: SSH key-based access to remote server (no password prompts)
#   - s3 mode: AWS CLI configured with credentials (aws configure) or env vars
#
# Usage: ./scripts/backup-offhost.sh
# Exit codes: 0 = success, 1 = failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"

# Load configuration from .env.prod
ENV_FILE="${PROJECT_DIR}/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  echo "[$TIMESTAMP] ERROR: .env.prod not found at $ENV_FILE"
  exit 1
fi

# Source only the variables we need (avoid polluting environment)
OFF_HOST_MODE=$(grep -E '^OFF_HOST_MODE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
OFF_HOST_RSYNC_TARGET=$(grep -E '^OFF_HOST_RSYNC_TARGET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
OFF_HOST_S3_BUCKET=$(grep -E '^OFF_HOST_S3_BUCKET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")
WEBHOOK_URL=$(grep -E '^BACKUP_WEBHOOK_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "")

send_alert() {
  local message="$1"
  echo "[$TIMESTAMP] ALERT: $message"
  if [ -n "$WEBHOOK_URL" ]; then
    curl -sf -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"[MemodoAI Backup] $message\"}" \
      > /dev/null 2>&1 || echo "[$TIMESTAMP] WARNING: Failed to send webhook alert"
  fi
}

if [ ! -d "$BACKUP_DIR" ]; then
  send_alert "Off-host backup FAILED: backup directory $BACKUP_DIR does not exist"
  exit 1
fi

case "${OFF_HOST_MODE}" in
  rsync)
    if [ -z "$OFF_HOST_RSYNC_TARGET" ]; then
      send_alert "Off-host backup FAILED: OFF_HOST_RSYNC_TARGET not set in .env.prod"
      exit 1
    fi
    echo "[$TIMESTAMP] Starting off-host backup via rsync to $OFF_HOST_RSYNC_TARGET"
    rsync -avz --delete \
      "${BACKUP_DIR}/" \
      "${OFF_HOST_RSYNC_TARGET}" \
      || { send_alert "Off-host rsync backup FAILED"; exit 1; }
    echo "[$TIMESTAMP] Off-host rsync backup completed successfully"
    ;;

  s3)
    if [ -z "$OFF_HOST_S3_BUCKET" ]; then
      send_alert "Off-host backup FAILED: OFF_HOST_S3_BUCKET not set in .env.prod"
      exit 1
    fi
    echo "[$TIMESTAMP] Starting off-host backup via AWS S3 to $OFF_HOST_S3_BUCKET"
    aws s3 sync \
      "${BACKUP_DIR}/" \
      "${OFF_HOST_S3_BUCKET}/backups/" \
      --delete \
      --only-show-errors \
      || { send_alert "Off-host S3 backup FAILED"; exit 1; }
    echo "[$TIMESTAMP] Off-host S3 backup completed successfully"
    ;;

  "")
    echo "[$TIMESTAMP] WARNING: OFF_HOST_MODE not set in .env.prod. Off-host backup is not configured."
    echo "[$TIMESTAMP] Set OFF_HOST_MODE=rsync or OFF_HOST_MODE=s3 in .env.prod."
    echo "[$TIMESTAMP] Skipping off-host backup."
    exit 0
    ;;

  *)
    send_alert "Off-host backup FAILED: Unknown OFF_HOST_MODE='${OFF_HOST_MODE}'. Use 'rsync' or 's3'."
    exit 1
    ;;
esac
