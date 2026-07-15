---
adr: 0004
title: Authenticate Entra-delegated MCP servers via LibreChat-native OBO config
status: Accepted
date: 2026-06-24
supersedes: 0001
superseded_by: null
tags: [cross-cutting, auth, mcp]
---

# ADR 0004: Authenticate Entra-delegated MCP servers via LibreChat-native OBO config

## Status

Accepted (2026-06-24). Supersedes [ADR 0001](0001-mcp-byot-over-librechat-resolved-obo.md).

## Context

ADR 0001 chose to authenticate Entra-delegated MCP servers with a LibreChat-resolved
BYOT-over-OBO pattern, implemented on top of the placeholder plumbing LibreChat v0.8.5
happened to ship but had never wired to a consumer: the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`
header placeholder, `preProcessGraphTokens()`, `GraphTokenService.getGraphApiToken()`, and a
SPEC-014-custom `MCPCallQueue` for per-user concurrency. At v0.8.5 that was the only path
available — LibreChat had no first-class OBO feature, so SPEC-014 hand-rolled one.

Two things changed that premise:

1. **The v0.8.5 → v0.8.7-rc1 upgrade** (`feature-upgrade-15-06-26`) introduced a *native*
   MCP OBO path: a per-server `obo: { scopes }` config block (`OboOptionsSchema`),
   `resolveOboToken()` invoked from `MCPConnectionFactory.getOboTokens()`, the
   `OboTokenService.exchangeOboToken` resolver (jwt-bearer grant + per-`(user, scopes)`
   cache + single-flight coalescing + transient retry), a `MCP_SERVERS.CONFIGURE_OBO`
   permission, and an author-trust gate (`createOboTrustChecker`, which **bypasses the check
   for YAML/admin-sourced configs**). The resolved Graph token is applied as the connection's
   OAuth token rather than a per-call header.

2. **RESEARCH-015 established that the v0.8.5 MCP-to-agent bridge bug is fixed in v0.8.7-rc1.**
   The blocker that made SPEC-014's agent surface non-functional (the per-user MCP connection
   establishing at sign-in but reading `disconnected` at agent runtime) is resolved by
   upstream's runtime-reconnect logic (`reconnectServer` → `reinitMCPServer({ forceNew: true })`).
   The hand-rolled path was never the blocker; the bridge was.

Keeping the hand-rolled mechanism would perpetuate a ~1850-line fork of functionality upstream
now maintains first-class. The upgrade merge already had to *defer* upstream's competing OBO
refactor to preserve SPEC-014's path; that divergence blocks inheriting future upstream MCP
fixes. The custom path also carried code that was **defined but never wired into production**:
the structured error envelope (`errorEnvelope.ts`) and the JWT-invariant validation
(`validateGraphTokenInvariants`, the intended enforcement point for SEC-004 per-user attribution).

## Decision

Entra-delegated MCP servers authenticate via LibreChat's **native OBO config**.

**The core principle of ADR 0001 is preserved unchanged:** LibreChat is the sole custodian of
tenant credentials and the sole party performing the OBO exchange; the MCP server (the Softeria
`mcp-m365` sidecar) holds no client ID, secret, refresh token, or OAuth state — it is a transient
holder of a user-scoped Graph token for the duration of one request. Per-user audit attribution
by construction (SEC-004 in intent) and the read-only delegated-scope default (ADR 0002) both stand.

**The mechanism changes:**

- The server's `librechat.yaml` entry declares `obo: { scopes: "<space-separated Graph scopes>" }`
  instead of `headers: { Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}" }`.
- LibreChat resolves the per-user Graph token at connect time via `resolveOboToken` →
  `OboTokenService.exchangeOboToken` and injects it as the connection's OAuth token.
- Because `Microsoft365` is a YAML (admin-defined) server, the `CONFIGURE_OBO` author-trust gate
  passes by deployment-level trust (`createOboTrustChecker` returns `true` for non-DB-sourced configs).
- The SPEC-014 hand-rolled `MCPCallQueue` (`queue.ts`), error envelope (`errorEnvelope.ts`), and the
  `Microsoft365`-specific special-casing in `MCPManager` are retired. `GraphTokenService.js` and the
  `packages/api/src/utils/graph.ts` OBO/cache utilities are **kept** because they are shared with the
  non-MCP Entra people-search Graph-token endpoint (`AuthController` `graphTokenController`).

## Alternatives Considered

### LibreChat-native OBO config (chosen)

First-class, upstream-maintained, integrates with the `CONFIGURE_OBO` permission model, removes
~1850 lines of fork-specific code, and re-aligns the MCP auth path with upstream so future MCP
improvements are inheritable.

### Keep the hand-rolled BYOT placeholder + queue (rejected)

Rejected. Duplicates functionality upstream now ships natively, perpetuates a fork divergence that
the upgrade merge had to actively maintain, blocks adopting upstream MCP fixes, and keeps ~1850 lines
of custom auth/queue/error code (some of it never wired) on the maintenance burden.

## Consequences

### Positive

- ~1850 lines of fork-specific code removed; the MCP auth path re-aligns with upstream v0.8.7.
- Future upstream MCP auth/OBO improvements are inheritable without re-resolving the divergence.
- UI-created OBO servers are now governed by the `MCP_SERVERS.CONFIGURE_OBO` permission and the
  author-trust re-check (`isOboConfigStillTrusted`) — a capability the hand-rolled path lacked.

### Negative / Trade-offs accepted

- **Per-user concurrency cap dropped.** SPEC-014 REQ-024's `MCPCallQueue` (max 4 in-flight / 16
  queued per user) is gone. Microsoft Graph 429s are now surfaced through the connection error path
  rather than pre-empted by a local cap. Acceptable for the read-only phase-1 surface; re-introduce
  via a generic mechanism if telemetry later shows a need.
- **Cascading-timeout invariant (REQ-025) and protocol-version pin (REQ-027) dropped.** The MCP SDK
  negotiates protocol version; the connection carries its own timeout. The three-locus version pin
  (`librechat.yaml` / `MCPManager` / `mcp-m365/VERSION`) is no longer enforced in code.
- **SEC-004 JWT-invariant validation is not carried over.** `validateGraphTokenInvariants`
  (audience / tenant / `oid` / `appid` claim checks) was defined in the hand-rolled path but **never
  invoked in production** — the live `getGraphApiToken` path did not call it. Dropping it is therefore
  a documentation of a pre-existing gap, not a new regression. The native path trusts Entra's OBO
  response. If claim-level enforcement is required, it must be added to the native path explicitly.

### Neutral observations

- Graph scopes now live in `librechat.yaml` `obo.scopes` (space-separated, OAuth grant format)
  instead of the `OPENID_GRAPH_SCOPES` / `GRAPH_API_SCOPES` env vars. Entra admin consent is unchanged.
- The `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder pipeline (`preProcessGraphTokens`) remains in the
  shared connection code as dormant infrastructure; no MCP server references the placeholder after this
  change, so it is a no-op until a future server opts back into it.

## Follow-up amendments

### 2026-07-15 — native OBO defect found + patched (fork-local edits to upstream MCP internals)

Live testing on the `chat-test` box (v0.8.7-rc1 + M365) surfaced a defect in the **inherited**
native OBO path that qualifies the "fully inheritable / re-aligned with upstream" framing in
Consequences above: the OBO resolver is not threaded through *every* connection-creation path, so
an OBO server intermittently falls back to standard OAuth and prompts the user to
"Sign-in to mcp-m365" on a loop (Finding #6 in `docs/test-verification-015-m365-obo-v0.8.7.md`).

Root cause: `usesObo` (in `MCPConnectionFactory`) requires `serverConfig.obo && oboTokenResolver &&
user`; two upstream call sites build the connection without the resolver, so `usesObo` is false and
`getOAuthTokens` throws `ReauthenticationRequiredError`:
- `MCPManager.callTool` — dropped the `oboTokenResolver`/`oboTrustChecker` its caller
  (`api/server/services/MCP.js`) already supplies and forwarded no resolver into `getConnection`.
- `OAuthReconnectionManager.tryReconnect` — background reconnect built with only `{ id: userId }`;
  OBO needs the user's live OpenID assertion (`extractOpenIDTokenInfo`), which a background job lacks.

Fork-local fix (`6631a4f7a`): `callTool` forwards `graph`/`obo` resolvers into `getConnection`;
`tryReconnect` skips OBO servers (`config.obo != null`) and clears their tracking. +2 regression
tests. **Verified live** (clean OBO establishment, silent reuse, zero `oauthRequired` over 30m).

**⚠️ Upstream-merge re-check — DO THIS ON THE NEXT LibreChat upstream merge.** These are edits to
**upstream files**, so a future merge can silently clobber them or conflict. CI does **not** run on
the pablo/feature merge path (SPEC-018 Item 15 gap), so this re-check is manual:
1. `packages/api/src/mcp/MCPManager.ts` — `callTool` still forwards
   `graphTokenResolver`/`oboTokenResolver`/`oboTrustChecker` into `getConnection`.
2. `packages/api/src/mcp/oauth/OAuthReconnectionManager.ts` — `tryReconnect` still short-circuits
   OBO servers before attempting `getUserConnection`.
3. Explicitly run `cd packages/api && npx jest src/mcp/__tests__/MCPManager.test.ts
   src/mcp/oauth/OAuthReconnectionManager.test.ts` — the two regression tests guard both edits.
4. If upstream has since fixed the resolver threading itself, **drop our patch** (prefer upstream);
   otherwise preserve/re-apply. Strongly consider **upstreaming** this fix so it stops being fork-local.

Invariant to preserve regardless of implementation: **every MCP connection-creation path for an OBO
server must receive `oboTokenResolver` (so `usesObo` is true), or must not attempt the connection at
all** (background / no-live-assertion contexts).

## References

- SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md (superseded by this ADR)
- SDD/adr/0002-readonly-default-delegated-graph-scopes.md (still in force)
- SDD/research/RESEARCH-015-librechat-agent-bridge-byot-mcp.md (bridge-fix verification + migration outcome)
- SDD/requirements/SPEC-014-m365-mcp-integration.md (original integration spec)
- docs/m365-mcp-features.md (operator/user-facing description)
