# PROMPT-010-production-readiness — Implementation Tracking

**Spec:** SPEC-010-production-readiness
**Branch:** feature/production-ready
**Date:** 2026-04-01
**Status:** Implementation Complete

## Deliverables

### Phase 1: Security Hardening

| REQ | Status | Deliverable |
|-----|--------|-------------|
| REQ-001 | DONE | `docker-compose.prod.yml` — production overrides with all services |
| REQ-002 | DONE | `prod.sh` — helper script with correct 3-file merge order |
| REQ-003 | DONE | API image pinned to `librechat:v0.8.4` in prod compose |
| REQ-004 | DONE | RAG API pinned to `librechat-rag-api-dev-lite:v0.5.0` (no release image available — documented as tech debt) |
| REQ-005 | DONE | `.env.prod.template` — template with generation commands for all secrets |
| REQ-006 | DONE | `scripts/mongodb-auth-migration.sh` — 10-step manual migration procedure |
| REQ-007 | DONE | PostgreSQL credentials in `.env.prod.template` and `docker-compose.prod.yml` |
| REQ-008 | DONE | MinIO credentials + pinned image in `.env.prod.template` and `docker-compose.prod.yml` |
| REQ-009 | DONE | `NODE_ENV=production` in `.env.prod.template` |
| REQ-010 | DONE | Investigation: `cors()` is unconditional at `api/server/index.js:116`. DOMAIN_CLIENT/SERVER set in template. Caddy CORS header rule needed in infra repo (external dep). |
| REQ-011 | DONE | `registration.allowedDomains` in `librechat.yaml.prod.example` |
| REQ-012 | DONE | `ALLOW_UNVERIFIED_EMAIL_LOGIN=false` in `.env.prod.template` |
| REQ-013 | DONE | `ports: !override []` for mongodb in `docker-compose.prod.yml` |
| REQ-014 | DONE | Production logging vars in `.env.prod.template` |
| REQ-014-A | DONE | `docs/runbooks/log-escalation.md` — procedure with 30-min time limit |
| REQ-015 | DONE | Log rotation on all services in `docker-compose.prod.yml` |
| REQ-016 | N/A | Host firewall verification — manual step on production server |
| REQ-017 | DONE | `.gitignore` already covers `.env*`; added `!**/.env.prod.template` exception and `backups/` |
| REQ-053 | DONE | Documented in mongodb-auth-migration.sh Step 10 |

### Phase 2: Backups

| REQ | Status | Deliverable |
|-----|--------|-------------|
| REQ-018 | DONE | RPO/RTO documented in spec; backup schedule covers 24h RPO |
| REQ-019 | DONE | `scripts/backup-mongodb.sh` — daily mongodump with 30-day retention |
| REQ-020 | DONE | `scripts/backup-minio.sh` — daily mc mirror with credential passthrough |
| REQ-021 | DONE | `scripts/backup-postgres.sh` — weekly pg_dump with 30-day retention |
| REQ-022 | DONE | `scripts/backup-config.sh` — daily config archive |
| REQ-023 | DONE | `scripts/backup-offhost.sh` — rsync/S3 off-host sync, config in `.env.prod.template` |
| REQ-023-A | DONE | Local backups in `./backups/` (scripts retain locally by default) |
| REQ-024 | DONE | Restore procedures in `docs/runbooks/backup-restore.md` |
| REQ-025 | DONE | Scripts use exit codes; crontab.prod has MAILTO; webhook support in watchdog |
| REQ-026 | N/A | Caddy cert backup — infra repo concern, documented in DR runbook |
| REQ-050 | DONE | `crontab.prod` — all schedules, off-peak hours, installation docs |

### Phase 3: Monitoring and Alerting

| REQ | Status | Deliverable |
|-----|--------|-------------|
| REQ-027 | DONE | Health checks for all 6 services in `docker-compose.prod.yml` |
| REQ-027-A | DONE | `scripts/monitoring-watchdog.sh` + Prometheus/Grafana health checks in monitoring compose |
| REQ-028 | DONE | `monitoring/docker-compose.monitoring.yml` — Prometheus + Grafana stack |
| REQ-029 | DONE | librechat-exporter in monitoring compose |
| REQ-030 | DONE | mongodb-exporter + postgres-exporter in monitoring compose |
| REQ-031 | N/A | External uptime monitoring — SaaS signup, not a code deliverable |
| REQ-032 | DONE | `monitoring/prometheus/alerts.yml` — all critical alert conditions |
| REQ-033 | N/A | Azure Diagnostic Settings — Azure portal configuration |
| REQ-034 | N/A | Azure Budget — Azure portal configuration |
| REQ-035 | DONE | Disk usage alerts in `monitoring/prometheus/alerts.yml` |
| REQ-051 | DONE | node-exporter in `docker-compose.prod.yml` |

### Phase 4: Guardrails and Cost Control

| REQ | Status | Deliverable |
|-----|--------|-------------|
| REQ-036 | DONE | Rate limiting values in `.env.prod.template` and `librechat.yaml.prod.example` |
| REQ-037 | DONE | Token balance enabled in `librechat.yaml.prod.example` |
| REQ-038 | DONE | Ban system vars in `.env.prod.template` |
| REQ-039 | DONE | Resource limits on all services in `docker-compose.prod.yml` |
| REQ-039-A | N/A | Validation step — manual `docker stats` check after deployment |
| REQ-040 | DONE | Redakt API service in `docker-compose.prod.yml`; PII vars in `.env.prod.template` |
| REQ-041 | DONE | Fail-open config with switch criteria documented in pii-override runbook |
| REQ-041-A | DONE | `docs/runbooks/pii-override.md` — complete override procedures |
| REQ-042 | DONE | Already implemented: `usageRateLimiter` at line 36-49, applied at line 255 of `api/server/routes/admin/usage.js`. 60 req/min per user. Tests at line 687+ of usage.spec.js. |
| REQ-043 | DONE | Already implemented: `handleTimeoutError()` returns 504 throughout usage.js. Tests at line 678+ of usage.spec.js. |

### Phase 5: Operational Maturity

| REQ | Status | Deliverable |
|-----|--------|-------------|
| REQ-044 | N/A | OS patching cadence — manual server configuration |
| REQ-045 | N/A | Data retention policies — operational decision, not code |
| REQ-046 | DONE | 6 runbooks in `docs/runbooks/` |
| REQ-047 | N/A | SSH hardening — manual server configuration |
| REQ-048 | N/A | GDPR procedures — legal/operational, not code |
| REQ-049 | DONE | `TRUST_PROXY=1` documented in `.env.prod.template` |
| REQ-052 | DONE | SSRF protection documented in `librechat.yaml.prod.example` with empty allowlists |

## Key Findings

1. **REQ-042 and REQ-043 were already implemented** in `api/server/routes/admin/usage.js` from SPEC-008 work. Rate limiter (60 req/min per user) and 504 timeout handling are both present with tests.

2. **REQ-010 (CORS):** `app.use(cors())` at `api/server/index.js:116` is unconditional — `DOMAIN_CLIENT` does NOT restrict CORS origins. A Caddy CORS header rule in the infra repo is needed. This is tracked as an external dependency.

3. **REQ-004 (RAG API image):** No non-dev/release RAG API image exists. Pinned the dev-lite image to a specific version tag as documented acceptable fallback.

4. **Docker Compose `ports: !override []`:** Used YAML override tag to clear the MongoDB ports list from the base compose file.

## Files Created

### Configuration
- `docker-compose.prod.yml` — production Docker Compose overrides
- `prod.sh` — production helper script
- `.env.prod.template` — environment template (no secrets)
- `librechat.yaml.prod.example` — production librechat.yaml template
- `crontab.prod` — cron schedule for backups and monitoring

### Scripts
- `scripts/mongodb-auth-migration.sh` — MongoDB auth migration procedure
- `scripts/backup-mongodb.sh` — daily MongoDB backup
- `scripts/backup-minio.sh` — daily MinIO backup
- `scripts/backup-postgres.sh` — weekly PostgreSQL backup
- `scripts/backup-config.sh` — daily configuration backup
- `scripts/monitoring-watchdog.sh` — monitoring health watchdog

### Monitoring
- `monitoring/docker-compose.monitoring.yml` — Prometheus + Grafana stack
- `monitoring/prometheus/prometheus.yml` — Prometheus scrape configuration
- `monitoring/prometheus/alerts.yml` — alert rules

### Runbooks
- `docs/runbooks/service-restart.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/secret-rotation.md`
- `docs/runbooks/pii-override.md`
- `docs/runbooks/disaster-recovery.md`
- `docs/runbooks/log-escalation.md`

### Modified Files
- `.gitignore` — added `.env.prod.template` exception and `backups/` exclusion

## Review Findings Addressed (2026-04-01)

Both code review and critical implementation review findings have been resolved:

- **Alertmanager deployed** — v0.27.0 with webhook receivers and health check
- **Network isolation fixed** — `librechat_default` external network shared with app stack
- **Watchdog localhost access fixed** — Monitoring services bind to `127.0.0.1:PORT`
- **Crontab MAILTO fixed** — Uses `tee -a` instead of plain redirection
- **Off-host backup created** — `scripts/backup-offhost.sh` with rsync/S3 support
- **Grafana password in template** — `GRAFANA_ADMIN_PASSWORD` added to `.env.prod.template`
- **cAdvisor deployed** — Container metrics for `ContainerMemoryHigh` alert
- **Redakt scrape job added** — `prometheus.yml` targets `redakt-api:8000`
- **Backup Prometheus alert added** — `BackupStale` rule via textfile collector
- **Monitoring credentials in template** — `MONGO_EXPORTER_URI`, `COMPOSE_PROJECT_NETWORK`
- **librechat_exporter `:latest`** — Accepted as tech debt (no tagged releases exist)

See `SDD/reviews/REVIEW-010-production-readiness-20260401.md` and `SDD/reviews/CRITICAL-IMPL-production-readiness-20260401.md` for full details.
