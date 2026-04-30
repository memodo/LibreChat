# MemodoAI Production Architecture

> Renamed from `NETWORK_DIAGRAM.md` — this document now covers the full production stack: application services, reverse proxy, observability, security, and guardrails.

## Contents

1. [Overview](#overview)
2. [Network Topology](#network-topology)
3. [Application Services](#application-services)
4. [Reverse Proxy & Public Domains](#reverse-proxy--public-domains)
5. [Observability Stack](#observability-stack)
6. [Alert Rules](#alert-rules)
7. [Security & Guardrails](#security--guardrails)
8. [Backups & Disaster Recovery](#backups--disaster-recovery)
9. [Docker Networks](#docker-networks)
10. [Operations](#operations)
11. [Configuration File Index](#configuration-file-index)

---

## Overview

The MemodoAI production deployment runs on a single Hetzner Cloud host at `memodo-eng.de`. Three independent Docker Compose stacks share an external `caddy_net` network for ingress, plus per-stack defaults for internal traffic:

| Stack | Compose root | Purpose |
|---|---|---|
| **LibreChat** | `/Users/pablooliva/Dev/AI dev/LibreChat/` | Chat UI/API, MongoDB, Meilisearch, RAG API + pgvector, MinIO, node-exporter |
| **Redakt** | `/Users/pablooliva/Dev/AI dev/redakt/` | PII detection (Presidio analyzer + anonymizer + FastAPI wrapper) |
| **TA Research Agent** | `/Users/pablooliva/Dev/AI dev/news agent/` | Multi-stage news analysis pipeline |
| **Caddy / infra** | `/Users/pablooliva/Dev/infra/simple-auth/` | Reverse proxy, TLS termination, basic auth |
| **Monitoring** | `/Users/pablooliva/Dev/AI dev/LibreChat/monitoring/` | Prometheus, Grafana, Alertmanager, exporters, cAdvisor |

---

## Network Topology

```
                                       INTERNET
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │                     CADDY                       │
                │                (Reverse Proxy)                  │
                │  Auto HTTPS via Let's Encrypt · TLS termination │
                │                                                 │
                │  chat.memodo-eng.de         ─► LibreChat:3080   │
                │  minio.memodo-eng.de        ─► minio:9000  (S3) │
                │  minio-console.memodo-eng.de─► minio:9001       │
                │  ta-agent.memodo-eng.de  🔒 ─► ta-agent-api:8001│
                │  redakt.memodo-eng.de    🔒 ─► redakt:8000      │
                │  proc.memodo-eng.de      🔒 ─► jira-process:80  │
                │  memodo-eng.de           🔒 ─► file_server      │
                │  grafana.memodo-eng.de      ─► grafana:3000     │
                │                                                 │
                │  🔒 = Basic Auth (admin / it-lead)              │
                └─────────────────────────────────────────────────┘
                                          │
                                          │ caddy_net (external network)
       ┌──────────────────┬───────────────┼──────────────┬──────────────────┐
       ▼                  ▼               ▼              ▼                  ▼
 ┌───────────┐     ┌─────────────┐    ┌───────┐    ┌───────────┐     ┌──────────┐
 │ LibreChat │     │ TA Research │    │ MinIO │    │  Redakt   │     │ Grafana  │
 │   :3080   │     │ ta-agent-api│    │ :9000 │    │   :8000   │     │  :3000   │
 │           │     │    :8001    │    │ :9001 │    │           │     │          │
 └─────┬─────┘     └─────────────┘    └───┬───┘    └─────┬─────┘     └────┬─────┘
       │                                  │              │                │
       │ default (librechat_default)      │              │ default        │ monitoring
       ├──────────┬──────────┬───────────┤              │ (redakt_default)
       ▼          ▼          ▼            ▼              ▼
 ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────────┐
 │ MongoDB  │ │Meili    │ │ RAG API │ │vectordb │ │presidio-analyzer │
 │  :27017  │ │ :7700   │ │  :8000  │ │ pg :5432│ │     :5001        │
 │  (auth)  │ │         │ │         │ │         │ │presidio-anonym.  │
 │          │ │         │ │         │ │         │ │     :5001        │
 └──────────┘ └─────────┘ └─────────┘ └─────────┘ └──────────────────┘
       ▲          ▲                       ▲                ▲
       │ scrape   │ scrape                │ scrape         │ scrape (via redakt_default)
       │          │                       │                │
       └──────────┴───────────────────────┴────────────────┘
                                  │
                                  │
                          ┌───────┴───────┐
                          │  Prometheus   │
                          │  127.0.0.1:   │
                          │     9090      │
                          └───────┬───────┘
                                  │
                                  ▼
                          ┌───────────────┐         ┌─────────────────────┐
                          │ Alertmanager  │  ─────► │  Microsoft Teams    │
                          │ 127.0.0.1:9093│  webhook│  (incoming webhook) │
                          └───────────────┘         └─────────────────────┘
```

Database ports (MongoDB 27017, Postgres 5432) are **not** published on the host. Prometheus, Grafana, and Alertmanager bind to `127.0.0.1` only — Grafana is reachable externally only via Caddy.

---

## Application Services

### LibreChat (chat UI + API)

| | |
|---|---|
| Container | `LibreChat` |
| Image | `registry.librechat.ai/danny-avila/librechat:v0.8.5` (fork mounts overlay packages/api/dist, data-schemas/dist, data-provider/dist, api/server, client/dist) |
| Port | `3080` |
| Networks | `default`, `caddy_net` |
| Health | `GET /health` (30 s interval) |
| Resource limits | 2 GB / 2.0 CPU |
| File storage | MinIO via S3 (`fileStrategy: "s3"`) |
| Internal deps | `mongodb:27017`, `meilisearch:7700`, `rag_api:8000`, `minio:9000` |
| External deps (caddy_net) | `ta-agent-api:8000/v1`, `redakt:8000` |

### Redakt (PII detection)

| | |
|---|---|
| Service | `redakt` (FastAPI, uvicorn, 2 workers) |
| Port | `8000` |
| Networks | `default` (redakt_default), `caddy_net` |
| Sub-services | `presidio-analyzer:5001` (spacy multilingual), `presidio-anonymizer:5001` |
| Endpoints | `POST /api/detect`, `POST /api/anonymize`, `POST /api/deanonymize`, `POST /api/documents/upload`, `GET /api/health` |
| Public route | `redakt.memodo-eng.de` (basic auth) |

LibreChat integrates Redakt via `api/server/middleware/detectPII.js`:

| Env var | Default | Purpose |
|---|---|---|
| `PII_DETECTION` | `true` | Master toggle |
| `PII_DETECTION_API_URL` | `http://redakt:8000` | Upstream URL |
| `PII_DETECTION_MODE` | `warn` | `warn` (log + allow) or `block` |
| `PII_DETECTION_FAIL_OPEN` | `true` | If Redakt is down, messages pass through |
| `PII_DETECTION_TIMEOUT` | `2000` ms | Request timeout |
| `PII_DETECTION_SCORE_THRESHOLD` | `0.7` | Confidence threshold |
| `PII_DETECTION_EXEMPT_ROLES` | `admin` | Roles bypassing detection |

Circuit breaker: 5 consecutive failures opens the breaker; 30 s cooldown; half-open probe restores service. Audit events recorded in MongoDB `GuardrailEvent` collection (`action: 'block' | 'warn'`). PII findings sanitized from request body before persistence.

### TA Research Agent

| | |
|---|---|
| Service | `ta-agent-api` |
| Port | `8000` (internal); Caddy proxies `:8001` for the public route |
| Public route | `ta-agent.memodo-eng.de` (basic auth) |
| LibreChat endpoint | `http://ta-agent-api:8000/v1` (custom endpoint, model `TA Research Agent v1`) |
| Source | `/Users/pablooliva/Dev/AI dev/news agent/` |

### MinIO (S3-compatible storage)

| | |
|---|---|
| Container | `minio` |
| Image | `minio/minio:RELEASE.2025-03-12T18-04-18Z` |
| Ports | `9000` (S3 API), `9001` (web console) |
| Networks | `default`, `caddy_net` |
| Bucket | `librechat` (created by `minio-init` sidecar) |
| Public routes | `minio.memodo-eng.de` → S3 API; `minio-console.memodo-eng.de` → web UI |

### Data services

| Service | Image | Port | Purpose |
|---|---|---|---|
| `mongodb` | `mongo:8.0.20` | 27017 (not published) | Conversations, users, agents, guardrail events |
| `meilisearch` | `getmeili/meilisearch:v1.35.1` | 7700 | Conversation search |
| `vectordb` | `pgvector/pgvector:0.8.0-pg15-trixie` | 5432 (not published) | Vector store for RAG |
| `rag_api` | `registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite:v0.5.0` | 8000 | Retrieval-augmented generation API |

---

## Reverse Proxy & Public Domains

Caddyfile: `/Users/pablooliva/Dev/infra/simple-auth/Caddyfile`. Automatic HTTPS via Let's Encrypt; `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` set on proxied requests; admin API on `localhost:2019`; JSON request logs.

| Domain | Upstream | Auth | Notes |
|---|---|---|---|
| `chat.memodo-eng.de` | `LibreChat:3080` | None | App handles auth; CORS headers stripped from upstream (same-origin) |
| `minio.memodo-eng.de` | `minio:9000` | None | S3 API for LibreChat uploads |
| `minio-console.memodo-eng.de` | `minio:9001` | None | Web UI; CSP header stripped to allow console assets |
| `ta-agent.memodo-eng.de` | `ta-agent-api:8001` | Basic Auth | TA Research Agent UI |
| `redakt.memodo-eng.de` | `redakt:8000` | Basic Auth | PII API (admin only) |
| `proc.memodo-eng.de` | `jira-process:80` | Basic Auth | Jira process integration |
| `memodo-eng.de` | static `/srv/simple-auth` | Basic Auth | Landing page |
| `grafana.memodo-eng.de` | `grafana:3000` | App login | `GF_SERVER_ROOT_URL` configured; sign-up disabled |

Basic auth users (bcrypt-hashed): `admin`, `it-lead`. Caddy uses the shared external network `caddy_net` to reach upstreams.

> An alternative oauth2-proxy + Azure AD OIDC stack exists at `/Users/pablooliva/Dev/infra/SSO/` but is **not** active in production.

---

## Observability Stack

Deployed from `monitoring/docker-compose.monitoring.yml` on the same host as the application (acknowledged single-point-of-failure — RISK-005; mitigated by external uptime monitoring per REQ-031).

### Diagram

```
                        ┌──────────────────────────────────────────────┐
                        │           HOST METRICS (host pid/sys)        │
                        │     ┌────────────────┐  ┌────────────────┐   │
                        │     │ node-exporter  │  │   cAdvisor     │   │
                        │     │     :9100      │  │     :8080      │   │
                        │     └────────┬───────┘  └────────┬───────┘   │
                        └──────────────┼───────────────────┼───────────┘
                                       │                   │
   ┌────────────────────┐  scrape      │                   │
   │ librechat-exporter │◄─────────────┤                   │
   │   :8000            │              │                   │
   └────────┬───────────┘              │                   │
            │ Mongo URI                │                   │
            ▼                          │                   │
        MongoDB                        │                   │
   ┌────────────────────┐              │                   │
   │ mongodb-exporter   │◄─────────────┤                   │
   │   :9216            │              │                   │
   └────────┬───────────┘              │                   │
            ▼                          │                   │
        MongoDB                        │                   │
   ┌────────────────────┐              │                   │
   │ postgres-exporter  │◄─────────────┤                   │
   │   :9187            │              │                   │
   └────────┬───────────┘              │                   │
            ▼                          │                   │
        vectordb                       │                   │
                                       ▼                   ▼
                                ┌────────────────────────────────┐
                                │         PROMETHEUS             │
                                │       127.0.0.1:9090           │
                                │  scrape_interval: 30s          │
                                │  retention: 30 days            │
                                │  rule files: alerts.yml        │
                                └────────────────┬───────────────┘
                                                 │
                                  ┌──────────────┴──────────────┐
                                  ▼                             ▼
                        ┌──────────────────┐          ┌──────────────────┐
                        │  Alertmanager    │          │     Grafana      │
                        │ 127.0.0.1:9093   │          │  127.0.0.1:3000  │
                        │ group_wait 30s   │          │  grafana.memodo- │
                        │ critical rpt 1h  │          │  eng.de via Caddy│
                        │ default rpt 4h   │          │  signup disabled │
                        └────────┬─────────┘          └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ MS Teams webhook │
                        │ (file-mounted    │
                        │  secret)         │
                        └──────────────────┘
```

### Components

| Service | Image | Bind | Networks | Notes |
|---|---|---|---|---|
| `prometheus` | `prom/prometheus:v2.53.3` | `127.0.0.1:9090` | monitoring, caddy_net, librechat_default, redakt_default | 30 d retention; rule reload via `--web.enable-lifecycle` |
| `grafana` | `grafana/grafana:11.5.2` | `127.0.0.1:3000` | monitoring, caddy_net | Provisioning dir mounted readonly; sign-up disabled |
| `alertmanager` | `prom/alertmanager:v0.28.1` | `127.0.0.1:9093` | monitoring | Teams webhook URL mounted from `/etc/alertmanager/secrets/teams-webhook-url` (gitignored) |
| `node-exporter` | `prom/node-exporter:v1.8.2` | `:9100` (compose-internal) | default | Deployed in **app stack** (`docker-compose.prod.yml`); host pid/sys/rootfs mounted |
| `cadvisor` | `gcr.io/cadvisor/cadvisor:v0.49.1` | `:8080` (compose-internal) | monitoring | Container memory/CPU/disk |
| `librechat-exporter` | `ghcr.io/virtuos/librechat_exporter:latest` | `:8000` (compose-internal) | monitoring, librechat_default | HTTP requests, token usage, conversations (no tagged release; tracked tech debt) |
| `mongodb-exporter` | `percona/mongodb_exporter:0.40.0` | `:9216` | monitoring, librechat_default | `--discovering-mode --compatible-mode` |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.16.0` | `:9187` | monitoring, librechat_default | `sslmode=disable` over internal network |

### Scrape jobs (`monitoring/prometheus/prometheus.yml`)

`prometheus`, `node` (via node-exporter), `librechat` (60 s interval), `mongodb`, `postgres`, `cadvisor`. Global `scrape_interval: 30s`, `scrape_timeout: 10s`.

---

## Alert Rules

Defined in `monitoring/prometheus/alerts.yml`. Alertmanager groups by `[alertname, severity]`; critical alerts repeat every 1 h, others every 4 h; `group_wait: 30s`.

| Group | Alert | Condition | Severity | Notes |
|---|---|---|---|---|
| `service_health` | **ServiceDown** | `up == 0` for 2 m | critical | Any scrape target down |
| `service_health` | **MongoDBRestartLoop** | `changes(mongodb_up[10m]) > 3` | critical | Catches crash-loops |
| `resource_alerts` | **DiskSpaceWarning** | root usage > 80 % for 5 m | warning | |
| `resource_alerts` | **DiskSpaceCritical** | root usage > 90 % for 2 m | critical | |
| `resource_alerts` | **ContainerMemoryHigh** | container mem > 85 % of limit for 5 m | warning | Filtered to Docker cgroups |
| `resource_alerts` | **HostMemoryHigh** | host mem > 90 % for 5 m | warning | |
| `application_alerts` | **HighErrorRate** | API 5xx rate > 5 % over 5 m | critical | Requires librechat-exporter HTTP metrics |
| `application_alerts` | **AdminReportingAbuse** | `/api/admin/usage*` > 60 req/min for 2 m | warning | PERF-003 / REQ-042 |
| `pii_alerts` | **PIICircuitBreakerOpen** | `librechat_pii_circuit_breaker_state == 1` | critical | Redakt unreachable, fail-open active |
| `pii_alerts` | **HighPIIBlockRate** | `> 50` block events/hour | warning | Watch for false positives |
| `backup_alerts` | **BackupStale** | `time() - backup_last_success_timestamp > 90000` for 10 m | warning | Needs node-exporter textfile collector (not yet wired) |
| `tls_alerts` | **TLSCertExpirySoon** | cert expiry < 14 d for 1 h | warning | Inert until blackbox_exporter is deployed |

Notifications: Microsoft Teams via `msteamsv2_configs` with `webhook_url_file` mounted from `monitoring/alertmanager/secrets/teams-webhook-url` (gitignored, per-host). Email receiver template is commented in `alertmanager.yml` for SMTP fallback.

---

## Security & Guardrails

### Network & ingress

- **Single-hop reverse proxy**: Caddy terminates TLS via Let's Encrypt; `TRUST_PROXY=1` matches the single hop.
- **No published DB ports** in production: `mongod` and pgvector are reachable only on Docker networks (`docker-compose.prod.yml` uses `ports: !override []` on MongoDB).
- **Localhost-only observability**: Prometheus, Grafana, and Alertmanager bind to `127.0.0.1`; Grafana is exposed only via Caddy.
- **Basic auth on admin surfaces**: Redakt API, MinIO operations are gated behind admin/it-lead bcrypt credentials. Chat is open (handled by app auth).

### Authentication

- **JWT** secrets `JWT_SECRET` + `JWT_REFRESH_SECRET` (32 hex bytes each).
- **Credential encryption** at rest via `CREDS_KEY` (32 hex) + `CREDS_IV` (16 hex).
- **Email verification required**: `ALLOW_UNVERIFIED_EMAIL_LOGIN=false`.
- **Domain-restricted registration** (`librechat.yaml`): only `memodo.de` and `memodo-eng.de` addresses can sign up.
- **MongoDB authentication**: `mongod --auth`; root and app users provisioned by `mongo-init/init-librechat-user.sh` on greenfield startup.

### Rate limiting

| Resource | IP limit | User limit | Source |
|---|---|---|---|
| File uploads | 100 / 60 min | 50 / 60 min | `librechat.yaml` `rateLimits.fileUploads` |
| Conversation imports | 100 / 60 min | 50 / 60 min | `librechat.yaml` `rateLimits.conversationsImport` |
| Login | `LOGIN_MAX=7` / `LOGIN_WINDOW=5 min` | (combined) | `.env.prod.template` |
| Register | `REGISTER_MAX=5` / `REGISTER_WINDOW=60 min` | (combined) | |
| Messages | 40 / min | 40 / min | `MESSAGE_IP_*` / `MESSAGE_USER_*` |
| Concurrent messages | — | 2 max | `LIMIT_CONCURRENT_MESSAGES=true` |
| Admin usage reports | — | 60 / min | `api/server/routes/admin/usage.js` (PERF-003) |

Limiter implementations live under `api/server/middleware/limiters/`. Violations are logged to MongoDB (`ViolationType.LOGINS`, `FILE_UPLOAD_LIMIT`, `MESSAGE_LIMIT`, …).

### Account lockout / ban

- `BAN_VIOLATIONS=true`, `BAN_INTERVAL=20`, `BAN_DURATION=7200000` ms (2 h). Triggered after threshold of accumulated violations.

### File handling

- Max **5 files** per upload, **20 MB** each.
- Allowed MIME types (Azure OpenAI endpoint): `image/.*`, `application/pdf`, `text/.*`, `application/vnd.openxmlformats-officedocument.*`.

### Agent & MCP guardrails

- **SSRF protection by default**: `actions.allowedDomains: []` and `mcpSettings.allowedDomains: []` block private IPs, localhost, `.internal`/`.local` TLDs unless explicitly whitelisted.
- **Capabilities** explicitly enumerated (`endpoints.agents.capabilities`): `deferred_tools`, `execute_code`, `file_search`, `web_search`, `actions`, `tools`, `artifacts`.
- **Recursion limit** 25 (max 100); citations capped at 30 total / 7 per file; `minRelevanceScore: 0.45`.
- **Model allowlist enforced**: `modelSpecs.enforce: true` — only `gpt-5`, `gpt-5-mini`, `TA Research Agent v1` are exposed.

### PII detection (Redakt)

- All inbound messages, OpenAI `messages`, and Responses `input` are scanned via `detectPII` middleware.
- Mode `warn` in production (logged to MongoDB `GuardrailEvent`); `block` mode rejects requests.
- Fail-open with circuit breaker (5 failures → open → 30 s cooldown) so Redakt outages do not take down chat.
- Detected PII is sanitized from the persisted request body (REQ-011).
- Admin role exempt by default (`PII_DETECTION_EXEMPT_ROLES=admin`).

### Token balance / cost control

- `balance.enabled: false` today. Config retained for future enablement: `startBalance 20000`, monthly auto-refill `10000`.

### Memory feature

- `memory.disabled: false`, per-user store capped at `tokenLimit: 10000`. Memory agent uses Azure OpenAI `gpt-5-mini`, temperature `0.1`.

### CORS & headers

- Caddy strips `Access-Control-*` headers from the LibreChat upstream so the same-origin SPA does not get permissive CORS.
- MinIO console gets `-Content-Security-Policy` strip so the web UI loads behind the proxy.
- No Helmet/CSP layer on the Express server itself.

---

## Backups & Disaster Recovery

Schedule from `crontab.prod` (`MAILTO=admin@memodo.de`, `PROJECT=/opt/docker/librechat`):

| When | Job | Script |
|---|---|---|
| Daily 02:00 | MongoDB dump | `scripts/backup-mongodb.sh` |
| Daily 02:30 | MinIO bucket mirror | `scripts/backup-minio.sh` |
| Sundays 03:00 | PostgreSQL dump | `scripts/backup-postgres.sh` |
| Daily 03:30 | Config / compose / `.env` structure | `scripts/backup-config.sh` |
| Daily 04:00 | Off-host sync | `scripts/backup-offhost.sh` |
| Every 5 min | Monitoring watchdog | `scripts/monitoring-watchdog.sh` |

Off-host destination is configurable: `OFF_HOST_MODE=rsync|s3`, `OFF_HOST_RSYNC_TARGET`, `OFF_HOST_S3_BUCKET`. Optional `BACKUP_WEBHOOK_URL` posts failure notifications to Teams/Slack.

The `BackupStale` Prometheus alert depends on a node-exporter textfile collector that backup scripts feed via `/var/lib/node_exporter/textfile/backup_*.prom`. Collector mount is **not yet wired** — alert is currently inert.

---

## Docker Networks

| Network | Type | Joined by |
|---|---|---|
| `caddy_net` | external (bridge) | Caddy, LibreChat, MinIO, ta-agent-api, redakt, prometheus, grafana |
| `librechat_default` | bridge (per-stack default, referenced externally by monitoring) | LibreChat, mongodb, meilisearch, rag_api, vectordb, minio, minio-init, node-exporter; prometheus + librechat-exporter + mongodb-exporter + postgres-exporter join from monitoring |
| `redakt_default` | bridge (per-stack default, referenced externally by monitoring) | redakt, presidio-analyzer, presidio-anonymizer; prometheus joins for scraping |
| `news-agent_default` | bridge (per-stack default) | ta-agent-api |
| `monitoring` | bridge (monitoring stack) | prometheus, alertmanager, grafana, librechat-exporter, mongodb-exporter, postgres-exporter, cadvisor |

The monitoring stack uses `${COMPOSE_PROJECT_NETWORK}` and `${REDAKT_PROJECT_NETWORK}` env vars to bind to the actual external network names — set these to match the project directories that created them.

---

## Operations

### Deployment

`./prod.sh up -d` merges three compose files in order: `docker-compose.yml` → `docker-compose.override.yml` → `docker-compose.prod.yml`. Environment loaded from `.env.prod`. The five fork-customization bind mounts (`packages/api/dist`, `packages/data-schemas/dist`, `packages/data-provider/dist`, `api/server`, `client/dist`) must be pre-built via `prod-sync.sh` before bringing the stack up; the same five paths are listed in both `docker-compose.override.yml` and `docker-compose.prod.yml` (the latter uses `volumes: !override` to avoid the dev `.env` mount).

The monitoring stack has its own wrapper, `./prod-mon.sh`, which points at `monitoring/docker-compose.monitoring.yml` with the same `--env-file .env.prod`. Bring it up after the application stack so the external networks (`librechat_default`, `redakt_default`, `caddy_net`) already exist. Examples: `./prod-mon.sh up -d`, `./prod-mon.sh logs -f alertmanager`, `./prod-mon.sh exec prometheus wget -qO- --post-data= http://localhost:9090/-/reload` (rule reload).

### Health checks

Every container in the prod compose has a healthcheck (30 s interval, 10 s timeout, 3 retries) — see service tables above. The `monitoring-watchdog.sh` cron re-checks Prometheus health every 5 minutes as belt-and-braces.

### Resource limits & log rotation

All services declare `deploy.resources.limits` and `logging.driver: json-file` with `max-size: 10m`, `max-file: 3` (or `5` for the API container). Total guaranteed memory budget on the host: API 2 GB + MongoDB 4 GB + Meili 1 GB + vectordb 1 GB + RAG 1 GB + MinIO 1 GB + exporters/observability ~3 GB.

### Image pinning

All production images are pinned to specific tags. Two known `:latest` exceptions (accepted tech debt):

- `librechat-exporter:latest` — no tagged releases at `ghcr.io/virtuos/librechat_exporter` as of 2026-04.
- `librechat-rag-api-dev-lite:v0.5.0` — pinned, but only a dev-lite release exists upstream.

---

## Configuration File Index

| Concern | Path |
|---|---|
| Base compose | `docker-compose.yml` |
| Dev overrides (network, MinIO, fork mounts) | `docker-compose.override.yml` |
| Prod overrides (auth, healthchecks, limits, log rotation) | `docker-compose.prod.yml` |
| Monitoring stack | `monitoring/docker-compose.monitoring.yml` |
| Prometheus scrapes | `monitoring/prometheus/prometheus.yml` |
| Alert rules | `monitoring/prometheus/alerts.yml` |
| Alertmanager routing | `monitoring/alertmanager/alertmanager.yml` |
| Teams webhook secret | `monitoring/alertmanager/secrets/teams-webhook-url` (gitignored) |
| Endpoint, file storage, guardrail config | `librechat.yaml` |
| Production env (secrets, rate limit knobs) | `.env.prod` (gitignored); see `.env.prod.template` |
| Reverse proxy | `/Users/pablooliva/Dev/infra/simple-auth/Caddyfile` |
| Cron schedule | `crontab.prod` |
| PII middleware | `api/server/middleware/detectPII.js` |
| Rate limiters | `api/server/middleware/limiters/` |
| Backup / sync scripts | `scripts/backup-*.sh`, `prod-sync.sh`, `prod.sh`, `prod-mon.sh` |
| Redakt service | `/Users/pablooliva/Dev/AI dev/redakt/` (separate repo) |
| TA Research Agent | `/Users/pablooliva/Dev/AI dev/news agent/` (separate repo) |
