# Microsoft 365 MCP Integration

**Status:** Phase 1 complete (read-only). Implemented via SPEC-014.
**Branch:** `feature/014` (merged into `pablo`).
**Spec / research:** `SDD/requirements/SPEC-014-m365-mcp-integration.md`, `SDD/research/RESEARCH-005-m365-mcp-integration.md`.

LibreChat agents can now read the signed-in user's Microsoft 365 data — mail, calendar, files, contacts, tasks, notes, and Graph search — without leaving the chat. The integration is delivered as a stateless Docker sidecar (`mcp-m365`) backed by the open-source [`@softeria/ms-365-mcp-server`](https://www.npmjs.com/package/@softeria/ms-365-mcp-server) package and wired into LibreChat as a Model Context Protocol (MCP) server group named `Microsoft365`.

---

## What this gives users

Once an agent is granted the `Microsoft365` tool group in the agent builder, the agent can act on the user's behalf across the following M365 surfaces. Every call runs as the *signed-in user* — agents inherit the user's existing M365 permissions and cannot reach data the user couldn't already see.

| Surface | What the agent can do (phase 1, read-only) |
|---|---|
| **Outlook mail** | List inbox / folders, read messages, search by sender / subject / date / keyword, preview bodies |
| **Calendar** | List upcoming events, read event details, surface organizers / attendees / locations, query calendar views by date range |
| **OneDrive / SharePoint files** | Browse the user's OneDrive, read file metadata (name, size, modified date, web URL), download file contents for the model to reason over |
| **Excel** | Read worksheet contents, ranges, named tables, and chart definitions |
| **OneNote** | List notebooks, sections, and pages; read page contents |
| **To Do** | List task lists and tasks with status and due dates |
| **Planner** | List plans, buckets, and tasks |
| **Contacts** | List and read personal / Outlook contacts (name, email, phone) |
| **Microsoft Graph search** | Cross-service keyword search over mail, files, sites, and chats the user has access to |
| **User profile** | Basic profile (display name, UPN, job title) via `User.Read` |

### Example prompts that now work

- "Summarize the unread mail from my manager this week."
- "What meetings do I have on Thursday, and who's attending the 2pm one?"
- "Find the latest version of the Q2 roadmap deck in OneDrive and pull out the OKR slide."
- "Read my Planner board for the migration project and tell me what's overdue."
- "Search SharePoint for the latest signed MSA for ACME GmbH."
- "List my Outlook contacts at memodo.de that I've emailed in the past month."

### What's intentionally *not* available in phase 1

Phase 1 ships **read-only** by design — agents cannot send mail, create calendar invites, modify files, post to Teams, or change SharePoint content. Attempted writes return a clean tool error (`HTTP 403 / WriteForbidden`) rather than silently failing.

Also deferred (Softeria's `--org-mode` is off):

- Teams chats, channel posts, team creation
- SharePoint admin (sites / lists CRUD)
- Shared mailboxes, presence, attendance reports, meeting transcripts / recordings
- User management / directory admin

Phase 2 will revisit write scopes and `--org-mode` after a stability soak.

---

## How it works (one paragraph)

When a user signs into LibreChat with Microsoft Entra ID (OpenID Connect), LibreChat performs an **On-Behalf-Of (OBO) token exchange** with Entra and caches the resulting Microsoft Graph access token per `(user, scope-set)`. The first time an agent calls a `Microsoft365_*` tool, LibreChat injects that Graph token into the outbound MCP request as `Authorization: Bearer <token>`. The `mcp-m365` sidecar proxies the call to `graph.microsoft.com` using the user's token. The sidecar **stores no credentials, no refresh tokens, and no per-user state** — every request carries its own token (a "Bring-Your-Own-Token" / BYOT pattern). When the cached token nears expiry, LibreChat refreshes it transparently via single-flight OBO; the user sees no interruption.

### Trust boundary

- LibreChat API → mcp-m365: internal Docker network only (`mcp-m365:3000`); no host port published; allowlisted via `mcpSettings.allowedDomains: ['mcp-m365']`.
- mcp-m365 → Microsoft Graph: outbound TLS to `graph.microsoft.com:443` only.
- No env-resident secrets in the sidecar. No tokens on disk. No tokens in sidecar logs (`SEC-007`).
- Graph traffic stays inside the Memodo Entra tenant region under the Microsoft **EU Data Boundary**.

### Per-user audit trail

Every tool call carries a deterministic correlation ID (`conversationId:messageId:toolCallId`) that LibreChat propagates to the sidecar and onward to Graph as the `client-request-id` header. Incident triage joins three log surfaces by that single ID:

1. LibreChat audit metadata (timestamp, user, tool name, scope, HTTP status — *no* request / response bodies).
2. `mcp-m365` container logs (request shape only — payloads stripped).
3. Microsoft Graph activity log (payload-aware, retained by Microsoft).

---

## Configuration overview

### librechat.yaml

```yaml
mcpSettings:
  allowedDomains:
    - 'mcp-m365'

mcpServers:
  Microsoft365:
    type: streamable-http
    url: http://mcp-m365:3000/mcp
    timeout: 45000          # outer MCP request budget
    initTimeout: 150000     # cold-start tool registration
    startup: false          # lazy-connect on first user-scoped call
    headers:
      Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"
    serverInstructions: >
      Use these tools to interact with the signed-in user's Microsoft 365 data:
      Outlook mail, Calendar, OneDrive (files), Excel, OneNote, To Do, Planner,
      Contacts, and Graph search. Operate strictly on behalf of the current user.
      All scopes are read-only in phase 1; do not attempt writes ...
```

The `serverInstructions` block is co-versioned with the Graph scope set (`REQ-028`); a CI step hashes the body and fails on drift.

### .env.prod (operator-managed)

```bash
OPENID_GRAPH_SCOPES=User.Read,Mail.Read,Calendars.Read,Files.Read.All,Sites.Read.All,Contacts.Read,Tasks.Read,Notes.Read.All,offline_access
MEMODO_TENANT_ID=<entra-tenant-id>
GRAPH_EXPECTED_AUDIENCE=https://graph.microsoft.com
```

### Entra app registration (one-time admin action)

Admin consent is required for the nine phase-1 **delegated** scopes:

`User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`.

No application (app-only) permissions are granted — every call is delegated and user-scoped.

### Sidecar image

| File | Purpose |
|---|---|
| `mcp-m365/Dockerfile` | Node 22-alpine pinned by multi-arch digest; Softeria pinned to a concrete semver with tarball SHA-256 verified at build time |
| `mcp-m365/VERSION` | Resolved Softeria version + MCP protocol version |
| `mcp-m365/serverinstructions.sha256` | Drift baseline for the `serverInstructions` body |
| `mcp-m365/tool-projection.md` | Per-tool Graph `$select` projection record (data minimization) |
| `mcp-m365/test-fixtures.md` | PII canary fixtures for verification |
| `mcp-m365/README.md` | Operator runbook (build, verify, version-bump, phase-2 plan) |

Build / deploy is the standard `./prod.sh` lifecycle:

```bash
./prod.sh build mcp-m365
./prod.sh up -d mcp-m365
./prod.sh restart api          # only required after librechat.yaml changes
./prod.sh logs -f mcp-m365
```

The image is built per-host from `./mcp-m365/`; no external registry pull.

---

## Reliability and rate-limit guardrails

The integration ships several invariants that protect the user experience and the upstream Graph API:

- **Cascading timeout invariant** (`REQ-025`): `queue_wait (14s) + graph_inner_timeout (30s) + mcp_hop (~0.5s) < outer_mcp_timeout (45s)`. The inner Graph call fails cleanly before the outer MCP timeout, preventing socket leaks and retry amplification. Pinned by unit test.
- **Per-user bounded concurrency** (`REQ-024`): max 4 in-flight `Microsoft365` calls per user, max 16 queued (FIFO). Beyond the cap → `code: "Throttled"` with `throttleSource: "librechat_concurrency_cap"`. Graph 429s are passed through with `Retry-After` preserved.
- **Single-flight OBO** (`REQ-021`): K concurrent callers for the same `(user, scope-set)` coalesce into one Entra call (with ≤3 retries on transient 5xx/429/network errors). Prevents thundering-herd on API restart.
- **Token freshness at emission** (`PERF-003`): the token TTL is re-checked after dequeue, immediately before the `Authorization` header is set. A long queue wait can't deliver a stale token to Graph.
- **Deterministic-failure short-circuit** (`REQ-027`): protocol mismatch, NXDOMAIN, fatal TLS, HTTP 501 / 426 → stop reconnecting until the next deploy (don't burn the circuit breaker's 7-cycle / 45s budget).
- **Bounded restart policy** (`REL-003`): `restart_policy.max_attempts: 5` over a 5-minute window prevents runaway restart cascades on pathological boot failures.
- **Sidecar resource limits**: 256 MiB memory / 0.5 CPU, read-only root FS, `cap_drop: ALL`, `no-new-privileges`. Healthcheck tolerates HTTP 400/405/406 from `/mcp` (POST-only JSON-RPC surface) as proof-of-life.

### Error contract surfaced to agents

| `code` | Meaning |
|---|---|
| `Unauthenticated` | No Entra session (e.g. local-auth user) — no `Authorization` header sent |
| `InvalidToken` | JWT claim-shape violation at emission (audience / tenant / app-id / lifetime) |
| `InsufficientScope` | Graph 403 — scope missing or admin consent not granted |
| `WriteForbidden` | Phase-1 read-only guard — write attempted |
| `Throttled` | Graph 429 or LibreChat concurrency cap (with `throttleSource` + `retryAfter`) |
| `UpstreamUnavailable` | Graph 5xx / timeout |
| `ProtocolMismatch` | Sidecar advertises an MCP protocol revision LibreChat doesn't support |
| `SidecarUnavailable` | mcp-m365 unreachable or in `dead` state after restart cap |

---

## Privacy and compliance posture

- **Data minimization** at the tool boundary: each Softeria tool the sidecar exposes is reviewed for Graph `$select` projection support, recorded in `mcp-m365/tool-projection.md`. The agent fetches subject / sender / date for triage, not full bodies, unless the user's intent requires it.
- **Prompt-injection-resistant guardrails** in `serverInstructions`: the model is directed not to enumerate SharePoint / OneDrive / mail without a user-named target (site, folder, sender, keyword, date range). Compensates for tenant-wide read scopes (`Files.Read.All`, `Sites.Read.All`).
- **GDPR Art. 13 / 14 transparency**: the Memodo privacy notice lists the new personal-data categories accessible to agents (mail bodies, attendees, contacts, files, tasks, notes, profile) in plain language — the Entra consent screen alone (which lists Graph scopes) is not sufficient.
- **Per-user attribution** (`SEC-004`): every Graph call is provably attributable to a single Entra user via the delegated OBO exchange. App-only / `.default` daemon access is rejected at the JWT-invariant check before the token leaves LibreChat.
- **Tool output flows through SPEC-009 PII detection** (`REQ-019`): no bypass — mail bodies, calendar invites, SharePoint content, and contact details are subject to the user's configured PII mode (`detect` / `warn`).

---

## Enabling for a specific agent

1. In LibreChat, open the **Agent Builder**.
2. In the tools panel, find the `Microsoft365` group and toggle the desired tools on.
3. Save the agent. The tools surface to the model with names like `<tool>_mcp_Microsoft365` (namespace enforced by `MCPManager`).
4. On the first M365-tool invocation, the user must have an active Entra session in LibreChat (SSO via OpenID Connect). Local-auth users will see `Unauthenticated` until they sign in via Microsoft.

---

## Phase 2 — what unlocks next

Phase 2 is gated on a stability soak of phase 1. The known follow-ups are tracked in SPEC-014's "Future Work":

- Write scopes (`Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite.All`, `Tasks.ReadWrite`, `Notes.ReadWrite`) — coordinated with idempotency-key enforcement on retries.
- `--org-mode` on the Softeria entrypoint to unlock Teams, SharePoint admin, shared mailboxes, presence, attendance, and meeting transcripts.
- `Sites.Selected` instead of `Sites.Read.All` once an operational model for admin-paired site grants is in place.
- A short-lived per-`(user, endpoint, params)` Graph-result cache for repeat-fetch-heavy agent loops, gated on telemetry showing >30% repeat rate within 60s.
- Observability automation (Prometheus / Grafana) tracked under PRE-RESEARCH-013, replacing the phase-1 manual log scrape for PERF-001 / PERF-002 baselines.

Every phase-2 change is a coordinated PR: Entra scope expansion, `OPENID_GRAPH_SCOPES`, new `serverInstructions` body (with bumped version marker), updated `tool-projection.md`, and a refreshed OD-6 governance closure (privacy notice + sub-processor confirmation).

---

## Related documents

- `SDD/requirements/SPEC-014-m365-mcp-integration.md` — full spec, success criteria, verification plan.
- `SDD/research/RESEARCH-005-m365-mcp-integration.md` — MCP server option comparison, auth-flow analysis.
- `SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md` — BYOT-over-OBO decision.
- `SDD/adr/0002-readonly-default-delegated-graph-scopes.md` — read-only default policy.
- `mcp-m365/README.md` — operator runbook (build, verify, version-bump).
