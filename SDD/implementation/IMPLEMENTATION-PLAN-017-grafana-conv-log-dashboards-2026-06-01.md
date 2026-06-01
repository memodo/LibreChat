# IMPLEMENTATION-PLAN-017-grafana-conv-log-dashboards-2026-06-01

## Executive Summary

- **Based on Specification:** SPEC-017-grafana-conv-log-dashboards.md
- **Research Foundation:** RESEARCH-017-grafana-conv-log-dashboards.md
- **Start Date:** 2026-06-01
- **Completion Date:** 2026-06-01
- **Implementation Duration:** 1 day
- **Author:** Claude (with Pablo Oliva)
- **Status:** Complete

## Feature
SPEC-017 — Grafana conv-log dashboards (datasource + Dashboard A + Dashboard B)

## Delivery Mode
Whole-feature, split into chunks executed by sequential subagents

## REQ-016 Decision (recorded here for all subsequent chunks)
**Option A selected.**

`dashboards.yml` uses `foldersFromFilesStructure: false` and a single flat `path:
/etc/grafana/provisioning/dashboards` — with `foldersFromFilesStructure: false`, Grafana does
NOT recurse into subdirectories, so a `convlog/` subfolder is NOT scanned by the existing
provider. No double-provisioning risk.

**Dashboard-JSON target directory:**
`monitoring/grafana/provisioning/dashboards/convlog/`

Files that later chunks MUST write there:
- `monitoring/grafana/provisioning/dashboards/convlog/convlog-operational.json` (Dashboard A)
- `monitoring/grafana/provisioning/dashboards/convlog/convlog-analytics.json` (Dashboard B)

The new provider entry (added to `dashboards.yml` in Chunk 1) points to
`/etc/grafana/provisioning/dashboards/convlog` with `allowUiUpdates: false` and
Grafana folder name `Conv-Log`.

---

## Chunk 1 — Infrastructure / MODULE-003 (this chunk)
**Subagent:** 4a-1 | **Date:** 2026-06-01 | **Status:** COMPLETE

### Files created/modified
| File | Action | REQs |
|---|---|---|
| `monitoring/grafana/provisioning/datasources/convlog-postgres.yml` | Created | REQ-001, REQ-002 |
| `monitoring/grafana/provisioning/dashboards/dashboards.yml` | Modified — added convlog provider | REQ-016 |
| `monitoring/docker-compose.monitoring.yml` | Modified — env var + network line | REQ-003, REQ-005 |
| `.env.example` | Modified — GRAFANA_CONVLOG_DB_PASSWORD template | REQ-004 |
| `conv-log/ops/provision-postgres.sh` | Modified — GRANT fix | REQ-012, REQ-013a |

### Key decisions
- REQ-016: Option A (separate provider entry for convlog subfolder)
- Dashboard JSON target: `monitoring/grafana/provisioning/dashboards/convlog/`
- `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}` — Grafana 11.5.2 form
- `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` + `GRANT SELECT ON ALL TABLES` both added
- No hardcoded secrets anywhere

### Validation run
- YAML lint via python3 on all modified/created YAML files
- `docker compose config -q` on the compose file

---

## Chunk 2 — Dashboard A (MODULE-001, operational, Prometheus-backed)
**Subagent:** 4a-2 | **Date:** 2026-06-01 | **Status:** COMPLETE

### Files to create
- `monitoring/grafana/provisioning/dashboards/convlog/convlog-operational.json`

### REQs
REQ-007, REQ-008, NFR-003, SEC-002 (dual threshold lines 600s + 3000s), EDGE-002,
EDGE-003, EDGE-004, EDGE-005, FAIL-004

### Files created
| File | Action | REQs |
|---|---|---|
| `monitoring/grafana/provisioning/dashboards/convlog/convlog-operational.json` | Created | REQ-007, REQ-008 |

### Key decisions
- 12 panel objects: ids 1-12 (3 stat + 9 timeseries)
- Stat row (y=0): A-1 (up, id=1), A-11 (seconds since last tick, id=2), A-10 (bisection max depth, id=3)
- Timeseries rows: A-2 sync-lag (id=4), A-3 pending (id=5), A-4 throughput (id=6), A-5 max age (id=7), A-6 errors (id=8), A-7 dead-letter (id=9), A-8 batch-duration-p50/p95/p99 (id=10, 3 queries), A-9 erasure-deletions (id=11), A-12 erasure-ratio-p50/p95/p99 (id=12, 3 queries)
- A-2 dual thresholds: `fieldConfig.defaults.thresholds.steps` at 600s (yellow) + 3000s (red) + `custom.thresholdsStyle.mode: "line+area"` — both lines render visibly on the timeseries
- All counters use `rate(...[5m])`; all histograms use `histogram_quantile(q, sum(rate(_bucket[5m])) by (le))`
- `noValue: "No data"` on A-8 (id=10) and A-12 (id=12) for EDGE-005/FAIL-004 graceful empty render
- Datasource form: `{ "type": "prometheus", "uid": "prometheus" }` — mirrors mongodb.json exactly
- Tags: `["memodo", "convlog", "operational"]`, uid: `convlog-operational`, schemaVersion: 38

### Validation run
- `python3 -m json.tool ... > /dev/null && echo JSON_OK` → JSON_OK
- Panel count confirmed: 12
- All datasource refs: `{ "type": "prometheus", "uid": "prometheus" }` on all 12 panels
- No raw counter values (rate() on all _total metrics)
- Histogram panels (id=10,12) each have 3 refIds (A/B/C) for p50/p95/p99
- A-2 thresholds: steps at null(green)/600(yellow)/3000(red) with thresholdsStyle line+area

---

## Chunk 3 — Dashboard B (MODULE-002 + MODULE-004, analytics, Postgres-backed)
**Subagent:** TBD | **Date:** TBD | **Status:** PENDING

### Files to create
- `monitoring/grafana/provisioning/dashboards/convlog/convlog-analytics.json`

### REQs
REQ-007, REQ-009, REQ-010, REQ-011, REQ-017, SEC-001, PERF-001, OPEN-DECISION-001,
EDGE-001, EDGE-006, EDGE-007

### Notes for subagent
- Stat row (REQ-009): 5 count(*) panels over 5 tables — `noValue` friendly
- V-6 panels (REQ-010): B-Q1 use `$__timeFilter` (preferred) or document fixed window;
  B-Q2 `$__timeGroupAlias + $__timeFilter`; B-Q3 no `conversation_title`;
  B-Q4/B-Q5 verbatim SQL
- Additional (REQ-011): B-MPD timeseries, B-RC recent-conversations (no `title`),
  B-DL dead-letter (no `raw`)
- PERF-001: B-RC must bound with `$__timeFilter` before MIN/MAX/COUNT aggregation
- Single collapsed drill-down row at bottom (SEC-001): raw content panels here only
- No template variables that enumerate PII columns (REQ-017)
- Datasource: `convlog-postgres` (uid from Chunk 1)
- Tags: `["memodo", "convlog", "analytics"]`
- `schemaVersion: 38`, uid: `convlog-analytics`

---

## Chunk 4 — Operator docs (REQ-015)
**Subagent:** TBD | **Date:** TBD | **Status:** PENDING

### Files to modify
- `conv-log/README.md` — new "Grafana Dashboards" section

### REQs
REQ-015

### Notes for subagent
Section must cover: dashboard URLs, panel inventory A + B, trust boundary (admin-auth-only),
default-view privacy control (collapsed row, NOT an access-control boundary),
enumerated residual-exposure paths (Explore/ad-hoc/query inspector/CSV/datasources API/
template-variable dropdowns), GRAFANA_CONVLOG_DB_PASSWORD credential invariant
(must equal CONVLOG_PG_READER_PASSWORD, three-location single-source-of-truth, atomic
rotation), one-time prod GRANT commands (REQ-013b + REQ-013c), auto-provision/deploy steps,
ConvLog* alert threshold annotation reference (not new rules).

## Chunk 3 — Dashboard B (analytics, Postgres-backed) — DONE

**File:** `monitoring/grafana/provisioning/dashboards/convlog/convlog-analytics.json` (valid JSON, `python3 -m json.tool` → JSON_OK). uid `convlog-analytics`, title "Conv-Log — Analytics", tags `["memodo","convlog","analytics"]`, `schemaVersion: 38`, time `now-30d`, refresh `5m`, `templating.list: []` (REQ-017: no template variables). All 16 panel `datasource` refs = `{ "type": "postgres", "uid": "convlog-postgres" }` (exact match to `convlog-postgres.yml`).

**Default-visible panels (13) — outside the collapsed row, PII-safe:**
- Stat row (REQ-009): Conversations / Messages / Agents / Guardrail events / Dead-letter — `count(*)` per table, `noValue:"0"` (EDGE-001).
- B-MPD messages-per-day (REQ-011): timeseries, `$__timeGroupAlias(source_created_at,'1d')` + `$__timeFilter`, day-bucket + count only.
- B-Q1 top-10 users (REQ-010): table; **adapted** — literal `INTERVAL '30 days'` → `$__timeFilter(source_created_at)` (REQ-010 preferred, MEDIUM-2).
- B-Q4 model-usage distribution (REQ-010): piechart, verbatim V-6 Q4.
- B-Q5 conversation-length histogram (REQ-010): barchart, verbatim V-6 Q5.
- B-Q2 agent error rates (REQ-010): timeseries; **adapted** — `DATE_TRUNC('day',…)`+literal-30d → `$__timeGroupAlias(ml.source_created_at,'1d')`+`$__timeFilter`; grouped by `COALESCE(ad.name, ml.model_or_agent_id)`. `source_created_at` confirmed on `messages_log` (001_init.sql:71).
- B-RC recent-conversations (REQ-011): table; **derived** `started_at=MIN`, `last_activity=MAX`, `message_count=COUNT(message_id)` via subquery over `messages_log` (conversations_dim has none of these cols), inner `$__timeFilter` (PERF-001), ORDER BY last_activity DESC LIMIT 50. **NO `title`** (SEC-001/OPEN-DECISION-001).
- B-Q3 PII-trigger events (REQ-010): table; **adapted** — `conversation_title` DROPPED, no join to conversations_dim; `triggered_at`=`gel.source_created_at` (guardrail_events_log has no `triggered_at` col; 001_init.sql:111). Cols: conversation_id, message_id, route, entity_count, entity_types, triggered_at.
- B-DL dead-letter inspector (REQ-011): table; `source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at`. **`raw` EXCLUDED** (SEC-001).

**Drill-down row (collapsed:true, REQ-016/SEC-001/MODULE-004):** "Drill-down (raw content — authorized use only)" — the ONLY place forbidden columns appear. Nested panels: (101) conversation content viewer (`ml.text`, `cd.title`), (102) feedback text (`feedback_text`, `content`), (103) dead-letter raw payload (`raw`). Collapsed → not queried until expanded (PII non-egress on default load).

**PII grep proof:** every occurrence of `text`/`content`/`feedback_text`/`title`(SQL)/`raw`(column) sits at lines 313/331/349 — all ≥ line 295 where the collapsed row begins. All 13 default-panel `rawSql` lines (24–288) contain ZERO forbidden tokens. B-Q3 verified no `conversation_title`; B-DL verified no `raw` column. `templating.list` empty (REQ-017 trivially satisfied).

---

## Chunk 4 — Operator Docs + Provisioning Smoke Test

**Subagent:** 4a-4 | **Date:** 2026-06-01

### REQ-015 Operator Documentation

Added "## Grafana Dashboards" section to `conv-log/README.md` (appended before the existing "## Credential Rotation" section). Section covers:
- Dashboard location, folder, UIDs, and datasource type for A and B.
- Panel inventory for all 12 Dashboard A panels and all Dashboard B panel groups.
- SEC-001 trust-boundary statement: authorized-Grafana-admin only; collapsed drill-down row is a default-view privacy control, not an access-control boundary.
- Enumerated residual-exposure paths accepted by authorized admins: Explore, ad-hoc queries, query inspector, CSV export, `/api/datasources` endpoint, template-variable enumeration.
- `GRAFANA_CONVLOG_DB_PASSWORD` credential invariant: must equal `convlog_reader` password in `CONVLOG_PG_READ_URI`/`CONVLOG_PG_READER_PASSWORD`; rotation must update all three atomically (REQ-004 / HIGH-2).
- Config-only deploy steps (NFR-002): commit → git push → git pull on prod → `docker compose up -d grafana`; no api restart, no `prod-sync.sh`, no `npm run build`.
- Two one-time prod DB commands with exact SQL and `docker exec -i vectordb psql` invocation:
  - REQ-013b: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;`
  - REQ-013c: `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;`
- Acceptance checks (REQ-014 reader psql count; REQ-014b Grafana Save&test + stat-panel render).
- Dashboard A alert note: A-2 shows both 600 s SLO and 3000 s alert threshold; alert rules in `monitoring/prometheus/alerts.yml` (NFR-003).

### Smoke Test Results

Grafana image used: `grafana/grafana:11.5.2` (same as `monitoring/docker-compose.monitoring.yml`).
Container: `convlog-grafana-smoke` on port 13000, provisioning volume `monitoring/grafana/provisioning` mounted read-only.

**Provisioning log check:**
```
NO_PROVISIONING_ERRORS
```
(Only non-errors were missing `plugins/` and `alerting/` directories — not provisioned by this feature, expected.)

**API verification results:**
```
OPERATIONAL_OK
ANALYTICS_OK
DATASOURCE_OK
```

No provisioning bugs found. Both dashboards and the datasource load cleanly into Grafana 11.5.2 with no malformed JSON, bad schemaVersion, or datasource-type errors. Datasource connectivity failure to `vectordb` is expected in the throwaway environment and was not tested (REQ-014b requires real prod DB).

Container torn down: `docker rm -f convlog-grafana-smoke` confirmed.

### Files Modified
- `conv-log/README.md` — added "## Grafana Dashboards" section (~160 lines)
- `SDD/implementation/IMPLEMENTATION-PLAN-017-grafana-conv-log-dashboards-2026-06-01.md` — this chunk record
- `SDD/orchestration/progress.md` — progress append

---

## Step 4e — Critical-Impl Findings Resolution

**Subagent:** 4e-1 | **Date:** 2026-06-01 | **Status:** COMPLETE

All 6 findings from `SDD/reviews/CRITICAL-IMPL-grafana-conv-log-dashboards-20260601.md` resolved.

### Files modified
| File | Change |
|---|---|
| `monitoring/grafana/provisioning/dashboards/convlog/convlog-analytics.json` | MED-1: added B-RC (id 11) description with window-relative semantics warning. MED-2: added text panel (id 0) with time-scope legend; renamed B-Q4/B-Q5 titles to include "— all-time"; updated descriptions. LOW-3: added multi-series eyeball note to B-Q2 (id 10) description. All gridPos y values shifted +3 to accommodate text panel. JSON_OK confirmed. |
| `conv-log/README.md` | LOW-1: fixed A-12 unit from "percent (0–100%)" to "percentunit (0–1 ratio rendered as 0–100%)". MED-3 + LOW-2: added 5-step "Deployment Acceptance Gate (run in order, do not skip)" checklist after acceptance checks section, covering FAIL-002 detection symptom, remediation, REQ-013b/c GRANTs, REQ-014 psql check, REQ-014b Grafana Save&test, REQ-016 single-provider check, and B-Q2 multi-series eyeball. |
| `SDD/reviews/CRITICAL-IMPL-grafana-conv-log-dashboards-20260601.md` | Appended "## Findings Addressed (Critical-Impl)" section mapping each finding ID to its fix. |

### Deployment acceptance gate note (MED-3)
The gate is documented in README under "Deployment Acceptance Gate (run in order, do not skip)". The GRANT commands (REQ-013b/c) are step 1; they MUST be run before the dashboards are signed off as live. Skipping them produces a silently broken Dashboard B (every panel returns `permission denied for table messages_log`).

---

## Step 4f — Implementation Completion

**Subagent:** 4f | **Date:** 2026-06-01 | **Status:** COMPLETE

### Test Verification Gate — Results

- **Gate Passed:** Yes
- **Suite Execution:** N/A — declarative JSON/YAML; no unit-test framework applies (per spec validation strategy)
- **Unit Tests:** N/A — no application code; validation is provisioning-load + JSON/YAML lint + grep-based PII audit
- **Integration Tests:** Smoke test — Grafana 11.5.2 throwaway container with provisioning dir mounted read-only
- **E2E Tests:** N/A — monitoring-only, no web-facing application behavior (operator-validated on prod via REQ-014/014b)
- **Uncovered Requirements:** None — all 17 REQ are Complete or Operator-gated (documented)

### Re-Smoke Test (post-4e edits)

The `convlog-analytics.json` dashboard was modified by Step 4e (text panel added, gridPos shifted, titles changed). Re-validation confirmed no provisioning regression.

```
Container: convlog-grafana-smoke (grafana/grafana:11.5.2, port 13001)
Provisioning log check: NO_PROVISIONING_ERRORS
  (only missing plugins/ and alerting/ dirs — not provisioned by this feature, expected)

OPERATIONAL_OK  — uid convlog-operational loads
ANALYTICS_OK    — uid convlog-analytics loads (post-4e modifications)
DATASOURCE_OK   — uid convlog-postgres loads
Container torn down: confirmed
```

### Implementation Completion Summary

#### What Was Built

Two Grafana dashboards plus a read-only Postgres datasource and supporting infrastructure for the SPEC-016 conv-log sidecar. Dashboard A (operational, Prometheus-backed) covers 12 panels mapping all 11 sidecar metrics + synthetic `up`, with counter-reset-safe `rate()`, dual sync-lag threshold lines, and histogram quantile panels. Dashboard B (analytics, Postgres-backed) reproduces the 5 V-6 queries as living panels, adds a messages-per-day timeseries, recent-conversations table (with derived started_at/last_activity/message_count), dead-letter inspector, and a collapsed drill-down row for raw-content access. Both dashboards provision automatically; no manual import is required.

Infrastructure changes fixed two prod blockers: the `grafana` service was not on `librechat_default` (preventing `vectordb:5432` reachability), and `convlog_reader` lacked SELECT on writer-owned analytical tables. Both are now corrected with a network line addition and a corrected `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` in `provision-postgres.sh`.

#### Requirements Validation
- Functional Requirements: 17/17 Complete (13 locally verifiable, 4 operator-gated/documented)
- Non-Functional Requirements: 3/3 Met
- Security Requirements: 2/2 Complete
- Performance Requirements: 1/1 Met
- Edge Cases: 7/7 Complete
- Failure Scenarios: 5/5 Complete

#### Operator-Gated Items (correctly operator-gated, not incomplete)
- REQ-013b/c: one-time prod GRANT commands — documented in README "Deployment Acceptance Gate"
- REQ-014: reader-SELECT psql acceptance — documented in README
- REQ-014b: Grafana-path credential acceptance — documented in README
- OPEN-DECISION-001: DPO/product-owner sign-off on `title` column promotion — safe default implemented (drill-down-only)

#### Summary Document
`SDD/implementation/summaries/IMPLEMENTATION-SUMMARY-017-2026-06-01_11-15-00.md`
