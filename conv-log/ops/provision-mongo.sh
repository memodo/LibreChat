#!/usr/bin/env bash
# conv-log/ops/provision-mongo.sh — one-time Mongo user creation (REQ-056)
#
# Creates convlog_reader in the LibreChat database with read-only role.
# Run once per environment; not idempotent for the user object — Mongo
# createUser errors on duplicate (drop the user first to re-provision).
#
# Required env vars:
#   MONGO_ADMIN_URI          — mongosh-compatible URI with admin credentials
#   CONVLOG_MONGO_PASSWORD   — password for the new convlog_reader user
#
# Optional env vars (for dockerized hosts where Mongo is not port-exposed):
#   MONGO_PROVISION_CONTAINER — if set, run mongosh inside this Docker
#                               container via `docker exec`, instead of on
#                               the host PATH. The MONGO_ADMIN_URI hostname
#                               must resolve from inside that container —
#                               `localhost` works, as does the docker service
#                               name (e.g. `mongodb`).

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

MONGO_EVAL="
  db.getSiblingDB('LibreChat').createUser({
    user: 'convlog_reader',
    pwd: '${CONVLOG_MONGO_PASSWORD}',
    roles: [{ role: 'read', db: 'LibreChat' }]
  });
  print('convlog_reader created successfully');
"

if [[ -n "${MONGO_PROVISION_CONTAINER:-}" ]]; then
  echo "Creating convlog_reader Mongo user via docker exec ${MONGO_PROVISION_CONTAINER}..."
  docker exec -i "${MONGO_PROVISION_CONTAINER}" mongosh "${MONGO_ADMIN_URI}" --quiet --eval "${MONGO_EVAL}"
  AUDIT_VIA="via docker exec ${MONGO_PROVISION_CONTAINER}"
else
  echo "Creating convlog_reader Mongo user..."
  mongosh "${MONGO_ADMIN_URI}" --quiet --eval "${MONGO_EVAL}"
  AUDIT_VIA="host mongosh"
fi

echo "${TIMESTAMP} | ${OPERATOR} | ${HOST} | provision-mongo | convlog_reader created in LibreChat db (${AUDIT_VIA})" >> "${LOG_FILE}"
echo "Done. Audit entry written to ${LOG_FILE}"
