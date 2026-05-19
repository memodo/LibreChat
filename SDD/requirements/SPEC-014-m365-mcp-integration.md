---
review_panel: [security, performance, api-contract, module-depth, privacy, reliability]
eval_required: false
cross_cutting_decisions: [mcp_byot_auth_pattern, phase1_readonly_graph_scopes]
delivery_mode: whole-feature
---

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
- **REQ-002: Sidecar Dockerfile.** `mcp-m365/Dockerfile` is based on `node:22-alpine` **pinned by digest** (`FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920` — the multi-arch OCI index digest resolved 2026-05-18 via Docker Hub API for tag `library/node:22-alpine`; both amd64 and arm64 variants are reachable via this index), installs `@softeria/ms-365-mcp-server` pinned to a concrete semver (NOT `@latest`) with the resolved tarball SHA-256 (obtained via `npm view @softeria/ms-365-mcp-server@<version> dist.integrity`) recorded as a comment in the Dockerfile, exposes only port 3000 (no other listener), and runs the server with `--http 3000 --toon` as the entrypoint. Container runs as non-root with a read-only root filesystem and `--security-opt no-new-privileges`. The resolved version is also written to a committed `mcp-m365/VERSION` artifact so `git log` surfaces tool-surface changes. The image installs nothing else. **Release gate:** no merge of the implementation PR until the Dockerfile contains BOTH (a) the resolved Softeria semver + tarball integrity hash AND (b) the `node:22-alpine` digest pin. The implementation PR re-resolves the `node:22-alpine` digest at PR time (the value above is the 2026-05-18 reference; an implementation PR landing weeks later MUST resolve the digest fresh via `docker manifest inspect node:22-alpine` or the Docker Hub API and record it). See OD-1.
  - **Build-time tarball integrity verification (release gate).** The recorded SHA-256 alone is documentation; `npm install -g <name>@<semver>` does not verify against a Dockerfile comment. The Dockerfile MUST run `npm pack` followed by `sha256sum -c` against the recorded SHA-256 and FAIL the build on mismatch. The verified tarball is then installed via `npm install -g <tarball-path>` (local-tarball install, not registry install). This forces actual cryptographic verification at build time, closing the gap where a compromised registry mirror or tarball overwrite would otherwise pass undetected. The exact filename pattern (`softeria-ms-365-mcp-server-<semver>.tgz`) follows npm's standard pack output for scoped packages (scope `@softeria` becomes `softeria-` prefix); the implementation PR verifies the literal filename `npm pack` emits and adjusts if needed. See OD-1 closure language.
- **REQ-003: No environment-resident secrets.** The `mcp-m365` service has no Entra client ID, no Entra client secret, no refresh token, and no `OAUTH_*` env vars. All credentials it needs are supplied per-request by LibreChat in the `Authorization` header.
- **REQ-004: `librechat.yaml` MCP server entry.** A `Microsoft365` entry is added under `mcpServers:` with `type: streamable-http`, `url: http://mcp-m365:3000/mcp`, `timeout: 45000`, `initTimeout: 150000`, `startup: false`, `headers.Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"`, and a `serverInstructions` field that names every M365 surface available to the agent.
  - **Transport choice rationale.** `streamable-http` is chosen over `sse` because the MCP specification deprecated SSE in March 2025 (per RESEARCH-005 §"Supported Transports").
  - **`startup: false` rationale (Step 4e fix — verified 2026-05-19 by running Softeria locally).** Softeria 0.110.0 requires the `Authorization` header on every JSON-RPC call including the bare `initialize`, so the spec's earlier `startup: true` bootstrap path (handshake with a null Bearer token at API startup) is unreachable. The connection is therefore lazy: the MCP handshake and tool-list registration occur on the FIRST user-scoped `tools/call` once a real Bearer token is available. PERF-001's 5s cold-start budget absorbs the first-call latency. If a future Softeria release accepts unauthenticated `initialize` / `tools/list`, this requirement and SEC-006 can be re-evaluated to restore startup-time connect.
  - **Naming codification (`mcp-m365` vs. `Microsoft365`).** Both names refer to the same logical service at distinct layers. Container DNS name on the Docker network: `mcp-m365` (kebab-case, Docker-DNS-safe). `mcpServers` YAML key in `librechat.yaml`: `Microsoft365` (CamelCase, becomes the agent-builder group label per UX-001). Agent-builder UI label: `Microsoft365` (matches YAML key). Tool-name prefix per UX-001 is the server-name-scoped suffix `_mcp_Microsoft365` automatically applied by `MCPManager`.
- **REQ-005: `mcpSettings.allowedDomains` extension.** `librechat.yaml` `mcpSettings.allowedDomains` adds a single bare-hostname entry `mcp-m365` so `isMCPDomainAllowed` permits the streamable-http connection (`packages/api/src/auth/domain.ts:480`). `extractMCPServerDomain` returns the origin (`http://mcp-m365:3000`); `isDomainAllowedCore` accepts hostname-only allowlist entries (the same pattern as the existing `docs.mcp.cloudflare.com` entry), so no port/protocol qualifier is needed. Existing entries are preserved.
- **REQ-006: BYOT pattern (no Softeria-side OAuth).** The MCP server is started in pure BYOT mode (no `--auth`, no OAuth flags). Softeria issue #187 (race condition in its bundled OAuth implementation) is therefore not in scope.
- **REQ-007: OBO exchange via existing `GraphTokenService`.** No new OBO code is added. The placeholder is resolved by `resolveGraphTokenPlaceholder()` (`packages/api/src/utils/graph.ts:119`) via `GraphTokenService.getGraphApiToken()` (`api/server/services/GraphTokenService.js:8-80`), already injected into MCPManager at `api/server/services/MCP.js:651`. Resolver invocation timing (Step 4e clarification): paired with REQ-004's `startup: false`, the placeholder resolver runs at the FIRST `tools/call` (and on every subsequent `tools/call` per the queue's post-dequeue freshness re-check); there is no bootstrap-time resolver call. The resolver's interface (per-call user + scopes) is otherwise unchanged.
- **REQ-008: Phase-1 delegated Graph scopes.** The Entra app registration that LibreChat already uses grants admin consent for, at minimum: `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`. No write scopes are granted in phase 1. (See REQ-010 for the rationale on excluding `Team.ReadBasic.All` / `Chat.Read` despite RESEARCH-005 recommendation: Softeria gates Teams/Chat read tools on `--org-mode`, so granting those scopes without the flag would waste admin-consent footprint.)
  - **Least-privilege rationale.** `Files.Read.All` and `Sites.Read.All` are tenant-wide read permissions, broader than `Files.Read` / `Sites.Selected`. They are accepted for phase 1 because: (a) MemodoAI users primarily query SharePoint sites their team owns but to which they have delegated access via group membership, and `Files.Read` would block legitimate access; (b) `Sites.Selected` requires admin-paired site-by-site grant and is operationally infeasible for the phase-1 sprint timeline; (c) the blast radius is bounded to the signed-in user's existing read access (delegated permissions cannot exceed what the user can already read in M365); (d) compensating controls are the read-only scope set (SEC-003), per-user OBO attribution (SEC-004), and the rate limit in PERF-004. Phase 2 will revisit `Sites.Selected` once the operational model for admin-paired site grants is in place.
- **REQ-009: `OPENID_GRAPH_SCOPES` env update.** `.env.prod` sets `OPENID_GRAPH_SCOPES` to the comma-separated phase-1 scope list. The same change is documented (with the new default) in `.env.example`. No new env var is introduced.
- **REQ-010: No `--org-mode` flag in phase 1.** The Softeria entrypoint does not include `--org-mode`, so Teams admin/write tools (channel posts, team creation, member management) are not exposed. Re-enabling this is a phase-2 decision.
  - **Deferral note (RESEARCH-005 disconnect resolved here).** Softeria's `--org-mode` is a one-shot deploy gate (not a runtime flag), and it gates not just write tools but also the dedicated Teams, SharePoint Sites/Lists, Shared Mailboxes, User Management, Presence, Attendance Reports, Transcripts/Recordings, and Virtual Events tool surfaces. Phase 1 deliberately excludes all of these. Generic SharePoint Files access via the OneDrive Graph endpoints (`Files.Read.All` + `Sites.Read.All`) still works without `--org-mode` and covers the phase-1 SharePoint use case. RESEARCH-005 recommended `Team.ReadBasic.All` and `Chat.Read`; SPEC-014 deliberately excludes them because Softeria gates Teams/Chat tools on `--org-mode`, so granting those scopes here would waste admin-consent footprint with no tools using them.
  - **Phase-2 follow-up entry.** Decide `--org-mode` alongside any write-scope promotion. Single coordinated decision — flipping `--org-mode` requires a fresh deploy and re-grant of additional admin-consent, so it should not be split across two phase-2 sub-releases.
- **REQ-011: Internal-only network exposure.** The sidecar is reachable only at `http://mcp-m365:3000/mcp` from sibling containers on `default` or `caddy_net`. No Caddyfile route is added. The Hetzner Cloud Firewall is not modified (sidecar accepts no inbound traffic from outside the Docker host).
- **REQ-012: Lazy tool loading respected.** No `--discovery` flag is passed; LibreChat's event-driven lazy tool loading (v0.8.3+) governs which Softeria tools are surfaced to a given conversation.
- **REQ-013: Image build via repo path.** The sidecar builds from a path inside this repo (`./mcp-m365`), so a `./prod.sh build mcp-m365` rebuilds it from the prod host's local working tree. No external registry account is required for phase 1.
- **REQ-014: Restart-only deploy for `librechat.yaml`; build-and-sync deploy for `packages/api/src/`.** The prod LibreChat container runs from a pre-built image with bind-mounts overlaying `packages/api/dist/` (and `packages/data-schemas/dist/`, `packages/data-provider/dist/`, `client/dist/`). Two distinct deploy paths apply:
  - **librechat.yaml-only changes**: restart-only. `git push` + on prod `git pull` + `./prod.sh restart api`.
  - **`packages/api/src/` changes (including ALL SPEC-014 implementation code: queue.ts, errorEnvelope.ts, MCPManager.ts edits, graph.ts edits)**: build locally + sync. Run `npm run build` locally to refresh `packages/api/dist/`, then `./prod-sync.sh` to rsync the dist directories to prod and restart api. The `prod-sync.sh` script (in repo root) guards against missing local dist directories before sync; it requires a current build. Per the `feedback_prod_yaml_deploy` operator memory, `librechat.yaml` goes via git push+pull on prod, not scp; `prod-sync.sh` handles built artifacts only.
  - **Both kinds of change in one deploy**: do them in any order — they're independent paths. Implementation Plan §6 reflects the full sequence.

  In-flight Microsoft365 tool calls during API restart are aborted; affected agent turns surface `code: SidecarUnavailable` per the Error Response Schema. Conversation state (messages already persisted) survives the restart; in-progress non-persisted tool output is lost. Users may need to re-issue the request after restart.

  **Operator gotcha (added 2026-05-19 post-deploy debug):** The original SPEC-014 deploy command in Implementation Plan §6 omitted the build-and-sync path entirely. A `git pull` alone on prod brings `packages/api/src/` source changes but NOT the rebuilt `packages/api/dist/` — the prod container then runs the OLD (often weeks-old) vanilla LibreChat compiled output despite our source changes being present. The first SPEC-014 deploy did exactly this, masking the entire SPEC-014 implementation behind a stale dist for several hours. The Implementation Plan §6 deploy sequence below is corrected.
- **REQ-015: User-error handling.** When a user without a valid Entra session triggers an M365 tool call, LibreChat returns a clear error to the agent describing the missing token, not a 500. (This is existing `GraphTokenService` behavior; this requirement records the expectation.)
- **REQ-016: Scope-missing handling.** When a user has consented but is missing a phase-1 scope, the Graph 403 must surface to the agent as a clean tool error, not as a server crash or stuck stream.
- **REQ-017: SharePoint file picker untouched.** Enabling/disabling the existing SharePoint file picker (`ENABLE_SHAREPOINT_FILEPICKER`, `SHAREPOINT_BASE_URL`, `SHAREPOINT_PICKER_*`) is explicitly out of scope for this spec. It shares the OBO trust boundary but is tracked separately.
- **REQ-018: Service start ordering with single status-tolerant healthcheck.** The `mcp-m365` service ships ONE Docker `healthcheck:` slot (Compose limitation) that functions as a status-tolerant proof-of-life probe; pure-liveness (separate signal that survives upstream-stall without restarting the container) is deferred to the SPEC-010 Prometheus observability track. The implementation pattern:
  - **Status-tolerant probe (commits the spec to "any HTTP response from /mcp proves liveness", resolves OD-5).** The probe is:
    ```yaml
    healthcheck:
      test:
        - CMD-SHELL
        - |
          nc -z localhost 3000 && \
          wget --server-response --spider \
            --tries=1 --timeout=5 \
            http://localhost:3000/mcp 2>&1 | \
            grep -qE 'HTTP/.+ (200|400|405|406)'
      retries: 5
      interval: 10s
      start_period: 90s
    ```
  - **Rationale.** `200` = happy path (server processed the GET as MCP-shaped). `400 / 405 / 406` = Softeria received the request and explicitly rejected the request shape because a streamable-HTTP MCP endpoint expects a protocol-headers POST, not a bare GET — these statuses still prove the server is alive and accepting connections. Timeout / connection-refused / 5xx = fail. This sidesteps `wget --spider`'s default "non-2xx/3xx is failure" behavior by parsing `--server-response` output explicitly. `nc -z localhost 3000` is a cheap process-responsive precondition.
  - **OD-5 resolution.** Spec now commits to status-tolerant probing of `/mcp` rather than requiring a Softeria-provided `/health` endpoint. The earlier "/health preferred, /mcp fallback" pattern is superseded; OD-5 is RESOLVED by this probe shape and the implementation PR no longer needs an empirical "does Softeria expose /health?" check.
  - **Cadence.** `interval: 10s`, `retries: 5`, `start_period: 90s`. **Detection window = retries × interval = 50s** (reconciles REL-003's stated "~50s detection"). `restart: on-failure` with `restart_policy.max_attempts: 5`, `window: 5m` per REL-003.
  - **Honest documentation of conflation:** a slow upstream Graph call CAN cause healthcheck failure after the detection window and trigger a restart of an otherwise-healthy process — this is an accepted phase-1 trade-off. The bounded `max_attempts: 5 / window: 5m` prevents runaway restart cascades. Pure liveness/readiness split would require either a sentinel-file scheme inside the read-only FS (incompatible with SEC-006) or distinct exit codes that Docker cannot route differently — deferred to SPEC-010 if/when its observability track lands; see Cross-Spec Interactions below for the contingency.
  - The `api` service declares `depends_on: [mcp-m365]` with `condition: service_healthy`. Combined with `startup: true` on the `Microsoft365` MCP entry, this guarantees the sidecar is *ready* (not merely up-and-listening) before LibreChat attempts its initial connect.
  - `initTimeout: 150000` is set to absorb cold-start tool registration; it MUST be tightened to ≤30000 ms once measured cold-start is known (see PERF-001).
- **REQ-019: Tool-output flows through existing PII detection.** Output produced by `Microsoft365` tools (mail bodies, calendar invites, SharePoint content, contact details) traverses the same agent message path as any other tool result and is therefore in scope for SPEC-009 PII detection / redaction. This requirement records the expectation that no special-case bypass is introduced; behavior follows the user's configured PII mode (`detect` / `warn`). See Cross-Spec Interactions below for the SPEC-009 performance-budget treatment (PII detection cost is INCLUDED in PERF-002's end-to-end budget).
- **REQ-020: Bearer token contract (JWT invariants).** The `Authorization` header value sent on every outbound MCP call to `mcp-m365` is contractually a Graph access token with the following JWT invariants (validated inside `GraphTokenService` BEFORE header emission; emission MUST throw `InvalidGraphToken` if any invariant fails — surfaces to the agent as `code: "InvalidToken"` per Error Response Schema, distinct from `Unauthenticated` which means "no token at all" / non-Entra session):
  - `aud === "https://graph.microsoft.com"` (audience).
  - `iss` matches `^https://(login\.microsoftonline\.com|sts\.windows\.net)/<tenant-id>/(v2\.0)?$` (tenant-scoped issuer; rejects cross-tenant / multi-tenant tokens).
  - `tid === <Memodo-tenant-id>` (cross-check against the tenant value extracted from `iss`; defense-in-depth against a spoofed `iss` URL containing the Memodo tenant but a different `tid`).
  - `ver === "2.0"` (v2.0 access tokens only; v1.0 rejected).
  - `oid` present (Entra object-id of the user; used as the SEC-004 join key with Graph activity logs).
  - `upn` or `preferred_username` present (for human-readable audit).
  - `appid` (or `azp`) matches the Memodo Entra app registration's client ID (rejects tokens minted by other apps).
  - `nbf ≤ now + clockSkew (60s)` (rejects future-dated tokens; remaining-lifetime ≥60s alone does not guard against `nbf > now`).
  - Remaining lifetime ≥ 60s at the moment of header emission (refresh via PERF-003 if below this threshold).
  - The sidecar itself treats the token as opaque (no local signature validation; only Graph upstream validates the signature).
  - When `GraphTokenService.getGraphApiToken()` returns null (non-Entra session, e.g., local-auth user), the `Authorization` header is OMITTED entirely from the outbound MCP request — an empty `Bearer ` value MUST NOT be sent. This path surfaces as `code: "Unauthenticated"` (not `InvalidToken`).
  - On invariant failure (path producing `InvalidToken`), `GraphTokenService` MUST emit a structured server-side log event `{ event: "graph.token.invariant_failure", invariant: "<aud|iss|tid|ver|oid|upn|appid|nbf|lifetime>", correlationId: "<REQ-023 value>" }` so dashboards can alert on misconfigured Entra apps, cross-tenant token leaks, or token-minting regressions — distinct from the benign `Unauthenticated` path (local-auth user with no Entra session).
  - Graph 401 from upstream surfaces as an MCP tool error per the error response schema (see "Error Response Schema" below).
  - Verification: a unit test in `GraphTokenService` test suite decodes a freshly-minted token (in a controlled test path) and asserts each invariant; a swap to app-only / `.default` daemon flow would fail this test, preserving SEC-004 per-user attribution.
  - This requirement is referenced by REQ-007, REQ-015, REQ-016, and SEC-004.
- **REQ-021: Single-flight OBO exchange with backoff INSIDE the coalesced call.** `GraphTokenService` MUST coalesce concurrent OBO requests for the same `${user.openidId}:${scopes}` cache key into a single in-flight promise (single-flight pattern). On cache miss, additional callers wait on the existing in-flight promise rather than issuing parallel OBO requests against `login.microsoftonline.com`. This prevents the thundering-herd profile on every API restart and on every cache-invalidating event (REQ-009 scope change, token expiry). **Backoff scope:** retry/backoff lives INSIDE the single-flight call — the in-flight promise itself retries with jittered backoff (≤3 attempts, base 200ms, full jitter, capped 1500ms) before rejecting. Concurrent callers ride out the retry as ONE coalesced operation; the upstream Entra-side blast is bounded at ≤3 calls per cache-miss-burst, not ≤3 × K (where K = number of concurrent callers).
  - **Explicit retry classification table (required to remove implementer guesswork):**
    - **RETRY inside single-flight** (≤3 attempts, base 200ms, full jitter, capped 1500ms):
      - HTTP 429 from `login.microsoftonline.com` (with `Retry-After` honored when present)
      - HTTP 500, 502, 503, 504 from `login.microsoftonline.com`
      - Network-level errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`
      - DNS transient failures: `EAI_AGAIN`, `ENOTFOUND` when transient
    - **SURFACE IMMEDIATELY** (no retry; short-circuit out of single-flight):
      - HTTP 400 (bad request — token-exchange config error, not transient)
      - HTTP 401 (likely revoked refresh token; surfaces as REQ-015 missing-token failure)
      - HTTP 403 (consent denied — Entra error codes `AADSTS65001` and similar; surfaces as REQ-016 / `InsufficientScope`)
      - HTTP 404 (app registration deleted — surfaces as a hard configuration error)
      - Malformed-token-from-prior-OBO-call (REQ-020 JWT invariant failure on a previously-cached token)
  - **Unit-test stub (extended):** with upstream stubbed to return 429 twice then 200, K=10 concurrent callers MUST observe exactly ONE successful resolve AND ≤3 total Entra calls (NOT ≤3 × K). Additionally: with upstream stubbed to return 503 twice then 200, K=10 concurrent callers MUST observe exactly ONE successful resolve and ≤3 Entra calls total (asserts 5xx is on the retry side of the classification table, not the surface-immediately side). If single-flight is not yet implemented in `api/server/services/GraphTokenService.js`, this requirement is a blocking dependency for production rollout.
- **REQ-022: Scope cache-key normalization.** The cache key for `GraphTokenService` MUST normalize the scope list before hashing: trim whitespace, lowercase, sort alphabetically, comma-join. This prevents accidental cache misses from non-identical scope-set serializations (different order, casing, whitespace).
- **REQ-023: Correlation-ID propagation for audit reconstruction.** LibreChat sets a `client-request-id` header on each outbound MCP tool call with value `${conversationId}:${messageId}:${toolCallId}`. The sidecar forwards this header (or maps it onto Graph's `client-request-id` header) on every Graph call. The smoke test (Verification Plan §7) issues one tool call and confirms the same correlation ID is present in LibreChat audit logs, `mcp-m365` logs, and a Graph activity-log query.
  - **Privacy constraint (non-blocking, codified):** the correlation-ID MUST NOT be derived from or contain the user's email, UPN, `oid`, display name, or any other user-identifying attribute — purely from internal `conversationId` / `messageId` / `toolCallId` identifiers. This is enforced by construction (the format is fixed at the three internal IDs above) and is reaffirmed here to codify the privacy-specialist iter3 anti-pattern observation.
  - **Acknowledged trade-off (folded into OD-6 governance handoff):** the format `${conversationId}:${messageId}:${toolCallId}` is deterministic and reversible by LibreChat. By design, this leaks internal-identifier *topology* (cardinality, churn, per-user volume) to anyone with Microsoft Graph activity-log access. Accepted because: (a) the IDs are not PII (no email/UPN/oid/display-name embedded — see privacy constraint above), (b) Graph activity-log access is gated by Entra admin role, (c) the debug-UX value of deterministic, human-traceable correlation IDs (a single value joins three log surfaces during incident triage) outweighs the topology-leak risk for the phase-1 MemodoAI surface. **Residual requiring DPO-equivalent sign-off:** OD-6 closure MUST include explicit acknowledgement of this trade-off as a residual; a future phase-2 hardening option is an HMAC-SHA256(server-secret, conversationId:messageId:toolCallId)-truncated-to-16-hex outbound ID with the mapping retained LibreChat-side.
- **REQ-024: Per-user tool-call rate limit with bounded FIFO queue.** LibreChat's MCP layer caps in-flight `Microsoft365` tool calls at 4 concurrent per user and 8 per conversation, whichever is tighter (per-user wins for a single-conversation user; per-conversation wins when multiple users share one conversation). Excess calls enter a FIFO queue with the following bounds (preventing the queue-wait-stacks-on-outer-MCP-timeout anti-pattern):
  - **Queue depth cap:** max 16 queued per user, max 32 per conversation. Beyond the cap, new calls fail-fast with `code: "Throttled"` (no wait), `throttleSource: "librechat_concurrency_cap"`.
  - **Queue-wait timeout:** **14000 ms** (tightened from 30000 ms per the REQ-025 cascading-timeout invariant). On queue-wait timeout, emit `code: "Throttled"` with `retryAfter: 5` and `throttleSource: "librechat_queue"` to the agent BEFORE the outer MCP timeout fires — this guarantees the agent receives the correct error class (`Throttled`, not `UpstreamUnavailable`).
  - **Ordering:** FIFO with explicit cancellation on cap-exceeded; no priority lanes in phase 1.
  - Graph HTTP 429 responses from upstream are surfaced to the agent within the same schema with `code: "Throttled"`, `throttleSource: "graph_429"`, and the `Retry-After` value preserved when present (authoritative; see Error Response Schema for the authority semantics across the three `throttleSource` values).
  - **Phase-1 cross-conversation cap clarification.** Phase-1 LibreChat conversations are single-user; the per-conversation cap (8 in-flight, 32 queued) is informational and not currently exercised — the per-user cap (4 in-flight, 16 queued) is always the tighter binding. The per-conversation cap activates only if/when LibreChat introduces multi-user shared conversations (no current spec models this); it is included in the contract to avoid a future config rev when shared conversations land.
  - **Implementation locus (resolves the ambiguity flagged in the critical review).** The FIFO queue + slot counter + cancellation pump live in a NEW module at `packages/api/src/mcp/queue.ts` as a `MCPCallQueue` class. The class is wired into `MCPManager.callTool` via composition, instantiated once per MCP-server-instance keyed by the server name. The per-server bounds defined here (4 in-flight per user / 8 per conversation, 16/32 queued depths, 14s queue-wait, 5s grace) apply to `Microsoft365` ONLY in phase 1; they are NOT back-ported to other MCP servers (other servers retain their pre-SPEC-014 unbounded behavior). AbortController is wired through the queue and passed as an `AbortSignal` to the streamable-http transport's `fetch` call (used by REQ-025 cancellation). The post-dequeue PERF-003 token freshness re-check lives in the same dequeue path so the freshness check coalesces with the queue's slot release. Unit tests at `packages/api/src/mcp/__tests__/queue.test.ts`; Verification §17 points at this path.
- **REQ-025: Cascading-timeout discipline (additive invariant).** The inner Graph timeout (target: **30000 ms**) MUST fire strictly before LibreChat's outer `timeout: 45000`. This ensures the inner Graph call fails cleanly before the outer MCP timeout fires, preventing socket leaks and retry amplification. **Step 4e change:** LibreChat now enforces the inner bound itself in `MCPCallQueue.runWithOuterTimeout` by setting a 30s timer that aborts the executor's `AbortSignal` with reason `inner_graph_timeout`; the prior "Softeria honors a flag, otherwise insert a thin proxy" escape hatch is no longer required. The outer 45s timer remains as a safety net for executors that ignore abort. The cold-start `initTimeout: 150000` is unrelated to steady-state `timeout` and is separately bounded by REQ-018.
  - **Cascading-timeout invariant (HARD CONSTRAINT — unit-test-pinned):** `queue_wait_max + graph_inner_timeout + mcp_hop_budget < outer_mcp_timeout`. Concrete phase-1 values: `14000 + 30000 + 500 = 44500 < 45000 ✓`. Components: queue-wait-max = 14000 ms (REQ-024), graph-inner-timeout = 30000 ms (this REQ), MCP-hop-budget = ~500 ms (single-hop on the `default` Docker network — measured median per PERF-002), outer-MCP-timeout = 45000 ms (REQ-004). Any change to one component requires re-validating the inequality and the unit test.
  - **Cancellation semantics on outer-MCP-timeout fire:** when the outer MCP `timeout: 45000` fires (a call escaped the queue and is now in-flight against a slow Graph response), LibreChat MUST release the in-flight slot IMMEDIATELY (slot counter decremented; queue head admitted). The underlying Softeria call is cancelled if Softeria honors transport cancellation (AbortController on the streamable-http request). If Softeria does NOT honor cancellation, the slot is forcibly released after `outer_timeout + 5s grace = 50s` and any late response from the original socket is dropped at the LibreChat boundary (response correlation key mismatch). This guarantees the bulkhead-leak failure mode (hung in-flight call holds a slot past outer-timeout) is bounded at 50s, not indefinite.
  - **Unit-test stub (Jest, paired with REL-002 pin):**
    - Assert `queue_wait_max + graph_inner_timeout + mcp_hop_budget < outer_mcp_timeout` with the literal constants imported from the config module (no string-matching).
    - Stall Graph beyond 45s (test fixture: mock upstream that never responds); assert the slot is released BEFORE the original call returns (test polls the slot counter at t=45.1s and t=50.5s and asserts a fresh call can claim a slot at t≥45.1s in the cancellation-honored path, or at t≥50.5s in the grace-fallback path).
- **REQ-026: Sidecar resource limits.** The `mcp-m365` Compose service declares explicit `deploy.resources.limits` (`memory: 256m`, `cpus: '0.5'`) and `deploy.resources.reservations` (`memory: 128m`, `cpus: '0.1'`). This ensures an OOM kills cleanly rather than producing a swap-thrashing zombie, and an unresponsive sidecar (hung event loop, GC pause) is bounded.
- **REQ-027: MCP protocol version pinned and logged with deterministic-failure short-circuit.**
  - **Protocol version policy:** the MCP protocol revision is set by LibreChat's `MCPManager` (sourced from `@librechat/agents`); this spec is pinned to the LibreChat v0.8.4-rc baseline that ships at SPEC-014 finalization. The resolved literal is `"2025-11-25"` (verified 2026-05-19 by running Softeria 0.110.0 locally and observing the `protocolVersion` advertised in its `initialize` response; matches `LATEST_PROTOCOL_VERSION` exported by the installed `@modelcontextprotocol/sdk`). This literal is mirrored across three loci: `MICROSOFT365_EXPECTED_PROTOCOL_VERSION` in `packages/api/src/mcp/MCPManager.ts`, the comment alongside the `Microsoft365` entry in `librechat.yaml`, and `MCP_PROTOCOL_VERSION` in `mcp-m365/VERSION`. Verification §8 asserts the advertised protocol version on first connect matches this literal; CI fails on drift.
  - **Upstream-bump policy:** if MCPManager's `protocolVersion` changes via a `@librechat/agents` (or LibreChat-core MCP-config) upgrade, SPEC-014 MUST be re-evaluated as a versioning event — the pin literal in `librechat.yaml` and `mcp-m365/VERSION` is updated in the SAME PR as the dependency bump, and Verification §8 asserts the new pin before merge. A silent dependency-bump that diverges the advertised version from the pin literal MUST fail CI at the §8 assertion (not at deploy time).
  - **Deterministic-failure classification:** the following sidecar-connect failures are deterministic and MUST short-circuit the REL-002 circuit-breaker retry loop (do not consume the 7-cycle / 45s budget): `ProtocolMismatch` (sidecar advertises a protocol revision the MCPManager does not support), fatal TLS handshake failure, DNS NXDOMAIN on `mcp-m365`, HTTP 501 / 426 on `/mcp`. On any deterministic failure, `MCPManager` emits a single structured error log line (`{ event: "mcp.connect.deterministic_failure", server: "Microsoft365", failure: "<class>", details: "..." }`), surfaces `code: "ProtocolMismatch"` (or `SidecarUnavailable` for non-protocol deterministic failures) per the Error Response Schema, and STOPS reconnect attempts until the next deploy or manual reconnect. Transient failures (TCP RST, transport timeout, HTTP 5xx) follow REL-002 normally.
  - Verification: a regression test pins the classification table alongside REL-002's 7-cycle / 45s pin (Verification §8).
- **REQ-028: `serverInstructions` drift control with version marker.** `serverInstructions` in `librechat.yaml` MUST be updated in the same PR as any change to REQ-008 (scope list) or REQ-010 (`--org-mode` / feature flags). The trailing content-version marker (per UX-002) MUST be bumped on every such change (e.g., `v1 → v2`). The Verification Plan includes a CI step that (a) asserts the version marker line is present, (b) computes a SHA-256 over `serverInstructions` body (excluding the marker comment) and compares against a baseline stored in `mcp-m365/serverinstructions.sha256`, and (c) grep-matches each REQ-008 scope-implied surface name (Outlook, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do, Planner, Contacts, Graph search) appears in the text. Any drift fails CI; intentional updates require bumping both the marker and the baseline checksum in the same PR.
- **REQ-031: `mcp-m365` hostname uniqueness on `caddy_net`.** The Docker `container_name: mcp-m365` and any `hostname:` aliases MUST be unique across all Compose services on the `caddy_net` network. The implementation PR adds a CI assertion: `grep -rn '\bmcp-m365\b' docker-compose*.yml | grep -E 'container_name|hostname|aliases' | sort -u` returns rows that all belong to the `mcp-m365` service definition (no other service may claim that DNS name). This is a compensating control for the bare-hostname allowlist entry in SEC-008 / REQ-005, retained until `isDomainAllowedCore` is extended to scheme+host+port matching. See OD-10.

### Non-Functional Requirements

- **SEC-001: No tokens at rest in the sidecar.** The `mcp-m365` container writes no tokens to disk and stores no tokens in memory beyond a single in-flight request.
- **SEC-002: No new SSRF surface.** The new entry in `mcpSettings.allowedDomains` is restricted to the internal Docker DNS name; no public host is added on behalf of the sidecar. `actions.allowedDomains` is unchanged.
- **SEC-003: Read-only blast radius.** Phase-1 scopes do not permit sending mail, deleting files, creating calendar invites, or modifying SharePoint content. Any tool call attempting a write will fail with Graph 403.
- **SEC-004: Per-user audit reconstruction.** Each Graph call is attributable to a single Entra user via the JWT-bearer OBO exchange. The audit record is structured metadata, NOT conversation body: `(timestamp, user.openidId, tool name, scope, Graph endpoint path template, HTTP status code, correlation-id per REQ-023)` — explicitly excluding request body, response body, query-string filter values, and recipient identifiers. The Graph-side activity log is the authoritative payload-aware record (retained by Microsoft per their retention policy). Reconstruction is `LibreChat audit metadata` ⋈ `Graph activity log` keyed by Entra user and correlation-id. Conversation logs are a separate artifact governed by the retention policy in REQ-029 and are not the audit trail.
- **SEC-005: EU data residency preserved.** No traffic exits the Memodo Entra tenant's region under the Microsoft EU Data Boundary contractual commitment applied to the Memodo Entra tenant (region: EU). The MCP sidecar makes outbound TLS to `graph.microsoft.com` only; this hits the same Microsoft-fronted endpoint as existing OIDC userinfo / overage calls. No additional cross-border transfer is introduced by this spec. The `npm install` of `@softeria/ms-365-mcp-server` at image-build time occurs on EU-based Hetzner hosts and pulls public package metadata from the npm registry (no personal data in transit).
- **SEC-006: Sidecar hardening.** The `mcp-m365` container (a) runs as a non-root user with a read-only root filesystem and `no-new-privileges: true`; (b) constrains outbound network egress to `graph.microsoft.com:443` only via a Docker network policy or an explicit outbound HTTP allowlist (e.g., a thin egress proxy or `iptables` rule applied to the container's network namespace); (c) declares only port 3000 in `EXPOSE`; (d) accepts no inbound traffic from outside the Docker host (REQ-011). Residual replay window if the image is compromised equals the Graph access-token TTL (nominal 1 hour); the detection signal is Graph sign-in logs showing token use from an unexpected IP — operators should subscribe to anomalous-sign-in alerts in Entra.
- **SEC-007: No tokens or payloads in sidecar logs.** The sidecar MUST NOT log request `Authorization` headers, request bodies, response bodies, Graph URL query-string filter values, mail subjects, recipient addresses, file names, or attendee identifiers at any log level shipped to production. Either (a) the upstream `@softeria/ms-365-mcp-server` version pinned per REQ-002 is verified to redact these by default, or (b) the sidecar is run with `--log-level=error` (or equivalent) and is fronted by a log filter that strips `Authorization` and trims URL query strings to path templates. Verification Plan §6 asserts the *absence* of Bearer tokens and payload fragments in `mcp-m365` logs (negative assertion), not their presence.
- **SEC-008: `mcpSettings.allowedDomains` semantic minimization.** REQ-005 retains the bare-hostname entry `mcp-m365` because `isDomainAllowedCore` matches hostname-only today. The implementation MUST verify that the sidecar binds no listener other than port 3000 (REQ-002, REQ-026). If `extractMCPServerDomain` / `isDomainAllowedCore` are ever extended to support scheme+host+port matching, the allowlist entry MUST be tightened to `http://mcp-m365:3000` and this requirement MUST be revisited. This is an explicitly documented inherited weakness, not a deliberate design choice.
- **PERF-001: Cold-start budget.** Cold-start latency for the first MCP call after `mcp-m365` restart is targeted at ≤5 seconds (Softeria server + lazy tool registration). The implementation MUST log cold-start duration on every `MCPManager` connect. **Alert threshold (revised):** fire if cold-start p95 > **2× baseline p95 OR > 10s, whichever is lower** (NOT 80% of `initTimeout`, which at 120s was 24× the 5s target and theatrical). This is consistent with the "≥50% regression vs baseline BLOCKS deploy" rule below. `initTimeout: 150000` is the initial absorbing budget; it MUST be tightened to ≤30000 ms once measured cold-start is confirmed stable across 10 restarts. Measurement plan: scrape `MCPManager` connect logs for the connect-duration line; aggregate p50/p95/p99 over a 7-day rolling window. **Manual measurement cadence (phase 1):** scrape and compute p50/p95/p99 on (a) every Softeria version bump per REQ-002, AND (b) weekly for the first 4 weeks post-rollout. Store the baseline in `mcp-m365/perf-baseline.json` (cold-start p50/p95/p99 + steady-state p50/p95/p99). A regression of >50% on any percentile vs. baseline BLOCKS the next deploy until investigated. **Baseline establishment (chicken-and-egg resolution).** The first 10 cold-starts post-rollout establish the baseline; `mcp-m365/perf-baseline.json` is committed in a follow-up PR after week 1, NOT as part of the initial implementation PR. The implementation PR ships with the baseline file absent; the alert rule (>2× baseline OR >10s) becomes active only once the baseline is committed. Observability automation (replacing manual scrape) is tracked under PRE-RESEARCH-013.
- **PERF-002: Steady-state latency budget (with tail).** Steady-state per-tool latency targets for a single Graph-backed tool call end-to-end (LibreChat → MCP → Graph → MCP → LibreChat): `p50 ≤ 1s, p95 ≤ 3s, p99 ≤ 8s`. The MCP hop alone (LibreChat → mcp-m365 → LibreChat, excluding Graph) targets p95 ≤ 100ms on the same Docker network. Spans measured for these targets: (a) OBO exchange duration (`GraphTokenService.getGraphApiToken()`), (b) MCP hop duration (request-out to response-in at LibreChat), (c) Graph round-trip duration (best-effort from `client-request-id` correlation with Graph activity logs). Measurement plan: scrape LibreChat MCP tool-call logs; compute p50/p95/p99 daily; alert on p95 breach for 3 consecutive days. Observability automation tracked under PRE-RESEARCH-013.
  - **Budget interpretation (explicit per outbound call, NOT per agent turn).** Latency budgets (p50 ≤ 1s / p95 ≤ 3s / p99 ≤ 8s) are measured PER OUTBOUND GRAPH CALL, not per agent turn. **Phase 1 has NO Graph-result cache** at the OBO / MCP layer (the OBO token cache per PERF-003 is the ONLY cache); freshness is preferred over amortized latency. Implication: agent workflows that issue N tool calls per turn (e.g., refine-and-retry pagination loops) incur N × p95 latency in worst case — acceptable for phase 1. A short-lived per-(user, endpoint, params-hash) Graph-result cache is a phase-2 follow-up (see Future Work), gated on telemetry showing repeat-fetch rate > 30% within 60s windows.
- **PERF-003: Token reuse and transparent refresh (re-checked at header emission).** `GraphTokenService` caches the per-user Graph token under `${user.openidId}:${scopes-normalized}` (normalization per REQ-022) so consecutive tool calls within a single conversation reuse a single OBO exchange. Cache TTL follows the Graph access-token nominal lifetime (assumed 1 hour absent conditional-access tightening). **Refresh-trigger point (revised — emission-time, NOT entry-time):** the token-freshness check fires at Bearer header emission — i.e., AFTER dequeue from the REQ-024 queue and BEFORE the `Authorization` header is set on the outbound MCP call. If remaining TTL < 60s at emission time, `GraphTokenService` triggers a refresh (re-entering REQ-021 single-flight) before returning the header value. This eliminates the cross-budget race in which a call entering at TTL=5min01s passes an entry-time check, waits 14s in the queue, then incurs a 30s Graph round-trip — token expires mid-Graph-call and surfaces as a spurious Graph 401. **Cost:** every dequeue re-reads the cache (cheap — mostly hits since the cache is in-process; refresh path is rare and coalesced via REQ-021). The MCP sidecar receives a fresh Bearer header on the next call; long-running conversations need no bespoke refresh logic on the MCP side. Concurrent OBO requests for the same cache key are coalesced per REQ-021. **Verification:** a long-tail queued call with token expiring mid-queue is refreshed at emission and surfaces as success, NOT as a Graph 401 (Verification §17 extended).
- **PERF-004: MCP tool-list registration cost.** The implementation MUST measure and document (a) the size of the MCP tool-list response payload returned on first connect, (b) tool-list registration latency, and (c) the prompt-token cost of injecting the resulting tool schemas into the model context per conversation. Targets to verify at first deploy: tool-list payload < 200KB; registration latency < 2s; tool-schema prompt-token cost < 10K tokens. **On breach of any target:** rollout is BLOCKED until either (a) the Softeria server is reconfigured (subset flag if available; otherwise a thin proxy fronting the sidecar that filters the `tools/list` response to the phase-1 surface allowlist: Mail, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do, Planner, Contacts, Graph search, profile), OR (b) the same stakeholder who closes OD-6 (Memodo information-governance / sponsor) explicitly accepts the elevated cost in writing in this spec's revision history. Measurement cadence: re-measure on every Softeria version bump (REQ-002) and at deploy time.
  - **Recurrence-aware CI check (recurring cost, not one-time gate):** because the tool-list preamble is paid PER CONVERSATION (N conversations × M turns), a Softeria minor bump that silently grows the tool-count or schema verbosity is a recurring inference-cost regression. Add a CI check (or doc'd manual step) that diffs the tool-list payload size + tool-count on every PR that bumps `mcp-m365/VERSION` and fails the check if either grows >10% without an accompanying acknowledgement in the PR description. Optionally express the prompt-token target as a per-conversation budget × expected-conversations-per-day to make ongoing inference cost legible to product (e.g., 10K tokens × 1000 conv/day = 10M prompt tokens/day attributable to the M365 tool preamble alone).
- **OPS-001: Single-command lifecycle.** `./prod.sh up -d mcp-m365`, `./prod.sh restart mcp-m365`, `./prod.sh logs -f mcp-m365`, `./prod.sh down mcp-m365` all work without additional flags.
- **OPS-002: Logs to stdout/stderr.** The sidecar's logs are accessible via `docker compose logs` without any volume mounts. Log content discipline is governed by SEC-007 (no tokens, no payloads).
- **OPS-003: Idempotent redeploy.** Re-running the deploy sequence (`git pull && ./prod.sh build mcp-m365 && ./prod.sh up -d mcp-m365 && ./prod.sh restart api`) is safe to repeat with no manual cleanup.
- **OPS-004: Ordered restart for full-stack redeploy.** When restarting both services, restart `mcp-m365` FIRST, wait for the healthcheck to pass (per REQ-018), then restart `api`. Avoid bare `./prod.sh restart` (without an explicit service name) during business hours — this restarts both services simultaneously and triggers the post-restart OBO cold-start (mitigated but not eliminated by REQ-021 single-flight).
- **REL-001: Upstream Graph degradation behavior with idempotency contract.** When `graph.microsoft.com` returns 5xx or times out, the failure surfaces to the agent as a single tool error per the error response schema within `timeout: 45000` ms. LibreChat MUST NOT retry beyond the framework's built-in MCP reconnect circuit breaker (REL-002). Agents receive a single, intelligible error rather than N retries × M users × K tools amplification. **Idempotency:** phase-1 Microsoft365 tool calls are safe to retry on `UpstreamUnavailable` / `Throttled` by virtue of read-only Graph scopes (SEC-003) — no side effects on Graph. Phase-2 write tools MUST adopt a `client-request-id`-derived idempotency key (REQ-023 already propagates a unique ID per tool call) BEFORE any retry path engages on writes; absent that, the REL-002 retry on a write tool would risk double-send. This requirement freezes the contract at phase 1.
- **REL-002: MCP reconnect circuit breaker (named contract, file:line pinned).** LibreChat's existing reconnect / circuit-breaker behavior governs `Microsoft365` server reconnection. The values are NOT in `@librechat/agents` (initial assumption was wrong); they live in **`packages/api/src/mcp/mcpConfig.ts:7-29`** as `mcpConfig` constants, env-overridable:
  - `CB_MAX_CYCLES: 7` (max connect/disconnect cycles before circuit breaker trips) — `mcpConfig.ts:16`.
  - `CB_CYCLE_WINDOW_MS: 45_000` (sliding window for counting cycles, in ms) — `mcpConfig.ts:18`.
  - `CB_CYCLE_COOLDOWN_MS: 15_000` (cooldown after the cycle breaker trips) — `mcpConfig.ts:20`.
  - `CB_MAX_FAILED_ROUNDS: 3`, `CB_FAILED_WINDOW_MS: 120_000`, `CB_BASE_BACKOFF_MS: 30_000`, `CB_MAX_BACKOFF_MS: 300_000` — `mcpConfig.ts:22-28` (the exponential-backoff path used after failed-rounds threshold is reached; capped at 300s).
  - Consumer: `packages/api/src/mcp/connection.ts:289-365` (`MCPConnection.circuitBreakers` static map; circuit-breaker state per server name).
  - **Pinned values for the SPEC-014 RFC-001 budget calculation:** the named "7 cycles / 45s window / exponential backoff" matches `CB_MAX_CYCLES=7` and `CB_CYCLE_WINDOW_MS=45_000`. The exponential backoff is governed by `CB_BASE_BACKOFF_MS=30_000` and `CB_MAX_BACKOFF_MS=300_000` (NOT the simpler "exponential backoff" handwave of prior spec text — this is the precise contract).
  - **Regression test (Jest, verbatim):** `import { mcpConfig } from '~/mcp/mcpConfig'; expect(mcpConfig.CB_MAX_CYCLES).toBe(7); expect(mcpConfig.CB_CYCLE_WINDOW_MS).toBe(45_000); expect(mcpConfig.CB_CYCLE_COOLDOWN_MS).toBe(15_000); expect(mcpConfig.CB_MAX_FAILED_ROUNDS).toBe(3); expect(mcpConfig.CB_BASE_BACKOFF_MS).toBe(30_000); expect(mcpConfig.CB_MAX_BACKOFF_MS).toBe(300_000);` — fails CI if any default is tuned upstream without a corresponding SPEC-014 amendment. If values change, REQ-027's deterministic-failure short-circuit budget MUST be re-computed.
  - Changes to these defaults in LibreChat core MCP config MUST be reviewed against this spec; the regression test above is the surfaced mechanism.
- **REL-003: Hung-but-up failure mode and bounded restart policy.** A sidecar with a wedged process (event loop blocked, port unbound) — OR a sidecar that is process-responsive but cannot serve MCP after the readiness window — is detected by the single combined healthcheck (REQ-018, `interval: 10s`, `retries: 5` → **detection window = 5 × 10s = 50s**) and Docker triggers a restart. Restart policy is `restart: on-failure` with `deploy.restart_policy.max_attempts: 5` and `window: 5m` (NOT `unless-stopped`); after 5 failed restart attempts within the 5-minute window, the container enters `dead` state and `Microsoft365` tools surface `SidecarUnavailable` per the Error Response Schema. This prevents an uncapped restart cascade in pathological boot-failure scenarios (e.g., DNS regression, image regression). **Honest documentation (per REQ-018 update):** because the healthcheck is a single combined probe (Compose limitation; pure liveness/readiness split deferred to SPEC-010), a slow upstream Graph call CAN trigger a restart of an otherwise-healthy sidecar after the 50s detection window. This is an accepted phase-1 trade-off; the bounded `max_attempts: 5 / window: 5m` policy caps the blast radius. In-flight tool calls during the hung window fail with the configured `timeout: 45000` and surface to the agent per the error response schema. The healthcheck `start_period: 90s` covers legitimate cold-start without false-positive restart loops.
- **UX-001: Discoverable tool group with MCPManager-enforced server-scoped namespacing.** In the agent builder, the M365 tools appear under a group label of `Microsoft365` (matching the YAML key), so users can enable/disable them per agent. **Tool-name namespacing is ENFORCED by `MCPManager`** via the `Constants.mcp_delimiter` (`packages/data-provider/src/config.ts:1888` — value `_mcp_`): every Softeria-emitted tool name is suffixed at the LibreChat boundary as `<original-tool-name>_mcp_Microsoft365`, so collision with a future MCP server (e.g., a hypothetical Slack MCP emitting a bare `search` tool) is structurally impossible at the agent-prompt level (see `packages/api/src/mcp/auth.ts:37-39` for the delimiter-based server attribution path). The de-facto namespace is therefore the `_mcp_<server>` suffix scheme, NOT a `Microsoft365_` prefix (correcting an earlier wording). Phase-1 acceptance; no additional prefix-mangling needed. Phase-2 follow-up only if a colliding MCP server is introduced that bypasses `MCPManager` tool-name suffixing (no known scenario at phase-1).
- **UX-002: Plain-language `serverInstructions` with prompt-injection-resistant guardrails and content-version marker.** The `serverInstructions` string in `librechat.yaml` names the M365 surfaces in human terms; the LLM sees this when choosing whether to invoke a tool. `serverInstructions` MUST:
  - Direct the model to request only the fields needed for the user's intent (e.g., subject + sender for triage, not full body) — data minimization per Privacy & Compliance Scope.
  - Include a non-enumeration directive: "Do NOT search SharePoint, OneDrive, or Mail without a user-named target (site, folder, sender, keyword, date range). If the user asks an open-ended question, ask a clarifying question first; do not enumerate to find candidates." This is a compensating control for the tenant-wide read scopes `Files.Read.All` / `Sites.Read.All` (REQ-008) against agent-driven exfiltration via prompt injection.
  - Carry a content-version marker as the trailing line: `# v1 (2026-05) — co-versioned with REQ-008 scope set; bump on any scope-set or directive change.` The REQ-028 CI step asserts the version marker is present AND the marker version matches the expected version for the current REQ-008 scope set.
- **UX-003: Transparency for new personal-data categories (GDPR Art. 13/14).** The Memodo privacy notice and/or first-use modal MUST list the new M365 data categories accessible to agents (mail bodies, calendar attendees, contact PII, SharePoint files, OneDrive files, tasks, notes, profile) in plain language at the point an agent is first granted `Microsoft365` tools — not buried in the technical Entra consent screen (which lists Graph scopes like `Files.Read.All` and is insufficient for Art. 13/14 transparency). The privacy-notice location and update PR is tracked under the Information Governance subsection below.

### Error Response Schema

All Microsoft365 tool failures surface to the agent as MCP `tools/call` results with `isError: true` carried as a SIBLING of `content` (per MCP protocol). The structured fields are stringified JSON inside `content[0].text` so the result parses identically across MCP client SDK versions. The on-wire shape is:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"schemaVersion\":1,\"code\":\"<error-code>\",\"message\":\"<human-readable summary>\",\"graphCode\":\"<Graph error code, if applicable>\",\"graphMessage\":\"<Graph error message, if applicable>\",\"correlationId\":\"<value of client-request-id per REQ-023>\",\"retryAfter\":<integer seconds, present only for code='Throttled'>,\"throttleSource\":\"<graph_429 | librechat_queue | librechat_concurrency_cap; present only for code='Throttled'>\"}"
    }
  ]
}
```

Verification (added to Verification §8) asserts the on-wire shape: `isError` is a sibling of `content`, `content[0].type === "text"`, and `JSON.parse(content[0].text)` yields the canonical fields including `schemaVersion`. Implementations MUST NOT place `code`/`message` at the top level alongside `isError` (that was the iter1 shape and is now superseded).

**Envelope versioning (`schemaVersion`).** `schemaVersion: 1` is the FIRST field of the JSON blob. `schemaVersion` increments only when fields are REMOVED or semantics CHANGE; new optional fields (e.g., `throttleSource` added in this revision, future `InvalidToken`-related metadata) are additive and do NOT bump the version. Consumers MUST ignore unknown fields.

**`code` is an OPEN enum.** New values MAY be added in any minor spec amendment; consumers MUST treat unknown values as a generic non-retriable error and surface the `message` field. The eight canonical values below are STABLE in their retry semantics, and any change to these semantics is a breaking change requiring a spec amendment:
- `Throttled` → retry with `retryAfter` (authoritative only when `throttleSource === "graph_429"`; otherwise `retryAfter` is a hint).
- `UpstreamUnavailable` → bounded retry per REL-002.
- `Unauthenticated`, `InvalidToken`, `InsufficientScope`, `WriteForbidden`, `ProtocolMismatch`, `SidecarUnavailable` → NO automatic retry.

Verification §8 asserts that the eight canonical values' retry classification matches the table above.

`code` values (canonical):
- `Unauthenticated` — NO TOKEN AT ALL: no valid Entra session / token resolver returned null (REQ-015). The `Authorization` header was OMITTED; the sidecar returned 401 or the upstream call short-circuited at LibreChat. Benign — expected for local-auth users; UX hides M365 tools.
- `InvalidToken` — TOKEN EXISTS BUT INVALID: a REQ-020 JWT-invariant failure (wrong `aud`, wrong `iss`, wrong `tid`, expired-ish, wrong `appid`, `nbf > now+skew`, `ver !== 2.0`). Distinct from `Unauthenticated` because it signals a misconfigured Entra app, a cross-tenant token leak, or a token-minting regression — exactly the case where ops want a loud signal. REQ-020 mandates a structured server-side log event `{ event: "graph.token.invariant_failure", invariant: "..." }` on this path.
- `InsufficientScope` — Graph returned 403 with `code: Authorization_RequestDenied` (REQ-016, missing scope at consent time).
- `WriteForbidden` — Graph returned 403 on a write attempt in phase 1 (REQ-016 + SEC-003).
- `Throttled` — Graph returned 429 OR LibreChat's per-user/conversation rate limit triggered (REQ-024). `retryAfter` carries Graph's `Retry-After` value when present. `throttleSource` distinguishes the origin: `"graph_429"` (upstream-originated; `graphCode`/`graphMessage` populated; `retryAfter` authoritative), `"librechat_queue"` (REQ-024 queue-wait-timeout fired; `retryAfter` is a hint), `"librechat_concurrency_cap"` (REQ-024 in-flight cap hit; `retryAfter` is a hint).
- `UpstreamUnavailable` — Graph 5xx or timeout (REL-001).
- `SidecarUnavailable` — `mcp-m365` connection failed (transport error, circuit breaker tripped per REL-002 file:line pin, healthcheck failing per REL-003).
- `ProtocolMismatch` — sidecar advertises an MCP protocol version unsupported by `MCPManager` (REQ-027).

REQ-015, REQ-016, REQ-019 (PII detection is skipped on error bodies — `isError: true` is the signal), REQ-020, REQ-024, SEC-004, REL-001, REL-002 all reference this schema. Graph's verbatim `code` and `message` are preserved in `graphCode` / `graphMessage` for forensic clarity; the LibreChat `code` is the stable contract for the agent loop.

### Privacy & Compliance Scope (Information Governance)

This subsection is bounded to the **technical controls** that SPEC-014 owns. Organizational and contractual GDPR concerns (sub-processor disclosures in the corporate DPA, joint-controller designation language, DPA amendments, DSR runbooks, retention-policy ratification) are explicitly OUT of scope for this spec and are tracked under the Memodo information-governance program (DPO-equivalent stakeholder). This spec names them so they are not silently lost.

**In scope for SPEC-014 (technical controls)**
- **Data minimization at the tool boundary (Art. 5(1)(c)).** UX-002 — the model is directed via `serverInstructions` to request only fields it needs and to avoid open-ended enumeration; where Graph supports `$select`, tool wrappers apply projection. Implementation PR MUST record, for each phase-1 Softeria tool, whether `$select` is honored end-to-end and what the default response shape is — recorded in `mcp-m365/tool-projection.md`. Tools that do not honor `$select` are flagged as known over-fetch and accepted explicitly under OD-6 (rather than implicitly via SEC-007/REQ-029). Known limitation: Softeria's tool shapes may return full Graph object bodies by default; documented over-fetch is offset by SEC-007 (no payload logging) and the conversation-retention policy (REQ-029).
- **Log content discipline (Art. 5(1)(f) integrity & confidentiality).** SEC-007 — no auth headers, no payload bodies, no query-string filter values, no recipient identifiers, no mail subjects, no attendee identifiers, no file names in sidecar logs. Verification §6 asserts absence.
- **Sub-processor / software-supplier disclosure (Art. 28 technical hook).** Softeria is a *software supplier*, not a hosted sub-processor in phase 1; the image is self-hosted on Memodo Hetzner infrastructure and the package name (`@softeria/ms-365-mcp-server`) + pinned version (per REQ-002) are recorded in `mcp-m365/VERSION` and the RoPA / vendor inventory. Any future move to a Softeria-hosted SaaS endpoint requires a new spec and a DPA amendment (out of scope here).
- **Conversation retention default (Art. 5(1)(e) storage limitation) — REQ-029.** Tool output ingested into a LibreChat conversation inherits the conversation-level retention policy: conversations older than 12 months are purged unless pinned by the user. Tool output is NOT separately cached outside the conversation record (no separate `tool_output` collection). The retention timer is enforced by the existing LibreChat retention mechanism; if that mechanism does not yet exist in this LibreChat fork, REQ-029 is a blocking dependency tracked under the Memodo information-governance program and SPEC-014 MUST NOT roll out to production until either the timer exists or the DPO-equivalent explicitly accepts the indefinite-retention residual risk in writing.
- **DSR (Art. 15 access, Art. 17 erasure) technical handoff — REQ-030.** When a DSR targets ingested M365 content in a user's LibreChat conversations, the existing LibreChat conversation-deletion path is the technical mechanism (tool output lives in `messages` only, per REQ-029). If the user is also covered by SPEC-008 admin-reporting aggregates, those aggregates may need re-aggregation post-erasure. SPEC-014 commits that tool output is not stored outside the conversation document so a single conversation-delete cascades correctly. The DSR runbook itself (who-receives-requests, SLAs, identity verification) is the DPO-equivalent's artifact and is out of scope here.

**Out of scope for SPEC-014 (tracked elsewhere)**
- DPA negotiation with customers (joint-controller / processor role determination under GDPR Art. 26/28) — tracked under the Memodo information-governance program. SPEC-014 surfaces the determination as a precondition for production rollout (see OD-6 below) but does not author the contract.
- Sub-processor registration in the corporate DPA — same.
- Retention-policy ratification across the broader LibreChat data model (embeddings, audit logs) — tracked under the LibreChat retention initiative.
- Customer-facing privacy-notice rewrite — UX-003 names this as a hand-off; the actual notice text is owned by the privacy notice owner.
- Authoring the DSR runbook for the Memodo organization — DPO-equivalent stakeholder.

**Functional requirements added under this subsection**
- **REQ-029: Conversation-inherited retention for tool output.** M365 tool output is stored in the conversation `messages` collection only (no separate cache, no separate index outside the embedding store SPEC-008 may build). Conversations older than 12 months are purged unless pinned. The retention timer is enforced by the existing LibreChat retention mechanism (location: TBD by implementation PR; if absent, see Open Decision OD-6).
- **REQ-030: DSR technical handoff.** Erasure / access of ingested M365 content in a user's conversations follows the existing LibreChat conversation-erasure path; tool output cascades correctly because it lives only in conversation `messages`. Aggregates derived from M365 content (SPEC-008 admin reporting) MUST be re-aggregated after an erasure.

## Modules

This feature delivers three module boundaries. Even though most of the work is configuration and image plumbing, each boundary has a small public interface that hides substantive complexity behind it.

### MODULE-001: `mcp-m365` sidecar (Softeria server, external process)

**Public Interface**
- `POST http://mcp-m365:3000/mcp` — streamable-http MCP endpoint; consumes `Authorization: Bearer <graph-token>` per request; returns MCP tool-call responses.
- Optional `GET /health` — liveness probe (smoke-test contract per OD-5; fallback to `/mcp` non-5xx).
- Container lifecycle: `./prod.sh {build|up|restart|logs|down} mcp-m365`.

**Hides**
- The 70+ Softeria Graph tool implementations (Mail, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do, Planner, Contacts, Graph search) — LibreChat sees a single MCP server, not 10 service-specific clients.
- Softeria's internal request-to-Graph proxying, lazy tool registration, and `--toon` token-output normalization.
- The fact that no OAuth client, no token cache, and no secrets live in this container (REQ-003 / SEC-001) — the interface looks like a generic streamable-http MCP server, but the contract is BYOT-only.
- Image-build details (`node:22-alpine` base, npm install of `@softeria/ms-365-mcp-server`, pinning workflow per OD-1).

**Risk** — medium. The sidecar handles user-scoped tokens in flight (not at rest) and proxies to Graph. Phase-1 scopes are read-only (SEC-003), so any compromise is bounded to read access; failures surface as clean tool errors per REQ-015/016, not 500s. Risk is "medium" rather than "low" because this is the only LibreChat-adjacent process touching every user's Graph data, even transiently.

**Spec refs** — REQ-001, REQ-002, REQ-003, REQ-006, REQ-010, REQ-011, REQ-012, REQ-013, REQ-018, REQ-025, REQ-026, REQ-027, SEC-001, SEC-003, SEC-005, SEC-006, SEC-007, SEC-008, PERF-001, PERF-002, PERF-004, OPS-001, OPS-002, OPS-003, OPS-004, REL-003, OD-1, OD-5.

### MODULE-002: LibreChat MCP integration surface (`librechat.yaml` + BYOT plumbing)

**Public Interface**
- `mcpServers.Microsoft365` entry in `librechat.yaml` (type, url, timeouts, `startup: true`, `headers.Authorization`, `serverInstructions`).
- `mcpSettings.allowedDomains` entry — bare hostname `mcp-m365` (per resolved OD-2).
- Implicit: the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder contract already exposed by `resolveGraphTokenPlaceholder()` / `processMCPEnv()` / `MCPManager`.

**Hides (newly introduced by this spec)**
- The binding of the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder to the `Microsoft365` server's `Authorization` header (REQ-004, REQ-020).
- The bare-hostname allowlist semantic for `mcp-m365` (SEC-008 / resolved OD-2) and its dependency on `isDomainAllowedCore`'s hostname-only matching.
- The surfacing of the `Microsoft365` tool group plus `serverInstructions` text into the agent builder and the model prompt (UX-001, UX-002).
- The wiring of tool output through SPEC-009 PII detection (REQ-019), including the contract that error bodies (`isError: true`) bypass PII detection per the Error Response Schema.

**Depends on (existing, unchanged)**
- `MCPManager` streamable-http connector setup, server-scoped tool-name namespacing via `Constants.mcp_delimiter` (per UX-001), and circuit-breaker reconnection (named in REL-002 with file:line pin at `packages/api/src/mcp/mcpConfig.ts:7-29` and `packages/api/src/mcp/connection.ts:289-365`).
- `processMCPEnv()` and `resolveGraphTokenPlaceholder()` async preprocessing pipeline that swaps the placeholder for a freshly minted Graph token before each connect (`packages/api/src/utils/graph.ts:103`, `packages/api/src/utils/env.ts:276-399`, `api/server/services/MCP.js:651`).
- `isMCPDomainAllowed` / `extractMCPServerDomain` enforcement path (`packages/api/src/auth/domain.ts:451,480`).

**Depends on (modified by this spec)**
- `GraphTokenService` (`api/server/services/GraphTokenService.js`) — REQ-020 JWT-invariant validation, REQ-021 single-flight + jittered-backoff coalescing, REQ-022 scope cache-key normalization, and PERF-003 emission-time refresh-trigger logic introduce NEW code inside this service. NOT strictly "unchanged"; existing OBO exchange path is preserved but the surrounding control-flow gains the four invariants above.

**Risk** — medium. Although the module is config-shaped, it owns the only path that turns delegated Graph data into agent tool output (REQ-019) and the only enforcement of the new MCP target hostname (SEC-002, SEC-008); a silent regression in the placeholder-to-Bearer binding, the allowedDomains entry, or the PII passthrough bypasses every downstream guard. The "low" tier originally assigned under-allocated downstream review depth and was corrected during the iteration-1 fix pass. **Post-iter3 surface re-narrative:** the module now owns 10+ REQs after the iter3 reshuffles (REQ-020 JWT invariants, REQ-021 single-flight + jittered backoff, REQ-022 cache-key normalization, REQ-024 FIFO queue + the new `MCPCallQueue` module, REQ-025 cancellation + cascading-timeout invariant, REQ-027 protocol-version pin + deterministic-failure short-circuit, REQ-028 `serverInstructions` drift control, REQ-029 retention, REQ-030 DSR, REQ-031 hostname uniqueness, plus REQ-004/005/007/014/015/016/019/023). The module MODIFIES `GraphTokenService` (four new invariants/code paths) AND CREATES the new `MCPCallQueue` module at `packages/api/src/mcp/queue.ts`. Risk tier remains "medium" on consequence-of-failure (read-only blast radius per SEC-003, contained restart recovery per REL-003), but reviewer attention SHOULD scale with the surface count — every REQ added here merits review depth proportional to its tail-latency and security implications, particularly REQ-020 (JWT-invariant emission gating), REQ-024 (the new queue class is a control-plane component, not a config tweak), and REQ-025 (cancellation correctness on outer-MCP-timeout fire).

**Spec refs** — REQ-004, REQ-005, REQ-007, REQ-014, REQ-015, REQ-016, REQ-019, REQ-020, REQ-021, REQ-023, REQ-024, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, OPS-004, SEC-002, SEC-004, SEC-007, SEC-008, PERF-003, REL-001, REL-002, REL-003, UX-001, UX-002, UX-003, OD-2, OD-3, OD-7, OD-9, OD-10.

### MODULE-003: Entra app registration & OBO scope configuration

**Public Interface**
- Memodo Entra app registration: delegated Graph permissions list (admin-consented).
- `.env.prod` value `OPENID_GRAPH_SCOPES=<comma-separated phase-1 scopes>`; documented default in `.env.example`.

**Hides**
- The Azure portal consent flow and the per-tenant admin-consent gate.
- The mapping from delegated permission names (e.g., `Files.Read.All`) to the Graph endpoints they unlock.
- OBO scope-set cache-key implications inside `GraphTokenService` (cache key is `${user.openidId}:${scopes}`, so the scope string is part of the cache contract; changing it invalidates cached tokens).
- The phase-1 vs phase-2 boundary (no write scopes, no `--org-mode`-only scopes) and its soak-period gating (OD-4).

**Risk** — medium. Scope changes are the single most likely source of user-visible regressions: a missing scope produces a Graph 403 on every affected tool call (REQ-016), a stale `OPENID_GRAPH_SCOPES` invalidates the per-user token cache, and admin consent is a tenant-level decision that cannot be reverted via code. Risk is mitigated by read-only-only scopes in phase 1.

**Spec refs** — REQ-008, REQ-009, REQ-022, PERF-003, OD-4, OD-6, OD-8.

> **Note on REQ-017** (SharePoint file picker untouched). REQ-017 is an explicit cross-module non-goal — it bounds the scope of every module above. It is intentionally not owned by any module: this spec does not modify the picker, and the picker is tracked separately. Listed here for completeness so a future reader does not mistake it for an orphan requirement.

## Cross-Spec Interactions

These additive lines fix gaps the iter3 panel flagged around how SPEC-014 interacts with adjacent specs without owning their internals.

- **SPEC-009 (PII Detection) — REQ-019 budget interaction.** SPEC-009 PII detection cost is INCLUDED in PERF-002's end-to-end p50/p95/p99 budget; if SPEC-009 adds >500ms p95 to the tool-result message path, PERF-002 budgets are re-evaluated in a follow-up. The SPEC-009 modes covered by REQ-019 are `detect` and `warn` only (per the current project state — verified in project memory `project_pii_detection`); a future blocking mode would require a new error envelope code (`PIIBlocked`) which is OUT OF SCOPE for this spec and would warrant a spec amendment with retry-classification language matching the other seven canonical codes.
- **SPEC-008 (Admin Reporting Dashboard) — REQ-030 DSR cascade scope.** Phase-1 SPEC-008 aggregates do NOT include M365-content-derived fields (SPEC-008 aggregates are conversation-level metrics). REQ-030's "re-aggregate after erasure" promise is therefore vacuously true for phase 1. If a future SPEC-008 amendment adds M365-content-derived aggregates, THAT amendment owns the re-aggregation hook; SPEC-014 does not pre-commit to its shape.
- **SPEC-010 (Production Readiness) — REQ-018 liveness/readiness split deferral.** REQ-018's deferred Prometheus-based pure-liveness probe is contingent on SPEC-010 (Phase 3 monitoring track) shipping. If SPEC-010 has not landed at SPEC-014 deploy time, the status-tolerant Compose healthcheck per REQ-018 is the sole signal and REL-003 documents the trade-off explicitly. SPEC-014 does NOT block on SPEC-010 — the deferral is non-blocking by design.
- **SPEC-012 (Post-Merge E2E Tests) — no automated MCP coverage in phase 1.** SPEC-014 does NOT add automated e2e coverage for `Microsoft365` tool calls; the PII canary test in Verification §11 is a manual dev smoke (CI lacks Entra-test-user credentials, see §11 infrastructure subsection). If SPEC-012 e2e expands to include MCP-server tool calls, a follow-up spec amendment owns the integration — current SPEC-014 acceptance does not require an e2e signal beyond the manual smoke.

## Out of Scope (Explicit Non-Goals)

- **Phase-2 features (deferred):**
  - Write scopes (`Mail.ReadWrite`, `Calendars.ReadWrite`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Tasks.ReadWrite`, `Notes.ReadWrite.All`)
  - `--org-mode` flag (Teams channel posting, team/member management)
  - Teams/Chat read, Presence, Attendance Reports, Transcripts/Recordings, Virtual Events, User Management, Shared Mailboxes — all gated on `--org-mode` per REQ-010 and deferred to phase 2 alongside the coordinated `--org-mode` decision (REQ-010 deferral note)
  - Microsoft Agent 365 / Work IQ servers (require M365 Copilot licensing)
  - General OBO token exchange beyond Graph (LibreChat issue #11867)
- **SharePoint file picker enablement** — tracked separately; shares OBO machinery but is a UI feature, not an MCP tool.
- **Teams-native LibreChat surface** (a bot in Teams that proxies to LibreChat) — requires a separate Teams app and is not solvable from this stack.
- **Custom UI for per-user M365 consent management** — relies on the standard Entra consent prompt at sign-in.
- **Image publication to an external registry** — phase 1 builds locally on each host; GHCR / ACR publication is a phase-2 operational improvement.

## Open Decisions

The following are not blockers for drafting but must be settled before implementation begins:

- **OD-1 (RESOLVED — release gate; unified pin policy):** Three things ship pinned-and-gated before first prod deploy, not after:
  1. **Softeria package:** concrete semver + resolved tarball SHA-256 integrity hash recorded as a Dockerfile comment AND in the committed `mcp-m365/VERSION` artifact (REQ-002). The Dockerfile MUST cryptographically verify the tarball at build time via `npm pack` + `sha256sum -c` against the recorded SHA-256 and FAIL the build on mismatch (per the REQ-002 build-time tarball-integrity verification subsection). The recorded hash is no longer documentation-only; the build aborts if the resolved tarball does not match.
  2. **`node:22-alpine` base image:** pinned by digest (`FROM node:22-alpine@sha256:<digest>`) — same release-gate language as the Softeria pin. The implementation PR re-resolves the digest at PR time (the 2026-05-18 reference value is in REQ-002); a stale digest is acceptable only if re-resolution shows it still matches the current tag. Without this, REQ-002's release-gate posture for the Softeria pin is bypassable via a silent base-image swap on rebuild.
  3. **MCP protocolVersion literal (REQ-027 / OD-9):** the implementation PR fills the `protocolVersion` literal (e.g., `"2025-06-18"`) into `librechat.yaml` comment + `mcp-m365/VERSION`, gated by Verification §8.
  No merge of the implementation PR until all three are present. This is the "everything that affects wire behavior must be pinned and gated" Pin Policy paragraph requested by the cross-domain finding (security + api-contract iter3 convergence).
- **OD-2 (resolved 2026-05-18):** `mcpSettings.allowedDomains` takes a single bare-hostname entry `mcp-m365`. `extractMCPServerDomain` returns the URL origin and `isDomainAllowedCore` matches hostname-only allowlist entries — no protocol/port qualifier required. This is an inherited weakness from `isDomainAllowedCore`, documented in SEC-008; tighten if `isDomainAllowedCore` is ever extended.
- **OD-3: Agent-default-tools opt-in.** Decide whether `Microsoft365` is opt-in per agent (recommended) or visible to all agents by default.
- **OD-4: Phase-2 timing.** Define a soak period (proposed: 2 weeks of phase-1 in production) before considering write scopes or `--org-mode`.
- **OD-5 (RESOLVED 2026-05-18):** Sidecar healthcheck commits to a status-tolerant probe of `/mcp` that accepts HTTP `200|400|405|406` as proof-of-life — see REQ-018 for the full `CMD-SHELL` form. The probe parses `wget --server-response` output explicitly so that the streamable-HTTP MCP endpoint's natural rejection of a bare GET (a 400/405/406 response) is recognized as "server alive, just expecting a protocol POST", not as failure. This removes the prior empirical "does Softeria expose /health?" check; no Softeria-side `/health` endpoint is required.
- **OD-6 (NEW — blocking for production rollout, governance handoff):** Information-governance preconditions for production rollout — joint-controller / processor role determination (Art. 26/28), sub-processor registration of Softeria as a software supplier in the corporate DPA, customer privacy-notice update per UX-003, and (if the existing LibreChat retention timer per REQ-029 is absent) an explicit DPO-equivalent acceptance of the indefinite-retention residual risk in writing. **Additionally:** SEC-006 egress restriction (constrain outbound to `graph.microsoft.com:443`) is promoted to a release gate — the implementation PR MUST ship at least one concrete egress mechanism (egress proxy container OR `iptables` OUTPUT rule on the container's netns OR Docker user-defined network with no default route + explicit graph.microsoft.com route). The "documented residual risk" fallback in Implementation Plan Step 2 is REMOVED. SPEC-014 surfaces these as preconditions; the DPO-equivalent / Memodo information-governance program owns closure. Production rollout of `Microsoft365` MUST NOT proceed until OD-6 is closed.
  - **Closure requires (enforcement mechanism):**
    1. **DPO-equivalent written acknowledgement** committed at `SDD/governance/OD-6-closure-YYYY-NN.md` (year + sequence-in-year), listing all five preconditions explicitly closed — each with the DPO-equivalent stakeholder name + date + reference to the supporting artifact (DPA amendment, sub-processor registry entry, privacy-notice PR, retention-timer landing PR or written residual-risk acceptance, chosen egress mechanism + verifying smoke-test output).
    2. **Implementation PR body** includes a checkbox referencing the closure file by full path: `[ ] OD-6 closed per SDD/governance/OD-6-closure-YYYY-NN.md`.
    3. **Pre-deploy assertion** in the `./prod.sh` deploy command (see Implementation Plan §6) — the command MUST `test -f SDD/governance/OD-6-closure-*.md` before any `build`/`up`/`restart` action and abort with a clear "ABORT: OD-6 not closed" message if no closure file exists. The closure file is committed and tracked in the repo; rollback (re-opening OD-6 after closure) requires an additional ADR or supersession decision rather than a silent file removal.
- **OD-7 (NEW — release gate, code change):** REQ-021 OBO single-flight is implemented in `api/server/services/GraphTokenService.js` BEFORE production deploy of `Microsoft365`. Concrete implementation contract: `Map<cacheKey, Promise<TokenResponse>>` stored on the service instance, populated on cache miss BEFORE the `await` of `client.genericGrantRequest()`, returned to concurrent callers on the same key, cleared in a `finally` block. Unit test pins the single-flight invariant: for K=10 concurrent callers on the same cache key against a cold cache, exactly ONE `genericGrantRequest` call is observed (via spy). Until this lands, the Verification Plan §Negative "Restart thundering-herd" test is a known-failing test and NOT an acceptance gate; OPS-004 operational mitigation (ordered restart) is the interim control. Owner: backend engineer assigned to SPEC-014 implementation PR. Cross-references: PERF-003 (cache strategy), REL-003 (restart cascade interaction).
- **OD-8 (NEW — release gate, code change):** REQ-022 scope cache-key normalization is implemented in `api/server/services/GraphTokenService.js` BEFORE production deploy of `Microsoft365`. Concrete normalization: `(scopes) => scopes.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean).sort().join(',')`. Unit test pins the invariant: `cacheKey(user, "Mail.Read, User.Read") === cacheKey(user, "user.read,mail.read")` AND `cacheKey(user, "Mail.Read,User.Read") !== cacheKey(user, "Mail.Read,Calendars.Read")`. Until this lands, `.env.prod` `OPENID_GRAPH_SCOPES` MUST NOT be cosmetically re-edited (re-ordering, casing, whitespace changes) — any such edit invalidates every user's cached token and triggers a synchronized cache-flush thundering herd. Owner: backend engineer assigned to SPEC-014 implementation PR. Cross-references: PERF-003.
- **OD-9 (RESOLVED 2026-05-19, Step 4e):** REQ-027 protocol-version literal resolved to `"2025-11-25"` by running Softeria 0.110.0 locally and observing the advertised `protocolVersion` in the `initialize` response. The literal is recorded in all three loci (`MICROSOFT365_EXPECTED_PROTOCOL_VERSION` in `packages/api/src/mcp/MCPManager.ts`, the `Microsoft365` comment header in `librechat.yaml`, and `MCP_PROTOCOL_VERSION` in `mcp-m365/VERSION`). Verification §8 enforces drift detection at first connect.
- **OD-10 (NEW — release gate, CI assertion):** `mcp-m365` container hostname uniqueness on `caddy_net` is enforced by a CI grep-style assertion ALIGNED VERBATIM WITH REQ-031: `grep -rn '\bmcp-m365\b' docker-compose*.yml | grep -E 'container_name|hostname|aliases|networks\.[^:]*\.aliases:'` returns rows that all belong to the `mcp-m365` service definition (no other service may claim that DNS name, INCLUDING via `networks.<network>.aliases: [mcp-m365]` which Docker honors as an internal DNS alias). The grep alternation MUST include `aliases` and the `networks.*.aliases:` YAML key to close the alias-collision gap that the previous narrower grep missed. **Runtime smoke test (Verification §1):** `docker compose exec api getent hosts mcp-m365 | wc -l` MUST equal `1` — asserts exactly one container resolves the DNS name at runtime. This is a compensating control for the bare-hostname allowlist entry in SEC-008 / REQ-005 until `isDomainAllowedCore` supports scheme+host+port matching. Owner: implementation PR author.

## Implementation Plan

### 1. Sidecar Dockerfile

Create `mcp-m365/Dockerfile` (version + integrity placeholders are filled in by the implementation PR before merge, per OD-1):

```dockerfile
# Multi-arch OCI index digest resolved 2026-05-18 via Docker Hub API; re-resolve at PR time per OD-1.
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

ARG SOFTERIA_VERSION=<resolved-semver>
ARG SOFTERIA_SHA256=<resolved-tarball-sha>

# Sanity check: ensure the build-arg matches the committed VERSION file (REQ-013 / LOW-1).
COPY mcp-m365/VERSION /build/mcp-m365/VERSION
RUN test "$(cat /build/mcp-m365/VERSION)" = "${SOFTERIA_VERSION}" || \
    (echo "ABORT: VERSION mismatch: file=$(cat /build/mcp-m365/VERSION) build-arg=${SOFTERIA_VERSION}"; exit 1)

# Verify tarball integrity at build time (REQ-002 release gate).
RUN apk add --no-cache curl ca-certificates && \
    cd /tmp && \
    npm pack --pack-destination /tmp \
      @softeria/ms-365-mcp-server@${SOFTERIA_VERSION} && \
    echo "${SOFTERIA_SHA256}  softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz" \
      | sha256sum -c - && \
    npm install -g /tmp/softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz && \
    rm -f /tmp/softeria-ms-365-mcp-server-${SOFTERIA_VERSION}.tgz

# Run as non-root per SEC-006.
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3000
ENTRYPOINT ["ms-365-mcp-server", "--http", "3000", "--toon"]
```

Also commit `mcp-m365/VERSION` containing the resolved semver string. Container runtime flags (read-only FS, `no-new-privileges`) are applied in the Compose service (Step 2), not the Dockerfile. Note: the exact filename pattern (`softeria-ms-365-mcp-server-<semver>.tgz`) follows npm's standard pack output for scoped packages; the implementation PR verifies the literal filename `npm pack` emits in the actual run and adjusts if needed.

### 2. Compose service (dev + prod)

In `docker-compose.override.yml` add (the `test:` line is filled in by OD-5 resolution):

```yaml
mcp-m365:
  build: ./mcp-m365
  container_name: mcp-m365   # MUST be unique on caddy_net; CI assertion enforces this (REQ-031)
  # Bounded restart policy per REL-003 — caps restart cascade
  restart: on-failure
  deploy:
    restart_policy:
      condition: on-failure
      max_attempts: 5
      window: 5m
    resources:
      limits:
        memory: 256m
        cpus: '0.5'
      reservations:
        memory: 128m
        cpus: '0.1'
  networks:
    - default
    - caddy_net
  expose:
    - "3000"
  read_only: true
  security_opt:
    - no-new-privileges:true
  # Single status-tolerant healthcheck per REQ-018 (Compose limit: one healthcheck slot).
  # Probe: nc -z process-responsive gate, then `wget --server-response /mcp` parsing the HTTP status line.
  # Accept 200|400|405|406 (any of these proves the server is alive — a bare GET on a streamable-HTTP MCP
  # endpoint is naturally rejected with 400/405/406 because the protocol expects a POST with headers).
  # Timeout / connection-refused / 5xx = fail.
  # Pure liveness/readiness split deferred to SPEC-010 (Prometheus track).
  # retries × interval = 5 × 10s = 50s detection window (reconciles REL-003 "~50s detection" math).
  # Trade-off: a slow upstream Graph call CAN trigger restart after 50s — bounded by max_attempts: 5 / window: 5m.
  healthcheck:
    test:
      - CMD-SHELL
      - |
        nc -z localhost 3000 && \
        wget --server-response --spider \
          --tries=1 --timeout=5 \
          http://localhost:3000/mcp 2>&1 | \
          grep -qE 'HTTP/.+ (200|400|405|406)'
    retries: 5
    interval: 10s
    start_period: 90s
```

…and add `mcp-m365` to the `api` service's `depends_on` with `service_healthy` (REQ-018):

```yaml
api:
  depends_on:
    mcp-m365:
      condition: service_healthy
```

Mirror both blocks into `docker-compose.prod.yml` with identical networks (and the same `build: ./mcp-m365` so `./prod.sh build mcp-m365` works on the prod host).

> **Egress restriction (SEC-006 / OD-6 release gate).** Restricting outbound to `graph.microsoft.com:443` only is implemented by attaching the sidecar to a Docker network with an egress proxy (e.g., a small tinyproxy container with an allowlist) OR an `iptables` OUTPUT rule applied to the container's netns OR a Docker user-defined network configured with no default gateway plus an explicit route to graph.microsoft.com. The implementation PR records the chosen mechanism and the OD-6 closure ticket. The previously-allowed "operationally infeasible → residual risk" fallback is REMOVED — at least one mechanism MUST ship before prod rollout.

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
    # Step 4e: Softeria 0.110.0 requires Authorization on every JSON-RPC call
    # including `initialize`, so we cannot bootstrap with a null token.
    startup: false
    headers:
      Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"
    serverInstructions: |
      Use these tools to interact with the signed-in user's Microsoft 365 data:
      Outlook mail, Calendar, OneDrive, SharePoint, Excel, OneNote, To Do,
      Planner, Contacts, and Graph search. Operate strictly on behalf of the
      current user. All scopes are read-only in phase 1; do not attempt
      writes (send, create, update, delete) — they will fail with HTTP 403.
      Request only the fields needed for the user's intent (e.g., subject +
      sender for mail triage, not full body).
      Do NOT search SharePoint, OneDrive, or Mail without a user-named
      target (site, folder, sender, keyword, date range). If the user asks
      an open-ended question, ask a clarifying question first; do not
      enumerate to find candidates.
      # v1 (2026-05) — co-versioned with REQ-008 scope set; bump on any scope-set or directive change.
```

### 4. Entra app registration (Azure portal, manual) — BLOCKS deploy

Grant admin consent on the Memodo Entra app registration for these delegated Graph permissions:

`User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`.

**Verification (blocks the deploy in §6 until passed).** Verify admin consent via:

```
https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<client-id>
```

Confirm all 9 phase-1 scopes are listed and granted (the admin-consent screen shows the full delegated-permission list). The deploy in §6 MUST NOT run until this verification passes; otherwise users hit `InsufficientScope` errors in waves immediately after rollout.

### 5. `.env.prod` change (prod host only)

```
OPENID_GRAPH_SCOPES=User.Read,Mail.Read,Calendars.Read,Files.Read.All,Sites.Read.All,Contacts.Read,Tasks.Read,Notes.Read.All,offline_access
```

Document the new default in `.env.example` (committed) without exposing tenant-specific values.

### 6. Deploy

Dev:
```
npm run build              # rebuild packages/*/dist locally
docker compose build mcp-m365
docker compose up -d mcp-m365
docker compose restart api
```

Prod (after merging into `pablo` and pushing). The sequence is:
1. **Locally**: rebuild the bind-mounted dist directories so the prod container's overlay reflects this PR's source changes.
2. **Locally**: run `./prod-sync.sh` to rsync `packages/{api,data-schemas,data-provider}/dist`, `client/dist`, and `api/server` to prod. The script guards against missing local dist directories and restarts api after the sync. Per `feedback_prod_yaml_deploy`, `librechat.yaml` is NOT synced this way — it travels via git.
3. **On prod**: `git pull` brings the `librechat.yaml` change, the SDD artifacts, the `mcp-m365/` Dockerfile/VERSION updates, and the OD-6 closure file.
4. **On prod**: OD-6 closure pre-check, rebuild the sidecar Docker image, start it, wait for readiness, restart api (which now runs the synced dist).

```
# 1. Local: rebuild dist
npm run build

# 2. Local: rsync dist directories + restart api (skips here; --no-restart keeps it for step 4)
./prod-sync.sh --no-restart

# 3+4. Prod: git pull, OD-6 gate, sidecar build + readiness, api restart
ssh Hetzner-personal "cd /opt/docker/librechat && git pull && \
  # OD-6 release-gate pre-check: abort if the governance closure file is absent.
  test -f SDD/governance/OD-6-closure-*.md || \
    (echo 'ABORT: OD-6 not closed — production rollout requires SDD/governance/OD-6-closure-YYYY-NN.md'; exit 1) && \
  ./prod.sh build mcp-m365 && \
  ./prod.sh up -d mcp-m365 && \
  # wait up to 120s (60 × 2s) for mcp-m365 readiness; abort deploy on timeout
  ok=0; for i in \$(seq 1 60); do \
    h=\$(./prod.sh ps --format json 2>/dev/null | jq -r '.[]|select(.Service==\"mcp-m365\").Health' 2>/dev/null); \
    if [ \"\$h\" = \"healthy\" ]; then ok=1; break; fi; \
    sleep 2; \
  done; \
  if [ \"\$ok\" != \"1\" ]; then echo 'ABORT: mcp-m365 did not become healthy within 120s'; exit 1; fi; \
  ./prod.sh restart api"
```

Step 2's `--no-restart` flag defers the api restart to the end of step 4 so the OD-6 gate + sidecar-readiness checks run between the dist sync and the api restart. (Running `./prod-sync.sh` without `--no-restart` would restart api immediately, before the sidecar is even built.)

The implementation PR MUST verify `./prod.sh ps --format json` is supported by the wrapper (or substitute `docker compose ps --format json | jq` directly). On readiness timeout, the deploy aborts BEFORE the `restart api` step so the API container is not restarted against an unhealthy sidecar.

**Why the build-and-sync step is non-negotiable (operator gotcha, see REQ-014):** the prod LibreChat container's `@librechat/api/dist/` is bind-mounted from `/opt/docker/librechat/packages/api/dist/` on the host. `packages/api/dist/` is gitignored (line 38 of `.gitignore`) — only the TypeScript source under `packages/api/src/` travels via git. Skipping the local build + prod-sync.sh step leaves the prod container running whatever dist was on the host before the deploy (often weeks old). The first SPEC-014 deploy (2026-05-19) hit exactly this: hours of debugging the resulting symptom (silent agent failures with `toolSchemaTokens: 0`) before identifying the stale-dist root cause. The local-build + prod-sync.sh step closes that class of bug.

Avoid bare `./prod.sh restart` (without an explicit service name) during business hours — it restarts both services simultaneously and triggers post-restart OBO cold-start (mitigated but not eliminated by REQ-021 single-flight).

Update `.env.prod` on the host (do NOT commit).

## Verification Plan

### Smoke tests (dev)

1. **Sidecar reachable & healthy from API container; hostname uniqueness asserted at runtime (REQ-031 / OD-10):**
   `docker compose exec api wget -qO- http://mcp-m365:3000/health` → expect 200 if OD-5 resolves to `/health`. Otherwise `docker compose exec api wget -S --spider http://mcp-m365:3000/mcp` and accept any non-5xx response. `docker compose ps` reports `mcp-m365` as `healthy` (per REQ-018 healthcheck). Additionally, `docker compose exec api getent hosts mcp-m365 | wc -l` MUST equal `1` — asserts exactly one container resolves the `mcp-m365` DNS name at runtime (compensating control for SEC-008 bare-hostname allowlist; complements the OD-10 CI grep).
2. **Allowed-domains accepts internal hostname:**
   Tail `docker compose logs -f api` while restarting; expect no `isMCPDomainAllowed` rejection for `mcp-m365`.
3. **Tool group surfaces in agent builder:**
   Sign in via Entra, open Agent Builder, confirm `Microsoft365` tools appear under the group label `Microsoft365` and tools are namespaced (`Microsoft365_<tool>` per UX-001).
4. **Read-only Graph call (lowest scope):**
   Prompt an M365-enabled agent: "Who am I, according to Microsoft Graph?" → expect a `/me` response with display name, mail, UPN.
5. **OBO exchange observed (single-flight verified):**
   `docker compose logs -f api | grep -iE 'graph|obo'` → expect one OBO exchange per (user, scope-set) per cache TTL, with subsequent tool calls reusing the cached token. Verify single-flight (REQ-021): trigger two M365 tool calls in close succession from the same user immediately after API restart; assert only ONE OBO exchange line is emitted for that user.
6. **Sidecar log content discipline (SEC-007 — negative assertion):**
   `docker compose logs --tail 500 mcp-m365 | grep -E 'Bearer eyJ|Authorization:' || echo "OK: no auth headers leaked"` → expect "OK: no auth headers leaked". Also `grep` for representative payload fragments (a known mail subject from a test message, a recipient email) and assert absence. If Bearer tokens or payloads appear, the build FAILS — adjust Softeria log level (REQ-002 entrypoint flag) or apply a log filter.
7. **Correlation-ID end-to-end (REQ-023):**
   Issue one tool call with a known `client-request-id` (manually injected or sampled from LibreChat logs); confirm the same ID appears in LibreChat audit logs, `mcp-m365` logs (after SEC-007 redaction — the correlation-ID is metadata and may be logged), and a Graph activity-log query.
8. **MCP protocol version logged + Error Response Schema shape + canonical-enum retry classification (REQ-027 / Error Response Schema / M8):**
   - On first connect, `docker compose logs api | grep -i "mcp.*protocol"` → assert the advertised protocol version is recorded; assert it matches the pin in REQ-027.
   - On every error path exercised in the negative tests below, assert the on-wire shape: `isError` is a sibling of `content`, `content[0].type === "text"`, `JSON.parse(content[0].text).schemaVersion === 1`, and the canonical fields (`code`, `message`, `correlationId`, optional `graphCode`/`graphMessage`, `retryAfter` only when `code === "Throttled"`, `throttleSource` only when `code === "Throttled"`) are present.
   - **Retry-classification table assertion (canonical-enum stability per Error Response Schema):** for each of the eight canonical `code` values (`Unauthenticated`, `InvalidToken`, `InsufficientScope`, `WriteForbidden`, `Throttled`, `UpstreamUnavailable`, `SidecarUnavailable`, `ProtocolMismatch`), assert the LibreChat retry-classification matches: `Throttled` → retry-with-retryAfter (authoritative only on `throttleSource === "graph_429"`); `UpstreamUnavailable` → bounded-retry-per-REL-002; the other six → no-automatic-retry. Any change to this table is a breaking change requiring a spec amendment.
9. **Cold-start budget measured (PERF-001):**
   Restart `mcp-m365`, time the first MCP call from LibreChat; assert ≤5 seconds. Record duration in `mcp-m365/VERSION` notes or a follow-up issue if drifting toward 80% of `initTimeout`.
10. **MCP tool-list cost measured (PERF-004):**
    On first connect after restart, log tool-list payload size, registration latency, and (separately) the prompt-token cost when the model receives the tool schemas. Assert all three are within the PERF-004 targets.
11. **PII detection on Microsoft365 tool output (REQ-019 positive assertion):**
    Seed a known synthetic PII token (e.g., a recognizable test email `pii-canary@memodo-test.de`, a synthetic IBAN `DE00 1234 5678 9012 3456 78`) into a test mailbox and/or a test SharePoint document accessible to the test user. Invoke a Microsoft365 read tool (e.g., search mail by canary subject; fetch the SharePoint doc). Assert that the configured SPEC-009 PII detection mode triggers on the resulting tool-result message: in `detect` mode, a detection event is emitted; in `warn` mode, the user-facing warning surfaces. If neither fires, REQ-019 has regressed (SPEC-009 bypass on tool-result path).

    **PII canary test infrastructure (resolves the "test mailbox is undefined" gap):** requires a dedicated Memodo Entra test account (`librechat-test@memodo.de`, separate from prod-user accounts) with seeded fixtures — one mail with the IBAN/canary in the test account's mailbox, one SharePoint doc with the IBAN in a shared test site. Fixtures are created out-of-band (manual Azure/M365 setup, one-time) and their existence is documented in `mcp-m365/test-fixtures.md` (committed). The test is a manual smoke step in dev, NOT automated CI (CI lacks Entra-test-user credentials and an MFA-capable session). The fixture-setup steps and the canary values used are listed in `mcp-m365/test-fixtures.md` so a future engineer running this smoke knows exactly which inputs to feed and which detections to look for.
12. **LibreChat-side audit-log content discipline (SEC-004 negative assertion):**
    During a representative tool-call session (one `/me`, one mail search, one calendar list), tail `docker compose logs api`. Assert `grep -E 'Bearer eyJ|"body":|"subject":|"recipient"|"toRecipients"|"attendees"' api` returns no hits — i.e., neither Authorization headers nor Graph payload bodies/PII fields appear in LibreChat-side logs. (SEC-007 already covers `mcp-m365` logs; this asserts the symmetric property on the LibreChat side.)
13. **JWT invariants on emitted Bearer token (REQ-020):**
    Run the `GraphTokenService` unit test that decodes a freshly minted token from the test path and asserts `aud === "https://graph.microsoft.com"`, `iss` matches the tenant pattern, `tid === <Memodo-tenant-id>`, `ver === "2.0"`, `oid`/`upn` present, `appid` matches the Memodo app client ID, `nbf ≤ now + 60s`, and remaining lifetime ≥ 60s. Any failure aborts header emission and surfaces `code: "InvalidToken"` (distinct from `Unauthenticated` — see Error Response Schema) AND emits the structured `graph.token.invariant_failure` log event.
14. **Deterministic-failure short-circuit (REQ-027 / REL-002):**
    Configure the sidecar to advertise a deliberately-wrong protocol version (test fixture). Restart `api`. Assert exactly ONE `mcp.connect.deterministic_failure` log line is emitted, no reconnect loop runs (verify by counting connect attempts: should be 1, not 7), and the `Microsoft365` server surfaces `code: "ProtocolMismatch"` on subsequent tool calls.
15. **REQ-021 single-flight unit test (when OD-7 resolved):**
    For K=10 concurrent callers on the same cache key against a cold cache, assert exactly ONE `genericGrantRequest` invocation (via spy). Until OD-7 resolves, this test is documented as KNOWN-FAILING and is not a deploy gate.
16. **REQ-022 scope-key normalization unit test (when OD-8 resolved):**
    Assert `cacheKey(user, "Mail.Read, User.Read") === cacheKey(user, "user.read,mail.read")` AND `cacheKey(user, "Mail.Read,User.Read") !== cacheKey(user, "Mail.Read,Calendars.Read")`. Until OD-8 resolves, this test is documented as KNOWN-FAILING.
17. **Bounded queue + Throttled emission + throttleSource + cascading-timeout (REQ-024 / REQ-025 / PERF-003).** Unit tests live at `packages/api/src/mcp/__tests__/queue.test.ts` and exercise the `MCPCallQueue` class introduced by REQ-024 directly.
    Stall the upstream Graph response (e.g., point sidecar at a mock returning a long-delay 200). Issue 20 concurrent Microsoft365 tool calls for a single user. Assert:
    - (a) first 4 enter in-flight, (b) next 16 enter the queue, (c) the 21st fails immediately with `code: "Throttled"` AND `throttleSource: "librechat_concurrency_cap"` (queue depth cap path);
    - (d) for queued calls that wait beyond 14s (REQ-024 queue-wait-max), `code: "Throttled"` is emitted with `throttleSource: "librechat_queue"` BEFORE the outer 45s MCP timeout fires (assert by log timestamp at ≤14.5s, not by Graph-429 path);
    - (e) NO call returns `code: "UpstreamUnavailable"` due to outer timeout — error class is correctly classified;
    - (f) **Cascading-timeout invariant unit-test stub (REQ-025):** import the four constants (`queue_wait_max`, `graph_inner_timeout`, `mcp_hop_budget`, `outer_mcp_timeout`) from the LibreChat MCP config module and assert `queue_wait_max + graph_inner_timeout + mcp_hop_budget < outer_mcp_timeout` (concrete: `14000 + 30000 + 500 = 44500 < 45000`);
    - (g) **Cancellation semantics (REQ-025):** stall Graph beyond 45s; poll the per-user slot counter at t=45.1s and t=50.5s; assert a fresh call can claim a slot at t≥45.1s (cancellation-honored path) OR at t≥50.5s (grace-fallback path) — slot is NOT held until the original call returns;
    - (h) **PERF-003 emission-time refresh (long-tail queued call):** seed `GraphTokenService` cache with a token expiring at `now + 16s`; submit a tool call that queues behind 4 in-flight calls (so it dequeues at ~14s, after the new emission-time refresh threshold of 60s remaining-TTL fires); assert the dequeued call observes a REFRESHED token at emission and the outbound MCP call carries the fresh Bearer (surfaces as success, NOT as Graph 401). This pins PERF-003's "re-check at emission, AFTER dequeue" guarantee.

18. **Stuck-stream chunked-response stall (REL-003 + REQ-025 cancellation):**
    Add a negative test using `toxiproxy`-style fault injection (or a mock upstream) that holds the connection open with no data after the first byte. Assert: (a) the 45000 ms outer MCP timeout fires; (b) the SSE stream closes cleanly with `code: "UpstreamUnavailable"` (or `code: "Throttled"` with `throttleSource: "librechat_queue"` if the queue-wait-timeout fired first); (c) the slot is released per the REQ-025 cancellation semantics; (d) no socket leak — a follow-up tool call from the same user succeeds within p95 ≤ 3s after the timeout. This is the slow-loris / half-open TCP path that `docker pause` (existing negative test) does not exercise.

### Negative tests

- **Missing consent (REQ-016, Error Schema `InsufficientScope`):** Sign in with a user who has not consented to (e.g.) `Files.Read.All`; prompt the agent to list OneDrive files. Expect a tool error per the Error Response Schema with `code: "InsufficientScope"`, `graphCode: "Authorization_RequestDenied"`, `correlationId` populated. No crash, no stuck stream.
- **Non-Entra session (REQ-015, REQ-020, Error Schema `Unauthenticated`):** Sign in via local auth (if available); confirm the Graph placeholder resolves to null and the `Authorization` header is OMITTED entirely from the outbound MCP request (NOT sent with empty Bearer). Expect a tool error per the Error Response Schema with `code: "Unauthenticated"`.
- **Invariant-failing token (REQ-020, Error Schema `InvalidToken`):** In a controlled test path, inject a token with a deliberately-wrong invariant (e.g., `aud === "https://api.example.com"`, OR `tid` mismatched with `iss`-extracted tenant, OR `appid` from a different app registration). Expect a tool error per the Error Response Schema with `code: "InvalidToken"` (NOT `Unauthenticated`); assert the structured log event `graph.token.invariant_failure` is emitted with the specific failing invariant.
- **Phase-1 write attempt (REQ-016 + SEC-003, Error Schema `WriteForbidden`):** Prompt the agent to send an email. Expect a tool error per the Error Response Schema with `code: "WriteForbidden"`. No stuck SSE stream.
- **Sidecar hung but up (REL-003):** During an active tool call, `docker pause mcp-m365`. Assert the LibreChat tool call fails within `timeout: 45000` ms, the SSE stream emits a clean error event and closes, the agent loop recovers; after `docker unpause`, the next prompt works. The healthcheck reports `unhealthy` within ~50s (retries=5 × interval=10s, per REQ-018) and Docker restarts the container per `restart: on-failure` with bounded `max_attempts: 5 / window: 5m` (per REL-003). (Slow-loris / chunked-response stall is exercised separately by Verification §18.)
- **Graph 5xx / upstream unavailable (REL-001, Error Schema `UpstreamUnavailable`):** Simulate Graph degradation (point the sidecar at an invalid Graph URL transiently via env override, or use a mock Graph endpoint returning 503). Assert the tool error surfaces with `code: "UpstreamUnavailable"` within `timeout: 45000` and that no retry storm is visible (max 7 cycles per REL-002).
- **Throttling (REQ-024, Error Schema `Throttled`):** Trigger >4 concurrent Microsoft365 tool calls for a single user. Assert the 5th call enters the FIFO queue (per REQ-024 cap of 4 in-flight + 16 queued); the 21st call (5th past the cap of 4+16=20) fails fast with `code: "Throttled"` AND `throttleSource: "librechat_concurrency_cap"`. A queued call that times out at the 14s queue-wait emits `code: "Throttled"` with `throttleSource: "librechat_queue"`. A Graph-originated 429 emits `code: "Throttled"` with `throttleSource: "graph_429"` and `retryAfter` populated authoritatively. (Detailed assertions in Verification §17.)
- **Restart thundering-herd (REQ-021 single-flight under load):** With N>=5 concurrent test sessions mid-conversation, `./prod.sh restart api` (dev equivalent: `docker compose restart api`). Assert exactly N OBO exchange log lines (one per user), not 2N or more. If parallel duplicate OBO exchanges appear, REQ-021 has regressed. **Companion unit test:** with the Entra upstream stubbed to return 429 twice then 200, K=10 concurrent callers on the same `(user, scope-set)` cache key observe exactly ONE successful resolve AND ≤3 total Entra `genericGrantRequest` calls (NOT ≤3 × K = 30). This pins the REQ-021 invariant that backoff lives INSIDE the single-flight call.
- **`serverInstructions` drift (REQ-028):** As part of every PR that touches `librechat.yaml`'s `mcpServers.Microsoft365` OR `OPENID_GRAPH_SCOPES` OR REQ-010 flag set, a CI step diffs `serverInstructions` text against the REQ-008 scope set and fails if they're out of sync. (Implementation may be a simple grep-based assertion.)

### Performance measurement (PERF-001/002/003/004)

The Verification Plan establishes a baseline; ongoing measurement is the subject of PRE-RESEARCH-013 (observability extension). For phase-1 acceptance:

- Scrape `MCPManager` tool-call logs over a 7-day window post-rollout.
- Compute p50/p95/p99 of (a) tool-call end-to-end duration, (b) OBO exchange duration, (c) MCP hop duration, (d) Graph round-trip duration (best-effort, via `client-request-id` correlation).
- Confirm targets in PERF-002 are met.
- Alert if p95 end-to-end > 3s for 3 consecutive days; alert if cold-start (PERF-001) > 4s.

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
- **Image hardening (phase 2):** Switch to a `node:22-slim` non-root user, publish the built image to a registry to remove the prod-side build step. (Base-image digest pinning has been promoted to REQ-002 / OD-1 and is a phase-1 release gate.)
- **Graph-result cache (phase-2 follow-up to PERF-002):** A short-lived (60-120s) per-`(user, endpoint, params-hash)` cache at the OBO/MCP layer, gated on telemetry showing repeat-fetch rate > 30% within 60s windows. Phase 1 explicitly opts out (freshness preferred over amortized latency); PERF-002 budgets are per-call.
- **Correlation-ID HMAC derivative (phase-2 follow-up to REQ-023):** HMAC-SHA256(server-secret, conversationId:messageId:toolCallId)-truncated-to-16-hex outbound `client-request-id`, mapping retained LibreChat-side. Eliminates the topology-leak trade-off documented under OD-6.
- **Audit dashboard:** Surface per-user M365 tool usage in the admin reporting dashboard (SPEC-008) once that ships.
- **SharePoint file picker:** Enable in a separate spec; reuses the same OBO trust boundary.

## Implementation Summary

**Status:** Complete ✓ (2026-05-19)
**Branch:** feature/014
**Tracking:** `SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md`
**Full report:** `SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-014-2026-05-19_10-30-00.md`

### Outcome

All 31 functional REQs and 19 non-functional NFRs are either implemented in code or explicitly deferred to operator action. 26 REQs delivered in code; 5 REQs operator-deferred by design (REQ-008 Entra admin consent, REQ-013 host-side egress verification, REQ-014 admin-tool denylist, REQ-029 retention timer inheritance, REQ-030 DSR cascade). PERF-001/002/004 baselines deferred to first-deploy measurement per the Verification Plan; OPS-003/004 deferred to PRE-RESEARCH-013.

### Test gate

`packages/api/src/mcp/__tests__` + `packages/api/src/utils/__tests__` serial run: **768 passed / 1 skipped / 0 failed** across 33 suites. SPEC-014's direct surfaces (`queue.test.ts`, `errorEnvelope.test.ts`, `graph.test.ts`) declare 83 cases covering REQ-015 / REQ-020 / REQ-021 / REQ-022 / REQ-023 / REQ-024 / REQ-025 / REQ-027 / PERF-003 + the full Error Response Schema.

Integration tests: N/A by design — the LibreChat side has no isolated integration framework for MCP server end-to-end interactions; integration coverage is at deploy time via the Verification Plan §1-18 (deploy + smoke). E2E tests: N/A — no UI surface; agent-builder is data-driven from the unchanged MCP toolchain.

### Verified production values

Captured by running Softeria 0.110.0 locally during Step 4e:
- Softeria semver `0.110.0` / tarball SHA-256 `38e495a29e7357f6777af6bf643c71ee9fd662fcd0aeec754c966ad8ea76ad8e`
- `node:22-alpine` digest (2026-05-19) `sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c`
- MCP `protocolVersion` advertised by Softeria: `2025-11-25` (NOT the spec's earlier-assumed `2024-11-05` — the protocol literal is pinned in three loci and must be re-resolved at PR-merge time).

### Architecture decisions surfaced during implementation

1. `MCPCallQueue` as composition wrapping `MCPManager.callTool` (not a `MCPManager` modification) — Microsoft365-only instance; other servers bypass the queue.
2. JWT claim-shape validation only (NOT signature verification) at Bearer emission — Microsoft is the signature authority; LibreChat enforces business invariants (`aud`, `tid`, `oid`, `appid`, `exp`, `nbf`).
3. Single-flight retry inside the in-flight promise, not at each caller — K=10 concurrent callers on the same `(user, scope-set)` see ≤3 Entra calls total under transient 5xx.
4. `startup: false` for Microsoft365 — Softeria 0.110.0 requires `Authorization` on every JSON-RPC including bare `initialize`; lazy-connect at first user-scoped tool call, covered by PERF-001 5s budget.
5. Inner Graph timeout enforced by LibreChat (in `MCPCallQueue`), not by Softeria — removes dependence on upstream env-var honoring, preserves the cascading-timeout invariant.

### ADRs published

- `SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md` — BYOT over OBO as the auth pattern for all Entra-delegated MCP servers in this stack.
- `SDD/adr/0002-readonly-default-delegated-graph-scopes.md` — read-only default scope policy with OD-4 soak-gate for write promotion.

### Glossary additions

`MCPCallQueue`, `InvalidGraphTokenError`, `MissingCallContextError` added to `SDD/UBIQUITOUS_LANGUAGE.md`. Pre-existing terms (`Graph access token`, `OBO exchange`, `BYOT`, `delegated Graph scopes`, `Entra app registration`, `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder, `MCP sidecar`, `streamable-HTTP transport`, `mcpSettings.allowedDomains`, `serverInstructions`, `phase-1 read-only`, `caddy_net`, `./prod.sh`, `throttleSource`, `schemaVersion`, `InvalidToken` vs `Unauthenticated`, `deterministic-failure short-circuit`, `Cascading-timeout invariant`) remain authoritative.

### Pending operator actions before deploy

1. `OPENID_GRAPH_SCOPES` + `MEMODO_TENANT_ID` + `GRAPH_EXPECTED_AUDIENCE` to `.env.prod`.
2. Memodo Entra admin consent on the 9 phase-1 scopes.
3. OD-6 closure attestation at `SDD/governance/OD-6-closure-2026-NN.md`.
4. Re-resolve `node:22-alpine` digest + Softeria tarball SHA-256 at PR merge.
5. Wire `serverinstructions.sha256` CI step (REQ-016 / REQ-028 drift control).
