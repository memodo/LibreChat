/sdd-flow prompt — Grafana dashboards for conv-log analytical store + operational metrics

  Goal. Add two Grafana dashboards (and one new datasource) to the MemodoAI LibreChat monitoring stack so the SPEC-016 conv-log sidecar has both operational visibility and an analytical
  browsing surface. After this lands, anyone with Grafana admin access at https://grafana.memodo-eng.de can see conv-log health and explore the conversation analytical store without writing
  SQL.

  Scope IN

  1. Dashboard A — conv-log operational metrics (Prometheus-backed). Visualises the 11 conv-log Prometheus metrics scraped from conv-log:9300. Mirrors the pattern of
  monitoring/grafana/provisioning/dashboards/mongodb.json. Panels at minimum:
    - up{job="conv-log"} stat
    - convlog_sync_lag_seconds timeseries with a threshold line at 2 × CONVLOG_INTERVAL_SECONDS (default 600s) — the SLO from REQ NFR-2
    - convlog_pending_messages timeseries
    - rate(convlog_messages_synced_total[5m]) throughput timeseries
    - convlog_max_message_age_seconds timeseries
    - sum by (phase) (rate(convlog_errors_total[5m])) stacked-by-phase timeseries
    - sum by (phase) (rate(convlog_dead_letter_total[5m])) stacked-by-phase timeseries
    - p50/p95/p99 of convlog_batch_duration_seconds (histogram_quantile)
    - rate(convlog_erasure_deletions_total[5m]) timeseries
    - convlog_bisection_max_depth_observed stat or timeseries
    - time() - convlog_last_run_unix_timestamp "seconds since last tick" stat
    - convlog_erasure_chunk_deleted_ratio histogram quantiles
  2. Dashboard B — conv-log analytics (Postgres-backed via convlog_reader). Surfaces the analytical store content for browsing. Panels at minimum:
    - Stat row: total conversations, total messages, total agents, total guardrail events, dead-letter count
    - Messages-per-day timeseries from messages_log.source_created_at
    - Top 10 users by message volume (table) — adapted from README V-6 Q1
    - Model usage distribution (piechart or bargauge) — V-6 Q4
    - Agent error rates over time (timeseries grouped by agent_name) — V-6 Q2
    - Conversation length histogram (barchart) — V-6 Q5
    - Recent conversations table (conversation_id, title, started_at, last_activity, message_count) — titles only, no raw message text in this default panel
    - PII trigger events table — V-6 Q3 — entity_types and entity_count only, not redacted content
    - Dead-letter inspector table — dead_letter_log recent 50 rows with sanitized error_detail
    - Optional drill-down panel: conversation content viewer, gated behind a Grafana variable / row that's collapsed by default, so raw text isn't surfaced unless deliberately requested
  3. Postgres datasource provisioning under monitoring/grafana/provisioning/datasources/. Connects Grafana to vectordb:5432/convlog as the convlog_reader role (read-only). Password sourced
  from a Grafana env var, set in .env.prod, in a way that does not duplicate it from the existing CONVLOG_PG_READ_URI (either parse it out at compose-evaluation time or add a dedicated
  GRAFANA_CONVLOG_DB_PASSWORD var with documentation).
  4. Operator documentation added to conv-log/README.md (or a new section under monitoring docs): how to access the new dashboards, what each panel shows, how the access boundary works.

  Scope OUT (deferred)

  - Metabase — explicitly out; Grafana is the chosen surface for SPEC-017.
  - Postgres infrastructure dashboard (the postgres-exporter consumer) — useful but separate work.
  - Custom alert rules beyond the three ConvLog* rules already in monitoring/prometheus/alerts.yml. Dashboards may reference those thresholds as panel annotations but should not add new rules.
  - Drill-down to raw message text by default — see security constraint below.

  Constraints

  - REQ-072 hold-over: zero changes under /api, /packages/*, /client. This is a monitoring-stack change only.
  - No restart of LibreChat services during deploy. Grafana container recreate is acceptable; Prometheus does not need to restart.
  - Security boundary on conversation content: raw message text and conversation titles are real prod user data. Default-visible panels should be limited to counts, IDs, dimensions, and
  metadata. Any panel that exposes raw content must be either collapsed by default, gated behind an explicit variable, or in a separately-tagged "drill-down" dashboard. Grafana admin access is
   the only access gate (GF_USERS_ALLOW_SIGN_UP=false); design panel set assuming the viewer has been authorized to see all of it but make the default view privacy-respecting.
  - Provisioning must work via the directory bind mount established in commit 337c39ac8 (./prometheus:/etc/prometheus) — apply the same pattern to Grafana provisioning if not already
  (single-file vs directory mount).
  - Datasource credentials handling: do not hardcode the convlog_reader password into any committed JSON or YAML. Use Grafana's ${ENV_VAR} substitution. If a new env var is added to .env.prod,
   also add a commented template to .env.example per existing convention.
  - All dashboards must auto-provision on container start (no manual import). Test that docker compose down grafana && docker compose up -d grafana restores both dashboards from disk.

  Files / inputs the research phase should examine

  - monitoring/docker-compose.monitoring.yml (Grafana service, env, mounts)
  - monitoring/grafana/provisioning/datasources/prometheus.yml (reference pattern for the new Postgres datasource)
  - monitoring/grafana/provisioning/dashboards/dashboards.yml (provisioning rules)
  - monitoring/grafana/provisioning/dashboards/mongodb.json (closest existing pattern for dashboard A)
  - monitoring/grafana/provisioning/dashboards/service-overview.json (stat-row and alert-table patterns)
  - conv-log/src/index.ts lines 88–154 (buildMetrics — the authoritative list of all 11 Prometheus metrics with their types and labels)
  - conv-log/migrations/001_init.sql (full Postgres schema for analytical store: messages_log, conversations_dim, agents_dim, guardrail_events_log, dead_letter_log, sync_state)
  - conv-log/README.md (the five V-6 sample queries — they become the basis for several dashboard B panels)
  - monitoring/prometheus/alerts.yml lines around ConvLogSyncLagBreach, ConvLogDeadLetterStructuralFailure, ConvLogErasureRunaway (threshold values to reference in panels)
  - SDD/requirements/SPEC-016-conversation-log-sidecar.md (the conv-log spec; informs which metrics matter and why)
  - .env.example CONVLOG_* block (precedent for env-var naming and documentation conventions)

  Success criteria

  - Both dashboards appear in Grafana automatically after docker compose up -d grafana (no manual import).
  - All dashboard A panels render with real prod data on first load (no broken queries).
  - Dashboard B's stat-row panel matches the SQL counts run via docker exec -i vectordb psql -U librechat_rag -d convlog -tAc "SELECT count(*) FROM messages_log" etc.
  - The new Postgres datasource passes Save & test in the Grafana UI.
  - .env.prod template / .env.example includes the new datasource credential var with explanatory comment.
  - conv-log/README.md (or equivalent doc) explains where the dashboards live, what they show, and how access is controlled.
  - The five V-6 sample queries from conv-log/README.md are all represented as panels in dashboard B (or the documentation explains why any are excluded).
  - No raw conversation text is visible in the default dashboard view; any panel that surfaces it is explicitly gated.

  Suggested SDD numbering

  - Research: SDD/research/RESEARCH-017-grafana-conv-log-dashboards.md
  - Spec: SDD/requirements/SPEC-017-grafana-conv-log-dashboards.md
  - Frontmatter: delivery_mode: whole-feature, review_panel: false (no architectural questions; this is config + visualisation work), eval_required: false

  Pre-existing context worth knowing at session start

  - SPEC-016 (conv-log sidecar) is deployed and validated in production. Commits e4136a232, dd2498a20, adb60d79b, 0c64184b3, 3115f9911, 337c39ac8 on pablo (and merged onto memodo via ad34f84b9
   plus any subsequent re-merge). Don't research conv-log itself unless necessary.
  - The directory bind-mount fix for Prometheus config (commit 337c39ac8) is the precedent for any single-file mounts in the Grafana provisioning. Same fix should be applied to Grafana
  provisioning if it has the same shape.
  - The convlog_reader Postgres role exists in prod with SELECT on all tables in convlog (created by conv-log/ops/provision-postgres.sh and verified by V-6).
  - Network: Grafana is on the librechat_default Docker network per its networks: block, so vectordb:5432 is reachable from inside the Grafana container.
  - Test data: 268+ messages, 89 conversations, 6 agents, 0 guardrail events as of validation. The guardrail events panel will be empty until someone triggers a PII rule in prod — that's
  expected, not a bug.