# CRITICAL-IMPL — SPEC-017 Grafana Conv-Log Dashboards (Implementation Phase)

- **Date:** 2026-06-01
- **Reviewer:** Implementation critical-review subagent (SDD Step 4d, adversarial)
- **Verdict:** **APPROVED** (with 3 MEDIUM, 3 LOW advisories — none block ship; all are clarity/disclosure issues, not data-correctness or security breaks)
- **Scope:** Semantic correctness of the implemented artifacts against the REAL prod schema/metrics/scrape config — NOT JSON validity (a throwaway-Grafana 11.5.2 smoke test already proved both dashboards + datasource provision cleanly).
- **Prior review (not duplicated):** `REVIEW-017-...md` (code-review, APPROVED; doc-fidelity findings M1–L2 resolved). This review probes deeper SEMANTIC ground the prior pass did not.

## Counts
- HIGH: 0
- MEDIUM: 3
- LOW: 3

---

## What I verified clean (ground-truth cross-checks — the high-risk probes)

These are the items the prompt flagged as "looks done but subtly wrong." I checked each against ground truth and found them **correct**:

1. **A-1 Prometheus job label — CORRECT.** `up{job="conv-log"}` (convlog-operational.json:21) matches `job_name: "conv-log"` in `monitoring/prometheus/prometheus.yml:54` EXACTLY (not `convlog`/`conv_log`). A-1 will resolve, not silently show "No data."

2. **Metric name/type fidelity — ALL 11 CORRECT** (cross-checked vs `conv-log/src/index.ts:90-153`):
   - Counters (`rate()` used, EDGE-004 safe): `convlog_messages_synced_total` (A-6/id6), `convlog_errors_total` (A-8/id8), `convlog_dead_letter_total` (A-9/id9), `convlog_erasure_deletions_total` (A-11/id11). ✓
   - Gauges (raw value, correct): `convlog_sync_lag_seconds` (id4), `convlog_pending_messages` (id5), `convlog_max_message_age_seconds` (id7), `convlog_last_run_unix_timestamp` (id2 via `time() - …`), `convlog_bisection_max_depth_observed` (id3). ✓
   - Histograms (`histogram_quantile` over `_bucket`, correct): `convlog_batch_duration_seconds` (id10) — registered `new Histogram` at index.ts:129; `convlog_erasure_chunk_deleted_ratio` (id12) — `new Histogram` at index.ts:141. Both expose `_bucket`/`_sum`/`_count`, so `histogram_quantile(q, sum(rate(<m>_bucket[5m])) by (le))` is valid and returns data. ✓ No histogram_quantile is applied to a non-histogram metric.

3. **A-2 dual threshold lines (REQ-008/SEC-002) — RENDERS TWO LINES.** Strong in-repo evidence: `host.json:179-187` is an existing dashboard using the IDENTICAL idiom (`custom.thresholdsStyle.mode: "line"` + a 3-step `thresholds.steps` green/yellow/red). In Grafana 11.5.2 timeseries, `thresholdsStyle` line modes draw a horizontal reference line at every step boundary with a non-null `value`. Steps at 600 (yellow) and 3000 (red) therefore produce TWO distinct horizontal lines. The implementation's `line+area` (id4) is `line` PLUS shaded bands — it is a superset, so both lines still render. **Requirement met.**

4. **Credential flow — INTACT end-to-end.** `.env.prod.template:208` (`GRAFANA_CONVLOG_DB_PASSWORD=<same-as-CONVLOG_PG_READER_PASSWORD>`) → compose `environment:` line 113 with `:?` fail-fast guard → datasource `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}` (convlog-postgres.yml:36). `${VAR}` form is correct for Grafana 11.5.2 (NOT `$__env{}`); precedent `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:?...}` (line 107) confirms the form works. FAIL-003 (empty → `:?` aborts start) and FAIL-005 (wrong → "Save & test" auth failure, undetectable by `:?` or by reader-scoped REQ-014, only by REQ-014b) are both REAL and documented honestly (README:405-411). No hardcoded password in any committed YAML/JSON (grep-verified).

5. **Network blocker (REQ-005) — FIXED.** `- librechat_default` present at compose:141; declared `external` at :264-266. FAIL-001 prevented.

6. **B-SQL column existence — ALL columns are real** (cross-checked vs `001_init.sql`):
   - B-Q3 (id12): `conversation_id`, `message_id`, `route`, `entity_count`, `entity_types` all exist on `guardrail_events_log` (001_init.sql:103-114). There is NO `triggered_at` column — the alias `gel.source_created_at AS triggered_at` is the correct fix (source_created_at exists at :111). `conversation_title` correctly DROPPED (no join to conversations_dim). ✓
   - B-Q2 (id10): `error` is a real `BOOLEAN` column (messages_log, :64); `ml.error = true` excludes NULL/false correctly; `agents_dim.name` (:40), `agents_dim.agent_id` (:39) exist for the join. ✓
   - B-Q4 (id7): `agents_dim.model_underlying` exists (:41). ✓
   - B-RC (id11): correct LEFT-bounded subquery join on `conversation_id`; `GROUP BY conversation_id` is the PK-grouping key (no cartesian blowup); inner scan bounded by `$__timeFilter` before aggregating per PERF-001. ✓
   - **Postgres alias-in-ORDER-BY:** `ORDER BY agg.last_activity DESC` references a JOINED-subquery output column (qualified `agg.`), NOT a top-level SELECT alias — this is valid Postgres (the restriction only bites bare SELECT-list aliases in some clauses; a subquery column reference is always fine). ✓
   - B-Q4 `GROUP BY resolved_model` references a SELECT-list output alias — valid in Postgres GROUP BY. ✓

7. **REQ-016 `allowUiUpdates: false` — CORRECT and non-conflicting.** Separate `convlog-dashboards` provider (dashboards.yml:34-42) scopes `path: …/convlog`, `allowUiUpdates: false`. The pre-existing `memodo-dashboards` provider has `foldersFromFilesStructure: false` and points at the PARENT dir — but does NOT recurse into the `convlog/` subdir, so no double-provisioning. (Note: see LOW-2 — this non-recursion assumption is load-bearing and worth a deploy-time confirmation.)

8. **REQ-017 no raw template variables — VACUOUSLY SATISFIED.** Both dashboards have `templating.list: []`. No variable can enumerate raw PII.

9. **PII default-view rules — HELD.** Grep of all DEFAULT (un-nested) panels: no `text`/`content`/`feedback_text`/`title`/`raw` in any default SELECT. All five raw-content columns appear ONLY in panels nested under the single `collapsed: true` row (id100, panels 101/102/103). Collapsed rows do not query until expanded → PII non-egress on default load holds.

10. **provision-postgres.sh (REQ-012) — CORRECT `FOR ROLE` clause** (script:108-109). Idempotent; does not break existing flow. **The ordering gap is honestly covered:** `GRANT SELECT ON ALL TABLES` (:101) runs at provisioning BEFORE the migration runner creates tables, so it covers ZERO tables at script run time — this is exactly why REQ-013b's one-time prod GRANT exists, and the README (:428-446) documents both REQ-013b and REQ-013c prod commands explicitly. The script edit's irrelevance to a config-only prod deploy is stated plainly.

---

## Findings

### MEDIUM-1 — B-RC `started_at` / `message_count` are window-relative but presented as conversation-lifetime values (undisclosed semantic distortion)
- **Evidence:** convlog-analytics.json:252. The derived columns are computed from a `$__timeFilter(ml.source_created_at)`-bounded inner scan. With the dashboard default range `now-30d` (convlog-analytics.json:9), a conversation that started 40 days ago shows a `started_at` clamped to the window's left edge and a `message_count` that omits pre-window messages. The column names (`started_at`, `message_count`) and the panel/README description ("recent conversations with … derived `started_at` … and `message_count`", README:386) imply lifetime values.
- **Why it matters:** An operator reading B-RC will mis-attribute "conversation started 30d ago, 12 messages" when the conversation is actually older with more messages. This is the *correct* PERF-001 tradeoff (bound-before-aggregate is mandated to keep the unbounded fact-table scan cheap), but the distortion is undisclosed.
- **Recommended fix (doc-only, non-blocking):** Add to the id11 panel `description`: "started_at / message_count reflect only messages within the selected time range, not the conversation's full lifetime." No SQL change.

### MEDIUM-2 — Cross-panel time-semantics inconsistency on Dashboard B will mislead under a narrowed picker
- **Evidence:** On one dashboard (default `now-30d`), B-Q1 (id8), B-RC (id11), B-Q2 (id10), B-MPD (id6) ARE `$__timeFilter`-bounded, while B-Q4 (id7, model mix), B-Q5 (id9, length histogram), and the stat row (id1-5) are ALL-TIME / window-independent. Narrowing the picker to e.g. "now-1h" silently collapses the bounded panels to near-empty while the all-time panels stay full.
- **Why it matters:** Two panels purporting to describe "the data" disagree by orders of magnitude depending on a global picker the operator may not realize only drives *some* panels. EDGE-007 anticipated this ("two distinct classes … must NOT be conflated") and individual panels carry notes, but there is no on-dashboard signal distinguishing the classes — the inconsistency is left to the reader to reconstruct.
- **Recommended fix (non-blocking):** Either (a) add an "(all-time)" suffix to the titles of id7/id9 and the stat row, or (b) add a dashboard-level text panel noting which panels the time picker drives. Title-suffix is cheapest.

### MEDIUM-3 — REQ-013b/REQ-013c prod GRANTs are operator-manual with no automated gate; silent FAIL-002 risk persists until an operator runs them
- **Evidence:** README:424-446 documents the two one-time prod commands. But the config-only deploy (`docker compose up -d grafana`) does NOT run them, and nothing in the deploy path FAILS if they are skipped — "Save & test" passes on CONNECT alone (FAIL-002), and every Dashboard-B panel then returns `permission denied for table messages_log`. The only detection is the REQ-014 reader-scoped psql check, which is a *manual* post-deploy step.
- **Why it matters:** This is the exact HIGH finding the spec exists to fix (reader lacks SELECT). The fix is correct but its *application* depends entirely on operator discipline with no fail-closed gate. A rushed deploy that skips REQ-013b ships a fully-broken analytics dashboard that *looks* provisioned.
- **Recommended fix (process, non-blocking for artifact APPROVAL):** Make REQ-014 + REQ-014b a HARD pre-sign-off checklist gate (they are already listed under "Prod-only operator-gated acceptance" in the spec). Recommend the deploy runbook ordering put the two GRANTs as step 5 (between `git pull` and the stat-row cross-check) so they cannot be deferred past first dashboard load. Consider a tiny post-deploy smoke script that runs the reader-scoped `SELECT count(*)` and FAILS loudly. No artifact change required.

### LOW-1 — A-12 README unit ("percent (0–100%)") contradicts the correct JSON unit (`percentunit`)
- **Evidence:** convlog-operational.json:285 uses `"unit": "percentunit"` (correct: Grafana renders a 0–1 value as 0–100%, and the metric is a 0–1 ratio with `max: 1`). README:376 states "Unit: percent (0–100%)". The Grafana unit literally named `percent` would render 0.5 as "0.5%" — i.e., the README describes a unit that, if ever implemented, would be a 100× display bug.
- **Why it matters:** Pure doc/impl drift in the freshly-rewritten README (the M2-domain table). Harmless today (JSON is correct) but actively misleading to a future editor who "fixes" the JSON to match the README.
- **Recommended fix:** Change README:376 to "Unit: percentunit (0–1 ratio rendered 0–100%)."

### LOW-2 — `allowUiUpdates: false` correctness depends on an undocumented-at-deploy non-recursion assumption
- **Evidence:** dashboards.yml:29-33 correctly reasons that `memodo-dashboards` (foldersFromFilesStructure: false, parent path) does not scan the `convlog/` subdir, so the scoped `convlog-dashboards` provider is the sole provisioner of the conv-log JSONs. This is almost certainly correct, but if a future edit flips `foldersFromFilesStructure: true` or repoints the parent path, BOTH providers would claim the conv-log dashboards and the `allowUiUpdates: false` guarantee (REQ-016) could be silently undermined by the permissive provider winning.
- **Why it matters:** The privacy-hardening guarantee (a UI edit adding a PII column can't persist) rests on a single-provider assumption that has no test asserting it.
- **Recommended fix:** Add the REQ-016 testable to the deploy checklist explicitly — after `up -d grafana`, confirm the conv-log dashboards appear ONLY in the "Conv-Log" folder (not also at root), and that a UI edit to a conv-log dashboard does NOT persist across `down/up`. (Spec already lists this testable; flag is to ensure it's actually executed.)

### LOW-3 — B-Q2 / B-MPD Postgres `time_series` multi-series idiom has zero in-repo precedent; smoke test proved provisioning, not correct series rendering
- **Evidence:** Grep of all other dashboards (`grep time_series *.json`) returns NO Postgres time_series panels — every existing time_series panel is Prometheus-backed. B-Q2 (id10) relies on the Grafana Postgres convention that a string column aliased `AS metric` becomes the series name and `AS time` becomes the time axis. The query is well-formed and the convention is standard, but it is NET-NEW to this repo and the smoke test (per the prompt) only proved the dashboards PROVISION cleanly — not that B-Q2 returns correctly-split multi-series data against real rows.
- **Why it matters:** Low because the query is textbook-correct and B-Q2 will at worst render a single mislabeled series (cosmetic), not wrong data or an error. But it is the one panel with no precedent AND no smoke-tested data render.
- **Recommended fix:** In the prod-only operator acceptance (REQ-014b context), explicitly eyeball B-Q2: confirm it renders one line PER agent/model (multi-series), not a single merged series. No artifact change unless it renders wrong.

---

## Scope / NFR confirmation
- **NFR-001 scope HELD:** Changes confined to `monitoring/**`, `conv-log/ops/provision-postgres.sh`, `conv-log/README.md`, `.env.example`, `.env.prod.template`. Zero edits under `/api`, `/packages/*`, `/client` (the only forbidden paths). ✓
- **NFR-002 deploy:** config-only path documented correctly (README:413-422); no `prod-sync.sh`, no `npm run build`, no api restart. ✓
- **NFR-003 no new alert rules:** Dashboard A references the three `ConvLog*` thresholds as annotations/threshold lines only; `alerts.yml` not modified. ✓
- **EDGE/FAIL coverage:** EDGE-001 (`noValue: "0"`/"No data" on all B panels) ✓; EDGE-004 (`rate()` on all counters) ✓; EDGE-005/FAIL-004 (`noValue: "No data"` on A-10/A-12) ✓; EDGE-006/007 (`$__timeFilter`/`$__timeGroup` on time-bucketed panels) ✓; FAIL-001/002/003/005 all real and detectable as specified ✓.

## Bottom line
No HIGH findings. No query will silently return No-data or wrong-data against real prod (the job label, metric types, histogram buckets, SQL column references, and credential path all check out against ground truth). The A-2 dual-threshold-line requirement IS met (host.json precedent). The 3 MEDIUM findings are disclosure/consistency improvements (window-relative B-RC labels, cross-panel time-semantics signposting, and making the manual prod-GRANT step a hard gate); the 3 LOW are a README unit typo, a non-recursion assumption to confirm at deploy, and a no-precedent multi-series panel to eyeball. **APPROVED** for ship contingent on the operator actually running REQ-014 + REQ-014b before sign-off (MEDIUM-3).

---

## Findings Addressed (Critical-Impl)

Resolved by Step 4e subagent on 2026-06-01.

| Finding | Fix applied | Artifact(s) changed |
|---|---|---|
| **MED-1** | Added explicit `description` to B-RC panel (id 11) stating that `started_at` and `message_count` reflect only messages within the selected time range, not the conversation's full lifetime, and explaining this is a deliberate PERF-001 tradeoff. | `convlog-analytics.json` |
| **MED-2** | (a) Added a `text` panel (id 0) at the top of Dashboard B listing which panels are time-picker-bounded vs all-time. (b) Renamed B-Q4 title to "Model usage distribution — all-time (B-Q4)" and B-Q5 to "Conversation length histogram — all-time (B-Q5)"; updated their descriptions to state ALL-TIME explicitly. | `convlog-analytics.json` |
| **MED-3** | Added a "Deployment Acceptance Gate (run in order, do not skip)" numbered checklist to the README Grafana section. It documents the exact FAIL-002 detection symptom (`permission denied for table messages_log`), the remediation, and 5 mandatory gate steps: REQ-013b/c GRANTs, REQ-014 reader psql check, REQ-014b Grafana Save&test + stat-panel render, REQ-016 single-provider confirmation, and B-Q2 multi-series eyeball. | `conv-log/README.md` |
| **LOW-1** | Changed README A-12 unit from "percent (0–100%)" to "percentunit (0–1 ratio rendered as 0–100%)" to match the JSON. | `conv-log/README.md` |
| **LOW-2** | Added step 4 to the deployment acceptance gate: after `up -d grafana`, confirm conv-log dashboards appear in the Conv-Log folder only (not at root), and confirm a UI edit does NOT persist after `docker compose restart grafana` (proving `allowUiUpdates: false` is honoured by a single provider). | `conv-log/README.md` |
| **LOW-3** | Added text to B-Q2 (id 10) panel `description` noting the multi-series idiom is net-new to this repo and instructing the deployer to eyeball that it renders one line per agent/model (step 5 of the acceptance gate). | `convlog-analytics.json` |

JSON validation: `python3 -m json.tool convlog-analytics.json` → **JSON_OK**. Dashboard A (`convlog-operational.json`) was not modified.
