# RESEARCH-010: Production Readiness

**Date:** 2026-03-31 (updated 2026-04-01 — reflects pablo branch merge: SPEC-008 admin dashboard, SPEC-009 PII detection)
**Status:** Research Complete
**Scope:** Backups, monitoring, guardrails, usage/cost tracking, and additional production hardening for the MemodoAI LibreChat deployment.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Backups](#2-backups)
3. [Monitoring & Uptime](#3-monitoring--uptime)
4. [Guardrails](#4-guardrails)
5. [Usage & Cost Tracking](#5-usage--cost-tracking)
6. [Additional Production Concerns](#6-additional-production-concerns)
7. [Prioritized Action Plan](#7-prioritized-action-plan)
8. [Sources](#8-sources)

---

## 1. Current State Assessment

### Adjacent Infrastructure

The production server has a separate infra stack at `/Users/pablooliva/Dev/infra/` that sits in front of LibreChat:

- **Active (`simple-auth/`):** Caddy 2 reverse proxy handling TLS (Let's Encrypt) and routing for all `memodo-eng.de` subdomains. Connected to LibreChat via `caddy_net` external Docker network. Routes: `chat.memodo-eng.de` → LibreChat, `minio.memodo-eng.de` → MinIO S3 API, `minio-console.memodo-eng.de` → MinIO UI, `ta-agent.memodo-eng.de` → Research Agent, `proc.memodo-eng.de` → Jira Process app.
- **Prototype (`SSO/`):** oauth2-proxy v7.6.0 + Caddy + Microsoft Entra ID OIDC gateway. Not yet deployed but represents an upgrade path for centralized authentication across all services. Includes health checks, HTTP/3, secure cookie handling.

The Caddy `caddy_data` volume (TLS certificates) must also be included in backup planning.

### What's Already in Place
- Caddy reverse proxy with TLS termination on `caddy_net` external network (see Adjacent Infrastructure above)
- MinIO for S3-compatible file storage (`fileStrategy: "s3"`)
- RAG API + pgvector for semantic search
- MeiliSearch for full-text conversation search
- Persistent Docker volumes for all data stores
- Container restart policies (`restart: always`)
- Winston-based application logging with daily rotation
- Built-in rate limiting and moderation violation system (configurable but not fully tuned)
- Token transaction tracking per user/conversation/model
- **Admin reporting dashboard** (SPEC-008) — usage trends, model breakdown, top users, activity log, guardrail events
- **PII detection middleware** (SPEC-009) — block/warn modes, circuit breaker, audit trail via GuardrailEvent collection
- **GuardrailEvent audit system** — stores PII detection metadata (entity types, counts) without storing actual PII values

### Critical Gaps
- **MongoDB runs with `--noauth`** — no authentication at all
- **PostgreSQL uses hardcoded default credentials** (`myuser`/`mypassword`)
- **MinIO uses default credentials** (`minioadmin`/`minioadmin123`)
- **Default JWT/CREDS secrets** — LibreChat ships default values for `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and warns at startup if unchanged
- **No health checks** defined in docker-compose
- **No automated backups** for any data store
- **No monitoring or alerting** infrastructure
- **Debug logging enabled** (`DEBUG_LOGGING=true`)
- **Open registration** (`ALLOW_REGISTRATION=true`, `ALLOW_UNVERIFIED_EMAIL_LOGIN=true`)

---

## 2. Backups

### 2.1 Recovery Objectives (Define Before Choosing a Schedule)

Before finalizing a backup schedule, define business-driven recovery targets:

- **RPO (Recovery Point Objective):** How much data loss is acceptable? Daily backups mean up to 24 hours of lost conversations, transactions, and guardrail events. If compliance audit trails (GuardrailEvent) cannot tolerate this, consider more frequent MongoDB backups (e.g., every 4-6 hours) or WAL-based continuous archiving.
- **RTO (Recovery Time Objective):** How long can the service be down during a restore? A full `mongorestore` of a large database can take 30+ minutes. Factor in time to diagnose, pull backups from off-site storage, and verify post-restore integrity.

**Recommended starting point for a small team deployment:**
- RPO: 24 hours (daily backups) — acceptable if conversations are not business-critical records
- RTO: 1 hour — assumes backups are stored locally with off-site copies
- Revisit these targets if PII detection is running in block mode (GuardrailEvent audit trail becomes compliance-relevant)

The backup schedule in subsequent sections is based on a 24-hour RPO. Adjust frequency if your RPO is tighter.

### 2.2 What Needs to Be Backed Up

| Component | Data | Location | Criticality |
|-----------|------|----------|-------------|
| MongoDB | Users, conversations, messages, transactions, agents, prompts, sessions, files metadata, balances, roles, **guardrail events** | `./data-node:/data/db` | **Critical** |
| PostgreSQL (pgvector) | RAG embeddings, vector data | `pgdata2:/var/lib/postgresql/data` | Medium (rebuildable from source files) |
| MinIO | Uploaded files, avatars, agent resources | `./minio-data:/data` | **Critical** (user-uploaded content) |
| MeiliSearch | Full-text search indexes | `./meili_data_v1.35.1:/meili_data` | Low (rebuilt from MongoDB on startup) |
| Configuration | `.env`, `librechat.yaml`, `docker-compose.override.yml` | Project directory | **Critical** |
| Caddy TLS certs | Let's Encrypt certificates and config | `caddy_data`, `caddy_config` volumes (infra repo) | Medium (auto-renewable but avoids rate limits) |
| Logs | Application debug/error logs | `./logs:/app/logs` | Low |

### 2.3 MongoDB Backup Strategy

**Tool:** `mongodump` / `mongorestore` (built into the MongoDB container)

```bash
# Backup (compressed archive)
docker exec -i chat-mongodb mongodump --archive --gzip --db LibreChat \
  > "./backups/LibreChat-mongo-$(date +"%Y-%m-%d-%H%M").gz"

# Restore (--drop replaces existing data)
docker exec -i chat-mongodb mongorestore --archive --gzip --drop --db LibreChat \
  < ./backups/LibreChat-mongo-2026-03-31-0200.gz
```

**Collections to back up** (23 collections): `actions`, `agents`, `assistants`, `balances`, `banners`, `conversations`, `conversationtags`, `files`, **`guardrailevents`**, `keys`, `messages`, `pluginauths`, `presets`, `projects`, `promptgroups`, `prompts`, `roles`, `sessions`, `sharedlinks`, `tokens`, `toolcalls`, `transactions`, `users`.

**Consistency note:** `mongodump` without `--oplog` is not crash-consistent — if writes occur during the dump, the backup may contain partially-written data or inconsistent cross-collection state. The `--oplog` flag requires a replica set. For a single-node deployment, this means either: (a) accept the risk (low for small deployments with light write load), (b) briefly pause writes during backup (e.g., stop the API container, dump, restart), or (c) convert to a single-node replica set to enable `--oplog` for point-in-time consistency.

**Recommended schedule:**
- Daily full `mongodump` with 30-day retention (adjust based on RPO targets in Section 2.1)
- Consider MongoDB replica set (3 nodes) for HA — replication is NOT a substitute for backups

**Community tool:** [jgera/librechat-backup](https://github.com/jgera/librechat-backup) — containerized backup solution for LibreChat MongoDB.

### 2.4 PostgreSQL (pgvector) Backup

```bash
# Backup
docker exec -i vectordb pg_dump -U myuser -d mydatabase --format=custom \
  > "./backups/vectordb-$(date +"%Y-%m-%d").dump"

# Restore
docker exec -i vectordb pg_restore -U myuser -d mydatabase --clean \
  < ./backups/vectordb-2026-03-31.dump
```

**Note:** pgvector data is rebuildable by re-uploading files through the RAG API, so backup priority is lower than MongoDB. However, rebuilding is slow and costs embedding API tokens.

### 2.5 MinIO Backup

The MinIO Client (`mc`) is not installed on the host and is not included in the MinIO server image. Use a dedicated `minio/mc` container (similar to the existing `minio-init` sidecar):

```bash
# Run mc from a container on the same Docker network
docker run --rm --network caddy_net \
  -v "$(pwd)/backups:/backups" \
  minio/mc:latest sh -c '
    mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD &&
    mc mirror local/librechat /backups/minio-librechat/
  '

# Or sync to a remote S3 bucket for off-site backup
docker run --rm --network caddy_net \
  minio/mc:latest sh -c '
    mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD &&
    mc alias set remote https://s3.amazonaws.com $AWS_KEY $AWS_SECRET &&
    mc mirror local/librechat remote/librechat-backup/
  '
```

**Alternative:** Enable MinIO bucket versioning for accidental deletion recovery:
```bash
docker run --rm --network caddy_net \
  minio/mc:latest sh -c '
    mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD &&
    mc version enable local/librechat
  '
```

### 2.6 Configuration Backup

```bash
# Back up all configuration files
tar czf "./backups/config-$(date +"%Y-%m-%d").tar.gz" \
  .env librechat.yaml docker-compose.override.yml
```

### 2.7 Backup Automation Recommendation

Create a cron-based backup script that:
1. Runs `mongodump` daily at off-peak hours
2. Runs `pg_dump` weekly (or daily if embedding costs are a concern)
3. Runs `mc mirror` for MinIO daily
4. Copies backups to an off-host location (remote S3, NAS, etc.)
5. Prunes backups older than retention period (e.g., 30 days)
6. Sends alerts on backup failure (email or webhook)

---

## 3. Monitoring & Uptime

### 3.1 Health Checks

**Add Docker health checks to `docker-compose.override.yml`:**

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  mongodb:
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 30s
      timeout: 10s
      retries: 3

  meilisearch:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7700/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  vectordb:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myuser -d mydatabase"]
      interval: 30s
      timeout: 10s
      retries: 3

  minio:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3

  rag_api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 3.2 Prometheus + Grafana Stack

**Recommended approach:** Deploy Prometheus + Grafana alongside the existing stack.

**Deployment topology warning:** If Prometheus and Grafana run on the same server as LibreChat, a server failure takes down both the application AND the monitoring that should alert you. Mitigations: (a) use an external uptime service (Section 3.5) as the first line of defense, (b) deploy monitoring on a separate host if budget allows, or (c) use a cloud SaaS monitoring solution (Grafana Cloud free tier, Azure Monitor). At minimum, ensure the external uptime check (Section 3.5) is independent of this server.

**LibreChat metrics:** A community Prometheus exporter exists at [virtUOS/librechat_exporter](https://github.com/virtUOS/librechat_exporter/) that connects to MongoDB and exposes:
- Token usage metrics (prompt tokens, completion tokens)
- User activity counts
- Conversation counts
- Standard OpenMetrics format

**Additional exporters:**
- **mongodb_exporter** — connection pool, opcounters, replication lag, memory usage
- **postgres_exporter** — connection counts, query performance, table sizes, vacuum stats
- **minio_exporter** — bucket sizes, request rates, error rates (MinIO has built-in Prometheus metrics at `/minio/v2/metrics/cluster`)
- **caddy** — already exposes Prometheus metrics natively
- **node_exporter** — host-level CPU, memory, disk, network

### 3.3 Alerting Recommendations

| Alert | Condition | Severity |
|-------|-----------|----------|
| Service down | Health check fails for > 2 minutes | Critical |
| High error rate | API 5xx rate > 5% over 5 min | Critical |
| MongoDB connection crash loop | More than 3 restarts in 10 minutes | Critical |
| Disk usage | Any volume > 80% capacity | Warning |
| Disk usage | Any volume > 90% capacity | Critical |
| MongoDB slow queries | Queries > 1s | Warning |
| High memory usage | Container memory > 85% of limit | Warning |
| Certificate expiry | TLS cert expires in < 14 days | Warning |
| Backup failure | Backup script exit code != 0 | Critical |
| High token spend | Daily Azure OpenAI cost > threshold | Warning |
| PII circuit breaker open | Circuit state transitions to open | Critical |
| Redakt API down | Redakt health check fails for > 1 minute | Critical (if PII_DETECTION=true) |
| High PII block rate | > 50 guardrail events/hour | Warning (may indicate false positives) |
| Admin reporting abuse | > 60 admin usage API calls/min | Warning |

### 3.4 Log Management

**Production logging configuration (.env):**
```
DEBUG_LOGGING=false
LOG_LEVEL=warn
CONSOLE_JSON=true     # Structured JSON logs for log aggregation
DEBUG_CONSOLE=false
```

**Options for log aggregation:**
- **Lightweight:** Loki + Grafana (pairs with existing Prometheus stack)
- **Full-featured:** ELK Stack (Elasticsearch + Logstash + Kibana)
- **Cloud-native:** Azure Monitor Logs / Log Analytics (if already using Azure)

### 3.5 Uptime Monitoring

**External uptime checks** (independent of the server):
- **UptimeRobot** (free tier: 50 monitors, 5-min intervals)
- **Better Stack** (formerly Better Uptime)
- **Azure Monitor Availability Tests** (if on Azure)

Monitor these endpoints:
- `https://chat.memodo-eng.de` — frontend loads
- `https://chat.memodo-eng.de/health` — API health (verified: `api/server/index.js:94`)
- `https://minio-console.memodo-eng.de` — MinIO console accessible

### 3.6 Known Production Issue: MongoDB Crash Loop

**Critical bug ([Issue #11808](https://github.com/danny-avila/LibreChat/issues/11808)):** Transient MongoDB connectivity issues crash the Node process via `process.exit(1)`. Each restart triggers a full MeiliSearch index re-sync (slow at scale), creating a cascading crash loop. In one reported production environment: 5 crashes in ~43 minutes under load.

**Mitigation:**
- Monitor container restart counts and alert on rapid restarts
- Ensure MongoDB connection pool settings are tuned (`MONGO_MAX_POOL_SIZE`, `MONGO_WAIT_QUEUE_TIMEOUT_MS`)
- Consider running MongoDB as a replica set (even single-node) for connection resilience
- Watch the upstream issue for a fix

---

## 4. Guardrails

### 4.1 Rate Limiting (librechat.yaml + .env)

**Already configurable but needs tuning for production:**

```yaml
# librechat.yaml — file and import rate limits
rateLimits:
  fileUploads:
    ipMax: 100
    ipWindowInMinutes: 60
    userMax: 50
    userWindowInMinutes: 60
  conversationsImport:
    ipMax: 100
    ipWindowInMinutes: 60
    userMax: 50
    userWindowInMinutes: 60
```

```env
# .env — authentication and messaging rate limits
LOGIN_MAX=7
LOGIN_WINDOW=5
REGISTER_MAX=5
REGISTER_WINDOW=60
LIMIT_CONCURRENT_MESSAGES=true
CONCURRENT_MESSAGE_MAX=2
LIMIT_MESSAGE_IP=true
MESSAGE_IP_MAX=40
MESSAGE_IP_WINDOW=1
```

### 4.2 Automated Moderation / Ban System

LibreChat has a built-in violation scoring system:

```env
BAN_VIOLATIONS=true
BAN_DURATION=7200000        # 2 hours in ms
BAN_INTERVAL=20             # Ban after 20 violations
```

**Violation categories tracked:** `LOGIN`, `REGISTRATION`, `CONCURRENT`, `MESSAGE_LIMIT`, `NON_BROWSER`, `TOKEN_BALANCE`, `ILLEGAL_MODEL_REQUEST`, `FILE_UPLOAD_LIMIT`, `FILE_UPLOAD_IP_LIMIT`, `TTS_LIMIT`, `STT_LIMIT`, `IMPORT_LIMIT`.

**Recommendation:** Enable and tune these for production. The defaults are reasonable starting points.

### 4.3 Token Balance / Credit System

For controlling per-user spending:

```yaml
# librechat.yaml
balance:
  enabled: true
  startBalance: 100000       # Initial credits on registration
  autoRefillEnabled: true
  refillIntervalValue: 30
  refillIntervalUnit: "days"
  refillAmount: 100000
```

When balance reaches zero, the user cannot send messages until refill. This acts as a per-user cost cap.

### 4.4 Content Moderation

```env
# OpenAI Moderation API — screens messages for harmful content
OPENAI_MODERATION=true
OPENAI_MODERATION_REVERSE_PROXY=     # Optional proxy
```

This uses OpenAI's moderation endpoint to flag harmful, violent, or inappropriate content before it's sent to the LLM. Works with Azure OpenAI as well.

### 4.5 Authentication Guardrails

```env
ALLOW_REGISTRATION=false              # Disable open registration
ALLOW_SOCIAL_REGISTRATION=false       # Control OAuth registration
ALLOW_UNVERIFIED_EMAIL_LOGIN=false    # Require email verification
```

```yaml
# librechat.yaml — restrict registration to specific domains
registration:
  allowedDomains:
    - "memodo.de"
    - "memodo-eng.de"
```

### 4.6 SSRF Protection

LibreChat blocks localhost, private IPs, and `.internal/.local` TLDs by default for Actions and MCP connections. Internal targets must be explicitly allowlisted:

```yaml
# librechat.yaml
actions:
  allowedDomains:
    - "internal-api.memodo-eng.de"
mcpSettings:
  allowedDomains:
    - "internal-service.local"
```

### 4.7 Agent Guardrails

```yaml
# librechat.yaml — already configured
agentSettings:
  recursionLimit: 25          # Max agent loop iterations (max 100)
  maxCitations: 30
  maxCitationsPerFile: 7
  minRelevanceScore: 0.45
```

### 4.8 PII Detection Middleware (SPEC-009 — Merged)

**Status:** Implemented and merged from `feature/009` via `pablo` branch.

PII detection is now a production guardrail using an external Redakt API service. It intercepts all chat routes (agents, assistants v1/v2, OpenAI API, Responses API) before messages reach the LLM.

**Two operating modes:**
- **`detect` (block)** — PII-containing messages return HTTP 400; message body sanitized before any persistence; `GuardrailEvent` logged with `action: "block"`, `severity: "high"`
- **`warn`** — messages pass through with client-side toast warning; `GuardrailEvent` logged with `action: "warn"`, `severity: "medium"`

**Key configuration:**
```env
PII_DETECTION=true                              # Feature toggle (default: false)
PII_DETECTION_API_URL=http://redakt-api:8000    # Redakt service URL
PII_DETECTION_MODE=detect                       # detect (block) or warn
PII_DETECTION_FAIL_OPEN=false                   # false = block all if Redakt unavailable
PII_DETECTION_TIMEOUT=2000                      # API call timeout (ms)
PII_DETECTION_EXEMPT_ROLES=admin                # Roles that bypass PII checks
PII_DETECTION_SCORE_THRESHOLD=0.7               # Confidence threshold
```

**Circuit breaker:** 5 consecutive Redakt failures open the circuit for 30s. In fail-closed mode (default), ALL messages are blocked during this window.

**Production deployment considerations:**
- **Redakt API is a hard dependency** when `PII_DETECTION=true` — if Redakt is down and `FAIL_OPEN=false`, no messages can be sent
- Redakt must be deployed as a Docker service and added to the compose stack or accessible via network
- Add Redakt to the SSO gateway (RESEARCH-011) route plan if it needs its own subdomain
- **Recommend `PII_DETECTION_MODE=warn` initially** to audit false positives before switching to block mode
- Circuit breaker state is per-process (not shared across replicas) — acceptable for single-process Docker but needs documentation for scaled deployments

**Audit trail:** `GuardrailEvent` collection stores metadata only (entity types, counts, user, route) — never the actual PII values or message content. Fire-and-forget persistence; failures don't block requests.

**Known production-readiness gaps (from code review):**
1. Text extraction stops at first matched body field — PII in a secondary field (e.g., `messages` when `text` also exists) may not be checked
2. Admin reporting endpoints for guardrail events are missing rate limiting (spec requires 60 req/min)
3. MongoDB aggregation timeouts return 500 instead of 504
4. Timezone parameter on reporting trends endpoint not validated against IANA

**Scope limitations (documented in RESEARCH-009, not bugs):**
- File uploads are NOT scanned for PII
- Multi-turn conversation history may contain PII from before detection was enabled
- Custom agent tool/action calls to external APIs are not screened

---

## 5. Usage & Cost Tracking

### 5.1 Admin Reporting Dashboard (SPEC-008 — Merged)

**Status:** Implemented and merged from `feature/008` via `pablo` branch.

An admin-only dashboard is now available at `/d/reports` with six API endpoints under `/api/admin/usage/*`:

| Endpoint | Purpose |
|----------|---------|
| `GET /overview` | Summary metrics (users, conversations, tokens, spend) |
| `GET /trends` | Usage over time (day/week/month granularity) |
| `GET /models` | Top models by token spend |
| `GET /users` | Top users by spend (with search) |
| `GET /users/:userId` | User detail — per-model breakdown, conversations |
| `GET /activity` | Conversation activity log |
| `GET /guardrail-events` | PII detection event log with user lookup |
| `GET /guardrail-summary` | Guardrail metrics aggregation |

**Access control:** `requireJwtAuth` → `requireCapability(ACCESS_ADMIN)` → `requireCapability(READ_USAGE)` on all endpoints.

**Production note:** Rate limiting on these endpoints is specified (60 req/min) but not yet implemented. These endpoints run MongoDB aggregation pipelines — without rate limiting, an admin could degrade database performance for all users. **This is a code fix that should be tracked as an issue** (see Phase 4, item 37 in the action plan).

### 5.2 LibreChat Built-in Token Tracking

LibreChat tracks every API call in the MongoDB `transactions` collection:
- `user` — which user made the request
- `conversationId` — which conversation
- `model` — which model was used
- `tokenType` — `prompt` or `completion`
- `rawAmount` — token count
- `context` — endpoint, model details

**To query usage data directly:**
```javascript
// Total tokens by user (last 30 days)
db.transactions.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
  { $group: { _id: "$user", totalTokens: { $sum: "$rawAmount" } } },
  { $sort: { totalTokens: -1 } }
])
```

**Admin dashboard (SPEC-008):** Merged. See Section 5.1 for the full endpoint reference.

### 5.3 Azure-Native Cost & Usage Tracking

#### Azure Cost Management + Billing
- All Azure OpenAI costs flow into the standard **Cost Analysis** blade
- Separate billing meters for input tokens and output tokens per model
- Can filter/group by resource, resource group, subscription, or tag
- **Lag:** 24-48 hours for usage data to appear
- Supports budget creation with alert thresholds (50%, 75%, 90%, 100%)

**Important limitation:** No hard spending cap exists in Azure OpenAI. Budget alerts are notification-only. Must implement application-level controls (like LibreChat's balance system) or use Azure API Management token-limit policies.

#### Azure Monitor Platform Metrics (Automatic, No Config Needed)

Azure OpenAI publishes these metrics under `Microsoft.CognitiveServices/accounts`:

| Metric | Description |
|--------|-------------|
| `ProcessedPromptTokens` | Input tokens processed |
| `GeneratedTokens` | Output tokens (completion) |
| `TokenTransaction` | Total inference tokens |
| `AzureOpenAIRequests` | API call count (splittable by model, deployment, status code) |
| `AzureOpenAITimeToResponse` | Time to first response (streaming) |
| `AzureOpenAITTLTInMS` | Time to last byte |
| `AzureOpenAITokenPerSecond` | Generation throughput |
| `AzureOpenAIAvailabilityRate` | (Total - Server Errors) / Total |
| `RAIRejectedRequests` | Content safety blocked requests |
| `RAIHarmfulRequests` | Flagged harmful requests |

**All metrics support splitting by:** `ModelDeploymentName`, `ModelName`, `ModelVersion`, `StatusCode`, `StreamType`, `Region`.

#### Azure Diagnostic Logs (Requires Setup)

Create a **Diagnostic Setting** on the Azure OpenAI resource to enable:

| Log Category | Description |
|-------------|-------------|
| `Audit` | Audit logs |
| `RequestResponse` | Full request/response logs (optional content logging) |
| `AzureOpenAIRequestUsage` | Per-request token usage |
| `Trace` | Trace logs |

Route to **Log Analytics** for KQL querying, or to **Storage Account** for archival.

#### Azure Budgets + Alerts

```
Azure Portal → Cost Management → Budgets → Create
- Scope: Resource group or subscription
- Budget amount: e.g., €500/month
- Alert conditions: 50%, 75%, 90%
- Action group: Email + webhook (optional Azure Function to disable deployments)
```

#### API-Level Token Tracking

Every Azure OpenAI response includes:
```json
{
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

Response headers provide real-time rate info:
- `x-ratelimit-remaining-tokens` — tokens left in current 60s window
- `x-ratelimit-remaining-requests` — requests left in current window

### 5.4 Recommended Cost Tracking Architecture

```
Layer 1: LibreChat (real-time, per-user)
├── transactions collection → per-user, per-model token counts
├── balance system → per-user credit caps
└── admin dashboard (SPEC-008) → usage trends, cost reports

Layer 2: Azure Monitor (near real-time, per-deployment)
├── Platform metrics → token counts, latency, error rates
├── Diagnostic logs → per-request detail
└── Grafana/Workbooks → dashboards

Layer 3: Azure Cost Management (daily, billing-authoritative)
├── Cost Analysis → actual dollar spend
├── Budgets → threshold alerts
└── Tags → team/project attribution
```

---

## 6. Additional Production Concerns

### 6.1 Secrets Management (Priority: CRITICAL)

**Current state:** All secrets in `.env` file on disk with default/example values.

**Minimum actions:**
1. Regenerate ALL secrets immediately:
   ```bash
   # JWT secrets
   openssl rand -hex 32  # → JWT_SECRET
   openssl rand -hex 32  # → JWT_REFRESH_SECRET

   # Credential encryption
   openssl rand -hex 32  # → CREDS_KEY
   openssl rand -hex 16  # → CREDS_IV

   # MeiliSearch
   openssl rand -hex 32  # → MEILI_MASTER_KEY
   ```
2. Enable MongoDB authentication and create dedicated users
3. Change PostgreSQL credentials from defaults
4. Change MinIO credentials from defaults
5. Ensure `.env` is NOT committed to version control

**Better approach:** Use Docker secrets, HashiCorp Vault, or Azure Key Vault to inject secrets at runtime rather than storing them in `.env`.

### 6.2 MongoDB Authentication (Priority: CRITICAL)

**WARNING:** The `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` environment variables are only processed on **first initialization** of an empty data directory. Since the existing deployment already has data in `./data-node:/data/db`, these env vars will be silently ignored. The correct migration procedure is:

**Step 1: Create users while still running `--noauth`**
```bash
# Connect to MongoDB (still running without auth)
docker exec -it chat-mongodb mongosh

# In mongosh:
use admin
db.createUser({
  user: "adminUser",
  pwd: "CHANGE_ME_STRONG_PASSWORD",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase"]
})

# Create a dedicated application user
use LibreChat
db.createUser({
  user: "librechat",
  pwd: "CHANGE_ME_ANOTHER_STRONG_PASSWORD",
  roles: [{ role: "readWrite", db: "LibreChat" }]
})
```

**Step 2: Update `.env` with the new credentials**
```env
MONGO_URI=mongodb://librechat:CHANGE_ME_ANOTHER_STRONG_PASSWORD@mongodb:27017/LibreChat?authSource=LibreChat
```

**Step 3: Enable authentication in `docker-compose.override.yml`**
```yaml
services:
  mongodb:
    command: mongod --auth --bind_ip_all
```

**Step 4: Restart and verify**
```bash
docker compose restart mongodb api
# Verify LibreChat can still connect
docker compose logs api | tail -20
```

**Rollback:** If the application can't connect, remove `--auth` from the command and restart MongoDB. The users you created will still exist but won't be required.

### 6.3 NODE_ENV=production (Priority: HIGH)

Must be set to activate:
- Secure cookies (HttpOnly, Secure, SameSite)
- Static file cache headers
- Response compression
- Disabling of debug middleware

**Side effect:** Changing this on an existing deployment will alter cookie flags (adding `Secure`, `SameSite`). This will invalidate all active user sessions, forcing everyone to re-login. Plan this as a brief disruption during a maintenance window.

### 6.4 Network Hardening (Priority: HIGH)

- **Don't expose MongoDB port 27017** externally (currently exposed in override). Only expose on the internal Docker network.
- **Don't expose PostgreSQL port 5432** externally.
- **MinIO API port 9000** — restrict to internal network if not needed externally; expose only 9001 (console) if needed.
- Ensure `TRUST_PROXY` value matches your actual proxy chain depth. With the current Caddy setup (one proxy hop), `TRUST_PROXY=1` is correct. Getting this wrong breaks rate limiting (wrong client IP) and secure cookie detection.

### 6.5 CORS Configuration (Priority: HIGH)

**Current state:** `api/server/index.js:116` has `app.use(cors())` — wide open, any origin accepted. This means any website can make authenticated requests to the LibreChat API if a user has an active session cookie.

**Fix:** Set `DOMAIN_CLIENT` and `DOMAIN_SERVER` in `.env` to the actual production URL:
```env
DOMAIN_CLIENT=https://chat.memodo-eng.de
DOMAIN_SERVER=https://chat.memodo-eng.de
```

Verify that LibreChat's CORS middleware restricts origins based on these values. If it doesn't (i.e., the `cors()` call is unconditional), this is a security issue that may require a code change or a Caddy-level CORS header override.

### 6.6 Resource Limits (Priority: MEDIUM)

Add memory and CPU limits to containers to prevent runaway processes.

The `deploy.resources` syntax is part of the Compose Spec and is supported by Docker Compose v5+ (confirmed: v5.1.0 installed). However, enforcement depends on the Docker Engine's cgroup configuration. **After adding limits, verify they are enforced** by running `docker stats` and confirming the `MEM LIMIT` column shows the configured values.

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'
        reservations:
          memory: 512M
  mongodb:
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 1G
```

If `deploy.resources` is silently ignored (no limits shown in `docker stats`), fall back to the legacy syntax which is always enforced:
```yaml
services:
  api:
    mem_limit: 2g
    cpus: 2.0
```

### 6.7 Redis for Production (Priority: MEDIUM)

Currently not enabled. For production with multiple users:

```env
USE_REDIS=true
REDIS_URI=redis://redis:6379
```

Benefits:
- Shared session store (required if running multiple API instances)
- Configuration caching
- Rate limiting state shared across instances
- Leader election for multi-instance coordination

### 6.8 Email Service (Priority: MEDIUM)

Required for password reset, email verification, and registration confirmation:

```env
EMAIL_SERVICE=custom
EMAIL_HOST=smtp.your-provider.com
EMAIL_PORT=587
EMAIL_ENCRYPTION=starttls
EMAIL_USERNAME=noreply@memodo-eng.de
EMAIL_PASSWORD=...
EMAIL_FROM=noreply@memodo-eng.de
```

### 6.9 Data Retention / Cleanup (Priority: LOW-MEDIUM)

Current state: all data persists indefinitely.

Consider policies for:
- **Temporary chats** — already have TTL support (`TEMP_CHAT_EXPIRY_MINUTES`, default 30 days)
- **Vector embeddings** — grow unbounded; no admin cleanup tools exist yet
- **Uploaded files** — no automatic orphan cleanup
- **Transaction logs** — grow proportionally to usage; archive old transactions periodically
- **MeiliSearch indexes** — grow with conversations; performance degrades at very high volumes

### 6.10 Docker Image Strategy (Priority: CRITICAL)

**Current state:** The deployment uses **development images**, not release images:
```yaml
image: registry.librechat.ai/danny-avila/librechat-dev:latest      # DEV image
image: registry.librechat.ai/danny-avila/librechat-rag-api-dev-lite:latest  # DEV image
```

Dev images may include debug tooling, unoptimized builds, and unreleased/untested code. The production images are `librechat:vX.Y.Z` (not `librechat-dev`).

**Actions:**
1. Switch to release images: `registry.librechat.ai/danny-avila/librechat:v0.8.4` (or latest stable release)
2. Pin the specific version tag — never use `:latest` in production
3. Document the validated version so rollback targets are clear
4. Test updates in a staging environment before applying to production
5. Watch for MongoDB version compatibility issues (see [Issue #10304](https://github.com/danny-avila/LibreChat/issues/10304))
6. Subscribe to LibreChat release notifications

### 6.11 Docker Container Log Rotation (Priority: HIGH)

**Current state:** No `logging` configuration in any compose file. Docker defaults to the `json-file` logging driver with **no rotation**. Every container's stdout/stderr accumulates indefinitely on disk.

This is one of the most common Docker production failures — disk fills up, all containers crash.

**Fix:** Add to `docker-compose.override.yml` for all services:
```yaml
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
  mongodb:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
  # ... repeat for all services
```

Or set as default for all containers via Docker daemon config (`/etc/docker/daemon.json`):
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

### 6.12 Host-Level Security (Priority: MEDIUM)

This document focuses on application and container security. Host-level hardening is also required but is a separate operational concern. Key items:

- **Firewall:** Only ports 80 (HTTP), 443 (HTTPS), and 22 (SSH) should be open to the internet. All Docker-exposed ports (27017, 5432, 9000, 9001, 7700) should be blocked at the host firewall, not just the Docker network level. Note: Docker's port mapping can bypass `iptables`/`ufw` rules — verify with `nmap` from an external host.
- **SSH hardening:** Key-only authentication, disable password login, consider fail2ban for brute-force protection.
- **OS patching:** Enable unattended-upgrades (Debian/Ubuntu) or equivalent for security patches. Establish a manual review cadence for major updates.
- **Docker daemon security:** Ensure the Docker socket is not exposed over TCP. Consider rootless Docker mode for defense-in-depth.
- **Disk encryption:** Enable LUKS or equivalent at-rest encryption for data volumes, especially if the server stores PII-adjacent audit data (GuardrailEvent collection).

If host hardening is managed separately (e.g., by an infra team or cloud provider), document who owns it and what's covered.

### 6.13 GDPR Data Subject Rights (Priority: LOW-MEDIUM)

The PII detection guardrail (Section 4.8) addresses GDPR data minimization, but production compliance also requires operational procedures for:

- **Right to erasure (Article 17):** Users must be able to request deletion of their account, conversations, messages, uploaded files, and associated transaction/guardrail event records. LibreChat supports user and conversation deletion, but verify it cascades to all related collections (transactions, guardrailevents, files in MinIO, embeddings in pgvector).
- **Right to data portability (Article 20):** Users must be able to export their data. LibreChat supports client-side export (PNG, CSV, JSON) but has no server-side bulk export API for admin-initiated fulfillment.
- **Data processing agreements:** Azure OpenAI processes user messages — ensure a DPA is in place with Microsoft for the Azure OpenAI resource.

These are operational procedures, not code changes. Document them in a runbook or compliance checklist.

---

## 7. Prioritized Action Plan

### Phase 1: Security Hardening (Do First)
1. [ ] **Switch from dev images to release images** (`librechat:v0.8.4`, not `librechat-dev:latest`) — Section 6.10
2. [ ] Regenerate all secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, `MEILI_MASTER_KEY`)
3. [ ] Enable MongoDB authentication (follow multi-step migration in Section 6.2 — do NOT use `MONGO_INITDB_*` on existing data)
4. [ ] Change PostgreSQL and MinIO credentials from defaults
5. [ ] Set `NODE_ENV=production` (note: invalidates active sessions — plan maintenance window)
6. [ ] Configure CORS via `DOMAIN_CLIENT` / `DOMAIN_SERVER` — Section 6.5
7. [ ] Restrict registration (`ALLOW_REGISTRATION=false` or `allowedDomains`)
8. [ ] Set `ALLOW_UNVERIFIED_EMAIL_LOGIN=false`
9. [ ] Remove externally exposed database ports (MongoDB 27017)
10. [ ] Set `DEBUG_LOGGING=false`, `LOG_LEVEL=warn`, `CONSOLE_JSON=true`
11. [ ] Add Docker container log rotation to all services — Section 6.11
12. [ ] Verify host firewall blocks Docker-exposed ports from internet (nmap from external host) — Section 6.12

### Phase 2: Backups (Do Next)
13. [ ] Define RPO/RTO targets based on business requirements — Section 2.1
14. [ ] Create automated daily MongoDB backup script (adjust frequency per RPO)
15. [ ] Create automated MinIO backup (daily, using `minio/mc` container) — Section 2.5
16. [ ] Create weekly pgvector backup
17. [ ] Set up off-host backup storage
18. [ ] Test restore procedures for each data store
19. [ ] Set up backup failure alerting

### Phase 3: Monitoring & Alerting
20. [ ] Add Docker health checks to all services (use `/health` not `/api/health`) — Section 3.1
21. [ ] Deploy Prometheus + Grafana stack (consider topology — Section 3.2)
22. [ ] Deploy librechat_exporter for application metrics
23. [ ] Deploy mongodb_exporter, postgres_exporter
24. [ ] Set up external uptime monitoring (independent of application server)
25. [ ] Configure alert rules (service down, disk, error rates, restarts, PII circuit breaker, Redakt health)
26. [ ] Enable Azure OpenAI Diagnostic Settings (route to Log Analytics)
27. [ ] Set up Azure Budgets with alert thresholds
28. [ ] Monitor GuardrailEvent trends via `/api/admin/usage/guardrail-summary` endpoint

### Phase 4: Guardrails & Cost Control
29. [ ] Enable and tune rate limiting values
30. [ ] Enable token balance system with auto-refill
31. [ ] Enable OpenAI content moderation (`OPENAI_MODERATION=true`)
32. [ ] Review and tune the ban/violation system
33. [ ] Set container resource limits (verify enforcement via `docker stats`) — Section 6.6
34. [ ] Deploy Redakt API service and configure PII detection (`PII_DETECTION=true`)
35. [ ] Start with `PII_DETECTION_MODE=warn` to audit false positives before switching to block
36. [ ] Configure PII role exemptions if needed (`PII_DETECTION_EXEMPT_ROLES`)
37. [ ] **Fix: Add rate limiting to admin reporting endpoints** (60 req/min — currently missing, track as issue)
38. [ ] **Fix: MongoDB timeout detection in reporting** (return 504, not 500)

### Phase 5: Operational Maturity
39. [ ] Set up Redis for session/cache management
40. [ ] Configure email service for password resets and verification
41. [ ] Establish update/patching cadence (OS, Docker images, LibreChat releases)
42. [ ] Define data retention policies (including GuardrailEvent retention)
43. [ ] Document runbooks for common operational tasks (restarts, restores, secret rotation)
44. [ ] Document PII detection circuit breaker behavior for ops team
45. [ ] Host-level SSH hardening (key-only auth, fail2ban) — Section 6.12
46. [ ] Establish GDPR data subject request procedures (erasure, portability) — Section 6.13
47. [ ] Verify Azure OpenAI DPA is in place

---

## 8. Sources

### LibreChat Documentation
- [Remote Deployment Overview](https://www.librechat.ai/docs/remote)
- [Environment Variables](https://www.librechat.ai/docs/configuration/dotenv)
- [Logging System](https://www.librechat.ai/docs/configuration/logging)
- [Metrics](https://www.librechat.ai/docs/configuration/metrics)
- [Token Usage](https://www.librechat.ai/docs/configuration/token_usage)
- [Transactions Configuration](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/transactions)
- [Automated Moderation](https://www.librechat.ai/docs/features/mod_system)
- [Authentication System](https://www.librechat.ai/docs/configuration/authentication)
- [NGINX Guide](https://www.librechat.ai/docs/remote/nginx)
- [Credentials Generator](https://www.librechat.ai/toolkit/creds_generator)

### LibreChat Community
- [MongoDB Backup Discussion #3136](https://github.com/danny-avila/LibreChat/discussions/3136)
- [MongoDB Connection Crash Bug #11808](https://github.com/danny-avila/LibreChat/issues/11808)
- [MongoDB Upgrade Bug #10304](https://github.com/danny-avila/LibreChat/issues/10304)
- [OpenTelemetry Feature Request #7862](https://github.com/danny-avila/LibreChat/issues/7862)
- [librechat_exporter (Prometheus)](https://github.com/virtUOS/librechat_exporter/)
- [jgera/librechat-backup](https://github.com/jgera/librechat-backup)

### Azure Documentation
- [Plan to Manage Costs for Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/manage-costs)
- [Monitor Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/monitor-openai)
- [Monitoring Data Reference for Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/monitor-openai-reference)
- [Azure API Management - emit-token-metric Policy](https://learn.microsoft.com/en-us/azure/api-management/azure-openai-emit-token-metric-policy)
- [Azure Budgets and Azure OpenAI Cost Management](https://techcommunity.microsoft.com/t5/azure-governance-and-management/azure-budgets-and-azure-openai-cost-management/ba-p/3904833)
- [Azure OpenAI Insights: Monitoring with Confidence](https://techcommunity.microsoft.com/blog/fasttrackforazureblog/azure-openai-insights-monitoring-ai-with-confidence/4026850)
