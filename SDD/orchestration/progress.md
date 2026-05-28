# SDD-Flow Progress — SPEC-016 Conversation Log Sidecar

### Step 4a-2 — implementation subagent run (2026-05-26) — Chunk 2: TypeScript source + docs

**Status:** Complete

**Deliverables written:**
- `conv-log/src/mongo.ts` — MongoClient factory, batch fetch, LRU cache, assembleBatch, EnrichInputBatch normalised boundary
- `conv-log/src/enrich.ts` — pure enrich() with injected opts.now, EnrichedBatch, all column-level field mappings
- `conv-log/src/postgres.ts` — Txn brand type, withTransaction, runMigrations (checksum guard), upsertBatch, bisectAndUpsert (recursive), runDeadLetter, runErasureReconciliation, connectPgClient
- `conv-log/src/watermark.ts` — readWatermark, advanceWatermark (Txn-accepting)
- `conv-log/src/index.ts` — loadConfig, 9 Prometheus metrics, HTTP server, ingestion loop, erasure loop, backfill-mode, backoff, graceful shutdown
- `conv-log/migrations/002_dead_letter_unique.sql` — patches missing UNIQUE(source_collection, source_id) on dead_letter_log
- `conv-log/docs/field-mapping.md` — canonical contract (REQ-T-2 drift gate)
- `conv-log/README.md` — 13-section operator runbook (REQ-071)
- `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md` — updated (chunk 2 complete, architecture decisions, chunk 3 priorities)

**REQs marked Complete:** 059, 060, 061, 062, 063, 064, 065, 066, 067 (metrics), 069, 071, 073, 074, 075

**Next:** Chunk 3 — test suite (REQ-T-1 through REQ-T-5, vitest.config.ts, CI gate)

---

### Step 4a-3 — implementation subagent run (2026-05-26) — Chunk 3: Test suite

**Status:** Complete

**Deliverables written:**
- `conv-log/vitest.config.ts` — vitest configuration (node env, 60s timeout, coverage v8)
- `conv-log/tests/tsconfig.json` — test tsconfig extending root
- `conv-log/tests/enrich.test.ts` — REQ-T-1: 14 table-driven pure-function tests
- `conv-log/tests/field-mapping-drift.test.ts` — REQ-T-2: 4 drift-gate tests (docs vs source cross-check)
- `conv-log/tests/mongo-paging.test.ts` — REQ-T-3: 2 mongodb-memory-server integration tests
- `conv-log/tests/postgres-transaction.test.ts` — REQ-T-4: 2 testcontainers Postgres transaction tests
- `conv-log/tests/postgres-bisection.test.ts` — REQ-T-5: 1 testcontainers Postgres bisection test

**Bug fix during testing:**
- `conv-log/migrations/002_dead_letter_unique.sql` — Replaced invalid `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` syntax (not supported in any PG version through PG 16) with a `DO $$ IF NOT EXISTS ... THEN ALTER TABLE ... END IF; $$;` block. Tests REQ-T-4 and REQ-T-5 surfaced the bug.

**Test results:** 23/23 tests pass. `npx tsc --noEmit` exits 0. Both source and test tsconfigs compile cleanly.

**REQs marked Complete:** REQ-T-1, REQ-T-2, REQ-T-3, REQ-T-4, REQ-T-5

**Next:** Code review (Step 4b) and critical review (Step 4d) on feature/016 branch

## Implementation Phase - START (2026-05-26)

Implementation entered directly. Research and planning artifacts pre-existed and are finalized:

- Research: `SDD/research/RESEARCH-016-conversation-log-sidecar.md`
- Specification: `SDD/requirements/SPEC-016-conversation-log-sidecar.md` (rev 2, Approved, `delivery_mode: whole-feature`)
- DPO acceptance: `SDD/governance/DPO-acceptance-conv-log.md` (signed 2026-05-26)

Branch: `feature/016` (target merge into `pablo`, NOT main).

### Implementation Chunking Decision

SPEC item count: 22 REQs (REQ-054 through REQ-075) + 5 REQ-Ts = 27 items. Exceeds 8-item threshold per orchestrator discipline. Pre-split into **3 sequential chunks** along natural seams:

1. **Chunk 1 — Scaffolding & repo integration.** Non-TypeScript files: package.json, package-lock.json, tsconfig.json, .dockerignore, Dockerfile, migrations/001_init.sql, ops/{provision-mongo,provision-postgres}.sh, docker-compose.override.yml + docker-compose.prod.yml service blocks, .env.example CONVLOG block, monitoring/prometheus/{prometheus.yml,alerts.yml} additions, SDD/orchestration/conv-log-provisioning.log header. Also creates the IMPLEMENTATION-PLAN tracker via `/sdd:implementation-start` flow.
2. **Chunk 2 — TypeScript modules + field mapping + README.** conv-log/src/{index,mongo,enrich,postgres,watermark}.ts, conv-log/docs/field-mapping.md, conv-log/README.md (operator runbook including the deploy-path note from REQ-071).
3. **Chunk 3 — Tests.** All five REQ-T mandatory categories using real instances (mongodb-memory-server, testcontainers Postgres).

Each chunk receives a counter file at `SDD/orchestration/counters/4a-<chunk>-<timestamp>.md` with `Reads: 0/10\nNested subagents: 0/4` initial content, and embedded `/sdd:implementation-compact` instructions as its safety-net bail-out path.

### Hard gates (enforced)

- REQ-072 (PR diff scope): no edits under `/api`, `/packages/*`, `/client`.
- REQ-T-1..T-5: all five test categories must pass before image build.
- REQ-055 (supply chain): `npm ci`, pinned digest, cap_drop:[ALL], read-only fs, no-new-privileges.
- TypeScript only in `/conv-log/src/`. No dependency on `/packages/*`.
- Functional-first per CLAUDE.md: `enrich.ts` is a pure function; `postgres.ts.upsertBatch` accepts a transaction handle; `watermark.ts.advanceWatermark` is type-enforced to be inside a transaction.

### Chunk 1 — IN PROGRESS

Counter file: see Step 4a-1 subagent spawn.

### Step 4a-1 — implementation-chunk-1 subagent run (2026-05-26)

Phase: SPEC-016 Chunk 1 scaffolding
Status: Complete

Deliverables written:
- conv-log/package.json
- conv-log/package-lock.json (generated via npm install --ignore-scripts; 0 high vulns)
- conv-log/tsconfig.json
- conv-log/.dockerignore
- conv-log/Dockerfile (node:22-alpine pinned sha256:968df39…; non-root convlog user)
- conv-log/migrations/001_init.sql (full DDL REQ-058, idempotent)
- conv-log/ops/provision-mongo.sh
- conv-log/ops/provision-postgres.sh
- SDD/orchestration/conv-log-provisioning.log (stub)
- docker-compose.override.yml (conv-log service added)
- docker-compose.prod.yml (conv-log service added with prod hardening)
- .env.example (18-variable conv-log block appended)
- monitoring/prometheus/prometheus.yml (conv-log scrape target)
- monitoring/prometheus/alerts.yml (ConvLogSyncLagBreach rule)
- SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md

Pending: Chunk 2 (src/ TypeScript + README + docs/field-mapping.md) + Chunk 3 (tests)
Reads used: 9/10  Nested subagents: 0/4

### Step 4b — specification-driven code review subagent run

**Date:** 2026-05-26
**Agent:** SDD-flow Step 4b (claude-sonnet-4-6)
**Reads used:** 9/10 | **Nested spawns:** 0/4

**Summary:** Completed full code review of SPEC-016 conv-log sidecar implementation. Verdict: APPROVED WITH FINDINGS.
- 0 HIGH findings
- 4 MEDIUM findings (M-01 hardcoded statement_timeout; M-02 syncLagSeconds metric formula; M-03 alert threshold hardcoded; M-04 non-transactional retention DELETE)
- 3 LOW findings (L-01 dynamic import; L-02 dead set(0) call; L-03 misleading env.example comment)
- 23/23 tests pass (confirmed by running npx vitest run)
- REQ-072 PASS: SPEC-016 changes touch zero files in api/, packages/, client/
- All 22 functional REQs implemented

**Artifacts written:**
- `SDD/reviews/REVIEW-016-conversation-log-sidecar-20260526.md`

### Step 4c — code-review findings resolution subagent run (2026-05-26)

**Status:** Complete

**Findings resolved:** 4 MEDIUM + 3 LOW (0 HIGH)

- M-01: `upsertBatch` now accepts `statementTimeoutMs` param (default 60000); `bisectAndUpsert` forwards it; `index.ts` passes `cfg.pgStatementTimeoutMs`.
- M-02: `convlog_sync_lag_seconds` now tracks `now - lastSuccessfulTickStartUnix` per REQ-067; dead `set(0)` removed (L-02 combined).
- M-03: `monitoring/prometheus/alerts.yml` ConvLogSyncLagBreach rule comment replaced with prominent bordered operator-action block.
- M-04: Retention-ceiling DELETE wrapped in paged `withTransaction` loop with cascading `guardrail_events_log` and orphan `conversations_dim` cleanup.
- L-01: Dynamic `import('./watermark.js')` replaced with static top-of-file import.
- L-03: `.env.example` `CONVLOG_ALERT_MIN_LAG_SECONDS` comment updated to clarify manual `alerts.yml` edit required.

**Post-fix verification:** `npx tsc --noEmit` exits 0; `npx vitest run` exits 0 — 23/23 tests passing.

**Artifacts modified:**
- `conv-log/src/postgres.ts`
- `conv-log/src/index.ts`
- `monitoring/prometheus/alerts.yml`
- `.env.example`

**Artifacts updated:**
- `SDD/reviews/REVIEW-016-conversation-log-sidecar-20260526.md` (Findings Addressed section appended)
- `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md` (Code Review Findings section added; status bumped)

### Step 4d — Implementation critical review (SPEC-016 conversation log sidecar)

**Run:** 2026-05-26 (Opus 4.7 1M, sdd-critical-reviewer)
**Inputs:** SPEC-016 rev 2; Step 4b code review (resolved Step 4c); 5 source modules; 2 high-value tests (postgres-bisection, postgres-transaction); migrations 001/002; compose overlays; alerts.yml; .env.example; Dockerfile.
**Counter:** Reads 9/10; nested subagents 0/4 (within budget).

**Verdict:** REVISE BEFORE PROCEEDING.

**Severity counts:** HIGH = 4, MEDIUM = 7, LOW = 4 (15 findings total).

**Top HIGH findings:**
- CRI-01 — Erasure and ingestion loops share a single `pg.Client`; node-postgres serialises queries but not transactions, allowing cross-loop transaction contamination (REQ-073 isolation violation).
- CRI-02 — `runMigrations` queries `schema_migrations` before the migration that creates it; tests bootstrap the table manually, hiding a guaranteed first-run startup crash on production.
- CRI-03 — Dead-letter `error_detail` is `err.message.slice(0, 500)`, not sanitized; pg unique-violation errors include `Key (...)=(...)` substrings with row identifiers (REQ-074 violation, DPO compensating-control regression).
- CRI-04 — Erasure reconciliation deletes the complement of an unverified Mongo `find()`; a Mongo blip or empty result wipes the analytical store (no maxTimeMS, no deletion-ratio safety check).

**Artifact written:** `SDD/reviews/CRITICAL-IMPL-conversation-log-sidecar-20260526.md` (full findings + adversarial Q&A + recommended actions keyed to CRI-NN IDs).

**Next step:** Step 4e fix subagent must address all four HIGHs (CRI-01..04) and at least CRI-08, CRI-09, CRI-10 from the MEDIUM cluster; recommend a brief second adversarial pass before merge to confirm structural fixes hold.

### Step 4e — Critical review findings fix (SPEC-016 conversation log sidecar)

**Run:** 2026-05-26 (Sonnet 4.6, sdd-flow workhorse)
**Inputs:** CRITICAL-IMPL-conversation-log-sidecar-20260526.md; conv-log/src/{index,mongo,postgres}.ts; tests/postgres-bisection.test.ts; tests/field-mapping-drift.test.ts.
**Counter:** Reads 10/10 (hit budget ceiling after 9 productive reads; 10th was counter write); nested subagents 0/4.

**Outcome:** All 15 findings resolved (4 HIGH + 7 MEDIUM + 4 LOW). tsc --noEmit: clean. vitest run: 33/33 tests passing (was 23; +10 new tests).

**Key changes:**
- CRI-01: Split into two pg.Client instances (pgClient for ingestion, pgClientReconciliation for erasure). Separate connections, fully isolated transactions.
- CRI-02: Added `CREATE TABLE IF NOT EXISTS schema_migrations` at top of runMigrations before file loop.
- CRI-03: Added sanitizePgError() helper; strips DETAIL lines and Key(...)=(...) substrings.
- CRI-04: Added maxTimeMS:60000 to erasure find(); deletion-ratio safety check (abort if >50% OR Mongo returns 0 for chunk >100); new erasureChunkDeletedRatio histogram metric.
- CRI-05: Moved consecutiveFailures=0 and onSuccessfulSync() before telemetry SELECT; telemetry in its own try/catch.
- CRI-06: Two-threshold hysteresis for backfill mode (CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER default 0.5).
- CRI-07: Keyset pagination on messages_log.id replaces OFFSET pagination.
- CRI-08: pg.Client.on('error') and mongoClient.on('error') registered immediately after connect.
- CRI-09: Bisection depth cap (ceil(log2(batchSize))+2); bisection_overflow dead-letter path; bisectionMaxDepthObserved gauge.
- CRI-10: GUARDRAIL_COLLECTION exported constant; startup pre-flight listCollections check with warn+metric.
- CRI-11: runErasureLoop runs first reconciliation after 60s settle, then sleeps 24h.
- CRI-12: server.close() awaited via Promise wrapper.
- CRI-13: SET statement_timeout via set_config($1,$2,false) parameterized call.
- CRI-14: startup catch uses process.stderr.write(err.message) not console.error({err}); pino redact config for *Uri.
- CRI-15: field-mapping-drift.test.ts verified bidirectional; documented in review.
- Defensive normalization: normaliseMessage() returns null for empty messageId or invalid createdAt; filtered in fetchMessageBatch with normalisation metric.

**New test files:** tests/postgres-fresh-migration.test.ts (4 tests), tests/postgres-loop-isolation.test.ts (2 tests).
**Files modified:** conv-log/src/postgres.ts, conv-log/src/index.ts, conv-log/src/mongo.ts, conv-log/tests/postgres-bisection.test.ts, monitoring/prometheus/alerts.yml, .env.example, SDD/reviews/CRITICAL-IMPL-conversation-log-sidecar-20260526.md, SDD/implementation/IMPLEMENTATION-PLAN-016-*.md.

---

## Implementation Phase - COMPLETE (2026-05-26)

### Step 4f — Implementation completion subagent run (2026-05-26)

**Status:** Complete

**Test Verification Gate:** PASSED
- `npx vitest run`: 33/33 tests passing (7 test files)
- `npx tsc --noEmit`: exits 0 (clean)

**Readiness Checklist:**
- All REQ-054 through REQ-075: Complete
- All REQ-T-1 through REQ-T-5: Complete
- Performance (NFR-1..NFR-5): NFR-3 and NFR-5 fully validated; NFR-1, NFR-2, NFR-4 validated by architectural decisions; post-merge prod validations V-1, V-2, V-4, V-7, V-8 are pre-merge operator steps
- Security: REQ-055 (image hardening), REQ-056 (read-only Mongo user), REQ-057 (Postgres role separation), REQ-072 (no core diff confirmed), REQ-074 (dead-letter sanitization via sanitizePgError), REQ-073 (erasure compliance), DPO acceptance at SDD/governance/DPO-acceptance-conv-log.md — all Complete
- Edge cases: REQ-061 (initial-watermark opt-out), REQ-074 (poison-row bisection), REQ-075 (backfill mode entry/exit with hysteresis) — all Complete with test coverage
- Failure scenarios: REQ-065 (failure isolation), CRI-04 fix (erasure safety abort), CRI-08 fix (pg connection error handler) — all implemented
- Subagent delegations: Steps 4a-1, 4a-2, 4a-3, 4b, 4c, 4d, 4e all documented in this progress file
- E2E tests: N/A — backend-only Docker sidecar; all behavior covered by unit + integration tests against real instances (testcontainers + mongodb-memory-server)

**Deployment Readiness:**
- No `prod-sync.sh` required (REQ-072 — no dist-producing workspace changes)
- Deploy path: `git push` + on prod `git pull` + `./prod.sh up -d conv-log`
- One-time provisioning: `conv-log/ops/provision-mongo.sh` and `conv-log/ops/provision-postgres.sh`
- Pre-deploy operator verification: confirm `guardrailevents` collection name in production Mongo (CRI-10 follow-up)

**Glossary:** Not maintained in this project; no deltas applied (project has not adopted SDD 1.2.0 glossary).

**Artifacts written/updated in this step:**
- `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md` — Status set to Complete; Completion Date and Duration added; Implementation Completion Summary section appended
- `SDD/requirements/SPEC-016-conversation-log-sidecar.md` — Implementation Summary section appended (completion details, requirements validation, insights, deviations)
- `SDD/implementation/summaries/IMPLEMENTATION-SUMMARY-016-2026-05-26_17-26-19.md` — Full implementation summary document created
- `SDD/orchestration/progress.md` — This block appended

## Pre-Merge Validation (2026-05-27)

Performed after the implementation commit, on branch feature/016.

### CRI-10 — RESOLVED (was: operator follow-up; resolved from source instead)
Collection name `guardrailevents` confirmed correct against source: `packages/data-schemas/src/schema/guardrailEvent.ts` registers `mongoose.model('GuardrailEvent', ...)` with no explicit `collection:` option → default pluralisation. **Deeper bug found and fixed:** the real schema nests entity data under a `details` Mixed sub-document and has no `eventId` field. The conv-log `normaliseGuardrailEvent` read top-level `doc['entityTypes']`/`doc['entityCount']`/`doc['eventId']` — which would have silently yielded NULL `entity_types`/`entity_count` for every guardrail row, making the V-6 PII-correlation query useless. Fixed `conv-log/src/mongo.ts` (RawGuardrailEvent type + normaliseGuardrailEvent now read `details.entityTypes`/`details.entityCount` and derive `event_id` from `_id`), updated `docs/field-mapping.md`, updated the REQ-T-2 drift gate (BACKSTOP + CODE_INTERNAL_NAMES), and added 2 real-instance tests in `mongo-paging.test.ts` seeding the actual SPEC-009 shape. Suite now 35/35.

### V-6 — PASS (pre-merge gate)
Spun up throwaway `postgres:16-alpine`, applied migrations 001+002, seeded synthetic conversations/agents/messages/guardrail-events, ran all 5 README sample analytical queries. All execute with correct results:
- Q1 top users by volume: user-1=5, user-2=2 (correct)
- Q2 agent error rates: Alpha Assistant 1/3 = 33.33% (correct; direct gpt-4o yields NULL agent name via LEFT JOIN as expected)
- Q3 PII correlation: returns populated entity_types/entity_count + conversation titles (validates the CRI-10 fix end-to-end at the query layer)
- Q4 model usage resolved: gpt-4o=5, claude-3-5-sonnet=2 (agent IDs correctly resolved via agents_dim join)
- Q5 conversation-length histogram: 3 conversations in the 2-5 bucket (correct)
DDL applied cleanly, all column names match query expectations.

### Remaining pre-merge items (require real environment / credentials — NOT performed)
- **V-3 (failure isolation):** requires a running LibreChat + conv-log stack to kill the sidecar mid-chat. Needs the full prod-like compose environment.
- **V-5 (upgrade portability smoke):** the pre-merge proxy (REQ-T-2 drift gate) passes; the real smoke test runs after a future upstream LibreChat merge.
- **Provisioning scripts + .env.prod:** require prod admin credentials (MONGO_ADMIN_URI, PG_ADMIN_URI) and create real infrastructure — operator action, not automatable here.

## Scoped V-3 (failure isolation) + boot-blocker fix (2026-05-27)

Ran scoped V-3 by building the real conv-log Docker image and running it against throwaway `postgres:16-alpine` + `mongo:7` containers (db `LibreChat` seeded with 1500 messages — distinct createdAt 1s apart, 30 conversations, 3 agents, 47 guardrail events).

### BOOT-BLOCKER FOUND + FIXED (HIGH) — invalid pino redact crashed startup
- **Symptom:** container exits code 1 in ~1s with `startup failure: Unexpected token '*'`, before any DB connect or migration.
- **Root cause:** `conv-log/src/index.ts:382` (CRI-14 fix from Step 4e) set `redact: ['*Uri', 'config.*Uri']`. pino's `fast-redact` (3.5.0) has no suffix wildcard — `*` must be a whole path segment — so it throws `SyntaxError` at logger construction inside `main()`.
- **Why all prior gates missed it:** 35 unit/integration tests + Step 4b code review + Step 4d Opus critical review never executed `main()` (tests exercise `enrich`/`mongo`/`postgres` modules directly; `loadConfig` + pino construction live only in the entrypoint). V-3 was the first end-to-end process boot. The sidecar as committed (`e4136a232`/`dd2498a20`) is **dead-on-arrival** in any real environment.
- **Fix (uncommitted, working tree):** `redact: ['mongoUri', 'pgUri', '*.mongoUri', '*.pgUri']` — valid fast-redact paths preserving CRI-14 intent. Verified in isolation against the image (old config throws; new constructs OK). Image rebuild = clean `npm run build` (tsc passes). Only `conv-log/src/index.ts` changed; no dist/prod-sync (REQ-072/071).

### V-3 RESULT — PASS (failure isolation + restart safety + idempotency)
- **Phase 1 (crash):** SIGKILL (`docker kill`, exit 137, oom=false) at 300 rows mid-drain. Post-crash: count=300, distinct=300, count%100=0 (whole batches only — no torn batch), watermark=`00:05:00Z`=max(source_created_at)=msg-300 (advanced atomically with rows), dead_letter=0; cross-store: Mongo `createdAt<=wm` = 300 = PG count (PG holds exactly the committed prefix).
- **Phase 2 (resume):** restarted same container; resumed from persisted watermark and drained to 1500.
- **Phase 3 (idempotent re-restart):** restarted again; count stayed 1500, distinct 1500, dead_letter 0, healthz ok.
- **Final:** 1500 rows / 1500 distinct (no dup), contiguity check 0 gaps (no loss — every msg-00001..01500 present once), watermark=`00:25:00Z`=max, min=`00:00:01Z`, dead_letter=0, conversations_dim=30, agents_dim=3, guardrail_events_log=47, error rows=30.
- **Mechanism confirmed empirically:** `bisectAndUpsert` commits row upserts + `advanceWatermark` in one transaction (postgres.ts:364-372), so a mid-tick crash rolls back both → DB always at a clean batch boundary; restart resumes losslessly; PK upserts make re-processing idempotent.

Throwaway docker stack (network `convlog-v3-net`, containers `convlog-v3-{pg,mongo,app}`, image `convlog-v3:test`) torn down after the run.

## Current State (2026-05-27)

- Last compaction: `SDD/orchestration/compacted/compact-2026-05-27_11-07-08.md`
- Working on: SPEC-016 conv-log — implementation COMPLETE; pre-merge validation done (CRI-10 fix + V-6 PASS + scoped V-3 PASS).
- Commits on `feature/016` (unpushed, no remote branch yet): `e4136a232` (implementation), `dd2498a20` (CRI-10 fix + V-6), `a229f6809` (compaction record).
- **Uncommitted working-tree change:** `conv-log/src/index.ts` pino-redact boot-blocker fix (see V-3 section above) — needs to be committed to `feature/016`.
- Next step: commit the redact fix, then push `feature/016` + merge to `pablo` (ASK before pushing — project convention). Remaining V-5/provisioning/.env.prod and post-merge V-1/V-2/V-4/V-7/V-8 need real env/credentials.
