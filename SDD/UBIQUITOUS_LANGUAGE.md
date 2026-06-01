# Ubiquitous Language

Canonical names for domain concepts used across SDD docs, specs, code, commits, and tests. When a term has a synonym, prefer the canonical name everywhere.

This glossary is initialized with terms introduced or reinforced by SPEC-014 (Microsoft 365 MCP Integration). New SDD work should extend this file rather than redefining terms inline.

## Auth & token plumbing

### Graph access token
The Microsoft Graph API access token obtained via On-Behalf-Of (OBO) exchange. Stored in LibreChat's per-user `GraphTokenService` cache keyed by `${user.openidId}:${scopes}`. Surfaced to MCP server configs through the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder.

### On-Behalf-Of (OBO) exchange
Microsoft Entra OAuth 2.0 flow (RFC 8693 JWT-bearer grant) that swaps a user's already-acquired OIDC token for a Graph access token scoped to a downstream resource. Performed by `GraphTokenService.getGraphApiToken()` (`api/server/services/GraphTokenService.js:8-80`); invoked by `resolveGraphTokenPlaceholder()` (`packages/api/src/utils/graph.ts:103,119`). Critical property: the resulting token represents the signed-in user, not a service principal.

### BYOT (Bring Your Own Token)
Auth mode in which the MCP server holds no OAuth client credentials of its own and accepts a Bearer token issued by the caller on every request. Distinguished from "server-managed OAuth" (the MCP server runs its own auth flow) and "app-only" (a shared service principal). In SPEC-014, BYOT is mandatory for the `mcp-m365` sidecar: REQ-006 forbids passing `--auth` or any OAuth flags to Softeria.

### Delegated Graph scopes
Microsoft Graph permissions that act on behalf of a specific signed-in user (e.g., `Mail.Read`, `Files.Read.All`). Distinct from application permissions (`.default`, app-only access), which are not used by this deployment. Phase-1 delegated scopes are enumerated in REQ-008.

### Entra app registration
The Memodo Entra ID (formerly Azure AD) application that holds the OIDC client configuration for LibreChat sign-in and the delegated Graph permissions used during OBO exchange. One registration serves both SSO login and Graph access. Tenant-scoped admin consent is required for new delegated scopes.

### `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder
The string literal `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`, defined as `GRAPH_TOKEN_PLACEHOLDER` at `packages/api/src/utils/oidc.ts:35`. When this string appears in an MCP server's `url`, `headers`, or `env`, LibreChat resolves it to a fresh per-user Graph access token before connecting. It is the BYOT contract between LibreChat and any Graph-backed MCP sidecar.

## MCP architecture

### MCP sidecar
A separate Docker service that exposes a single MCP server over HTTP/streamable-http to the LibreChat API container on a shared Docker network. In SPEC-014 the sidecar is named `mcp-m365` and runs Softeria's `@softeria/ms-365-mcp-server`. The sidecar is stateless, holds no secrets, and has no host port published — it is reachable only via internal Docker DNS.

### Streamable-HTTP transport
The MCP transport selected for `mcp-m365` (`type: streamable-http` in `librechat.yaml`). Successor to the deprecated SSE transport (MCP spec, March 2025). Used by LibreChat's `MCPManager` to connect to remote MCP servers with per-request Bearer headers.

### `mcpSettings.allowedDomains`
The strict SSRF allowlist in `librechat.yaml` (`mcpSettings.allowedDomains`) enforced by `isMCPDomainAllowed` (`api/server/services/MCP.js:419,502` and `packages/api/src/auth/domain.ts:480`). Semantics (per project memory and codebase): an empty list means SSRF-default-deny-private-IPs only; a non-empty list is a strict allowlist — every MCP server URL must match a listed entry. Entries are bare hostnames; protocol/port qualifiers are not required because `isDomainAllowedCore` matches against the URL origin's hostname.

### `serverInstructions`
A plain-language string in an `mcpServers.<name>` entry that is injected into the LLM's prompt context whenever the corresponding tools are enabled. Used to tell the model what surfaces a server covers and how to use it. In SPEC-014 it enumerates the M365 surfaces and states the phase-1 read-only contract.

## Operational concepts

### Phase-1 read-only
The initial production scope for SPEC-014: only `.Read` / `.Read.All` delegated Graph permissions, no `--org-mode` (Softeria's flag for Teams write tools / admin operations). Any tool call that attempts a write fails with Graph HTTP 403 (SEC-003, REQ-016). Phase-2 (write scopes, Teams write tools) is gated on a soak period (OD-4) and remains out of scope.

### `caddy_net`
The external Docker network shared between LibreChat's API container, sibling sidecars (Caddy, MinIO, MongoDB, Meilisearch, etc.), and the new `mcp-m365` container. Declared `external: true` in `docker-compose.prod.yml`. Internal-only — never exposed to the Hetzner Cloud Firewall.

### `./prod.sh`
The production wrapper script that runs `docker compose` against the three-file overlay (`docker-compose.yml` + `docker-compose.override.yml` + `docker-compose.prod.yml`) using `.env.prod`. Single-command lifecycle for all services, including `mcp-m365` (OPS-001).

## Error envelope & control-plane vocabulary

### `throttleSource`
A field on the SPEC-014 Error Response Schema, populated only when `code === "Throttled"`. One of three values: `graph_429` (upstream-originated 429 from `graph.microsoft.com`), `librechat_queue` (REQ-024 queue-wait timeout fired), `librechat_concurrency_cap` (REQ-024 in-flight cap hit). **Authoritative-`retryAfter` rule:** `retryAfter` is honored as authoritative only when `throttleSource === "graph_429"`; for the other two values, `retryAfter` is a LibreChat-side hint.

### `schemaVersion`
Integer version field on the SPEC-014 Error Response Schema JSON blob. Currently `1`. Increments only on field REMOVAL or semantic CHANGE; additive new optional fields are non-breaking and do NOT bump the version. Consumers MUST ignore unknown fields.

### `InvalidToken` (vs. `Unauthenticated`)
Two operationally distinct error codes on the SPEC-014 Error Response Schema. `Unauthenticated` means NO TOKEN AT ALL — e.g., a local-auth user, a non-Entra session, or a token-resolver that returned null; the `Authorization` header was omitted from the outbound MCP request. Benign — UX hides M365 tools. `InvalidToken` means a token EXISTS but fails a REQ-020 JWT invariant (wrong `aud` / `iss` / `tid` / `ver` / `appid`, `nbf > now+skew`, expired-ish, etc.) — exactly the case where ops want a LOUD signal because it indicates a misconfigured Entra app, a cross-tenant token leak, or a token-minting regression. REQ-020 mandates a structured server-side log event on the `InvalidToken` path; `Unauthenticated` does NOT emit this alert.

### `deterministic-failure short-circuit`
The REQ-027 named pattern for handling sidecar-connect failures that are non-transient by nature (`ProtocolMismatch`, fatal TLS handshake failure, DNS NXDOMAIN, HTTP 501 / 426 on `/mcp`). On a deterministic failure the REL-002 circuit-breaker retry budget is BYPASSED (the failure does not consume any of the 7-cycle / 45s retry window); `MCPManager` emits a single structured `mcp.connect.deterministic_failure` log line, surfaces `code: ProtocolMismatch` (or `SidecarUnavailable` for non-protocol deterministic classes) per the Error Response Schema, and STOPS reconnect attempts until the next deploy or manual reconnect. Transient failures (TCP RST, transport timeout, HTTP 5xx) continue to follow REL-002 normally.

### Cascading-timeout invariant
The REQ-025 named hard constraint that connects the inner Graph timeout, the LibreChat queue-wait timeout, the MCP-hop budget, and the outer MCP timeout. Pinned form: `queue_wait_max + graph_inner_timeout + mcp_hop_budget < outer_mcp_timeout`. Concrete SPEC-014 phase-1 values: `14000 + 30000 + 500 = 44500 < 45000 ✓`. The invariant is unit-test enforceable: the test imports the four constants from `packages/api/src/mcp/mcpConfig.ts` (or the new `packages/api/src/mcp/queue.ts`) and asserts the inequality; any future tuning of one component requires re-validating the inequality and the unit test.

## Implementation surfaces

### `MCPCallQueue`
The REQ-024 + REQ-025 implementation class at `packages/api/src/mcp/queue.ts`. Composes around `MCPManager.callTool` for the Microsoft365 server only — other MCP servers bypass the queue entirely. Owns the per-user FIFO queue (4 in-flight / 16 queued per user, 8/32 global caps), the cascading-timeout discipline (inner Graph timeout, queue-wait timeout, MCP-hop budget, outer MCP timeout with AbortController + grace-fallback), the post-dequeue Bearer-header freshness re-check (PERF-003), and the correlation-ID propagation contract. `assertCascadingTimeoutInvariant` runs at construction so any future constant drift fails fast. Tests pin the contract at `packages/api/src/mcp/__tests__/queue.test.ts`.

### `InvalidGraphTokenError`
The REQ-020 typed exception at `packages/api/src/utils/graph.ts`. Thrown by `validateGraphTokenInvariants` when a JWT-claim invariant fails (`aud`, `iss`, `tid`, `ver`, `oid`, `upn`, `appid`, `nbf`, `exp`, or malformed). The error carries a discriminator field `invariant` naming the specific failing check; consumers map this to the Error Response Schema's `code: "InvalidToken"`. Distinct from `Unauthenticated` (no token at all): `InvalidToken` MUST emit a structured `graph.token.invariant_failure` server-side log event because it indicates a misconfigured Entra app, a cross-tenant token leak, or a token-minting regression.

### `MissingCallContextError`
The REQ-023 fail-loud guard at `packages/api/src/mcp/errorEnvelope.ts`. Thrown by `MCPManager.callTool` when any of `userId`, `conversationId`, or `messageId` is missing from the call options. The post-Step 4e design choice: rather than fall through to `'unknown'` in the correlation-ID composition (which would silently break audit reconstruction), the missing-context path throws this typed error so the caller maps it to a clear `code: "Unauthenticated"` (or a future dedicated code) and the structured log captures the missing field name. Pre-Step 4e the code used `'unknown'` fallbacks; Step 4e replaced all three with this typed throw.

## Observability & dashboards (SPEC-017)

### Operational dashboard (Dashboard A)
The Prometheus-backed Grafana dashboard for conv-log sidecar *health* — provisioned as `monitoring/grafana/provisioning/dashboards/convlog-operational.json`. Reads the 11 sidecar Prometheus metrics (plus synthetic `up{job="conv-log"}`) scraped from `conv-log:9300/metrics`. Pattern-mirrors `mongodb.json` (stat row on top, timeseries below). Counterpart to the analytics dashboard. Synonyms to avoid: "metrics dashboard", "health dashboard" — prefer "operational dashboard (Dashboard A)".

### Analytics dashboard (Dashboard B)
The Postgres-backed Grafana dashboard for *browsing the conv-log analytical store* — provisioned as `monitoring/grafana/provisioning/dashboards/convlog-analytics.json`. Issues read-only `SELECT` against `vectordb:5432/convlog` via the `convlog_reader` datasource. Reproduces the five SPEC-016 README V-6 queries as living panels plus a count stat row, messages-per-day, recent-conversations, dead-letter inspector, and a gated drill-down row. Counterpart to the operational dashboard. Synonyms to avoid: "analytical dashboard" (use "analytics dashboard"), "SQL dashboard".

### `convlog_reader` datasource
The new read-only Grafana Postgres datasource (provisioning uid `convlog-postgres`, file `monitoring/grafana/provisioning/datasources/convlog-postgres.yml`). Connects as the `convlog_reader` Postgres role (`LOGIN`, `CONNECT` on `convlog`, `USAGE` + default-`SELECT` on schema `public`, created by `conv-log/ops/provision-postgres.sh:84-102`) with `sslmode: disable` and `access: proxy, editable: false`. Password is interpolated from the `GRAFANA_CONVLOG_DB_PASSWORD` env var (see below) via Grafana `secureJsonData.password: ${GRAFANA_CONVLOG_DB_PASSWORD}` — never hardcoded in committed YAML. Distinct from the `prometheus` datasource (uid `prometheus`) that already exists.

### `GRAFANA_CONVLOG_DB_PASSWORD`
The dedicated env var (Option A, chosen over parsing the password out of `CONVLOG_PG_READ_URI`) holding the `convlog_reader` password for Grafana to interpolate. Set in runtime `.env.prod` (gitignored), with a commented template in `.env.example` / `.env.prod.template` per the `.env.example:939` CONVLOG_* convention. MUST also be added to the `grafana` service `environment:` block in `docker-compose.monitoring.yml` (with a `:?` guard) so it exists in-container for interpolation. Known trade-off: duplicates the password already inside `CONVLOG_PG_READ_URI` — rotations must update both.

### Sync-lag SLO line
A horizontal threshold line on the operational dashboard's `convlog_sync_lag_seconds` timeseries marking the SPEC-016 NFR-2 steady-state P95 target of **600s** (= 2 × `CONVLOG_INTERVAL_SECONDS`, default 300). Distinct from the **alert-fire line** at **3000s** (the literal baked into the deployed `ConvLogSyncLagBreach` alert, `alerts.yml:179` = `max(10 × interval, CONVLOG_ALERT_MIN_LAG_SECONDS=900)`). Both lines render on the same panel; the SLO line is a target, the alert line is the fire threshold. Do not conflate the two.

### Drill-down row
A single Grafana row (`type: "row"`, `collapsed: true`) at the bottom of the analytics dashboard titled "Drill-down (raw content — authorized use only)". Holds the only panels that surface `conversations_dim.title` and/or `messages_log.text` — real prod PII. Collapsed by default so nested panels are neither rendered nor queried until an operator deliberately expands the row. This is the *design-level* privacy boundary (OSS Grafana 11.5 has no per-panel/per-dashboard RBAC; the single Grafana-admin gate, `GF_USERS_ALLOW_SIGN_UP=false`, is the only access control). Synonyms to avoid: "raw-content panel", "PII panel" — prefer "drill-down row".

### Default-privacy panel
Any analytics-dashboard panel in the always-visible (non-drill-down) view, constrained to counts, IDs, dimensions, and metadata only — never raw message text and (by default) never conversation titles. The complement of the drill-down row. Recent-conversations and PII-trigger panels are default-privacy: derived timestamps/counts and `entity_types`/`entity_count`, but no `title` and no redacted content.
