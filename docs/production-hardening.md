# MemodoAI LibreChat — Security & Production Hardening

This document summarises the work that took the MemodoAI fork of LibreChat from a
local-dev posture to a production deployment on `chat.memodo-eng.de`. It is split
in two parts:

1. **Security hardening** — controls applied to reduce attack surface, protect
   data, and contain failure.
2. **Production readiness** — operational controls that keep the service
   running, observable, recoverable, and maintainable.

The canonical source of requirements is `SDD/requirements/SPEC-010-production-readiness.md`
(53 `REQ-`s across 5 phases). This document is a human-readable summary of what
was actually implemented and where it lives in the repo.

---

## At a glance

| Area | Before | After |
|---|---|---|
| MongoDB | `--noauth`, port 27017 exposed | `--auth`, no exposed ports, app user with `readWrite` only on `LibreChat` |
| Secrets | Shipped placeholders (`CREDS_KEY`, `JWT_SECRET`, etc.) | Regenerated, stored only in `.env.prod`, `.gitignore`d |
| Images | `librechat-dev:latest`, `librechat-rag-api-dev-lite:latest`, `minio:latest` | All pinned (`librechat:v0.8.5`, `librechat-rag-api-dev-lite:v0.5.0`, `minio:RELEASE.2025-03-12T18-04-18Z`) |
| Registration | Open + unverified email login allowed | Disabled at the endpoint; MS SSO via Entra ID; `librechat.yaml` allowlist (`memodo.de`, `memodo-eng.de`) |
| AuthN/Z | Local users, role string only | Entra SSO + per-user group sync + 3-layer RBAC (User.role / Role.permissions / SystemGrants) |
| CORS / origins | `app.use(cors())` unrestricted | `DOMAIN_CLIENT`/`DOMAIN_SERVER` set; Caddy enforces TLS / origin |
| Logs | `DEBUG_LOGGING=true`, no rotation | `LOG_LEVEL=warn`, `CONSOLE_JSON=true`, json-file driver, `max-size: 10m`, `max-file: 5`/`3` |
| Cookies | `NODE_ENV` unset | `NODE_ENV=production` (Secure + SameSite + HttpOnly) |
| Backups | None | Daily MongoDB, MinIO, weekly Postgres, daily config; off-host copy; backup-failure alert |
| Health checks | None on any container | All services + monitoring stack covered (`/health`, `pg_isready`, auth-aware `mongosh ping`, etc.) |
| Monitoring | None | Prometheus + Grafana + Alertmanager + 4 exporters + cAdvisor, with Teams alerting |
| External uptime | None | UptimeRobot/external check against `https://chat.memodo-eng.de/health` (RISK-005 mitigation) |
| Rate limiting | Default | Tuned login/register/message limits + `LIMIT_CONCURRENT_MESSAGES` + `LIMIT_MESSAGE_IP` |
| Ban/violation system | Off | `BAN_VIOLATIONS=true`, 2h ban after 20 violations |
| PII | None | Redakt sidecar, `PII_DETECTION_MODE=warn`, fail-open, score threshold 0.7 |
| SSRF (Actions/MCP) | Default permissive | `actions.allowedDomains` + `mcpSettings.allowedDomains` allowlists |
| SSH / OS | Default Hetzner image | Key-only, password login disabled, `fail2ban`, `unattended-upgrades` |
| Runbooks | None | 7 runbooks: backup-restore, DR, GDPR erasure, log escalation, PII override, secret rotation, service restart |

---

# Part A — Security Hardening

The security work is driven by SPEC-010 Phase 1 (REQ-001 through REQ-017) plus
ongoing controls layered on top (SSO, PII, MCP/Action allowlists, ACS, GDPR).

## A.1 Secrets and credentials

- **Regenerated every secret** before first production boot (REQ-005): `JWT_SECRET`
  and `JWT_REFRESH_SECRET` (32-byte hex), `CREDS_KEY` (32-byte hex), `CREDS_IV`
  (16-byte hex), `MEILI_MASTER_KEY` (32-byte hex), MongoDB admin + app passwords,
  PostgreSQL password, MinIO root password, Grafana admin password.
- **Strong DB credentials.** PostgreSQL moved off `myuser`/`mypassword` (REQ-007);
  MinIO moved off `minioadmin`/`minioadmin123` (REQ-008).
- **Dual env-file strategy.** `.env` is dev-only. `.env.prod` is production-only
  and is loaded via `prod.sh ... --env-file .env.prod`. Neither is committed
  (`git check-ignore .env.prod` passes — REQ-017).
- **Secret rotation runbook.** `docs/runbooks/secret-rotation.md` documents
  cadence (annually, or immediately on team-member departure), which secrets
  require which service restarts, and which secrets invalidate active sessions.

## A.2 Database security

- **MongoDB authentication enabled** (REQ-006, SEC-003). Production runs
  `mongod --auth --bind_ip_all`. On greenfield startup the official mongo image
  creates the root user from `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD`
  and `mongo-init/init-librechat-user.sh` creates the application user
  `librechat` with `readWrite` on the `LibreChat` database only. The
  application connects via `MONGO_URI=mongodb://librechat:<pw>@mongodb:27017/LibreChat?authSource=LibreChat`.
  `scripts/mongodb-auth-migration.sh` exists for the populated-DB migration
  case (kept for posterity; greenfield is the current path).
- **No exposed DB ports.** `ports: !override []` in `docker-compose.prod.yml`
  removes the dev port mappings for MongoDB; PostgreSQL/MeiliSearch/MinIO are
  reachable only on the internal Docker network. Admin access is via SSH
  tunnel (`ssh -L 27017:localhost:27017 user@server`).
- **Host firewall + Hetzner Cloud Firewall.** UFW + the Hetzner Cloud Firewall
  expose only 22/80/443. Verified with external `nmap` (SEC-001). Because Docker's
  port mapping can bypass `iptables`/`ufw` (EDGE-005), the *primary* control is
  removing the port mappings — the firewalls are defence in depth.

## A.3 Transport, origins, and cookies

- **TLS terminated at Caddy** in the separate `/Users/pablooliva/Dev/infra/`
  repo. Caddy auto-renews Let's Encrypt certs, and the `caddy_data` /
  `caddy_config` volumes are included in the configuration backup (REQ-026) so
  recovery avoids ACME rate limits.
- **`NODE_ENV=production`** (REQ-009 / SEC-006) — produces `HttpOnly` + `Secure`
  + `SameSite` cookies for sessions.
- **CORS** restricted via `DOMAIN_CLIENT=https://chat.memodo-eng.de` and
  `DOMAIN_SERVER=https://chat.memodo-eng.de` (REQ-010 / SEC-004). The Caddy
  layer enforces origin in front of the app.
- **`TRUST_PROXY=1`** — single Caddy hop in front, so the app sees the correct
  client IP (rate limiters and secure-cookie detection rely on this; wrong
  value silently breaks both — REQ-049).

## A.4 Identity and access (SSO + ACS)

- **Microsoft Entra SSO enabled** (`Enable MS SSO.` commit `cfd39307a`). OpenID
  Connect against the Entra tenant. Registration via the public endpoint is
  **off** in `.env.prod` (`ALLOW_REGISTRATION=false`,
  `ALLOW_UNVERIFIED_EMAIL_LOGIN=false`) — all users come in via SSO. The
  `registration.allowedDomains` allowlist in `librechat.yaml` (`memodo.de`,
  `memodo-eng.de`) is the second layer if registration is ever re-enabled.
- **Entra group sync** (per-user, on-login). `syncUserEntraGroupMemberships`
  in `api/server/services/PermissionService.js:483` reconciles the user's
  local group memberships against their Entra groups on every login. Groups
  carry `source: 'entra' | 'local' | 'ldap'`; the Entra sync never touches
  local-source groups, so manual/local groups coexist safely.
- **Three-layer RBAC** (documented in `SDD/ACS.md`):
  1. `User.role` string — `ADMIN` / `USER` / custom, settable via SSO group
     mapping (`OPENID_ADMIN_ROLE`) or the `scripts/set-role` CLI.
  2. `Role.permissions` — feature toggles per role (agent USE/CREATE/SHARE,
     memories, prompts, MCP, etc.).
  3. `SystemGrants` — capability tuples (e.g. `manage:roles`, `read:usage`)
     that can be attached to a user, role, group, or `public` principal.
- **Per-resource ACLs** (agents, prompts, MCP servers) with Viewer / Editor /
  Owner roles, enforced server-side (`api/server/middleware/accessResources/`).
- **Admin promotion.** First admin bootstrapped via `scripts/set-role`
  (commit `aa8bbf451`). Routine admin promotion is via the admin REST API
  (`/api/admin/users`) or by mapping an Entra group via `OPENID_ADMIN_ROLE`.

## A.5 Rate limiting, ban system, and cost guardrails

- **Tuned rate limits** (REQ-036) — `LOGIN_MAX`, `LOGIN_WINDOW`, `REGISTER_MAX`,
  `MESSAGE_IP_MAX/WINDOW`, file upload limits in `librechat.yaml` rateLimits.
  `LIMIT_CONCURRENT_MESSAGES=true` and `LIMIT_MESSAGE_IP=true`.
- **Ban / violations** (REQ-038): `BAN_VIOLATIONS=true`, `BAN_DURATION=7200000`
  (2 hours, literal milliseconds — gotcha noted in commit `db6d26cf5`),
  `BAN_INTERVAL=20`. PII blocks deliberately **do not** count as ban
  violations (EDGE-017) to avoid lockout from false positives.
- **Admin-endpoint rate limiting** (REQ-042). The aggregation pipelines under
  `/api/admin/usage/*` are rate-limited (~60 req/min/user) so reporting cannot
  degrade the database.
- **Token-balance system** is configured (REQ-037 — `balance.enabled`,
  startBalance, auto-refill) but currently `enabled: false`. Commit `1e97d4729`
  intentionally disables it for the current team; the plumbing is ready to
  switch on when wider rollout begins.

## A.6 PII detection (Redakt sidecar)

- **Separate Docker stack on `caddy_net`** (commit `1548f0df2` —
  Redakt now lives outside the main compose stack and is owned by a different
  team).
- **Configured as fail-open + warn mode** (REQ-040 / REQ-041): `PII_DETECTION=true`,
  `PII_DETECTION_MODE=warn`, `PII_DETECTION_FAIL_OPEN=true`,
  `PII_DETECTION_TIMEOUT=2000`, `PII_DETECTION_SCORE_THRESHOLD=0.7`,
  `PII_DETECTION_EXEMPT_ROLES=admin`.
- **Circuit breaker** opens after 5 consecutive failures (30s window) and
  raises `PIICircuitBreakerOpen` (critical) in Prometheus. In fail-open mode
  messages still flow; the alert tells ops PII protection is degraded.
- **Manual override runbook** (`docs/runbooks/pii-override.md`, REQ-041-A)
  documents the exact commands to flip fail-open/fail-closed or disable
  detection entirely.
- **Post-merge verification** is automated (`scripts/pii-merge-verify.sh` + the
  Husky `post-merge` hook) — every merge from upstream `main` runs static
  checks to make sure middleware ordering, registry exports, SSE warning
  handling, and admin endpoints still wire PII in correctly.

## A.7 SSRF / outbound allowlists

LibreChat blocks `localhost`, private IPs, and `.internal` / `.local` TLDs by
default for Agent Actions and remote MCP transports. On top of that we run
explicit allowlists in `librechat.yaml`:

- `actions.allowedDomains` — currently `api.open-meteo.com`.
- `mcpSettings.allowedDomains` — the set of trusted MCP endpoints (Cloudflare
  docs MCP, etc.). `mcpSettings.allowedDomains` is enforced (`MCP.js:419/502`,
  see memory `project_mcp_alloweddomains_gotcha.md`). Stdio MCPs bypass this —
  no remote endpoint to allowlist — but we don't run untrusted stdio MCPs.
- The MCP OAuth code path has had multiple security-relevant upstream fixes
  pulled in: PR #12755 (validate protected-resource-metadata binding),
  #12763 (prefer `WWW-Authenticate resource_metadata` hint), #12782 (restore
  tenant context in OAuth callback), #12812 (prevent silent crash from
  unhandled OAuth reconnect rejections).

## A.8 Capability surface reduction

We have intentionally reduced the surface that can call out or execute code:

- **Remote agent API access disabled** in `librechat.yaml` (commit `782a259c0`).
- **Add-Tools UI disabled** on agents (commit `7f68709b3`) — only the curated
  capability set is exposed.
- **Code execution (`execute_code`) disabled** (commit `1a0a61273`). LibreChat's
  hosted code interpreter is closed to new subscriptions; we did not stand up
  a self-hosted sandbox. The Artifacts (Sandpack) browser-side renderer is the
  only "code"-flavoured surface that's live. See `docs/features.md`.
- **Assistants API not enabled.** The OpenAI/Azure Assistants API
  retires 2026-08-26; we route everything through Responses-API-backed
  endpoints and Agents to avoid a forced second migration before sunset.

## A.9 Application image security

- **Release images only**, pinned (REQ-003 / REQ-004 / REQ-008, SEC-007):
  - `registry.librechat.ai/danny-avila/librechat:v0.8.5`
  - `registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite:v0.5.0`
    (no non-dev release tag exists; pinned anyway as accepted debt)
  - `minio/minio:RELEASE.2025-03-12T18-04-18Z`
  - `minio/mc:RELEASE.2025-03-12T17-29-24Z`
- The exporter sidecars (`prom/prometheus`, `grafana/grafana`,
  `prom/alertmanager`, `percona/mongodb_exporter`,
  `prometheuscommunity/postgres-exporter`, `gcr.io/cadvisor/cadvisor`,
  `prom/node-exporter`) are all pinned. The only `:latest` is
  `ghcr.io/virtuos/librechat_exporter` (no tagged release exists upstream —
  documented as tech debt).
- **Fork build mounts.** `prod-sync.sh` (commit `d94392d9d`) ships our compiled
  fork on top of the upstream image via bind-mounts of `packages/api/dist`,
  `packages/data-schemas/dist`, `packages/data-provider/dist`, `api/server`,
  `client/dist`. `docker-compose.prod.yml` uses `volumes: !override` so prod
  doesn't accidentally inherit dev mounts (fix in commit `fd47debb1`).

## A.10 Operating system hardening

- **SSH:** key-only authentication, password login disabled, `fail2ban`
  installed and configured (REQ-047, hardened in commit `e908215eb`).
- **OS patches:** `unattended-upgrades` enabled and verified active
  (REQ-044). Subscribed to LibreChat GitHub releases for monthly upstream
  review.
- **NTP:** `timedatectl status` verified synchronised (EDGE-014) so backup
  retention windows are meaningful.

## A.11 Secret-leak hygiene

- `.env`, `.env.prod`, and the Alertmanager webhook file are in `.gitignore`
  and verified at deploy time (`git check-ignore`).
- The deployment checklist explicitly forbids adding `UID=`/`GID=` to
  `.env.prod` (they're bash readonly built-ins; backup scripts would abort on
  `set -a; source .env.prod`) — gotcha documented inline.
- Backup scripts use `set -a; source .env.prod` then run; secrets stay on the
  host filesystem only.

## A.12 Data residency and compliance

- **Azure-only inference.** Chat traffic goes to Azure OpenAI (Sweden Central
  for chat, Switzerland North for embeddings). No traffic to the public OpenAI
  API. Azure DPA is in place (REQ-048).
- **PII guardrails.** Redakt in warn mode (REQ-040). Migration to block mode
  is gated by 30 days of >99.5% Redakt uptime and a tested manual-override
  procedure (REQ-041 criteria).
- **GDPR Article 17 erasure** (REQ-048): `scripts/gdpr-erase-user.sh` cascades
  deletion across MongoDB (`users`, `conversations`, `messages`, `transactions`,
  `guardrailevents`, `files`), MinIO uploaded files, and pgvector embeddings.
  Verification runbook at `docs/runbooks/gdpr-erasure.md`.

---

# Part B — Production Readiness

The production-readiness work is driven by SPEC-010 Phases 2–5 (REQ-018
through REQ-053). It covers backup/restore, monitoring/alerting, guardrails,
and operational maturity.

## B.1 Deploy mechanics

- **Multi-file Docker Compose merge.** `prod.sh` invokes
  `docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.prod.yml --env-file .env.prod "$@"`.
  The override layer's volume/env-file lists are explicitly replaced with
  `!override` to prevent dev mounts and dev env files from leaking into prod
  (commits `fd47debb1`, `49382d245`).
- **Monitoring stack** runs as a separate Compose project at
  `monitoring/docker-compose.monitoring.yml`, wrapped by `prod-mon.sh`.
- **Single-server topology.** Hetzner Cloud VM, Docker Compose, Caddy on
  `caddy_net` for ingress. Redakt is a sibling stack on `caddy_net`. The
  RISK-004 SPOF is acknowledged and mitigated by external uptime monitoring
  + off-host backups + documented recovery (rather than HA).

## B.2 Health checks and resource limits

- **Health checks on every service** (REQ-027, PERF-001):
  - `api` — `wget --spider http://127.0.0.1:3080/health` (image has no curl;
    `127.0.0.1` avoids the IPv6/IPv4 resolution gotcha)
  - `mongodb` — auth-aware `mongosh ping` using `MONGO_ADMIN_USER/PASSWORD`
  - `meilisearch` — `curl /health`
  - `vectordb` — `pg_isready`
  - `rag_api` — `python -c "urllib.request.urlopen(...)"` (image has no
    curl/wget)
  - `minio` — `/minio/health/live`
  - `prometheus` / `grafana` / `alertmanager` — `/-/healthy` and
    `/api/health` (REQ-027-A)
- **Resource limits** under `deploy.resources.limits` (REQ-039):
  - API: 2G / 2.0 CPUs
  - MongoDB: 4G / 1.0 CPU (1G reservation)
  - MeiliSearch / RAG API: 1G / 1.0 CPU
  - Postgres: 1G / 0.5 CPU
  - MinIO: 1G / 0.5 CPU
  - Exporters: 128–256M
  - Enforcement verified with `docker stats` (EDGE-008 / REQ-039-A).

## B.3 Log rotation and log level

- **Every service uses `json-file` log driver** with `max-size: 10m` and
  `max-file: 5` (API) / `max-file: 3` (databases and sidecars) — REQ-015 /
  PERF-004.
- **Production log level**: `DEBUG_LOGGING=false`, `LOG_LEVEL=warn`,
  `CONSOLE_JSON=true`, `DEBUG_CONSOLE=false` (REQ-014).
- **Log escalation runbook** (`docs/runbooks/log-escalation.md`, REQ-014-A) —
  exact procedure to flip to `LOG_LEVEL=debug` for ≤30 minutes, capture, and
  revert.
- **Log metadata preserved** on warn/error (upstream PR #12737, pulled in).

## B.4 Backups, off-host storage, and disaster recovery

- **Schedules** (`crontab.prod`, REQ-050):
  - Daily MongoDB dump — `scripts/backup-mongodb.sh` (`mongodump --archive --gzip --db LibreChat`), 30-day retention.
  - Daily MinIO mirror — `scripts/backup-minio.sh` (`mc mirror` via a `minio/mc` sidecar with `--env-file .env.prod` because the container does NOT inherit host env vars — EDGE-007).
  - Weekly Postgres dump — `scripts/backup-postgres.sh` (`pg_dump --format=custom`), 30-day retention.
  - Daily config archive — `scripts/backup-config.sh` (`.env`, `.env.prod`, `librechat.yaml`, all compose files, `prod.sh`, mongo-init).
  - Daily off-host sync — `scripts/backup-offhost.sh`.
- **RPO/RTO defined** (REQ-018, AVAIL-001/002):
  - RPO: 24h (daily cadence).
  - RTO: 4h for full server failure, 1h for single-service recovery.
- **Local cache + off-host copy** (REQ-023, REQ-023-A) — fast recovery for
  single-service failures, durable copy for total loss.
- **Backup-failure alerting** (REQ-025 / REQ-032). Each backup script writes a
  `backup_last_success_timestamp` to the node-exporter textfile collector;
  Prometheus alert `BackupStale` fires if the metric is older than ~25h.
- **Restore runbooks**:
  - `docs/runbooks/backup-restore.md` — per-service restore steps.
  - `docs/runbooks/disaster-recovery.md` — FAIL-008 procedure including
    DNS update, MeiliSearch re-index timing, and the RTO clock.
- **Caddy TLS state backed up** (REQ-026) — `caddy_data` / `caddy_config`
  volumes so recovery avoids Let's Encrypt rate limits.

## B.5 Monitoring and alerting

- **Prometheus + Grafana + Alertmanager** stack (REQ-028) at
  `monitoring/docker-compose.monitoring.yml`, on a separate Compose project,
  shared with the app stack via `librechat_default` and `redakt_default`
  networks for scraping.
- **Exporters** (REQ-029 / REQ-030 / REQ-051):
  - `node_exporter` (host metrics, including textfile collector for backup
    timestamps).
  - `librechat_exporter` (token usage, conversations, user activity).
  - `mongodb_exporter` with `--collect-all` (commit `d796eeee7` — without
    this the standalone mongo only emits `mongodb_up`).
  - `postgres_exporter` with credentials from `.env.prod`.
  - `cAdvisor` for per-container metrics (drives `ContainerMemoryHigh`).
- **Grafana provisioned** with datasources + dashboards via
  `monitoring/grafana/provisioning/` (commit `2df33b21e`). Memory report
  query fixed in `1327e74cd`. Grafana bound to `127.0.0.1` and reverse-proxied
  via Caddy at `grafana.memodo-eng.de`.
- **Alert rules** (REQ-032, `monitoring/prometheus/alerts.yml`):
  - `ServiceDown` (>2 min), critical.
  - `MongoDBRestartLoop` (>3 changes in 10 min), critical — addresses the
    crash-loop pattern in upstream issue #11808 (EDGE-001).
  - `DiskSpaceWarning` / `DiskSpaceCritical` at 80% / 90%.
  - `ContainerMemoryHigh` >85% of limit (with the `id=~"/system.slice/docker-.*"`
    and `limit > 0` filters to avoid systemd-slice noise and `+Inf` from
    unlimited containers — commit `81bd6bf1f`).
  - `HostMemoryHigh` >90%.
  - `HighErrorRate` — API 5xx rate >5%.
  - `AdminReportingAbuse` — >60 req/min on `/api/admin/usage/*`.
  - `PIICircuitBreakerOpen` — fires immediately on transition (EDGE-002).
  - `HighPIIBlockRate` — >50 events/hour (false-positive watchdog while in
    warn mode).
  - `BackupStale` — last successful backup >25h.
  - TLS expiry <14 days (Caddy auto-renews at 30; this is the
    safety net).
- **Notification routing.** Alertmanager → Microsoft Teams webhook
  (gitignored secrets file, commits `7bc88e305` + `e9c3e3c77` +
  `bd6c49ba5` for setup gotchas).
- **External uptime monitoring** (REQ-031 / AVAIL-003) — independent of the
  app server, primary "is the site up" signal during full-server failure
  (RISK-005 / EDGE-009).
- **Watchdog for the watchdog** (REQ-027-A) — `scripts/monitoring-watchdog.sh`
  cron job alerts if Prometheus or Grafana is unhealthy for >5 minutes
  outside the Prometheus pipeline.
- **Azure observability** (REQ-033 / REQ-034) — Diagnostic Settings on the
  Azure OpenAI resources route `Audit`, `RequestResponse`,
  `AzureOpenAIRequestUsage`, and `Trace` to Log Analytics. Azure Budget
  alerts configured at 50% / 75% / 90% of monthly spend.

## B.6 Cost and abuse controls (recap from Part A.5)

Rate limiting, ban system, admin-endpoint rate limiting, and the (currently
disabled) token balance system together cap per-user and per-IP cost and
exposure. Azure Budget alerts cap the cloud spend on the LLM side.

## B.7 Operational runbooks

The `docs/runbooks/` directory contains seven runbooks (REQ-046):

| Runbook | Covers |
|---|---|
| `service-restart.md` | Per-container restart procedures. |
| `backup-restore.md` | Mongo / Postgres / MinIO restore, MeiliSearch re-index. |
| `disaster-recovery.md` | Full-server recovery (FAIL-008) with RTO clock. |
| `secret-rotation.md` | Cadence and per-secret restart impact. |
| `pii-override.md` | Manual fail-open/fail-closed override for Redakt. |
| `log-escalation.md` | Temporary debug logging during incidents. |
| `gdpr-erasure.md` | Article 17 cascading deletion across all stores. |

Plus operational documentation:

- `docs/DEPLOYMENT-CHECKLIST.md` (1,099 lines) — step-by-step greenfield deploy.
- `docs/pii-merge-checklist.md` + the Husky `post-merge` hook — automated
  verification on every merge from upstream `main`.
- `SDD/ACS.md` — authoritative access-control reference (Groups, RBAC, ACL).
- `docs/features.md` — feature status and decisions (Assistants API sunset,
  code-execution status, file-handling options).
- `docs/rag-api-setup.md` — RAG/embeddings deployment notes, including the
  MinIO path-style + threshold gotcha.

## B.8 Patch and update cadence

- `unattended-upgrades` for OS security patches (REQ-044).
- Subscribed to LibreChat GitHub releases; monthly review window.
- `docs/pii-merge-checklist.md` runs automatically after every merge from
  upstream `main` (Husky `post-merge`).
- Image bumps go through staging-equivalent local testing — there is no
  dedicated staging server; the documented practice is to test against a
  copy of prod data on a local Docker stack (SPEC-010 "Staging environment
  note").

## B.9 Known accepted risks

These are tracked in SPEC-010 §Dependencies and Risks and called out so they
are visible during incident review:

- **RISK-003** — `deploy.resources.limits` could be silently ignored
  depending on the Docker cgroup driver. Mitigated by REQ-039-A verification
  via `docker stats`.
- **RISK-004 / RISK-005** — single-server SPOF for both app and monitoring.
  Mitigated by external uptime + off-host backups + documented DR.
- **RISK-006** — restore-time RTO is an estimate until the next DR drill
  refines it.
- **RISK-007** — PII fail-closed mode would block all messages if Redakt is
  down. We start fail-open (REQ-041) with a documented switchover gate.
- **RISK-010** — feature interaction between PII, rate limit, ban, and balance.
  Mitigated by the explicit rule that PII blocks do NOT count as ban
  violations (EDGE-017).
- **RAG-API dev image** and **`librechat_exporter:latest`** — no upstream
  release tags available; pinned where possible, watched in the monthly
  review.

---

## Pointers for new joiners

If you're trying to *find* a control:

- Compose / images / limits / health checks → `docker-compose.prod.yml`
- Monitoring stack → `monitoring/`
- Backup scripts and cron → `scripts/backup-*.sh`, `crontab.prod`
- Operational procedures → `docs/runbooks/`
- Deploy / re-deploy → `docs/DEPLOYMENT-CHECKLIST.md` + `prod.sh` / `prod-mon.sh` / `prod-sync.sh`
- Access control model → `SDD/ACS.md`
- Why a control exists → `SDD/research/RESEARCH-010-*.md` (problem) and
  `SDD/requirements/SPEC-010-*.md` (requirement)
- PII detection plumbing → middleware in `api/server/middleware`, scripts in
  `scripts/pii-merge-verify.sh`, runbook in `docs/runbooks/pii-override.md`,
  checklist in `docs/pii-merge-checklist.md`.
