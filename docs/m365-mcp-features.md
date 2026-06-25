# Microsoft 365 MCP Integration

**Status:** Phase 1 (read-only). Infrastructure complete via SPEC-014; auth migrated to LibreChat-native
OBO on the v0.8.7-rc1 upgrade (see ADR 0004 / RESEARCH-015). Code-complete and build/test-validated;
**runtime end-to-end verification against a live Entra session is still pending.**
**Branch:** `feature/015-m365-mcp-bridge` (off `feature-upgrade-15-06-26`); original impl was `feature/014`.
**Spec / research / ADR:** `SDD/requirements/SPEC-014-m365-mcp-integration.md`,
`SDD/research/RESEARCH-015-librechat-agent-bridge-byot-mcp.md`,
`SDD/adr/0004-mcp-native-obo-over-handrolled-byot.md`.

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

Phase 1 ships **read-only** by design — agents cannot send mail, create calendar invites, modify files, post to Teams, or change SharePoint content. The OBO token carries only read-delegated Graph scopes, so attempted writes fail at the Microsoft Graph API (HTTP 403) and surface to the agent as a tool error.

Also deferred (Softeria's `--org-mode` is off):

- Teams chats, channel posts, team creation
- SharePoint admin (sites / lists CRUD)
- Shared mailboxes, presence, attendance reports, meeting transcripts / recordings
- User management / directory admin

Phase 2 will revisit write scopes and `--org-mode` after a stability soak.

---

## How it works (one paragraph)

When a user signs into LibreChat with Microsoft Entra ID (OpenID Connect), LibreChat performs an **On-Behalf-Of (OBO) token exchange** with Entra and caches the resulting Microsoft Graph access token per `(user, scope-set)`. The `Microsoft365` server declares an `obo: { scopes }` block in `librechat.yaml`; when the per-user connection is (re)established for a tool call, LibreChat's native OBO path (`resolveOboToken` → `OboTokenService.exchangeOboToken`) mints the user-scoped Graph token and attaches it as the connection's `Authorization: Bearer <token>`. The `mcp-m365` sidecar proxies the call to `graph.microsoft.com` using the user's token. The sidecar **stores no credentials, no refresh tokens, and no per-user state** — every request carries its own token (a "Bring-Your-Own-Token" / BYOT trust boundary). The OBO exchange is single-flight-coalesced and cached by `(user, scopes)`; when the cached token nears expiry it is re-exchanged transparently.

> **Auth mechanism note (2026-06).** This replaces the original SPEC-014 hand-rolled path (the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` header placeholder + `GraphTokenService` + a custom `MCPCallQueue`). The v0.8.5 → v0.8.7-rc1 upgrade fixed the MCP-to-agent bridge bug that had blocked the agent surface (RESEARCH-015) and shipped a first-class OBO feature, so the custom machinery was retired in favour of the native `obo:` config. Admin/YAML-defined OBO servers bypass the per-author `CONFIGURE_OBO` trust gate by deployment-level trust. See **ADR 0004**.

### Trust boundary

- LibreChat API → mcp-m365: internal Docker network only (`mcp-m365:3000`); no host port published; allowlisted via `mcpSettings.allowedDomains: ['mcp-m365']`.
- mcp-m365 → Microsoft Graph: outbound TLS to `graph.microsoft.com:443` only.
- No env-resident secrets in the sidecar. No tokens on disk. No tokens in sidecar logs (`SEC-007`).
- Graph traffic stays inside the Memodo Entra tenant region under the Microsoft **EU Data Boundary**.

### Per-user audit trail

Every Graph call is provably attributable to a single Entra user via the delegated OBO exchange. Incident triage joins three log surfaces, keyed on user + conversation/message identifiers plus timestamp:

> The SPEC-014 deterministic correlation ID (`conversationId:messageId:toolCallId` propagated to Graph as `client-request-id`) was emitted by the retired `MCPCallQueue`; on the native OBO path it is no longer attached per call. Re-introduce it as a generic MCP request-header propagation if cross-surface join-by-single-ID is required.

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
    obo:
      scopes: "User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All"
    serverInstructions: >
      Use these tools to interact with the signed-in user's Microsoft 365 data:
      Outlook mail, Calendar, OneDrive (files), Excel, OneNote, To Do, Planner,
      Contacts, and Graph search. Operate strictly on behalf of the current user.
      All scopes are read-only in phase 1; do not attempt writes ...
```

The `obo.scopes` are the space-separated Microsoft Graph delegated scopes exchanged per signed-in user. They must be covered by the Entra app's admin consent (see "Entra app registration" below). There is no longer a `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` header placeholder — the token is resolved and attached by LibreChat's native OBO path.

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

The integration relies on the following guardrails:

- **Single-flight OBO**: concurrent callers for the same `(user, scope-set)` coalesce into one Entra exchange (with a transient-error retry), and the result is cached by `(user, scopes)`. Prevents a thundering herd on the identity provider.
- **Bounded restart policy** (`REL-003`): `restart_policy.max_attempts: 5` over a 5-minute window prevents runaway restart cascades on pathological boot failures.
- **Sidecar resource limits**: 256 MiB memory / 0.5 CPU, read-only root FS, `cap_drop: ALL`, `no-new-privileges`. Healthcheck tolerates HTTP 400/405/406 from `/mcp` (POST-only JSON-RPC surface) as proof-of-life.

> **Retired with the native-OBO migration (ADR 0004).** The original SPEC-014 path added a per-user concurrency queue (`REQ-024`), a cascading-timeout invariant (`REQ-025`), a deterministic-failure / protocol-mismatch short-circuit (`REQ-027`), and a structured error envelope (`Unauthenticated` / `InvalidToken` / `InsufficientScope` / `WriteForbidden` / `Throttled` / `UpstreamUnavailable` / `ProtocolMismatch` / `SidecarUnavailable`). These are **no longer present**. On the native path: Microsoft Graph 429s and 5xx surface through the standard MCP connection error path (the per-user concurrency cap is gone); the MCP SDK negotiates protocol version (no custom pin); and write attempts fail at the Graph API rather than via a custom `WriteForbidden` code. Note the SPEC-014 `InvalidToken` JWT-claim validation was defined but **never wired into the live token path**, so its absence here is not a behavioural change.

---

## Privacy and compliance posture

- **Data minimization** at the tool boundary: each Softeria tool the sidecar exposes is reviewed for Graph `$select` projection support, recorded in `mcp-m365/tool-projection.md`. The agent fetches subject / sender / date for triage, not full bodies, unless the user's intent requires it.
- **Prompt-injection-resistant guardrails** in `serverInstructions`: the model is directed not to enumerate SharePoint / OneDrive / mail without a user-named target (site, folder, sender, keyword, date range). Compensates for tenant-wide read scopes (`Files.Read.All`, `Sites.Read.All`).
- **GDPR Art. 13 / 14 transparency**: the Memodo privacy notice lists the new personal-data categories accessible to agents (mail bodies, attendees, contacts, files, tasks, notes, profile) in plain language — the Entra consent screen alone (which lists Graph scopes) is not sufficient.
- **Per-user attribution** (`SEC-004`): every Graph call is provably attributable to a single Entra user via the delegated OBO exchange — the token is minted from the signed-in user's OIDC identity. (The SPEC-014 JWT-invariant check that would have additionally rejected app-only / `.default` tokens at emission was defined but never wired into the live path; the native OBO path trusts Entra's exchange response. If claim-level enforcement is needed, add it explicitly — see ADR 0004.)
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
