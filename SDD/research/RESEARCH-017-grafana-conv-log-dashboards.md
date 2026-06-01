# RESEARCH-017-grafana-conv-log-dashboards

> Feature: Grafana dashboards for the SPEC-016 conv-log analytical store + operational metrics.
> Design concept: `SDD/GRAFANA_FOR_CONV_LOG.md` (user designated as the externalized concept; `/research-clarify` gate skipped — no `CLARIFICATION-017` artifact exists).
> Scope: **monitoring-stack only**. Zero changes under `/api`, `/packages/*`, `/client` (REQ-072 hold-over).
> Deliverables: Dashboard A (Prometheus-backed operational), Dashboard B (Postgres-backed analytics), one new Postgres datasource, operator docs.

---

## System Data Flow

### Two independent data planes

```
Dashboard A (operational)                Dashboard B (analytics)
  Grafana panel                            Grafana panel
   └─ PromQL → Prometheus datasource        └─ SQL → NEW Postgres datasource
       (uid: prometheus, exists)                (uid: convlog-postgres, TO CREATE)
        └─ scrapes conv-log:9300/metrics         └─ vectordb:5432/convlog as convlog_reader
            └─ buildMetrics() registry               └─ messages_log / *_dim / *_log tables
```

- **Key entry points:**
  - Grafana service: `monitoring/docker-compose.monitoring.yml:101-136` (image `grafana/grafana:11.5.2`, provisioning bind mount `./grafana/provisioning:/etc/grafana/provisioning:ro` at `:112`).
  - Metric source of truth: `conv-log/src/index.ts:90-154` (`buildMetrics`); exposed at `conv-log:9300/metrics` (`index.ts:178-182`, `455-462`).
  - Prometheus scrape job `conv-log` already configured (`monitoring/prometheus/prometheus.yml`; confirmed by commit `337c39ac8` message — V-8 validated the scrape).
  - Analytical schema: `conv-log/migrations/001_init.sql` (6 tables).
  - Existing datasource pattern: `monitoring/grafana/provisioning/datasources/prometheus.yml`.
  - Dashboard provider: `monitoring/grafana/provisioning/dashboards/dashboards.yml`.
  - Closest dashboard pattern (A): `monitoring/grafana/provisioning/dashboards/mongodb.json`.
  - Stat-row + table patterns (B): `monitoring/grafana/provisioning/dashboards/service-overview.json`.

- **Data transformations:** None added by this feature. Dashboard A reads pre-computed Prometheus series. Dashboard B issues read-only `SELECT` against the analytical store (already populated by the sidecar). No new ETL, no schema change, no metric change.

- **External dependencies:** Grafana 11.5.2; Prometheus v2.53.3; Postgres (vectordb:5432, database `convlog`); the `convlog_reader` Postgres role (read-only, created by `conv-log/ops/provision-postgres.sh`).

- **Integration points:** Grafana provisioning subsystem (datasources + dashboards directories), the `librechat_default` Docker network (for Grafana→vectordb reachability — see Security/Network), `.env.prod`/`.env.example` for the datasource credential var.

---

## Stakeholder Mental Models

- **Product / Governance (DPO):** Wants conversation analytics visible without ad-hoc SQL, but raw text + titles are real prod PII (DPO acceptance is on file for *retention*, not for *broad UI exposure*). Mental model: "counts and dimensions are fine to surface; raw content must be deliberate, gated, and access-logged."
- **Engineering / SRE:** Wants Dashboard A to be the at-a-glance health surface for the sidecar — is it up, is it lagging, is it dead-lettering, how long do ticks take. Mental model mirrors the existing `mongodb.json` / `service-overview.json` muscle memory (stat row on top, timeseries below).
- **Analyst:** Wants the analytics dashboard (Dashboard B) to reproduce the five README V-6 queries as living panels (top users, model mix, agent error rates, conversation lengths, PII triggers) so they stop copy-pasting SQL.
- **Operator (deploy):** Wants the whole thing to auto-provision on `docker compose up -d grafana` with no manual import, and to deploy via the config-only path (git push + prod git pull + grafana recreate) — NOT prod-sync.sh, NOT a LibreChat api restart.

---

## Production Edge Cases

- **Empty guardrail panel:** As of SPEC-016 validation: 268+ messages, 89 conversations, 6 agents, **0 guardrail events**. Dashboard B's PII-trigger panel and the guardrail stat will render empty until a PII rule fires in prod. **Expected, not a bug** — panels must use `noValue`/empty-table-friendly config, not error on no rows.
- **Idle-period max-age inflation:** `convlog_max_message_age_seconds` grows unbounded during quiet hours (no new messages). The alert AND-gates it with `pending > 0`; the Dashboard A panel should annotate this so an on-call doesn't misread a large value as a fault.
- **Backfill mode:** During backfill, sync-lag SLO is explicitly NOT in force (`SPEC-016 NFR-2` carve-out). Threshold lines on the sync-lag panel are steady-state references, not hard faults; document this.
- **Counter resets on sidecar restart:** All `*_total` metrics reset to 0 on process restart — Dashboard A must use `rate()`/`increase()` over windows, never raw counter values, for throughput/error/dead-letter/erasure panels.
- **`schema_migrations` table** exists in `convlog` but is operational, not analytical — exclude from Dashboard B.
- **Stale-inode bind-mount class of bug (RESOLVED for Grafana):** Commit `337c39ac8` fixed Prometheus single-file mounts. Grafana already uses a **directory** mount (`./grafana/provisioning:/etc/grafana/provisioning:ro`), so the new datasource YAML and two dashboard JSONs land inside an already-correct directory mount — **no bind-mount change required** (this is a key finding: the brief's "apply the same fix if not already" resolves to "already correct, no action").

---

## Files That Matter

### To create
- `monitoring/grafana/provisioning/datasources/convlog-postgres.yml` (or extend `prometheus.yml` — recommend a separate file for clarity; the provider scans the whole directory).
- `monitoring/grafana/provisioning/dashboards/convlog-operational.json` (Dashboard A).
- `monitoring/grafana/provisioning/dashboards/convlog-analytics.json` (Dashboard B).

### To edit
- `.env.example` — add commented template for the new datasource credential var inside/after the conv-log block (`.env.example:939-955`).
- `.env.prod.template` — add the resolved var (operator-side; the runtime `.env.prod` is gitignored).
- `conv-log/README.md` — add a "Grafana Dashboards" section (or new `monitoring/` doc) covering access, panel inventory, and the privacy boundary.

### Reference (read-only patterns — do not modify)
- `monitoring/grafana/provisioning/datasources/prometheus.yml` (datasource YAML shape: `apiVersion: 1`, `datasources:` list, `access: proxy`, `editable: false`, `jsonData`).
- `monitoring/grafana/provisioning/dashboards/dashboards.yml` (`type: file`, `path: /etc/grafana/provisioning/dashboards`, `foldersFromFilesStructure: false`, `allowUiUpdates: true`, `updateIntervalSeconds: 30`).
- `mongodb.json` / `service-overview.json` (`schemaVersion: 38`, panel JSON idioms).

### Tests
- No unit-test framework applies to dashboard JSON. Validation is provisioning-load + render + count-cross-check (see Testing Strategy). No `__tests__` directory is relevant.

---

## THE 11 conv-log Prometheus Metrics (authoritative — `conv-log/src/index.ts:90-153`)

| # | Metric | Type | Labels | Notes |
|---|---|---|---|---|
| 1 | `convlog_messages_synced_total` | Counter | — | use `rate(...[5m])` for throughput |
| 2 | `convlog_sync_lag_seconds` | Gauge | — | the SLO metric (NFR-2) |
| 3 | `convlog_pending_messages` | Gauge | — | sampled each tick |
| 4 | `convlog_max_message_age_seconds` | Gauge | — | inflates when idle |
| 5 | `convlog_errors_total` | Counter | `phase` | phases seen in code: `normalisation`, `telemetry`, `postgres_upsert`, `reconciliation`, `pg_client_error`, `pg_reconcile_client_error`, `mongo_client_error`, `config_guardrail_missing`. README lists a partly-different set — see DISCREPANCY-2. |
| 6 | `convlog_dead_letter_total` | Counter | `phase` | `postgres_upsert` is the common phase; non-`postgres_upsert` phases = structural failure (alert) |
| 7 | `convlog_last_run_unix_timestamp` | Gauge | — | drives "seconds since last tick" via `time() - metric` |
| 8 | `convlog_batch_duration_seconds` | **Histogram** | — | buckets `[0.01,0.05,0.1,0.5,1,5,10,30,60,120]`; exposes `_bucket{le}`, `_sum`, `_count` |
| 9 | `convlog_erasure_deletions_total` | Counter | — | use `rate(...[5m])` |
| 10 | `convlog_erasure_chunk_deleted_ratio` | **Histogram** | — | buckets `[0,0.05,0.1,0.2,0.3,0.5,0.75,1.0]`; exposes `_bucket{le}`, `_sum`, `_count` |
| 11 | `convlog_bisection_max_depth_observed` | Gauge | — | stat or timeseries |

Plus the Prometheus-synthetic **`up{job="conv-log"}`** (not emitted by the sidecar; produced by Prometheus per-scrape). This is the resolution of the brief's "11 metrics / 12 panel bullets" mismatch: 11 sidecar metrics + 1 synthetic `up`, and the two histograms (#8, #10) each feed a multi-quantile panel — see the mapping table.

### Definitive metric → panel → PromQL mapping (Dashboard A)

| Brief bullet | Panel type | PromQL |
|---|---|---|
| `up` stat | stat | `up{job="conv-log"}` (value mappings 0=DOWN/red, 1=UP/green, per `mongodb.json:24-25`) |
| sync lag + SLO line | timeseries | `convlog_sync_lag_seconds`; **two threshold lines:** 600s (NFR-2 SLO = 2×`CONVLOG_INTERVAL_SECONDS`) and 3000s (the deployed alert threshold — see DISCREPANCY-1) |
| pending messages | timeseries | `convlog_pending_messages` |
| sync throughput | timeseries | `rate(convlog_messages_synced_total[5m])` |
| max message age | timeseries | `convlog_max_message_age_seconds` (annotate idle-inflation) |
| errors by phase | timeseries (stacked) | `sum by (phase) (rate(convlog_errors_total[5m]))`, `legendFormat: {{phase}}` |
| dead-letter by phase | timeseries (stacked) | `sum by (phase) (rate(convlog_dead_letter_total[5m]))` |
| batch duration p50/p95/p99 | timeseries | `histogram_quantile(0.5, sum(rate(convlog_batch_duration_seconds_bucket[5m])) by (le))` (and 0.95, 0.99) — unit `s` |
| erasure deletions | timeseries | `rate(convlog_erasure_deletions_total[5m])` |
| bisection max depth | stat or timeseries | `convlog_bisection_max_depth_observed` |
| seconds since last tick | stat | `time() - convlog_last_run_unix_timestamp` (unit `s`) |
| erasure chunk ratio quantiles | timeseries | `histogram_quantile(0.5\|0.95\|0.99, sum(rate(convlog_erasure_chunk_deleted_ratio_bucket[5m])) by (le))` (unit `percentunit`, max 1) |

> Histogram confirmation: both #8 and #10 are `prom-client` `Histogram` instances (`index.ts:129-134`, `141-146`), so `_bucket`/`_sum`/`_count` series exist. `histogram_quantile` forms above are correct.

---

## THE Postgres analytics schema (Dashboard-B-relevant columns — NOT exhaustive; `conv-log/migrations/001_init.sql` is the authoritative source)

| Table | Dashboard-B-relevant columns | Notable omitted columns (in schema but not listed here) |
|---|---|---|
| `messages_log` | `user_id`, `conversation_id`, `model_or_agent_id`, `is_user`, `error` (BOOLEAN), `token_count`, `source_created_at`, **`text`/`content` = RAW PII (gate)** | `sender`, `endpoint`, `parent_message_id`, `unfinished`, `has_attachments`, `has_files`, `feedback_rating`, `feedback_tag`, `feedback_text` |
| `conversations_dim` | `conversation_id`, **`title` = PII (gate — see OQ-1)**, `agent_id`, `endpoint`, `user_id`, `source_created_at`, `source_updated_at` | `archived` (BOOLEAN — useful for filtering), `tags` (JSONB — potential dimension), `dim_updated_at`, `schema_version` |
| `agents_dim` | `agent_id`, `name` (human-readable), `model_underlying`, `last_seen_at` | `description`, `dim_updated_at`, `schema_version` |
| `guardrail_events_log` | `event_id`, `message_id`, `conversation_id`, `user_id`, `route`, `entity_types` (JSONB), `entity_count` (INT), `source_created_at` | `synced_at` |
| `dead_letter_log` | `source_collection`, `source_id`, `error_phase`, `error_detail` (sanitized), `retry_count`, `last_failed_at`, `first_failed_at` | **`raw` JSONB = RAW PII (gate)** — original failed source document; contains message text for messages_log dead-letters; must be excluded from default-visible panel |
| `sync_state` | operational (watermark) — not for Dashboard B | — |

> **Critical schema fact (vs brief wording):** there is **no `agent_name` column** on `messages_log`. Agent error-rate panels MUST join `messages_log.model_or_agent_id = agents_dim.agent_id` and read `agents_dim.name`. There is **no `message_count`, `started_at`, or `last_activity` column** on `conversations_dim` — those values for the "recent conversations" panel must be **derived** (`MIN/MAX(messages_log.source_created_at)`, `COUNT(*)`) or sourced from `conversations_dim.source_created_at`/`source_updated_at`. The brief's panel spec (`conversation_id, title, started_at, last_activity, message_count`) is achievable only via aggregation — see mapping below.

### The five V-6 queries (verbatim from `conv-log/README.md:217-297`) → Dashboard B panels

All five are reproducible against the `convlog_reader` datasource. Grafana Postgres datasource format notes appended.

1. **Q1 Top 10 users by volume** (README:219-225) → **table** panel, `format: table`, instant query. Verbatim SQL usable as-is.
2. **Q2 Agent error rates over time** (README:230-244) → **timeseries** grouped by `agent_name`. Needs `format: time_series` + the macro `$__timeGroup`/`$__timeFilter` adaptation, OR keep `DATE_TRUNC('day', ...)` and use `format: table` with a time field. Recommend `$__timeGroupAlias(ml.source_created_at, '1d')` + `$__timeFilter(ml.source_created_at)` so the dashboard time picker drives it.
3. **Q3 PII-trigger correlation** (README:249-262) → **table**. **PRIVACY:** the verbatim query selects `cd.title AS conversation_title` (PII). Brief mandates "entity_types and entity_count only, not redacted content" for the default panel → **drop `conversation_title`** from the default panel; keep `conversation_id`, `message_id`, `route`, `entity_count`, `entity_types`, `triggered_at`. Title-bearing variant goes in the gated drill-down only.
4. **Q4 Model usage distribution** (README:267-274) → **piechart** or **bargauge**, `format: table`, instant. Verbatim SQL usable as-is.
5. **Q5 Conversation length histogram** (README:280-296) → **barchart**, `format: table`, instant. Verbatim SQL usable as-is.

### Additional Dashboard B panels (from brief, beyond the 5 queries)
- **Stat row:** `SELECT count(*) FROM conversations_dim`; `... FROM messages_log`; `... FROM agents_dim`; `... FROM guardrail_events_log`; `... FROM dead_letter_log`. These five counts are the success-criterion cross-check targets (`docker exec -i vectordb psql -U librechat_rag -d convlog -tAc "SELECT count(*) FROM messages_log"`).
- **Messages-per-day** timeseries: `$__timeGroup(source_created_at,'1d') ... COUNT(*) FROM messages_log` (PII-safe).
- **Recent conversations** table (PII-boundary: `title` IS PII per brief, but brief explicitly lists `title` in this panel and says "titles only, no raw message text"). **Open design question OQ-1** (see below): the brief is internally tension'd — it lists `title` as a default-panel column yet the security constraint says titles are PII. Recommend: titles go behind the gated drill-down; the default "recent conversations" panel shows `conversation_id`, derived `started_at`/`last_activity`/`message_count` only. Spec must resolve.
- **Dead-letter inspector** table: `SELECT source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at FROM dead_letter_log ORDER BY last_failed_at DESC LIMIT 50` (`error_detail` already sanitized per SPEC-016 README:319). **PII note: `dead_letter_log.raw` (JSONB, `001_init.sql:122`) stores the original failed source document — for a messages_log dead-letter this is raw message text/content (PII). This column MUST be excluded from the default dead-letter inspector panel.** The SELECT list above already excludes it. If raw document inspection is needed for debugging, it must go into the collapsed drill-down row only.
- **Optional drill-down** (collapsed row / separate tag): conversation content viewer exposing `conversations_dim.title` and/or `messages_log.text` — gated, collapsed by default.

---

## Security Considerations

- **Auth/Authorization:** Grafana admin-only (`GF_USERS_ALLOW_SIGN_UP=false`, compose `:108`); external access via Caddy at `https://grafana.memodo-eng.de`. Single access gate. No per-panel RBAC in OSS Grafana 11.5 — the privacy boundary is **design-level** (which columns each default panel selects), not enforced by Grafana permissions.
- **Data Privacy — the central constraint:** raw `messages_log.text`/`content`, `conversations_dim.title`, and **`dead_letter_log.raw`** (JSONB — contains the original failed source document, which for messages-origin dead-letters holds raw message text/content) are all PII-gated columns. **Default-visible panels limited to counts, IDs, dimensions, metadata.** Any raw-content panel must be (a) in a collapsed row, (b) gated behind a dashboard variable, or (c) in a separately-tagged "drill-down" dashboard. Grafana supports collapsed rows (`type: "row"`, `collapsed: true`) and dashboard variables (`templating.list`) — both available at schemaVersion 38. **Recommendation:** default Dashboard B = privacy-respecting (no `text`, no `title`); a single collapsed row at the bottom titled "Drill-down (raw content — authorized use only)" holding the title/text viewer, collapsed by default so it doesn't render until expanded.
- **Datasource credential — the central design decision.** Two candidates:
  - **(A) dedicated `GRAFANA_CONVLOG_DB_PASSWORD` env var** referenced via Grafana datasource provisioning. **Interpolation syntax clarification (Grafana 11.5.2):** Grafana's provisioning subsystem supports environment-variable interpolation in YAML config files. The supported syntax for Grafana 11.x is `${VAR_NAME}` for most fields. For `secureJsonData` fields (which are encrypted at rest), the Grafana provisioning docs for 11.x confirm that `${VAR_NAME}` substitution is applied before the value is encrypted and stored — the same interpolation pass covers all YAML keys including `secureJsonData`. The in-repo `prometheus.yml` does not use `secureJsonData` at all (plain `jsonData`, no credentials), so there is no direct in-repo precedent for `secureJsonData.password: ${VAR}`. However, the Grafana 11 provisioning architecture (Grafana docs: "Datasource provisioning — Using environment variables") explicitly states env-var substitution applies to all values in the provisioning YAML, including `secureJsonData`. The compose already passes `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:?...}` into the Grafana container (`:107`), demonstrating the compose→container-env→Grafana-interpolation chain works for this stack. **Spec must pin:** use `${GRAFANA_CONVLOG_DB_PASSWORD}` in `secureJsonData.password`; add `- GRAFANA_CONVLOG_DB_PASSWORD=${GRAFANA_CONVLOG_DB_PASSWORD:?...}` to the grafana service `environment:` block in `docker-compose.monitoring.yml` so the variable is in the container env at Grafana load time. **Validation requirement:** the spec's datasource acceptance test must confirm *auth* (not just CONNECT) by running a SELECT as `convlog_reader` — CONNECT alone does not prove the interpolated password was correct. Clean, explicit, correct interpolation path.
  - **(B) parse the password out of the existing `CONVLOG_PG_READ_URI`.** Docker Compose **cannot** decompose a URI into a sub-variable without an entrypoint shim — there is no compose-native substring/regex extraction. Would require a custom Grafana entrypoint or an init container. Adds moving parts and fragility.
  - **RECOMMENDATION: (A).** Add `GRAFANA_CONVLOG_DB_PASSWORD` to `.env.prod` (resolved) + `.env.example`/`.env.prod.template` (commented template, per the brief constraint and the `.env.example:939` convention). The datasource YAML hardcodes nothing — `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}`, `user: convlog_reader`, `database: convlog`, `url: vectordb:5432`. The compose `grafana` service must add `- GRAFANA_CONVLOG_DB_PASSWORD=${GRAFANA_CONVLOG_DB_PASSWORD:?...}` to its `environment:` block (otherwise the var isn't in the container env for Grafana to interpolate). Document that this duplicates the password already inside `CONVLOG_PG_READ_URI` and that rotations must update both (acceptable trade-off vs the shim complexity of (B)).
  - **`convlog_reader` SELECT grant — FINDING (HIGH): currently broken as provisioned.** The provisioning script (`provision-postgres.sh:84,89,94,97,101-102`) creates `convlog_reader` with CONNECT and USAGE, then runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader` (`:101-102`) — but this statement is executed **as the admin/superuser** (via `PG_ADMIN_URI`) with **no `FOR ROLE convlog_writer` clause**. Postgres semantics: `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` applies only to objects created by the role that ran the statement (the admin). The migration runner connects via `CONVLOG_PG_URI` = `convlog_writer` credentials (`conv-log/src/index.ts:65,394,407`; `.env.example:949-951`) — so all tables in `001_init.sql` are **owned by `convlog_writer`**. Ownership transfer confirms this: `provision-postgres.sh:97` runs `ALTER SCHEMA public OWNER TO convlog_writer`, making `convlog_writer` the schema owner. Conclusion: **`convlog_reader` has NO SELECT on the writer-owned tables created by the migration runner.** Dashboard B's datasource — connecting as `convlog_reader` — would fail every panel with `permission denied for table messages_log`. The smoke test in `SDD/orchestration/progress.md:290` claimed "default privileges work after the first writer-owned table is created" — that claim is incorrect per these Postgres semantics and may have been masked by the smoke-test issuing `CREATE TABLE` as the admin role (not as `convlog_writer`), which would make the `ALTER DEFAULT PRIVILEGES` apply and show a false positive. There is no `GRANT SELECT ON ALL TABLES` or `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer` anywhere in the repo. **Datasource "Save & test" passing is NOT sufficient** — it only checks CONNECT, not SELECT. **Corrective DDL the spec must require (both are needed; touching `conv-log/ops/` is in-scope per REQ-072 carve-out):** (1) one-time operator GRANT for existing tables: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO convlog_reader;` — run once against prod `convlog` (or add to `provision-postgres.sh` as an idempotent step); (2) fix the default-privileges line in `provision-postgres.sh:101-102` to scope it correctly: `ALTER DEFAULT PRIVILEGES FOR ROLE convlog_writer IN SCHEMA public GRANT SELECT ON TABLES TO convlog_reader;` — this ensures all future migrations run by `convlog_writer` are automatically readable by `convlog_reader`. **Spec acceptance test must include:** run `SELECT count(*) FROM messages_log` AS `convlog_reader` (via `CONVLOG_PG_READ_URI`, not as `librechat_rag` superuser) and confirm it returns a row count — this is the only validation that proves end-to-end SELECT access. Datasource must set `sslmode: disable` (matches `postgres-exporter` DSN, compose `:203`).
- **Network reachability — VERIFIED with a caveat (BLOCKER, fix shape pinned).** Compose `grafana` service `networks:` block (`docker-compose.monitoring.yml:134-136`) lists **`monitoring`, `caddy_net`** — **NOT `librechat_default`.** The brief asserts "Grafana is on `librechat_default`"; that is **incorrect as the file currently stands** (only `prometheus` (`:95-99`, which also adds `redakt_default`), `librechat-exporter` (`:160-162`), `mongodb-exporter` (`:192-194`), `postgres-exporter` (`:216-218`) join `librechat_default`). **This is DISCREPANCY-3 and a hard blocker:** for Grafana to reach `vectordb:5432`, the `grafana` service MUST add `librechat_default` to its `networks:` list.
  - **Which network does `vectordb` actually live on? `librechat_default`** — proven by `postgres-exporter`, which reaches `vectordb:5432` (`DATA_SOURCE_NAME=...@vectordb:5432/...`, `:203`) and joins exactly `monitoring` + `librechat_default` (`:216-218`). The compose top-level network comment at `:18-19` and `:255-257` states `librechat_default` is "the application stack's default network — allows exporters to reach database containers (mongodb, vectordb, etc.)". So Grafana joining `librechat_default` resolves `vectordb:5432` by the identical path the postgres-exporter already uses in prod.
  - **Exact fix shape (the ONLY compose edit this feature requires):** add one line — `- librechat_default` — to the `grafana` service `networks:` list at `:134-136`, yielding `monitoring`, `caddy_net`, `librechat_default`. **No new top-level network declaration is needed:** `librechat_default` is ALREADY declared as an `external` network at the file's bottom (`:259-261`, `name: ${COMPOSE_PROJECT_NETWORK:-librechat-worktree_default}`). The edit is purely additive to the service block. Still monitoring-stack-only (REQ-072 honored). Without it, Dashboard B's datasource fails "Save & test".
- **Input validation:** N/A for static dashboard JSON; SQL is author-fixed (no user-supplied input beyond Grafana's own time-range macros).

---

## Testing / Validation Strategy

No unit tests apply (declarative JSON/YAML). Validation is partitioned into two tiers: **pre-deploy-verifiable** (implementer-closeable) and **prod-only operator-gated acceptance** (cannot be validated without the live populated `convlog` store).

### Pre-deploy-verifiable (implementer can close these before shipping)

1. **JSON/YAML lint:** `monitoring/grafana/provisioning/datasources/convlog-postgres.yml` is valid YAML; both dashboard `.json` files parse as valid JSON with `schemaVersion: 38`.
2. **Auto-provision test (local/throwaway Postgres):** `cd monitoring && docker compose -f docker-compose.monitoring.yml --env-file ../.env.prod down grafana && docker compose ... up -d grafana` → both dashboards appear in Grafana provisioning list with no manual import; datasource provisioned automatically on restart.
3. **Datasource "Save & test":** Grafana UI → datasource → green check. **IMPORTANT: this only validates CONNECT, not SELECT.** A passing "Save & test" does NOT prove `convlog_reader` can SELECT from the analytical tables. This criterion is necessary but not sufficient.
4. **Privacy check (local, any Grafana instance):** confirm no `text`/`title`/`raw` visible in the default (un-expanded) view; drill-down row collapsed; dead-letter inspector SELECT list excludes `raw`.
5. **`convlog_reader` SELECT gate (local throwaway Postgres — REQUIRED before shipping):** run `psql "$CONVLOG_PG_READ_URI" -c "SELECT count(*) FROM messages_log;"` against a provisioned throwaway Postgres where the migration runner has been run. This confirms the corrective grants (see Security Considerations — `convlog_reader` SELECT grant FINDING) are in place and `convlog_reader` can SELECT writer-owned tables. This step must pass before the feature is considered implementation-complete.

### Prod-only operator-gated acceptance (cannot be pre-validated; operator-closeable post-deploy)

6. **Dashboard A render with real data:** all panels render with real prod data, no broken-query errors on first load.
7. **Dashboard B stat-row cross-check — run as `convlog_reader`:** each stat equals the result of querying as `convlog_reader` (not as `librechat_rag` superuser — see note below). Baseline: ~268 messages, 89 conversations, 6 agents, 0 guardrail events.
8. **Five-query coverage:** confirm all five V-6 queries are represented (or documented why excluded) with real prod data.

> **Critical note on the `psql` count-check command:** the original command `docker exec -i vectordb psql -U librechat_rag -d convlog -tAc "SELECT count(*) FROM <table>"` uses the **rag superuser**, not `convlog_reader`. This is fine for a quick count sanity-check but it does NOT validate `convlog_reader` permissions — a superuser can always SELECT regardless of grants. The acceptance test for criterion 7 must use `psql "$CONVLOG_PG_READ_URI"` (the reader URI) to prove end-to-end SELECT access. If `convlog_reader` lacks SELECT (the HIGH finding above), this check will catch it; the superuser check will not.

---

## Deploy Path (confirmed against CLAUDE.md "Production Deploy Discipline" + conv-log README:11-13)

- **Config-only path.** No workspace `dist/` is produced → **`prod-sync.sh` is NOT used**, `npm run build` is NOT required.
- Steps: commit on `pablo` → `git push` → on prod `git pull` → `cd monitoring && docker compose ... up -d grafana` (Compose detects mount/env/network changes and recreates the Grafana container).
- **Grafana container recreate is acceptable; Prometheus does NOT restart; LibreChat api does NOT restart** (brief constraint + memory `feedback_prod_yaml_deploy`).
- New datasource YAML + dashboard JSONs land inside the **already-correct directory bind mount** → picked up on Grafana start (datasources at boot; dashboards within `updateIntervalSeconds: 30`).
- Operator must set `GRAFANA_CONVLOG_DB_PASSWORD` in prod `.env.prod` before the recreate (else the `:?` guard aborts Grafana start).

---

## Documentation Needs

- **Operator docs** (`conv-log/README.md` new section, or `monitoring/`): where dashboards live (`https://grafana.memodo-eng.de`), panel inventory for A and B, the privacy boundary (default vs collapsed drill-down), the new credential var and its rotation note, the auto-provision/deploy steps.
- **Config docs:** `.env.example` + `.env.prod.template` commented template for `GRAFANA_CONVLOG_DB_PASSWORD`.
- **Cross-reference:** link Dashboard A panels to the three `ConvLog*` alert thresholds (annotation/threshold lines, not new rules).

---

## Discrepancies & Open Questions (research risk to carry into the spec)

- **DISCREPANCY-1 (sync-lag threshold) — deployed value CONFIRMED.** Brief says the SLO threshold line is "2 × CONVLOG_INTERVAL_SECONDS (default 600s)". The **deployed alert** `ConvLogSyncLagBreach` (`alerts.yml:177-190`) fires at the **literal baked-in `3000`** — expr `(convlog_sync_lag_seconds > scalar(vector(3000))) and on() (convlog_pending_messages > 0)`, `for: 15m`, `severity: warning` (verified verbatim at `alerts.yml:177-190`). The `3000` is `max(10 × CONVLOG_INTERVAL_SECONDS=300, CONVLOG_ALERT_MIN_LAG_SECONDS=900) = 3000s` per the inline operator comment (`alerts.yml:152-176`); Prometheus cannot read sidecar env at eval time so the value is a hand-maintained literal. **Both numbers are real and serve different purposes:** 600s = NFR-2 steady-state P95 *SLO target* (`SPEC-016 NFR-2`); 3000s = the *alert fire* threshold. **Dashboard A's sync-lag panel MUST render BOTH threshold lines** (600s SLO green/amber, 3000s alert red) so neither is misread; annotate that the 3000s line mirrors a literal that an operator must hand-edit if `CONVLOG_INTERVAL_SECONDS` changes. Spec must state both explicitly.
- **DISCREPANCY-2 (error phases).** README:170 lists `mongo_query, cache_fetch, postgres_upsert, dead_letter, reconciliation`; the code actually emits `normalisation, telemetry, postgres_upsert, reconciliation, pg_client_error, pg_reconcile_client_error, mongo_client_error, config_guardrail_missing` (`index.ts` inc() sites). Phase labels are dynamic — the "errors by phase" panel should `sum by (phase)` and not hardcode a phase list. Low impact (panel is label-driven), but noted so the spec doesn't enumerate a stale phase set.
- **DISCREPANCY-3 (network — BLOCKER, fix shape & target network PINNED).** Brief claims Grafana is on `librechat_default`. The compose file (`:134-136`) shows Grafana on `monitoring` + `caddy_net` only. **Grafana cannot reach `vectordb:5432` as-is.** `vectordb` lives on `librechat_default` (the same network `postgres-exporter` uses to reach `vectordb:5432`, `:203,216-218`). **Required fix (the ONLY compose edit this feature needs):** add the single line `- librechat_default` to the `grafana` service `networks:` list (`:134-136`). No new top-level network declaration required — `librechat_default` is already declared `external` at `:259-261`. Purely additive, monitoring-stack-only. Without it, Dashboard B's datasource fails "Save & test." See the full treatment in Security Considerations → Network reachability.
- **DISCREPANCY-4 (bind-mount — NO ACTION).** Brief says "apply the directory-mount fix to Grafana if not already." Grafana **already** uses a directory mount (`./grafana/provisioning:/etc/grafana/provisioning:ro`, `:112`). No change needed.
- **OQ-1 (recent-conversations `title`) — RESOLVED with MANDATORY SPEC OPEN-DECISION.** The brief explicitly lists `title` as a default "recent conversations" column (`SDD/GRAFANA_FOR_CONV_LOG.md:30`) yet its own security constraint classifies `conversations_dim.title` as PII. These genuinely conflict. **Research-phase resolution (default position):** the DEFAULT "recent conversations" panel selects `conversation_id`, `endpoint`, `agent_id`, plus derived `started_at`/`last_activity`/`message_count` (see OQ-2) — **NO `title`.** The PII boundary wins over the brief's literal column list because the brief's own security constraint ("Default-visible panels should be limited to counts, IDs, dimensions, and metadata") is the stronger rule, and the on-file DPO acceptance (`SPEC-016`) covers retention only — NOT UI exposure of conversation titles. `title` moves into the single gated drill-down row (OQ-3) as the safe default. **SPEC OPEN-DECISION (must not be silently deferred — the spec must record an owner decision before implementation):** the brief's explicit `title` request and the PII constraint genuinely conflict. Either outcome (title shown in default panel / title drill-down-only) requires an explicit sign-off from the product owner or DPO — not a passive assumption. The spec must sequence this as an active ask: *"Should `conversations_dim.title` appear in the default Grafana-admin-visible panel? The on-file DPO acceptance covers retention, not this surface. Default assumption = drill-down-only until explicitly widened."* This is not a blocker to writing the spec (the safe default is well-defined), but the spec must record the decision as open and assign an owner to resolve it before the dashboard is declared final. If the DPO widens the classification to permit title display to Grafana admins, the `title` column can be promoted from the collapsed drill-down row to the default "recent conversations" panel with no other change.
- **OQ-2 (derived conversation columns) — RESOLVED.** Confirmed against `conv-log/migrations/001_init.sql` (already documented in this research): `conversations_dim` has NO `started_at`, `last_activity`, or `message_count` column — only `source_created_at` / `source_updated_at`. **Resolution:** the "recent conversations" panel DERIVES these via a `LEFT JOIN`/subquery aggregating `messages_log`: `started_at = MIN(ml.source_created_at)`, `last_activity = MAX(ml.source_created_at)`, `message_count = COUNT(ml.message_id)` grouped by `conversation_id`, ordered by `last_activity DESC`. Do NOT approximate with `conversations_dim.source_created_at`/`source_updated_at` — those track the *dimension row*'s upsert time (sidecar write time), not true conversation activity, so they would mislead. The aggregation is read-only and `convlog_reader` has SELECT on both tables. Spec carries the exact PromQL-free SQL shape.
- **OQ-3 (single vs separate drill-down dashboard) — RESOLVED.** **Resolution:** use a SINGLE collapsed row at the bottom of Dashboard B titled "Drill-down (raw content — authorized use only)", `type: "row"`, `collapsed: true` (schemaVersion 38 supports collapsed rows; panels nested under a collapsed row are not rendered/queried until expanded — so no PII leaves Postgres on default load). One fewer file, no separate provisioning entry, and the privacy default is preserved. Rejected the separately-tagged dashboard variant: it adds a third JSON file and a tag-discovery step without strengthening the access boundary (OSS Grafana has no per-dashboard RBAC either — both rely on the single Grafana-admin gate). Tagging convention for both A and B: `["memodo", "convlog", ...]` per existing `mongodb.json`/`service-overview.json`. **DEFER to governance ONLY IF** audit policy later requires raw-content access to be physically separated for access-log clarity — then promote the drill-down row to its own tagged dashboard; not required for v1.

---

## Frontmatter (per brief)
`delivery_mode: whole-feature`, `review_panel: false` (config + visualization, no architectural questions), `eval_required: false`. No ADR triggered (no cross-cutting technology choice — Grafana/Prometheus/Postgres are all pre-existing; the credential-strategy choice is feature-local, not system-binding).
