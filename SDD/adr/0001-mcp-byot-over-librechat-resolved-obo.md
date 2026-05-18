---
adr: 0001
title: Authenticate Entra-delegated MCP servers via LibreChat-resolved BYOT over OBO
status: Accepted
date: 2026-05-18
supersedes: null
superseded_by: null
tags: [cross-cutting, auth, mcp]
---

# ADR 0001: Authenticate Entra-delegated MCP servers via LibreChat-resolved BYOT over OBO

## Status

Accepted (2026-05-18)

## Context

LibreChat already ships a complete plumbing path for resolving user-scoped Microsoft Graph tokens at MCP-connect time: the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder constant (`packages/api/src/utils/oidc.ts:35`), the async preprocessor `resolveGraphTokenPlaceholder()` (`packages/api/src/utils/graph.ts:103`), the header templating pipeline in `processMCPEnv()` (`packages/api/src/utils/env.ts:276-399`), and the per-user OBO exchange in `GraphTokenService.getGraphApiToken()` (`api/server/services/GraphTokenService.js:8-80`), wired into `MCPManager` at `api/server/services/MCP.js:651`. This infrastructure is fully implemented but has had no consumer.

SPEC-014 introduces the first such consumer — the Softeria `ms-365-mcp-server` sidecar, configured as a streamable-http MCP server needing user-scoped Microsoft Graph tokens on every call. SPEC-014 REQ-006 mandates the BYOT pattern explicitly, and SEC-004 requires per-user audit attribution. Future MCP servers in this stack that need Microsoft Entra–delegated access (Power BI MCP, Dynamics 365 MCP, internal-tools MCP that proxies to Graph) will face the same auth question. Letting each such server run its own OAuth client would duplicate the token-acquisition path, fragment the audit trail, and (in Softeria's case specifically) inherit the race condition tracked as Softeria issue #187. RESEARCH-005's "Authentication Architecture" and "Decision Points" sections evaluate four candidate patterns; the BYOT-over-OBO path is the only one that reuses the existing LibreChat infrastructure without introducing per-MCP-server secret stores.

## Decision

For every MCP server in this stack that requires Microsoft Entra–delegated tokens, authentication is handled by LibreChat, not by the MCP server. The MCP server is configured as pure-BYOT: its YAML `headers.Authorization` (or equivalent env var) contains the placeholder `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` and the MCP container holds no client ID, client secret, refresh token, or OAuth state of any kind. At MCP-connect/preprocess time, `resolveGraphTokenPlaceholder()` calls `GraphTokenService.getGraphApiToken()`, which performs a JWT-bearer On-Behalf-Of exchange against Microsoft Entra using the signed-in user's OIDC token and the scopes declared in `OPENID_GRAPH_SCOPES`. The resulting short-lived user-scoped Graph token is injected into the outbound MCP request header. The cache key is `${user.openidId}:${scopes}`. The trust boundary is: LibreChat is the sole custodian of tenant credentials and the sole party performing the OBO exchange; MCP servers are transient token holders for the duration of a single in-flight request.

## Alternatives Considered

### LibreChat-resolved BYOT via OBO (chosen)

Reuses the placeholder/resolver/OBO pipeline already in the codebase. Single source of token truth, per-user audit trail by construction, no per-MCP-server secret store, transparent token refresh via `GraphTokenService` cache TTL, and no fork or customization needed for off-the-shelf MCP servers that support BYOT mode.

### Softeria-side OAuth (rejected)

Rejected. Softeria's bundled OAuth Authorization Code Flow (HTTP mode) has an unresolved race condition tracked as Softeria issue #187 (referenced in SPEC-014 REQ-006). Adopting it would also require provisioning a second Entra app registration (or sharing LibreChat's), persisting refresh tokens inside the MCP container, and reconciling two parallel token caches. None of these costs buy us anything once OBO works.

### App-only / service-principal authentication (rejected)

Rejected. A single service principal shared across users violates SPEC-014 SEC-004 (per-user audit reconstruction) and SEC-003 (read-only blast radius bounded by the signed-in user's own M365 permissions). It would also make every user appear in Graph activity logs as the same identity, defeating compliance review. Only viable for read-only shared-data scenarios, which this stack does not have.

### MCP-server-side independent OAuth flow (rejected)

Rejected. Per RESEARCH-005's "Authentication Architecture" §2, having each MCP server manage its own OAuth flow duplicates infrastructure LibreChat already owns: redirect handling, PKCE, token refresh, expiry tracking, and the consent UX. It also fragments the audit trail across N token stores. The cost scales linearly with the number of Entra-delegated MCP servers we add; BYOT keeps it at one.

## Consequences

### Positive

- Single source of token truth: LibreChat's `GraphTokenService` is the only OBO-exchange path, the only consent-prompt origin, and the only token cache.
- No per-MCP-server secret store: MCP containers hold no client ID, no client secret, no refresh token, no OAuth state (SPEC-014 REQ-003, SEC-001).
- Per-user audit trail by construction: every Graph call carries a token minted from a specific user's OIDC identity, attributable across LibreChat conversation logs and Graph activity logs (SPEC-014 SEC-004).
- Reuse of the `${user.openidId}:${scopes}` cache means consecutive tool calls within a conversation share one OBO exchange (SPEC-014 PERF-003).
- MCP servers become interchangeable as long as they support BYOT mode; swapping Softeria for another Graph MCP server is a config change.
- New Entra-delegated MCP servers cost only their own YAML entry plus optional new scopes — no new auth code.

### Negative / Trade-offs accepted

- MCP servers under this pattern are unusable outside LibreChat's request lifecycle: no offline runs, no cron-style invocation, no out-of-band background processing — every call needs a fresh user-scoped token resolved through an active session.
- Availability of all Entra-delegated MCP tools is coupled to LibreChat's OBO health. If `GraphTokenService` breaks, `OPENID_GRAPH_SCOPES` is misconfigured, or admin consent is revoked, every MCP tool fails simultaneously.
- The pattern constrains MCP-server selection to those that support BYOT (header-injected Bearer) mode. MCP servers that hard-code their own OAuth client and offer no BYOT toggle are ruled out without a fork.
- This pattern does not generalize beyond Microsoft Graph today. Other delegated-token providers (Salesforce, Google Workspace, etc.) would each need an analogous LibreChat-resolved placeholder, tracked as a phase-2 follow-up to LibreChat issue #11867.

### Neutral observations

- The OBO cache key includes the scope string verbatim, so changing `OPENID_GRAPH_SCOPES` invalidates all cached tokens on the next call — surfaced in SPEC-014 MODULE-003 risk.
- Scope changes also require Entra admin consent at the tenant level, which is not revertible via code (SPEC-014 MODULE-003).
- `mcpSettings.allowedDomains` enforcement (`api/server/services/MCP.js:419, 502`) is orthogonal to this decision but is the second gate for any new MCP server hostname.

## References

- SDD/requirements/SPEC-014-m365-mcp-integration.md (REQ-006, REQ-007, REQ-008, REQ-009, SEC-001, SEC-003, SEC-004, MODULE-001, MODULE-002, MODULE-003)
- SDD/research/RESEARCH-005-m365-mcp-integration.md (§"Authentication Architecture", §"Decision Points")
- LibreChat issue #11867 — general OBO-beyond-Graph (phase-2 follow-up)
- Softeria ms-365-mcp-server issue #187 — race condition in bundled OAuth, motivating BYOT
