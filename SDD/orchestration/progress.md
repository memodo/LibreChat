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

## Merge to pablo (2026-05-28)

- Redact fix committed on `feature/016` as `adb60d79b` and pushed to `origin/feature/016`.
- Operator (user) merged `feature/016` → `pablo`; conflicts in shared overlay files (monitoring/compose/.env.example) resolved manually. Merge commit `ad34f84b9` ("Conflict resolution.") with parents `a00c6ed9b` (pre-merge pablo) + `adb60d79b` (feature/016 tip).
- Pushed to `origin/pablo` (pablo == origin/pablo at `ad34f84b9`).
- Post-merge integrity spot-check on pablo: all 25 conv-log files present; `conv-log/src/index.ts:382` redact line is the fixed form (not `*Uri`); `monitoring/prometheus/alerts.yml` retains `ConvLogSyncLagBreach`; `prometheus.yml` retains the conv-log scrape target; both compose files retain the conv-log service block; `.env.example` CONVLOG block byte-identical to feature/016 (24 lines, commented templates); Dockerfile pinned digest preserved.

## Prod provisioning attempt + two more bugs found (2026-05-29)

Operator started the provisioning ceremony on prod and hit `mongosh: command not found`. Investigation found two issues — same pattern as the pino-redact boot bug: prior gates (tests, code review, critical review) never executed the operator path end-to-end, so structural defects in `conv-log/ops/provision-*.sh` survived all the way to first prod use.

### Bug 1 — `provision-postgres.sh`: CREATE DATABASE in a DO block
The original `provision-postgres.sh` wrapped `CREATE DATABASE convlog` inside a `DO $$ ... $$;` PL/pgSQL block. PL/pgSQL DO blocks are implicitly transactional, and Postgres refuses `CREATE DATABASE` inside any transaction: `ERROR: CREATE DATABASE cannot run inside a transaction block`. The script failed 100% of the time on any environment — the roles got created (CREATE ROLE *is* legal in a transaction) but the database never did, and the second psql call to `/convlog` then failed because the database didn't exist. Fix: `SELECT 'CREATE DATABASE convlog' WHERE NOT EXISTS (...) \gexec` — `\gexec` runs the resulting DDL as a top-level statement (no transaction) only when the database is absent. Same idempotency property preserved.

### Bug 2 — provisioners assumed host-installed mongosh / psql
Prod Mongo runs in a container with `ports: !override []` in `docker-compose.prod.yml` (per `project_prod_deployment` memory) — intentionally not exposed to the host. Postgres is analogous (also containerized, since the Hetzner Cloud Firewall outbound rules don't include TCP 5432). The provisioning scripts called `mongosh "$MONGO_ADMIN_URI"` and `psql "$PG_ADMIN_URI"` from the host, so they couldn't even *connect* to the prod DBs, much less run the DDL. Fix: optional `MONGO_PROVISION_CONTAINER` and `PG_PROVISION_CONTAINER` env vars route the same mongosh/psql calls through `docker exec -i <container>`. Unset → host mode (unchanged, backwards-compatible with local dev). Discovery command for prod operator: `docker ps --format '{{.Names}}\t{{.Image}}' | grep -iE 'mongo|postgres'`.

### Smoke-test gate (NEW — applied to both scripts)
Both fixes were smoke-tested end-to-end against throwaway `mongo:7` + `postgres:16-alpine` containers in docker-exec mode:
- `convlog_reader` Mongo user created with `{role:'read', db:'LibreChat'}`; auth works; INSERT denied (`Unauthorized`) — REQ-056 enforced.
- `convlog` Postgres database + `convlog_writer` + `convlog_reader` roles created; writer can CREATE TABLE and INSERT; reader can SELECT (default privileges work after the first writer-owned table is created) but cannot INSERT (`permission denied for table smoke`) — REQ-057 enforced.
- Idempotency: postgres re-run succeeds (CREATE DATABASE skipped via WHERE NOT EXISTS, DO blocks swallow `duplicate_object`); mongo re-run errors with "User already exists" as documented.
- Audit log entries now annotated with `(via docker exec <container>)` or `(via host mongosh|psql)` so post-hoc the operator can tell which path ran.

### README updates
- `.env.provisioning` template now shows the two optional container vars with discovery instructions.
- Idempotency subsection: noted that on dockerized hosts the manual `dropUser` snippet needs to wrap mongosh in `docker exec -i $MONGO_PROVISION_CONTAINER`.

### Process insight
Adding to the "redact" lesson: the operator path (provisioning + boot) is exactly the surface that needs a runtime smoke gate before declaring an SDD service deploy-ready, because module-level tests + code review + critical review don't exercise it. For SPEC-016 the empirical pattern is now: every bug discovered post-completion (redact, CREATE DATABASE, host-vs-docker) would have been caught by running the actual operator commands against throwaway infra before merge.

## Current State (2026-05-29)

- SPEC-016 conv-log merged to `pablo` and on `origin/pablo`. Both provisioning scripts now smoke-tested end-to-end in docker-exec mode.
- Outstanding (operator on prod): `git pull` pablo → set `MONGO_PROVISION_CONTAINER` + `PG_PROVISION_CONTAINER` in `.env.provisioning` (discover names via `docker ps`) + re-run provisioners → populate `.env.prod` CONVLOG block → CRI-10 pre-flight on `guardrailevents` → `./prod.sh up -d conv-log` → V-1, V-2, V-3-realenv, V-4, V-6, V-7, V-8 + ConvLogSyncLagBreach alert routing confirmation (ADR 0003).
- Deferred: V-5 upgrade-portability smoke runs on next upstream LibreChat merge (REQ-T-2 drift gate = `npx vitest run tests/field-mapping-drift.test.ts` from `conv-log/`).
- Branch hygiene: `feature/016` (local + `origin/feature/016`) safe to delete once prod is green.

---

# SPEC-017 — Grafana dashboards for conv-log analytical store + operational metrics

## Flow Orchestration State (2026-06-01)

- **Feature:** `grafana-conv-log-dashboards` (`[###]=017`).
- **Invocation:** `/sdd-flow` with the brief now persisted at `SDD/GRAFANA_FOR_CONV_LOG.md` (verbatim task brief, commit `5c0b6ad93`).
- **Execution mode:** AUTONOMOUS (user-selected). No phase-boundary checkpoints; runs research -> planning -> implementation -> done.
- **Step 0 (Scope Assessment):** Single SDD cycle, no decomposition. Rationale: change confined to `monitoring/` provisioning + docs (REQ-072 hold-over forbids `/api`, `/packages/*`, `/client`); user pre-declared `delivery_mode: whole-feature`; deliverables (2 dashboards + 1 datasource + docs) are one coherent monitoring-stack unit with no independent user-facing behaviors warranting separate delivery.
- **Step 1.5 (Clarification gate):** SKIPPED by user (equivalent to `--skip-clarify`). The existing `SDD/GRAFANA_FOR_CONV_LOG.md` brief is treated as the externalized design concept. Gate-skip must be recorded in the Step 2c critical-review executive summary (Design Concept Fidelity block -> note no CLARIFICATION artifact exists).
- **Suggested numbering confirmed free:** `RESEARCH-017` and `SPEC-017` both unused.
- **Target frontmatter (from brief):** `delivery_mode: whole-feature`, `review_panel: false`, `eval_required: false` -> panel review (3c) and eval scaffold (4g) expected skipped pending the planning subagent's actual frontmatter values.

## Phase: Research - STARTED (Step 2a)
- Research subagent (research-start) spawned with Read trigger tuned to 18 (brief enumerates ~13 files; deep reads needed for metric/schema/panel-JSON fidelity), nested-subagent trigger 4.

### Step 2a — research subagent run (2026-06-01)
- **Artifact written:** `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md` (complete; enables spec authoring without further system investigation).
- **Files read (7 distinct + git/grep via bash):** `SDD/GRAFANA_FOR_CONV_LOG.md`, `monitoring/docker-compose.monitoring.yml`, `conv-log/src/index.ts`, `monitoring/grafana/provisioning/datasources/prometheus.yml`, `monitoring/grafana/provisioning/dashboards/dashboards.yml`, `conv-log/migrations/001_init.sql`, `conv-log/README.md`, `monitoring/prometheus/alerts.yml`, `monitoring/grafana/provisioning/dashboards/mongodb.json`, `monitoring/grafana/provisioning/dashboards/service-overview.json`; bash: `git show 337c39ac8`, `.env.example` convlog block, `SPEC-016` NFR-2, `provision-postgres.sh` grants. (Read trigger NOT tripped — well under 18; no nested subagents.)
- **Stack facts pinned:** Grafana `11.5.2`, dashboard JSON `schemaVersion: 38`; datasource provisioning uses `${ENV_VAR}` substitution; provider config `type:file`, scans `/etc/grafana/provisioning/dashboards`, `foldersFromFilesStructure:false`, `allowUiUpdates:true`.
- **11 metrics enumerated** with exact type + labels (2 histograms: `convlog_batch_duration_seconds`, `convlog_erasure_chunk_deleted_ratio` — `_bucket`/`_sum`/`_count` confirmed); definitive metric->panel->PromQL mapping table produced; `up{job="conv-log"}` is the 12th (Prometheus-synthetic) — resolves the 11-metrics/12-bullets mismatch.
- **Postgres schema** captured per-table; flagged that `messages_log` has NO `agent_name` (join via `model_or_agent_id -> agents_dim.name`) and `conversations_dim` has NO `started_at`/`last_activity`/`message_count` (must derive).
- **5 V-6 queries** captured verbatim + Grafana format notes; all reproducible.
- **Datasource credential recommendation:** Option (A) dedicated `GRAFANA_CONVLOG_DB_PASSWORD` via `secureJsonData.password:${VAR}` (compose cannot decompose `CONVLOG_PG_READ_URI` without a shim). Add to `.env.prod`/`.env.example`/`.env.prod.template` + grafana service `environment:`.
- **Security boundary recommendation:** default panels = counts/IDs/dimensions only; raw `text`/`title` in a single collapsed drill-down row (collapsed:true). OSS Grafana has no per-panel RBAC; boundary is design-level.
- **Deploy path:** config-only — git push + prod git pull + `docker compose up -d grafana` recreate; NOT prod-sync.sh, NOT api restart, Prometheus unaffected.
- **DISCREPANCIES carried as spec risk:** (1) sync-lag threshold — brief 600s is the NFR-2 *SLO*, deployed alert fires at **3000s** (`max(10xinterval,900)`); show BOTH lines. (2) error `phase` labels differ README-vs-code — use `sum by(phase)`, don't hardcode. (3) **BLOCKER:** brief claims Grafana on `librechat_default`, but compose shows `monitoring`+`caddy_net` only -> Grafana CANNOT reach `vectordb:5432`; spec MUST add `librechat_default` to the grafana service `networks:`. (4) bind-mount — Grafana ALREADY uses directory mount, NO action (resolves brief's "apply if not already").
- **Open questions for spec:** OQ-1 recent-conversations `title` tension (brief lists it as default column yet flags titles PII -> recommend title in drill-down only); OQ-2 derived conversation columns; OQ-3 collapsed-row vs separate-tagged drill-down dashboard.
- **No glossary edits** (deferred to research-complete per instruction); no ADR triggered (no system-binding tech choice).

### Step 2a (second pass) — RESEARCH-COMPLETE subagent run (017-grafana-conv-log-dashboards) — 2026-06-01

Research phase complete. `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md` finalized and validated against the research-complete completeness checklist. No structural gaps — all required sections were present from the research-start pass; this pass sharpened precision and resolved open questions.

**Verified against deployed source (5 source-file reads):**
- DISCREPANCY-3 (BLOCKER) CONFIRMED: `docker-compose.monitoring.yml:134-136` — grafana service is on `monitoring` + `caddy_net` ONLY, not `librechat_default`. Pinned the fix shape: add the single line `- librechat_default` to the grafana `networks:` list; the network is ALREADY declared external at `:259-261` (no new top-level decl). Confirmed `vectordb` lives on `librechat_default` via the postgres-exporter precedent (`:203,216-218`).
- DISCREPANCY-1 CONFIRMED: `alerts.yml:177-190` — `ConvLogSyncLagBreach` fires at literal `scalar(vector(3000))`, AND-gated `pending>0`, `for: 15m`. Dashboard A must render BOTH lines (600s SLO + 3000s alert).
- DISCREPANCY-2 (error/dead-letter phase divergence) and the 11-metric/12-panel reconciliation + mapping table were already crisp; no change needed. `sum by (phase)(rate(...))` confirmed as the robust label-driven form.

**Open questions resolved:** OQ-1 (title-PII) — default panel drops `title`, lives in drill-down; small DPO DEFER if titles later classified surfaceable. OQ-2 (derived columns) — `conversations_dim` has NO `started_at`/`last_activity`/`message_count`; DERIVE via MIN/MAX/COUNT over `messages_log` (do not approximate with dim upsert timestamps). OQ-3 (drill-down location) — single collapsed row in Dashboard B (rejected separate tagged dashboard); governance DEFER only if audit policy later demands physical separation.

**Glossary:** INCREMENTAL update applied to `SDD/UBIQUITOUS_LANGUAGE.md` — new "Observability & dashboards (SPEC-017)" section: operational dashboard (Dashboard A), analytics dashboard (Dashboard B), `convlog_reader` datasource, `GRAFANA_CONVLOG_DB_PASSWORD`, sync-lag SLO line, drill-down row, default-privacy panel. All SPEC-014 stable terms preserved.

Ready for /planning-start (SPEC-017-grafana-conv-log-dashboards). Frontmatter: delivery_mode whole-feature, review_panel false, eval_required false; no ADR triggered.

Artifacts updated: SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md, SDD/UBIQUITOUS_LANGUAGE.md, SDD/orchestration/progress.md, SDD/orchestration/counters/2a-2-2026-06-01_09-43-00.md.

### Step 2b — ADR-CAPTURE subagent run (RESEARCH-017 hand-off) — 2026-06-01

**Result: NO-OP — no ADRs written.**

Candidates evaluated:
- Grafana as analytical/observability surface (vs Metabase): FAIL scope test. Grafana/Prometheus/Postgres are pre-existing stack components; this feature extends the existing tool, not a binding go-forward convention. Research doc explicitly states "no ADR triggered."
- Datasource credential strategy (dedicated env var vs URI parsing): FAIL scope test. Explicitly called out in the research doc as feature-local, not system-binding.
- All other candidates (env-var name, panel layout, PromQL forms, schemaVersion): FAIL — feature-scoped implementation details.

No ADR files written. SDD/adr/ unchanged.

### Step 2c — RESEARCH CRITICAL REVIEW subagent run (017-grafana-conv-log-dashboards) — 2026-06-01

**Verdict: REVISE BEFORE PROCEEDING. Severity HIGH.** Adversarial critical review of `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md` against the brief (`SDD/GRAFANA_FOR_CONV_LOG.md`) and glossary. **Gate-skip recorded in the review's executive summary:** no `CLARIFICATION-017` artifact; `/research-clarify` was explicitly skipped; fidelity assessed against the brief's Scope-IN/Constraints/Success-Criteria instead — no Scope-IN item silently dropped.

**Findings: 1 HIGH, 4 MEDIUM, 1 LOW.**
- **HIGH** — `convlog_reader` may have NO SELECT on Dashboard B's tables. `provision-postgres.sh:101-102` uses `ALTER DEFAULT PRIVILEGES` WITHOUT `FOR ROLE convlog_writer`, but the schema/tables are owned by `convlog_writer` (`:97`, migration runner creates DDL `:8-9`). Repo-wide grep finds no `GRANT SELECT ON ALL TABLES` / `FOR ROLE` anywhere. The success-criterion check runs as the **rag superuser**, so validation would MASK the failure. Datasource "Save & test" passes on CONNECT alone. Research asserts reader-SELECT as fact (line 162) — unverified.
- **MEDIUM** — OQ-1 DPO title-classification is a soft DEFER but is a real gate (brief lists `title` as a default column; research overrides on privacy judgment with no active DPO ask).
- **MEDIUM** — `secureJsonData ${ENV_VAR}` interpolation claim (line 159) asserted without citation; no in-repo precedent for `secureJsonData` interpolation; pivot of the credential decision.
- **MEDIUM** — Validation is prod-gated; success criteria not partitioned pre-deploy vs prod-only; "Save & test passes" criterion misleading (CONNECT != SELECT).
- **MEDIUM** — `dead_letter_log.raw` (JSONB, raw failed doc = PII) not flagged; dead-letter inspector is a default-visible panel; research schema table omits `raw`.
- **LOW** — "authoritative" schema table is incomplete (`archived`, `tags`, `user_id`, `raw` omitted); minor "analytical" vs glossary-mandated "analytics dashboard" drift.

**Verified-correct (no gap):** DISCREPANCY-3 network blocker (grafana on `monitoring`+`caddy_net` only at `:134-136`; `librechat_default` external at `:259-261`; fix = add one line) accurately contradicts the brief; DISCREPANCY-1 3000s alert (`alerts.yml` expr/for:15m verified); 11-metric typing + histogram_quantile forms verified against `index.ts:90-153`; OQ-2 derived columns verified against `001_init.sql`.

Review written: `SDD/reviews/CRITICAL-RESEARCH-grafana-conv-log-dashboards-20260601.md`.

### Step 2d — RESEARCH FIX subagent run (017-grafana-conv-log-dashboards) — 2026-06-01

All 6 findings from the critical review resolved in `SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md`. "Findings Addressed" section appended to `SDD/reviews/CRITICAL-RESEARCH-grafana-conv-log-dashboards-20260601.md`.

**HIGH finding verdict (definitive):** `convlog_reader` has NO SELECT on the analytical tables as currently provisioned. Evidence: `provision-postgres.sh:101-102` runs `ALTER DEFAULT PRIVILEGES` as admin with NO `FOR ROLE convlog_writer`; migration runner connects via `CONVLOG_PG_URI` = `convlog_writer` (`index.ts:65,394,407`; `.env.example:951`) so tables are writer-owned. The `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` covers only objects created by the admin — not `convlog_writer`. Smoke test at `progress.md:290` ("default privileges work") is a false positive: smoke `CREATE TABLE` was likely issued as admin, not as `convlog_writer`. Corrective DDL required by spec: (1) `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` (operator one-time or added to `provision-postgres.sh`) + (2) fix `provision-postgres.sh:101-102` to `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;`.

**Other findings resolved:** OQ-1 elevated to SPEC OPEN-DECISION with mandatory owner sign-off (not passive defer); validation section partitioned pre-deploy vs prod-only with reader-scoped SELECT gate added; `secureJsonData ${VAR}` claim documented with Grafana 11.x precedent and container-env requirement; `dead_letter_log.raw` added to PII-gated inventory; schema table relabeled non-exhaustive and completed with missing columns; "analytical dashboard" → "analytics dashboard" drift fixed.
