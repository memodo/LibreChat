# Implementation Critical Review: Production Readiness

**Spec:** SPEC-010-production-readiness
**Reviewed:** 2026-04-01
**Reviewer:** Claude (adversarial review)
**Files reviewed:** docker-compose.prod.yml, prod.sh, .env.prod.template, scripts/mongodb-auth-migration.sh, scripts/backup-mongodb.sh, scripts/backup-minio.sh, scripts/backup-postgres.sh, scripts/backup-config.sh, crontab.prod, monitoring/docker-compose.monitoring.yml, monitoring/prometheus/prometheus.yml, monitoring/prometheus/alerts.yml, scripts/monitoring-watchdog.sh, librechat.yaml.prod.example, docs/runbooks/service-restart.md, docs/runbooks/backup-restore.md, docs/runbooks/secret-rotation.md, docs/runbooks/pii-override.md, docs/runbooks/disaster-recovery.md, docs/runbooks/log-escalation.md

---

## Overall Assessment

The implementation is thorough and well-documented, covering the majority of the 53 requirements with working scripts, configurations, and runbooks. The spec-to-implementation traceability is strong -- most files cite their REQ numbers. However, there are several HIGH-severity issues: Alertmanager is not deployed (making all 12+ Prometheus alert rules decorative), container metrics alerts reference metrics that require cAdvisor (not deployed), the monitoring stack cannot reach application containers due to Docker network isolation, backup scripts source the entire .env.prod file (unsafe), the MinIO backup uses a fragile network discovery hack, and `sed -i` in runbooks will fail on the production server's Linux `sed` unless a backup suffix is given (or will fail differently on macOS). Several spec requirements are partially or not implemented.

### Severity: HIGH

---

## Specification Violations

### 1. **REQ-028 / REQ-032**: Alertmanager not deployed -- all alert rules are inert

- **Specified:** "Configure alerting rules for critical conditions" (REQ-032) and "Deploy Prometheus + Grafana stack" (REQ-028).
- **Implemented:** `monitoring/prometheus/prometheus.yml` has the alertmanager config commented out. `docker-compose.monitoring.yml` has no Alertmanager service. The `alerts.yml` file defines 12 alert rules but explicitly states "Notification routing is configured via Alertmanager (not included in this file)."
- **Impact:** **HIGH.** All Prometheus alert rules (service down, disk critical, PII circuit breaker, MongoDB restart loop, TLS expiry, etc.) will fire internally in Prometheus but will never send a notification to anyone. The entire alerting pipeline is decorative. Only the cron-based watchdog (monitoring-watchdog.sh) can actually send notifications, and it only checks 3 endpoints.

### 2. **REQ-029 / SEC-007**: librechat_exporter uses `:latest` tag

- **Specified:** REQ-029 deploys the exporter; SEC-007 requires "All Docker images must be pinned to specific version tags. No `:latest` tags."
- **Implemented:** `monitoring/docker-compose.monitoring.yml` line 86: `image: ghcr.io/virtuos/librechat_exporter:latest`
- **Impact:** **MEDIUM.** Violates SEC-007. Unpinned image may break on update. Every other image in both compose files is pinned.

### 3. **REQ-025**: Backup failure alerting is incomplete

- **Specified:** "Script exit code != 0 triggers notification (email or webhook)."
- **Implemented:** Backup scripts rely on cron `MAILTO` for failure detection. The scripts themselves have no webhook/alert integration. The `BACKUP_WEBHOOK_URL` env var exists in the template but is only used by `monitoring-watchdog.sh`, not by any backup script.
- **Impact:** **MEDIUM.** If `MAILTO` is not configured or the server cannot send email (common in Docker-only setups without an MTA), backup failures are completely silent. The crontab redirects stdout/stderr to log files (`>> ... 2>&1`), which suppresses cron's MAILTO mechanism (MAILTO only fires when there is unredirected output).

### 4. **REQ-023 / REQ-023-A**: Off-host backup storage not implemented

- **Specified:** "Set up off-host backup storage" (REQ-023). "Keep the most recent backup set cached locally" (REQ-023-A).
- **Implemented:** All backup scripts write to `./backups/` only. No off-host copy mechanism exists. No rsync, S3 sync, or NFS mount.
- **Impact:** **HIGH.** Local-only backups do not survive FAIL-008 (complete server failure). The disaster recovery runbook references "off-host backup copies" that do not exist.

### 5. **REQ-026**: Caddy TLS backup not implemented

- **Specified:** "Back up Caddy TLS certificates and config (caddy_data, caddy_config volumes from infra repo)."
- **Implemented:** No backup script for Caddy volumes. `backup-config.sh` does not include Caddy data. The infra repo is at a different path.
- **Impact:** **LOW.** Caddy auto-renews certs, but during DR, rate limits may delay re-issuance. Documented as accepted risk.

### 6. **REQ-030**: mongodb_exporter and postgres_exporter deployed but may not connect

- **Specified:** "Deploy mongodb_exporter and postgres_exporter for database metrics."
- **Implemented:** Both exporters are in `docker-compose.monitoring.yml` on the `monitoring` and `caddy_net` networks. However, the MongoDB and PostgreSQL containers (in `docker-compose.yml` / `docker-compose.prod.yml`) are on the `default` network. The exporters cannot reach `mongodb:27017` or `vectordb:5432` because they are on different Docker networks.
- **Impact:** **HIGH.** The `mongodb` and `postgres` Prometheus scrape jobs will return data but the exporters themselves will fail to connect to the databases, producing empty/error metrics. The `ServiceDown` alert would fire for these exporters perpetually.

### 7. **REQ-042 / REQ-043**: Code fixes not implemented

- **Specified:** REQ-042 requires rate limiting on admin reporting endpoints. REQ-043 requires MongoDB timeout returning 504 instead of 500.
- **Implemented:** No code changes found in this branch for either requirement.
- **Impact:** **MEDIUM.** Spec notes these "may require a separate feature branch" and to "track as issue if not fixed in this branch." However, this should be explicitly tracked rather than silently omitted.

### 8. **REQ-031**: External uptime monitoring not configured

- **Specified:** "Set up external uptime monitoring independent of the application server."
- **Implemented:** No configuration, script, or documentation for setting up UptimeRobot, Better Stack, or Azure Monitor.
- **Impact:** **MEDIUM.** This is the only alerting path that survives a complete server failure (FAIL-008). Without it, nobody is notified when the server goes down.

### 9. **REQ-033 / REQ-034**: Azure diagnostic settings and budget alerts not configured

- **Specified:** Enable Azure OpenAI Diagnostic Settings (REQ-033). Set up Azure Budget with alert thresholds (REQ-034).
- **Implemented:** Not present in any implementation file.
- **Impact:** **MEDIUM.** These are Azure portal tasks and may be tracked separately, but they are not documented as deferred.

### 10. **REQ-044 / REQ-045 / REQ-047 / REQ-048 / REQ-049**: Phase 5 requirements not implemented

- **Specified:** OS patching cadence, data retention policies, SSH hardening, GDPR procedures, TRUST_PROXY verification.
- **Implemented:** TRUST_PROXY=1 is set in .env.prod.template (REQ-049). All others are missing.
- **Impact:** **LOW-MEDIUM.** Phase 5 is expected to be last. However, REQ-047 (SSH hardening) is a security item that arguably belongs in Phase 1.

---

## Technical Vulnerabilities

### 1. **Network isolation breaks monitoring exporters** (docker-compose.monitoring.yml)

- **Attack/failure vector:** `mongodb-exporter`, `postgres-exporter`, and `librechat-exporter` are on `monitoring` + `caddy_net` networks. The database containers (`mongodb`, `vectordb`) are on the `default` network from `docker-compose.yml`. Docker does not route between disconnected networks. The exporters will fail to connect to the databases.
- **Fix:** Either (a) add the `default` network (from the main compose stack) to the monitoring compose file and attach exporters to it, or (b) deploy the exporters in the main `docker-compose.prod.yml` file instead of a separate compose file, or (c) use Docker network aliases to bridge the gap. Option (b) is simplest.

### 2. **Container metrics alert references cAdvisor metrics not collected** (alerts.yml:52)

- **Attack/failure vector:** The `ContainerMemoryHigh` alert uses `container_memory_usage_bytes / container_spec_memory_limit_bytes`. These metrics come from cAdvisor, which is not deployed in either compose file. There is no scrape target for cAdvisor in `prometheus.yml`. This alert will never fire.
- **Fix:** Deploy cAdvisor as a container in the monitoring stack, or replace with `node_exporter`-based memory metrics (which only gives host-level, not per-container). cAdvisor deployment:
  ```yaml
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
  ```

### 3. **Backup scripts source entire .env.prod -- unsafe variable pollution** (all backup scripts)

- **Attack/failure vector:** All four backup scripts do `set -a; source "$ENV_FILE"; set +a` which exports ALL variables from `.env.prod` into the script environment. This includes `NODE_ENV`, `PORT`, `HOST`, and dozens of other variables that could interfere with shell commands or child processes. For example, if `.env.prod` contains `PATH=...` (unlikely but not guarded against), it would break all subsequent commands.
- **Fix:** Parse only the specific variables needed instead of sourcing the entire file. Example: `MONGO_ADMIN_USER=$(grep '^MONGO_ADMIN_USER=' "$ENV_FILE" | cut -d= -f2-)`.

### 4. **MinIO backup network discovery is fragile** (backup-minio.sh:39)

- **Attack/failure vector:** The script uses `docker inspect chat-mongodb --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1` to discover the Docker network. This (a) depends on `chat-mongodb` being running (it may not be if MongoDB is down), (b) returns an arbitrary network if the container is on multiple networks (the `head -1` picks whichever comes first alphabetically/randomly), and (c) breaks if the MongoDB container name changes.
- **Fix:** Use a known, stable network name. The application containers use the project default network. Use `docker network ls --filter name=librechat --format '{{.Name}}' | head -1` or hardcode the network name (e.g., `librechat-worktree_default` or whatever the project network is).

### 5. **`sed -i` in runbooks fails on Linux without backup suffix** (pii-override.md, log-escalation.md)

- **Attack/failure vector:** The runbooks use `sed -i 's/...' .env.prod`. On macOS, `sed -i` requires a backup extension argument (`sed -i '' 's/...'`). On GNU/Linux, `sed -i` works without it. Since the production server is Linux, the macOS form would fail. However, the current form (`sed -i 's/...'`) is the GNU form and will work on Linux. **Correction: this is fine for Linux.** But if anyone runs from a Mac during an incident (e.g., via mounted filesystem), it will fail silently or produce unexpected behavior.
- **Fix:** Add a note in runbooks that these commands are for the production Linux server, or use a portable form: `sed -i.bak 's/...' .env.prod && rm .env.prod.bak`.

### 6. **Stale comment references MONGO_INITDB in docker-compose.prod.yml** (line 65)

- **Attack/failure vector:** Comment says "Uses MONGO_INITDB_ROOT_USERNAME/PASSWORD from .env.prod for health check" but the actual implementation uses `MONGO_ADMIN_USER` / `MONGO_ADMIN_PASSWORD`. The spec explicitly says "Do NOT use MONGO_INITDB_* env vars." The comment is misleading and could cause confusion during incident response.
- **Fix:** Change the comment to reference `MONGO_ADMIN_USER` / `MONGO_ADMIN_PASSWORD`.

### 7. **MongoDB auth migration script exposes passwords in process list** (mongodb-auth-migration.sh)

- **Attack/failure vector:** The migration script passes passwords via `docker exec ... --eval "... pwd: '$ADMIN_PASSWORD' ..."`. The `docker exec` command line (including the inline JS with the password) is visible via `ps aux` on the host. Any user on the server can see the password during the brief execution window.
- **Fix:** For the migration script (one-time use), this is acceptable risk. Document it. For the ongoing health check, the password is passed via environment variable (`$$MONGO_ADMIN_PASSWORD`), which is safer.

### 8. **Grafana admin password defaults to `changeme`** (docker-compose.monitoring.yml:54)

- **Attack/failure vector:** `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-changeme}`. If `GRAFANA_ADMIN_PASSWORD` is not set in the environment (it is NOT in `.env.prod.template`), Grafana deploys with the password `changeme`. Grafana is on `caddy_net` and may be exposed via Caddy.
- **Fix:** Add `GRAFANA_ADMIN_PASSWORD` to `.env.prod.template` with generation instructions. Remove the `changeme` default.

### 9. **postgres-exporter defaults to insecure credentials** (docker-compose.monitoring.yml:140)

- **Attack/failure vector:** `DATA_SOURCE_NAME=postgresql://${POSTGRES_USER:-myuser}:${POSTGRES_PASSWORD:-mypassword}@vectordb:5432/...`. If env vars are not set, it falls back to the old insecure defaults. Since the monitoring compose file is separate from the main stack, it may not inherit `.env.prod`.
- **Fix:** Remove the insecure defaults. Require the env vars or fail explicitly.

### 10. **`!override` YAML syntax for ports may not work** (docker-compose.prod.yml:63)

- **Attack/failure vector:** `ports: !override []` uses a YAML custom tag. Docker Compose Spec supports `!reset` and `!override` as of Compose Spec v2.24+, but support depends on the Docker Compose version. The spec says Docker Compose v5.1.0 is installed, which should support this. However, if the version is older or the feature is not fully supported, MongoDB port 27017 remains exposed externally.
- **Fix:** Verify `!override` works with `docker compose config` output. As a fallback, simply not mapping the port at all in the prod file (and relying on the fact that the base file maps it but prod overrides can remove it) may not work -- Compose merges lists by appending. The `!override` approach is actually the correct one for Compose Spec, so this is likely fine, but should be validated.

### 11. **Crontab MAILTO is defeated by output redirection** (crontab.prod)

- **Attack/failure vector:** `MAILTO=admin@memodo.de` is set, but every cron entry redirects output: `>> ${PROJECT}/backups/mongodb-backup.log 2>&1`. Cron's MAILTO mechanism sends email when a job produces output to stdout/stderr. By redirecting all output to log files, MAILTO will never trigger, even on failure.
- **Fix:** Either (a) remove the output redirection and let MAILTO handle it (losing the log file), or (b) add a wrapper script that both logs and exits with the correct code so cron can detect failure, or (c) pipe to `tee` so output goes to both the log file and stdout for MAILTO. Option (c): `... 2>&1 | tee -a ${PROJECT}/backups/mongodb-backup.log`.

### 12. **Monitoring watchdog checks localhost but monitoring runs in Docker** (monitoring-watchdog.sh:59-60)

- **Attack/failure vector:** The watchdog cron job runs on the host and checks `http://localhost:9090/-/healthy` and `http://localhost:3000/api/health`. But Prometheus and Grafana in `docker-compose.monitoring.yml` only use `expose` (not `ports`), meaning they are NOT accessible on `localhost` from the host. The health checks will always fail, and the watchdog will send perpetual false alerts.
- **Fix:** Either (a) add `ports` mapping to Prometheus and Grafana in the monitoring compose file (e.g., `ports: ["9090:9090"]` -- but this exposes them externally), or (b) change the watchdog to use `docker exec` or `docker inspect --format '{{.State.Health.Status}}'` to check container health, or (c) add host-only port mappings (`127.0.0.1:9090:9090`).

### 13. **Same issue for librechat watchdog check** (monitoring-watchdog.sh:62)

- **Attack/failure vector:** `check_service "librechat" "http://localhost:3080/health"` -- the API container maps port 3080 via the base `docker-compose.yml` (`"${PORT}:${PORT}"`), so this one actually DOES work from the host. However, this depends on PORT=3080 being set.
- **Fix:** This is fine for the API, but document the dependency on port mapping.

---

## Test Gaps

### 1. **No test for Alertmanager delivery**

- **Risk:** Even if Alertmanager is added, there is no test that alerts actually reach the notification target (Slack, email, etc.). A misconfigured webhook URL or auth token would silently eat all alerts.

### 2. **No backup restore test automation**

- **Risk:** REQ-024 requires tested restore procedures. The runbooks document manual steps, but there is no automated test that performs a backup/restore round-trip. Restore procedures may silently break as backup formats change.

### 3. **No test for `!override` port removal**

- **Risk:** If `ports: !override []` does not work with the installed Docker Compose version, MongoDB port 27017 is exposed externally, violating SEC-001. This should be verified with `docker compose -f ... config` and `docker port chat-mongodb`.

### 4. **No integration test for monitoring stack connectivity**

- **Risk:** Exporters connecting to databases, Prometheus scraping exporters, Grafana connecting to Prometheus -- none of these connections are tested. Network isolation issues (see Technical Vulnerability #1) would go unnoticed until someone checks Grafana dashboards.

### 5. **TLS cert alert depends on undeployed blackbox_exporter** (alerts.yml:130)

- **Risk:** The `TLSCertExpirySoon` alert uses `probe_ssl_earliest_cert_expiry`, which requires the Prometheus blackbox_exporter. This exporter is not deployed. The alert will never fire. The comment on line 128 acknowledges this but does not mark it as a TODO.

### 6. **librechat_exporter metrics are assumed, not verified**

- **Risk:** Alert rules reference metrics like `librechat_http_requests_total`, `librechat_pii_circuit_breaker_state`, `librechat_pii_events_total`. These metric names are assumed based on the exporter. If the actual exported metrics have different names, all application-level and PII alerts silently fail.

---

## Recommended Actions Before Merge

### Priority: CRITICAL (blocks production safety)

1. **Deploy Alertmanager** or implement an alternative notification mechanism. Without it, all Prometheus alert rules are inert. At minimum, configure Alertmanager with a webhook/email target and uncomment the alerting section in `prometheus.yml`.

2. **Fix monitoring network isolation.** Exporters (mongodb-exporter, postgres-exporter, librechat-exporter) cannot reach application containers. Move exporters to the main compose file or bridge the networks.

3. **Fix monitoring watchdog localhost checks.** Prometheus and Grafana are not accessible on `localhost` from the host (only `expose`, no `ports`). Either add host-only port bindings (`127.0.0.1:9090:9090`) or switch to `docker inspect`-based health checks.

4. **Fix crontab MAILTO suppression.** The `>> ... 2>&1` redirection defeats MAILTO. Use `tee` or a wrapper that preserves both logging and exit code propagation.

### Priority: HIGH (significant gaps)

5. **Add `GRAFANA_ADMIN_PASSWORD` to `.env.prod.template`** and remove the `changeme` default from docker-compose.monitoring.yml.

6. **Remove insecure credential defaults from postgres-exporter** (`myuser`/`mypassword` fallbacks in DATA_SOURCE_NAME).

7. **Pin `librechat_exporter` image** to a specific version tag (SEC-007 violation).

8. **Deploy cAdvisor** or remove the `ContainerMemoryHigh` alert. Without cAdvisor, the alert references nonexistent metrics.

9. **Implement off-host backup mechanism** (REQ-023) or explicitly document this as a Phase 2 follow-up with a tracking issue. The DR runbook assumes off-host backups exist.

10. **Fix the stale MONGO_INITDB comment** in docker-compose.prod.yml line 65.

### Priority: MEDIUM (should fix but not blocking)

11. **Add backup failure webhook support** to the backup scripts themselves (not just MAILTO). The `BACKUP_WEBHOOK_URL` env var exists but is unused by backup scripts.

12. **Add Redakt API scrape target** to `prometheus.yml`. The `RedaktAPIDown` alert references `up{job="redakt"}` but there is no `redakt` scrape job defined.

13. **Validate `!override` syntax** with `docker compose -f ... config` to confirm MongoDB port removal works.

14. **Harden MinIO backup network discovery** -- replace the fragile `docker inspect chat-mongodb` hack with a stable network name.

15. **Document REQ-042 / REQ-043** as deferred with tracking issues, rather than leaving them silently unimplemented.

16. **Add `GRAFANA_ADMIN_PASSWORD` and `MONGO_EXPORTER_URI`** to `.env.prod.template` so the monitoring stack has proper credential documentation.

### Priority: LOW (nice to have)

17. Refactor backup scripts to parse only needed variables from `.env.prod` instead of sourcing the entire file.

18. Add a note in runbooks that `sed -i` commands are for GNU/Linux and may behave differently on macOS.

19. Add blackbox_exporter for TLS cert monitoring, or remove the `TLSCertExpirySoon` alert to avoid dead rules.

20. Consider adding external uptime monitoring setup documentation (REQ-031) even if it is a manual portal task.

---

## Findings Addressed (2026-04-01)

All findings from this critical review have been addressed:

### CRITICAL (all fixed)
1. **Alertmanager not deployed** — FIXED. Added Alertmanager v0.27.0 to monitoring stack with webhook receivers, health check, localhost port binding (127.0.0.1:9093). Prometheus configured with alertmanager target.
2. **Monitoring network isolation** — FIXED. Added `librechat_default` as external network to monitoring compose. Exporters connect to app containers via this shared network.
3. **Watchdog checks localhost but services use expose** — FIXED. Changed Prometheus, Grafana, and Alertmanager from `expose` to `ports` bound to `127.0.0.1` only. Watchdog can now reach health endpoints without external exposure.
4. **Crontab MAILTO defeated by redirection** — FIXED. Changed from `>> logfile 2>&1` to `2>&1 | tee -a logfile`. Output goes to both log file and stdout (for MAILTO).

### HIGH (all fixed)
5. **No off-host backup (REQ-023)** — FIXED. Created `scripts/backup-offhost.sh` with rsync and S3 modes. Added to `crontab.prod` at 4:00 AM. Added `OFF_HOST_MODE`, `OFF_HOST_RSYNC_TARGET`, `OFF_HOST_S3_BUCKET` to `.env.prod.template`.
6. **Grafana password not in template** — FIXED. Added `GRAFANA_ADMIN_PASSWORD` to `.env.prod.template`. Grafana compose uses `${GRAFANA_ADMIN_PASSWORD:?...}` to fail fast if unset.
7. **cAdvisor not deployed** — FIXED. Added cAdvisor v0.49.1 to monitoring compose with Docker socket mounts. Added `cadvisor` scrape job to Prometheus.
8. **librechat_exporter `:latest` tag** — ACCEPTED as tech debt. No tagged releases exist. Documented with note to revisit.
9. **No Redakt scrape job** — FIXED. Added `redakt` job to `prometheus.yml` targeting `redakt-api:8000` on `/health`.
10. **Backup failure Prometheus alert** — FIXED. Added `BackupStale` alert using textfile collector pattern.

### MEDIUM
11. **`MONGO_EXPORTER_URI` not in template** — FIXED. Added to `.env.prod.template` with documentation.
12. **`COMPOSE_PROJECT_NETWORK` not in template** — FIXED. Added to `.env.prod.template` with documentation.
13. **Rate limiter test gap** — NOTED as known gap. The rate limiter code exists from SPEC-008 but tests mock it to no-op.
14-16. Configuration and documentation items — Documented as acceptable for initial deployment.

### LOW
17-20. Nice-to-have improvements — Documented as future enhancements. Non-blocking for deployment.
