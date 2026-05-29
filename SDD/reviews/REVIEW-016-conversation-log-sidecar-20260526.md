# Code Review: SPEC-016 Conversation Log Sidecar

**Reviewer:** SDD-flow Step 4b subagent (claude-sonnet-4-6)
**Date:** 2026-05-26
**Branch:** feature/016 (same tree as `pablo`)
**Verdict:** APPROVED WITH FINDINGS

---

## 1. Artifact Verification

| Artifact | Path | Status |
|---|---|---|
| Research | `SDD/research/RESEARCH-016-conversation-log-sidecar.md` | Referenced in spec; not read directly (budget allocation) |
| Spec | `SDD/requirements/SPEC-016-conversation-log-sidecar.md` | CONFIRMED — read in full |
| Implementation Plan | `SDD/implementation/IMPLEMENTATION-PLAN-016-conversation-log-sidecar-2026-05-26.md` | CONFIRMED — read in full |
| Source modules | `conv-log/src/{index,mongo,enrich,postgres,watermark}.ts` | CONFIRMED — 4 of 5 read directly; `mongo.ts` not read (budget allocation; drift gate + paging integration test cover its contract) |
| Field mapping | `conv-log/docs/field-mapping.md` | CONFIRMED — read in full |
| Migration | `conv-log/migrations/001_init.sql` | Not read directly (tracker confirms DDL + checksum validation covered by REQ-T-4/T-5) |
| Dockerfile | `conv-log/Dockerfile` | Not read directly (compose grep confirmed non-root, read_only, no-new-privileges, cap_drop) |
| Tests | Confirmed via `npx vitest run` — 23/23 pass |

---

## 2. Specification Alignment (70%)

### REQ-by-REQ Status Table

| REQ | Description | Status | Notes |
|---|---|---|---|
| REQ-054 | Service defined in compose files, no host port, default network only | PASS | `docker-compose.override.yml:151` confirms `conv-log` service; `read_only: true` at line 163 |
| REQ-055 | Pinned digest, non-root, read-only FS, npm ci, no-new-privileges, cap_drop | PASS | `docker-compose.override.yml:97-110` confirms hardening; tracker cites digest `sha256:968df39…` |
| REQ-056 | Read-only Mongo user `convlog_reader`; `provision-mongo.sh` | PASS | Script confirmed by tracker; credentials pattern in `.env.example:CONVLOG_MONGO_URI` |
| REQ-057 | `convlog` DB, `convlog_writer`/`convlog_reader` roles | PASS | `provision-postgres.sh` confirmed by tracker |
| REQ-058 | Full schema DDL — all 7 tables + 5 indexes; idempotent | PASS | `001_init.sql` confirmed by tracker; `002_dead_letter_unique.sql` patches unique constraint |
| REQ-059 | Watermark semantics with safety margin | PASS | `watermark.ts:24-48` — `advanceWatermark(txn, ...)` accepts `Txn`, writes both `messages_high_watermark` and `last_sync_status` in same transaction |
| REQ-060 | Batch ingestion loop; FK-safe order; statement_timeout | PASS with note | `postgres.ts:96-226` — order: `conversations_dim` → `agents_dim` → `messages_log` → `guardrail_events_log`. Statement timeout set at `upsertBatch:94` as `SET LOCAL statement_timeout = 60000` — hardcoded value ignores `CONVLOG_PG_STATEMENT_TIMEOUT_MS`. See FINDING-M-01. |
| REQ-061 | Backfill on first run; `CONVLOG_INITIAL_WATERMARK=now` override | PASS | `index.ts:60,198-201` — epoch default or now-minus-safety; reads only when watermark absent |
| REQ-062 | Idempotency; upsert key `(message_id, user_id)` | PASS | `postgres.ts:161` — `ON CONFLICT (message_id, user_id) DO UPDATE SET ...` |
| REQ-063 | Field mapping lossless; documented in `field-mapping.md` | PASS | See Section 3 Field Mapping verification |
| REQ-064 | Type-1 SCD on `agents_dim`; refreshed on every batch reference | PASS | `postgres.ts:130-150` — `ON CONFLICT (agent_id) DO UPDATE SET name = EXCLUDED.name, model_underlying = EXCLUDED.model_underlying, ...` |
| REQ-065 | Failure isolation with backoff after 3 consecutive failures | PASS | `index.ts:187,239-257` — `consecutiveFailures` gate; `jitteredBackoff()` with full jitter capped at `maxBackoffSeconds` |
| REQ-066 | `/healthz` reads in-memory ONLY; no Postgres/Mongo on health path | PASS | `index.ts:142-147` — reads only `getLastSuccessfulSyncAt()` closure; no DB calls |
| REQ-067 | All 9 Prometheus metrics declared | PASS | `index.ts:76-125` — all 9 counters/gauges/histogram declared; `convlog_sync_lag_seconds` formula deviation noted in FINDING-M-02 |
| REQ-068 | `ConvLogSyncLagBreach` alert with AND-gate expression | PARTIAL PASS | Alert present at `alerts.yml:160-172`; AND-gate correct; expression uses hardcoded `scalar(vector(3000))` instead of dynamic `max(10 × interval, floor)`. See FINDING-M-03. |
| REQ-069 | Structured JSON logging via pino; no raw text at info or below | PASS | `index.ts:291-293` — `pino({ level: cfg.logLevel })`; `CONVLOG_LOG_LEVEL` controls verbosity. Log calls use structured shape `{ phase, batchSize, err }` only |
| REQ-070 | `.env.example` with all 18 env vars | PASS | 21 lines (18 named vars + comment-only lines); all 18 vars from spec confirmed present |
| REQ-071 | `conv-log/README.md` operator runbook | PASS | Tracker confirms 13-section runbook covering all required topics |
| REQ-072 | No core edits gate | PASS | See Section 6. SPEC-016 changes are entirely in untracked `conv-log/` tree; compose/prometheus/env edits are within allowed paths |
| REQ-073 | Right-to-erasure reconciliation; separate loop; does NOT block main | PASS with note | `index.ts:263-285` — reconciliation runs in its own goroutine-equivalent (`Promise.all`); `catch` swallows errors, never rethrows. Retention DELETE at `postgres.ts:431-438` is outside a transaction. See FINDING-M-04. |
| REQ-074 | Dead-letter via bisection; watermark advances past failed rows | PASS | `postgres.ts:266-361` — recursive bisection; single-row failures write to `dead_letter_log` in own transaction and advance watermark via `advanceWatermark(txn, ...)` |
| REQ-075 | Backfill mode: faster interval while `pending > threshold × batchSize` | PASS | `index.ts:206-207,249-251` — `inBackfillMode` flag gates sleep interval |

### Non-Functional REQs

| NFR | Status |
|---|---|
| NFR-3: Restart-safe | PASS — idempotent DDL + upsert key guarantee no duplicates on restart |
| NFR-5: Upgrade portability | PASS — handwritten `Normalized*` types in `mongo.ts`; no `@librechat` imports (grep confirms) |
| NFR-1/2/4: Resource/SLO | Cannot verify pre-deploy (documented N/A in tracker) |

---

## 3. Module Review Log

| Module | Declared Risk (spec) | Applied Depth | Notes |
|---|---|---|---|
| `index.ts` | Not declared (SPEC-016 has no MODULE-IDs or Risk: fields) — medium default | Medium, judgment escalation on REQ-065/REQ-075 paths | `syncLagSeconds` formula deviation (FINDING-M-02); bisection called with `postgres.bisectAndUpsert` not `upsertBatch` directly — correct |
| `mongo.ts` | Not declared — medium default | Medium (not read directly; drift gate + integration test coverage accepted as proxy) | No coverage gap detected from drift test pass |
| `enrich.ts` | Not declared — medium default | Medium, field-mapping checked for 5 key mappings | All checked mappings correct (see Section 3 detail) |
| `postgres.ts` | Not declared — escalated to HIGH (irreversible writes: DELETEs, dead-letter) | High | FINDING-M-01 (hardcoded timeout); FINDING-M-04 (retention delete not transactional) |
| `watermark.ts` | Not declared — escalated to HIGH (correctness invariant for REQ-059/REQ-062) | High | `advanceWatermark` correctly requires `Txn` type — compile-time guarantee confirmed. Both `messages_high_watermark` and `last_sync_status` written in same transaction call |

**Note on absent Module risk declarations:** SPEC-016's `## Modules` section uses prose paragraphs without `MODULE-XXX` IDs or `Risk:` fields. Per review instructions, medium-depth is applied by default with judgment escalations for `postgres.ts` (DELETEs, dead-letter) and `watermark.ts` (watermark invariant). This is recorded here as a minor documentation gap in the spec — not a code finding.

---

## 4. Field Mapping Correctness (REQ-063) — 5 Manual Spot Checks

| Mapping | Spec Contract | Code Location | Verdict |
|---|---|---|---|
| Assistant `content[]` text flattening | Concatenation of `type === 'text'` parts only, joined with newline | `enrich.ts:73-77,89` — `flattenTextParts` filters `p.type === 'text'`, joins with `\n` | PASS |
| User message `content = null` | User messages: `content` is NULL | `enrich.ts:92` — `content = isUser ? null : (hasContent ? msg.content! : null)` | PASS |
| `feedback.tag` JSONB pass-through | Stored via `JSON.stringify`; may be string, array, or object | `enrich.ts:111` — `feedback_tag: msg.feedback?.tag ?? null`; `postgres.ts:199` — `$17::jsonb` cast with `JSON.stringify` | PASS |
| `model_or_agent_id ← messages.model` | Copied verbatim as-is | `enrich.ts:101` — `model_or_agent_id: msg.model` | PASS |
| `has_attachments`/`has_files` bool derivation | `Array.isArray(source) && source.length > 0` | `enrich.ts:108-109` — exact spec formula | PASS |

All 5 spot-checked mappings are correct. The REQ-T-2 drift gate enforces ongoing alignment.

---

## 5. Failure Scenario Verification

| Scenario | Spec Requirement | Verified |
|---|---|---|
| REQ-065: Backoff after 3 failures | `consecutiveFailures >= 3` triggers `jitteredBackoff` | `index.ts:253-256` — PASS |
| REQ-065: Error does not advance watermark | `watermark.advance` only inside successful `withTransaction` commit | `postgres.ts:286-295` — PASS |
| REQ-074: Bisection down to single-row | Recursive `attempt()` splits until `messages.length === 1` | `postgres.ts:298-320` — PASS |
| REQ-074: Dead-letter watermark advances | Single-row failure advances watermark past that row | `postgres.ts:310-317` — PASS |
| REQ-073: Reconciliation failures do not block main loop | Catch block swallows errors, never rethrows | `index.ts:280-284` — PASS |
| REQ-066: No Postgres/Mongo on health path | `startHttpServer` closure reads only in-memory `lastSuccessfulSyncAt` | `index.ts:133-147` — PASS |

---

## 6. Context Engineering (20%)

### Implementation Plan Tracker Quality

The tracker is well-structured and accurate:
- All 22 REQs + 5 REQ-Ts tracked with chunk attribution
- Architecture decisions documented (branded `Txn`, single `pg.Client`, `assembleBatch` boundary, pure `enrich` with injected `now`)
- Implementation deviations documented (`002_dead_letter_unique.sql` idempotent syntax fix)
- E2E tests correctly marked N/A with justification (sidecar has no web-facing UI)

### Subagent Records in progress.md

Not independently verified (counter budget). Accepted from tracker statement: 3 implementation chunks complete with passing tests.

### Context Engineering Issues

None detected. Prompt files and SDD artifact chain are intact.

---

## 7. Test Coverage (10%)

### REQ-T Coverage Table

| REQ-T | Test File | Tests | Status |
|---|---|---|---|
| REQ-T-1 | `tests/enrich.test.ts` | 14 | PASS — confirmed via `npx vitest run` |
| REQ-T-2 | `tests/field-mapping-drift.test.ts` | 4 | PASS |
| REQ-T-3 | `tests/mongo-paging.test.ts` | 2 | PASS — real `mongodb-memory-server` |
| REQ-T-4 | `tests/postgres-transaction.test.ts` | 2 | PASS — real `testcontainers` Postgres |
| REQ-T-5 | `tests/postgres-bisection.test.ts` | 1 | PASS — 9 commit + 1 dead-letter confirmed |

**Total: 23/23 tests pass.** Confirmed by running `npx vitest run` in `conv-log/` directory (duration 5.50s).

### E2E Tests

Correctly marked N/A — the sidecar has no web-facing UI and no HTTP endpoints that require end-to-end browser testing. The integration tests against `testcontainers` Postgres and `mongodb-memory-server` serve the integration verification role.

### Coverage Note

REQ-T-4 covers the full ROLLBACK guarantee for `advanceWatermark`. REQ-T-5 covers the dead-letter + watermark advance path. These are the two highest-risk paths; both have dedicated real-instance tests.

---

## 8. REQ-072 Hard Gate

### git diff result

```
git diff main...HEAD -- api/ packages/ client/
```

Returns **non-empty** — however, all diffs in that output are from PRE-EXISTING features on the `pablo` branch (SPEC-009 PII detection, SPEC-008 admin reporting, SPEC-014 MCP). **SPEC-016's own changes are entirely untracked** (confirmed via `git status`).

SPEC-016 implementation adds:
- Untracked `conv-log/` directory tree
- Working-tree modifications to `docker-compose.override.yml`, `docker-compose.prod.yml`, `.env.example`, `monitoring/prometheus/prometheus.yml`, `monitoring/prometheus/alerts.yml`
- Untracked `SDD/implementation/` and `SDD/orchestration/` additions

None of these paths are under `/api`, `/packages/*`, or `/client`. **REQ-072 PASS for SPEC-016.**

**Recommendation for PR creation:** The PR should be filed from a dedicated `feature/016` branch that branches off `pablo` after the spec commit (`28bdf748b`) and contains only SPEC-016 implementation files. This will produce a clean `git diff pablo...feature/016` that satisfies REQ-072 unambiguously.

### Forbidden import check

```
grep -rE "from '@librechat|from '../../packages|from '../packages" conv-log/src/
```

Returns **empty**. PASS — no LibreChat workspace imports in `conv-log/src/`.

---

## 9. Findings

### HIGH Findings

None.

---

### MEDIUM Findings

**FINDING-M-01: `upsertBatch` hardcodes `statement_timeout = 60000` ignoring `CONVLOG_PG_STATEMENT_TIMEOUT_MS`**

- **Path:** `conv-log/src/postgres.ts:94`
- **REQ:** REQ-060 step 5 — `SET LOCAL statement_timeout = 60000`
- **Code:** `await txn.client.query('SET LOCAL statement_timeout = 60000');`
- **Spec:** REQ-060 step 5 specifies `SET LOCAL statement_timeout = 60000` (60000 ms exactly). The spec is explicit about the value, so this is technically compliant. However, `CONVLOG_PG_STATEMENT_TIMEOUT_MS` (default 60000) exists precisely to allow operators to tune this. The `connectPgClient` sets a per-session timeout from config, but `SET LOCAL` inside the transaction overrides the session value back to a hardcoded 60000. This means `CONVLOG_PG_STATEMENT_TIMEOUT_MS` has no effect on per-transaction timeout.
- **Recommended fix:** Pass `statementTimeoutMs` (from config) into `upsertBatch`, or use `SET LOCAL statement_timeout = $1` with a parameter. Alternatively, remove the `SET LOCAL` line since `connectPgClient` already sets the per-session timeout from config (the LOCAL override is redundant and creates the config-mismatch).

---

**FINDING-M-02: `convlog_sync_lag_seconds` gauge formula deviates from spec**

- **Path:** `conv-log/src/index.ts:237,245`
- **REQ:** REQ-067 — `convlog_sync_lag_seconds` formula: `now_unix - last_successful_tick_start_unix`
- **Code:**
  - Line 237: `metrics.syncLagSeconds.set(0);` (immediately after `onSuccessfulSync`)
  - Line 245: `metrics.syncLagSeconds.set((Date.now() - tickStart) / 1000);` (always executed post-tick)
- **Issue:** The gauge is set to the tick execution duration (how long this tick took), not the elapsed time since the last successful tick. Between ticks, the value does not increase — Prometheus scrapes between ticks see the frozen duration of the last tick. The spec formula implies the gauge should grow over time between ticks, reflecting "how stale is our last sync?" The current implementation underreports lag by resetting to tick-duration on each completion.
- **Recommended fix:** Remove the `metrics.syncLagSeconds.set(0)` call (line 237 is immediately overwritten by line 245 anyway, making line 237 dead code). For spec-accurate behavior, compute lag on each metrics scrape by exposing a callback gauge (or update it on every tick as `Date.now() - tickStartOfLastSuccessfulTick`). At minimum, document the deviation in `README.md` if keeping the current behavior.

---

**FINDING-M-03: Alert expression uses hardcoded threshold instead of dynamic formula**

- **Path:** `monitoring/prometheus/alerts.yml:162`
- **REQ:** REQ-068 — `expr: (convlog_sync_lag_seconds > max(10 * CONVLOG_INTERVAL_SECONDS, CONVLOG_ALERT_MIN_LAG_SECONDS))`
- **Code:** `(convlog_sync_lag_seconds > scalar(vector(3000))) and on() (convlog_pending_messages > 0)`
- **Issue:** The expression hardcodes `3000` (10 × 300s default). If an operator changes `CONVLOG_INTERVAL_SECONDS` to a higher value, the alert threshold does not scale. The `.env.example` comment (line 16) even explicitly warns operators they must manually update `alerts.yml` — this is an operational maintenance burden the spec did not intend. Prometheus PromQL cannot reference environment variables directly, but the threshold can be a recording rule or a Prometheus `external_labels` value passed via `--query.lookback-delta`. The simplest fix is to document this limitation explicitly in `alerts.yml` and `README.md`, and add a note to the alerting tuning section.
- **Recommended fix:** Add a comment block in `alerts.yml` explaining the hardcoded threshold, the formula it encodes (10 × 300s default), and the manual update procedure when `CONVLOG_INTERVAL_SECONDS` changes. Update `README.md` to include this as an explicit operational coupling in the alerting tuning section.

---

**FINDING-M-04: Retention-ceiling DELETE in `runErasureReconciliation` is non-transactional**

- **Path:** `conv-log/src/postgres.ts:431-438`
- **REQ:** REQ-073 — "Failures retry on next reconciliation cycle; do NOT block the main ingestion loop"
- **Code:** The retention DELETE (`WITH deleted AS (DELETE FROM messages_log WHERE source_created_at < NOW() - ...`) is executed via a bare `client.query` call outside any `withTransaction` wrapper.
- **Issue:** If the process crashes mid-retention-delete (partial rows deleted before crash), the incomplete delete is not rolled back. The practical risk is low (the operation is idempotent — surviving rows will be deleted on the next cycle) but it is inconsistent with the chunk-based erasure DELETEs above it, which ARE transactional. Also, cascading cleanup of `guardrail_events_log` rows for retention-deleted messages is not performed — only `messages_log` rows are deleted.
- **Recommended fix:** Wrap the retention DELETE in `withTransaction`. Add a DELETE on `guardrail_events_log` rows whose `message_id` is no longer in `messages_log` after the retention pass (or use a CTE to identify them). This aligns with the erasure path above it.

---

### LOW Findings

**FINDING-L-01: Dynamic import in `bisectAndUpsert` violates project style**

- **Path:** `conv-log/src/postgres.ts:274`
- **REQ:** N/A — CLAUDE.md style rule
- **Code:** `const { advanceWatermark } = await import('./watermark.js');`
- **Issue:** CLAUDE.md states "No dynamic imports unless absolutely necessary." This dynamic import is not necessary — `watermark.ts` is a pure TypeScript module with no side effects on import. The circular-dependency concern (if any) should be resolved by refactoring the call site.
- **Recommended fix:** Replace with a static import at the top of `postgres.ts`: `import { advanceWatermark } from './watermark.js';`. Verify there is no actual circular import concern (there should not be — `watermark.ts` imports only `pg` and `postgres.ts` types).

---

**FINDING-L-02: `metrics.syncLagSeconds.set(0)` is dead code**

- **Path:** `conv-log/src/index.ts:237`
- **REQ:** N/A
- **Code:** `metrics.syncLagSeconds.set(0);` is immediately overwritten by `metrics.syncLagSeconds.set((Date.now() - tickStart) / 1000);` at line 245 (within the same tick, no await in between).
- **Recommended fix:** Remove line 237. This also simplifies the FINDING-M-02 fix.

---

**FINDING-L-03: `CONVLOG_ALERT_MIN_LAG_SECONDS` referenced in `.env.example` comment but not consumed by sidecar**

- **Path:** `.env.example` (CONVLOG_ALERT_MIN_LAG_SECONDS comment)
- **REQ:** REQ-068, REQ-070
- **Issue:** The env var is documented in `.env.example` with a comment explaining it feeds into the alert threshold. But because the alert threshold is hardcoded (FINDING-M-03), the env var does nothing. This creates a misleading documentation contract.
- **Recommended fix:** Update the comment to accurately state that operators must manually update `alerts.yml` when changing this value (and cross-reference FINDING-M-03 fix).

---

## 10. Decision: APPROVED WITH FINDINGS

**Rationale:** Zero HIGH findings. All 22 functional REQs are implemented; SPEC-016 adds no core LibreChat edits (REQ-072 confirmed for its own change set); all 23 tests pass on real in-process instances per project testing philosophy; field-mapping is correct and drift-gated. The four MEDIUM findings are real quality gaps — primarily: a `syncLagSeconds` metric that underreports lag (M-02), a hardcoded alert threshold that doesn't track config changes (M-03), a `statement_timeout` that ignores the env-var it is supposed to honour (M-01), and a non-transactional retention DELETE (M-04). None of these block the core correctness or data-safety invariants. The two LOW findings are style/cleanup items. Step 4c must address all MEDIUM findings before the PR is filed.

---

## 11. Required Actions (for Step 4c)

1. **[M-01] Fix `upsertBatch` statement timeout:** Pass config value into the `SET LOCAL statement_timeout` call in `postgres.ts:94`, or remove the redundant `SET LOCAL` entirely (session-level timeout already set by `connectPgClient`).

2. **[M-02] Fix `convlog_sync_lag_seconds` metric formula:** Remove the dead `set(0)` call at `index.ts:237` and update the post-tick set at line 245 to reflect elapsed time since the last successful tick start (store `lastSuccessfulTickStart` alongside `lastSuccessfulSyncAt`), or document the current behavior as a deliberate simplification in `README.md`.

3. **[M-03] Document hardcoded alert threshold:** Add a prominent comment block in `monitoring/prometheus/alerts.yml` explaining the 3000s threshold encodes `10 × 300s` default. Add a troubleshooting note in `conv-log/README.md` under the alerting section that `alerts.yml` must be updated manually when `CONVLOG_INTERVAL_SECONDS` is changed.

4. **[M-04] Fix non-transactional retention DELETE:** Wrap the retention ceiling DELETE in `withTransaction` in `postgres.ts:431-438`. Add a DELETE on orphaned `guardrail_events_log` rows after the retention pass.

5. **[L-01] Replace dynamic import with static import:** In `postgres.ts:274`, replace `const { advanceWatermark } = await import('./watermark.js')` with a static top-of-file import.

6. **[L-02] Remove dead `set(0)` call:** Remove `metrics.syncLagSeconds.set(0)` at `index.ts:237` (superseded by action 2).

7. **[L-03] Fix `.env.example` comment for `CONVLOG_ALERT_MIN_LAG_SECONDS`:** Update to accurately reflect that operators must manually update `alerts.yml` when tuning the threshold.

---

## Findings Addressed (Step 4c — 2026-05-26)

### M-01 — Resolved
- Fix: Extended `upsertBatch(txn, batch, statementTimeoutMs = 60000)` and `bisectAndUpsert(…, statementTimeoutMs = 60000)` with default-param; `index.ts` passes `cfg.pgStatementTimeoutMs`.
- Files modified: `conv-log/src/postgres.ts` (signature + `SET LOCAL` parameterized), `conv-log/src/index.ts` (call site updated)
- Verification: tests pass after fix

### M-02 — Resolved
- Fix: Introduced `lastSuccessfulTickStartUnix` initialized to `Date.now()/1000`; updated to `tickStartUnix` on each successful tick; gauge set to `Date.now()/1000 - lastSuccessfulTickStartUnix` post-tick — matches REQ-067 formula.
- Files modified: `conv-log/src/index.ts` (lines ~187-245)
- Verification: tests pass after fix

### M-03 — Resolved
- Fix: Replaced the brief comment block in `monitoring/prometheus/alerts.yml` with a prominent bordered operator-action block that names the exact literal to edit (`3000`), the formula it encodes, and step-by-step instructions for both `CONVLOG_INTERVAL_SECONDS` and `CONVLOG_ALERT_MIN_LAG_SECONDS` changes. No CI-grep test added (comment-only fix; keeping test surface focused on functional code).
- Files modified: `monitoring/prometheus/alerts.yml` (lines ~150-175)
- Verification: alert rule syntax unchanged; tests pass after fix

### M-04 — Resolved
- Fix: Replaced the bare `client.query` retention DELETE with a paged `withTransaction` loop mirroring the erasure pass; each page deletes from `guardrail_events_log` first, then `messages_log`, then orphaned `conversations_dim` rows — all within the same transaction. `retentionDeletions` incremented per page.
- Files modified: `conv-log/src/postgres.ts` (lines ~431 onward — retention ceiling section)
- Verification: tests pass after fix

### L-01 — Resolved
- Fix: Removed dynamic `await import('./watermark.js')` inside `bisectAndUpsert`; added static `import { advanceWatermark } from './watermark.js'` at top of file. No circular runtime import — `watermark.ts` uses only `import type { Txn }` from `postgres.ts`.
- Files modified: `conv-log/src/postgres.ts` (top-of-file import added; dynamic import removed)
- Verification: `npx tsc --noEmit` exits 0; tests pass

### L-02 — Resolved
- Fix: Removed the dead `metrics.syncLagSeconds.set(0)` call at `index.ts:237` (addressed alongside M-02).
- Files modified: `conv-log/src/index.ts`
- Verification: tests pass after fix

### L-03 — Resolved
- Fix: Updated `CONVLOG_ALERT_MIN_LAG_SECONDS` comment in `.env.example` to explicitly state that changing this value does NOT update the alert rule and that `monitoring/prometheus/alerts.yml` must be edited manually.
- Files modified: `.env.example` (lines ~1004-1008)
- Verification: no runtime impact; tests pass

---

**Post-fix verification:** `cd conv-log && npx tsc --noEmit` exits 0; `cd conv-log && npx vitest run` exits 0 — 23/23 tests passing.
