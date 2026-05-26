# RESEARCH-016: Conversation Log Sidecar (additive analytical store)

**Date:** 2026-05-26
**Status:** COMPLETE — input to SPEC-016
**Author:** Pablo Oliva (with Claude)
**Trigger:** Need to start capturing conversation traffic into a queryable analytical store so that, once volume builds, we can analyse what guardrails to add. Existing data lives in MongoDB but is shaped for application access (per-user, per-conversation), not for fleet-level analysis.

---

## 1. Research question

> Where can we route MemodoAI conversation content into a form suitable for *future* offline analysis (to inform what guardrails to build) **without modifying LibreChat core code or infrastructure**, so that upstream LibreChat upgrades remain conflict-free?

The "no core edits" constraint was raised mid-investigation and reshaped the candidate set. Two earlier candidates — schema enrichment of the `messages` collection, and Foundry / OpenTelemetry SDK instrumentation — were excluded for that reason.

---

## 2. Prior art in this repo

| Doc | Relationship | Carry-over |
|---|---|---|
| RESEARCH-007 (Usage and Chat Logging) | Confirms LibreChat persists every message to Mongo and has Winston file logs, but no analytics surface, no admin chat access, no auto-cleanup. No SPEC followed. | Establishes the data foundation. SPEC-016 builds the analytics surface RESEARCH-007 said was missing. |
| PRE-RESEARCH-013 (Observability Extension) | Broader brief: logs + traces + errors + LLM-call tracing + RUM. Assumes OpenTelemetry SDK instrumentation in `/packages/api` — i.e., **core edits**. | Conflicts with the "no core edits" constraint. SPEC-016 deliberately does *not* absorb 013; 013 remains valid for the future operational-observability platform. SPEC-016 is the **analytical-store** layer; 013 will be the **operational-observability** layer. |
| SPEC-008 (Admin Reporting Dashboard) | Surfaces usage / cost / activity metrics derived from `transactions` and aggregates in Mongo. Does NOT surface message content. | SPEC-016 is the upstream feeder; SPEC-008 + content view could become a downstream consumer later. |
| SPEC-009 (PII Detection Integration) | Writes `GuardrailEvent` records to Mongo for PII triggers (metadata only, content sanitised). | SPEC-016 should join against `GuardrailEvent` so analytical queries can correlate guardrail trips with the underlying messages. |

---

## 3. Production data audit (verified 2026-05-26)

Inspected prod Mongo (`chat-mongodb` on Hetzner-personal). 227 messages across 80 conversations.

### 3.1 Field population in the live `messages` collection

| Field | Population | Notes |
|---|---|---|
| `messageId`, `conversationId`, `user`, `parentMessageId`, `createdAt`, `updatedAt`, `endpoint`, `sender`, `text`, `tokenCount`, `isCreatedByUser`, `error`, `unfinished` | 100% | Always present. Strong analytical foundation. |
| `model` | 50% | Only on assistant messages. For agent traffic, holds an `agent_*` ID (e.g. `agent_FIYXorS1LGgtJkVVftqis`) — NOT the underlying LLM. Joining against the `agents` collection is required to resolve the actual model. |
| `content[]` | 49% | Assistant messages only. Structured parts (`type`, `text`); future tool-call parts will appear here. Sidecar should prefer `content[]` over `text` for assistant messages where present. |
| `attachments`, `files` | 19% / 4% | Non-empty when files involved. |
| `contextMeta` | 5% | `calibrationRatio`, `encoding` — context-window calibration data. |
| `feedback` | <1% (1 of 227) | Thumbs up/down with optional tag/text. Currently under-used. |
| `finish_reason`, `summary`, `summaryTokenCount`, `thread_id`, `metadata`, `iconURL`, `tenantId` | **0%** | Schema fields that LibreChat is not writing for this deployment. `finish_reason` in particular would have been the most analytically useful (stop/length/content_filter/tool_calls); its absence is **unrecoverable from a sidecar** — fixing it would require an upstream LibreChat patch and is out of scope here. |

### 3.2 Endpoint and model distribution

- **Distinct endpoints:** `agents`, `azureOpenAI`. Clean binary partition for filtering.
- **Distinct senders:** 11 values, 10 of which are agents (`Concierge`, `Memodo Engineering Concierge`, `Meeting Notes Polisher`, `Image Gen`, `WhoAmI - Test m365`, etc.) — **agent traffic dominates**. The single non-agent sender for assistant traffic is `GPT-5`.
- **Models:** `gpt-5` plus nine distinct `agent_*` IDs.

### 3.3 Implication for design

The analytical join required is:

```
messages
  LEFT JOIN conversations ON messages.conversationId = conversations.conversationId
  LEFT JOIN agents         ON messages.model = agents.id  -- when endpoint = 'agents'
  LEFT JOIN guardrail_events ON guardrail_events.messageId = messages.messageId
```

producing a denormalised row per message with: conversation title + tags + agent name, resolved underlying LLM (for agent traffic), and any guardrail events the message tripped.

---

## 4. Candidate paths considered

Two-by-two evaluation: **data source** × **destination shape**.

### 4.1 Data-source side

| Source | Captures | Additive? | Verdict |
|---|---|---|---|
| **Schema enrichment** of `messages` to add `finish_reason`, model resolution, moderation verdicts | Richer in-line metadata | **No** — modifies `packages/data-schemas/src/schema/message.ts` | **Rejected** by the constraint. |
| **OpenTelemetry SDK instrumentation** in `/packages/api` | Full LLM-call traces (prompts, completions, tool spans, latencies) | **No** — new instrumentation code in core | **Rejected** by the constraint. Deferred to future 013 work. |
| **Mongo Change Streams** subscriber | Real-time message inserts | Yes (sidecar reads change feed) | Viable but requires Mongo running as a replica set. Current `chat-mongodb` config needs to be verified — single-node RS counts. Decision deferred. |
| **Mongo polling sidecar** with watermark | Same data, near-real-time (≤ N minutes lag) | Yes | **Selected.** Simplest, no Mongo topology dependency, low operational risk. Can be upgraded to Change Streams later without changing the destination. |
| **Azure APIM GenAI Gateway → App Insights** (reverse-proxy in front of Azure OpenAI) | LLM-call wire bodies + token counts; unlocks Content Safety, token limits, semantic caching as opt-ins | Yes (LibreChat only changes its `OPENAI_API_BASE`) | **Rejected for SPEC-016**, but kept on file. Reasons: (a) puts conversation content into Azure App Insights — a new data-egress path the EU/Hetzner posture does not currently have for content; (b) APIM tier cost ($50–$200/mo); (c) does not see the agent intermediate messages or conversation graph (only LLM wire calls). May revisit when Content Safety / token limits become an actual requirement, at which point the logging falls out as a side benefit. |
| **Azure OpenAI Diagnostic Settings** (`RequestResponse`, `Audit`, `AllMetrics`) | Metadata, latencies, token counts | Yes | Useful but does **not capture prompt/completion content**. Complementary to other options, not a substitute. Out of scope for SPEC-016 (already a planned ops signal under 013). |
| **Azure OpenAI Abuse Monitoring** (Microsoft-side 30-day prompt/completion store) | Full content | N/A | **Not customer-accessible.** Only Microsoft's reviewers see it, via SAW+JIT after content is flagged. Excluded. |

### 4.2 Destination side

| Destination | Pros | Cons |
|---|---|---|
| **Postgres** (reusing existing pgvector instance, separate DB + user) | SQL, joins, Metabase/Grafana later, already operated | Adds load to pgvector host (low — analytical reads, low write rate) |
| Separate new Postgres container | Clean isolation | Extra service to operate; no operational benefit at current volumes |
| NDJSON to MinIO | Cheapest, append-only, archival-friendly | Awkward interactive queries; no joins; needs a query layer eventually |
| Existing Mongo (new DB) | No new tech | Same query ergonomics problem as today; doesn't move the needle |
| ClickHouse / BigQuery | Best analytical engine | New tech to operate or new SaaS data path; premature |

**Decision: Postgres on existing pgvector instance, separate database `convlog`, separate user `convlog_writer`.** SQL is the right tool; reusing the existing instance avoids a new container while keeping logical isolation.

---

## 5. Open decisions surfaced to SPEC-016

These are the points where the user must make a choice the research could not pre-decide.

- **OD-1. Storage of raw message text.** Store raw `text` and `content[]`, or redact/hash before write? Recommend **store raw**, on the basis that the data is staying on the same Hetzner host that already holds it in Mongo — no new data-residency surface is opened. PII trigger info (from SPEC-009 `GuardrailEvent`) is joined in for downstream filtering.
- **OD-2. Backfill of pre-existing messages.** On first run, ingest the full historical 227 messages, or only forward from sidecar start? Recommend **full backfill** — historical data is the bulk of what currently exists, and it's bounded.
- **OD-3. Polling interval.** Default cadence for the watermark sweep. Recommend **5 minutes**, configurable.
- **OD-4. Retention policy.** Keep all rows forever, or apply TTL? Recommend **no TTL initially** — volumes are small; revisit once the DB exceeds a defined size threshold (e.g. 10 GB).
- **OD-5. MinIO NDJSON mirror.** Optional second sink writing daily NDJSON dumps to MinIO for archival. Recommend **defer** — add only if a backup-redundancy requirement emerges.
- **OD-6. Naming.** Service name `conv-log` (kebab-case, matches `chat-mongodb`, `librechat-exporter`). Repo directory `/conv-log/` (matches `/monitoring/`).

---

## 6. Constraints carried into the SPEC

1. **No edits to LibreChat core code or schemas.** Anything that would change `/api`, `/packages/api`, `/packages/data-schemas`, `/client`, or the LibreChat container image is out of scope.
2. **Same Compose stack.** Sidecar runs under `./prod.sh` like every other service.
3. **EU data residency.** All data stays on the Hetzner host. No cloud egress.
4. **Read-only Mongo access.** New dedicated Mongo user with `read` role on `LibreChat` database — never write or admin.
5. **No host port exposure.** Sidecar is purely internal to the Compose network.
6. **Restart-safe.** Watermark must be durable (in destination Postgres) so restarts resume cleanly.

---

## 7. Out of scope (explicitly)

- Output-side content moderation (requires core edits or APIM).
- Real-time alerting on conversation content (analytical store, not stream processor).
- An admin UI for browsing conversations (SPEC-008 may grow into this; not this SPEC).
- Multi-tenant partitioning (`tenantId` is unused in current corpus).
- Capturing `finish_reason` and other Mongo-empty fields (unrecoverable without core edits).
- Streaming/real-time replication (Change Streams). Polling first; Change Streams is a future option.

---

## 8. Files that matter

- `packages/data-schemas/src/schema/message.ts` — message schema (reference only; not modified)
- `packages/data-schemas/src/schema/convo.ts` — conversation schema (reference only)
- `docker-compose.override.yml`, `docker-compose.prod.yml` — where the new service slots in
- `.env.prod`, `.env.example` — new credentials block
- `prod.sh` — lifecycle wrapper (unchanged; picks up new service automatically)
- `monitoring/` — existing Prom/Grafana stack the sidecar can expose health metrics to (optional)
- Existing pgvector Postgres service — destination host
