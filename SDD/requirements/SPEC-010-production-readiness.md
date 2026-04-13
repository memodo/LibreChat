# SPEC-010-production-readiness

## Executive Summary

- **Based on Research:** RESEARCH-010-production-readiness.md
- **Creation Date:** 2026-04-01
- **Author:** Claude (with Pablo Oliva)
- **Status:** Draft (Revised 2026-04-01 — all critical review findings addressed)

This specification defines the concrete, implementable requirements for hardening the MemodoAI LibreChat deployment for production use. The research identified critical security gaps (MongoDB without authentication, default credentials, dev images, open registration, debug logging), zero backup infrastructure, no monitoring/alerting, and missing operational tooling. The spec covers 5 implementation phases across security hardening, backups, monitoring, guardrails, and operational maturity.

## Research Foundation

### Production Issues Addressed
- **MongoDB running without authentication** (Section 6.2) -- any network-adjacent process can read/write all data
- **Default credentials** on PostgreSQL (`myuser`/`mypassword`) and MinIO (`minioadmin`/`minioadmin123`) (Section 6.1)
- **Default JWT/CREDS secrets** -- LibreChat ships with placeholder values for `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (Section 6.1)
- **Development Docker images in production** -- `librechat-dev:latest` and `librechat-rag-api-dev-lite:latest` (Section 6.10, review HIGH-5)
- **No automated backups** for any data store (Section 2)
- **No monitoring or alerting** infrastructure (Section 3)
- **No health checks** in docker-compose (Section 3.1)
- **Debug logging enabled** -- `DEBUG_LOGGING=true` (Section 3.4)
- **Open registration** -- `ALLOW_REGISTRATION=true`, `ALLOW_UNVERIFIED_EMAIL_LOGIN=true` (Section 4.5)
- **Wide-open CORS** -- `app.use(cors())` at `api/server/index.js:116` (Section 6.5, review MEDIUM-4)
- **No Docker log rotation** -- disk fills up indefinitely (Section 6.11, review MEDIUM-2)
- **Externally exposed database ports** -- MongoDB 27017 reachable from outside (Section 6.4)
- **MongoDB crash loop bug** -- Issue #11808, process.exit(1) on transient connectivity issues (Section 3.6)
- **Missing rate limiting on admin endpoints** -- SPEC-008 admin reporting has no rate limiter (Section 4.8, item 2)
- **No RPO/RTO targets defined** -- backup schedule has no business justification (Section 2.1, review HIGH-4)

### Stakeholder Validation
- **Product Team:** Production deployment must be secure, reliable, and cost-controlled for the Memodo engineering team. Open registration must be restricted to company domains. PII guardrails must be active before wider rollout.
- **Engineering Team:** Single-server Docker Compose deployment. Infrastructure managed by same team as application. Azure OpenAI as LLM backend. Caddy reverse proxy (infra repo) handles TLS. SSO gateway (RESEARCH-011) planned but not yet deployed.

### System Integration Points
- `api/server/index.js:94` -- health endpoint (`/health`) for Docker health checks
- `api/server/index.js:116` -- CORS configuration (`app.use(cors())`) needs restriction
- `docker-compose.yml` -- base service definitions (shared dev/prod)
- `docker-compose.override.yml` -- dev overrides (auto-loaded), contains volume mounts and exposed ports
- `.env` / `.env.prod` -- environment variable configuration (dual-file strategy per Section 6 note)
- `librechat.yaml` -- application configuration (rate limits, balance, guardrails, registration)
- `/Users/pablooliva/Dev/infra/` -- Caddy reverse proxy, TLS, `caddy_net` external network
- MinIO `minio-init` sidecar -- existing pattern for `mc` container usage (model for backups)

## Intent

### Problem Statement
The MemodoAI LibreChat deployment has critical security vulnerabilities (no database authentication, default credentials, dev images), zero disaster recovery capability (no backups), no operational visibility (no monitoring, no health checks, no alerting), and missing production configurations (debug logging, open registration, no CORS restriction, no log rotation). Any of these gaps individually could cause data loss, security breaches, or unrecoverable outages.

### Solution Approach
Implement production hardening in 5 prioritized phases: (1) security hardening as the immediate priority, (2) backup infrastructure, (3) monitoring and alerting, (4) guardrails and cost controls, (5) operational maturity. Each phase builds on the previous. A separate `docker-compose.prod.yml` file and `.env.prod` configuration will cleanly separate production from development settings. All changes are infrastructure/configuration -- no application code changes are required except for two tracked bug fixes (admin rate limiting, MongoDB timeout codes).

### Expected Outcomes
- All data stores authenticated with strong, unique credentials
- Release (not dev) Docker images pinned to specific versions
- Daily automated backups with tested restore procedures and defined RPO/RTO
- Health checks on all containers with automatic restart on failure
- External uptime monitoring independent of the application server
- Prometheus + Grafana metrics and alerting for key failure conditions
- Production logging (structured JSON, warn level, rotated)
- Registration restricted to company email domains
- CORS restricted to the production domain
- Database ports not exposed externally
- Token balance system and rate limiting active
- PII detection deployed in warn mode for initial audit
- Documented runbooks for common operational tasks

## Success Criteria

### Functional Requirements

#### Phase 1: Security Hardening

- **REQ-001:** Create `docker-compose.prod.yml` that overrides dev settings with production-appropriate configuration (release images, health checks, resource limits, log rotation, no exposed DB ports). Must be loaded via explicit `-f` flags alongside base and override files.
- **REQ-002:** Create `prod.sh` helper script at project root that wraps the multi-file `docker compose` invocation with `--env-file .env.prod`. Script must pass through all arguments (`"$@"`). Must be committed to version control (contains no secrets).
- **REQ-003:** Switch API image from `librechat-dev:latest` to `librechat:v0.8.4` (or latest stable release) in `docker-compose.prod.yml`. Pin to exact version tag, never `:latest`.
- **REQ-004:** Switch RAG API image from `librechat-rag-api-dev-lite:latest` to a pinned version. Verify available tags in the registry before implementation -- the RAG API may not follow the same versioning as LibreChat. If no non-dev/release image exists, pin the dev-lite image to a specific version tag (not `:latest`) and document this as accepted technical debt with a tracking note to revisit when a release image becomes available.
- **REQ-005:** Regenerate all secrets and store in `.env.prod`: `JWT_SECRET` (32-byte hex), `JWT_REFRESH_SECRET` (32-byte hex), `CREDS_KEY` (32-byte hex), `CREDS_IV` (16-byte hex), `MEILI_MASTER_KEY` (32-byte hex). Use `openssl rand -hex` for generation.
- **REQ-006:** Enable MongoDB authentication via the correct multi-step migration: (a) connect to running `--noauth` instance, (b) create admin user in `admin` db, (c) create `librechat` application user in `LibreChat` db with `readWrite` role, (d) update `MONGO_URI` in `.env.prod` with credentials, (e) add `command: mongod --auth --bind_ip_all` to `docker-compose.prod.yml`, (f) restart and verify. Do NOT use `MONGO_INITDB_*` env vars on existing data directory.
- **REQ-007:** Change PostgreSQL credentials from `myuser`/`mypassword` to strong unique values. Update `RAG_API` database connection strings in `.env.prod`.
- **REQ-008:** Change MinIO credentials from `minioadmin`/`minioadmin123` to strong unique values. Update `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and S3 configuration in `.env.prod`.
- **REQ-009:** Set `NODE_ENV=production` in `.env.prod` only (not `.env`). Document that this invalidates all active sessions (cookie flags change to Secure + SameSite). Plan as maintenance window.
- **REQ-010:** Configure CORS restriction. Pre-implementation task: read `api/server/index.js:116` and trace the `cors()` call to determine if `DOMAIN_CLIENT` restricts origins. Record the finding. If it does: set `DOMAIN_CLIENT=https://chat.memodo-eng.de` and `DOMAIN_SERVER=https://chat.memodo-eng.de` in `.env.prod`. If it does not (i.e., `cors()` is unconditional): create a Caddy CORS header rule in the infra repo (`/Users/pablooliva/Dev/infra/`) that restricts `Access-Control-Allow-Origin` to `https://chat.memodo-eng.de` and set the `DOMAIN_*` vars regardless for future compatibility. The Caddy change is an external dependency on the infra repo and must be tracked separately.
- **REQ-011:** Restrict registration via domain allowlist: keep `ALLOW_REGISTRATION=true` in `.env.prod` but restrict to company domains via `librechat.yaml` `registration.allowedDomains: ["memodo.de", "memodo-eng.de"]`. This enables self-service onboarding for new team members without manual account creation. Requires REQ-012 (`ALLOW_UNVERIFIED_EMAIL_LOGIN=false`) to be meaningful -- without email verification, domain restriction is bypassable. Rationale: the team may grow and manual user creation does not scale; domain restriction plus email verification provides equivalent security with lower operational burden.
- **REQ-012:** Set `ALLOW_UNVERIFIED_EMAIL_LOGIN=false` in `.env.prod`.
- **REQ-013:** Remove externally exposed MongoDB port: set `ports: []` for mongodb service in `docker-compose.prod.yml`. Document SSH tunnel access method: `ssh -L 27017:localhost:27017 user@production-server`.
- **REQ-014:** Set production logging: `DEBUG_LOGGING=false`, `LOG_LEVEL=warn`, `CONSOLE_JSON=true`, `DEBUG_CONSOLE=false` in `.env.prod`.
- **REQ-014-A:** Document a log level escalation procedure for incident debugging: (1) change `LOG_LEVEL=debug` in `.env.prod`, (2) restart the API container (`./prod.sh restart api`), (3) reproduce the issue and capture logs within 15 minutes, (4) immediately revert to `LOG_LEVEL=warn` and restart. Warning: debug-level logs are high-volume and may rotate quickly even with log rotation enabled. Do not leave debug logging on for more than 30 minutes in production. Include this procedure in the operational runbook (REQ-046).
- **REQ-015:** Add Docker container log rotation to all services in `docker-compose.prod.yml`: `logging.driver: json-file`, `max-size: 10m`, `max-file: 5` for API, `max-file: 3` for databases.
- **REQ-016:** Verify host firewall blocks Docker-exposed ports (27017, 5432, 9000, 7700) from external access. Test with `nmap` from an external host. Docker port mapping can bypass `iptables`/`ufw` rules.
- **REQ-017:** Ensure `.env`, `.env.prod`, and any files containing secrets are in `.gitignore` and never committed to version control.

#### Phase 2: Backups

- **REQ-018:** RPO = 24 hours (daily backups). RTO = 4 hours for complete server failure (FAIL-008), RTO = 1 hour for single-service recovery (FAIL-001, FAIL-002). Rationale: complete server recovery requires provisioning, downloading off-host backups, restoring 3 data stores, redeploying the Docker stack, and DNS updates -- realistically 2-4 hours for a small team, especially outside business hours. Single-service recovery (restart container, restore single DB) is achievable within 1 hour. To achieve faster full-server RTO, implement REQ-023-A (keep most recent backup cached locally in addition to off-host). Before enabling PII detection in block mode, re-evaluate RPO for the GuardrailEvent collection and document the revised target.
- **REQ-019:** Create automated daily MongoDB backup script using `mongodump --archive --gzip --db LibreChat`. Store backups at `./backups/` with timestamp naming. After enabling auth (REQ-006), the script must use credentials. Retain 30 days of backups with automated pruning.
- **REQ-020:** Create automated daily MinIO backup using a `minio/mc` container on `caddy_net`. Must pass credentials via `-e` flags or `--env-file .env.prod` (env vars are NOT available inside the container by default). Use `mc mirror` to local backup directory.
- **REQ-021:** Create automated weekly PostgreSQL backup using `pg_dump -U <user> -d <database> --format=custom`. Retain 30 days.
- **REQ-022:** Create configuration backup script that archives: `.env`, `.env.prod`, `librechat.yaml`, `docker-compose.override.yml`, `docker-compose.prod.yml`, `prod.sh`. Run daily.
- **REQ-023:** Set up off-host backup storage (remote S3 bucket, NAS, or equivalent). Local backups alone do not protect against server failure.
- **REQ-023-A:** Keep the most recent backup set cached locally (in addition to off-host copies) for fast single-service recovery within the 1-hour RTO. Off-host backups are for disaster recovery; local copies are for operational recovery.
- **REQ-024:** Test restore procedures for MongoDB, PostgreSQL, and MinIO. Document each restore procedure as a runbook. Verify data integrity after restore. Include MeiliSearch re-indexing procedure after MongoDB restore: document how to trigger re-index, estimate re-index time for current data volume, and note that search is unavailable during re-indexing. Include MeiliSearch rebuild time in the RTO calculation for FAIL-008.
- **REQ-025:** Set up backup failure alerting -- script exit code != 0 triggers notification (email or webhook).
- **REQ-026:** Back up Caddy TLS certificates and config (`caddy_data`, `caddy_config` volumes from infra repo). While auto-renewable, this avoids Let's Encrypt rate limit issues during recovery.

#### Phase 3: Monitoring and Alerting

- **REQ-027:** Add Docker health checks to all services in `docker-compose.prod.yml`: API (`/health` on port 3080), MongoDB (`mongosh` ping with auth credentials), MeiliSearch (`/health` on port 7700), PostgreSQL (`pg_isready`), MinIO (`/minio/health/live` on port 9000), RAG API (`/health` on port 8000). Use correct URL `/health` not `/api/health`.
- **REQ-027-A:** Add health checks for monitoring infrastructure: Prometheus (`/-/healthy` on port 9090) and Grafana (`/api/health` on port 3000). If either is unhealthy for >5 minutes, a simple watchdog cron job should send a notification (email or webhook) independent of the Prometheus alerting pipeline. This prevents silent monitoring failure.
- **REQ-028:** Deploy Prometheus + Grafana stack on the same server as the application. This is a SPOF (acknowledged in RISK-005), but acceptable for a small team on a single server because: (a) REQ-031 (external uptime monitoring) is the primary alerting mechanism for "is the service up" and is independent of this server, (b) Prometheus/Grafana serve as diagnostics and trend analysis, not as the sole alerting path for critical outages, (c) a separate monitoring host doubles infrastructure cost and operational burden. Add Prometheus and Grafana containers to health check monitoring (REQ-027-A) so their failures are at least logged.
- **REQ-029:** Deploy `librechat_exporter` (virtUOS/librechat_exporter) for application-level Prometheus metrics (token usage, user activity, conversation counts).
- **REQ-030:** Deploy `mongodb_exporter` and `postgres_exporter` for database metrics (connection pools, query performance, replication, memory).
- **REQ-031:** Set up external uptime monitoring independent of the application server (UptimeRobot, Better Stack, or Azure Monitor). Monitor: `https://chat.memodo-eng.de`, `https://chat.memodo-eng.de/health`, `https://minio-console.memodo-eng.de`.
- **REQ-032:** Configure alerting rules for critical conditions: service down (>2 min), API 5xx rate >5% (5 min), MongoDB restart loop (>3 in 10 min), disk >80% (warning) / >90% (critical), container memory >85% of limit, TLS cert expiry <14 days, backup failure, daily Azure OpenAI cost threshold exceeded, PII circuit breaker open, Redakt API down (>1 min if PII enabled), high PII block rate (>50 events/hour), admin reporting abuse (>60 calls/min).
- **REQ-033:** Enable Azure OpenAI Diagnostic Settings: route `Audit`, `RequestResponse`, `AzureOpenAIRequestUsage`, and `Trace` logs to Log Analytics workspace.
- **REQ-034:** Set up Azure Budget with alert thresholds at 50%, 75%, 90% of monthly budget. Configure action group for email notifications.
- **REQ-035:** Add storage size monitoring for all data volumes: MongoDB (`./data-node`), pgvector (`pgdata2`), MinIO (`./minio-data`), MeiliSearch (`./meili_data_v1.35.1`). Alert at 80% disk capacity.

#### Phase 4: Guardrails and Cost Control

- **REQ-036:** Review and tune rate limiting values in `librechat.yaml` and `.env.prod`: `LOGIN_MAX`, `LOGIN_WINDOW`, `REGISTER_MAX`, `REGISTER_WINDOW`, `CONCURRENT_MESSAGE_MAX`, `MESSAGE_IP_MAX`, `MESSAGE_IP_WINDOW`, file upload limits. Enable `LIMIT_CONCURRENT_MESSAGES=true` and `LIMIT_MESSAGE_IP=true`.
- **REQ-037:** Enable token balance system in `librechat.yaml`: `balance.enabled: true`, configure `startBalance`, `autoRefillEnabled: true`, `refillIntervalValue`, `refillIntervalUnit`, `refillAmount`. This acts as a per-user cost cap.
- **REQ-038:** Enable and tune the ban/violation system: `BAN_VIOLATIONS=true`, `BAN_DURATION=7200000` (2 hours), `BAN_INTERVAL=20` (ban after 20 violations). Review violation categories and adjust thresholds for production traffic patterns.
- **REQ-039:** Set container resource limits in `docker-compose.prod.yml` using `deploy.resources.limits` syntax: API (2G memory, 2.0 CPUs), MongoDB (4G memory, 1G reservation).
- **REQ-039-A:** (Validation step) After deploying REQ-039, verify resource limits are enforced: run `docker stats` and confirm the MEM LIMIT column shows configured values for each service. If limits are not enforced (MEM LIMIT shows 0 or host total), convert to legacy `mem_limit`/`cpus` syntax and re-verify. Document which syntax was used.
- **REQ-040:** Deploy Redakt API service as a Docker container on `caddy_net`. Add to `docker-compose.prod.yml` with the same production treatment as other services: pinned image version, health check (`/health` on port 8000, interval 30s, retries 3), resource limits (1G memory, 1.0 CPU), log rotation (`json-file`, `max-size: 10m`, `max-file: 3`), and `restart: unless-stopped`. Configure PII detection: `PII_DETECTION=true`, `PII_DETECTION_API_URL=http://redakt-api:8000`, `PII_DETECTION_MODE=warn` (start in warn mode to audit false positives before switching to block).
- **REQ-041:** Configure PII detection parameters: `PII_DETECTION_FAIL_OPEN=true` (fail-open) as the initial production default, `PII_DETECTION_TIMEOUT=2000`, `PII_DETECTION_SCORE_THRESHOLD=0.7`, `PII_DETECTION_EXEMPT_ROLES=admin`. Rationale for fail-open: fail-closed (`FAIL_OPEN=false`) blocks ALL messages when Redakt is unavailable, which contradicts the service availability goal and creates a fragile dependency. Fail-open preserves service availability while PII events are still logged for audit. Switch to fail-closed only after: (a) Redakt has demonstrated >99.5% uptime over 30 days in production, (b) a documented manual override procedure exists (see REQ-041-A), and (c) the Redakt health alert (REQ-032) is confirmed working. Document the switch criteria and get stakeholder sign-off before changing.
- **REQ-041-A:** Document a concrete PII detection manual override procedure in the operational runbook (REQ-046). The procedure must specify: (1) exact commands to switch from fail-closed to fail-open (`PII_DETECTION_FAIL_OPEN=true` in `.env.prod`, then `./prod.sh restart api`), (2) exact commands to disable PII detection entirely (`PII_DETECTION=false`), (3) who is authorized to execute the override, (4) what to communicate to stakeholders, (5) how to re-enable after Redakt recovery. This procedure is the prerequisite for ever switching to fail-closed mode.
- **REQ-042:** (Code fix) Add rate limiting to admin reporting endpoints (`/api/admin/usage/*`). Target: 60 req/min per user. These endpoints run MongoDB aggregation pipelines and can degrade database performance without rate limiting. Track as issue if not fixed in this branch.
- **REQ-043:** (Code fix) Fix MongoDB aggregation timeout detection in admin reporting to return HTTP 504 instead of 500.

#### Phase 5: Operational Maturity

- **REQ-044:** Establish update/patching cadence: (a) enable `unattended-upgrades` for OS security patches and verify it is active (`systemctl status unattended-upgrades`), (b) schedule monthly Docker image update review (calendar event, first Monday of each month), (c) subscribe to LibreChat GitHub release notifications. Verification: `unattended-upgrades` is enabled and has run at least once (check `/var/log/unattended-upgrades/`). Calendar event exists. GitHub watch is set to "Releases only" on `danny-avila/LibreChat`. A missed monthly review is detected by a calendar reminder, not by tooling -- this is acceptable for a small team.
- **REQ-045:** Define data retention policies: temporary chats (already have `TEMP_CHAT_EXPIRY_MINUTES`), GuardrailEvent retention period, transaction log archival schedule. Monitor storage growth before implementing aggressive cleanup.
- **REQ-046:** Document operational runbooks covering at minimum: (1) service restart procedures for each container, (2) backup restore procedures for MongoDB, PostgreSQL, and MinIO (copy from REQ-024 test results), (3) secret rotation procedures with rotation cadence (annually for JWT secrets, immediately upon team member departure; document which secrets require service restart vs. which take effect immediately), (4) database access via SSH tunnel, (5) PII circuit breaker behavior and recovery (REQ-041-A), (6) log level escalation during incidents (see REQ-014-A). Acceptance criteria: each runbook must contain exact commands (copy-pasteable), expected output, and a "verify success" step. Runbooks are reviewed by a second team member before Phase 5 is considered complete.
- **REQ-047:** SSH hardening: key-only authentication, disable password login, install and configure fail2ban.
- **REQ-048:** Establish GDPR data subject request procedures: right to erasure (verify cascading deletion across all collections, MinIO files, pgvector embeddings), right to data portability (document export capabilities). Verify Azure OpenAI DPA is in place. Verification test: create a test user, generate conversations with file uploads, then execute the erasure procedure and confirm no data remains in: MongoDB `users`, `conversations`, `messages`, `transactions`, `guardrailevents`, `files` collections; MinIO uploaded files; pgvector embeddings. Document any manual steps required beyond LibreChat's built-in deletion.
- **REQ-049:** Verify `TRUST_PROXY=1` matches the actual proxy chain depth (single Caddy hop). Incorrect value breaks rate limiting (wrong client IP) and secure cookie detection.

#### Cross-Phase Requirements

- **REQ-050:** All cron entries for backup automation (REQ-019, REQ-020, REQ-021, REQ-022) must be defined in a `crontab.prod` file committed to version control (contains no secrets -- only schedule and script paths). Document installation procedure (`crontab crontab.prod`) in the operational runbook. Cron jobs must run as the same user that runs Docker commands. Cron failures (exit code != 0) must be detected separately from backup script failures -- add `MAILTO` or a wrapper that sends alerts on non-zero exit.
- **REQ-051:** Deploy `node_exporter` on the host for host-level Prometheus metrics: CPU usage, memory usage, disk I/O, and network throughput. These metrics are required for diagnosing performance issues and are implicitly referenced by alert conditions (disk >80%, container memory >85% of limit requires knowing host memory context). Add as a systemd service or Docker container with host namespace access.
- **REQ-052:** Verify SSRF protection defaults are active in `librechat.yaml`. LibreChat blocks localhost, private IPs, and `.internal/.local` TLDs by default for Actions and MCP connections. If any internal services need to be reached (e.g., internal APIs), add them to `actions.allowedDomains` or `mcpSettings.allowedDomains` explicitly. Document the current allowlist.
- **REQ-053:** Address configuration drift between `.env` and `.env.prod` after MongoDB auth migration (REQ-006). Once MongoDB requires authentication (server-side change), the dev `.env` file must also be updated with credentials, or a separate dev MongoDB instance must be used. Document the chosen approach. Options: (a) update `.env` with the same credentials (simplest, dev and prod share the same MongoDB), (b) run a separate unauthenticated MongoDB for development on a different port.

#### Explicitly Out of Scope (Research Findings Not Addressed)

The following research findings from RESEARCH-010 are intentionally excluded from this spec with documented rationale:

- **Disk encryption (LUKS)** (Research Section 6.12): Out of scope for this spec. Disk encryption is a host-level provisioning concern, not an application/container configuration. The production server should have full-disk encryption enabled at the OS/hosting level. This is a recommendation for the server provisioning checklist, not a Docker Compose requirement. If GDPR audit requires at-rest encryption specifically for GuardrailEvent data, revisit as a separate infrastructure task.
- **Docker socket security / rootless Docker** (Research Section 6.12): Out of scope. Rootless Docker has compatibility limitations with bind mounts and network plugins that could break the current deployment. The Docker socket is not exposed over TCP (default). Document as a future hardening item for the next infrastructure review cycle.
- **Loki / log aggregation** (Research Section 3.4): Out of scope for initial production deployment. Log rotation (REQ-015) and structured JSON logging (REQ-014) are sufficient for a small team. Centralized log search adds operational complexity (another service to deploy, monitor, and back up). Revisit after 3 months of production operation if incident response is hampered by log access.
- **MinIO bucket versioning** (Research Section 2.5): Out of scope. Daily MinIO backups (REQ-020) cover data loss scenarios. Bucket versioning protects against accidental deletion of individual files, which is a lower-priority risk than complete data loss. Can be enabled later with a single `mc version enable` command if needed.
- **Community tool jgera/librechat-backup** (Research Section 2.3): Evaluated and not adopted. Custom backup scripts (REQ-019) provide more control over credentials, scheduling, retention, and alerting integration. The community tool may not support authenticated MongoDB or the specific retention policy needed. Revisit if backup script maintenance becomes burdensome.
- **MongoDB slow query alert (>1s)** (Research Section 3.3): Partially addressed. The alert is not in the initial REQ-032 alert list because slow query logging requires MongoDB profiler to be enabled (`db.setProfilingLevel(1, { slowms: 1000 })`), which adds overhead. Add to the alert list after 1 month of production operation once baseline query performance is established. Track as a Phase 3 follow-up item.
- **PII guardrails gate for wider rollout** (Research stakeholder validation): The spec deploys PII in warn mode (REQ-040) in Phase 4. "Wider rollout" is not yet defined because the current user base is the Memodo engineering team only. When rollout to additional teams or external users is planned, PII detection in block mode and the switch criteria (REQ-041) become a gate. This is a future product decision, not a spec requirement.

### Non-Functional Requirements

- **PERF-001:** Health check response time must be <1 second for all services. Health check intervals: 30 seconds. Failure threshold: 3 retries before marking unhealthy.
- **PERF-002:** Backup operations must complete within the maintenance window: MongoDB `mongodump` <30 minutes, PostgreSQL `pg_dump` <15 minutes, MinIO `mc mirror` <60 minutes (dependent on file volume).
- **PERF-003:** Container resource limits must be enforced (verified via `docker stats` MEM LIMIT column). API: 2G max memory. MongoDB: 4G max memory.
- **PERF-004:** Docker log files must not exceed 50MB total per service (10m x 5 files for API, 10m x 3 files for databases).
- **SEC-001:** No database service (MongoDB, PostgreSQL, MeiliSearch) shall be accessible from outside the Docker network or host. Verify with external `nmap` scan.
- **SEC-002:** All secrets must be cryptographically random (minimum 32 bytes hex for keys, 16 bytes hex for IVs). No default/example values in production.
- **SEC-003:** MongoDB must require authentication for all connections. No `--noauth` in production.
- **SEC-004:** CORS must restrict origins to `https://chat.memodo-eng.de` only. No wildcard origins. Verification: send a preflight request (`OPTIONS`) with `Origin: https://evil.example.com` and verify the response does NOT include `Access-Control-Allow-Origin: *` or `Access-Control-Allow-Origin: https://evil.example.com`. Also verify that a request with `Origin: https://chat.memodo-eng.de` returns the correct `Access-Control-Allow-Origin` header. Note: CORS is enforced by browsers, not servers -- `curl` requests without `Origin` headers will succeed regardless. The test must check response headers, not request success.
- **SEC-005:** Registration must be restricted to authorized email domains (`memodo.de`, `memodo-eng.de`) via `librechat.yaml` `registration.allowedDomains`. Email verification must be required (`ALLOW_UNVERIFIED_EMAIL_LOGIN=false`).
- **SEC-006:** Production environment must use `NODE_ENV=production` for secure cookie flags (HttpOnly, Secure, SameSite).
- **SEC-007:** All Docker images must be pinned to specific version tags. No `:latest` tags in `docker-compose.prod.yml`.
- **SEC-008:** `.env` and `.env.prod` files must never be committed to version control. Verify `.gitignore` coverage.
- **AVAIL-001:** RPO <= 24 hours for all critical data stores (MongoDB, MinIO). Backup frequency must match or exceed this target.
- **AVAIL-002:** RTO <= 4 hours for complete server failure (FAIL-008). RTO <= 1 hour for single-service recovery. Documented restore procedures must be tested and timed. A full disaster recovery drill (FAIL-008 scenario) must complete within 4 hours to pass. Single-service restore drills must complete within 1 hour.
- **AVAIL-003:** External uptime monitoring must be independent of the application server. Alert within 5 minutes of downtime.
- **OPS-001:** All operational procedures (backup, restore, secret rotation, failover) must be documented in runbooks before Phase 5 is considered complete.

## Edge Cases (Research-Backed)

### Known Production Scenarios

- **EDGE-001: MongoDB crash loop on transient connectivity**
  - Research reference: Section 3.6, GitHub Issue #11808
  - Current behavior: Transient MongoDB connectivity issues trigger `process.exit(1)`. Each restart triggers full MeiliSearch index re-sync, creating a cascading crash loop. Reported: 5 crashes in ~43 minutes under load.
  - Desired behavior: Container restarts are monitored and alerted on. MongoDB connection pool settings are tuned to reduce crash frequency. Alert fires on >3 restarts in 10 minutes.
  - Test approach: Monitor container restart count after deployment. Simulate MongoDB connectivity interruption and verify alerting fires.

- **EDGE-002: PII circuit breaker opens**
  - Research reference: Section 4.8 (circuit breaker: 5 consecutive failures, 30s open window)
  - Current behavior: If Redakt API has 5 consecutive failures, circuit opens for 30 seconds. In fail-open mode (initial default per REQ-041), messages pass through unscanned. In fail-closed mode (future state), ALL messages are blocked during this window.
  - Desired behavior: Alert fires immediately on circuit breaker state transition. Ops team has documented recovery procedure (REQ-041-A). In fail-open mode, messages continue but PII protection is degraded. In fail-closed mode, messages are blocked but PII compliance is maintained.
  - Test approach: Stop Redakt container, send 5+ messages, verify circuit opens and alert fires. In fail-open mode, verify messages still pass through. Restart Redakt, verify circuit closes and PII scanning resumes.

- **EDGE-003: MongoDB auth migration on existing data directory**
  - Research reference: Section 6.2, review HIGH-1
  - Current behavior: `MONGO_INITDB_*` env vars are silently ignored on existing data directories. Adding `--auth` without pre-created users locks out all connections.
  - Desired behavior: Multi-step migration procedure (REQ-006) is followed exactly. Rollback step documented (remove `--auth`, restart).
  - Test approach: Follow migration steps on a staging copy. Verify application connects after enabling auth. Test rollback by removing `--auth`.

- **EDGE-004: NODE_ENV=production invalidates active sessions**
  - Research reference: Section 6.3, review LOW-3
  - Current behavior: Changing `NODE_ENV` to `production` adds Secure and SameSite flags to cookies, invalidating all active sessions.
  - Desired behavior: Planned as a maintenance window. Users are informed they will need to re-login.
  - Test approach: Verify session invalidation occurs after change. Verify new sessions work correctly with secure cookie flags.

- **EDGE-005: Docker port mapping bypasses host firewall**
  - Research reference: Section 6.12
  - Current behavior: Docker's port mapping can bypass `iptables`/`ufw` rules, making database ports accessible externally even with firewall rules.
  - Desired behavior: Database ports are removed from Docker port mapping in `docker-compose.prod.yml` (not relying on firewall alone). Verified with external `nmap`.
  - Test approach: After deployment, run `nmap` from an external host against all known ports (27017, 5432, 9000, 7700).

- **EDGE-006: mongodump inconsistency during active writes**
  - Research reference: Section 2.3, review MEDIUM-1
  - Current behavior: `mongodump` without `--oplog` is not crash-consistent. Backup may contain partially-written data or inconsistent cross-collection state.
  - Desired behavior: Risk is documented and accepted for small deployment. For tighter consistency, either pause API during backup or convert to single-node replica set for `--oplog` support.
  - Test approach: Restore a backup taken during active writes. Verify data integrity (conversations have matching messages, transactions reference valid users).

- **EDGE-007: MinIO backup container lacks env vars**
  - Research reference: Section 2.5, review v2 MEDIUM-4
  - Current behavior: `docker run` for `minio/mc` does not automatically inherit host environment variables. `$MINIO_ROOT_USER` and `$MINIO_ROOT_PASSWORD` are empty inside the container.
  - Desired behavior: Backup command uses `-e` flags or `--env-file .env.prod` to pass credentials into the mc container.
  - Test approach: Run the backup command and verify it completes successfully. Check that `mc alias set` succeeds (would fail with empty credentials).

- **EDGE-008: deploy.resources.limits silently ignored**
  - Research reference: Section 6.6, review HIGH-3
  - Current behavior: `deploy.resources.limits` may be silently ignored depending on Docker Engine cgroup configuration.
  - Desired behavior: After adding resource limits, verify enforcement via `docker stats` MEM LIMIT column. If ignored, fall back to legacy `mem_limit`/`cpus` syntax.
  - Test approach: Deploy with `deploy.resources.limits`. Run `docker stats`. Confirm MEM LIMIT column shows configured values for each service.

- **EDGE-009: Monitoring SPOF on same server**
  - Research reference: Section 3.2, review MEDIUM-5
  - Current behavior: If Prometheus/Grafana run on the same server, a server failure takes down both application and monitoring.
  - Desired behavior: External uptime check (REQ-031) operates independently. Alert fires even when the server is completely down. Internal metrics acknowledged as unavailable during total server failure.
  - Test approach: Verify external uptime monitor fires alert when the server is unreachable (not just when the app is down).

- **EDGE-010: MongoDB health check needs auth credentials after migration**
  - Research reference: review v2 MEDIUM-5
  - Current behavior: Health check uses `mongosh --eval "db.adminCommand('ping')"` which works without auth but will fail after enabling `--auth`.
  - Desired behavior: Health check in `docker-compose.prod.yml` includes credentials or uses connection string with env var substitution.
  - Test approach: After enabling MongoDB auth, verify health check passes. Check `docker inspect <container>` for health status.

- **EDGE-011: PII text extraction stops at first matched body field**
  - Research reference: Section 4.8, gap #1
  - Current behavior: Text extraction from request body stops at first matched field. PII in secondary fields (e.g., `messages` when `text` also exists) may not be checked.
  - Desired behavior: Documented as known limitation. Monitor GuardrailEvent logs for patterns suggesting missed PII.
  - Test approach: Send requests with PII in different body fields. Verify detection coverage.

- **EDGE-012: Backup script runs during MongoDB auth migration**
  - Research reference: Critical review finding EDGE-MISSING-001
  - Current behavior: If the cron-based backup fires while MongoDB is mid-migration (auth being enabled, users being created), the backup script may fail authentication or produce an inconsistent backup.
  - Desired behavior: Disable cron-based backups before starting MongoDB auth migration (REQ-006). Re-enable after migration is verified. Document this in the Phase 1 ordering checklist.
  - Test approach: Verify backup script exit code after auth migration is complete. Verify no backup ran during the migration window.

- **EDGE-013: Simultaneous resource exhaustion during backup**
  - Research reference: Critical review finding EDGE-MISSING-002
  - Current behavior: MongoDB hits its 4G memory limit (REQ-039) while a `mongodump` backup is running (REQ-019). The backup may fail or be OOM-killed by Docker.
  - Desired behavior: Schedule backups during off-peak hours (2-4 AM). MongoDB memory limit (4G) accounts for baseline usage plus backup overhead. If OOM kills occur during backup, increase MongoDB memory limit or schedule backups when API is quiesced.
  - Test approach: Run a `mongodump` during normal load and monitor `docker stats` for MongoDB memory usage. Verify backup completes without OOM kill.

- **EDGE-014: Clock drift affects backup retention**
  - Research reference: Critical review finding EDGE-MISSING-003
  - Current behavior: Backup scripts use `date` for timestamp naming. If server clock drifts, retention pruning (30 days) may delete recent backups or retain too many old ones.
  - Desired behavior: Ensure NTP is active on the production server (`timedatectl status` shows NTP synchronized). Add NTP verification to the Phase 1 pre-flight checklist.
  - Test approach: Verify `timedatectl` shows NTP synchronized. Verify backup file timestamps are within 1 second of actual time.

- **EDGE-015: Partial Phase 1 deployment breaks backup credentials**
  - Research reference: Critical review finding EDGE-MISSING-004
  - Current behavior: If MongoDB auth (REQ-006) is enabled but backup scripts are not updated with credentials, backups silently fail with authentication errors.
  - Desired behavior: Phase 1 ordering (see Implementation Notes) explicitly sequences backup credential updates immediately after MongoDB auth migration. A post-Phase-1 validation step verifies all backup scripts run successfully with the new credentials.
  - Test approach: After completing Phase 1, manually trigger each backup script and verify successful completion.

- **EDGE-016: LibreChat upgrade changes health endpoint**
  - Research reference: Critical review finding EDGE-MISSING-005
  - Current behavior: Health checks are hardcoded to `/health` on port 3080. A future LibreChat version could change this endpoint.
  - Desired behavior: When upgrading LibreChat image version (REQ-003), include health endpoint verification in the upgrade checklist: `curl -f http://localhost:3080/health` after container starts. If the endpoint changes, update `docker-compose.prod.yml` health checks before rolling out.
  - Test approach: After any image version bump, verify health check passes within 60 seconds of container start.

- **EDGE-017: Feature interaction cascade (PII + rate limiting + ban system)**
  - Research reference: Critical review finding (new risk, feature interaction)
  - Current behavior: When PII detection (REQ-040), rate limiting (REQ-036), ban system (REQ-038), and token balance (REQ-037) are all active, interactions are undefined. A PII block could potentially count as a ban violation, leading to user bans from false positives.
  - Desired behavior: PII detection blocks do NOT count as ban violations. PII blocks return HTTP 400 with a PII-specific error type that the violation system ignores. Rate limit rejections (HTTP 429) DO count as violations (they indicate potential abuse). Document this interaction matrix in the operational runbook.
  - Test approach: Enable all four systems. Send a message containing PII. Verify the violation count does NOT increment. Send messages exceeding the rate limit. Verify the violation count DOES increment.

## Failure Scenarios

### Graceful Degradation

- **FAIL-001: MongoDB becomes unavailable**
  - Trigger condition: MongoDB container crashes, runs out of memory, or disk full
  - Expected behavior: API health check fails within 30 seconds. Docker restarts MongoDB (restart policy). If restart loop detected (>3 in 10 min), critical alert fires. API returns 503 to users during downtime.
  - User communication: "Service temporarily unavailable. Please try again in a few minutes."
  - Recovery approach: Check MongoDB logs (`docker compose logs mongodb`). If disk full, prune old data or expand storage. If OOM, increase memory limit. If data corruption, restore from most recent backup (REQ-019).

- **FAIL-002: Redakt API unavailable (PII detection enabled)**
  - Trigger condition: Redakt container crashes or becomes unresponsive
  - Expected behavior (fail-open mode, initial default per REQ-041): Circuit breaker opens after 5 consecutive failures (30s window). Messages pass through without PII scanning. Alert fires on circuit breaker transition. PII events are NOT logged during this window (no Redakt to analyze).
  - Expected behavior (fail-closed mode, future state): Circuit breaker opens, ALL messages are blocked. Alert fires on circuit breaker transition. User receives HTTP 503.
  - User communication (fail-open): No user-visible impact, but PII protection is degraded. Ops team is alerted.
  - User communication (fail-closed): HTTP 503 with message indicating the service is temporarily unable to process messages.
  - Recovery approach: Restart Redakt container (`./prod.sh restart redakt-api`). Circuit breaker auto-recovers after 30 seconds of successful checks. If Redakt repeatedly fails, check container logs and resource limits. Follow the manual override procedure in the operational runbook (REQ-041-A) if needed.

- **FAIL-003: Disk full**
  - Trigger condition: Any data volume exceeds capacity. Most common cause: Docker container logs without rotation (Section 6.11).
  - Expected behavior: Disk >80% triggers warning alert. Disk >90% triggers critical alert. Containers may crash or become read-only.
  - User communication: Service becomes unresponsive. No graceful error if disk is completely full.
  - Recovery approach: Identify largest consumers (`du -sh` on data directories and `/var/lib/docker/containers/`). Prune Docker logs if rotation was not configured. Prune old backups. Expand disk if needed.

- **FAIL-004: Secret compromise / credential leak**
  - Trigger condition: `.env.prod` or credentials exposed (accidental commit, unauthorized access)
  - Expected behavior: No automatic detection (this is a manual discovery or external report).
  - User communication: Plan maintenance window for credential rotation. All active sessions will be invalidated.
  - Recovery approach: Regenerate all affected secrets (REQ-005). Rotate MongoDB, PostgreSQL, MinIO passwords. Update `.env.prod`. Restart all services. Review access logs for unauthorized activity. If JWT secrets were compromised, all tokens are invalid -- users must re-login.

- **FAIL-005: Backup failure**
  - Trigger condition: Backup script exits with non-zero code (disk full, credentials wrong, Docker not running)
  - Expected behavior: Alert fires within backup schedule window (REQ-025). Backup is retried on next schedule.
  - User communication: None (internal ops concern).
  - Recovery approach: Check backup script logs. Most common causes: disk full (prune old backups), credentials changed (update backup script), container not running (check Docker status).

- **FAIL-006: Azure OpenAI rate limit or outage**
  - Trigger condition: Azure OpenAI returns 429 (rate limit) or 503 (service unavailable)
  - Expected behavior: LibreChat surfaces error to user. Rate limit headers (`x-ratelimit-remaining-tokens`) indicate when to retry. Azure Monitor metrics show elevated error rates.
  - User communication: "The AI service is temporarily busy. Please try again in a moment."
  - Recovery approach: Check Azure OpenAI status page. If rate limited, consider reducing concurrent users or increasing provisioned throughput. Alert fires on sustained 5xx rate.

- **FAIL-007: TLS certificate expiry**
  - Trigger condition: Let's Encrypt certificate for `*.memodo-eng.de` fails to auto-renew (Caddy handles this)
  - Expected behavior: Alert fires at <14 days to expiry (REQ-032). Caddy normally auto-renews at 30 days.
  - User communication: Browser shows security warning if cert expires.
  - Recovery approach: Check Caddy logs for renewal errors. Verify DNS and port 80/443 are accessible for ACME challenges. If Caddy data volume is lost, restore from backup (REQ-026) or wait for fresh issuance (may hit Let's Encrypt rate limits).

- **FAIL-008: Complete server failure**
  - Trigger condition: Hardware failure, hosting provider outage
  - Expected behavior: External uptime monitor (REQ-031) fires alert within 5 minutes. Internal monitoring is also down (SPOF -- EDGE-009).
  - User communication: Service is completely unavailable.
  - Recovery approach: Provision new server. Restore from off-host backups (REQ-023). Redeploy using `docker-compose.prod.yml` + `.env.prod` from config backup (REQ-022). Restore MongoDB, MinIO, and PostgreSQL data. Trigger MeiliSearch re-index (see REQ-024). Update DNS if IP changed. Expected recovery time: within RTO (4 hours) if backups and runbooks are current. If local backup cache (REQ-023-A) is available on a surviving disk, recovery may be faster.

## Implementation Constraints

### Context Requirements
- **Maximum context utilization:** <40% during implementation
- **Essential files for implementation:**
  - `docker-compose.yml` -- base service definitions, understand current structure
  - `docker-compose.override.yml` -- dev overrides to understand what prod must override
  - `.env` -- current environment variable configuration, identify all variables that need production values
  - `librechat.yaml` -- application configuration for rate limits, balance, registration, guardrails
  - `api/server/index.js:94,116` -- health endpoint and CORS configuration verification
- **Files that can be delegated to subagents:**
  - Backup scripts (cron, shell scripts) -- standalone, no codebase dependencies
  - Prometheus/Grafana configuration -- standalone infrastructure
  - Runbook documentation -- text-only, no code dependencies
  - Host firewall verification -- operational commands

### Technical Constraints
- Single-server Docker Compose deployment (no Kubernetes, no multi-host)
- Docker Compose v5.1.0 installed -- supports Compose Spec including `deploy.resources`
- Caddy reverse proxy is in a separate repo (`/Users/pablooliva/Dev/infra/`) with shared `caddy_net` external Docker network
- Azure OpenAI is the LLM backend -- no direct OpenAI API access
- `.env` is shared between dev and prod; `.env.prod` is production-only overlay
- MongoDB has existing data in `./data-node:/data/db` -- cannot use `MONGO_INITDB_*` for initial user creation
- Redakt API is required for PII detection but is a separate Docker service not yet deployed
- No application code changes except REQ-042 (admin rate limiting) and REQ-043 (timeout codes)

## Validation Strategy

### Automated Testing
- Unit Tests:
  - [ ] N/A -- this spec is infrastructure/configuration, not application code. Exceptions below.
  - [ ] REQ-042: Unit test for admin endpoint rate limiter (mock 61 requests in 1 minute, verify 429 response)
  - [ ] REQ-043: Unit test for MongoDB timeout returning 504 (mock aggregation timeout)
- Integration Tests:
  - [ ] Health check endpoints respond within 1 second for all services (PERF-001)
  - [ ] MongoDB authentication works after migration (REQ-006): API connects with new credentials
  - [ ] Backup and restore round-trip for MongoDB: dump, drop collection, restore, verify data
  - [ ] Backup and restore round-trip for MinIO: mirror, delete file, restore, verify file
  - [ ] PII detection in warn mode logs GuardrailEvent without blocking message (REQ-040)
  - [ ] Token balance system blocks messages when balance reaches zero (REQ-037)
- Edge Case Tests:
  - [ ] EDGE-001: Monitor container restart count; simulate MongoDB interruption
  - [ ] EDGE-002: Stop Redakt, send messages, verify circuit breaker opens and alert fires
  - [ ] EDGE-003: Follow MongoDB auth migration on staging copy, verify connectivity
  - [ ] EDGE-005: External `nmap` scan confirms no database ports exposed
  - [ ] EDGE-007: Run MinIO backup command, verify credentials are passed correctly
  - [ ] EDGE-008: Check `docker stats` MEM LIMIT column after deploying resource limits
  - [ ] EDGE-010: Verify MongoDB health check passes after enabling auth
  - [ ] EDGE-013: Run `mongodump` during normal load, verify no OOM kill via `docker stats`
  - [ ] EDGE-015: After Phase 1, manually trigger all backup scripts and verify success
  - [ ] EDGE-017: With all four systems active (PII, rate limit, ban, balance), verify PII blocks do not increment violation count

### Manual Verification
- [ ] External `nmap` scan from outside the server: only ports 80, 443, 22 open (SEC-001)
- [ ] `docker stats` shows correct MEM LIMIT values for all services (PERF-003)
- [ ] Attempt to connect to MongoDB from external host without SSH tunnel -- should fail (SEC-001)
- [ ] Send preflight request with `Origin: https://evil.example.com` header and verify `Access-Control-Allow-Origin` response header does NOT allow it. Verify `Origin: https://chat.memodo-eng.de` IS allowed (SEC-004)
- [ ] Attempt registration with non-company email domain -- should be rejected (SEC-005)
- [ ] Verify Azure Budget alert is configured and fires at test threshold (REQ-034)
- [ ] Verify external uptime monitor fires alert when service is stopped (AVAIL-003)
- [ ] Perform full disaster recovery drill: restore from backup on fresh local Docker environment. Time the entire procedure. Must complete within 4 hours (AVAIL-002). Record actual time for future RTO refinement

### Performance Validation
- [ ] Health check response times <1 second (PERF-001)
- [ ] MongoDB backup completes within 30 minutes (PERF-002)
- [ ] No disk space growth from Docker logs over 48-hour period with rotation enabled (PERF-004)
- [ ] API response times unchanged after enabling auth, CORS, and production logging
- [ ] Admin reporting endpoints remain responsive under normal load (pre-rate-limiter baseline)

## Dependencies and Risks

### External Dependencies
- **LibreChat release images** -- must verify `librechat:v0.8.4` (or current stable) is available in `registry.librechat.ai`. RAG API image versioning may differ.
- **Redakt API** -- required for PII detection (Phase 4). Must be deployable as a Docker container on `caddy_net`.
- **Azure OpenAI** -- LLM backend. Budget alerts and diagnostic settings require Azure portal access.
- **External uptime service** -- UptimeRobot, Better Stack, or Azure Monitor for independent monitoring.
- **Off-host backup storage** -- S3 bucket, NAS, or equivalent for disaster recovery.
- **Prometheus exporters** -- `librechat_exporter` (community), `mongodb_exporter`, `postgres_exporter` are third-party.
- **Let's Encrypt** -- TLS certificates via Caddy auto-renewal. Rate limits apply during recovery.

### Identified Risks
- **RISK-001: MongoDB auth migration causes outage.** Mitigation: follow exact multi-step procedure in REQ-006. Test on staging first. Have rollback step ready (remove `--auth`). Severity: HIGH if procedure is not followed correctly.
- **RISK-002: Dev-to-release image switch introduces behavioral differences.** Mitigation: pin to specific version, test in staging before production cutover. Watch for MongoDB version compatibility (Issue #10304). Severity: MEDIUM.
- **RISK-003: `deploy.resources.limits` silently ignored.** Mitigation: verify with `docker stats` immediately after deployment (REQ-039-A). Fall back to `mem_limit`/`cpus` if needed. Severity: MEDIUM. Rationale for upgrade from LOW: if limits are ignored, the alerting threshold "container memory >85% of limit" (REQ-032) is meaningless -- alerts will never fire because there is no limit to measure against. This creates a false sense of protection across two separate requirements.
- **RISK-004: Single-server deployment is a SPOF.** Mitigation: external uptime monitoring, off-host backups, documented recovery procedures. Full HA requires multi-server or Kubernetes -- out of scope. Severity: MEDIUM (accepted for small team deployment).
- **RISK-005: Monitoring on same server goes down with the application.** Mitigation: external uptime check (REQ-031) is independent. Monitoring stack health check (REQ-027-A) detects Prometheus/Grafana failures. Accept that internal metrics are unavailable during total server failure. Severity: MEDIUM. Rationale for upgrade from LOW: 12+ alert conditions route through Prometheus/Grafana (REQ-032). During non-fatal server degradation (high load, disk pressure), Prometheus may fail to scrape while the application limps along. External monitoring only catches "is the site up" -- it cannot detect disk >80%, high error rates, PII circuit breaker state, or backup failures.
- **RISK-006: Backup restore takes longer than RTO.** Mitigation: test restore procedures and measure actual times during DR drill. Keep most recent backup cached locally (REQ-023-A) for fast single-service recovery. RTO has been set to 4 hours for complete server failure (AVAIL-002) to reflect realistic recovery time. Severity: HIGH. Rationale for upgrade from MEDIUM: FAIL-008 recovery requires provisioning a new server, downloading off-host backups, restoring 3 data stores, redeploying the Docker stack, re-indexing MeiliSearch, and updating DNS. This realistically takes 2-4 hours for a small team, especially outside business hours. An untested RTO claim creates false confidence.
- **RISK-007: PII circuit breaker blocks all messages in fail-closed mode.** Mitigation: start in fail-open mode (REQ-041) and warn mode (REQ-040). Alert on circuit breaker transitions (REQ-032). Documented manual override procedure (REQ-041-A) with exact commands. Switch to fail-closed only after Redakt demonstrates >99.5% uptime over 30 days and override procedure is tested. Criteria for switching from warn to block mode: false positive rate <1% over 14 days of warn-mode operation, documented in REQ-041. Severity: HIGH (complete message blocking if Redakt is down in fail-closed mode).
- **RISK-008: CORS restriction breaks legitimate integrations.** Mitigation: verify all legitimate origins before restricting. Only `https://chat.memodo-eng.de` should be needed for the web UI. Severity: LOW.
- **RISK-009: Session invalidation from NODE_ENV change disrupts active users.** Mitigation: plan as maintenance window (REQ-009). Communicate to users. Severity: LOW (one-time disruption).
- **RISK-010: Feature interaction cascade -- PII + rate limiting + ban system.** When PII detection, rate limiting, ban system, and token balance are all active, undefined interactions could cause legitimate users to be banned due to PII false positives. Mitigation: PII blocks do NOT count as ban violations (EDGE-017). Document the interaction matrix. Test all four systems together before enabling in production. Severity: HIGH (legitimate user lockout).
- **RISK-011: Configuration drift between `.env` and `.env.prod` after MongoDB auth.** Once MongoDB auth is enabled (server-side change), the dev `.env` must also have valid credentials or dev environment breaks. Mitigation: document the approach in REQ-053 -- either update `.env` with credentials or run a separate dev MongoDB. Severity: MEDIUM (blocks development workflow if not addressed).

## Implementation Notes

### Suggested Approach

**Implementation order follows the 5-phase action plan from the research.** Each phase can be implemented independently, but phases build on each other:

1. **Phase 1 (Security Hardening)** -- REQ-001 through REQ-017, plus REQ-053. Start here. **Before starting Phase 1, take a full manual backup of all data stores and configuration files.** Create `docker-compose.prod.yml` and `.env.prod` first (REQ-001, REQ-002), then apply security changes in this order:
   1. REQ-001, REQ-002: Create prod compose file and helper script (foundation for everything else)
   2. REQ-005: Regenerate secrets (needed before any service restarts)
   3. REQ-017: Verify `.gitignore` coverage (before any secrets are written)
   4. REQ-006: MongoDB auth migration (highest risk -- do with rollback plan ready)
   5. REQ-053: Address dev `.env` credential drift immediately after MongoDB auth
   6. REQ-007, REQ-008: Change PostgreSQL and MinIO credentials
   7. REQ-013: Remove exposed MongoDB port (after REQ-006 is verified -- keep external access available for troubleshooting during migration)
   8. REQ-016: Verify host firewall
   9. REQ-010: CORS investigation and configuration
   10. REQ-011, REQ-012: Registration restriction and email verification
   11. REQ-015: Log rotation (before REQ-014 to avoid filling disk with warn-level JSON logs)
   12. REQ-014, REQ-014-A: Production logging configuration
   13. REQ-003, REQ-004: Switch to release images
   14. REQ-009: `NODE_ENV=production` (last -- causes session invalidation, plan as maintenance window)
   **Rollback checkpoint:** If any requirement in Phase 1 causes service degradation, revert to pre-phase backup. Specific rollbacks: MongoDB auth (remove `--auth`, restart), image switch (revert image tag in compose file), NODE_ENV (remove from `.env.prod`, restart).

2. **Phase 2 (Backups)** -- REQ-018 through REQ-026, plus REQ-050. Create backup scripts as standalone shell scripts. **Important:** Backup scripts must use the credentials set in Phase 1 -- verify each script runs successfully after Phase 1 (EDGE-015). Test restore procedures on a local Docker environment with a copy of production data (not on production itself). Set up cron jobs via `crontab.prod` file (REQ-050). **Rollback checkpoint:** Backup infrastructure is additive -- no rollback needed. If backup scripts fail, fix them without affecting the running application.

3. **Phase 3 (Monitoring)** -- REQ-027 through REQ-035, plus REQ-027-A, REQ-051. Health checks go into `docker-compose.prod.yml` (already created in Phase 1). Prometheus/Grafana deploy on the same server (REQ-028) as a separate compose stack or added to the existing one. **Rollback checkpoint:** Monitoring is additive. If Prometheus/Grafana cause resource contention, stop the monitoring containers without affecting the application.

4. **Phase 4 (Guardrails)** -- REQ-036 through REQ-043, plus REQ-039-A, REQ-041-A. Mostly configuration changes to `librechat.yaml` and `.env.prod`. The two code fixes (REQ-042, REQ-043) may require a separate feature branch. **Important:** Enable all four interaction systems (PII, rate limiting, ban, balance) and test the interaction matrix (EDGE-017) before considering Phase 4 complete. **Rollback checkpoint:** Each guardrail can be independently disabled by setting its toggle to false in `.env.prod` and restarting.

5. **Phase 5 (Operational Maturity)** -- REQ-044 through REQ-049, plus REQ-052. Documentation and procedures. Can be done in parallel with other phases.

**Staging environment note:** This spec references "test on staging" in several places. There is no dedicated staging environment. All references to "staging" mean: test on a local Docker environment (`docker compose up` with default `.env`) using a copy of production data. For MongoDB: `mongodump` from production, `mongorestore` to local. For destructive tests (DR drill, auth migration): use this local copy, never production. If budget and need justify a dedicated staging server in the future, define it as a separate infrastructure task.

### Areas for Subagent Delegation
- **Backup scripts:** Standalone shell scripts with cron scheduling. No codebase context needed beyond credentials.
- **Prometheus/Grafana configuration:** Docker compose for monitoring stack, Grafana dashboards, alert rules. Independent of application code.
- **`docker-compose.prod.yml` creation:** Can be generated from the skeleton in Section 6.10 of the research with all health checks, log rotation, and resource limits.
- **Runbook documentation:** Text-only operational procedures based on the research document.
- **Host security audit:** External `nmap` scan, firewall rule verification, SSH hardening -- operational commands.
- **Azure portal configuration:** Budget alerts, diagnostic settings -- Azure portal UI tasks.

### Critical Implementation Considerations
- **Dual env file strategy:** `.env` is for development, `.env.prod` is for production. Production-only settings (like `NODE_ENV=production`) go only in `.env.prod`. Shared settings go in both. The `prod.sh` script loads `.env.prod` via `--env-file`.
- **Docker Compose file merging:** When `-f` flags are specified, `docker-compose.override.yml` is NOT auto-loaded. All three files must be listed. For list-type keys (like `volumes`), the last file wins (replaces, not merges). This is how production removes dev volume mounts.
- **MongoDB migration is irreversible if users are created:** Once auth is enabled, going back to `--noauth` means the created users still exist but are unused. This is safe -- the rollback is simply removing `--auth` from the command.
- **Health check URL is `/health`, not `/api/health`:** The `/api` prefix is added by the reverse proxy, not the Express app. Inside the Docker network, use `http://localhost:3080/health`.
- **MongoDB health check needs credentials after auth migration:** Update the health check in `docker-compose.prod.yml` to include the connection string with credentials, or use env var substitution. Hardcoding passwords in the compose file is not ideal but acceptable for health checks since the file is not committed with credentials (they come from `.env.prod` or are managed separately).
- **Items explicitly skipped:** Redis (not needed for single instance, Section 6.7), email service (not needed with SSO, Section 6.8), OpenAI content moderation (Azure's built-in filtering covers this, Section 4.4). See also "Explicitly Out of Scope" section under Cross-Phase Requirements for 7 additional research findings with documented rationale for exclusion.
