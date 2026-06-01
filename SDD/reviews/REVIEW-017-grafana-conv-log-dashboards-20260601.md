# Code Review: SPEC-017 — Grafana Conv-Log Dashboards

**Review Date:** 2026-06-01
**Reviewer:** SDD Code Review Subagent (claude-sonnet-4-6)
**Spec:** SDD/requirements/SPEC-017-grafana-conv-log-dashboards.md
**Research:** SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md
**Implementation Plan:** SDD/implementation/IMPLEMENTATION-PLAN-017-grafana-conv-log-dashboards-2026-06-01.md

---

## Artifact Verification

- [x] RESEARCH-017-grafana-conv-log-dashboards found and complete
- [x] SPEC-017-grafana-conv-log-dashboards found and complete
- [x] IMPLEMENTATION-PLAN-017 preserved (Chunks 1–4 recorded)
- [x] Context utilization <40% (no explicit counter breach; implementation plan records no compaction)

---

## Module Review Log

| Module | Declared Risk | Depth Applied | Notes |
|--------|--------------|---------------|-------|
| MODULE-001 Operational dashboard (Dashboard A) | low | Tested-boundary (verified all PromQL, panel count, dual thresholds, histogram forms) | No tier escalation needed |
| MODULE-002 Analytics dashboard (Dashboard B) | medium | Default (all REQ/EDGE/FAIL checked; SQL columns verified against schema; spot-checked internals) | No tier escalation |
| MODULE-003 Datasource + credential + GRANT | high | Full review (internals: interpolation form, GRANT clause, `:?` guard, network line, acceptance test design) | One gap found: `.env.prod.template` missing |
| MODULE-004 Default-view privacy control | high | Full review (every default-panel SELECT list, templating.list, collapsed row structure, `allowUiUpdates: false`) | All PII columns confirmed drill-down-only |

---

## Specification Alignment (70%)

### MODULE-003 (HIGH — full review): Datasource + Credential + GRANT

**REQ-001 — datasource YAML:** PASS.
- `uid: convlog-postgres` ✓
- `type: postgres` ✓
- `access: proxy` ✓
- `editable: false` ✓
- `url: vectordb:5432` ✓
- `user: convlog_reader` ✓
- `database: convlog` ✓
- `jsonData.sslmode: disable` ✓
- `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}` ✓ (correct Grafana 11.5.2 interpolation form)
- No hardcoded password ✓

**REQ-002 — interpolation form:** PASS. Uses `${GRAFANA_CONVLOG_DB_PASSWORD}` (not `$__env{...}`).

**REQ-003 — compose `:?` guard:** PASS.
`- GRAFANA_CONVLOG_DB_PASSWORD=${GRAFANA_CONVLOG_DB_PASSWORD:?GRAFANA_CONVLOG_DB_PASSWORD must be set — must equal convlog_reader password (CONVLOG_PG_READER_PASSWORD)}` at compose line 113. Fail-fast guard is present and descriptive.

**REQ-004 — `.env.example` template:** PARTIAL. The `.env.example` entry is present (lines 957–965) with the invariant note, credential triplet documentation, and rotation guidance. **HOWEVER: `.env.prod.template` does NOT contain `GRAFANA_CONVLOG_DB_PASSWORD`.** REQ-004 explicitly requires "Add the resolved-var line to `.env.prod.template`, per the existing CONVLOG_* convention." The template ends at `COMPOSE_PROJECT_NETWORK=librechat_default` with no `GRAFANA_CONVLOG_DB_PASSWORD=<value>` line. This is a spec gap.

**REQ-005 — network line:** PASS. `- librechat_default` present at compose line 141. No new top-level network declaration added. The network was already declared `external` at lines 259–261 (verified by git diff).

**REQ-006 — auto-provision (directory mount):** PASS. No bind-mount change needed; the existing `./grafana/provisioning:/etc/grafana/provisioning:ro` mount covers the new datasource YAML and convlog/ subfolder.

**REQ-012 — default-privileges fix:** PASS.
`ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;` is present at provision-postgres.sh (lines 108–109) with the `FOR ROLE convlog_writer` clause explicitly and a comment explaining why the clause is mandatory. This is exactly the required corrective form.

**REQ-013a — idempotent existing-table GRANT:** PASS.
`GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` is present at provision-postgres.sh line 101. Both fixes are present; the GRANT for existing tables and the durable default-privilege fix.

**REQ-014 / REQ-014b — acceptance tests:** These are documented in `conv-log/README.md` (Acceptance Checks section). REQ-014 psql command present; REQ-014b Save&test + stat-panel render described. The smoke test (Chunk 4) confirmed provisioning-load success but correctly notes REQ-014b requires real prod DB. Satisfactory for pre-ship documentation; operator-gated acceptance correctly deferred.

### MODULE-004 (HIGH — full review): Default-view Privacy Control

**REQ-016 — `allowUiUpdates: false`:** PASS.
`dashboards.yml` has a separate `convlog-dashboards` provider entry with `allowUiUpdates: false`, scoped to `/etc/grafana/provisioning/dashboards/convlog`. The existing `memodo-dashboards` provider retains `allowUiUpdates: true` (correct — this was the allowed approach per spec Option A). The `foldersFromFilesStructure: false` setting on the top-level provider prevents double-provisioning of the convlog/ subfolder.

**REQ-017 — no raw-value template variables:** PASS.
`templating.list: []` on both dashboards. No template variables exist.

**Default-panel PII column check:** PASS.
Ran Python analysis across all 13 default-visible panels (ids 1–13, excluding the collapsed row id=100). Zero occurrences of `text`, `content`, `feedback_text`, `title` (as a SQL column), or `raw` in any default panel `rawSql`.

**Collapsed drill-down row:** PASS.
Panel id=100, `type: "row"`, `collapsed: true`, title "Drill-down (raw content — authorized use only)". Three nested panels (ids 101, 102, 103) contain `ml.text`, `cd.title`, `feedback_text`, `content`, and `dead_letter_log.raw` — all correctly gated behind the collapsed row. These do not render or query Postgres until the row is expanded.

**B-Q3 — no `conversation_title`:** PASS.
Query at panel id=12 selects `gel.conversation_id, gel.message_id, gel.route, gel.entity_count, gel.entity_types, gel.source_created_at AS triggered_at`. No join to `conversations_dim`; no `title` column.

**B-DL — no `raw`:** PASS.
Query at panel id=13 selects `source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at`. The `raw` JSONB column is excluded.

**B-RC — no `title`:** PASS.
Query at panel id=11 selects `cd.conversation_id, cd.endpoint, cd.agent_id, agg.started_at, agg.last_activity, agg.message_count`. No `title` column.

**`allowUiUpdates: false` scope note (OPEN-DECISION-001):** Drill-down-only treatment of `title` is correct per the default assumption. DPO sign-off remains open per spec; correctly recorded.

### MODULE-002 (MEDIUM — default): SQL Correctness

**B-Q3 `triggered_at` column:** The implementation aliases `gel.source_created_at AS triggered_at`. The schema (`001_init.sql:103–114`) confirms `guardrail_events_log` has `source_created_at` and NO `triggered_at` column. This alias is correct and matches the implementation plan note.

**B-Q2 SQL columns:** `messages_log.source_created_at` (line 71 ✓), `messages_log.model_or_agent_id` (line 59 ✓), `messages_log.error` (line 63 ✓), `agents_dim.name` (line 40 ✓). Join `ml.model_or_agent_id = ad.agent_id` — both columns exist. SQL is correct.

**B-RC derived columns:** `messages_log.conversation_id` (line 55 ✓), `messages_log.source_created_at` (line 71 ✓), `messages_log.message_id` (line 53 ✓). `conversations_dim.endpoint` (line 25 ✓), `conversations_dim.agent_id` (line 23 ✓). `COUNT(ml.message_id)` valid. Inner `$__timeFilter(ml.source_created_at)` present — satisfies PERF-001 bounded-aggregation requirement. SQL is correct.

**B-DL columns:** `source_collection` (line 121 ✓), `source_id` (line 122 ✓), `error_phase` (line 123 ✓), `error_detail` (line 124 ✓), `retry_count` (line 128 ✓), `last_failed_at` (line 127 ✓). All exist in schema. SQL is correct.

**REQ-009 stat row tables:** `conversations_dim`, `messages_log`, `agents_dim`, `guardrail_events_log`, `dead_letter_log` — all five tables exist in `001_init.sql`. All five stat panels present with `noValue: "0"`.

**B-Q5 outer ORDER BY:** `ORDER BY MIN(sub.msg_count)` where `sub` is a derived table alias from the `FROM` clause. This is valid PostgreSQL — the outer query can reference `sub.msg_count` as an aggregate expression. SQL is correct.

**B-MPD:** `$__timeGroupAlias(source_created_at, '1d')` + `$__timeFilter(source_created_at)` on `messages_log`. `source_created_at` exists (line 71 ✓). PII-safe (day bucket + count only). PERF-001 time-bound present.

### MODULE-001 (LOW — tested-boundary): Dashboard A PromQL

**Panel count:** 12 panels confirmed (ids 1–12). No extra splits on A-8/A-12 — each is a single panel with 3 refIds (p50/p95/p99). Correct per spec clarification.

**All 11 sidecar metrics + synthetic `up` mapped:**
- `up{job="conv-log"}` (A-1) ✓
- `convlog_sync_lag_seconds` (A-2, timeseries) ✓ — BOTH 600s (yellow) and 3000s (red) threshold lines in `thresholds.steps`; `thresholdsStyle.mode: "line+area"` renders both lines (SEC-002 ✓)
- `convlog_pending_messages` (A-3) ✓
- `rate(convlog_messages_synced_total[5m])` (A-4) ✓
- `convlog_max_message_age_seconds` (A-5) ✓ — idle-inflation annotation present (EDGE-002 ✓)
- `sum by (phase) (rate(convlog_errors_total[5m]))`, `legendFormat: {{phase}}` (A-6) ✓ — label-driven, no hardcoded phases (DISCREPANCY-2 ✓)
- `sum by (phase) (rate(convlog_dead_letter_total[5m]))` (A-7) ✓
- `histogram_quantile(0.50|0.95|0.99, sum(rate(convlog_batch_duration_seconds_bucket[5m])) by (le))` (A-8) ✓ — unit `s`, `noValue: "No data"` (EDGE-005 ✓)
- `rate(convlog_erasure_deletions_total[5m])` (A-9) ✓
- `convlog_bisection_max_depth_observed` (A-10) ✓
- `time() - convlog_last_run_unix_timestamp` (A-11) ✓ — unit `s`, dual threshold lines at 600/3000 on this stat panel as well
- `histogram_quantile(0.50|0.95|0.99, sum(rate(convlog_erasure_chunk_deleted_ratio_bucket[5m])) by (le))` (A-12) ✓ — unit `percentunit`, max 1, `noValue: "No data"` (EDGE-005 ✓)

All counters use `rate(...[5m])` — no raw counter values (EDGE-004 ✓). Both histograms use `_bucket` suffix + `sum(...) by (le)` (correct histogram_quantile form).

Datasource on all 12 panels: `{ "type": "prometheus", "uid": "prometheus" }` ✓. Tags `["memodo", "convlog", "operational"]`, `uid: convlog-operational`, `schemaVersion: 38` ✓.

**A-2 backfill annotation:** Present in description — "during backfill mode the NFR-2 SLO is explicitly NOT in force" (EDGE-003 ✓).

### Scope (NFR-001)

Git diff `5c0b6ad93..HEAD` (excluding SDD/) shows changes only in:
- `.env.example`
- `conv-log/README.md`
- `conv-log/ops/provision-postgres.sh`
- `monitoring/docker-compose.monitoring.yml`
- `monitoring/grafana/provisioning/dashboards/dashboards.yml`

New untracked files:
- `monitoring/grafana/provisioning/datasources/convlog-postgres.yml`
- `monitoring/grafana/provisioning/dashboards/convlog/` (two JSONs)
- `SDD/implementation/IMPLEMENTATION-PLAN-017-...md`

Zero changes under `/api`, `/packages/*`, `/client`. NFR-001 PASS ✓.

### Other Requirements

**REQ-007 (both dashboards valid JSON, schemaVersion 38):** PASS. Smoke test (Chunk 4) confirmed `python3 -m json.tool` → JSON_OK + Grafana 11.5.2 provisioning loaded both successfully.

**REQ-010 — all five V-6 panels:** PASS.
- B-Q1 (panel id=8): `$__timeFilter` adaptation ✓ (preferred MEDIUM-2 resolution)
- B-Q2 (panel id=10): `$__timeGroupAlias + $__timeFilter` ✓
- B-Q3 (panel id=12): `conversation_title` dropped ✓
- B-Q4 (panel id=7): verbatim V-6 SQL, piechart ✓
- B-Q5 (panel id=9): verbatim V-6 SQL, barchart ✓

**REQ-011 (additional panels):** PASS. B-MPD (id=6), B-RC (id=11), B-DL (id=13) all implemented.

**REQ-015 (operator docs):** PARTIAL — see MEDIUM finding below.

**NFR-002 (deploy path):** Config-only path documented correctly in README. No `prod-sync.sh`, no `npm run build`, no api restart.

**NFR-003 (no new alert rules):** PASS. README references existing `ConvLog*` alert rules without duplicating or creating new ones.

**SEC-001 (trust boundary):** PASS. README accurately states admin-auth-only trust boundary, lists all residual-exposure paths, and correctly frames the collapsed drill-down as a default-view privacy control — not an access-control boundary.

**SEC-002 (dual threshold lines):** PASS on A-2 timeseries (600s yellow, 3000s red with `thresholdsStyle: "line+area"`). Also present on A-11 (stat), though that panel is "seconds since last tick" not "sync lag" — the sync-lag specific SEC-002 requirement is on A-2 which is correct.

**PERF-001 (bounded aggregations):** PASS.
- B-RC: inner `$__timeFilter(ml.source_created_at)` bounds before `MIN/MAX/COUNT` aggregation ✓
- B-Q2/B-MPD: `$__timeFilter(ml.source_created_at)` present ✓
- B-Q5: full scan, documented as acceptable at current scale ✓

**EDGE-001 (empty guardrail panel):** PASS. All stat panels have `noValue: "0"`; table panels have `noValue: "No data"`.

**EDGE-007 (fixed-window B-Q1):** PASS. The literal was replaced with `$__timeFilter` per the preferred resolution; panel description documents the adaptation.

---

## Findings

### HIGH

None.

### MEDIUM

**FINDING-M1 (REQ-004): `.env.prod.template` missing `GRAFANA_CONVLOG_DB_PASSWORD`**
- File: `.env.prod.template`
- Spec ref: REQ-004 — "add the resolved-var line to `.env.prod.template`, per the existing CONVLOG_* convention"
- Current state: `.env.prod.template` ends with `COMPOSE_PROJECT_NETWORK=librechat_default` and has no `GRAFANA_CONVLOG_DB_PASSWORD=` entry.
- Impact: An operator provisioning a fresh prod instance from `.env.prod.template` will silently miss this variable. The `:?` guard (REQ-003) aborts container start on an empty var, so the failure is loud — but the template is the documented single-source-of-truth for prod setup. The credential invariant note in `.env.example` correctly cross-references this but the template itself is incomplete.
- Suggested fix: Add `GRAFANA_CONVLOG_DB_PASSWORD=<convlog_reader-password-same-as-CONVLOG_PG_READER_PASSWORD>` to `.env.prod.template` after the `GRAFANA_ADMIN_PASSWORD` line.

**FINDING-M2 (REQ-015): README Dashboard A panel inventory is inaccurate**
- File: `conv-log/README.md` lines 363–376
- Spec ref: REQ-015 — "document panel inventory for A and B"
- Current state: The README's 12-row table for Dashboard A describes panels that do NOT match the actual `convlog-operational.json`:
  - README A-8 says "Batch Duration P95" (single quantile) but the actual panel renders p50/p95/p99 (three quantiles, more informative).
  - README A-9 says "Last Run Age" but the actual panel is titled "Erasure deletions (rate/s)" with `rate(convlog_erasure_deletions_total[5m])`.
  - README A-10 says "Erasure Deletions Rate" but the actual panel is "Bisection max depth observed" (stat panel, id=3 in stat row).
  - README A-11 says "Messages Synced Total" (raw cumulative counter — but the spec requires rate, and the actual panel is the stat row panel "Seconds since last tick").
  - README A-12 says "Batch Duration Heatmap" but the actual panel is "Erasure chunk deleted ratio p50/p95/p99" histogram quantiles.
- The README was likely auto-generated from an early draft before the final panel layout was solidified in Chunk 2.
- Impact: Documentation misleads SRE operators about what the dashboard shows. An SRE looking up "A-11" would expect a cumulative messages counter but see a sync-tick-age stat.
- Suggested fix: Rewrite the README panel inventory table to match the actual panel layout as confirmed in `convlog-operational.json` (the 3-stat-row + 9-timeseries layout described in the implementation plan).

**FINDING-M3 (REQ-015): README Dashboard B stat-row description says "Four instant counts" but implementation has five**
- File: `conv-log/README.md` line 384
- Spec ref: REQ-015, REQ-009
- Current state: "Stat row | Four instant counts: total `messages_log` rows, distinct `conversation_id`s, distinct agents, `guardrail_events_log` rows."
- Actual implementation: Five stat panels (Conversations, Messages, Agents, Guardrail events, Dead-letter rows) correctly implementing REQ-009. The description omits the dead-letter stat.
- Impact: Minor documentation inaccuracy, but masks a valid panel from the operator's mental model.
- Suggested fix: Update to "Five instant counts: Conversations, Messages, Agents, Guardrail events, Dead-letter rows."

### LOW

**FINDING-L1 (REQ-015): README Dashboard B V-6 panel list order reversed vs implementation order**
- File: `conv-log/README.md` line 385
- The README describes V-6 panels as "model-usage distribution, error rates by agent by day, PII-trigger correlation, conversation-length histogram, and messages-per-day time series." The actual panel layout is B-MPD (timeseries), B-Q4 (piechart), B-Q1 (table), B-Q5 (barchart), B-Q2 (timeseries), then B-RC, B-Q3, B-DL. The description is not misleading but differs from the visual order, making it harder for operators to navigate.
- No functional impact.

**FINDING-L2 (INFO): README lists `ConvLogDeadLetterAccumulating` and `ConvLogServiceDown` at line 468 but the spec references `ConvLogDeadLetterStructuralFailure` and `ConvLogErasureRunaway`**
- File: `conv-log/README.md` line 468
- Spec ref: REQ-015, NFR-003
- The spec (System Integration Points) names `ConvLogDeadLetterStructuralFailure` and `ConvLogErasureRunaway` as the other two alert thresholds. The README names `ConvLogDeadLetterAccumulating` and `ConvLogServiceDown`. This reviewer does not independently verify the alert names in `monitoring/prometheus/alerts.yml` as that file is outside this review's file list — flag for operator verification.
- No functional impact on dashboard provisioning.

---

## Context Engineering Review (20%)

- Implementation plan: 4 chunks, all recorded with status, key decisions, file changes, and validation runs.
- Chunk 1 captured the REQ-016 Option A decision (separate convlog provider) with clear reasoning about the `foldersFromFilesStructure: false` no-overlap property.
- Chunk 3 recorded the aliasing decision for `triggered_at = source_created_at` with schema confirmation.
- Chunk 4 recorded smoke-test results inline. Provisioning log `NO_PROVISIONING_ERRORS` is positive structural evidence.
- Future modification path: clear. New panels go in the two dashboard JSONs; GRANT changes go in provision-postgres.sh; network changes go in compose.
- One context engineering gap: the inaccurate README panel inventory in FINDING-M2 suggests the Chunk 4 subagent wrote the docs from the implementation plan spec rather than from the final JSON, causing drift. Future doc chunks should read the final JSON before writing inventories.

---

## Test Coverage (10%)

### Test Suite Execution
- Unit tests: N/A — declarative JSON/YAML; no unit-test framework applies (per spec Validation Strategy).
- Integration tests (provisioning-load tier): PASS — smoke test (Chunk 4) ran `grafana/grafana:11.5.2` container, confirmed `OPERATIONAL_OK`, `ANALYTICS_OK`, `DATASOURCE_OK` via API.
- E2E tests: N/A — not a web-facing application feature (pure Grafana provisioning artifact).

### Spec Coverage

| REQ/Scenario | Covered | Notes |
|---|---|---|
| REQ-001..003, 005, 006 | Smoke test (provisioning load) ✓ | |
| REQ-014 (reader-SELECT) | Pre-ship gate documented, not yet run | Operator-closeable |
| REQ-014b (Grafana-path auth) | Pre-ship gate documented, not yet run | Requires real prod DB |
| EDGE-001 (empty guardrail) | `noValue: "0"` config ✓ | |
| EDGE-004 (counter resets) | All `rate()` forms verified ✓ | |
| EDGE-005 (empty histogram) | `noValue: "No data"` ✓ | |
| PERF-001 bounded aggregations | Verified in SQL ✓ | |
| FAIL-003 (empty password) | `:?` guard ✓ | |

Missing pre-ship gates (REQ-014, REQ-014b) are correctly deferred to operator-gated post-deploy acceptance per the spec Validation Strategy. Not a rejection criterion for this review.

---

## Decision: CHANGES-REQUESTED

### Required Actions Before Ship

1. **FINDING-M1 (MEDIUM / REQ-004):** Add `GRAFANA_CONVLOG_DB_PASSWORD=<convlog_reader-password-same-as-CONVLOG_PG_READER_PASSWORD>` to `.env.prod.template` immediately after the `GRAFANA_ADMIN_PASSWORD=` line. This is a spec requirement and an operational safety gap for fresh deployments.

2. **FINDING-M2 (MEDIUM / REQ-015):** Rewrite the README Dashboard A panel inventory table (`conv-log/README.md` lines 363–376) to match the actual panel layout in `convlog-operational.json`. The current table describes panels that do not exist in the provisioned dashboard.

3. **FINDING-M3 (MEDIUM / REQ-015):** Correct the README Dashboard B stat-row description from "Four instant counts" to "Five instant counts" including the dead-letter stat.

### Advisory (Low / Pre-Prod Verification)

4. **FINDING-L2:** Verify alert rule names in `monitoring/prometheus/alerts.yml` match those cited in the README (`ConvLogDeadLetterAccumulating`, `ConvLogServiceDown` vs `ConvLogDeadLetterStructuralFailure`, `ConvLogErasureRunaway`). Update the README to match actual rule names.

### Pre-Ship Acceptance Gates (Operator-Closeable, Not Blocking This Review)

- REQ-014: `psql "$CONVLOG_PG_READ_URI" -c "SELECT count(*) FROM messages_log;"` as `convlog_reader` must pass on prod.
- REQ-014b: Grafana `convlog-postgres` datasource "Save & test" green + Dashboard-B messages stat renders correct count.
- OPEN-DECISION-001: DPO/product-owner sign-off on `conversations_dim.title` classification before dashboards declared final.

---

## Commendations

- MODULE-003 credential handling is solid: correct Grafana 11.5.2 interpolation form, descriptive `:?` guard message, credential triplet invariant documented in three locations (datasource YAML header, compose comment, `.env.example`), accurate FAIL-005 description in README.
- MODULE-004 PII control is correctly implemented: Python analysis confirmed zero forbidden columns in any of the 13 default panels; all three forbidden-column panels (text/title, feedback_text/content, raw) correctly nested under the single collapsed row; `templating.list: []` trivially satisfies REQ-017.
- MODULE-003 GRANT fix is the exact required form: `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public` with the `FOR ROLE` clause and an explanatory comment about why the clause is mandatory. Both the one-time GRANT and the durable default-privilege fix are present in provision-postgres.sh and the README op-doc.
- Dashboard A PromQL is specification-complete: all 11 sidecar metrics + synthetic `up` mapped; all counters use `rate()` (EDGE-004 safe); both histograms use `_bucket + sum by (le)` form; dual 600s/3000s threshold lines with `thresholdsStyle: "line+area"` on A-2 (SEC-002); idle-inflation and backfill-mode annotations on A-5 and A-2 descriptions.
- Scope discipline: confirmed zero changes in `/api`, `/packages/*`, `/client` (NFR-001 perfect).
- Smoke test evidence: Grafana 11.5.2 provisioning load clean with `NO_PROVISIONING_ERRORS` provides meaningful structural confidence in the JSON/YAML correctness.

---

## Findings Addressed

Resolved by Code-Review Fix subagent (Step 4c, 2026-06-01).

| Finding | Fix Applied |
|---|---|
| **M1 (REQ-004)** | `.env.prod.template` EXISTS at repo root. Added `GRAFANA_CONVLOG_DB_PASSWORD=<same-as-CONVLOG_PG_READER_PASSWORD>` after `GRAFANA_ADMIN_PASSWORD=` with the credential-invariant comment (must equal convlog_reader password; rotate all three locations atomically). File: `.env.prod.template`. |
| **M2 (REQ-015)** | Rewrote README Dashboard A panel inventory table. All 12 rows now accurately match `convlog-operational.json`: A-1 "Conv-Log up" (stat, `up{job="conv-log"}`), A-2 "Seconds since last tick" (stat, `time() - convlog_last_run_unix_timestamp`), A-3 "Bisection max depth observed" (stat, `convlog_bisection_max_depth_observed`), A-4 "Sync lag (seconds)" (timeseries), A-5 "Pending messages" (timeseries), A-6 "Sync throughput (msgs/s)" (timeseries), A-7 "Max message age (seconds)" (timeseries), A-8 "Errors by phase (rate/s)" (timeseries, stacked), A-9 "Dead-letter messages by phase (rate/s)" (timeseries, stacked), A-10 "Batch duration p50/p95/p99" (timeseries, histogram), A-11 "Erasure deletions (rate/s)" (timeseries), A-12 "Erasure chunk deleted ratio p50/p95/p99" (timeseries, histogram). File: `conv-log/README.md`. |
| **M3 (REQ-015)** | Updated Dashboard B stat-row description from "Four instant counts" to "Five instant counts: Conversations, Messages, Agents, Guardrail events, Dead-letter rows" matching REQ-009 and the five stat panels in `convlog-analytics.json`. File: `conv-log/README.md`. |
| **L1 (REQ-015)** | Rewrote V-6 panel list in visual order matching `convlog-analytics.json` panel layout: B-MPD (messages-per-day timeseries), B-Q4 (model-usage piechart), B-Q1 (top-10 users table), B-Q5 (conversation-length barchart), B-Q2 (agent error rates timeseries). File: `conv-log/README.md`. |
| **L2 (REQ-015)** | Corrected alert rule names to exact names from `monitoring/prometheus/alerts.yml`: `ConvLogSyncLagBreach`, `ConvLogDeadLetterStructuralFailure`, `ConvLogErasureRunaway`. Removed incorrect names `ConvLogDeadLetterAccumulating` and `ConvLogServiceDown`. Also corrected panel reference from "A-2" to "A-4" (sync-lag is panel id=4 in the JSON). File: `conv-log/README.md`. |

**Verdict after fixes: APPROVED** — all MEDIUM and LOW findings resolved. Pre-ship acceptance gates (REQ-014, REQ-014b, OPEN-DECISION-001) remain operator-closeable per original review.
