#!/usr/bin/env bash
# conv-log/ops/provision-mongo.sh — one-time Mongo user creation (REQ-056)
#
# Creates convlog_reader in the LibreChat database with read-only role.
# Run once per environment; idempotent only if the user does not already exist
# (Mongo createUser errors on duplicate — operator must drop manually to re-provision).
#
# Required env vars:
#   MONGO_ADMIN_URI          — mongosh-compatible URI with admin credentials
#   CONVLOG_MONGO_PASSWORD   — password for the new convlog_reader user

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
LOG_FILE="${REPO_ROOT}/SDD/orchestration/conv-log-provisioning.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OPERATOR="${USER:-unknown}"
HOST=$(hostname)

if [[ -z "${MONGO_ADMIN_URI:-}" ]]; then
  echo "ERROR: MONGO_ADMIN_URI is not set" >&2
  exit 1
fi

if [[ -z "${CONVLOG_MONGO_PASSWORD:-}" ]]; then
  echo "ERROR: CONVLOG_MONGO_PASSWORD is not set" >&2
  exit 1
fi

echo "Creating convlog_reader Mongo user..."

mongosh "${MONGO_ADMIN_URI}" --quiet --eval "
  db.getSiblingDB('LibreChat').createUser({
    user: 'convlog_reader',
    pwd: '${CONVLOG_MONGO_PASSWORD}',
    roles: [{ role: 'read', db: 'LibreChat' }]
  });
  print('convlog_reader created successfully');
"

echo "${TIMESTAMP} | ${OPERATOR} | ${HOST} | provision-mongo | convlog_reader created in LibreChat db" >> "${LOG_FILE}"
echo "Done. Audit entry written to ${LOG_FILE}"
