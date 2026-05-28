# conv-log Operator Runbook

## Purpose

`conv-log` is a read-only sidecar that periodically copies LibreChat conversation data from MongoDB into a dedicated Postgres analytical database. It runs as a Docker Compose service alongside the existing MemodoAI LibreChat stack, reads Mongo through a read-only credential, joins messages against the `conversations` and `agents` collections, and writes upserts to a `convlog` Postgres database. No LibreChat code, schema, container, or configuration is modified.

The analytical store enables offline SQL analysis of conversation traffic — model usage patterns, per-agent error rates, PII-trigger correlation, conversation length distributions — to inform future guardrail decisions. The design is specified in `SDD/requirements/SPEC-016-conversation-log-sidecar.md` (rev 2, Approved). DPO acceptance of raw text retention is documented at `SDD/governance/DPO-acceptance-conv-log.md`.

---

## Deploy Path Note

This sidecar adds no LibreChat workspace code; its PR diff is gated by REQ-072 to exclude `/api`, `/packages/*`, `/client`. Therefore the `prod-sync.sh` build-and-rsync flow documented in `CLAUDE.md` under "Production Deploy Discipline" is **not required** for `conv-log`. Production deploys follow the config-only path: commit on `pablo`, `git push`, on prod `git pull` + `./prod.sh up -d conv-log` (or `./prod.sh restart conv-log` for restarts). No `npm run build` step is required for prod deploys of this service.

---

## Provisioning (one-time, operator)

The two scripts under `conv-log/ops/` create the limited-privilege accounts the sidecar uses at runtime: the `convlog_reader` Mongo user (REQ-056) and the `convlog_writer` / `convlog_reader` Postgres roles (REQ-057). Each run appends an audit entry to `SDD/orchestration/conv-log-provisioning.log`.

### Security boundary — these five vars do not belong in `.env.prod`

Provisioning needs **superuser** credentials (`MONGO_ADMIN_URI`, `PG_ADMIN_URI`) and the **new passwords** to install on the limited-privilege accounts (`CONVLOG_MONGO_PASSWORD`, `CONVLOG_PG_WRITER_PASSWORD`, `CONVLOG_PG_READER_PASSWORD`). None of these belong in `.env.prod`:

- **Admin URIs:** `.env.prod` is mounted into the running conv-log container via docker-compose's `env_file` directive. Putting admin creds there would give a compromised sidecar the keys to drop the source database — the exact thing REQ-056/057's role separation exists to prevent.
- **New passwords:** they end up in `.env.prod` anyway, but **encoded inside the runtime URIs** (`mongodb://convlog_reader:<password>@…`, `postgres://convlog_writer:<password>@…`, `postgres://convlog_reader:<password>@…`). Keeping them as standalone vars *as well* would duplicate the same secret in two fields of the same file and create drift if either is rotated alone.

These five vars therefore live in the **operator's transient shell** for the duration of the provisioning ceremony only.

### Recommended ceremony — gitignored `.env.provisioning` file

The convention is to keep the five provisioning vars in a file named `.env.provisioning` at the **repo root** (alongside `.env.prod`). The repo's existing `.env*` gitignore pattern already excludes it, so it cannot be accidentally committed; the file is operator-side only and is never referenced by docker-compose, the sidecar, or any other script.

1. **Generate the three account passwords:**

   ```
   openssl rand -base64 24   # CONVLOG_MONGO_PASSWORD
   openssl rand -base64 24   # CONVLOG_PG_WRITER_PASSWORD
   openssl rand -base64 24   # CONVLOG_PG_READER_PASSWORD
   ```

2. **Create `./.env.provisioning`** at the repo root with the five vars (retrieve the admin URIs from your secret manager):

   ```
   MONGO_ADMIN_URI=mongodb://<admin>:<admin-pw>@<host>:27017/admin
   PG_ADMIN_URI=postgres://<superuser>:<superuser-pw>@<host>:5432/postgres
   CONVLOG_MONGO_PASSWORD=<password from step 1>
   CONVLOG_PG_WRITER_PASSWORD=<password from step 1>
   CONVLOG_PG_READER_PASSWORD=<password from step 1>
   ```

3. **Source it and run both provisioners** in the same shell:

   ```
   set -a; source ./.env.provisioning; set +a
   ./conv-log/ops/provision-mongo.sh
   ./conv-log/ops/provision-postgres.sh
   ```

   `set -a` exports every var read by `source` so the child scripts inherit them; `set +a` turns that off again. Both scripts validate their required vars and exit 1 with a clear error if any are missing.

4. **Encode the new passwords into the runtime URIs** in `.env.prod`. Open `.env.prod` (created by copying the `CONVLOG_*` block from `.env.example`) and populate:

   ```
   CONVLOG_MONGO_URI=mongodb://convlog_reader:<CONVLOG_MONGO_PASSWORD>@<host>:27017/LibreChat
   CONVLOG_PG_URI=postgres://convlog_writer:<CONVLOG_PG_WRITER_PASSWORD>@<host>:5432/convlog
   CONVLOG_PG_READ_URI=postgres://convlog_reader:<CONVLOG_PG_READER_PASSWORD>@<host>:5432/convlog
   ```

5. **Dispose of `.env.provisioning`** — either move it into your secret manager for future rotations and delete the on-disk copy (`rm ./.env.provisioning`), or use `shred -u ./.env.provisioning` if you don't keep it. The admin URIs should not persist on the prod host after this ceremony completes.

### Alternative — single-command inline env

For a one-off re-run (e.g., re-provisioning just Postgres after rotating the writer password), the same vars can be passed inline without a sourced file:

```
MONGO_ADMIN_URI=<admin-uri> CONVLOG_MONGO_PASSWORD=<password> \
  ./conv-log/ops/provision-mongo.sh

PG_ADMIN_URI=<admin-uri> \
  CONVLOG_PG_WRITER_PASSWORD=<writer-password> \
  CONVLOG_PG_READER_PASSWORD=<reader-password> \
  ./conv-log/ops/provision-postgres.sh
```

This leaves no `.env.provisioning` on disk, at the cost of putting the secrets in shell history. Mitigate by prefixing each command with a space if your `HISTCONTROL` includes `ignorespace`, or by running under `HISTFILE=/dev/null bash`.

### Idempotency

`provision-postgres.sh` is fully idempotent — duplicate database and role objects are swallowed via `EXCEPTION WHEN duplicate_database`/`duplicate_object`. `provision-mongo.sh` is **not** idempotent for the user object: Mongo's `createUser` errors on a duplicate and there is no built-in `if not exists`. To re-provision the Mongo user (e.g., after a password rotation), drop it first from `mongosh`:

```
mongosh "<MONGO_ADMIN_URI>" --eval \
  "db.getSiblingDB('LibreChat').dropUser('convlog_reader')"
```

then re-run `provision-mongo.sh`. (The audit log records every successful provisioning run, including re-provisions.)

---

## Configuration

All sidecar configuration lives in the `# === conv-log (analytical conversation store) ===` block in `.env.example`. Copy relevant variables to `.env.prod` and populate with resolved values.

Key operational knobs:

| Variable | Default | Purpose |
|---|---|---|
| `CONVLOG_INTERVAL_SECONDS` | `300` | Normal-cadence polling interval (seconds). |
| `CONVLOG_BATCH_SIZE` | `500` | Messages fetched per tick. |
| `CONVLOG_INITIAL_WATERMARK` | _(unset)_ | Unset = full epoch backfill. Set to `now` to skip historical messages on first run. See below. |
| `CONVLOG_RETENTION_MONTHS` | `24` | Retention ceiling enforced by erasure reconciliation. |
| `CONVLOG_ERASURE_RECONCILIATION_HOURS` | `24` | How often the erasure reconciliation pass runs. |

Do not re-enumerate all 18 variables here; `.env.example` is the single source of truth for the full list.

---

## First-Deployment Decision: Backfill vs Skip-Historical

When `sync_state.messages_high_watermark` is absent (first run), the sidecar resolves the initial watermark as follows:

- `CONVLOG_INITIAL_WATERMARK` **not set** (default): watermark starts at epoch (`1970-01-01T00:00:00Z`). The sidecar enters backfill mode and ingests the complete existing message corpus before settling into normal cadence. This is the default and is recommended.
- `CONVLOG_INITIAL_WATERMARK=now`: watermark starts at process-start time minus `CONVLOG_WATERMARK_SAFETY_SECONDS`. Only messages arriving after the sidecar started are ever ingested; all historical messages are skipped permanently.

This is a one-time decision. After the first tick persists a watermark to `sync_state`, the env var is ignored on all subsequent runs. To change it later, follow the truncate-and-rebuild procedure below.

---

## Backfill Mode

On each tick, the sidecar checks how many messages are pending (`db.messages.countDocuments({ createdAt: { $gt: watermark } })`). If the count exceeds `CONVLOG_BACKFILL_EXIT_THRESHOLD * CONVLOG_BATCH_SIZE` (default `5 * 500 = 2500`), the sidecar runs in **backfill mode**:

- Sleep between ticks is `CONVLOG_BACKFILL_INTERVAL_SECONDS` (default 5 s) instead of `CONVLOG_INTERVAL_SECONDS` (default 300 s).
- The mode is re-evaluated after every tick. It exits automatically when pending drops below the threshold.
- The P95 lag SLO (NFR-2: `convlog_sync_lag_seconds <= 2 * CONVLOG_INTERVAL_SECONDS`) is explicitly not in force during backfill mode.
- The transition in and out of backfill mode is logged at `info` level.

Monitor progress via `convlog_pending_messages` in Grafana or with:

```sql
SELECT value FROM sync_state WHERE key = 'messages_high_watermark';
```

---

## Monitoring

Prometheus scrape endpoint: `conv-log:9300/metrics` (added to `monitoring/prometheus/prometheus.yml`).

| Metric | Type | Description |
|---|---|---|
| `convlog_messages_synced_total` | Counter | Total `messages_log` rows successfully upserted since process start. |
| `convlog_sync_lag_seconds` | Gauge | Seconds since last successful tick completed. |
| `convlog_pending_messages` | Gauge | Mongo messages with `createdAt > watermark`, sampled each tick. |
| `convlog_max_message_age_seconds` | Gauge | Age of the most recently synced message (`now - MAX(source_created_at)`). Naturally large during idle periods; AND-gate alerts with `convlog_pending_messages > 0`. |
| `convlog_errors_total{phase}` | Counter | Error count by phase: `mongo_query`, `cache_fetch`, `postgres_upsert`, `dead_letter`, `reconciliation`. |
| `convlog_dead_letter_total{phase}` | Counter | Rows written to `dead_letter_log` by phase. |
| `convlog_last_run_unix_timestamp` | Gauge | Unix timestamp of most recent tick attempt. |
| `convlog_batch_duration_seconds` | Histogram | Duration of each batch tick. |
| `convlog_erasure_deletions_total` | Counter | Rows deleted by erasure reconciliation since process start. |

The `ConvLogSyncLagBreach` alert is defined in `monitoring/prometheus/alerts.yml` and routes through Alertmanager to the Teams channel per ADR 0003.

---

## Truncate-and-Rebuild Procedure

Required when a sidecar release increments `SCHEMA_VERSION` (constant in `src/index.ts`). This resets the analytical store to be re-derived from Mongo.

1. Stop the sidecar: `./prod.sh stop conv-log`.
2. Connect to the `convlog` database as `convlog_writer`.
3. Run:

```sql
TRUNCATE messages_log, conversations_dim, agents_dim, guardrail_events_log, dead_letter_log;
INSERT INTO sync_state (key, value, updated_at)
  VALUES ('messages_high_watermark', '"1970-01-01T00:00:00Z"'::jsonb, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
```

4. Restart: `./prod.sh up -d conv-log`.

The sidecar will enter backfill mode and re-derive the full store from Mongo.

---

## Rollback Procedure

To roll back to a previous sidecar release:

1. Revert the image tag or source commit in `docker-compose.prod.yml`.
2. `./prod.sh up -d conv-log`.

If the faulty release wrote bad data to the analytical store, follow the truncate-and-rebuild procedure above against the previous-known-good image.

---

## Sample Analytical SQL Queries

All queries use the `convlog_reader` credential (read-only). Connect with `CONVLOG_PG_READ_URI`.

**Top 10 users by message volume in the last 30 days:**

```sql
SELECT user_id, COUNT(*) AS message_count
FROM messages_log
WHERE source_created_at >= NOW() - INTERVAL '30 days'
GROUP BY user_id
ORDER BY message_count DESC
LIMIT 10;
```

**Agent error rates over time (daily, with human-readable agent names):**

```sql
SELECT
  DATE_TRUNC('day', ml.source_created_at) AS day,
  ad.name AS agent_name,
  COUNT(*) FILTER (WHERE ml.error = true) AS error_count,
  COUNT(*) AS total_messages,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ml.error = true) / NULLIF(COUNT(*), 0),
    2
  ) AS error_rate_pct
FROM messages_log ml
LEFT JOIN agents_dim ad ON ml.model_or_agent_id = ad.agent_id
WHERE ml.source_created_at >= NOW() - INTERVAL '30 days'
GROUP BY day, ad.name
ORDER BY day DESC, error_rate_pct DESC;
```

**PII-trigger correlation: messages with entity detections joined to their conversations:**

```sql
SELECT
  gel.conversation_id,
  cd.title AS conversation_title,
  gel.message_id,
  gel.route,
  gel.entity_count,
  gel.entity_types,
  gel.source_created_at AS triggered_at
FROM guardrail_events_log gel
LEFT JOIN conversations_dim cd ON gel.conversation_id = cd.conversation_id
WHERE gel.entity_count > 0
ORDER BY gel.source_created_at DESC
LIMIT 100;
```

**Model usage distribution (resolved via agents_dim for agent traffic):**

```sql
SELECT
  COALESCE(ad.model_underlying, ml.model_or_agent_id) AS resolved_model,
  COUNT(*) AS message_count
FROM messages_log ml
LEFT JOIN agents_dim ad ON ml.model_or_agent_id = ad.agent_id
GROUP BY resolved_model
ORDER BY message_count DESC;
```

**Conversation length histogram (messages per conversation, bucketed):**

```sql
SELECT
  CASE
    WHEN msg_count = 1 THEN '1'
    WHEN msg_count BETWEEN 2 AND 5 THEN '2-5'
    WHEN msg_count BETWEEN 6 AND 20 THEN '6-20'
    WHEN msg_count BETWEEN 21 AND 100 THEN '21-100'
    ELSE '100+'
  END AS length_bucket,
  COUNT(*) AS conversation_count
FROM (
  SELECT conversation_id, COUNT(*) AS msg_count
  FROM messages_log
  WHERE conversation_id IS NOT NULL
  GROUP BY conversation_id
) sub
GROUP BY length_bucket
ORDER BY MIN(sub.msg_count);
```

---

## Troubleshooting

**`/healthz` returns 503 (sidecar deployed but not healthy):**
The in-memory `lastSuccessfulSyncAt` has not been updated within `3 * CONVLOG_INTERVAL_SECONDS`. Check `convlog_sync_lag_seconds` in Grafana. Check container logs: `./prod.sh logs conv-log`. Common causes: Postgres or Mongo unreachable on first run, or consecutive tick failures triggering exponential backoff.

**Postgres connection refused:**
Verify `CONVLOG_PG_URI` in `.env.prod` contains the correct `convlog_writer` credentials. Check that the `convlog` database was provisioned: `psql <PG_ADMIN_URI> -c '\l'`. If missing, re-run `ops/provision-postgres.sh`.

**Dead-letter accumulation:**
Inspect with:

```sql
SELECT source_collection, source_id, error_phase, error_detail, retry_count, last_failed_at
FROM dead_letter_log
ORDER BY last_failed_at DESC
LIMIT 20;
```

The `error_detail` column contains a sanitized PG error message (no row payload). Common causes: schema constraint violations in the source data, oversized JSONB values. Rows here do not block the main loop — the watermark advances past them. Investigate the upstream LibreChat data for the `source_id` listed.

**Backfill appears stuck (pending count not decreasing):**
Check `convlog_pending_messages` in Grafana. If it is stuck near a constant value, the sidecar may be dead-lettering most rows. Check `convlog_dead_letter_total`. Also check if `convlog_errors_total{phase="postgres_upsert"}` is climbing. Review container logs for structured error entries with `phase` field.

**Guardrail events collection name (verified against source):**
The sidecar queries the `guardrailevents` collection via the `GUARDRAIL_COLLECTION` constant in `src/mongo.ts`. This was confirmed against the SPEC-009 schema (`packages/data-schemas/src/schema/guardrailEvent.ts`): the model registers as `mongoose.model('GuardrailEvent', ...)` with no explicit `collection:` option, so Mongoose's default pluralisation yields `guardrailevents`. The schema nests entity data under a `details` Mixed sub-document — the sidecar reads `details.entityTypes` and `details.entityCount` (not top-level fields) and derives `event_id` from the document `_id` (there is no separate `eventId` field). If a future LibreChat/SPEC-009 release renames the collection or moves these fields, the REQ-T-2 field-mapping drift gate will fail; update `GUARDRAIL_COLLECTION` / the `normaliseGuardrailEvent` mapping and `docs/field-mapping.md` together. Quick prod check: `mongosh <MONGO_ADMIN_URI> --eval 'use LibreChat; db.getCollectionNames()'`.

---

## DPO Erasure Runbook

The erasure reconciliation pass runs every `CONVLOG_ERASURE_RECONCILIATION_HOURS` (default 24 h). It pages `messages_log` in chunks and deletes rows whose `message_id` is no longer present in source Mongo.

**To verify a right-to-erasure request was propagated:**

1. Note the `conversation_id` of the deleted LibreChat conversation.
2. After one reconciliation cycle, run as `convlog_reader`:

```sql
SELECT COUNT(*) FROM messages_log WHERE conversation_id = '<deleted-conversation-id>';
```

The result should be `0`.

3. Verify in metrics: `convlog_erasure_deletions_total` should have incremented by the number of messages in that conversation.

**To force a manual reconciliation pass (operator emergency procedure):**

1. Stop the sidecar: `./prod.sh stop conv-log`.
2. Connect as `convlog_writer` to the `convlog` database.
3. Run the erasure queries manually (page through `messages_log`, cross-check against Mongo, delete absent rows and orphaned conversation rows). See `src/postgres.ts runErasureReconciliation` for the exact query pattern.
4. Restart: `./prod.sh up -d conv-log`.

---

## Credential Rotation

**Mongo (`convlog_reader` user):**

1. Generate a new password.
2. In `mongosh`: `use LibreChat; db.changeUserPassword('convlog_reader', '<new-password>')`.
3. Update `CONVLOG_MONGO_URI` in `.env.prod` with the new password.
4. `./prod.sh restart conv-log`.

**Postgres (`convlog_writer` role):**

1. Generate a new password.
2. In `psql` as superuser: `ALTER ROLE convlog_writer PASSWORD '<new-password>';`.
3. Update `CONVLOG_PG_URI` in `.env.prod` with the new password.
4. `./prod.sh restart conv-log`.

**`convlog_reader` Postgres role** (used by analysts, not the sidecar):

1. `ALTER ROLE convlog_reader PASSWORD '<new-password>';`.
2. Distribute the new `CONVLOG_PG_READ_URI` to affected analysts.
3. No sidecar restart needed — the sidecar does not use this credential.

**Rotation policy:** Annual minimum. Immediate rotation required on host-breach suspicion, personnel change, or credential exposure (per REQ-056).
