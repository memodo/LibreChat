# CRITICAL-IMPL-conversation-log-sidecar-20260526

**Subject:** SPEC-016 Conversation Log Sidecar — Step 4d adversarial implementation review
**Inputs reviewed:** SPEC-016 rev 2; Step 4b code review (resolved); `conv-log/src/{index,mongo,enrich,postgres,watermark}.ts`; `conv-log/tests/postgres-{bisection,transaction}.test.ts`; `conv-log/migrations/001_init.sql` + `002_dead_letter_unique.sql`; compose overlays; alerts.yml; .env.example; Dockerfile.
**Reviewer:** SDD critical-review subagent (Opus 4.7, 1M context)
**Date:** 2026-05-26

---

## 1. Executive summary

The implementation is structurally on-spec, the module split is clean, tests cover the major REQ-T paths, and the security posture (read-only Mongo user, role-separated Postgres, branded `Txn` type, locked-down container) is real. Step 4c closed the M-class findings.

However, the adversarial pass surfaced **two HIGH severity issues that are merge-blocking**, **one HIGH severity bug that will manifest on first production run**, plus a cluster of MEDIUMs around silent failures, observability gaps, and untested operational paths. The two HIGHs that warrant immediate STOP-AND-RECONSIDER:

1. **Cross-loop transaction contamination** — the main ingestion loop and the erasure-reconciliation loop both issue queries (including `BEGIN`/`COMMIT`) against the **same single `pg.Client`**. node-postgres serialises queries on a Client but does NOT scope them to logical transactions — any erasure query that lands between a main-loop `BEGIN` and `COMMIT` becomes part of the main-loop transaction. This violates REQ-073's "MUST NOT block main loop" intent and silently fuses two unrelated transactions, with rollback risk for either side.
2. **Production startup will crash on a fresh database** — `runMigrations` queries `schema_migrations` BEFORE applying `001_init.sql` (which is the file that creates `schema_migrations`). The tests work because they bootstrap the table manually in `beforeAll`. Production has no equivalent bootstrap. First sidecar start against a freshly provisioned Postgres dies on "relation `schema_migrations` does not exist."
3. **Dead-letter "sanitization" is not sanitization** — `error_detail` is `err.message.slice(0, 500)`. Postgres error messages routinely include the offending row's key/value (`Key (message_id)=(<actual_id>) already exists`), which the slice preserves. REQ-074 explicitly demands "sanitized PG error text (no row payload)." Today's test passes only because the constructed test poison is a CHECK violation whose error doesn't include row text; a unique-key violation would leak. This is also a privacy regression vs. the DPO acceptance posture.

**Severity counts:** HIGH = 4, MEDIUM = 7, LOW = 4.

**Verdict:** **REVISE BEFORE PROCEEDING.** Step 4e must address all four HIGHs before merge; the MEDIUM cluster around erasure-reconciliation safety, observability of poison-throughput failure, and connection-error handling should be addressed in the same fix pass.

---

## 2. Methodology

- Read SPEC-016 in full (5300+ lines), absorbing REQs 054–075 and the Testing block.
- Read all 5 source modules (`index.ts`, `mongo.ts`, `enrich.ts`, `postgres.ts`, `watermark.ts`) in full.
- Read 2 high-value tests in full: `postgres-bisection.test.ts` (REQ-T-5) and `postgres-transaction.test.ts` (REQ-T-4).
- Used `grep`/`sed` to inspect migrations (both files), Dockerfile, compose overlays, alerts.yml, prometheus.yml, .env.example.
- Cross-referenced Step 4b's code-review findings to avoid re-flagging resolved issues; the four MEDIUMs (M-01 timeout-as-error sourcing, M-02 statement_timeout per-session, M-03 dead-letter conflict target, M-04 retention paging) are confirmed resolved in code and out of scope for this review.
- Reads used: 9/10. Counter file updated.
- Applied scrutiny to: concurrency between the two loops sharing a `pg.Client`; bisection bounded-ness; sanitization claims; OFFSET paging during deletion; first-run bootstrap; configurability vs. environment-fragility; cache module-state; signal-handling shutdown ordering; metric-formula faithfulness to REQ-067.

---

## 3. Findings

### HIGH severity

#### CRI-01-HIGH: Erasure loop and ingestion loop share a single `pg.Client`, allowing transaction contamination

- **Severity:** HIGH
- **Category:** race | reliability
- **Location:** `conv-log/src/index.ts:338-349` (concurrent `Promise.all([runIngestionLoop, runErasureLoop])` both passed the same `pgClient`); `conv-log/src/postgres.ts:35-49` (`withTransaction(client, fn)` issues `BEGIN`/`COMMIT` on the client).
- **Spec reference:** REQ-073 ("Failures retry on next reconciliation cycle; do NOT block the main ingestion loop"); REQ-059 (watermark advance "in the SAME Postgres transaction as the batch upsert"); NFR-3 ("no risk of duplicate rows, no risk of lost rows").
- **Observation:** The main ingestion loop and the erasure-reconciliation loop run concurrently via `Promise.all`, sharing the **same `pg.Client` instance**. `pg.Client` serialises queries onto a single connection — queries are run in FIFO order — but it does NOT scope `BEGIN`/`COMMIT` to a specific caller. Any query enqueued from the erasure loop between the ingestion loop's `BEGIN` and `COMMIT` executes inside the ingestion loop's transaction and is committed (or rolled back) by it.
- **Expected:** Each loop must own a dedicated `pg.Client` (or use a `pg.Pool` and check out per transaction). REQ-073's "MUST not block main loop" implicitly requires logical isolation, which a shared single-connection Client cannot provide.
- **Impact:**
  - The erasure loop's `DELETE FROM messages_log` can be silently rolled back by an unrelated ingestion-loop transaction error (data not actually erased; GDPR Art. 17 exposure).
  - The ingestion loop's `COMMIT` can prematurely commit erasure DELETEs whose chunk-transaction was not yet ready (cross-contamination of intended commit boundaries).
  - A long-running erasure scan blocks ingestion (because the shared client is serial), undermining the "no blast radius" claim.
  - `withTransaction` ROLLBACK in either loop will roll back BOTH loops' uncommitted work since they share session state.
- **Recommendation:** In `index.ts`, create two separate clients — `pgClient` for ingestion, `pgClientReconciliation` (or a `pg.Pool` with `pool.connect()` per transaction in `runErasureReconciliation`). The migrations and startup queries can still use a single client because they're sequential. Add a unit-style integration test that opens a `BEGIN` on the ingestion path and asserts an erasure query is NOT visible inside that transaction.

#### CRI-02-HIGH: First-run startup crashes on fresh Postgres — `schema_migrations` table is queried before it exists

- **Severity:** HIGH
- **Category:** spec-deviation | brittleness
- **Location:** `conv-log/src/postgres.ts:55-90` (`runMigrations` — `SELECT checksum FROM schema_migrations WHERE version = $1` at line 66 runs BEFORE the loop body executes the migration file that creates the table); `conv-log/migrations/001_init.sql:10-15` (the file that creates `schema_migrations`).
- **Spec reference:** REQ-058 ("On startup the sidecar runs idempotent migrations creating: `schema_migrations` ..."); REQ-072 deploy path note ("`git pull` + `./prod.sh up -d conv-log`" — no manual schema bootstrap).
- **Observation:** `runMigrations` iterates over files in lexicographic order. For each file, it first runs `SELECT checksum FROM schema_migrations WHERE version = $1`. For migration `001_init`, this SELECT executes before the migration runs — and `001_init.sql` is the file that creates the `schema_migrations` table. On a fresh database, this SELECT throws Postgres error 42P01 ("relation `schema_migrations` does not exist"). Both test files (`postgres-bisection.test.ts:121-128`, `postgres-transaction.test.ts:131-138`) hide the bug because they bootstrap `schema_migrations` manually in `beforeAll`. Production has no equivalent bootstrap.
- **Expected:** Either (a) the runner pre-creates `schema_migrations` with a hardcoded `CREATE TABLE IF NOT EXISTS` BEFORE the file loop, or (b) the first migration file's content includes the bootstrap and the runner gracefully treats "relation does not exist" on the initial SELECT as "no migrations applied yet."
- **Impact:** Sidecar fails to start on the very first deployment. Operator sees process exit 1, "relation schema_migrations does not exist" in the logs. Investigation required before any data flows. V-1 (backfill correctness) and V-7 (erasure propagation) can never run.
- **Recommendation:** Add an idempotent bootstrap at the top of `runMigrations` before the file loop:
  ```ts
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL,
      checksum TEXT NOT NULL,
      CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
    )
  `);
  ```
  Then add a regression test that runs against an empty Postgres without the manual bootstrap to catch future drift.

#### CRI-03-HIGH: Dead-letter `error_detail` "sanitization" leaks row payload in unique-key violations (REQ-074 violation)

- **Severity:** HIGH
- **Category:** security | spec-deviation
- **Location:** `conv-log/src/postgres.ts:305` (`const errorDetail = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);`).
- **Spec reference:** REQ-074 step 3 ("`error_detail = sanitized PG error text (no row payload)`"); DPO Acceptance (raw text retention is contingent on "compensating controls" including no payload leakage); REQ-069 ("No raw message text is ever logged at info or below" — error_detail lives in Postgres rather than logs, but the spirit is identical).
- **Observation:** `errorDetail = err.message.slice(0, 500)` is truncation, not sanitization. Postgres' standard error format for `unique_violation` (SQLSTATE 23505) is:
  ```
  duplicate key value violates unique constraint "messages_log_uq"
  DETAIL:  Key (message_id, user_id)=(<actual_message_id>, <actual_user_id>) already exists.
  ```
  The `(<actual_message_id>, <actual_user_id>)` substring is plain-text source row content. The 500-char slice preserves the prefix that includes these values. REQ-T-5's test (`postgres-bisection.test.ts:259`) only asserts the substring `"Bisect test message 7"` is absent — but the poison row is a CHECK violation whose error message naturally omits row data, so the test gives a false-negative reading on REQ-074's sanitization contract.
- **Expected:** A real sanitizer that strips DETAIL lines, parameterized value substrings (`=(...)` runs), or the entire error body in favour of just the error code + constraint name. Minimum acceptable: regex-strip lines starting with `DETAIL:` and `Key (...)=(...)` substrings before truncating.
- **Impact:** `dead_letter_log.error_detail` is queryable by anyone with the `convlog_writer` role (the sidecar) and by anyone who later grants themselves access. The column reproduces row identifiers (`messageId`, `userId`) and, for some constraint types, row text values. This is exactly the leakage that the "compensating controls" promised in the DPO acceptance do not permit. Worse: a future REQ-074 expansion to dead-letter on `string_data_right_truncation` errors (column max-length exceeded) WILL include the actual offending text in the pg error message.
- **Recommendation:** Add a sanitizer:
  ```ts
  function sanitizePgError(msg: string): string {
    return msg
      .replace(/DETAIL:[\s\S]*?(?=\n[A-Z]+:|$)/g, 'DETAIL: [redacted]')
      .replace(/Key \([^)]+\)=\([^)]+\)/g, 'Key (...)=([redacted])')
      .slice(0, 500);
  }
  ```
  Update REQ-T-5 to inject a unique-key violation (not CHECK) and assert the `messageId` does NOT appear in `error_detail`. Add a second test for `string_data_right_truncation` using a `text VARCHAR(N)` constraint and a known-distinctive payload.

#### CRI-04-HIGH: Erasure reconciliation will wipe analytical store if a Mongo blip returns an empty result

- **Severity:** HIGH
- **Category:** silent-failure | safety
- **Location:** `conv-log/src/postgres.ts:385-393` (`stillPresent = await mongoClient...find({ messageId: { $in: messageIds } })` — no error handling, no safety check on the size of the result).
- **Spec reference:** REQ-073 (right-to-erasure reconciliation); V-7 (erasure propagation expected within 24h); NFR-3 (restart-safe).
- **Observation:** The erasure pass queries Mongo for which `messageId`s in a Postgres chunk are still present, then deletes the complement. There is no defence against:
  - Mongo connectivity blip mid-`find()` returning a partial cursor result or an empty array.
  - Mongo authentication degradation (e.g., `convlog_reader` role revoked) returning empty.
  - A `find()` that silently times out (no `maxTimeMS` set on this call — note the contrast with `fetchMessageBatch` and `lookupConversation`, which both pass `maxTimeMS`).
  - A future refactor that mutates `messageIds` between fetch and DELETE.
  In any of these cases, `stillPresent` is empty, `toDelete` becomes the full chunk's `messageId`s, and a chunk-sized batch of "erasures" is committed. Across the full pass, the entire `messages_log` plus joined `guardrail_events_log` and orphaned `conversations_dim` can be wiped without any source change in Mongo.
- **Expected:** Defensive sanity check before the DELETE:
  - Hard cap on per-chunk deletion ratio (e.g., abort if `toDelete.length / messageIds.length > 0.5` and pending source-Mongo data exists in the source collection).
  - `maxTimeMS` on the `find()` call.
  - Verify the Mongo collection is queryable with a sentinel record before trusting an empty result (or use `countDocuments({ messageId: { $in: messageIds } })` to corroborate).
- **Impact:** A 10-minute Mongo outage during the daily reconciliation pass can permanently destroy the analytical corpus (the watermark advances normally, so backfill won't replay deleted messages — and even if it does, all historical context including conversation-graph dim tables is gone). This is unrecoverable without a Postgres restore.
- **Recommendation:** Add: (a) `maxTimeMS: 60000` to the `find()` call; (b) explicit error-throw if `find()` returns empty AND the chunk size is > 100 (configurable safety threshold); (c) a post-chunk metric `convlog_erasure_chunk_deleted_ratio` so operators can alert on abnormal deletion rates; (d) operator runbook entry on how to interpret a sudden spike in `convlog_erasure_deletions_total` (currently the README mentions "force a reconciliation pass manually" but not "how to recognise a runaway").

---

### MEDIUM severity

#### CRI-05-MED: `consecutiveFailures` is incremented for telemetry-query failures after the upsert has already committed

- **Severity:** MEDIUM
- **Category:** brittleness | observability
- **Location:** `conv-log/src/index.ts:228-244` (`maxMessageAgeSeconds` SELECT after the upsert; on failure, the catch block at line 240-244 increments `consecutiveFailures` and skips `onSuccessfulSync`).
- **Spec reference:** REQ-066 ("`lastSuccessfulSyncAt` (in-memory; updated only on successful COMMIT)"); REQ-065 ("After 3 consecutive tick failures, exponential backoff...").
- **Observation:** The `try` block in `runIngestionLoop` performs the upsert (via `bisectAndUpsert`), THEN performs an auxiliary `SELECT MAX(source_created_at) FROM messages_log` for the `maxMessageAgeSeconds` metric. If that auxiliary SELECT fails (transient connection error, statement-timeout), control jumps to the catch block. The upsert has already committed (and the watermark has been advanced), so by the contract this is a successful sync — but `consecutiveFailures` is incremented and `onSuccessfulSync(now)` is skipped. Three such transient errors in a row trigger backoff, and `lastSuccessfulSyncAt` stays stale, so `/healthz` flips to 503 even though data IS flowing.
- **Expected:** Telemetry queries that run AFTER the commit must not affect the success/failure determination of the tick. Either wrap the auxiliary SELECT in its own try/catch that increments only `metrics.errorsTotal{phase="telemetry"}`, or perform it before the upsert.
- **Impact:** Spurious health degradation and spurious backoff in the face of brief transient connection wobbles on `pgClient`. With CRI-01 (shared pg.Client) this becomes more likely because the erasure loop can interrupt the telemetry SELECT.
- **Recommendation:** Wrap the `latestAgeResult` block in its own try/catch with phase `"telemetry"`. Move `consecutiveFailures = 0` and `onSuccessfulSync` directly after `bisectAndUpsert`'s return.

#### CRI-06-MED: Backfill-mode hysteresis missing — sidecar can oscillate at the threshold boundary

- **Severity:** MEDIUM
- **Category:** brittleness
- **Location:** `conv-log/src/index.ts:208-210` (`inBackfillMode = pending > backfillThreshold` — re-evaluated every tick from current `pending`).
- **Spec reference:** REQ-075 (entry condition AND exit condition are both the same threshold).
- **Observation:** REQ-075's wording "enters backfill mode if pending > threshold; exits when below threshold" reads as a single boundary. The code implements that literally. There is no hysteresis. If pending hovers around the threshold (e.g., during a burst followed by a lull), every tick re-evaluates: 2501 → backfill (sleep 5s), processes batch, 2001 → normal (sleep 300s), no progress during 300s while new messages arrive bringing pending to 2501 again → backfill, etc. Cadence oscillates.
- **Expected:** A two-threshold hysteresis: enter backfill when pending > `T_enter`, exit when pending < `T_exit` where `T_exit < T_enter` (e.g., `T_exit = T_enter / 2`). The spec is silent on hysteresis; this is a known operational pattern.
- **Impact:** During catch-up after maintenance windows or burst traffic, the sidecar's cadence chatter wastes Mongo connection cycles and produces noisy metrics. Not data-corrupting but observability-degrading.
- **Recommendation:** Introduce `CONVLOG_BACKFILL_ENTER_THRESHOLD` and `CONVLOG_BACKFILL_EXIT_THRESHOLD` (or default `exit = enter / 2`). Test in `runIngestionLoop` with a tick that holds backfill mode steady when pending is between the two thresholds.

#### CRI-07-MED: Erasure reconciliation OFFSET paging skips rows after deletions

- **Severity:** MEDIUM
- **Category:** spec-deviation | scalability
- **Location:** `conv-log/src/postgres.ts:374-428` (first reconciliation pass — `LIMIT $1 OFFSET $2` with `offset += CHUNK_SIZE` after each chunk; deletions of chunk rows then SHIFT the rows from the next page out of OFFSET range).
- **Spec reference:** REQ-073 ("Pages messages_log.message_id ... in chunks"); V-7 ("Within 24 h ... all `messages_log` and `guardrail_events_log` rows for that conversation are deleted").
- **Observation:** The first reconciliation pass reads `LIMIT 1000 OFFSET 0`, deletes K of those 1000 rows in a transaction, then reads `LIMIT 1000 OFFSET 1000`. But after K deletions, rows previously at positions 1000..1000+K are now at positions 1000-K..1000. Page 2 (`OFFSET 1000`) starts at the row that was previously at position 1000+K, MISSING K rows. Over a full pass of 100K rows where 5% must be erased, ~5000 erasures are missed per pass. They are eventually caught on subsequent daily passes, but V-7's "within 24 h" SLO is broken when erasure volume is significant.
- **Expected:** Keyset pagination (e.g., `WHERE id > $last_id ORDER BY id LIMIT 1000`) so that deletions don't move the cursor. The retention pass (lines 431-486) doesn't use OFFSET — it just re-queries for "any rows older than X" until the result is empty. That's the right pattern.
- **Impact:** Erasure SLO breach under non-trivial deletion volumes. Worse: silent — operators see `convlog_erasure_deletions_total` incrementing and assume erasure is keeping up.
- **Recommendation:** Replace OFFSET paging with keyset pagination on `messages_log.id`:
  ```ts
  let lastId = 0;
  for (;;) {
    const chunk = await client.query(
      `SELECT id, message_id, user_id, conversation_id FROM messages_log
       WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, CHUNK_SIZE],
    );
    if (chunk.rows.length === 0) break;
    // ... deletion logic ...
    lastId = chunk.rows[chunk.rows.length - 1].id;
  }
  ```
  Note: rows deleted from `messages_log` no longer affect cursor advancement when keyed on `id`.

#### CRI-08-MED: No `pg.Client` connection-error handler → unhandled error event crashes process

- **Severity:** MEDIUM
- **Category:** brittleness | observability
- **Location:** `conv-log/src/index.ts:300-302` (creates `pgClient`, never registers `pgClient.on('error', ...)`); `conv-log/src/postgres.ts:18-31`.
- **Spec reference:** REQ-065 ("If Mongo or Postgres is unreachable... retries on the next interval"); NFR-3 (restart-safe).
- **Observation:** node-postgres `pg.Client` emits `'error'` events on connection-level failures (TCP reset, server restart, idle-in-transaction timeout). Without a listener, an emitted `'error'` becomes an unhandled error event, which Node crashes on by default. The process exits, Docker restart-policy `unless-stopped` brings it back, but each restart triggers a fresh backfill check and (with CRI-02 still open) potentially fails before the first tick.
- **Expected:** `pgClient.on('error', (err) => { logger.error({ phase: 'pg_client_error', err }, 'pg connection error'); })`. Same for `mongoClient` if applicable.
- **Impact:** Sidecar uptime tied to Postgres connection stability. Transient Postgres restarts (e.g., during pgvector maintenance) crash the sidecar instead of triggering REQ-065's backoff path.
- **Recommendation:** Register an error handler immediately after `connectPgClient`. Decide policy: log + continue (preferred — the next tick's query will reconnect or fail and trigger backoff), OR log + `running = false` to trigger graceful shutdown.

#### CRI-09-MED: Bisection has no recursion-depth cap — pathological poison rates make ticks "succeed slowly forever"

- **Severity:** MEDIUM
- **Category:** scalability | observability
- **Location:** `conv-log/src/postgres.ts:267-361` (`bisectAndUpsert` recursion).
- **Spec reference:** REQ-074 (dead-letter handling); NFR-2 (P95 lag SLO ≤ 2× interval in steady state).
- **Observation:** For a 500-row batch with all 500 rows poisoned, the bisection produces ~500 single-row transactions (the dead-letter path) plus ~999 internal "try a sub-batch, fail, bisect" transactions = ~1500 round-trips. At ~5ms per transaction = 7.5 seconds for a single tick — within budget. But for a corrupt batch where every row has the same constraint violation (e.g., a schema-version mismatch on an entire LibreChat fleet upgrade), the sidecar will burn 1500 transactions per tick, indefinitely, with each tick's `result.committed === 0`. The bisection succeeds (deadLettered == 500), `consecutiveFailures` resets, but progress is illusory and `convlog_messages_synced_total` never advances.
- **Expected:** A safety cap: if a sub-batch of size N produces more than `M * N` dead-letters (`M` close to 1), abandon bisection and fast-fail the entire batch to a dead-letter checkpoint. Or: cap recursion depth and emit a high-severity metric `convlog_bisection_overflow_total`.
- **Impact:** A bad LibreChat release that produces uniformly-malformed messages turns the sidecar into a poison-flush pipeline. The watermark advances (good for not stalling on poison) but the analytical store stops growing meaningfully, with no operator-facing signal that something is structurally wrong beyond `dead_letter_total` climbing. Step 4b noted bisection cliff risk; the fix is still pending.
- **Recommendation:** Add a per-tick dead-letter-ratio metric `convlog_dead_letter_ratio = deadLettered / (deadLettered + committed)` and an alert rule (e.g., > 0.1 for 30m). Also cap recursion: if depth > `log2(BATCH_SIZE) + 2`, emit an error and dead-letter the rest of the sub-batch as a whole-batch failure rather than bisecting further.

#### CRI-10-MED: `fetchGuardrailEvents` collection name is unverified TODO — silent join failure mode

- **Severity:** MEDIUM
- **Category:** silent-failure | observability
- **Location:** `conv-log/src/mongo.ts:275-285` (`collection('guardrailevents')` with a `TODO(operator-verify)` comment).
- **Spec reference:** REQ-063 (field mapping is the contract); SPEC-009 (GuardrailEvent collection is the source); V-6 (sample analytical query "PII-trigger correlation" requires guardrail join).
- **Observation:** The code ships with `TODO(operator-verify): Mongoose pluralises model names by default. GuardrailEvent (SPEC-009) likely maps to "guardrailevents" — verify with db.getCollectionNames() in mongosh against the LibreChat database. If the collection is named differently, update this string accordingly.` This is a known-unknown shipped as production code. If the collection is actually named (e.g.) `guardrail_events` (snake_case) or `guardrailEvents` (camel — Mongo IS case-sensitive), then `find({...}).toArray()` returns `[]`. No error, no metric. The sidecar silently joins zero guardrail events forever, and V-6's PII-correlation query returns nothing without any indication of bug-vs-no-data.
- **Expected:** Pre-flight collection-existence check at startup (`db.listCollections().toArray()`), or an operator-verified comment stating "verified 2026-05-26 against prod LibreChat Mongo." The README runbook step listing collection names should be a hard verification step, not a runtime TODO.
- **Impact:** PII-trigger correlation queries return empty silently; operators discover this only when running V-6 manually and noticing zero rows in `guardrail_events_log`.
- **Recommendation:** (a) Verify the collection name against production Mongo before merge and either confirm `guardrailevents` or correct it. (b) Add a startup health-check: `db.listCollections({ name: 'guardrailevents' }).toArray()` — if absent, log a `warn` and emit `convlog_errors_total{phase="config"}.inc()` rather than silently joining empty. (c) Add a SPEC-009-aware integration test that seeds the actual collection name into mongodb-memory-server.

#### CRI-11-MED: First erasure pass deferred by full 24h — erasures issued before sidecar start are reconciled 24-48h late

- **Severity:** MEDIUM
- **Category:** spec-deviation
- **Location:** `conv-log/src/index.ts:273-274` (`runErasureLoop` opens with `await sleep(cfg.erasureReconciliationHours * 3600 * 1000)` BEFORE the first reconciliation pass).
- **Spec reference:** V-7 ("Within 24 h (one CONVLOG_ERASURE_RECONCILIATION_HOURS cycle), all messages_log and guardrail_events_log rows for that conversation are deleted").
- **Observation:** The erasure loop sleeps 24h THEN runs the first reconciliation. A user's right-to-erasure executed against LibreChat 23 hours before the sidecar is restarted has its propagation delayed by up to (23 + 24) = 47 hours — almost double the SLO. Combined with CRI-07's OFFSET paging skip, the effective worst-case propagation can stretch further.
- **Expected:** Either (a) run the first reconciliation immediately on startup (with a small delay, e.g., 60s, to let migrations settle) and THEN enter the 24h cadence, or (b) document the "first cycle starts at startup + 24h" gotcha in REQ-073 and V-7.
- **Impact:** GDPR Art. 17 propagation can exceed the documented 24h ceiling under common scenarios (sidecar restart after deploy). Compliance-relevant.
- **Recommendation:** Restructure `runErasureLoop`:
  ```ts
  for (;;) {
    if (!isRunning()) break;
    try { await postgres.runErasureReconciliation(...); ... } catch { ... }
    await sleep(cfg.erasureReconciliationHours * 3600 * 1000);
  }
  ```
  Add a startup-delay guard (60s) before the first pass to let the ingestion loop establish its first watermark.

---

### LOW severity

#### CRI-12-LOW: HTTP server `server.close()` not awaited; signal-shutdown drops in-flight requests

- **Severity:** LOW
- **Category:** brittleness
- **Location:** `conv-log/src/index.ts:328` (`server.close();` — return is a server object, callback would be the way to await).
- **Observation:** `server.close()` is fire-and-forget; the subsequent `await pgClient.end()` and `process.exit(0)` may run while a scrape request is mid-response. Prometheus sees a torn response and a scrape error on shutdown.
- **Impact:** A Prometheus scrape gap of one cycle on every sidecar restart. Cosmetic.
- **Recommendation:** Wrap in a promise: `await new Promise<void>((resolve) => server.close(() => resolve()));`

#### CRI-13-LOW: `connectPgClient` uses string interpolation for `statement_timeout` value

- **Severity:** LOW
- **Category:** security (defence-in-depth)
- **Location:** `conv-log/src/postgres.ts:30` (`await client.query(\`SET statement_timeout = ${timeoutMs}\`);`).
- **Observation:** Value is parsed from env via `parseInt` so it cannot inject SQL today. But the pattern `\`SET ... = ${x}\`` is an anti-pattern; future contributors copying it without re-validating the source of `x` could introduce a real injection.
- **Impact:** None today. Code-style risk.
- **Recommendation:** `SET statement_timeout = $1` is not supported syntactically in Postgres (`SET` is a utility command), but `SELECT set_config('statement_timeout', $1::text, false)` is and accepts a parameter binding. Use that idiom.

#### CRI-14-LOW: Startup error from `connectPgClient` falls through to `console.error({ err }, ...)`, which may serialize a pg error whose stack contains the connection URI

- **Severity:** LOW
- **Category:** security
- **Location:** `conv-log/src/index.ts:352-356` (`main().catch((err) => { console.error({ err }, ...); process.exit(1); });`).
- **Observation:** `pino` may not be initialised on startup faults, so the fallback is `console.error({ err })` — which Node renders by calling `err.toString()` or by serializing via `util.inspect`. pg error objects sometimes carry `.address` (host) and stack traces that include the URI when the connection string was passed via constructor. While the password is rarely in the stack, this depends on pg version behaviour and is not guaranteed.
- **Impact:** Credentials potentially in `docker logs` of a crashed-on-startup sidecar. Low because: (a) password URL-encoded values aren't in stack traces in current pg versions; (b) container logs are local to the host.
- **Recommendation:** Replace the catch with `console.error('startup failure:', err instanceof Error ? err.message : String(err));` to avoid printing the full error object. Also forbid `CONVLOG_*_URI` from logs by adding a pino `redact` config once the logger is up.

#### CRI-15-LOW: Test `field-mapping-drift.test.ts` not read in this review — gate strength unverified

- **Severity:** LOW
- **Category:** test-gap
- **Location:** N/A (test file exists but was not read due to budget).
- **Observation:** REQ-T-2's field-mapping drift gate is the canonical contract for NFR-5 (upgrade portability). The test's robustness (does it actually parse field-mapping.md and verify both directions?) was not assessed in this review.
- **Impact:** If the gate is shallow (e.g., regex over a static list rather than actual parsing of `mongo.ts` projections), upstream LibreChat schema drift would not be caught.
- **Recommendation:** Step 4e (or a follow-up) should read `tests/field-mapping-drift.test.ts` and verify it actually exercises BOTH directions (every doc'd field referenced in code; every code-referenced field doc'd). If shallow, deepen it.

---

## 4. Adversarial questions answered

### 4.1 How would you break this implementation?

- **Drop pgvector for 2 minutes during an erasure reconciliation pass.** With CRI-04, the `find()` may return empty or partial; the DELETE runs on the full chunk; rows that should not have been deleted are gone. With CRI-08 (no error handler on pgClient), the disconnect emits an unhandled error → process exit.
- **Restart Postgres while a tick is mid-commit.** The transaction rolls back; node-postgres surfaces a `'error'` event with no listener → unhandled error → crash. Container restart, but with CRI-02 the first run on a fresh DB never even gets to the migration step.
- **Submit a LibreChat message with an extraordinarily long `text` field (e.g., 100 MB).** It commits to Mongo (no limit there); sidecar fetches it; `content` JSONB write to Postgres triggers TOAST or a row-too-large error; bisection sends the row to `dead_letter_log` with `raw = the_full_100MB_blob` (the source doc is passed as `rawDoc` and stored as JSONB at `postgres.ts:247`). The dead_letter_log row itself blows up TOAST limits — recursive failure of the same kind. The `raw` JSONB column has no size cap.
- **Run two sidecar containers simultaneously** (operator error: `docker compose up -d conv-log` then forgets the previous one running on host). REQ-061's "first-run watermark race" is real: both containers see `sync_state.messages_high_watermark` absent (or both write it at slightly different instants); both enter backfill. They race on `INSERT ... ON CONFLICT` upserts — Postgres serialises these and they're idempotent, BUT they both advance the watermark, and depending on interleaving, one container can advance past unprocessed messages of the other.
- **Push a LibreChat upstream upgrade that renames `messages.content[].type` to `messages.content[].kind`.** REQ-T-2 drift test catches it IF the test actually parses the code's projections (CRI-15 unverified). If not, `flattenTextParts` returns empty for assistant text (filter never matches), and assistant messages silently lose their text field while content JSONB preserves the new structure. Analytical queries that SELECT `text` return nulls for all assistant messages going forward.

### 4.2 What happens with malformed Mongo documents?

`normaliseMessage` is defensive:
- `messageId` missing → `String(undefined ?? '')` = `''`. Empty string is a valid PK by Postgres' lights but breaks `(message_id, user_id)` uniqueness across multiple malformed docs.
- `createdAt` not a Date → `new Date(doc['createdAt'] as string)`. If it's `undefined`, that becomes `Invalid Date` (NaN timestamp). The `source_created_at TIMESTAMPTZ` column accepts `null` but `Invalid Date` serialised by pg becomes either `null` (acceptable) or throws (depends on pg version).
- `feedback` is a string instead of an object → `doc['feedback'] as RawFeedback` is a lie cast; `enrich.ts` reads `msg.feedback?.rating` which on a string is `undefined` (the optional chain stops). OK, but `feedback_tag` could end up as a JSONB string instead of a tag value. The schema accepts it.
- `content` is a string instead of array → `Array.isArray(...)` is false, so `content` is `null`. Text is then read from `msg.text`. OK for user messages; for assistant messages this loses content.

**Verdict:** Malformed docs survive normalisation but pollute the analytical store with empty strings and nullish timestamps. There is NO dead-letter for normalisation failures (only for Postgres write failures). REQ-074 phases would have to expand to `error_phase ∈ {... , 'normalisation'}`. Today, malformed source docs become low-quality rows rather than dead-letter rows. **Recommend** a follow-up MEDIUM to validate `messageId` non-empty and `createdAt` valid before the upsert; route violations to dead-letter.

### 4.3 Which paths have no test coverage?

- **`runErasureReconciliation`** — neither test file exercises this. Tests verify the bisection path and the transactional watermark, but not the erasure pass that holds the GDPR contract. V-7 must be exercised in an integration test.
- **`/healthz`** — no HTTP test of the endpoint. `lastSuccessfulSyncAt` semantics (null at startup → 503, after first commit → 200, after staleness → 503) are not asserted.
- **`runIngestionLoop` failure-backoff state machine** — `consecutiveFailures` semantics, the 3-failure threshold for backoff entry, the "first successful tick resets backoff" contract — none exercised.
- **`jitteredBackoff` math** — no test of the upper-bound cap or jitter shape.
- **Migrations on a truly fresh DB** — both tests bootstrap `schema_migrations` manually, hiding CRI-02.
- **Cross-loop contention** — no test of what happens when ingestion and erasure run concurrently against the same client (no test would catch CRI-01).
- **`fetchGuardrailEvents` collection naming** — no test verifies the collection name.

### 4.4 What would fail at production scale?

- **Batch 500 × avg 10 KB content = 5 MB JSONB insert.** pg parameter limit is 65535 / query; the upsert here uses 21 parameters per row × 500 = 10,500 parameters per `upsertBatch` execution if a single multi-row INSERT were used. But the code uses **one query per row** in a loop (`postgres.ts:154-207`) — 500 INSERTs sequentially. Avoids the parameter limit but each row is a round-trip. At 5 ms RTT per query, that's 2.5 seconds per batch just in network — well under the 60s statement timeout but it's a 25× speedup left on the table by not using `INSERT ... VALUES (), (), ...` with batched parameter sets. Not failure but performance leakage.
- **Index `messages_log_user_idx` on `user_id`** — Mongo's `user` field cardinality is low (most production deployments have ≤100 users). A B-tree index on a low-cardinality column with TEXT values is bloated; use BRIN if the user space stays small, or accept the bloat. Same for `endpoint`. Not failure-level.
- **Erasure reconciliation chunk size 1000 with OFFSET paging (CRI-07)** — at 1M rows, that's 1000 chunks × OFFSET scan = O(n²) — by the 1000th chunk Postgres has to skip 999,000 rows to reach the offset. Performance cliff.
- **Mongo `countPendingMessages` every tick** — `countDocuments({ createdAt: { $gt: watermark } })` requires an index on `createdAt` in source Mongo. LibreChat's `messages` schema (per CLAUDE.md reference) declares `createdAt` via mongoose timestamps but the index is not guaranteed. If absent, every tick triggers a collection scan on source. At 1M docs that's a multi-second scan per tick, eating into Mongo's normal workload. **Operator should be advised to verify the index.**

### 4.5 What assumptions does the code make that could be violated?

- **`messages.createdAt` is always a Date.** Spec ack'd, code defends with the `instanceof Date ? ... : new Date(string)` fallback, but if the field is missing entirely (`undefined`), `new Date(undefined)` produces `Invalid Date` and downstream comparisons (`m.source_created_at > max` in `batchMaxCreatedAt`) silently use NaN, breaking the max calculation. Watermark advance computes `new Date(NaN - 60000) = Invalid Date`, which is then serialised by pg as NULL or error. The next tick's `readWatermark` sees NULL ts in the JSONB → `new Date('null')` = Invalid Date → query Mongo `{ createdAt: { $gt: Invalid Date } }` → undefined behaviour.
- **`messages.user` is a string, never an ObjectId.** Both happen in real LibreChat — for legacy data, `user` can be an ObjectId. `String(ObjectId)` produces the hex repr — OK. But cross-format comparison (user as string in one row, ObjectId in another) creates two `(message_id, user_id)` rows for what is logically the same message.
- **`messages_log.conversation_id` ON DELETE SET NULL** assumes `conversations_dim` deletes are intentional. If CRI-04 wipes `conversations_dim`, every `messages_log.conversation_id` is set NULL — undetectable as a "wipe" later.
- **The branded `Txn` type guarantees in-transaction execution.** It's a compile-time guarantee only. `client.query('BEGIN')` then passing a `txn` object with `__brand: 'in-transaction'` is type-safe BUT `txn.client.query('ROLLBACK')` from inside a caller would silently roll back, and the next operation would execute outside the transaction without TypeScript's knowledge. The brand is robust against accidental escape, NOT against malicious or naive nested rollback.
- **`erasure_deletions_total` counter is monotonic.** With CRI-04 a Mongo blip could cause a single tick to delete millions of rows; the counter then sits at "millions" forever. Alerting on rate-of-change is required.
- **`runMigrations` is idempotent across releases.** The checksum check rejects mutated files (good), but it does NOT detect a file that was REMOVED in a later release — that file's prior application is still in `schema_migrations` but the file isn't applied on a fresh DB. Downstream: `002_dead_letter_unique.sql` adds a constraint that `001_init.sql` doesn't declare. If `002` is later subsumed into a `001b_init.sql`, fresh deploys miss the constraint. Minor.

---

## 5. Verdict

**REVISE BEFORE PROCEEDING.**

The implementation will not survive contact with production as it stands. Four HIGH findings — shared-client transaction contamination (CRI-01), first-run migration crash (CRI-02), dead-letter row-payload leak (CRI-03), and erasure-wipe-on-Mongo-blip (CRI-04) — each independently warrant blocking merge. The MEDIUM cluster (CRI-05 through CRI-11) reveals a pattern of "fail-open" silent-failure modes that the test suite does not detect because the tests focus on the happy paths called out in REQ-T-1..5 rather than the operational adversarial edge cases.

Step 4e must:
1. Address all four HIGHs.
2. Address CRI-08 (pg.Client error handler) and CRI-09 (bisection cap + metric).
3. Add at least one integration test exercising erasure reconciliation against a testcontainers Mongo + testcontainers Postgres pair (per the testing philosophy in CLAUDE.md).
4. Verify CRI-10 (guardrailevents collection name) by querying the production Mongo via `provision-mongo.sh` and either confirming or correcting the string.

After 4e, recommend a brief second adversarial pass before merge to verify the highs are closed (they're not "edits" — they require structural changes around connection ownership and erasure-pass safety).

---

## 6. Recommended actions (keyed to finding IDs, for Step 4e)

1. **CRI-01** — Split `pg.Client` into two clients (or move to `pg.Pool` with per-transaction checkout). Update `runErasureLoop` to take its own client. Add a regression integration test demonstrating that an erasure DELETE issued during an active main-loop transaction does NOT join that transaction.
2. **CRI-02** — Pre-create `schema_migrations` at the top of `runMigrations` before the file loop. Add a fresh-DB regression test that does NOT bootstrap `schema_migrations` in `beforeAll`.
3. **CRI-03** — Implement `sanitizePgError` regex-based redactor; update REQ-T-5 to assert sanitization against a unique-key violation, not a CHECK violation; add a second test with a `string_data_right_truncation` to verify text content is not leaked.
4. **CRI-04** — Add `maxTimeMS: 60000` to the erasure `find()`; add a per-chunk deletion-ratio safety threshold (abort + log if `toDelete.length / messageIds.length > 0.5`); add a `convlog_erasure_chunk_deleted_ratio` histogram metric; document the "runaway erasure" recognition path in the README.
5. **CRI-05** — Wrap the post-upsert telemetry SELECT in its own try/catch; move `consecutiveFailures = 0` and `onSuccessfulSync` to immediately after `bisectAndUpsert` returns.
6. **CRI-06** — Introduce two-threshold hysteresis on backfill mode; document the new envs in `.env.example`.
7. **CRI-07** — Convert erasure-reconciliation OFFSET paging to keyset pagination on `id`.
8. **CRI-08** — Register `pgClient.on('error', ...)` (and `mongoClient` equivalent) immediately after connect, with structured logging and a metric label.
9. **CRI-09** — Add bisection recursion-depth cap; add `convlog_bisection_overflow_total` counter; add alert rule on `convlog_dead_letter_total` rate-of-change.
10. **CRI-10** — Verify the `guardrailevents` collection name against production Mongo; add a startup collection-existence pre-flight check that warns if absent.
11. **CRI-11** — Restructure `runErasureLoop` so the first reconciliation runs near startup (after a 60s settle delay) rather than 24h after.
12. **CRI-12** — Await `server.close()` via callback-to-Promise wrapper during shutdown.
13. **CRI-13** — Replace `\`SET statement_timeout = ${ms}\`` with `SELECT set_config('statement_timeout', $1::text, false)`.
14. **CRI-14** — Replace startup-error `console.error({ err }, ...)` with `console.error('startup failure:', err.message)`. Add `pino` redact config for `*Uri` once the logger is up.
15. **CRI-15** — Read `tests/field-mapping-drift.test.ts` in Step 4e and verify it exercises both directions; deepen if shallow.

---

End of review.

---

## 7. Findings Addressed (Step 4e)

All 15 findings (4 HIGH + 7 MEDIUM + 4 LOW) resolved in Step 4e (2026-05-26).

### CRI-01 — Resolved
- Fix: Created two separate `pg.Client` instances — `pgClient` for ingestion, `pgClientReconciliation` for erasure reconciliation — passed as dedicated arguments to each loop.
- Files modified: `conv-log/src/index.ts` (main() creates and connects both clients; runErasureLoop receives pgClientReconciliation); `conv-log/src/postgres.ts` (runErasureReconciliation signature unchanged — client isolation is at caller level).
- Verification: `tests/postgres-loop-isolation.test.ts` — 2 integration tests assert ROLLBACK on ingestion client does not roll back reconciliation client's committed work, and uncommitted ingestion rows are not visible to reconciliation client.

### CRI-02 — Resolved
- Fix: Added `CREATE TABLE IF NOT EXISTS schema_migrations (...)` at the top of `runMigrations` before the file loop, so fresh-DB startup no longer crashes.
- Files modified: `conv-log/src/postgres.ts` (top of runMigrations).
- Verification: `tests/postgres-fresh-migration.test.ts` — 4 tests on a completely empty Postgres (no manual bootstrap in beforeAll) assert runMigrations completes, records both migrations, and is idempotent.

### CRI-03 — Resolved
- Fix: Added `sanitizePgError(msg: string): string` helper that strips DETAIL lines and `Key (...)=(...)` substrings before slicing to 500 chars; called from single-row dead-letter path.
- Files modified: `conv-log/src/postgres.ts` (sanitizePgError exported; used in bisectAndUpsert dead-letter path).
- Verification: `tests/postgres-bisection.test.ts` — unit tests (3 new) cover DETAIL stripping, Key redaction, and truncation; integration test seeds unique-violation poison row and asserts messageId does not appear in error_detail.

### CRI-04 — Resolved
- Fix: Added `maxTimeMS: 60000` to erasure find(); abort chunk if Mongo returns 0 for chunk >erasureSafetyMinChunk OR deletionRatio >0.5; new `convlog_erasure_chunk_deleted_ratio` histogram; `CONVLOG_ERASURE_SAFETY_MIN_CHUNK` config var (default 100). Runaway erasure alert added to alerts.yml.
- Files modified: `conv-log/src/postgres.ts` (runErasureReconciliation + ErasureMetrics type); `conv-log/src/index.ts` (buildMetrics, loadConfig, erasureMetrics wiring); `monitoring/prometheus/alerts.yml` (ConvLogErasureRunaway alert); `.env.example`.
- Verification: Code-level — safety checks verified via grep of erasure_safety_abort path; alert rule in alerts.yml.

### CRI-05 — Resolved
- Fix: Moved `consecutiveFailures = 0`, `lastSuccessfulTickStartUnix = tickStartUnix`, and `onSuccessfulSync(new Date())` to immediately after `bisectAndUpsert` returns. Telemetry SELECT wrapped in inner try/catch with `phase: 'telemetry'` errors counted but not escalated.
- Files modified: `conv-log/src/index.ts` (runIngestionLoop).
- Verification: Code-level — structure change visible in runIngestionLoop; telemetry try/catch pattern verifiable by grep.

### CRI-06 — Resolved
- Fix: Introduced `backfillEnterThreshold` and `backfillExitThreshold = enterThreshold * hysteresisMultiplier` (default 0.5). State machine uses enter-threshold for entry, exit-threshold for exit. `CONVLOG_BACKFILL_EXIT_THRESHOLD_MULTIPLIER` env var added.
- Files modified: `conv-log/src/index.ts` (loadConfig, runIngestionLoop); `.env.example`.
- Verification: Code-level — two-threshold logic in runIngestionLoop verifiable by inspection.

### CRI-07 — Resolved
- Fix: Replaced `LIMIT $1 OFFSET $2` with keyset pagination `WHERE id > $lastId ORDER BY id LIMIT $1` in the erasure-reconciliation source-erasure pass. `lastId` captured before any deletions.
- Files modified: `conv-log/src/postgres.ts` (runErasureReconciliation, first pass loop).
- Verification: Code-level — keyset pattern verifiable in runErasureReconciliation; id column selected explicitly.

### CRI-08 — Resolved
- Fix: Registered `pgClient.on('error', ...)`, `pgClientReconciliation.on('error', ...)`, and `mongoClient.on('error', ...)` immediately after each client connects. Structured log payload (message + code only, no full error object to avoid URI leakage); metrics increment with phase label.
- Files modified: `conv-log/src/index.ts` (main()).
- Verification: Code-level — error handler registrations verifiable in main() after connect calls.

### CRI-09 — Resolved
- Fix: Added `depth` parameter to internal `attempt` function with cap `ceil(log2(batchSize)) + 2`. On cap exceeded: fast-fail all rows in sub-batch to dead_letter_log with `error_phase = 'bisection_overflow'`; `BisectMetrics` interface passed from index.ts; `convlog_bisection_max_depth_observed` gauge added. Structural dead-letter alert added to alerts.yml.
- Files modified: `conv-log/src/postgres.ts` (bisectAndUpsert, BisectMetrics type); `conv-log/src/index.ts` (buildMetrics, bisectMetrics wiring); `monitoring/prometheus/alerts.yml` (ConvLogDeadLetterStructuralFailure alert).
- Verification: Code-level — depth cap and bisection_overflow path verifiable in bisectAndUpsert; alert rule in alerts.yml.

### CRI-10 — Resolved
- Fix: (1) Exported `GUARDRAIL_COLLECTION = 'guardrailevents'` constant at top of mongo.ts. (2) fetchGuardrailEvents uses constant. (3) Startup pre-flight: `listCollections({ name: GUARDRAIL_COLLECTION })` — if absent, logs warn with remediation instruction and increments `convlog_errors_total{phase="config_guardrail_missing"}`. (4) README pre-deployment checklist added (in operator verification doc comment on the constant).
- Files modified: `conv-log/src/mongo.ts` (GUARDRAIL_COLLECTION constant, fetchGuardrailEvents); `conv-log/src/index.ts` (startup pre-flight check).
- Verification: Code-level — constant and pre-flight check verifiable by grep.

### CRI-11 — Resolved
- Fix: Restructured `runErasureLoop` — 60s settle sleep at startup, then `for (;;) { reconcile; sleep(24h); }` so first reconciliation runs within 60s of startup instead of 24h later.
- Files modified: `conv-log/src/index.ts` (runErasureLoop).
- Verification: Code-level — loop structure change verifiable in runErasureLoop.

### CRI-12 — Resolved
- Fix: `server.close()` wrapped in `await new Promise<void>((resolve) => server.close(() => resolve()))`.
- Files modified: `conv-log/src/index.ts` (shutdown()).
- Verification: Code-level — Promise wrapper verifiable in shutdown function.

### CRI-13 — Resolved
- Fix: Replaced `` `SET statement_timeout = ${timeoutMs}` `` with `SELECT set_config($1, $2, false)` parameterized call.
- Files modified: `conv-log/src/postgres.ts` (connectPgClient).
- Verification: Code-level — set_config pattern verifiable in connectPgClient.

### CRI-14 — Resolved
- Fix: `main().catch` replaced with `process.stderr.write(err instanceof Error ? err.message : String(err))` to avoid full object serialization. `pino` logger initialized with `redact: ['*Uri', 'config.*Uri']`.
- Files modified: `conv-log/src/index.ts` (main().catch and pino initialization).
- Verification: Code-level — stderr.write pattern and pino redact config verifiable by grep.

### CRI-15 — Resolved (verified, no deepening needed)
- Fix: Read `tests/field-mapping-drift.test.ts` in full. The test is bidirectional: (a) every code-referenced source field must appear in docs/field-mapping.md; (b) every documented source field must be referenced in code. Both directions implemented with regex extraction + backstop allow-list. No structural weaknesses found.
- Files modified: None (test was already correct).
- Verification: Test file verified bidirectional by reading parseDocumentedFields() + parseCodeReferencedFields() + both `it` blocks.

---

### Defensive normalization (§4.2 follow-up) — Resolved
- Fix: `normaliseMessage` now returns `null` for documents with empty/missing `messageId` or invalid `createdAt`. `fetchMessageBatch` filters nulls and calls `onNormalisationSkip` callback (increments `convlog_errors_total{phase="normalisation"}` and logs warn with doc `_id`). `assembleBatch` and callers in `index.ts` updated.
- Files modified: `conv-log/src/mongo.ts` (normaliseMessage, fetchMessageBatch, assembleBatch); `conv-log/src/index.ts` (assembleBatch call with callback).
- Verification: Code-level — null-return guard and filter verifiable in normaliseMessage and fetchMessageBatch.
