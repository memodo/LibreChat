#!/usr/bin/env bash
# conv-log/ops/provision-postgres.sh — one-time Postgres provisioning (REQ-057)
#
# Creates the convlog database, convlog_writer role, and convlog_reader role.
# Sets default privileges so all future tables in the convlog database are
# accessible per role without re-granting after each migration.
#
# This script does NOT apply DDL — the sidecar's migration runner handles that
# at startup via migrations/001_init.sql.
#
# Required env vars:
#   PG_ADMIN_URI               — psql-compatible connection string with superuser creds
#   CONVLOG_PG_WRITER_PASSWORD — password for convlog_writer
#   CONVLOG_PG_READER_PASSWORD — password for convlog_reader

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
LOG_FILE="${REPO_ROOT}/SDD/orchestration/conv-log-provisioning.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OPERATOR="${USER:-unknown}"
HOST=$(hostname)

if [[ -z "${PG_ADMIN_URI:-}" ]]; then
  echo "ERROR: PG_ADMIN_URI is not set" >&2
  exit 1
fi

if [[ -z "${CONVLOG_PG_WRITER_PASSWORD:-}" ]]; then
  echo "ERROR: CONVLOG_PG_WRITER_PASSWORD is not set" >&2
  exit 1
fi

if [[ -z "${CONVLOG_PG_READER_PASSWORD:-}" ]]; then
  echo "ERROR: CONVLOG_PG_READER_PASSWORD is not set" >&2
  exit 1
fi

echo "Provisioning convlog database and roles..."

# Create database and roles (idempotent via exception handling)
psql "${PG_ADMIN_URI}" <<SQL
DO \$\$
BEGIN
  CREATE DATABASE convlog;
  EXCEPTION WHEN duplicate_database THEN NULL;
END
\$\$;

DO \$\$
BEGIN
  CREATE ROLE convlog_writer LOGIN PASSWORD '${CONVLOG_PG_WRITER_PASSWORD}';
  EXCEPTION WHEN duplicate_object THEN NULL;
END
\$\$;

DO \$\$
BEGIN
  CREATE ROLE convlog_reader LOGIN PASSWORD '${CONVLOG_PG_READER_PASSWORD}';
  EXCEPTION WHEN duplicate_object THEN NULL;
END
\$\$;

GRANT CONNECT ON DATABASE convlog TO convlog_writer, convlog_reader;
SQL

# Connect to convlog to set schema-level permissions and default privileges
psql "${PG_ADMIN_URI%/*}/convlog" <<SQL
GRANT USAGE ON SCHEMA public TO convlog_writer, convlog_reader;

-- convlog_writer owns schema; transfer ownership so migrations run cleanly
ALTER SCHEMA public OWNER TO convlog_writer;

-- Default privileges: future tables created by convlog_writer are readable by
-- convlog_reader without re-granting after each migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO convlog_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO convlog_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO convlog_writer;
SQL

echo "${TIMESTAMP} | ${OPERATOR} | ${HOST} | provision-postgres | convlog db + convlog_writer + convlog_reader provisioned" >> "${LOG_FILE}"
echo "Done. Audit entry written to ${LOG_FILE}"
