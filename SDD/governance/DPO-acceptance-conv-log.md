# DPO Acceptance — SPEC-016 Conversation Log Sidecar — Raw-Text Retention — 2026-05

Backs **SPEC-016 §OD-1 closure and § DPO Acceptance** (Executive Summary).
Satisfies the merge-gate referenced in the SPEC: *"A signed DPO note
acknowledging these controls must be filed in `SDD/governance/` before the
implementation PR merges."*

## Acceptance metadata

| Field | Value |
|---|---|
| Acceptance date | 2026-05-26 |
| Acceptance author | Pablo Oliva, MemodoAI operator (DPO-equivalent function) |
| Spec version | SPEC-016 rev 2 (Conversation Log Sidecar, post-panel synthesis) |
| Scope of acceptance | Initial production rollout of `conv-log` sidecar against the existing Hetzner-hosted MemodoAI LibreChat deployment |
| Compensating controls | All five enumerated below; each is a binding requirement in SPEC-016 |

## What is being accepted

The analytical store `convlog` (Postgres database hosted on the existing
pgvector instance) retains **raw `messages.text` and `messages.content[]`**
content copied from the MongoDB source. This is broader than the strict
data-minimisation default that would store only structural metadata
(`token_count`, `endpoint`, `model_or_agent_id`, timestamps, flags) and
NULL the body fields.

### Trade-off acknowledged

- **GDPR Art. 5(1)(c) data minimisation** would, in its strictest reading,
  prefer the metadata-only default. The acceptance recognises this and
  trades it against:
- **Legitimate-interest analytics for guardrail design.** The explicit
  purpose stated in SPEC-016 (and RESEARCH-016) is *"log conversation
  traffic now, while volume is low, so that when usage grows there is a
  corpus to mine for guardrail decisions."* Structural metadata alone is
  insufficient for that purpose — content patterns, prompt-injection
  surfaces, agent-output behaviours, and PII-trip false-positive patterns
  all require access to the underlying text.
- **No new data-residency surface is opened.** The destination Postgres
  resides on the same Hetzner host (EU) that already hosts the source
  MongoDB. No cloud egress is introduced. The data class
  (raw conversation text) is the same class already persisted indefinitely
  for registered users in MongoDB per LibreChat's default behaviour.

## Compensating controls (each binding in SPEC-016)

### 1. Postgres role separation

- **Reference:** SPEC-016 REQ-057.
- **Description:** Two roles provisioned. `convlog_writer` (used by the
  sidecar process only) has INSERT/UPDATE/DELETE/SELECT. `convlog_reader`
  (used by all analyst access, ad-hoc queries, and any future downstream
  consumer including Metabase, Grafana, or a SPEC-008 admin-UI extension)
  has SELECT only. Compromise of one credential does not grant the other's
  privilege.
- **Status:** ACCEPTED, gated by implementation.

### 2. Right-to-erasure reconciliation

- **Reference:** SPEC-016 REQ-073, V-7.
- **Description:** A background task runs every 24 hours and deletes from
  `messages_log` / `guardrail_events_log` any rows whose source
  `messageId` is no longer present in MongoDB. This is the GDPR Art. 17
  propagation path. It also handles LibreChat's existing TTL-based
  hard-deletion of temporary chats (via `messages.expiredAt`). Verified
  by V-7.
- **Status:** ACCEPTED, gated by implementation and V-7.

### 3. Retention ceiling

- **Reference:** SPEC-016 REQ-073, REQ-070 (`CONVLOG_RETENTION_MONTHS`).
- **Description:** The same reconciliation task deletes rows with
  `source_created_at < now() - 24 months` by default. The ceiling is
  configurable but the default and the documented expectation is 24
  months. Older content does not accumulate beyond the window.
- **Status:** ACCEPTED, gated by implementation.

### 4. No host port / no cloud egress

- **Reference:** SPEC-016 REQ-054, REQ-066.
- **Description:** The `conv-log` service is attached to the Compose
  `default` network only. No host port is published. The `/healthz` and
  `/metrics` HTTP endpoints (port 9300) are reachable only by other
  services on the same Compose network (Prometheus scrapes them via the
  service alias). No outbound traffic leaves the Hetzner host as a
  consequence of the sidecar's operation.
- **Status:** ACCEPTED, gated by implementation.

### 5. Compound-key uniqueness preventing cross-user collision

- **Reference:** SPEC-016 REQ-058, REQ-062.
- **Description:** `messages_log` declares `UNIQUE (message_id, user_id)`
  mirroring the source MongoDB compound unique index. This prevents the
  silent-data-loss mode that would occur if `message_id` alone were the
  upsert key and two users coincidentally produced the same `messageId`.
- **Status:** ACCEPTED, gated by implementation.

## Residual risk

The acceptance does NOT cover:

- Future expansion of analyst access beyond the named MemodoAI internal
  operator + close collaborators. Wider analyst access requires either
  (a) an audit-logged provisioning of a per-analyst `convlog_reader`
  credential, or (b) a fresh DPO acceptance event extending this scope.
- Backup of the destination Postgres database. The pgvector instance's
  existing backup posture applies; if that posture is later judged
  insufficient for `convlog`-class content, OD-5 (MinIO NDJSON mirror)
  may need to be revisited.
- Export of `convlog` data to any external system (BI vendor, SaaS
  analytics, third-party model training). Any such export requires a
  separate DPO acceptance event.
- Use of `convlog` data to train, fine-tune, or evaluate any model.
  Explicitly out of scope; requires a separate acceptance.

## Acceptance sign-off

By signing below, the named DPO-equivalent affirms that the trade-off in
§*What is being accepted* has been considered, the five compensating
controls in §*Compensating controls* are required and will be verified
during implementation review, and the residual risks in §*Residual risk*
are acknowledged as out of scope of this acceptance.

- **Signed:** Pablo Oliva, MemodoAI operator (DPO-equivalent function)
- **Date:** 2026-05-26
- **Next review:** 2026-11-26 (6 months) OR upon any of the residual-risk
  events listed above OR upon a SPEC-016 revision that materially changes
  the data retained, whichever comes first.

## Scope-limitation note

This acceptance authorises the initial production rollout of `conv-log`
against the existing MemodoAI deployment. Any of the following events
voids this acceptance and requires a fresh DPO acceptance record:

- Deploying `conv-log` against a different MongoDB instance (e.g., a
  multi-tenant or shared-customer deployment).
- Granting `convlog_reader` access to a party outside the named MemodoAI
  internal operator + close collaborators.
- Modifying SPEC-016 REQ-073, REQ-057, REQ-054, REQ-058, or REQ-062 in a
  way that weakens any of the five compensating controls.
- Exporting `convlog` content to any system, vendor, or process not
  covered by this acceptance.
