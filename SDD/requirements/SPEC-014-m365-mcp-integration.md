# SPEC-014: Microsoft 365 MCP Integration (Softeria)

## Executive Summary

- **Based on Research:** RESEARCH-005-m365-mcp-integration.md (substantive research)
- **Sequence pointer:** RESEARCH-014-m365-mcp-integration.md (stub — explains why no fresh research was produced at this sequence number)
- **Creation Date:** 2026-05-13
- **Author:** Claude (planning) / Pablo Oliva (sponsor)
- **Status:** Draft

> **Why the spec number doesn't match the research number.** This repo's convention is RESEARCH-N ↔ SPEC-N (1:1). For this initiative the research lives at RESEARCH-005 (completed before the SPEC-008..012 cluster), but the SPEC is being authored now (2026-05-13) — after SPEC-012. The SPEC number is advanced to 014 so that a future reader scanning the requirements directory immediately sees this is **newer** work, not something that pre-dates SPEC-008. The 013 slot is reserved by `PRE-RESEARCH-013-observability-extension.md`, hence 014.

This specification defines how MemodoAI LibreChat will expose Microsoft 365 (Outlook, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do, Planner, Contacts, Graph search) to agents as MCP tools. The integration deploys Softeria's `@softeria/ms-365-mcp-server` as a stateless Docker sidecar on the same Compose stack as LibreChat, and uses LibreChat's existing Bring-Your-Own-Token (BYOT) plumbing — the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder resolved via Entra On-Behalf-Of (OBO) — to authenticate every Graph call as the signed-in user. The MCP container holds no secrets and no tokens.

## Research Foundation

### Production Capabilities Currently Missing

1. **No agent-level M365 access.** LibreChat agents cannot read mail, list calendar events, query SharePoint, or list a user's OneDrive. The only M365 surface today is the (unenabled) SharePoint file picker, which is a UI attachment flow, not an agent tool.
2. **`mcpServers:` block is empty.** `librechat.yaml` has the example block commented out (`librechat.yaml:108-120`); no MCP servers are currently configured.
3. **OBO plumbing is wired but unused.** `GraphTokenService` and the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder are fully implemented but no consumer references them today.
4. **`mcpSettings.allowedDomains` is in strict-allowlist mode** (`librechat.yaml:101-103` lists only `docs.mcp.cloudflare.com`). Any new MCP server URL — including an internal hostname — must be added explicitly.
5. **No SDD-tracked decision on Teams write capability.** RESEARCH-005 left phase-1 vs phase-2 scope open; this spec closes that gap by defining read-only as the initial production surface.

### Stakeholder Validation

- **Product / MemodoAI sponsor:** M365 access is a top-requested capability for sales-engineering and ops users; phase-1 must ship within a single sprint and not require Copilot per-seat licensing.
- **Engineering:** Must not require forking Softeria. Must keep Graph traffic inside the existing Hetzner VPS + EU Data Boundary; secrets never live in the MCP container.
- **Security / Compliance (DPO-equivalent):** Phase-1 scopes must be read-only; every Graph call must carry a user-scoped delegated token (no app-only / `.default` daemon access). Per-user audit trail must be reconstructable from existing LibreChat + Graph activity logs.
- **DevOps / SRE:** Sidecar must run under the same `./prod.sh` lifecycle as the rest of the stack; logs must be available via `./prod.sh logs -f mcp-m365`; outbound traffic must fit the existing Hetzner Cloud Firewall whitelist (TCP 443 only).
- **End users:** Tools must surface in the agent builder with intelligible names; first-time consent prompts must list scopes in plain language; failure modes (e.g., user denied a scope) must produce actionable errors, not a 500.

### System Integration Points

- `librechat.yaml:101-103` — `mcpSettings.allowedDomains` (currently strict; needs new entries for the sidecar hostname)
- `librechat.yaml:108-120` — `mcpServers:` block (currently commented; replace with `Microsoft365` entry)
- `packages/api/src/utils/oidc.ts:35` — `GRAPH_TOKEN_PLACEHOLDER = '{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}'` constant
- `packages/api/src/utils/graph.ts:103` — `resolveGraphTokenPlaceholder()` (async preprocessing)
- `packages/api/src/utils/graph.ts:41, 134` — `DEFAULT_GRAPH_SCOPES` constant and `GRAPH_API_SCOPES` env fallback
- `packages/api/src/utils/env.ts:276-399` — `processMCPEnv()` header templating pipeline
- `packages/api/src/mcp/MCPManager.ts:335` — async Graph token preprocessing before MCP connect
- `packages/api/src/auth/domain.ts:451, 480` — `extractMCPServerDomain` (returns URL origin) and `isMCPDomainAllowed` (enforces `allowedDomains`)
- `api/server/services/MCP.js:419, 502, 651` — `allowedDomains` enforcement points + GraphTokenService injection (`graphTokenResolver: getGraphApiToken`)
- `api/server/services/GraphTokenService.js:8-80` — JWT-bearer OBO exchange + per-user token cache keyed by `${user.openidId}:${scopes}`
- `api/server/routes/config.js:20, 167-169` — SharePoint file picker env wiring (out of scope here but shares the OBO trust boundary)
- `docker-compose.override.yml` (root) — current sidecar location for `minio`/`minio-init`; new MCP service slots in alongside, on `caddy_net`
- `docker-compose.prod.yml` (root) — prod mirror; declares `caddy_net: external: true`
- `prod.sh` — wraps `docker compose` with the three-file overlay and `.env.prod`; supports `build`, `up`, `restart`, `logs`, `ps`, `stop`, `down`
- `.env.example:536-581` — OIDC / OpenID block; `:589-596` SharePoint picker block; `:638` `OPENID_GRAPH_SCOPES`

## Intent

### Problem Statement

LibreChat agents in MemodoAI cannot interact with the user's Microsoft 365 environment. Every M365-adjacent workflow today requires the user to context-switch out of LibreChat (open Outlook, copy text, paste back). At the same time, this LibreChat checkout already contains the entire technical scaffolding to make M365 a first-class agent tool surface — the missing pieces are configuration, an external sidecar process, and an Entra app-registration update. Building a custom integration would be wasteful given the ecosystem; using Microsoft's licensed Agent 365 Work IQ servers would impose a per-seat cost the deployment cannot justify.

### Solution Approach

Deploy Softeria's MCP server as a Docker sidecar named `mcp-m365` on the existing `caddy_net` and `default` networks. Configure it in `librechat.yaml` as a `streamable-http` MCP server with the BYOT auth header `Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"`. Add the sidecar hostname to `mcpSettings.allowedDomains`. Update the Entra app registration to grant the phase-1 delegated Graph scopes. Update `OPENID_GRAPH_SCOPES` in `.env.prod` to request the same scopes at OBO exchange time. The MCP server itself is stateless: no env vars, no token cache, no OAuth client of its own. LibreChat hands it a Bearer token at every call; the server proxies to `graph.microsoft.com`.

### Expected Outcomes

- LibreChat agents can read the signed-in user's M365 data across the phase-1 surface (mail, calendar, files in OneDrive and SharePoint, contacts, tasks, notes, profile) without any extra licensing.
- Every Graph call is performed as the signed-in user via OBO; no shared service principal touches user data.
- The MCP sidecar is restart-safe and stateless; restarting it (or replacing the image) requires no token migration.
- Operators can extend the integration to write operations and Teams posting by changing config alone, not code.
- Graph traffic stays inside the EU Data Boundary (existing tenant region).
- The deployment workflow (commit on `pablo`, push, `ssh Hetzner-personal "cd /opt/docker/librechat && git pull && ./prod.sh ..."`) is unchanged.

## Success Criteria

### Functional Requirements

- **REQ-001: Sidecar service defined.** A service named `mcp-m365` is defined in `docker-compose.override.yml` and `docker-compose.prod.yml`, built from `./mcp-m365/Dockerfile`, attached to both the `default` and `caddy_net` Docker networks. No host port is published.
- **REQ-002: Sidecar Dockerfile.** `mcp-m365/Dockerfile` is based on `node:22-alpine`, installs `@softeria/ms-365-mcp-server` (pinned to a specific version after first successful deploy), exposes port 3000, and runs the server with `--http 3000 --toon` as the entrypoint. The image installs nothing else.
- **REQ-003: No environment-resident secrets.** The `mcp-m365` service has no Entra client ID, no Entra client secret, no refresh token, and no `OAUTH_*` env vars. All credentials it needs are supplied per-request by LibreChat in the `Authorization` header.
- **REQ-004: `librechat.yaml` MCP server entry.** A `Microsoft365` entry is added under `mcpServers:` with `type: streamable-http`, `url: http://mcp-m365:3000/mcp`, `timeout: 45000`, `initTimeout: 150000`, `startup: true`, `headers.Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"`, and a `serverInstructions` field that names every M365 surface available to the agent.
- **REQ-005: `mcpSettings.allowedDomains` extension.** `librechat.yaml` `mcpSettings.allowedDomains` adds a single bare-hostname entry `mcp-m365` so `isMCPDomainAllowed` permits the streamable-http connection (`packages/api/src/auth/domain.ts:480`). `extractMCPServerDomain` returns the origin (`http://mcp-m365:3000`); `isDomainAllowedCore` accepts hostname-only allowlist entries (the same pattern as the existing `docs.mcp.cloudflare.com` entry), so no port/protocol qualifier is needed. Existing entries are preserved.
- **REQ-006: BYOT pattern (no Softeria-side OAuth).** The MCP server is started in pure BYOT mode (no `--auth`, no OAuth flags). Softeria issue #187 (race condition in its bundled OAuth implementation) is therefore not in scope.
- **REQ-007: OBO exchange via existing `GraphTokenService`.** No new OBO code is added. The placeholder is resolved by `resolveGraphTokenPlaceholder()` (`packages/api/src/utils/graph.ts:119`) via `GraphTokenService.getGraphApiToken()` (`api/server/services/GraphTokenService.js:8-80`), already injected into MCPManager at `api/server/services/MCP.js:651`.
- **REQ-008: Phase-1 delegated Graph scopes.** The Entra app registration that LibreChat already uses grants admin consent for, at minimum: `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`. No write scopes are granted in phase 1.
- **REQ-009: `OPENID_GRAPH_SCOPES` env update.** `.env.prod` sets `OPENID_GRAPH_SCOPES` to the comma-separated phase-1 scope list. The same change is documented (with the new default) in `.env.example`. No new env var is introduced.
- **REQ-010: No `--org-mode` flag in phase 1.** The Softeria entrypoint does not include `--org-mode`, so Teams admin/write tools (channel posts, team creation, member management) are not exposed. Re-enabling this is a phase-2 decision.
- **REQ-011: Internal-only network exposure.** The sidecar is reachable only at `http://mcp-m365:3000/mcp` from sibling containers on `default` or `caddy_net`. No Caddyfile route is added. The Hetzner Cloud Firewall is not modified (sidecar accepts no inbound traffic from outside the Docker host).
- **REQ-012: Lazy tool loading respected.** No `--discovery` flag is passed; LibreChat's event-driven lazy tool loading (v0.8.3+) governs which Softeria tools are surfaced to a given conversation.
- **REQ-013: Image build via repo path.** The sidecar builds from a path inside this repo (`./mcp-m365`), so a `./prod.sh build mcp-m365` rebuilds it from the prod host's local working tree. No external registry account is required for phase 1.
- **REQ-014: Restart-only deploy.** Adding or changing the sidecar requires no LibreChat API container rebuild. Restarting the API (`./prod.sh restart api`) is the only LibreChat-side action needed after `librechat.yaml` changes.
- **REQ-015: User-error handling.** When a user without a valid Entra session triggers an M365 tool call, LibreChat returns a clear error to the agent describing the missing token, not a 500. (This is existing `GraphTokenService` behavior; this requirement records the expectation.)
- **REQ-016: Scope-missing handling.** When a user has consented but is missing a phase-1 scope, the Graph 403 must surface to the agent as a clean tool error, not as a server crash or stuck stream.
- **REQ-017: SharePoint file picker untouched.** Enabling/disabling the existing SharePoint file picker (`ENABLE_SHAREPOINT_FILEPICKER`, `SHAREPOINT_BASE_URL`, `SHAREPOINT_PICKER_*`) is explicitly out of scope for this spec. It shares the OBO trust boundary but is tracked separately.
- **REQ-018: Service start ordering.** The `api` service declares `depends_on: [mcp-m365]` with `condition: service_started` (in both `docker-compose.override.yml` and `docker-compose.prod.yml`). Combined with `startup: true` on the `Microsoft365` MCP entry, this guarantees the sidecar is at least up-and-listening before LibreChat attempts its initial connect; `initTimeout: 150000` then absorbs cold-start tool registration.
- **REQ-019: Tool-output flows through existing PII detection.** Output produced by `Microsoft365` tools (mail bodies, calendar invites, SharePoint content, contact details) traverses the same agent message path as any other tool result and is therefore in scope for SPEC-009 PII detection / redaction. This requirement records the expectation that no special-case bypass is introduced; behavior follows the user's configured PII mode (`detect` / `warn`).

### Non-Functional Requirements

- **SEC-001: No tokens at rest in the sidecar.** The `mcp-m365` container writes no tokens to disk and stores no tokens in memory beyond a single in-flight request.
- **SEC-002: No new SSRF surface.** The new entry in `mcpSettings.allowedDomains` is restricted to the internal Docker DNS name; no public host is added on behalf of the sidecar. `actions.allowedDomains` is unchanged.
- **SEC-003: Read-only blast radius.** Phase-1 scopes do not permit sending mail, deleting files, creating calendar invites, or modifying SharePoint content. Any tool call attempting a write will fail with Graph 403.
- **SEC-004: Per-user audit reconstruction.** Each Graph call is attributable to a single Entra user via the JWT-bearer OBO exchange; LibreChat conversation logs + Graph activity logs together produce a per-user trail.
- **SEC-005: EU data residency preserved.** No traffic exits the Memodo Entra tenant's region. The MCP sidecar makes outbound TLS to `graph.microsoft.com` only; this hits the same Microsoft-fronted endpoint as existing OIDC userinfo / overage calls.
- **PERF-001: Cold-start tolerance.** Cold-start latency for the first MCP call after `mcp-m365` restart is allowed up to 5 seconds (Softeria server + lazy tool registration). `initTimeout: 150000` ms is set to absorb this comfortably.
- **PERF-002: Steady-state latency budget.** Steady-state per-tool latency is dominated by Graph round-trip (typically <800 ms for a `/me/messages` listing); the MCP hop adds <50 ms on the same Docker network.
- **PERF-003: Token reuse and transparent refresh.** `GraphTokenService` caches the per-user Graph token under `${user.openidId}:${scopes}` so consecutive tool calls within a single conversation reuse a single OBO exchange. When a cached token expires or nears expiry, the service re-runs the JWT-bearer OBO exchange on the next call; the MCP sidecar simply receives a new Bearer header. Long-running conversations therefore do not need bespoke refresh logic on the MCP side.
- **OPS-001: Single-command lifecycle.** `./prod.sh up -d mcp-m365`, `./prod.sh restart mcp-m365`, `./prod.sh logs -f mcp-m365`, `./prod.sh down mcp-m365` all work without additional flags.
- **OPS-002: Logs to stdout/stderr.** The sidecar's logs are accessible via `docker compose logs` without any volume mounts.
- **OPS-003: Idempotent redeploy.** Re-running the deploy sequence (`git pull && ./prod.sh build mcp-m365 && ./prod.sh up -d mcp-m365 && ./prod.sh restart api`) is safe to repeat with no manual cleanup.
- **UX-001: Discoverable tool group.** In the agent builder, the M365 tools appear under a group label of `Microsoft365` (matching the YAML key), so users can enable/disable them per agent.
- **UX-002: Plain-language `serverInstructions`.** The `serverInstructions` string in `librechat.yaml` names the M365 surfaces in human terms; the LLM sees this when choosing whether to invoke a tool.

## Out of Scope (Explicit Non-Goals)

- **Phase-2 features (deferred):**
  - Write scopes (`Mail.ReadWrite`, `Calendars.ReadWrite`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Tasks.ReadWrite`, `Notes.ReadWrite.All`)
  - `--org-mode` flag (Teams channel posting, team/member management)
  - Microsoft Agent 365 / Work IQ servers (require M365 Copilot licensing)
  - General OBO token exchange beyond Graph (LibreChat issue #11867)
- **SharePoint file picker enablement** — tracked separately; shares OBO machinery but is a UI feature, not an MCP tool.
- **Teams-native LibreChat surface** (a bot in Teams that proxies to LibreChat) — requires a separate Teams app and is not solvable from this stack.
- **Custom UI for per-user M365 consent management** — relies on the standard Entra consent prompt at sign-in.
- **Image publication to an external registry** — phase 1 builds locally on each host; GHCR / ACR publication is a phase-2 operational improvement.

## Open Decisions

The following are not blockers for drafting but must be settled before implementation begins:

- **OD-1: Softeria version pinning.** First deploy uses `@latest`; immediately after green smoke-test, pin to the resolved version and record it in `mcp-m365/Dockerfile`.
- **OD-2 (resolved 2026-05-18):** `mcpSettings.allowedDomains` takes a single bare-hostname entry `mcp-m365`. `extractMCPServerDomain` returns the URL origin and `isDomainAllowedCore` matches hostname-only allowlist entries — no protocol/port qualifier required.
- **OD-3: Agent-default-tools opt-in.** Decide whether `Microsoft365` is opt-in per agent (recommended) or visible to all agents by default.
- **OD-4: Phase-2 timing.** Define a soak period (proposed: 2 weeks of phase-1 in production) before considering write scopes or `--org-mode`.
- **OD-5: Sidecar `/health` endpoint.** Verify on first build whether the Softeria server exposes `GET /health` (the smoke test assumes it does). If not, the smoke test must fall back to probing `GET /mcp` and accepting any non-5xx response as proof-of-life, or `HEAD /` against the bound port.

## Implementation Plan

### 1. Sidecar Dockerfile

Create `mcp-m365/Dockerfile`:

```dockerfile
FROM node:22-alpine
RUN npm install -g @softeria/ms-365-mcp-server@latest
EXPOSE 3000
ENTRYPOINT ["ms-365-mcp-server", "--http", "3000", "--toon"]
```

Pin the version after the first successful deploy (replace `@latest` with `@<resolved-version>`).

### 2. Compose service (dev + prod)

In `docker-compose.override.yml` add:

```yaml
mcp-m365:
  build: ./mcp-m365
  container_name: mcp-m365
  restart: unless-stopped
  networks:
    - default
    - caddy_net
  expose:
    - "3000"
```

…and add `mcp-m365` to the `api` service's `depends_on` (alongside any existing entries):

```yaml
api:
  depends_on:
    mcp-m365:
      condition: service_started
```

Mirror both blocks into `docker-compose.prod.yml` with identical networks (and the same `build: ./mcp-m365` so `./prod.sh build mcp-m365` works on the prod host).

### 3. `librechat.yaml` changes

Extend `mcpSettings.allowedDomains` (per resolved OD-2: bare hostname only):

```yaml
mcpSettings:
  allowedDomains:
    - 'docs.mcp.cloudflare.com'
    - 'mcp-m365'
```

Replace the commented `mcpServers:` block with:

```yaml
mcpServers:
  Microsoft365:
    type: streamable-http
    url: http://mcp-m365:3000/mcp
    timeout: 45000
    initTimeout: 150000
    startup: true
    headers:
      Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"
    serverInstructions: >
      Use these tools to interact with the signed-in user's Microsoft 365 data:
      Outlook mail, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do,
      Planner, Contacts, and Graph search. Operate strictly on behalf of the
      current user. All scopes are read-only in phase 1; do not attempt
      writes (send, create, update, delete) — they will fail with HTTP 403.
```

### 4. Entra app registration (Azure portal, manual)

Grant admin consent on the Memodo Entra app registration for these delegated Graph permissions:

`User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`.

### 5. `.env.prod` change (prod host only)

```
OPENID_GRAPH_SCOPES=User.Read,Mail.Read,Calendars.Read,Files.Read.All,Sites.Read.All,Contacts.Read,Tasks.Read,Notes.Read.All,offline_access
```

Document the new default in `.env.example` (committed) without exposing tenant-specific values.

### 6. Deploy

Dev:
```
docker compose build mcp-m365
docker compose up -d mcp-m365
docker compose restart api
```

Prod (after merging into `pablo` and pushing):
```
ssh Hetzner-personal "cd /opt/docker/librechat && git pull && \
  ./prod.sh build mcp-m365 && \
  ./prod.sh up -d mcp-m365 && \
  ./prod.sh restart api"
```

Update `.env.prod` on the host (do NOT commit).

## Verification Plan

### Smoke tests (dev)

1. **Sidecar reachable from API container:**
   First try `docker compose exec api wget -qO- http://mcp-m365:3000/health` → expect 200. If Softeria does not expose `/health` (see OD-5), fall back to `docker compose exec api wget -S --spider http://mcp-m365:3000/mcp` and accept any non-5xx response as proof-of-life.
2. **Allowed-domains accepts internal hostname:**
   Tail `docker compose logs -f api` while restarting; expect no `isMCPDomainAllowed` rejection for `mcp-m365`.
3. **Tool group surfaces in agent builder:**
   Sign in via Entra, open Agent Builder, confirm `Microsoft365` tools appear.
4. **Read-only Graph call (lowest scope):**
   Prompt an M365-enabled agent: "Who am I, according to Microsoft Graph?" → expect a `/me` response with display name, mail, UPN.
5. **OBO exchange observed:**
   `docker compose logs -f api | grep -iE 'graph|obo'` → expect one OBO exchange per (user, scope-set) per cache TTL, with subsequent tool calls reusing the cached token.
6. **MCP sidecar receives Bearer:**
   `docker compose logs -f mcp-m365` → expect inbound `/mcp` calls with `Authorization: Bearer eyJ...`.

### Negative tests

- **Missing consent:** Sign in with a user who has not consented to (e.g.) `Files.Read.All`; prompt the agent to list OneDrive files. Expect a 403 surfaced as a tool error, not a crash.
- **Non-Entra session:** Sign in via local auth (if available); the Graph placeholder should resolve to an empty string and the tool call should fail fast, surfacing a clear error.
- **Phase-1 write attempt:** Prompt the agent to send an email. Expect a Graph 403, captured cleanly by the agent loop (no stuck SSE stream).

### Operational smoke tests (prod)

After the prod deploy sequence:
1. `./prod.sh ps` — `mcp-m365` shows `Up`.
2. `./prod.sh logs --tail 50 mcp-m365` — clean startup, server bound to `:3000`.
3. `./prod.sh logs --tail 100 api | grep -i mcp` — `Microsoft365` MCP server connected without retries.
4. End-to-end smoke from the prod URL (`https://chat.memodo-eng.de`) as a Memodo user with consent: same `/me` smoke as in dev.

### Rollback

- **Sidecar regression:** comment out the `Microsoft365` entry in `librechat.yaml`, `./prod.sh restart api`. The sidecar can stay running with no consumer.
- **Sidecar unhealthy:** `./prod.sh stop mcp-m365` — agents lose M365 tools but every other feature continues unaffected. The MCP server is non-load-bearing for the rest of the chat path.
- **OBO regression:** revert `.env.prod` `OPENID_GRAPH_SCOPES` to its prior value and `./prod.sh restart api`. Existing OIDC sign-in is unaffected (the additional Graph scopes are requested only when OBO exchange is invoked).

## Future Work (Tracked Separately)

- **Phase 2:** Promote read scopes to read-write where business value is clear; consider enabling `--org-mode` for Teams write tools after a content-policy review.
- **Image hardening:** Pin Node base image to a digest, switch to a `node:22-slim` non-root user, publish the built image to a registry to remove the prod-side build step.
- **Audit dashboard:** Surface per-user M365 tool usage in the admin reporting dashboard (SPEC-008) once that ships.
- **SharePoint file picker:** Enable in a separate spec; reuses the same OBO trust boundary.
