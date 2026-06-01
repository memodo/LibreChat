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
#
# Optional env vars (for dockerized hosts where Postgres is not port-exposed):
#   PG_PROVISION_CONTAINER — if set, run psql inside this Docker container via
#                            `docker exec`, instead of on the host PATH. The
#                            PG_ADMIN_URI hostname must resolve from inside
#                            that container — `localhost` works, as does the
#                            docker service name (e.g. `postgres`).

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

# psql_run pipes its stdin to psql at the given URI, optionally routed
# through `docker exec` when PG_PROVISION_CONTAINER is set. The function's
# stdin (a heredoc at the call site) is inherited by psql.
psql_run() {
  local target_uri="$1"
  if [[ -n "${PG_PROVISION_CONTAINER:-}" ]]; then
    docker exec -i "${PG_PROVISION_CONTAINER}" psql "${target_uri}"
  else
    psql "${target_uri}"
  fi
}

if [[ -n "${PG_PROVISION_CONTAINER:-}" ]]; then
  echo "Provisioning convlog database and roles via docker exec ${PG_PROVISION_CONTAINER}..."
  AUDIT_VIA="via docker exec ${PG_PROVISION_CONTAINER}"
else
  echo "Provisioning convlog database and roles..."
  AUDIT_VIA="host psql"
fi

# Create database and roles (idempotent via exception handling on roles;
# CREATE DATABASE cannot run inside a transaction block, so it is run via
# \gexec on a SELECT that produces the DDL only when convlog is absent).
psql_run "${PG_ADMIN_URI}" <<SQL
SELECT 'CREATE DATABASE convlog'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'convlog')
\gexec

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
psql_run "${PG_ADMIN_URI%/*}/convlog" <<SQL
GRANT USAGE ON SCHEMA public TO convlog_writer, convlog_reader;

-- convlog_writer owns schema; transfer ownership so migrations run cleanly
ALTER SCHEMA public OWNER TO convlog_writer;

-- Grant SELECT on all existing tables to convlog_reader (idempotent; covers tables
-- already created by convlog_writer before this script is re-run). REQ-013a/SPEC-017.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;

-- Default privileges: future tables created by convlog_writer are readable by
-- convlog_reader without re-granting after each migration. The FOR ROLE clause
-- scopes the privilege to the table owner (convlog_writer); without it the ALTER
-- applies only to tables created by the current executing role and silently
-- no-ops for writer-owned tables. REQ-012/SPEC-017.
ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public
  GRANT SELECT ON TABLES TO convlog_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO convlog_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO convlog_writer;
SQL

echo "${TIMESTAMP} | ${OPERATOR} | ${HOST} | provision-postgres | convlog db + convlog_writer + convlog_reader provisioned (${AUDIT_VIA})" >> "${LOG_FILE}"
echo "Done. Audit entry written to ${LOG_FILE}"
