---
review_panel: false
eval_required: false
cross_cutting_decisions: []
delivery_mode: whole-feature
---

# SPEC-017-grafana-conv-log-dashboards

## Executive Summary

- **Based on Research:** RESEARCH-017-grafana-conv-log-dashboards.md
- **Creation Date:** 2026-06-01
- **Author:** Claude (with Pablo Oliva)
- **Status:** In Review

Two Grafana dashboards plus one new read-only Postgres datasource for the SPEC-016 conv-log sidecar: an **operational dashboard (Dashboard A)** (Prometheus-backed health surface) and an **analytics dashboard (Dashboard B)** (Postgres-backed browsing of the analytical store via the `convlog_reader` datasource). Monitoring-stack-only change (no `/api`, `/packages/*`, `/client`). Config-only deploy (git pull + `docker compose up -d grafana`); no LibreChat api restart, no `prod-sync.sh`.

## Research Foundation

### Production Issues Addressed
- No at-a-glance health view of the conv-log sidecar (is it up, lagging, dead-lettering, how long ticks take). Today this requires `curl conv-log:9300/metrics` or ad-hoc PromQL.
- No analytics surface for the conv-log analytical store — analysts copy-paste the five README V-6 queries into `psql` by hand.
- **HIGH finding (research Security Considerations):** `convlog_reader` currently lacks SELECT on the writer-owned analytical tables. The `ALTER DEFAULT PRIVILEGES` in `provision-postgres.sh:101-102` ran as the admin with no `FOR ROLE convlog_writer` clause, so it never applied to the migration runner's tables. Dashboard B would fail every panel with `permission denied for table messages_log`. This spec requires the corrective GRANTs (REQ-012/REQ-013) and an acceptance test that proves SELECT as the reader (not the superuser).
- **BLOCKER (research DISCREPANCY-3):** the `grafana` service is on `monitoring` + `caddy_net` only — NOT `librechat_default` where `vectordb` lives. Datasource "Save & test" fails until `librechat_default` is added to the service `networks:` list (REQ-005).

### Stakeholder Validation
- **Product / Governance (DPO):** counts and dimensions are fine to surface; raw conversation `text`, conversation `title`, and `dead_letter_log.raw` are real prod PII and must be deliberate, gated, access-logged. On-file DPO acceptance (SPEC-016) covers *retention*, not *UI exposure*.
- **Engineering / SRE:** Dashboard A is the health surface; pattern-mirror `mongodb.json` (stat row on top, timeseries below).
- **Analyst:** Dashboard B reproduces the five V-6 queries as living panels.
- **Operator (deploy):** auto-provision on `docker compose up -d grafana` (no manual import); config-only deploy; Grafana recreate OK, no api restart.

### System Integration Points
- Grafana service: `monitoring/docker-compose.monitoring.yml:101-136` (image `grafana/grafana:11.5.2`; provisioning dir mount `./grafana/provisioning:/etc/grafana/provisioning:ro` at `:112`; `GF_USERS_ALLOW_SIGN_UP=false` at `:108`; admin password env-interpolation precedent at `:107`).
- Metric source of truth: `conv-log/src/index.ts:90-153` (`buildMetrics`), exposed at `conv-log:9300/metrics`. Scrape job `conv-log` already configured in `monitoring/prometheus/prometheus.yml` (validated by commit `337c39ac8`).
- Analytical schema: `conv-log/migrations/001_init.sql` (6 tables; `schema_migrations` is operational, excluded from Dashboard B).
- Datasource pattern: `monitoring/grafana/provisioning/datasources/prometheus.yml` (`apiVersion: 1`, `access: proxy`, `editable: false`).
- Dashboard provider: `monitoring/grafana/provisioning/dashboards/dashboards.yml` (`type: file`, `updateIntervalSeconds: 30`, currently `allowUiUpdates: true` at `:19` — "lets operators tweak dashboards in the UI"). REQ-016 changes the conv-log dashboards' provider to `allowUiUpdates: false` so provisioned JSON is the source of truth and live PII-surfacing edits cannot persist.
- Index supporting Dashboard-B aggregations: `001_init.sql:86-87` creates `messages_log_conversation_created_idx ON messages_log (conversation_id, source_created_at)`; `001_init.sql:83-84` creates `messages_log_source_created_at_idx ON messages_log (source_created_at)`. Both ground PERF-001.
- Closest dashboard patterns: `mongodb.json` (A), `service-overview.json` (B stat row + table). Both `schemaVersion: 38`, tags `["memodo", ...]`.
- Reader role + GRANT fix site: `conv-log/ops/provision-postgres.sh:84-102`.
- Network: `librechat_default` already declared `external` at `:259-261`; `postgres-exporter` reaches `vectordb:5432` over it (`:203,216-218`).
- Alert thresholds (annotations only, no new rules): `ConvLogSyncLagBreach` `alerts.yml:177-190` (literal `3000`), `ConvLogDeadLetterStructuralFailure`, `ConvLogErasureRunaway`.
- Credential vars: `.env.example:939-955` CONVLOG_* block; `.env.prod.template`.

## Intent

### Problem Statement
The conv-log sidecar has no Grafana visibility: operators cannot see its health at a glance, and analysts cannot browse the analytical store without ad-hoc SQL. The datasource path that would enable analytics is currently broken (reader lacks SELECT; Grafana cannot reach `vectordb`).

### Solution Approach
Provision (a) a read-only Postgres datasource (`convlog-postgres` uid) connecting as `convlog_reader` with a dedicated `GRAFANA_CONVLOG_DB_PASSWORD` env var interpolated into `secureJsonData.password`; (b) Dashboard A from the 11 sidecar metrics + synthetic `up`; (c) Dashboard B reproducing the five V-6 queries plus a count stat row, messages-per-day, recent-conversations, and dead-letter inspector, with a single collapsed drill-down row as an incidental-exposure-minimization measure (a "default view privacy-respecting" control — NOT an access-control boundary; see SEC-001). The actual trust boundary is authorized-Grafana-admin access only. Fix the two infrastructure blockers (network membership, reader SELECT grant).

### Expected Outcomes
- Anyone with Grafana admin access at `https://grafana.memodo-eng.de` sees conv-log health and explores the analytical store without writing SQL. Such an admin is, by design, authorized to see all conv-log data (the trust boundary is admin authentication, SEC-001).
- Default-visible panels expose only counts/IDs/dimensions/metadata; raw content lives only behind a collapsed drill-down row. This keeps the default view privacy-respecting (minimizes incidental exposure / shoulder-surfing) but is not an access-control boundary — an authorized admin retains other paths to the same data (SEC-001 residual-exposure enumeration).
- Both dashboards auto-provision; a `down grafana && up -d grafana` restores both from disk.

## Success Criteria

### Functional Requirements

**Provisioning & infrastructure**

- **REQ-001:** Create `monitoring/grafana/provisioning/datasources/convlog-postgres.yml` — a separate datasource file (provider scans the whole directory): `apiVersion: 1`; one `postgres` datasource, `uid: convlog-postgres`, `access: proxy`, `editable: false`, `url: vectordb:5432`, `user: convlog_reader`, `database: convlog`, `jsonData.sslmode: disable` (matches `postgres-exporter`'s DSN at `docker-compose.monitoring.yml:203`; correct for the internal `vectordb:5432` connection), `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}`. No password hardcoded in any committed YAML/JSON. **Testable:** YAML lints; datasource appears in Grafana after restart; a SELECT as `convlog_reader` succeeds (REQ-014).
- **REQ-002:** Use Grafana 11.5.2 env-var interpolation form `${GRAFANA_CONVLOG_DB_PASSWORD}` (NOT `$__env{...}`) for `secureJsonData.password`; the provisioning interpolation pass covers `secureJsonData` and substitutes before encryption-at-rest. Precedent: the compose already interpolates `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:?...}` (`:107`).
- **REQ-003:** Add `GRAFANA_CONVLOG_DB_PASSWORD` to the `grafana` service `environment:` block in `monitoring/docker-compose.monitoring.yml` with a fail-fast guard: `- GRAFANA_CONVLOG_DB_PASSWORD=${GRAFANA_CONVLOG_DB_PASSWORD:?...}`. Without this the var is not in the container env at Grafana load time and interpolation yields an empty password.
- **REQ-004 (credential invariant — HIGH-2):** Add a commented template for `GRAFANA_CONVLOG_DB_PASSWORD` to `.env.example` inside/after the CONVLOG_* block (`:939-955`) and add the resolved-var line to `.env.prod.template`, per the existing CONVLOG_* convention.
  - **INVARIANT (MUST hold):** `GRAFANA_CONVLOG_DB_PASSWORD` (set in `.env.prod`, consumed by the `grafana` service) MUST EQUAL the password that the `convlog_reader` Postgres role was actually created with at provisioning time — i.e., `CONVLOG_PG_READER_PASSWORD` (`provision-postgres.sh:42,84`), which is the same secret embedded inside `CONVLOG_PG_READ_URI` (`.env.example:955`). There are thus three locations of one logical value: (1) `CONVLOG_PG_READER_PASSWORD` at provision time, (2) the password substring inside `CONVLOG_PG_READ_URI`, (3) `GRAFANA_CONVLOG_DB_PASSWORD`. **Single source of truth:** the operator sets all three from the one reader password generated by `provision-postgres.sh`; the spec mandates deriving all three from that single documented value, never picking a fresh value for the Grafana var.
  - Document in operator docs (REQ-015) that this duplicates the reader password and that any rotation MUST update ALL THREE locations atomically. Divergence is detected by FAIL-005 and the Grafana-path acceptance check (REQ-014b).
- **REQ-005 (network BLOCKER):** Add the single line `- librechat_default` to the `grafana` service `networks:` list (`docker-compose.monitoring.yml:134-136`), yielding `monitoring`, `caddy_net`, `librechat_default`. No new top-level network declaration (already declared `external` at `:259-261`). This is the only compose network edit; monitoring-stack-only.
- **REQ-006:** Both dashboards auto-provision via the existing directory bind mount (`./grafana/provisioning:/etc/grafana/provisioning:ro`) — NO bind-mount change required (DISCREPANCY-4; the brief's "apply the directory-mount fix if not already" resolves to "already correct"). **Testable:** `down grafana && up -d grafana` restores both dashboards and the datasource from disk with no manual import.
- **REQ-007:** Create `monitoring/grafana/provisioning/dashboards/convlog-operational.json` (Dashboard A) and `monitoring/grafana/provisioning/dashboards/convlog-analytics.json` (Dashboard B), both valid JSON at `schemaVersion: 38`, tags `["memodo", "convlog", ...]`.

**Dashboard A — operational (Prometheus-backed); one acceptance criterion per panel**

- **REQ-008:** Dashboard A renders 12 panels mapping the 11 sidecar metrics + synthetic `up`, using the research's definitive PromQL forms. **Acceptance clarification (LOW-3):** "12 panels" means 12 panel objects where **A-8 and A-12 are each a SINGLE multi-series panel carrying three `histogram_quantile` queries (p50/p95/p99)** — NOT a raw count that would be tripped by splitting quantiles into separate panels (>12) or merging panels (<12). Count panel objects, treating A-8/A-12 as one each. Counters use `rate(...[5m])` (never raw values — counters reset on sidecar restart, EDGE-004). Histograms use `histogram_quantile(q, sum(rate(<metric>_bucket[5m])) by (le))`. Per-panel:
  - **A-1 `up` stat:** `up{job="conv-log"}`, value mappings 0=DOWN/red, 1=UP/green.
  - **A-2 sync-lag timeseries:** `convlog_sync_lag_seconds` with **BOTH threshold lines** — 600s (NFR-2 steady-state SLO) AND 3000s (deployed `ConvLogSyncLagBreach` alert literal). Both render; neither is dropped (see SEC-002 rationale and EDGE-002/EDGE-003 annotations).
  - **A-3 pending:** `convlog_pending_messages`.
  - **A-4 throughput:** `rate(convlog_messages_synced_total[5m])`.
  - **A-5 max message age:** `convlog_max_message_age_seconds` (panel description annotates idle-inflation, EDGE-002).
  - **A-6 errors by phase (stacked):** `sum by (phase) (rate(convlog_errors_total[5m]))`, `legendFormat: {{phase}}` — label-driven, no hardcoded phase list (DISCREPANCY-2). The sidecar emits 8+ error phases (LOW-1): set a sane legend config (e.g., table legend at bottom, `calcs` last/max) so 8+ stacked series stay readable; cosmetic only.
  - **A-7 dead-letter by phase (stacked):** `sum by (phase) (rate(convlog_dead_letter_total[5m]))`; same legend/stacking guidance as A-6 (LOW-1).
  - **A-8 batch duration p50/p95/p99:** `histogram_quantile(0.5|0.95|0.99, sum(rate(convlog_batch_duration_seconds_bucket[5m])) by (le))`, unit `s`.
  - **A-9 erasure deletions:** `rate(convlog_erasure_deletions_total[5m])`.
  - **A-10 bisection max depth:** `convlog_bisection_max_depth_observed` (stat or timeseries).
  - **A-11 seconds since last tick:** `time() - convlog_last_run_unix_timestamp`, unit `s`.
  - **A-12 erasure chunk ratio quantiles:** `histogram_quantile(0.5|0.95|0.99, sum(rate(convlog_erasure_chunk_deleted_ratio_bucket[5m])) by (le))`, unit `percentunit`, max 1.

**Dashboard B — analytics (Postgres-backed); one acceptance criterion per panel**

- **REQ-009 (stat row):** Five stat panels — `SELECT count(*)` over `conversations_dim`, `messages_log`, `agents_dim`, `guardrail_events_log`, `dead_letter_log`. These are the cross-check targets in REQ-014. `noValue`/empty-friendly config (guardrail count is 0, EDGE-001).
- **REQ-010 (V-6 query panels):** All five README V-6 queries map to panels:
  - **B-Q1 Top 10 users by volume** → table, `format: table`, instant. The verbatim README query (README:219-225) carries a literal `WHERE source_created_at >= NOW() - INTERVAL '30 days'` — a FIXED 30-day window that the Grafana time picker does NOT drive (MEDIUM-2). Resolve per-panel: **preferred** — replace the literal with `$__timeFilter(source_created_at)` so the picker drives it (matching B-Q2's treatment); **otherwise** — keep the literal `INTERVAL '30 days'` and document it in the panel description as "fixed 30-day window, NOT driven by the time picker." Do not leave it silently picker-independent.
  - **B-Q2 Agent error rates over time** → timeseries grouped by `agent_name`; join `messages_log.model_or_agent_id = agents_dim.agent_id` for `agents_dim.name`; use `$__timeGroupAlias(ml.source_created_at, '1d')` + `$__timeFilter(ml.source_created_at)` so the time picker drives it.
  - **B-Q3 PII-trigger correlation** → table; **default panel selects `conversation_id`, `message_id`, `route`, `entity_count`, `entity_types`, `triggered_at` ONLY — `conversation_title` is DROPPED** (SEC-001). Renders gracefully on 0 rows (EDGE-001).
  - **B-Q4 Model usage distribution** → piechart or bargauge, `format: table`, instant; verbatim SQL.
  - **B-Q5 Conversation length histogram** → barchart, `format: table`, instant; verbatim SQL.
- **REQ-011 (additional panels):**
  - **B-MPD messages-per-day** timeseries: `$__timeGroupAlias(source_created_at, '1d') ... COUNT(*) FROM messages_log` (PII-safe — selects only the day bucket and a count; never `text`/`content`/`feedback_text`, SEC-001).
  - **B-RC recent-conversations** table: columns `conversation_id`, `endpoint`, `agent_id`, plus **derived** `started_at = MIN(ml.source_created_at)`, `last_activity = MAX(ml.source_created_at)`, `message_count = COUNT(ml.message_id)` via LEFT JOIN/subquery over `messages_log` grouped by `conversation_id`, ordered by `last_activity DESC` (OQ-2; `conversations_dim` has no such columns — do NOT approximate with `source_created_at`/`source_updated_at`). **No `title`** in default panel (SEC-001 / OPEN-DECISION-001).
  - **B-DL dead-letter inspector** table: `SELECT source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at FROM dead_letter_log ORDER BY last_failed_at DESC LIMIT 50`. **`raw` JSONB column EXCLUDED** (PII — original failed source document; SEC-001). `error_detail` already sanitized (SPEC-016 README:319).

**Infrastructure GRANT fix (HIGH)**

- **REQ-012 (default-privileges fix):** Correct `conv-log/ops/provision-postgres.sh:101-102` to scope default privileges to the table owner: `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;`. This ensures future migrations run by `convlog_writer` are automatically readable by `convlog_reader`. Touching `conv-log/ops/` is in scope (NFR-001 forbids only `/api`, `/packages/*`, `/client`).
- **REQ-013 (existing-tables GRANT + durable default-privilege fix on prod):** Provide the corrective grants. The schema is confirmed `public` (`provision-postgres.sh:97`, `001_init.sql`).
  - **(a)** Idempotent step added to `provision-postgres.sh` (so re-running the script repairs the grant).
  - **(b) REQ-013b (one-time existing-tables GRANT on prod):** documented one-time operator step run against prod `convlog`: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` — covers TODAY's writer-owned tables (`provision-postgres.sh` is NOT re-run on this config-only deploy).
  - **(c) REQ-013c (one-time default-privilege fix on prod — MEDIUM-5):** because editing `provision-postgres.sh` (REQ-012) does NOT apply to the running prod DB on a config-only deploy, the operator MUST ALSO run REQ-012's corrected statement once against prod: `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;`. Without this, the durable mechanism lives only in the script prod never re-executes, and a FUTURE migration's new table would be silently unreadable by `convlog_reader` (reproducing the exact HIGH finding this spec fixes) until someone re-ran REQ-013b again. REQ-013b alone covers only today's tables; REQ-013c establishes the durable auto-coverage on the live prod DB.
  - Operator docs (REQ-015) must state BOTH the one-time REQ-013b GRANT and the one-time REQ-013c `ALTER DEFAULT PRIVILEGES` prod command explicitly, and note that the script edit (REQ-012) alone does not reach the running prod DB.
- **REQ-014 (reader-SELECT GRANT acceptance — REQUIRED before ship):** Runs `psql "$CONVLOG_PG_READ_URI" -c "SELECT count(*) FROM messages_log;"` as `convlog_reader` (NOT `docker exec ... -U librechat_rag`, which is the superuser and always succeeds regardless of grants). Must return a row count. This proves the **GRANT** (REQ-012/REQ-013) took effect for the reader role. **Scope note (HIGH-2):** this check connects with `CONVLOG_PG_READ_URI` and therefore BYPASSES Grafana's separately-configured `GRAFANA_CONVLOG_DB_PASSWORD` — it proves the GRANT but does NOT prove Grafana authenticates. It is necessary-but-not-sufficient on its own; pair it with REQ-014b.
- **REQ-014b (Grafana-path credential acceptance — REQUIRED before ship — HIGH-2):** A distinct end-to-end check that exercises Grafana's actual configured credential (`secureJsonData.password` = `${GRAFANA_CONVLOG_DB_PASSWORD}`), which REQ-014 does not touch: (a) the `convlog-postgres` datasource **"Save & test"** returns a green/OK result (this is the check that authenticates with the interpolated Grafana credential and thus catches a wrong `GRAFANA_CONVLOG_DB_PASSWORD`); AND (b) a Dashboard-B default panel (the stat-row total-`messages_log` count, REQ-009) actually **renders a non-error numeric value that matches the psql `count(*)` from REQ-014**. Together (a)+(b) prove the configured Grafana credential authenticates end-to-end through the full datasource path. Keep BOTH REQ-014 (proves GRANT, reader-scoped psql) AND REQ-014b (proves Grafana credential) — neither subsumes the other.

**Documentation**

- **REQ-015:** Document in `conv-log/README.md` (new "Grafana Dashboards" section) or a `monitoring/` doc: where dashboards live (`https://grafana.memodo-eng.de`), panel inventory for A and B, the trust boundary (authorized-Grafana-admin-only) AND the default-view privacy control (default panels vs collapsed drill-down row) stated honestly per SEC-001, the enumerated residual-exposure paths (Explore / ad-hoc query / query inspector / CSV export / `/api/datasources` / template-variable enumeration) that an authorized admin retains, the `GRAFANA_CONVLOG_DB_PASSWORD` var + the credential invariant and rotation note (REQ-004 / HIGH-2), the auto-provision/deploy steps, the one-time GRANT command (REQ-013b) AND the one-time `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` prod command (REQ-013c / MEDIUM-5), and the link from Dashboard A panels to the three `ConvLog*` alert thresholds (annotation reference, not new rules).

**Privacy hardening (HIGH-1 / panel-domain security)**

- **REQ-016 (`allowUiUpdates: false`):** The conv-log dashboards MUST be provisioned by a provider entry with `allowUiUpdates: false` — either by changing the existing `monitoring/grafana/provisioning/dashboards/dashboards.yml:19` (if it is acceptable for the whole provider) OR by adding a separate provider entry scoped to the conv-log dashboard folder/path. This makes the on-disk provisioned JSON the source of truth: a live UI edit that adds a forbidden-default column (`text`/`content`/`feedback_text`/`title`/`raw`) to a default panel cannot be silently persisted. Residual Explore/ad-hoc exposure remains accepted (SEC-001). **Testable:** the conv-log provider entry shows `allowUiUpdates: false`; a UI edit to a conv-log dashboard does not persist across `down/up grafana`.
- **REQ-017 (no raw-value template variables):** NO Grafana template/dashboard variable on either dashboard may enumerate raw `title`, `text`, `content`, `feedback_text`, or `dead_letter_log.raw` values (a query-type variable over those columns would surface distinct PII strings in a dropdown, bypassing the column rules). Any dashboard variable MUST be built from IDs/dimensions only (e.g., `agent_id`, `endpoint`). **Testable:** grep both dashboard JSONs' `templating.list` — no variable `query`/`definition` references `title`/`text`/`content`/`feedback_text`/`raw`.

### Non-Functional Requirements

- **NFR-001 (scope):** Monitoring-stack-only. Zero changes under `/api`, `/packages/*`, `/client` (REQ-072 hold-over). `conv-log/ops/` and `conv-log/README.md` ARE in scope (not under the forbidden paths).
- **NFR-002 (deploy):** Config-only deploy: commit on `pablo` → `git push` → prod `git pull` → `cd monitoring && docker compose ... up -d grafana`. Grafana container recreate is acceptable; **Prometheus does NOT restart; LibreChat api does NOT restart; `prod-sync.sh` is NOT used; `npm run build` is NOT required** (no workspace `dist/` produced).
  - **Mechanism (why ONLY grafana is recreated — MEDIUM-4):** the monitoring stack is a **distinct compose project** (`docker-compose.monitoring.yml`) from the LibreChat app stack; `docker compose -f docker-compose.monitoring.yml up -d grafana` scopes to the monitoring project's `grafana` service only and cannot even see the LibreChat-stack `api`/`vectordb` containers. `librechat_default` is consumed as an `external` network (`:259-261`) — it is NOT owned, declared, or recreated by this compose project — so adding `grafana` to it (REQ-005) joins an existing network without touching any LibreChat-stack container. No neighbor container is in scope; only `grafana` recreates. The other monitoring services (Prometheus, exporters) are also out of scope of `up -d grafana`.
  - **Post-deploy check (operator acceptance):** confirm the `librechat-api` container's `StartedAt` is UNCHANGED after the grafana recreate (`docker inspect -f '{{.State.StartedAt}}' librechat-api` before and after).
- **NFR-003 (no new alert rules):** Add no Prometheus alert rules. Reference the three `ConvLog*` thresholds only as panel annotations/threshold lines.
- **SEC-001 (trust boundary + default-view privacy):** Stated honestly, the access-control **trust boundary is authorized-Grafana-admin access only**: `GF_USERS_ALLOW_SIGN_UP=false`, a single Grafana admin role, no per-panel/per-dashboard RBAC in OSS Grafana 11.5. The brief assumes the viewer is authorized to see all conv-log data — the same admins can `psql` the store today. The collapsed drill-down row and default-panel column rules are an **incidental-exposure-minimization measure** (a "default view privacy-respecting" control) — they reduce shoulder-surfing / accidental exposure in the default rendered view, but they are **NOT** an access-control boundary. The word "boundary" in this spec refers ONLY to the admin-auth gate; the drill-down is never called a boundary.
  - **Default-view control:** raw conversation `text`, `messages_log.content` (JSONB), `messages_log.feedback_text`, conversation `title`, and `dead_letter_log.raw` (the forbidden-default-column set: `text`, `content`, `feedback_text`, `title`, `dead_letter_log.raw`) appear ONLY inside a single drill-down row (`type: "row"`, `collapsed: true`) titled "Drill-down (raw content — authorized use only)" at the bottom of Dashboard B. Collapsed rows do not render or query nested panels until expanded, so no PII leaves Postgres on default load.
  - **Residual exposure paths (accepted risk, per the brief — an authorized admin retains ALL of these):** (1) Grafana **Explore** tab — arbitrary `SELECT text/content/feedback_text FROM messages_log`, `SELECT title FROM conversations_dim`, `SELECT raw FROM dead_letter_log` against the `convlog-postgres` datasource, unrelated to any panel; (2) ad-hoc queries against the `convlog-postgres` (`convlog_reader`) datasource generally; (3) the Grafana **query inspector** and CSV / data **export** on any panel; (4) the `/api/datasources` config endpoint; (5) Grafana **template-variable dropdowns** that could enumerate distinct raw values. OSS Grafana 11.5 cannot disable Explore per-datasource, so these are accepted. Moving raw-content access out of Grafana entirely is out of scope for this spec.
  - **Cheap hardening REQs (real, in scope):** (a) the conv-log dashboards' provider sets `allowUiUpdates: false` (REQ-016) so provisioned JSON is the source of truth and a live UI edit that adds a PII column cannot silently persist; (b) **NO dashboard template variable** may enumerate raw `title` / `text` / `content` / `feedback_text` / `raw` values (REQ-017) — any variable must be built from IDs/dimensions only, never raw text.
  - OPEN-DECISION-001 (DPO classification of `title`) is tied to THIS honest framing: the DPO is signing off on the *actual* exposure (every authorized admin can already reach all conv-log PII via the residual paths above), not on a represented "collapsed row is the boundary" premise.
- **SEC-002 (datasource least-privilege):** Datasource connects as the read-only `convlog_reader` role (`LOGIN`, `CONNECT`, `USAGE`, `SELECT` only), `access: proxy`, `editable: false`, password never in committed files. Both NFR-2 SLO line (600s) and the deployed-alert line (3000s) render on A-2 so neither operational threshold is misread as the other (DISCREPANCY-1).
- **PERF-001 (query cost / scale — MEDIUM-3):** Dashboard B SQL is author-fixed (no user input beyond Grafana time-range macros); aggregations are read-only `SELECT`. No new ETL, schema change, or metric change is introduced. Two panels aggregate the **unbounded** fact table `messages_log` (free at today's ~268 rows, but this is a long-lived monitoring surface and the table grows without bound), so the supporting indexes and access paths are stated explicitly:
  - **B-RC (recent conversations)** derives `started_at = MIN(...)`, `last_activity = MAX(...)`, `message_count = COUNT(...)` grouped by `conversation_id` — supported by `messages_log_conversation_created_idx ON (conversation_id, source_created_at)` (`001_init.sql:86-87`), which makes the per-conversation MIN/MAX/COUNT efficient. CAVEAT: the outer `ORDER BY last_activity DESC LIMIT N` sorts a **derived** column (no index on the aggregate), so the conversation set MUST be bounded BEFORE aggregating (constrain with `$__timeFilter(source_created_at)` on the inner scan) rather than relying on the LIMIT to bound the work.
  - **B-Q2 / B-MPD (per-day grouping)** use `DATE_TRUNC('day', source_created_at)` / `$__timeGroup`, which are NOT sargable against `messages_log_source_created_at_idx` (`001_init.sql:83-84`) — these MUST be bounded by `$__timeFilter(source_created_at)` (already specified) so the time predicate uses the index and limits the scan.
  - **B-Q5 (conversation-length histogram)** runs a full `messages_log` scan with no time bound; at current scale this is acceptable, but it MUST be re-evaluated (and bounded with `$__timeFilter` if it becomes slow) as the fact table grows.
  - This replaces the prior blanket "Performance: N/A": read-only, but the two unbounded-fact-table aggregations are bounded by `messages_log_conversation_created_idx` + `$__timeFilter`.

## Edge Cases (Research-Backed)

- **EDGE-001: Empty `guardrail_events_log` (and zero-row analytics panels).**
  - Research reference: Production Edge Cases ("Empty guardrail panel"); 0 guardrail events as of SPEC-016 validation.
  - Current behavior: a naive panel may render an error or blank on 0 rows.
  - Desired behavior: PII-trigger panel and guardrail stat render gracefully (stat shows 0; table shows "No data") via `noValue`/empty-table config. 0 rows is expected, not a fault.
  - Test approach: load Dashboard B against a populated-but-guardrail-empty store; confirm no error and a 0 / "No data" render.

- **EDGE-002: Idle-period `convlog_max_message_age_seconds` inflation.**
  - Research reference: Production Edge Cases; DISCREPANCY-1.
  - Current behavior: max-age grows unbounded during quiet hours; could be misread as a fault.
  - Desired behavior: A-5 panel description annotates that idle inflation is benign (the alert AND-gates with `pending > 0`).
  - Test approach: visual review of A-5 panel description; confirm annotation present.

- **EDGE-003: Backfill-mode sync-lag carve-out.**
  - Research reference: Production Edge Cases ("Backfill mode"); SPEC-016 NFR-2 carve-out.
  - Current behavior: during backfill the sync-lag SLO is not in force; threshold lines could be misread as hard faults.
  - Desired behavior: A-2 panel documents that threshold lines (600s/3000s) are steady-state references, not hard faults during backfill.
  - Test approach: visual review of A-2 panel description.

- **EDGE-004: Counter resets on sidecar restart.**
  - Research reference: Production Edge Cases ("Counter resets").
  - Current behavior: all `*_total` reset to 0 on process restart; raw counter values would show false drops.
  - Desired behavior: all throughput/error/dead-letter/erasure panels use `rate()`/`increase()` over windows, never raw counter values.
  - Test approach: PromQL review of A-4/A-6/A-7/A-9 (and bucket rates in A-8/A-12); confirm `rate(...[5m])`.

- **EDGE-005: Histogram with no observations.**
  - Research reference: THE 11 metrics (histograms #8, #10); erasure may not run for long stretches.
  - Current behavior: `histogram_quantile` over an empty `_bucket` set returns NaN/no data.
  - Desired behavior: A-8 / A-12 render "No data" gracefully; no panel error.
  - Test approach: load Dashboard A against a store where erasure has not run; confirm graceful render.

- **EDGE-006: Sparse / NULL `source_created_at` in `messages_log`.**
  - Research reference: OQ-2; THE Postgres analytics schema.
  - Current behavior: messages with NULL `source_created_at` would distort time-grouped panels (B-MPD, B-Q2) and MIN/MAX derivations (B-RC).
  - Desired behavior: time-bucketed panels rely on `$__timeFilter`/`$__timeGroup` (NULLs fall outside the range); B-RC's MIN/MAX/COUNT ignore NULL timestamps. No panel error.
  - Test approach: confirm time-grouped queries use the Grafana time macros; B-RC tolerates NULL timestamps.

- **EDGE-007: Templating / time-range edge cases.**
  - Research reference: Security Considerations (Grafana macros); brief.
  - Current behavior: an unbounded or empty time range could over-fetch or under-render.
  - Desired behavior: all picker-driven panels bound by `$__timeFilter`. Instant panels fall into TWO distinct classes that must NOT be conflated (MEDIUM-2): (i) **all-time instant** — `count(*)` stat row, model-mix, conversation-length — genuinely time-range-independent; (ii) **fixed-window instant** — B-Q1's baked-in `INTERVAL '30 days'` IGNORES the picker but shows only a fixed 30 days, not all-time. Any fixed-window panel must either adopt `$__timeFilter` or carry a panel-description note that it is a fixed window not driven by the picker. The earlier "instant panels are time-range-independent" phrasing was imprecise and is corrected here.
  - Test approach: switch the dashboard time picker across ranges; confirm all-time instant panels are stable, picker-driven panels respond, and any fixed-window panel (B-Q1) is documented as such.

## Failure Scenarios

- **FAIL-001: Datasource unreachable (network not joined).**
  - Trigger condition: `grafana` service not on `librechat_default` (REQ-005 omitted) — `vectordb:5432` not resolvable.
  - Expected behavior: datasource "Save & test" fails; Dashboard B panels show connection error. REQ-005 prevents this; the acceptance test (REQ-006 + REQ-014) catches it.
  - User communication: Grafana surfaces "dial tcp: lookup vectordb" / connection refused on the datasource page.
  - Recovery approach: add `- librechat_default` to the service `networks:` list and recreate Grafana.

- **FAIL-002: Reader lacks SELECT (the HIGH finding REQ-012/REQ-013 fix).**
  - Trigger condition: `convlog_reader` has CONNECT but no SELECT on writer-owned tables.
  - Expected behavior: "Save & test" PASSES (CONNECT only) but every Dashboard B panel returns `permission denied for table messages_log`. REQ-014's reader-SELECT acceptance test is the only check that detects this; the superuser count-check does not.
  - User communication: Grafana panel error `pq: permission denied for table messages_log`.
  - Recovery approach: run REQ-013 grants (one-time prod command + repaired `provision-postgres.sh`); re-run REQ-014 acceptance.

- **FAIL-003: Empty / missing `GRAFANA_CONVLOG_DB_PASSWORD`.**
  - Trigger condition: operator did not set the var in `.env.prod` before recreate.
  - Expected behavior: the `:?` guard (REQ-003) aborts Grafana start with a clear message before a misconfigured datasource is provisioned with an empty password.
  - User communication: compose error naming `GRAFANA_CONVLOG_DB_PASSWORD`.
  - Recovery approach: set the var in `.env.prod`; recreate Grafana.

- **FAIL-004: Histogram-quantile / no-observation panel.**
  - Trigger condition: no histogram observations in the window (covered by EDGE-005 as the data condition; here as the render-failure guard).
  - Expected behavior: panel renders "No data", not a query error.
  - User communication: "No data" panel state.
  - Recovery approach: none needed; transient by data availability.

- **FAIL-005: Wrong `GRAFANA_CONVLOG_DB_PASSWORD` (credential divergence — HIGH-2).**
  - Trigger condition: `GRAFANA_CONVLOG_DB_PASSWORD` does NOT equal the password `convlog_reader` was created with (the secret in `CONVLOG_PG_READ_URI` / `CONVLOG_PG_READER_PASSWORD`) — e.g., a rotation updated one location but not all three (REQ-004 invariant), or the operator chose a fresh value for the Grafana var. The `:?` guard (REQ-003) only catches *empty*, not *wrong*; the reader-scoped REQ-014 psql check still PASSES because it uses `CONVLOG_PG_READ_URI`, not the Grafana var — so this failure is distinct from FAIL-002 (no SELECT) and FAIL-003 (empty password).
  - Expected behavior: the datasource "Save & test" FAILS with `password authentication failed for user "convlog_reader"`, and every Dashboard-B panel errors. Detectable specifically by REQ-014b (Grafana-path acceptance), NOT by REQ-014.
  - User communication: Grafana datasource page shows `pq: password authentication failed for user "convlog_reader"`.
  - Recovery approach: resync `GRAFANA_CONVLOG_DB_PASSWORD` in `.env.prod` to the actual `convlog_reader` password (the value in `CONVLOG_PG_READ_URI`); recreate Grafana; re-run REQ-014b.

## Implementation Constraints

### Context Requirements
- **Maximum context utilization:** <40% during implementation.
- **Essential files for implementation:**
  - `monitoring/docker-compose.monitoring.yml:101-136,259-261` — Grafana service env/networks edits (REQ-003, REQ-005).
  - `monitoring/grafana/provisioning/datasources/prometheus.yml` — datasource YAML shape reference (REQ-001).
  - `monitoring/grafana/provisioning/dashboards/mongodb.json` — Dashboard A panel idioms (REQ-007, REQ-008).
  - `monitoring/grafana/provisioning/dashboards/service-overview.json` — Dashboard B stat-row/table idioms (REQ-009, REQ-011).
  - `conv-log/src/index.ts:90-153` — authoritative metric list/types for A's PromQL (REQ-008).
  - `conv-log/migrations/001_init.sql` — authoritative schema for B's SQL (REQ-009–REQ-011).
  - `conv-log/README.md:217-297` — verbatim V-6 queries (REQ-010).
  - `conv-log/ops/provision-postgres.sh:84-102` — GRANT fix site (REQ-012, REQ-013).
  - `monitoring/prometheus/alerts.yml:177-190` — threshold literals for annotations (NFR-003).
  - `.env.example:939-955` — credential-var convention (REQ-004).
- **Files that can be delegated to subagents:** None expected — all facts are resolved in the research. A Haiku-tier read of a single reference JSON (e.g., `service-overview.json`) is the only plausible delegation.

### Technical Constraints
- Grafana 11.5.2 provisioning interpolation: `${VAR}` form (REQ-002); the var MUST be in the container env (REQ-003).
- `schemaVersion: 38` for both dashboard JSONs; collapsed rows and templating supported at this version.
- Postgres datasource macros: `$__timeFilter`, `$__timeGroupAlias`, `format: table`/`time_series`.
- No unit-test framework applies to declarative JSON/YAML — validation is provisioning-load + render + count cross-check.

## Modules

### MODULE-001: Operational dashboard (Dashboard A)
- **Public Interface:** `monitoring/grafana/provisioning/dashboards/convlog-operational.json` — a provisioned dashboard (uid + 12 panels), discoverable in Grafana by tag `convlog`. No callable code; the "interface" is the panel set and its PromQL contract.
- **Hides:** the metric→panel→PromQL mapping for 11 sidecar metrics + synthetic `up`; the counter-reset-safe `rate()` discipline; histogram_quantile bucket math for two histograms; the dual sync-lag threshold semantics (600s SLO vs 3000s alert literal) and idle/backfill annotations. Callers (operators) see only rendered health panels.
- **Risk:** low
  - Boundary-only consequences; a wrong PromQL form yields a visibly-broken panel, recoverable by editing JSON and re-provisioning. No data integrity, security, or irreversible side effects.
- **Spec refs:** REQ-007, REQ-008, NFR-003, SEC-002 (dual-line), EDGE-002, EDGE-003, EDGE-004, EDGE-005, FAIL-004.

### MODULE-002: Analytics dashboard (Dashboard B)
- **Public Interface:** `monitoring/grafana/provisioning/dashboards/convlog-analytics.json` — provisioned dashboard (uid + stat row, V-6 panels, messages-per-day, recent-conversations, dead-letter inspector, collapsed drill-down row). Interface = the default-visible panel set and its read-only SQL contract.
- **Hides:** the five V-6 query adaptations to Grafana macros; the `messages_log↔agents_dim` join for agent names; the MIN/MAX/COUNT derivation of `started_at`/`last_activity`/`message_count` (absent columns); the column-selection rules that keep PII out of default panels; empty-row/no-data graceful rendering.
- **Risk:** medium
  - Default. Bugs surface as broken/empty panels (recoverable), but the SQL touches PII-bearing tables, so column-selection mistakes can border on MODULE-004's concern. The privacy-relevant column choices are governed by MODULE-004; the query mechanics here are medium-risk.
- **Spec refs:** REQ-007, REQ-009, REQ-010, REQ-011, PERF-001, EDGE-001, EDGE-006, EDGE-007.

### MODULE-003: Datasource + credential + GRANT provisioning unit
- **Public Interface:** `convlog-postgres.yml` datasource (uid `convlog-postgres`); the `GRAFANA_CONVLOG_DB_PASSWORD` env var (compose `environment:` line + `.env.example`/`.env.prod.template` templates); the corrective GRANT statements in `provision-postgres.sh` + the one-time operator command; the `- librechat_default` network membership line.
- **Hides:** the Grafana 11.5.2 `secureJsonData` interpolation path; the choice of a dedicated env var over URI-substring parsing (no compose-native regex); the Postgres `ALTER DEFAULT PRIVILEGES FOR ROLE` ownership semantics that make the reader's SELECT actually apply; the `vectordb` network reachability path mirroring `postgres-exporter`; the CONNECT-vs-SELECT validation distinction.
- **Risk:** high
  - Credential handling (a password that must never land in committed files; a `:?` guard whose absence yields a silently-empty password) AND a database GRANT whose mis-scoping silently denies all reads while "Save & test" falsely passes. Failure modes are non-obvious and gate the entire analytics surface. Reviewer attention extends to internals (interpolation form, GRANT ownership clause, the reader-not-superuser acceptance test).
- **Spec refs:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-012, REQ-013, REQ-014, REQ-015, SEC-002, FAIL-001, FAIL-002, FAIL-003.

### MODULE-004: Default-view privacy control / drill-down design
- **Public Interface:** the single collapsed drill-down row in `convlog-analytics.json` ("Drill-down (raw content — authorized use only)") and the forbidden-default-column rules every default panel obeys (no `text`, no `content`, no `feedback_text`, no `title`, no `dead_letter_log.raw`); the `allowUiUpdates: false` provider entry (REQ-016) and the no-raw-template-variable rule (REQ-017). The operator-doc statement of the trust boundary (authorized-admin-only) and the enumerated residual-exposure paths.
- **Hides:** the OSS-Grafana-has-no-RBAC reality and why the trust boundary is admin-auth only (NOT the collapsed row); why a collapsed row (panels not queried until expanded) minimizes *incidental* default-view exposure without being an access-control boundary; which exact columns are PII vs metadata across five tables; the dropped `conversation_title` in B-Q3 and the dropped `raw` in B-DL; the open DPO classification of `title`.
- **Risk:** high
  - Incidental PII exposure of real prod conversation content in the default rendered view. A single wrong column in a default panel surfaces user data to the always-visible view with no per-panel access control to catch it. NOTE: an authorized admin can reach this data anyway via the SEC-001 residual paths — the risk this module governs is *default-view* leakage to authorized-but-not-actively-looking viewers, plus governance integrity (a panel silently surfacing PII without sign-off). Regulatory/privacy relevance; reviewer attention extends to every default-panel SELECT list, the `allowUiUpdates: false` entry, and all template variables.
- **Spec refs:** REQ-010 (B-Q3 column drop), REQ-011 (B-RC/B-DL exclusions), REQ-016 (`allowUiUpdates: false`), REQ-017 (no raw template variables), SEC-001, OPEN-DECISION-001.

## Validation Strategy

### Automated Testing
- Unit Tests:
  - [ ] N/A — declarative JSON/YAML; no unit-test framework applies.
- Integration Tests (provisioning-load tier):
  - [ ] `convlog-postgres.yml` is valid YAML; both dashboard `.json` parse as valid JSON with `schemaVersion: 38`.
  - [ ] Auto-provision (throwaway Postgres): `cd monitoring && docker compose ... down grafana && docker compose ... up -d grafana` → both dashboards + the datasource appear with no manual import (REQ-006).
  - [ ] Datasource "Save & test" green (CONNECT only — necessary, not sufficient; REQ-014 note).
- Edge Case Tests:
  - [ ] EDGE-001 — guardrail-empty store renders 0 / "No data" without error.
  - [ ] EDGE-004 — all A throughput/error/erasure panels use `rate(...[5m])`.
  - [ ] EDGE-005 — A-8/A-12 render "No data" with no histogram observations.
  - [ ] EDGE-006/EDGE-007 — time-grouped panels use `$__timeFilter`/`$__timeGroup`; instant panels stable across time-range changes.

### Manual Verification
- [ ] Privacy check (any Grafana instance): no forbidden-default column — `text`, `content`, `feedback_text`, `title`, `dead_letter_log.raw` — in any default (un-expanded) panel SELECT (grep all default-panel SQL for each of the five); drill-down row collapsed by default; B-DL SELECT excludes `raw`; B-Q3 excludes `conversation_title` (SEC-001).
- [ ] Template-variable check (REQ-017): grep both dashboards' `templating.list` — no variable enumerates `title`/`text`/`content`/`feedback_text`/`raw`.
- [ ] `allowUiUpdates: false` on the conv-log dashboard provider (REQ-016).
- [ ] **Reader-SELECT gate (REQUIRED before ship, throwaway Postgres):** `psql "$CONVLOG_PG_READ_URI" -c "SELECT count(*) FROM messages_log;"` returns a row count as `convlog_reader` (REQ-014). Must pass before implementation-complete.
- [ ] A-2 renders BOTH 600s and 3000s threshold lines (SEC-002).

### Performance Validation
- [ ] Read-only SELECT panels; no throughput target. Two panels aggregate the unbounded `messages_log` fact table (PERF-001): confirm B-RC bounds its conversation set with `$__timeFilter` before the MIN/MAX/COUNT aggregation (supported by `messages_log_conversation_created_idx`, `001_init.sql:86-87`); confirm B-Q2/B-MPD `$__timeGroup`/`DATE_TRUNC` panels carry `$__timeFilter(source_created_at)`; note B-Q5 is a full scan acceptable at current scale.
- [ ] Confirm no panel re-queries on collapsed drill-down (PII non-egress, SEC-001).

### Prod-only operator-gated acceptance (post-deploy, operator-closeable)
- [ ] Dashboard A: all panels render with real prod data, no broken-query errors on first load.
- [ ] Dashboard B stat-row cross-check **run as `convlog_reader`** (not the rag superuser): baseline ~268 messages, 89 conversations, 6 agents, 0 guardrail events (REQ-009, REQ-014).
- [ ] **Grafana-path credential check (REQ-014b / HIGH-2):** `convlog-postgres` datasource "Save & test" is green AND the Dashboard-B total-`messages_log` stat panel renders a non-error value matching the psql `count(*)` — proves `GRAFANA_CONVLOG_DB_PASSWORD` authenticates end-to-end (catches FAIL-005).
- [ ] **No-api-restart check (MEDIUM-4):** `librechat-api` `StartedAt` is unchanged after the grafana recreate.
- [ ] All five V-6 queries represented as panels (REQ-010).

### Stakeholder Sign-off
- [ ] Engineering / SRE review (Dashboard A health surface).
- [ ] DPO / Governance review — **resolve OPEN-DECISION-001** (conversation `title` in default panel) before declaring dashboards final.

## Dependencies and Risks

### External Dependencies
- Grafana 11.5.2 (provisioning + env interpolation); Prometheus v2.53.3 (existing `conv-log` scrape job); Postgres `vectordb:5432/convlog`; the `convlog_reader` role.
- The `librechat_default` external Docker network (already declared).

### Identified Risks
- **RISK-001 (HIGH): reader SELECT silently broken.** "Save & test" passes on CONNECT while all panels fail on SELECT. Mitigation: REQ-012/REQ-013 grants + REQ-014 reader-not-superuser acceptance test gating ship.
- **RISK-002 (HIGH): incidental PII leak via a wrong default-panel column.** No per-panel RBAC. HONEST scoping (HIGH-1): the SEC-001 column rules govern only what *default on-disk panels* SELECT — they are NOT an access-control boundary, and an authorized admin can reach all conv-log PII anyway via Explore / ad-hoc query / query inspector / CSV export / `/api/datasources` (SEC-001 residual paths, accepted risk). The risk this entry tracks is *default-view* leakage to authorized-but-not-actively-looking viewers plus governance integrity. Mitigation: SEC-001 forbidden-default-column set (`text`/`content`/`feedback_text`/`title`/`raw`), MODULE-004 review, manual privacy check, `allowUiUpdates: false` (REQ-016), no raw template variables (REQ-017).
- **RISK-003 (MEDIUM): credential mishandling.** Empty/hardcoded password. Mitigation: REQ-002/REQ-003 `${VAR}` + `:?` guard; never in committed files; rotation note (REQ-004).
- **RISK-004 (MEDIUM): network blocker.** Mitigation: REQ-005 single additive line; FAIL-001 acceptance.
- **RISK-005 (MEDIUM, raised from LOW — MEDIUM-5): GRANT and default-privilege fix not applied on config-only deploy** because `provision-postgres.sh` is not re-run on prod. REQ-013b (one-time GRANT) covers TODAY's tables; without REQ-013c the durable `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` fix never reaches the live prod DB, so a future migration's new table would silently break Dashboard B months later — reproducing the HIGH finding this spec exists to fix. Mitigation: REQ-013b AND REQ-013c explicit one-time prod commands in operator docs (REQ-015).
- **RISK-006 (MEDIUM-to-HIGH, new — HIGH-2): credential triplet divergence.** `GRAFANA_CONVLOG_DB_PASSWORD`, the password inside `CONVLOG_PG_READ_URI`, and the role's actual `CONVLOG_PG_READER_PASSWORD` are three copies of one secret; a partial rotation diverges them, breaking the datasource while the reader-scoped REQ-014 psql check still passes. Mitigation: REQ-004 single-source-of-truth invariant + atomic rotation note; FAIL-005; REQ-014b Grafana-path acceptance detects it.

### Open Decisions
- **OPEN-DECISION-001 (MUST resolve before dashboards declared final — OQ-1):** Should `conversations_dim.title` appear in the default (Grafana-admin-visible) "recent conversations" panel? The brief lists `title` as a default column, but its own security constraint classifies `title` as PII, and the on-file DPO acceptance (SPEC-016) covers retention only — NOT this UI surface. **Default assumption (safe, implemented):** `title` is drill-down-only; the default B-RC panel shows `conversation_id`, `endpoint`, `agent_id`, and derived timestamps/count, no `title`. **Active ask (owner: product owner / DPO):** explicitly sign off whether `title` may be promoted to the default panel. If widened, promote `title` from the drill-down row to B-RC with no other change. This is recorded as open and not silently deferred.

## Implementation Notes

### Suggested Approach
1. Land the infrastructure unit first (MODULE-003): network line (REQ-005), env var + templates with the credential invariant (REQ-003/REQ-004), GRANT fix (REQ-012) + one-time prod grant (REQ-013b) + one-time prod default-privilege fix (REQ-013c), datasource YAML (REQ-001/REQ-002). Verify REQ-014 reader-SELECT (proves GRANT) AND REQ-014b Grafana-path "Save & test" + stat-panel render (proves the configured credential) against a throwaway Postgres — this de-risks the whole feature.
2. Author Dashboard A (MODULE-001) from `mongodb.json`, applying the definitive PromQL mapping and the dual sync-lag lines.
3. Author Dashboard B (MODULE-002) from `service-overview.json`, with the forbidden-default-column rules (`text`/`content`/`feedback_text`/`title`/`raw`, MODULE-004/SEC-001) baked into every default panel, the bounded-aggregation patterns (PERF-001: `$__timeFilter` on B-RC/B-Q2/B-MPD), no raw template variables (REQ-017), and the collapsed drill-down row added last. Set the conv-log provider to `allowUiUpdates: false` (REQ-016).
4. Operator docs (REQ-015) including the one-time GRANT command and rotation note.

### Areas for Subagent Delegation
- Minimal. A Haiku-tier read of `service-overview.json` panel idioms is the only plausible delegation; all domain facts are resolved in RESEARCH-017.

### Critical Implementation Considerations
- The `${GRAFANA_CONVLOG_DB_PASSWORD}` form (NOT `$__env{...}`) and the compose `:?`-guarded env line are both required for interpolation to work.
- `GRAFANA_CONVLOG_DB_PASSWORD` MUST equal the actual `convlog_reader` password (the secret in `CONVLOG_PG_READ_URI` / `CONVLOG_PG_READER_PASSWORD`) — REQ-004 invariant; the `:?` guard catches *empty*, not *wrong* (FAIL-005). REQ-014 (reader psql) does NOT prove this — only REQ-014b ("Save & test" + stat render) does.
- Forbidden default-panel columns are `text`, `content` (JSONB), `feedback_text`, `title`, and `dead_letter_log.raw` — all five must stay out of default panels and out of template variables (SEC-001/REQ-017). The collapsed drill-down minimizes *incidental* default-view exposure; it is NOT an access-control boundary (an authorized admin reaches the data via Explore/ad-hoc/export anyway).
- `ALTER DEFAULT PRIVILEGES` MUST carry `FOR ROLE convlog_writer` or it silently no-ops for the writer-owned tables.
- The reader-SELECT acceptance MUST run as `convlog_reader` (via `CONVLOG_PG_READ_URI`), never as the rag superuser — the superuser check produces false positives.
- Collapsed rows do not query nested panels until expanded — this is the PII-non-egress property the default-view privacy control depends on (NOT an access-control boundary; SEC-001); keep all raw-content panels nested under the single collapsed row.
- No bind-mount change (directory mount already correct); no new Prometheus alert rules; no api restart; no `prod-sync.sh`.
