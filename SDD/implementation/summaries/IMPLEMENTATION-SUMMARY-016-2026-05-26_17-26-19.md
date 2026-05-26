# Implementation Summary — SPEC-016: Conversation Log Sidecar

**Date:** 2026-05-26
**Spec:** SDD/requirements/SPEC-016-conversation-log-sidecar.md (rev 2, Approved)
**Implementation Plan:** SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md
**Branch:** feature/016 (target merge into `pablo`)
**Test Result:** 33/33 passing
**tsc:** Clean (exits 0)

---

## Requirements Completion Matrix

### Functional Requirements

| REQ | Description | Status | Chunk |
|---|---|---|---|
| REQ-054 | Service defined in compose files | Complete | 1 |
| REQ-055 | Image hygiene (pinned digest, non-root, read-only FS) | Complete | 1 |
| REQ-056 | Read-only Mongo user provisioning script | Complete | 1 |
| REQ-057 | Destination Postgres DB + role separation provisioning | Complete | 1 |
| REQ-058 | Destination schema DDL (all tables, indexes) | Complete | 1 |
| REQ-059 | Watermark semantics with safety margin | Complete | 2 |
| REQ-060 | Batch ingestion loop | Complete | 2 |
| REQ-061 | Backfill on first run | Complete | 2 |
| REQ-062 | Idempotency (upsert ON CONFLICT) | Complete | 2 |
| REQ-063 | Field mapping with lossless content preservation | Complete | 2 |
| REQ-064 | Resolved underlying LLM (Type-1 SCD) | Complete | 2 |
| REQ-065 | Failure isolation with backoff | Complete | 2 |
| REQ-066 | Health endpoint /healthz and /metrics | Complete | 2 |
| REQ-067 | Prometheus scrape target + metrics | Complete | 1+2 |
| REQ-068 | Alertmanager alert rule ConvLogSyncLagBreach | Complete | 1 |
| REQ-069 | Structured JSON logging via pino | Complete | 2 |
| REQ-070 | .env.example conv-log block with all env vars | Complete | 1 |
| REQ-071 | Operator runbook conv-log/README.md | Complete | 2 |
| REQ-072 | No core edits (api/, packages/*, client/) | Complete | 1 |
| REQ-073 | Right-to-erasure reconciliation | Complete | 2 |
| REQ-074 | Dead-letter handling with sanitized error detail | Complete | 2 |
| REQ-075 | Backfill mode entry/exit with hysteresis | Complete | 2 |

### Non-Functional Requirements

| NFR | Description | Status | Note |
|---|---|---|---|
| NFR-1 | Steady-state < 200 MB RAM, < 5% CPU | Validated by architecture | Post-merge prod validation V-1, V-2 |
| NFR-2 | P95 lag SLO <= 2x interval (steady state) | Validated by architecture | Post-merge prod validation V-8 |
| NFR-3 | Restart-safe | Complete | DDL idempotent; upsert key; compose restart:unless-stopped |
| NFR-4 | Backfill bounded | Validated by architecture | Post-merge prod validation V-1 |
| NFR-5 | Upgrade portability | Complete | REQ-T-2 drift gate (bidirectional) |

### Testing Requirements

| REQ | Description | Status | Tests | File |
|---|---|---|---|---|
| REQ-T-1 | enrich.ts pure-function tests | Complete | 14 | tests/enrich.test.ts |
| REQ-T-2 | Field-mapping drift gate | Complete | 4 | tests/field-mapping-drift.test.ts |
| REQ-T-3 | Mongo paging integration test | Complete | 2 | tests/mongo-paging.test.ts |
| REQ-T-4 | Transactional watermark guarantee | Complete | 2 | tests/postgres-transaction.test.ts |
| REQ-T-5 | Poison-row bisection | Complete | 5 | tests/postgres-bisection.test.ts |

---

## Implementation Artifacts

### New Files — conv-log/

| Path | Purpose |
|---|---|
| `conv-log/package.json` | npm manifest; ESM; engines node>=22<23 |
| `conv-log/package-lock.json` | Locked dependency tree; 0 high vulns; npm ci used in Dockerfile |
| `conv-log/tsconfig.json` | Strict TS config; ES2022 target; Node16 module resolution |
| `conv-log/.dockerignore` | Excludes node_modules, dist, tests, ops, .env* from image |
| `conv-log/Dockerfile` | Multi-stage; pinned node:22-alpine digest sha256:968df39…; non-root convlog user; read-only FS; npm ci |
| `conv-log/vitest.config.ts` | Vitest configuration: node env, 60s timeout, coverage v8 |
| `conv-log/src/index.ts` | Entrypoint: loadConfig, 11 Prometheus metrics, HTTP server, ingestion loop, erasure loop, backfill mode, jitteredBackoff, graceful shutdown |
| `conv-log/src/mongo.ts` | MongoClient factory, fetchMessageBatch, LRU-cached lookups, assembleBatch, GUARDRAIL_COLLECTION constant, normaliseMessage (null-returns on invalid docs) |
| `conv-log/src/enrich.ts` | Pure enrich(input, opts) function; all column-level field mappings; no I/O; injected opts.now |
| `conv-log/src/postgres.ts` | runMigrations (fresh-DB bootstrap), Txn brand type, withTransaction, connectPgClient, upsertBatch, bisectAndUpsert (depth-capped), sanitizePgError, runDeadLetter, runErasureReconciliation (keyset pagination) |
| `conv-log/src/watermark.ts` | readWatermark, advanceWatermark (accepts Txn) |
| `conv-log/migrations/001_init.sql` | Full schema DDL (REQ-058): 7 tables + 5 indexes; idempotent IF NOT EXISTS |
| `conv-log/migrations/002_dead_letter_unique.sql` | Adds UNIQUE(source_collection, source_id) on dead_letter_log; idempotent DO block |
| `conv-log/ops/provision-mongo.sh` | Creates convlog_reader in LibreChat db; audit-logged |
| `conv-log/ops/provision-postgres.sh` | Creates convlog db, convlog_writer, convlog_reader; default privileges; audit-logged |
| `conv-log/README.md` | 13-section operator runbook (REQ-071): setup, env vars, analytics queries, runbook, escalation |
| `conv-log/docs/field-mapping.md` | Canonical field-mapping contract (REQ-T-2 drift gate anchor) |
| `conv-log/tests/tsconfig.json` | Test tsconfig extending root; noUncheckedIndexedAccess: false |
| `conv-log/tests/enrich.test.ts` | REQ-T-1: 14 table-driven pure-function tests |
| `conv-log/tests/field-mapping-drift.test.ts` | REQ-T-2: 4 bidirectional drift-gate tests |
| `conv-log/tests/mongo-paging.test.ts` | REQ-T-3: 2 mongodb-memory-server integration tests |
| `conv-log/tests/postgres-transaction.test.ts` | REQ-T-4: 2 testcontainers Postgres transaction tests |
| `conv-log/tests/postgres-bisection.test.ts` | REQ-T-5: 5 tests (3 unit sanitization + 1 integration bisection + 1 overflow path) |
| `conv-log/tests/postgres-fresh-migration.test.ts` | CRI-02 fix: 4 tests on empty Postgres without manual bootstrap |
| `conv-log/tests/postgres-loop-isolation.test.ts` | CRI-01 fix: 2 cross-loop transaction isolation tests |

### New SDD Artifacts

| Path | Purpose |
|---|---|
| `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md` | Canonical implementation tracker |
| `SDD/orchestration/conv-log-provisioning.log` | Audit log stub with header |
| `SDD/reviews/REVIEW-016-conversation-log-sidecar-20260526.md` | Step 4b code review (APPROVED WITH FINDINGS; resolved) |
| `SDD/reviews/CRITICAL-IMPL-conversation-log-sidecar-20260526.md` | Step 4d critical review (REVISE BEFORE PROCEEDING; resolved) |
| `SDD/governance/DPO-acceptance-conv-log.md` | DPO acceptance for analytical retention (signed 2026-05-26) |

### Modified Files

| Path | Change |
|---|---|
| `docker-compose.override.yml` | Added conv-log service (REQ-054, REQ-055 hardening) |
| `docker-compose.prod.yml` | Added conv-log service with prod env_file override and resource limits |
| `.env.example` | Appended 19-variable conv-log block (18 original + CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER + CONVLOG_ERASURE_SAFETY_MIN_CHUNK; two additions from CRI fixes) |
| `monitoring/prometheus/prometheus.yml` | Added conv-log scrape job on port 9300 (REQ-067) |
| `monitoring/prometheus/alerts.yml` | Added ConvLogSyncLagBreach (REQ-068) + ConvLogErasureRunaway (CRI-04) + ConvLogDeadLetterStructuralFailure (CRI-09) |

---

## Technical Implementation Details

### Architecture Decisions

- **Branded `Txn` type.** `postgres.ts` exports `type Txn = { client: pg.Client; readonly __brand: 'in-transaction' }`. TypeScript structural typing enforces that `upsertBatch` and `advanceWatermark` are only callable inside an active transaction — preventing accidental out-of-transaction writes at compile time.
- **`assembleBatch` normalised boundary.** All Mongo `WithId<Document>` shapes are normalised to `Normalized*` types inside `mongo.ts` before returning `EnrichInputBatch`. No Mongo driver types (`ObjectId`, `Mixed`) cross into `enrich.ts` or `postgres.ts`. `normaliseMessage` returns `null` for documents with empty/missing `messageId` or invalid `createdAt`; these are filtered and counted as normalisation skips.
- **Pure `enrich` with injected `now`.** No `Date.now()` or `new Date()` calls inside `enrich.ts`. Fully deterministic; all 14 REQ-T-1 tests are consistent and repeatable.
- **Two `pg.Client` instances (CRI-01 closure).** `pgClient` for the ingestion loop; `pgClientReconciliation` for the erasure loop. Each owns its connection. Migrations and startup queries run sequentially on a single client before the two loops start. Verified by `tests/postgres-loop-isolation.test.ts`: ROLLBACK on ingestion client does not affect committed work in reconciliation client.
- **Keyset pagination for erasure (CRI-07 closure).** `WHERE id > $lastId ORDER BY id LIMIT N` replaces OFFSET pagination. Deletions no longer move the cursor; the full `messages_log` table is always covered in a single reconciliation pass.
- **`sanitizePgError` redactor (CRI-03 closure).** Strips `DETAIL:` lines and `Key (...)=(...)` substrings from pg error messages before slicing to 500 chars. Prevents row identifiers (messageId, userId) from appearing in `dead_letter_log.error_detail`. Verified by unit tests in `tests/postgres-bisection.test.ts`.
- **Deletion-ratio safety abort (CRI-04 closure).** Before each erasure chunk DELETE: if `toDelete.length / messageIds.length > 0.5` AND Mongo returned 0 for a chunk larger than `CONVLOG_ERASURE_SAFETY_MIN_CHUNK`, the chunk is aborted with an error and metric increment. Protects against Mongo blip wiping the analytical store.
- **Recursion-depth-capped bisection (CRI-09 closure).** `bisectAndUpsert` internal `attempt` function tracks `depth`; cap is `ceil(log2(batchSize)) + 2`. On cap exceeded, all remaining rows in the sub-batch are fast-failed to `dead_letter_log` with `error_phase = 'bisection_overflow'`. `convlog_bisection_max_depth_observed` gauge tracks high-water mark.
- **First erasure reconciliation at 60s (CRI-11 closure).** `runErasureLoop` sleeps 60s then runs the first reconciliation pass (rather than sleeping 24h first). Subsequent cadence: reconcile then sleep 24h. Ensures GDPR Art. 17 propagation stays within the 24h SLO for pre-sidecar erasures.
- **Two-threshold backfill hysteresis (CRI-06 closure).** Enter backfill when `pending > backfillEnterThreshold`; exit when `pending < backfillExitThreshold` (default `enterThreshold * CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER`, default 0.5). Prevents oscillation at the boundary.

### Dependencies

Production (`dependencies` in package.json):
- `mongodb` — source Mongo driver
- `pg` — destination Postgres client
- `prom-client` — Prometheus metrics exposition
- `pino` — structured JSON logging
- `lru-cache` — LRU cache for conversation/agent lookups in `mongo.ts`

Development (`devDependencies`):
- `vitest` — test runner
- `@vitest/coverage-v8` — code coverage via V8
- `mongodb-memory-server` — in-process Mongo for REQ-T-3
- `testcontainers` — Docker-backed Postgres for REQ-T-4, REQ-T-5, and fix tests
- `typescript` — compiler
- `@types/node`, `@types/pg` — type definitions

---

## Subagent Delegation Summary

| Step | Role | Outcome |
|---|---|---|
| 4a-1 | Implementation-chunk (Chunk 1 scaffolding) | 15 new files; compose + monitoring integration; REQ-054..058, REQ-067..068, REQ-070, REQ-072 |
| 4a-2 | Implementation-chunk (Chunk 2 TypeScript + docs) | 8 source/doc files; REQ-059..066, REQ-069, REQ-071, REQ-073..075 |
| 4a-3 | Implementation-chunk (Chunk 3 test suite) | 7 test files; 23/23 tests pass; migration bug (002 syntax) surfaced and fixed |
| 4b | Specification-driven code review (Sonnet) | APPROVED WITH FINDINGS: 0 HIGH, 4 MEDIUM, 3 LOW |
| 4c | Code-review findings resolution (Sonnet) | All 7 findings resolved; 23/23 tests remain passing |
| 4d | Critical review (Opus 4.7 1M context) | REVISE BEFORE PROCEEDING: 4 HIGH, 7 MEDIUM, 4 LOW; surfaced shared pg.Client contamination, fresh-DB crash, dead-letter payload leak, erasure wipe-on-blip |
| 4e | Critical review findings resolution (Sonnet) | All 15 findings resolved; 33/33 tests pass (+10 new tests from CRI-01 and CRI-02 regressions) |
| 4f | Implementation completion (Sonnet, this step) | Gate confirmed (33/33, tsc clean); tracker/spec/summary/progress finalized |

---

## Quality Metrics

| Metric | Value |
|---|---|
| Tests passing | 33/33 |
| Test files | 7 |
| tsc --noEmit | Clean (exit 0) |
| High-severity review findings | 4 (all resolved) |
| Medium-severity review findings | 7+4 = 11 (all resolved, across two review passes) |
| Low-severity review findings | 4+3 = 7 (all resolved, across two review passes) |
| REQ-072 scope gate | Pass — zero files modified in api/, packages/*, client/ |
| Coverage | TBD by operator via `npx vitest --coverage`; defer to post-merge |

---

## Deployment Readiness

### Environment Variables

19 `CONVLOG_*` environment variables total. 17 from original REQ-070, plus 2 added by CRI fixes:

| Variable | Default | Source |
|---|---|---|
| CONVLOG_MONGO_URI | (required) | REQ-070 |
| CONVLOG_MONGO_DB | librechat | REQ-070 |
| CONVLOG_PG_URI | (required) | REQ-070 |
| CONVLOG_PG_STATEMENT_TIMEOUT_MS | 60000 | REQ-070 |
| CONVLOG_BATCH_SIZE | 500 | REQ-070 |
| CONVLOG_POLL_INTERVAL_MS | 300000 | REQ-070 |
| CONVLOG_BACKFILL_INTERVAL_MS | 5000 | REQ-070 |
| CONVLOG_BACKFILL_THRESHOLD | 2500 | REQ-070 |
| CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER | 0.5 | CRI-06 fix |
| CONVLOG_WATERMARK_SAFETY_MARGIN_MS | 60000 | REQ-070 |
| CONVLOG_MAX_CONSECUTIVE_FAILURES | 3 | REQ-070 |
| CONVLOG_BACKOFF_BASE_MS | 30000 | REQ-070 |
| CONVLOG_BACKOFF_MAX_MS | 300000 | REQ-070 |
| CONVLOG_ERASURE_RECONCILIATION_HOURS | 24 | REQ-070 |
| CONVLOG_ERASURE_CHUNK_SIZE | 1000 | REQ-070 |
| CONVLOG_ERASURE_SAFETY_MIN_CHUNK | 100 | CRI-04 fix |
| CONVLOG_RETENTION_CEILING_DAYS | (optional, disabled if unset) | REQ-070 |
| CONVLOG_HTTP_PORT | 9300 | REQ-070 |
| CONVLOG_ALERT_MIN_LAG_SECONDS | 900 | REQ-070 (documentation only; alerts.yml must be edited manually) |

### Configuration

- `docker-compose.override.yml` — conv-log service block with image, env, healthcheck, network attachment, cap_drop, read_only, no-new-privileges
- `docker-compose.prod.yml` — conv-log service block with prod env_file and resource limits (memory: 256m, cpus: 0.1)
- `monitoring/prometheus/prometheus.yml` — scrape job targeting conv-log:9300/metrics
- `monitoring/prometheus/alerts.yml` — 3 alert rules: ConvLogSyncLagBreach, ConvLogErasureRunaway, ConvLogDeadLetterStructuralFailure
- `.env.prod` — carries resolved values for CONVLOG_* vars (maintained by operator; not in git)

### Database Changes

- **New Postgres database `convlog`** provisioned via `conv-log/ops/provision-postgres.sh` on the existing pgvector instance. Creates roles `convlog_writer` and `convlog_reader` with strict separation. No changes to any existing database.
- **No changes to source Mongo schema.** The sidecar connects with a read-only user (`convlog_reader`) and never writes to MongoDB.
- **Schema DDL** applied at startup via `runMigrations`: `001_init.sql` (7 tables + 5 indexes) and `002_dead_letter_unique.sql` (dead-letter unique constraint). Both idempotent.

### API Changes

None. No public HTTP endpoints exposed outside the Docker internal network. `/healthz` and `/metrics` run on port 9300, internal only (not exposed via Caddy or any external reverse proxy).

---

## Monitoring and Observability

### Prometheus Metrics (11 total)

9 from REQ-067 + 2 added by CRI fixes:

| Metric | Type | Labels | Source |
|---|---|---|---|
| convlog_messages_synced_total | Counter | — | REQ-067 |
| convlog_dead_letter_total | Counter | phase | REQ-067 |
| convlog_sync_lag_seconds | Gauge | — | REQ-067 |
| convlog_backfill_pending_messages | Gauge | — | REQ-067 |
| convlog_errors_total | Counter | phase | REQ-067 |
| convlog_batch_duration_ms | Histogram | — | REQ-067 |
| convlog_max_message_age_seconds | Gauge | — | REQ-067 |
| convlog_erasure_deletions_total | Counter | — | REQ-067 |
| convlog_guardrail_preflight_ok | Gauge | — | REQ-067 (CRI-10 addition) |
| convlog_erasure_chunk_deleted_ratio | Histogram | — | CRI-04 fix |
| convlog_bisection_max_depth_observed | Gauge | — | CRI-09 fix |

### Alert Rules (3 total)

| Alert | Condition | Severity |
|---|---|---|
| ConvLogSyncLagBreach | convlog_sync_lag_seconds > threshold for 5m | warning |
| ConvLogErasureRunaway | erasure deletion rate spike (configurable) | critical |
| ConvLogDeadLetterStructuralFailure | convlog_dead_letter_total{phase="bisection_overflow"} > 0 for 10m | critical |

---

## Rollback Plan

Per `conv-log/README.md` operator runbook:

1. **Image rollback:** Update image tag in `docker-compose.prod.yml` to previous version. Run `./prod.sh up -d conv-log` on the prod host.
2. **Schema rollback:** Postgres schema changes are additive and idempotent. A rolled-back sidecar will run against the existing schema without error (migrations are skipped for already-applied versions via checksum check).
3. **Data corruption recovery:** If bad data was written (e.g., due to a bug in the enrichment logic), follow the truncate-and-rebuild procedure (REQ-071): truncate `messages_log` and related tables, reset `sync_state`, restart sidecar to trigger full backfill. No Mongo data is affected.
4. **Watermark reset:** `DELETE FROM sync_state WHERE key = 'messages_high_watermark';` causes the next startup to re-enter backfill mode.

---

## Deploy Path

This feature requires **no `prod-sync.sh` run** (REQ-072 — no files under `packages/*/src/` or `client/` were modified; no bind-mounted dist changes).

Deploy sequence:
1. Merge `feature/016` into `pablo` branch (per project workflow).
2. `git push` on dev machine.
3. On prod host: `git pull`.
4. One-time pre-deploy provisioning (first deploy only):
   - `bash conv-log/ops/provision-mongo.sh` — creates convlog_reader in LibreChat Mongo
   - `bash conv-log/ops/provision-postgres.sh` — creates convlog db and roles on pgvector instance
5. `./prod.sh up -d conv-log` — starts the sidecar; migrations run automatically on first start.

---

## Next Steps

### Pre-Merge Validations (operator)

- **V-3:** Failure isolation — kill the `conv-log` container during an active LibreChat chat session; verify no observable effect on the chat or core API.
- **V-5:** Upgrade portability smoke test — after any LibreChat upstream merge, run `npx vitest run` in `conv-log/`; confirm REQ-T-2 drift gate still passes.
- **V-6:** Sample analytical queries — run the 5+ example queries from `conv-log/README.md` against the backfilled DB using `convlog_reader` credential; verify sensible results.

### Operator Verification Before Deploy

- **CRI-10 follow-up:** Confirm the `guardrailevents` collection name by running `db.getCollectionNames()` in mongosh against the production LibreChat database. If the actual name differs from `guardrailevents`, update the `GUARDRAIL_COLLECTION` constant in `conv-log/src/mongo.ts` before deploying. (The startup pre-flight check logs a warning if absent but does not fail startup.)

### Post-Merge Production Validations

Per SPEC-016 § Validation:

- **V-1:** Backfill correctness — after first successful exit from backfill mode, `SELECT COUNT(*) FROM messages_log` is within 1% of `db.messages.countDocuments({})`.
- **V-2:** Idempotency — reset `sync_state` and re-run; verify identical `messages_log` content.
- **V-4:** No core diff — `git diff main...pablo -- api/ packages/ client/` returns empty.
- **V-7:** Erasure propagation — delete a test conversation; verify all rows purged from `messages_log` and `guardrail_events_log` within 24h; verify `convlog_erasure_deletions_total` increments by expected count.
- **V-8:** Dead-letter happy path — inject synthetic poison message; verify it lands in `dead_letter_log` with sanitized `error_detail`; verify watermark advances past it.
