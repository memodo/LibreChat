---
review_panel: [security, privacy, data-modeling, reliability, module-depth]
eval_required: false
cross_cutting_decisions: []
delivery_mode: whole-feature
---

# SPEC-016: Conversation Log Sidecar

## Executive Summary

- **Based on Research:** RESEARCH-016-conversation-log-sidecar.md
- **Creation Date:** 2026-05-26
- **Author:** Claude (planning) / Pablo Oliva (sponsor)
- **Status:** Approved — ready for implementation (rev 2, 2026-05-26)

This specification defines `conv-log`, a Docker sidecar that periodically copies LibreChat conversation data from MongoDB into a dedicated Postgres analytical database, so that — once production traffic builds — MemodoAI can run offline analysis to inform what content-level guardrails are worth implementing. The sidecar reads Mongo through a read-only user, joins against the `conversations` and `agents` collections to produce a denormalised analytical row per message, and writes upserts to a new Postgres database hosted alongside the existing pgvector instance. **No LibreChat code, schema, container, or configuration is modified.** LibreChat upstream upgrades remain conflict-free.

This is the **analytical-store** layer. It is deliberately distinct from PRE-RESEARCH-013's broader operational-observability initiative (logs, traces, errors, RUM), which remains valid for future scope and which would require core code edits (OpenTelemetry SDK instrumentation) this SPEC explicitly avoids.

**Rev 2 scope.** This revision incorporates the spec-review panel's findings (security/privacy, data-modeling, reliability, module-depth) plus the critical-reviewer synthesis. Six blockers and nine majors are resolved in-place; two new REQs (REQ-073 erasure reconciliation, REQ-074 dead-letter handling) and one new REQ-075 (backfill mode) are added; the module layout is restructured to extract `enrich.ts` and `watermark.ts` from `sync.ts`; a Testing section is added; OD-1, OD-3, OD-4, OD-6, OD-7 are closed. OD-1 closes with **raw text retained by default, contingent on inline-documented DPO acceptance** (see § DPO acceptance).

## Research Foundation

### Production Capabilities Currently Missing

1. **No analytical query surface.** Conversation data is fully persisted in Mongo but shaped for per-user application access, not fleet-level analysis. There is no SQL surface, no joins to `conversations`/`agents`/`GuardrailEvent`, and no admin-level read path. Confirmed in RESEARCH-007 (gap "No usage analytics dashboard") and re-confirmed in the RESEARCH-016 production data audit (2026-05-26).
2. **Resolved underlying LLM is hidden behind agent IDs.** For 50% of assistant messages (agent traffic), `messages.model` holds `agent_*` rather than the actual LLM. Any analysis of model-level patterns requires joining against the `agents` collection — work that is not done anywhere today.
3. **GuardrailEvent records are isolated.** SPEC-009 writes structured PII trigger records to a separate Mongo collection, but no join surface exists to correlate them with the underlying messages they fired on.
4. **No durable place to land enrichment.** Future analytical questions (e.g., per-agent error rates over time, per-user prompt-length distributions, correlation between PII trips and conversation outcomes) currently require ad-hoc Mongo aggregations that are not reproducible across sessions.

### Stakeholder Validation

- **Product / MemodoAI sponsor:** Wants to log conversation traffic now, while volume is low, so that when usage grows there is a corpus to mine for guardrail decisions. Not a moderation framework — a data substrate for future decisions.
- **Engineering:** Must not modify LibreChat core code or container image. Must not block LibreChat startup or steady-state operation if the sidecar fails. Must use existing operational tooling (`./prod.sh`, Prom/Grafana, MinIO).
- **Security / DPO posture:** All conversation content stays on the existing Hetzner host. No cloud egress. Read-only Mongo access from a dedicated credential. Destination Postgres on the same VPC, no host port exposure. Right-to-erasure honoured via REQ-073 reconciliation.
- **DevOps:** Sidecar must run under `./prod.sh` like every other service. Restart-safe. Resource budget < 200 MB RAM, < 5% CPU at current volumes.

### System Integration Points

- `docker-compose.override.yml` / `docker-compose.prod.yml` — slot for the new service definition
- Existing `chat-mongodb` service — read source (no changes to the service itself; new Mongo user added)
- Existing pgvector Postgres service — destination host (new database `convlog`, new roles `convlog_writer` + `convlog_reader`)
- `.env.prod`, `.env.example` — new credentials block (`CONVLOG_*` env vars)
- `prod.sh` — wraps `docker compose`; no changes needed
- `monitoring/prometheus/prometheus.yml` — optional new scrape target for sidecar health metrics
- `packages/data-schemas/src/schema/message.ts:4-160` — reference for the source-of-truth field shape (NOT modified)
- `packages/data-schemas/src/schema/convo.ts` — reference for conversation join (NOT modified)
- `api/server/models/GuardrailEvent.js` (per SPEC-009) — reference for guardrail-event join (NOT modified)

## Intent

### Problem Statement

MemodoAI needs a queryable analytical record of conversation traffic before deciding what content-level guardrails to invest in. The decision-making approach is "log now, analyse later, then build guardrails informed by what we actually see" — not "build guardrails up front and audit them." The constraint is that any logging mechanism must not modify LibreChat core, because the deployment is a fork that consumes upstream LibreChat updates and must keep merge friction low.

### Solution Approach

Deploy a small TypeScript Node.js sidecar (`conv-log`) on the existing Compose stack. The sidecar runs an interval loop that, on each tick:

1. Reads a watermark from `sync_state` in the destination Postgres.
2. Pages new `messages` from Mongo using a read-only user, ordered by `createdAt` ascending, batched, with hard query timeout.
3. For each batch, fetches referenced `conversations` and `agents` rows (with a small in-process LRU cache) and joins them.
4. Where SPEC-009 is enabled, fetches any `GuardrailEvent` rows whose `messageId` matches the batch.
5. Within a single Postgres transaction with `statement_timeout` set: upserts dimension rows (`conversations_dim`, `agents_dim`) FIRST, then `messages_log` (FK-safe ordering), then `guardrail_events_log`, then advances the watermark.
6. On batch failure, falls back to row-by-row bisection; failing rows go to `dead_letter_log` (REQ-074) so the watermark can advance past poison messages instead of stalling forever.
7. Periodically reconciles `messages_log` against the source to honour GDPR right-to-erasure (REQ-073).
8. Exposes `/healthz` (in-memory state only, no Postgres dependency) and `/metrics` (Prometheus format).

On the first run the watermark begins at epoch; the sidecar enters **backfill mode** (REQ-075) and runs ticks back-to-back until lag drops below a threshold, then settles into normal cadence.

If the sidecar crashes mid-batch, the transaction guarantees the watermark is not advanced; the next tick replays the batch idempotently (compound upsert key per REQ-062).

LibreChat itself is untouched throughout. Removing the sidecar removes the feature; no LibreChat surface depends on it.

### Expected Outcomes

- Every message LibreChat persists is also reflected — within `polling_interval` after steady state is reached — in a relational analytical store with conversation, agent, and guardrail context attached.
- All historical messages (the current 227) are present after the first successful backfill.
- Analytical queries that require joins across `messages` × `conversations` × `agents` × `GuardrailEvent` can be expressed in standard SQL.
- Upstream LibreChat upgrades require no changes to `conv-log`; the sidecar's only contract is the field shape of the Mongo collections it reads.
- The sidecar can be torn down and reinitialised from Mongo at any time; the analytical store is derivable.
- GDPR Art. 17 erasure performed against LibreChat propagates to the analytical store within one reconciliation cycle (24 h default).
- Future work (admin chat-review UI, content-safety experiments, dashboards) has a queryable foundation to build on without further core edits.

### DPO Acceptance (closes OD-1)

The analytical store retains raw `messages.text` and `messages.content[]` by default. The justification is twofold: (a) the data already resides on the same Hetzner host that runs the source MongoDB, so no new data-residency surface is opened; (b) the stated analytical purpose explicitly includes future content-pattern review for guardrail design, for which structural metadata alone is insufficient. This trades data minimisation (GDPR Art. 5(1)(c)) against legitimate-interest analytics. The acceptance is recorded here and in `conv-log/README.md`. Compensating controls: (i) read-only Postgres role for all analyst access (REQ-057), (ii) right-to-erasure reconciliation (REQ-073), (iii) 24-month retention ceiling (REQ-073), (iv) no cloud egress (REQ-054), (v) compound-key uniqueness preventing cross-user collision (REQ-058). **A signed DPO note acknowledging these controls must be filed in `SDD/governance/` before the implementation PR merges.**

## Success Criteria

### Functional Requirements

- **REQ-054: Service defined.** A service named `conv-log` is defined in `docker-compose.override.yml` and `docker-compose.prod.yml`, built from `./conv-log/Dockerfile`. Attached to the `default` Docker network only (no `caddy_net` — sidecar has no inbound HTTP). No host port published.
- **REQ-055: Image and supply-chain hygiene.** `conv-log/Dockerfile` is based on `node:22-alpine` pinned by digest. Container runs as non-root, with a read-only root filesystem, `--security-opt no-new-privileges`, and `cap_drop: [ALL]`. The image installs only the sidecar's own dependencies — no Mongo / Postgres CLI tools. `package-lock.json` is committed; the Dockerfile uses `npm ci` (not `npm install`). CI gates the image build on `npm audit --audit-level=high` passing. The resolved versions of `node:22-alpine` (digest) and the sidecar's top-level npm dependencies are recorded as comments in the Dockerfile.
- **REQ-056: Read-only Mongo user.** A new Mongo user `convlog_reader` is created in the `LibreChat` database with role `read` (collection-scoped where Mongo permits). The sidecar connects with this user only. Credentials live in `.env.prod` as `CONVLOG_MONGO_URI`. Provisioning is performed once by the operator out-of-band via the script at `conv-log/ops/provision-mongo.sh`. Credential rotation procedure is documented in `conv-log/README.md`; rotation is required on host-breach suspicion, personnel change, or annually.
- **REQ-057: Destination Postgres database with role separation.** A new database `convlog` is created in the existing pgvector Postgres instance. Two roles are provisioned, both scoped to `convlog`:
  - `convlog_writer` — owns the schema; has `INSERT`/`UPDATE`/`DELETE`/`SELECT` on `convlog.*`. Used by the sidecar process only.
  - `convlog_reader` — has `SELECT` only on `convlog.*`. Used by all analyst access, ad-hoc queries, and any future downstream consumer (Metabase, Grafana, SPEC-008 admin UI extension).
  Credentials live in `.env.prod` as `CONVLOG_PG_URI` (writer) and `CONVLOG_PG_READ_URI` (reader, documented for operators but not consumed by the sidecar). Provisioning is performed once via `conv-log/ops/provision-postgres.sh`. Rotation policy mirrors REQ-056.
- **REQ-058: Destination schema.** On startup the sidecar runs idempotent migrations creating:
  - `schema_migrations` (PK `version` TEXT, columns: `applied_at`, `checksum`). Tracks applied migrations; new files in `migrations/NNN_*.sql` are applied in lexicographic order if not already present.
  - `conversations_dim` (PK `conversation_id` TEXT, columns: `title`, `agent_id`, `endpoint`, `user_id`, `archived` BOOL, `tags JSONB`, `source_created_at` TIMESTAMPTZ, `source_updated_at` TIMESTAMPTZ, `dim_updated_at` TIMESTAMPTZ, `schema_version` INT). Type-1 SCD: upserts use `ON CONFLICT (conversation_id) DO UPDATE SET ...` to keep the row current.
  - `agents_dim` (PK `agent_id` TEXT, columns: `name`, `model_underlying`, `description`, `last_seen_at`, `dim_updated_at`, `schema_version` INT). Type-1 SCD on `ON CONFLICT (agent_id) DO UPDATE`.
  - `messages_log` (PK `id BIGSERIAL`, columns: `message_id` TEXT, `user_id` TEXT, `conversation_id` TEXT, `parent_message_id` TEXT, `sender` TEXT, `endpoint` TEXT, `model_or_agent_id` TEXT, `is_user` BOOL, `text` TEXT, `content` JSONB, `token_count` INT, `error` BOOL, `unfinished` BOOL, `has_attachments` BOOL, `has_files` BOOL, `feedback_rating` TEXT, `feedback_tag` JSONB, `feedback_text` TEXT, `source_created_at` TIMESTAMPTZ, `source_updated_at` TIMESTAMPTZ, `synced_at` TIMESTAMPTZ, `schema_version` INT). UNIQUE constraint on `(message_id, user_id)` — mirrors the source compound unique index `{ messageId: 1, user: 1, tenantId: 1 }` (tenantId is universally NULL in current deployment, so `(message_id, user_id)` is the effective uniqueness key). FK `conversation_id → conversations_dim(conversation_id)` declared `ON DELETE SET NULL` so deletion-orphan rows survive.
  - `guardrail_events_log` (PK `event_id` TEXT, columns: `message_id` TEXT, `user_id` TEXT, `conversation_id` TEXT, `route` TEXT, `entity_types` JSONB, `entity_count` INT, `source_created_at` TIMESTAMPTZ, `synced_at` TIMESTAMPTZ). No FK to `messages_log` because timing is not guaranteed (see REQ-060 step 4); rows whose `message_id` has not yet been synced are stored with the FK held loose and reconciled on the next sync.
  - `dead_letter_log` (PK `id BIGSERIAL`, columns: `source_collection` TEXT, `source_id` TEXT, `raw` JSONB, `error_phase` TEXT, `error_detail` TEXT, `first_failed_at` TIMESTAMPTZ, `last_failed_at` TIMESTAMPTZ, `retry_count` INT). Holds rows that failed individual upsert per REQ-074.
  - `sync_state` (PK `key` TEXT, columns: `value` JSONB, `updated_at` TIMESTAMPTZ). Holds watermark and run-status rows.

  Indexes on `messages_log`: `(source_created_at)`, `(conversation_id, source_created_at)`, `(model_or_agent_id)`, `(user_id)`, `(parent_message_id)`. The index set is a starter; operators must review `pg_stat_user_indexes` after 30 days of production traffic and propose adjustments via a follow-up SPEC.

- **REQ-059: Watermark semantics with safety margin.** `sync_state` holds rows keyed:
  - `messages_high_watermark` — value = `max(messages.createdAt synced) - CONVLOG_WATERMARK_SAFETY_SECONDS` (default 60s). The safety margin tolerates clock skew between LibreChat backend instances and Mongo. Messages whose `createdAt` falls within the margin window are re-evaluated on the next tick; the compound upsert (REQ-062) makes this idempotent.
  - `last_sync_status` — value = JSON `{ ts, status: "ok"|"error"|"dead_letter", batch_size, error? }`. Written in the same transaction as the watermark advance.

  Watermark advance happens in the SAME Postgres transaction as the batch upsert and dead-letter writes. No commit means no watermark progress.

- **REQ-060: Batch ingestion loop.** Default polling interval **300 seconds** (configurable via `CONVLOG_INTERVAL_SECONDS`). Each tick:
  1. Read `messages_high_watermark` from `sync_state`.
  2. Query Mongo: `{ createdAt: { $gt: watermark } }`, sorted ascending by `createdAt`, limit `CONVLOG_BATCH_SIZE` (default 500). Hard timeout `CONVLOG_MONGO_QUERY_TIMEOUT_MS` (default 30000).
  3. For each unique `conversationId` and `model` (when `endpoint === 'agents'`) in the batch, look up via in-process LRU cache (capacity `CONVLOG_CACHE_SIZE` default 1000, TTL `CONVLOG_CACHE_TTL_SECONDS` default 3600). Cache misses re-fetch from Mongo with timeout 10000 ms.
  4. Fetch `GuardrailEvent` rows whose `messageId` is in the batch's message-ID set. Note: `GuardrailEvent.createdAt` may precede `messages.createdAt` — guardrail events for messages NOT yet in the current batch are NOT fetched here and will be picked up by their own watermark on the next pass (see REQ-073's reconciliation pass for stragglers).
  5. Open Postgres transaction. `SET LOCAL statement_timeout = 60000`. In order:
     a. Upsert `conversations_dim` rows (`ON CONFLICT (conversation_id) DO UPDATE SET ...`).
     b. Upsert `agents_dim` rows (`ON CONFLICT (agent_id) DO UPDATE SET ...`).
     c. Upsert `messages_log` rows (`ON CONFLICT (message_id, user_id) DO UPDATE SET ...`).
     d. Insert `guardrail_events_log` rows.
     e. Write `sync_state.messages_high_watermark = max(batch.createdAt) - safety_margin`.
     f. Write `sync_state.last_sync_status = { ts: now(), status: "ok", batch_size: N }`.
     COMMIT.
  6. On any error during step 5: ROLLBACK, then invoke REQ-074 dead-letter procedure.
  7. Update in-memory `lastSuccessfulSyncAt` only on successful COMMIT.
- **REQ-061: Backfill on first run.** By default (when the destination Postgres has no `sync_state.messages_high_watermark` row), the initial watermark is `1970-01-01T00:00:00Z` and the first run enters backfill mode (REQ-075) ingesting the entire existing message corpus. If the operator sets `CONVLOG_INITIAL_WATERMARK=now` in the environment **before the first run**, the initial watermark is instead set to the sidecar's process-start time minus `CONVLOG_WATERMARK_SAFETY_SECONDS`, and no historical messages are backfilled — only messages with `createdAt >= startup` are ever ingested. The env var is read ONLY when `sync_state.messages_high_watermark` is absent; subsequent runs always honour the persisted watermark. Default value is unset (= epoch backfill). This is a one-time decision at first deployment; toggling later requires a truncate-and-rebuild per REQ-071.
- **REQ-062: Idempotency.** Upsert key is `(message_id, user_id)` — mirrors source compound uniqueness. Re-running the same batch yields no duplicates. The sidecar can be safely restarted at any time. Resetting `sync_state.messages_high_watermark` to epoch and restarting yields a complete re-derivation (truncate-and-rebuild procedure documented in REQ-071).
- **REQ-063: Field mapping with lossless content preservation.** Source-to-destination mapping is exhaustively documented in `conv-log/docs/field-mapping.md`. The doc is the contract; REQ-A-2 (see Testing) gates drift.
  - `messages_log.content` — JSONB; stores the SOURCE `messages.content[]` array verbatim regardless of part types (`text`, `tool_call`, `tool_result`, `image_url`, future multimodal part types). Lossless round-trip.
  - `messages_log.text` — TEXT; for assistant messages, the flattened concatenation of `content[]` parts whose `type === 'text'` only. Other part types are preserved in `content` JSONB but excluded from `text`. For user messages, `messages.text` is copied verbatim and `content` is `NULL` (matches current production shape; if a future LibreChat version writes `content[]` for user messages, the sidecar populates both fields the same way as for assistants).
  - `messages_log.model_or_agent_id` — `messages.model` as-is (agent ID for agent traffic, model name for direct traffic). Resolved via `JOIN agents_dim` per REQ-064.
  - `messages_log.feedback_tag` — JSONB; source `messages.feedback.tag` is Mongo Mixed type and may be string, array, or object; stored via `to_jsonb(tag)`.
  - `has_attachments` / `has_files` — BOOL derived as `Array.isArray(source) && source.length > 0`.
- **REQ-064: Resolved underlying LLM (Type-1 SCD).** For agent traffic, `agents_dim.model_underlying` is populated from the joined `agents` document on first sight AND refreshed on every subsequent batch that references the agent (`ON CONFLICT (agent_id) DO UPDATE SET name = EXCLUDED.name, model_underlying = EXCLUDED.model_underlying, description = EXCLUDED.description, last_seen_at = EXCLUDED.last_seen_at, dim_updated_at = NOW()`). Historical model assignments are NOT preserved; this is Type-1 SCD by design (documented in `conv-log/docs/field-mapping.md`). Analytical queries resolve the actual LLM via `messages_log JOIN agents_dim ON messages_log.model_or_agent_id = agents_dim.agent_id`.
- **REQ-065: Failure isolation with backoff.** If Mongo or Postgres is unreachable, query times out, or any batch step fails, the sidecar logs the error structured, does NOT advance the watermark, and retries on the next interval. After **3 consecutive tick failures**, the sidecar applies exponential backoff with full jitter, capped at `CONVLOG_MAX_BACKOFF_SECONDS` (default 1800s). On first successful tick the backoff resets. Sidecar failure has **zero effect** on LibreChat — they share no synchronous code path.
- **REQ-066: Health endpoint.** Sidecar exposes `GET /healthz` and `GET /metrics` on internal port 9300 (no host port published). `/healthz` returns:
  - **200** if `lastSuccessfulSyncAt` (in-memory; updated only on successful COMMIT) is within `3 × CONVLOG_INTERVAL_SECONDS` of `now()`.
  - **503** otherwise, including during the period after process start before the first successful sync.

  `/healthz` reads in-memory state ONLY — never touches Postgres or Mongo on the health path. This means a Postgres outage does not produce a green healthz reading.
- **REQ-067: Prometheus integration with precise metric definitions.** A scrape target for `conv-log:9300/metrics` is added to `monitoring/prometheus/prometheus.yml`. Metrics:
  - `convlog_messages_synced_total{}` — counter; total `messages_log` rows successfully upserted since process start.
  - `convlog_sync_lag_seconds` — gauge; formula: `now_unix - last_successful_tick_start_unix`. Reflects "how long since we last completed a tick." Always meaningful regardless of whether messages are pending.
  - `convlog_pending_messages` — gauge; result of `db.messages.countDocuments({ createdAt: { $gt: watermark } })` from the most recent tick. Sampled on every tick.
  - `convlog_max_message_age_seconds` — gauge; formula: `now_unix - (most recent messages_log.source_created_at)`. Reflects oldest unsynced source data. Becomes large during idle periods naturally; alerts must AND-gate with `convlog_pending_messages > 0`.
  - `convlog_errors_total{phase}` — counter; `phase ∈ {mongo_query, cache_fetch, postgres_upsert, dead_letter, reconciliation}`.
  - `convlog_dead_letter_total{phase}` — counter; rows written to `dead_letter_log` by phase.
  - `convlog_last_run_unix_timestamp` — gauge.
  - `convlog_batch_duration_seconds_histogram` — histogram.
  - `convlog_erasure_deletions_total` — counter; rows deleted by REQ-073 reconciliation since process start.
- **REQ-068: Alertmanager integration (optional).** Single alert rule:
  ```
  expr: (convlog_sync_lag_seconds > max(10 * CONVLOG_INTERVAL_SECONDS, CONVLOG_ALERT_MIN_LAG_SECONDS))
        AND ON() (convlog_pending_messages > 0)
  for: 15m
  ```
  `CONVLOG_ALERT_MIN_LAG_SECONDS` floor default 900s (15 minutes). Routes through existing Alertmanager → Teams channel.
- **REQ-069: Structured logging.** Sidecar logs to stdout in JSON, compatible with future Loki ingestion (PRE-RESEARCH-013 G1). Levels: `error`, `warn`, `info`, `debug`. `CONVLOG_LOG_LEVEL` env var controls verbosity. No raw message text is ever logged at info or below.
- **REQ-070: Environment template.** `.env.example` gains a new `# === conv-log (analytical conversation store) ===` block documenting all env vars:
  - `CONVLOG_MONGO_URI` (writer's Mongo connection string)
  - `CONVLOG_PG_URI` (writer's Postgres connection string)
  - `CONVLOG_PG_READ_URI` (reader's Postgres connection string — documentation only, not consumed by sidecar)
  - `CONVLOG_INTERVAL_SECONDS` (default 300)
  - `CONVLOG_BATCH_SIZE` (default 500)
  - `CONVLOG_INITIAL_WATERMARK` (default unset = epoch backfill; set to literal string `now` to skip historical ingestion per REQ-061)
  - `CONVLOG_BACKFILL_INTERVAL_SECONDS` (default 5; used while in backfill mode per REQ-075)
  - `CONVLOG_BACKFILL_EXIT_THRESHOLD` (default 5; multiplied by `CONVLOG_BATCH_SIZE` to determine backfill-mode exit per REQ-075)
  - `CONVLOG_MONGO_QUERY_TIMEOUT_MS` (default 30000)
  - `CONVLOG_PG_STATEMENT_TIMEOUT_MS` (default 60000)
  - `CONVLOG_CACHE_SIZE` (default 1000)
  - `CONVLOG_CACHE_TTL_SECONDS` (default 3600)
  - `CONVLOG_WATERMARK_SAFETY_SECONDS` (default 60)
  - `CONVLOG_MAX_BACKOFF_SECONDS` (default 1800)
  - `CONVLOG_ALERT_MIN_LAG_SECONDS` (default 900)
  - `CONVLOG_ERASURE_RECONCILIATION_HOURS` (default 24; cadence of REQ-073)
  - `CONVLOG_RETENTION_MONTHS` (default 24; per REQ-073)
  - `CONVLOG_LOG_LEVEL` (default `info`)
  `.env.prod` carries the resolved values. `.env.prod` must be in `.gitignore` (it already is via the repo's existing `.gitignore`).
- **REQ-071: Operator runbook.** `conv-log/README.md` documents:
  - **Deploy path note.** This sidecar touches NO LibreChat workspaces — its PR diff is gated by REQ-072 to exclude `/api`, `/packages/*`, `/client`. Therefore the `prod-sync.sh` build-and-rsync flow documented in `CLAUDE.md` under "Production Deploy Discipline" is **not required** for `conv-log`. Production deploys follow the config-only path: commit on `pablo`, `git push`, on prod `git pull` + `./prod.sh up -d conv-log` (or `./prod.sh restart conv-log` for restarts). No `npm run build` step is required for prod deploys of this service.
  - One-time Mongo user provisioning via `conv-log/ops/provision-mongo.sh` (audit-logged to `SDD/orchestration/conv-log-provisioning.log` with operator, timestamp, host).
  - One-time Postgres database + role provisioning via `conv-log/ops/provision-postgres.sh` (same audit log).
  - DPO acceptance note location (per Executive Summary § DPO Acceptance, filed at `SDD/governance/DPO-acceptance-conv-log.md`).
  - Initial backfill expectations and how to monitor it via `convlog_pending_messages`. How to opt out of historical backfill on first deployment via `CONVLOG_INITIAL_WATERMARK=now` (REQ-061).
  - Truncate-and-rebuild procedure: stop sidecar, `TRUNCATE messages_log, conversations_dim, agents_dim, guardrail_events_log, dead_letter_log; UPDATE sync_state SET value='1970-01-01T00:00:00Z' WHERE key='messages_high_watermark';`, restart sidecar. Required when a sidecar release introduces a `schema_version` bump.
  - Rollback procedure for a faulty sidecar release: revert image tag in compose, restart. If the bug wrote bad data, run truncate-and-rebuild against the previous-known-good image.
  - Sample analytical SQL queries (per V-6); queries are written to use `convlog_reader`, not `convlog_writer`.
  - Troubleshooting: common failure modes mapped to metric / log signatures.
  - DPO erasure runbook: how to verify REQ-073 propagated an erasure within 24 h; how to force a reconciliation pass manually.
  - Credential rotation procedure for both Mongo and Postgres credentials.
- **REQ-072: No core edits gate.** Implementation PR diff MUST NOT touch any path under `/api`, `/packages/api`, `/packages/data-schemas`, `/packages/data-provider`, `/packages/client`, `/client`. Enforced by PR template checklist and code review. Allowed paths: new top-level `/conv-log/` directory, `docker-compose.override.yml`, `docker-compose.prod.yml`, `monitoring/prometheus/prometheus.yml`, `monitoring/prometheus/alerts.yml` (REQ-068), `.env.example`, `SDD/orchestration/`, `SDD/governance/` (DPO note).
- **REQ-073: Right-to-erasure reconciliation.** A separate background task runs every `CONVLOG_ERASURE_RECONCILIATION_HOURS` (default 24). The task:
  1. Pages `messages_log.message_id` (with `user_id`) in chunks.
  2. For each chunk, queries Mongo: which of these `messageId`s are still present?
  3. Deletes from `messages_log`, `guardrail_events_log`, and (if no other messages reference them) `conversations_dim` any rows whose `message_id` is no longer in source Mongo. Cascades to dependent rows via FK or explicit DELETE statements within a single transaction per chunk.
  4. Additionally, applies the retention ceiling: deletes any `messages_log` row with `source_created_at < now() - CONVLOG_RETENTION_MONTHS months`. Default 24 months.
  5. Increments `convlog_erasure_deletions_total` and logs structured details (counts only — no message content).
  6. Failures retry on next reconciliation cycle; do NOT block the main ingestion loop.

  This is the GDPR Art. 17 propagation path. It also handles temp-chat TTL deletions (LibreChat hard-deletes via `messages.expiredAt` TTL index) so the analytical store does not accumulate temp content past source lifetime. Closes OD-4 (retention) and the deletion-orphan concern.

- **REQ-074: Dead-letter handling.** When a Postgres transaction in REQ-060 step 5 fails, the sidecar:
  1. ROLLBACKs the transaction.
  2. Re-runs the batch in bisection mode: split into halves, attempt each half in its own transaction. Recursively bisect down to individual rows. Surviving rows commit normally and advance the watermark cumulatively.
  3. Each row that fails as a singleton transaction is written to `dead_letter_log` with `raw` = the source Mongo document as JSONB, `error_phase` = "postgres_upsert", `error_detail` = sanitized PG error text (no row payload), `first_failed_at` = NOW(), `retry_count` = 1. If a row's `message_id` already exists in `dead_letter_log`, increment `retry_count` and update `last_failed_at` instead of inserting.
  4. After a dead-letter write, the watermark advances past the row.
  5. `convlog_dead_letter_total{phase="postgres_upsert"}` increments.
  6. The runbook (REQ-071) documents how an operator queries `dead_letter_log` and decides whether to retry, ignore, or surface for upstream LibreChat bug investigation.
- **REQ-075: Backfill mode.** The sidecar starts each process in backfill mode if `convlog_pending_messages > CONVLOG_BACKFILL_EXIT_THRESHOLD × CONVLOG_BATCH_SIZE` (default 5 × 500 = 2500 unsynced messages). While in backfill mode:
  - Ticks run with sleep `CONVLOG_BACKFILL_INTERVAL_SECONDS` (default 5s) between them instead of `CONVLOG_INTERVAL_SECONDS`.
  - On each tick after the upsert COMMIT, the sidecar re-checks `convlog_pending_messages`. When the value drops below the threshold, the sidecar exits backfill mode and resumes normal cadence.
  - NFR-2's P95 lag SLO is explicitly NOT in force during backfill mode (see NFR-2 carve-out).
  - The transition is logged at `info`; metrics emit normally.

### Non-Functional Requirements

- **NFR-1: Resource budget.** Steady-state memory < 200 MB, CPU < 5% of one core, disk footprint trivial (caches are in-memory).
- **NFR-2: Lag SLO (steady state only).** Post-backfill steady-state P95 of `convlog_sync_lag_seconds` ≤ `2 × CONVLOG_INTERVAL_SECONDS` (10 minutes at default config). This SLO is explicitly NOT evaluated while the sidecar is in backfill mode (REQ-075); the carve-out exists because catch-up time is bounded by source volume rather than sidecar latency.
- **NFR-3: Restart-safe.** Sidecar can be killed at any moment with no risk of duplicate rows, no risk of lost rows, no risk to LibreChat.
- **NFR-4: Backfill bounded.** Initial backfill of the full current corpus (227 messages at 2026-05-26) completes within seconds at default config. At 1M historical messages, backfill at `CONVLOG_BACKFILL_INTERVAL_SECONDS=5s` and `CONVLOG_BATCH_SIZE=500` completes in approximately 1M ÷ 500 × 5s ≈ 10000s ≈ 2.8 hours.
- **NFR-5: Upgrade portability.** A future LibreChat upstream upgrade that adds or removes fields on `messages` must NOT break the sidecar. Implementation handles missing source fields as NULL; new fields are silently ignored unless a follow-up SPEC adds a mapping. Field-mapping drift is gated by REQ-A-2 (Testing).

## Modules

`/conv-log/` (new top-level directory):

- `src/index.ts` — entrypoint; reads env, runs migrations once at startup, starts HTTP server (`/healthz`, `/metrics`), starts main ingestion loop and erasure-reconciliation loop. Owns the Prometheus registry (the few metric declarations live here rather than in a separate shallow module). Holds the in-memory `lastSuccessfulSyncAt` referenced by REQ-066.
- `src/mongo.ts` — read-only Mongo client. Exposes three logical sections via narrow named functions: (a) `createClient(uri, options)` returning a configured `MongoClient` with the read-only credential; (b) `fetchMessageBatch(client, watermark, batchSize, timeoutMs)` returning the projected batch shape; (c) `lookupConversation(client, id)` and `lookupAgent(client, id)` backed by an internal LRU cache. The cache is a private implementation detail; no other module touches it. Internal types for source Mongo document shapes live here as non-exported declarations — no peer `types.ts` module.
- `src/enrich.ts` — pure function `enrich(batch, conversations, agents, guardrailEvents) → EnrichedRows`. No I/O. Owns the field-mapping logic per REQ-063. Easy to unit-test in isolation.
- `src/postgres.ts` — Postgres client + schema migrations + batch upsert. Exposes `createClient(uri)`, `runMigrations(client)` (called once by `index.ts` at startup; reads `migrations/NNN_*.sql` in lexicographic order; uses `schema_migrations` table to skip already-applied), `upsertBatch(client, enrichedRows, watermark)` (single transaction; FK-ordered per REQ-060 step 5), `runDeadLetter(client, batch, errorPhase, errorDetail)` (REQ-074), `runErasureReconciliation(client, mongoClient, retentionMonths)` (REQ-073).
- `src/watermark.ts` — owns `sync_state` read and atomic advance. Exposes `readWatermark(client)` and `advanceWatermark(client, txn, newValue, status, batchSize)`. The advance must be called inside the txn opened by `postgres.ts.upsertBatch` — the type signature enforces this by accepting a transaction handle rather than a client.
- `migrations/001_init.sql` — destination schema DDL (REQ-058).
- `migrations/` — future migrations land here as `NNN_*.sql` files; each must be accompanied by a companion `NNN_*.down.sql` for operator-driven rollback (not auto-applied).
- `ops/provision-mongo.sh` — one-time Mongo user creation (REQ-056).
- `ops/provision-postgres.sh` — one-time Postgres DB + role creation (REQ-057).
- `Dockerfile` — pinned-digest Node 22 alpine (REQ-055).
- `README.md` — operator runbook (REQ-071).
- `docs/field-mapping.md` — exhaustive source-to-destination mapping (REQ-063), the canonical contract gated by REQ-A-2.
- `package.json`, `package-lock.json`, `tsconfig.json`, `.dockerignore`.

The sidecar deliberately does **not** depend on `packages/data-provider` or any LibreChat workspace. Source Mongo document shapes are handwritten internal types in `src/mongo.ts`; they never cross the module boundary. This is the price for upgrade portability and is intentional.

## Delivery

Single PR onto `pablo`:

1. `/conv-log/` directory with source, Dockerfile, migrations, ops scripts, README, field mapping doc.
2. Two compose file edits adding the service block.
3. `.env.example` block addition.
4. `monitoring/prometheus/prometheus.yml` scrape target addition.
5. `monitoring/prometheus/alerts.yml` lag alert (REQ-068).
6. `SDD/orchestration/conv-log-provisioning.log` initialised (empty file with header).
7. `SDD/governance/DPO-acceptance-conv-log.md` filed with signed DPO note per Executive Summary.

Out-of-band one-time operator tasks (executed via the provisioning scripts, audited to `SDD/orchestration/conv-log-provisioning.log`):

- Run `conv-log/ops/provision-mongo.sh` — creates `convlog_reader` user.
- Run `conv-log/ops/provision-postgres.sh` — creates `convlog` database, `convlog_writer` and `convlog_reader` roles.
- Populate `.env.prod` with all `CONVLOG_*` URIs and resolved tunables.
- `./prod.sh up -d conv-log`.

## Risks and Open Decisions

- **OD-1. ~~Store raw text or redact at ingest?~~** **CLOSED 2026-05-26.** Raw text retained by default. DPO acceptance documented in Executive Summary § DPO Acceptance and `SDD/governance/DPO-acceptance-conv-log.md`. Compensating controls: REQ-057 read-only role separation, REQ-073 erasure reconciliation + retention ceiling, REQ-054 no host port / no cloud egress.
- **OD-2. ~~Backfill confirmation.~~** **CLOSED 2026-05-26.** Default behaviour (full backfill from epoch) confirmed. Opt-out toggle added: setting `CONVLOG_INITIAL_WATERMARK=now` before first run skips historical ingestion and starts the watermark at process-start time. Documented in REQ-061 and REQ-070.
- **OD-3. ~~Polling interval default.~~** **CLOSED.** 300s for normal cadence (REQ-060); 5s for backfill mode (REQ-075). Both tunable via env.
- **OD-4. ~~Retention.~~** **CLOSED.** 24-month ceiling enforced by REQ-073 reconciliation. Tunable via `CONVLOG_RETENTION_MONTHS`. Revisit if compliance posture or storage cost requires.
- **OD-5. ~~MinIO NDJSON mirror.~~** **CLOSED 2026-05-26: do not implement.** A second sink alongside Postgres adds operational complexity (dual monitoring, dual restore procedure, authoritative-source ambiguity) without clear benefit at current scale. The pgvector Postgres instance's existing backup posture is judged sufficient for `convlog`-class data. Re-open only if Postgres data loss occurs or if the backup posture changes.
- **OD-6. ~~Failure-mode escalation.~~** **CLOSED.** REQ-068 alert fires at `max(10 × interval, 15 min)` AND-gated on `convlog_pending_messages > 0`.
- **OD-7. ~~Future Change Streams upgrade.~~** **CLOSED.** Move to MongoDB Change Streams when **either**:
  - **(a) Scaling trigger:** NFR-2's P95 lag SLO is violated for two consecutive weeks *at minimum polling interval* — i.e., the cheap escape hatch (dropping `CONVLOG_INTERVAL_SECONDS` toward its floor) has been exhausted and the loop still cannot drain in time. Metrics-driven.
  - **(b) Requirements trigger:** A new SPEC lands that requires sub-minute visibility into conversation content (e.g., live moderation, live admin chat review, live dashboards). No polling interval is "fast enough" for these use cases by definition. Requirements-driven.

  Migration blast radius after the rev 2 module split: replace `mongo.ts.fetchMessageBatch` with a Change Streams cursor; replace the watermark contract in `watermark.ts` from timestamp-based to resume-token-based; `enrich.ts`, `postgres.ts`, `index.ts` remain unchanged. Requires `chat-mongodb` running as a replica set (single-node RS suffices). Destination Postgres schema does not change.

## Out of Scope

- Output-side content moderation (requires core edits — explicitly deferred to a future SPEC and/or APIM integration).
- An admin UI for browsing conversations (SPEC-008 may grow into this).
- Real-time alerting on conversation content patterns.
- Automatic PII redaction at ingest (SPEC-009 already runs at request time; this sidecar only stores what Mongo already holds).
- OpenTelemetry / SDK instrumentation (belongs to PRE-RESEARCH-013).
- Multi-tenant partitioning (`tenantId` is unused in current data).
- Capturing fields that LibreChat does not currently write (`finish_reason`, `summary`, `metadata` etc.) — unrecoverable from a sidecar.
- Modifications to `chat-mongodb`, LibreChat container, or `librechat.yaml`.

## Validation

- **V-1: Backfill correctness.** After first successful exit from backfill mode, `SELECT COUNT(*) FROM messages_log` is within 1% of `db.messages.countDocuments({})` in Mongo (allowing for messages newly arriving during the count). After REQ-073 reconciliation runs once, the count diverges only by source records inserted between the two count operations.
- **V-2: Idempotency.** Re-running with reset `sync_state` (full truncate-and-rebuild) produces identical `messages_log` content (modulo `synced_at` and surrogate PKs).
- **V-3: Failure isolation.** Killing the `conv-log` container during a LibreChat chat session has no observable effect on the chat. Same for stopping the destination Postgres database.
- **V-4: No core diff.** `git diff main...pablo -- api/ packages/ client/` on the implementation PR returns empty.
- **V-5: Upgrade portability smoke test.** After a future LibreChat upstream merge, `conv-log` continues to ingest without code changes, provided field-mapping-drift test (REQ-A-2) still passes.
- **V-6: Sample analytical queries succeed.** `conv-log/README.md` documents at least five sample SQL queries (top users by message volume, agent error rates over time, PII-trigger correlation, model usage distribution, conversation-length histogram). Each runs against the backfilled DB using the `convlog_reader` credential and returns sensible results.
- **V-7: Erasure propagation.** Delete a test conversation in LibreChat via the existing UI. Within 24 h (one `CONVLOG_ERASURE_RECONCILIATION_HOURS` cycle), all `messages_log` and `guardrail_events_log` rows for that conversation are deleted from the analytical store. `convlog_erasure_deletions_total` increments by the expected count.
- **V-8: Dead-letter happy path.** Inject a synthetic poison message (e.g., one with `content[]` containing an oversized JSONB-incompatible value) into Mongo. The next sidecar tick writes it to `dead_letter_log` with a sanitized error, the watermark advances past it, and `convlog_dead_letter_total` increments by 1.

## Testing

The sidecar ships with a test suite enforced in CI before image build. Five mandatory test categories:

- **REQ-T-1: `enrich.ts` pure-function tests.** Table-driven unit tests covering: user message with text only; assistant message with `content[]` text-only parts; assistant message with mixed `content[]` parts (text + tool_call + image_url); user message with attachments; message with `feedback.tag` as string, array, and object; message with NULL `model`. Each test asserts the produced `EnrichedRow` matches the expected shape and that `content` JSONB is lossless.
- **REQ-T-2: Field-mapping drift gate.** A parser reads `docs/field-mapping.md` and extracts each documented source-field name. The test asserts (a) every source field referenced in `src/mongo.ts` projections or `src/enrich.ts` mapping logic is documented, and (b) every documented field is actually referenced by code. Fails CI if drift detected. This is the load-bearing contract for NFR-5 / V-5.
- **REQ-T-3: Mongo paging integration test.** Using `mongodb-memory-server`, seed a synthetic dataset of 1500 messages with diverse `createdAt` values (including clock-skew edge cases). Run the paging loop with batch size 500 and watermark safety 60s. Assert all 1500 messages are processed exactly once across three batches, with the watermark safety margin tolerating injected skew.
- **REQ-T-4: Transactional watermark guarantee.** Using `testcontainers` Postgres, run a batch upsert where `messages_log` succeeds but a synthetic constraint violation is injected into the `sync_state` advance. Assert: transaction rolls back fully; watermark in `sync_state` is unchanged; `messages_log` contains no batch rows; sidecar's in-memory `lastSuccessfulSyncAt` is NOT updated.
- **REQ-T-5: Poison-row bisection.** Using `testcontainers` Postgres, seed a 10-row batch where row 7 violates an `INSERT` constraint (e.g., text exceeding column max). Assert: 9 rows commit successfully via bisection; row 7 lands in `dead_letter_log` with `error_phase = "postgres_upsert"` and sanitized `error_detail`; watermark advances past the entire batch; `convlog_dead_letter_total{phase="postgres_upsert"}` increments by exactly 1.

---

## Implementation Summary

**Completion Date:** 2026-05-26
**Implementation Plan:** `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md`
**Summary Document:** `SDD/implementation/summaries/IMPLEMENTATION-SUMMARY-016-2026-05-26_17-26-19.md`

### Requirements Validation Results

All requirements Complete as of 2026-05-26:
- Functional: REQ-054 through REQ-075 (22 requirements) — all Complete
- Non-functional: NFR-1 through NFR-5 — NFR-1, NFR-2, NFR-4 validated by architectural decisions (post-merge prod validation per V-1/V-2/V-8); NFR-3 and NFR-5 validated by implementation and REQ-T-2 drift gate
- Testing: REQ-T-1 through REQ-T-5 — all Complete; 33/33 tests passing
- Security: REQ-055, REQ-056, REQ-057, REQ-072, REQ-073, REQ-074 — all Complete; DPO acceptance at `SDD/governance/DPO-acceptance-conv-log.md`

### Implementation Insights

- **Branded `Txn` type.** The `{ client: pg.Client; readonly __brand: 'in-transaction' }` brand enforces at compile time that `upsertBatch` and `advanceWatermark` can only be called inside an active transaction. This eliminated an entire class of accidental out-of-transaction writes without any runtime overhead.
- **Normalised batch boundary in `mongo.ts`.** All Mongo `WithId<Document>` shapes are transformed to plain TypeScript `Normalized*` types inside `mongo.ts` before returning `EnrichInputBatch`. No Mongo driver types (`ObjectId`, `Mixed`) cross the module boundary. `enrich.ts` and `postgres.ts` remain pure TypeScript with no dependency on the Mongo SDK.
- **Pure `enrich` function with injected `now`.** `enrich(input, { schemaVersion, now })` accepts `opts.now` as a parameter and contains no `Date.now()` or `new Date()` calls. All 14 REQ-T-1 tests are fully deterministic.
- **Two `pg.Client` instances (CRI-01 resolution).** The original spec said "single pg.Client" as a simplicity preference. The adversarial review found that a shared client allows cross-loop transaction contamination when ingestion and erasure loops run concurrently via `Promise.all`. The two-client design preserves the spec's intent (logical isolation) via a more defensive implementation: each loop owns its connection, errors in one cannot contaminate the other.
- **Keyset pagination for erasure reconciliation (CRI-07 resolution).** OFFSET pagination skips rows after deletions — a silent GDPR SLO breach under non-trivial erasure volume. Keyset pagination on `messages_log.id` (`WHERE id > $lastId ORDER BY id LIMIT N`) eliminates cursor drift and is more efficient at scale.

### Deviations from Original Specification

- **`migrations/002_dead_letter_unique.sql` added.** `001_init.sql` created `dead_letter_log` with only a `BIGSERIAL` PK; the `ON CONFLICT (source_collection, source_id)` upsert in `runDeadLetter` requires a `UNIQUE` constraint. Rather than edit the applied `001` (which would break the checksum invariant on partially-deployed instances), a new migration `002` was added using a `DO $$...$$` idempotent block. Additionally, the initial `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` syntax proved invalid in Postgres through PG 16; the block was rewritten during Chunk 3 testing.
- **Two additional environment variables introduced by fixes.** `CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER` (CRI-06 hysteresis fix — spec did not anticipate oscillation at the backfill threshold boundary) and `CONVLOG_ERASURE_SAFETY_MIN_CHUNK` (CRI-04 safety threshold — spec did not specify a minimum chunk size before the deletion-ratio abort applies). Both are documented in `.env.example` with defaults that reproduce the original intended behaviour.
- **Two `pg.Client` instances instead of one.** The spec implied a single long-lived `pg.Client` for simplicity. The adversarial review (CRI-01) found cross-loop transaction contamination risk with concurrent loops on a shared client. The implementation uses two clients — one per loop — preserving the spec's intent (no connection pool overhead) while eliminating the safety risk.

Tests run via `npm test` in `conv-log/`. Implementation MUST NOT mock the Postgres or Mongo SDKs — tests exercise real in-memory or testcontainers instances per the project's testing philosophy (CLAUDE.md). CI fails the image build if any test fails or coverage on `enrich.ts` drops below 90%.
