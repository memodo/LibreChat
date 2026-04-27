#!/usr/bin/env bash
# init-librechat-user.sh — create the LibreChat application user on first startup.
#
# The official mongo image runs files in /docker-entrypoint-initdb.d/ exactly once,
# when the data directory (/data/db) is empty. By the time this script runs, the
# entrypoint has already created the root user from MONGO_INITDB_ROOT_USERNAME /
# MONGO_INITDB_ROOT_PASSWORD and started a temporary mongod with auth enabled.
#
# This script connects as that root user and creates the application user that
# the LibreChat API uses (LIBRECHAT_MONGO_USER / LIBRECHAT_MONGO_PASSWORD).
#
# On any subsequent container start, the data directory is non-empty and the
# entrypoint skips the entire initdb step — including this script.

set -euo pipefail

: "${LIBRECHAT_MONGO_USER:?LIBRECHAT_MONGO_USER must be set in the mongodb container env}"
: "${LIBRECHAT_MONGO_PASSWORD:?LIBRECHAT_MONGO_PASSWORD must be set in the mongodb container env}"
: "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME must be set}"
: "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD must be set}"

mongosh --quiet \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin <<MONGO_EOF
use LibreChat;
db.createUser({
  user: '${LIBRECHAT_MONGO_USER}',
  pwd: '${LIBRECHAT_MONGO_PASSWORD}',
  roles: [{ role: 'readWrite', db: 'LibreChat' }]
});
MONGO_EOF

echo "[init-librechat-user] application user '${LIBRECHAT_MONGO_USER}' created in LibreChat database."
