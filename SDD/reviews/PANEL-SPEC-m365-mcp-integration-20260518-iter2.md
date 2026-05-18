# Spec Review Panel: M365 MCP Integration (SPEC-014) — Iteration 2

**Date:** 2026-05-18
**Iteration:** 2 (after iter1 fix loop)
**Spec reviewed:** SDD/requirements/SPEC-014-m365-mcp-integration.md (468 lines, post-iter1 fixes)
**Research context:** SDD/research/RESEARCH-005-m365-mcp-integration.md
**Iteration-1 panel:** SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518-iter1.md (with Findings Addressed appended)
**Panel:** security, performance, api-contract, module-depth, privacy, reliability

## Executive Summary

After dedup, the panel returns **1 HIGH, 11 MEDIUM, 12 LOW** — a substantial improvement on iter1's 9H/11M/6L. The single HIGH is a fresh structural concern raised by Reliability: REQ-018's healthcheck conflates liveness and readiness, which interacts badly with the (still spec-only) REQ-021 single-flight contract to amplify thundering-herd risk on transient sidecar restarts. The MEDIUM cluster is not scattered — it concentrates on three themes: (1) spec-vs-code drift in `GraphTokenService` (REQ-021 single-flight and REQ-022 scope-key normalization are documented but not implemented today, flagged by both Performance and Security-adjacent reliability), (2) deferred or under-pinned API contracts (Bearer JWT claims, MCP error envelope shape, MCP protocol version pin), and (3) cascading-timeout / restart-budget interactions (Reliability + Performance overlap on REQ-024 queue semantics). Module-depth, Privacy, and API-contract no longer surface any HIGH findings. The iter1 H-class issues around audit log content, EU Data Boundary, scope justification, healthcheck contract, supply-chain pinning, and ADR alignment are all verified resolved in their respective partials.

## Verdict

**REVISE BEFORE PROCEEDING**

The single HIGH (liveness/readiness conflation) and the cross-domain MEDIUM cluster around `GraphTokenService` (REQ-021/022 spec-vs-code gap, flagged independently by Performance and reinforced by Reliability's restart-cascade analysis) jointly gate proceeding. Both are fixable inside the spec layer plus narrowly-scoped code-or-OD changes — neither requires re-architecture. Specifically: split healthcheck into liveness vs readiness probes (Reliability H), promote REQ-021 and REQ-022 to numbered Open Decisions with release-gate language and unit-test contracts (Performance M ×2), bound the REQ-024 queue-wait below the outer MCP timeout with headroom (Reliability M / Performance M overlap), and pin REQ-027's protocol version literal at spec-finalization (API-contract M / Reliability M overlap). HIGH count strictly decreased (9 → 1), so the SDD loop continues; an iter-3 review after the fix pass should be brief.

## Iteration-to-Iteration Comparison

| | HIGH | MEDIUM | LOW | Verdict |
|---|---|---|---|---|
| Iter 1 (post-dedup) | 9 | 11 | 6 | STOP AND RECONSIDER |
| Iter 2 (post-dedup) | 1 | 11 | 12 | REVISE BEFORE PROCEEDING |
| Delta | -8 | 0 | +6 | improved |

HIGH count strictly decreased: ✓ (this gates the loop continuation per the SDD flow protocol).

The +6 LOW delta reflects refinement, not regression — several iter1 HIGH/MEDIUM concerns were resolved at the contract level and what remains are downgraded edge-case observations (e.g., audit-log negative assertion residue, `wget` probe portability, `serverInstructions` content-version marker, idempotency for phase-2, tool-name prefix enforcement, namespacing convention, OPS-004 module ownership crumb, PERF-003 cross-module ownership).

## Findings by Specialist

#### Security Findings

- **MEDIUM** SSRF allowlist remains hostname-only with documented weakness
  - Evidence: REQ-005 / SEC-008 / OD-2 (line 85, 120, 263): "`mcpSettings.allowedDomains` adds a single bare-hostname entry `mcp-m365`"; SEC-008 calls this "an explicitly documented inherited weakness."
  - Risk: Any process bound to the `mcp-m365` hostname (e.g., a future malicious or misconfigured sidecar reusing that name on `default`/`caddy_net`) would pass the allowlist regardless of port/scheme; allowlist gives no protection against in-stack lateral redirect.
  - Resolution: Add a REQ asserting (a) Docker Compose `container_name: mcp-m365` is unique on `caddy_net` (no other service may claim that DNS name), and (b) the implementation PR includes a `grep`-style CI assertion that no other compose service shares the hostname, until `isDomainAllowedCore` is tightened.

- **MEDIUM** Egress restriction in SEC-006 is opt-out-able via "operationally infeasible" escape hatch
  - Evidence: Step 2 note (line 334): "if egress restriction is operationally infeasible in the phase-1 sprint, this is documented as a residual risk in the rollout checklist and is closed under OD-6."
  - Risk: SEC-006(b) ("constrains outbound network egress to `graph.microsoft.com:443` only") becomes aspirational; a compromised sidecar could egress anywhere on 443 (exfiltrate Graph data to attacker-controlled host using the in-flight Bearer token within its 1h TTL).
  - Resolution: Promote egress restriction to a release gate: implementation PR MUST ship at least one concrete mechanism (egress proxy container OR `iptables` OUTPUT rule OR Docker user-defined network with no default route + explicit route). Remove the "documented residual risk" fallback from Step 2.

- **LOW** `Files.Read.All` + `Sites.Read.All` over-scope rationale relies on compensating controls that are partial
  - Evidence: REQ-008 (line 88-89): scopes are tenant-wide read; rationale cites SEC-003, SEC-004, PERF-004 (rate limit).
  - Risk: Compensating controls are valid but do not bound the *agent-driven* exfiltration risk (LLM prompt-injected to enumerate all SharePoint sites the user can read); read-only does not equal low-blast-radius when the agent is the attacker.
  - Resolution: Add a REQ that `serverInstructions` (UX-002) explicitly instructs the model not to enumerate without an explicit user-stated target, and that prompt-injection-resistant phrasing is added (e.g., "do not search unless the user names a site/folder"). Reference SPEC-009 PII pipeline (REQ-019) as the catch.

- **LOW** Audit log content discipline is well-specified but lacks negative assertion in Verification [also flagged by Privacy as Verification Plan gap]
  - Evidence: SEC-004 (line 116) defines metadata-only audit record; Verification §6 only asserts absence in `mcp-m365` logs, not in LibreChat-side audit logs.
  - Risk: A future logging change in `MCPManager` or `processMCPEnv` could spill request body / response body / Authorization header into LibreChat-side logs and pass verification.
  - Resolution: Extend Verification §6 (or add §11) with a negative assertion against LibreChat `api` container logs: `grep -E 'Bearer eyJ|"body":|recipient' api` returns no hits during a representative tool-call session.

Areas explicitly verified: BYOT trust boundary (REQ-006/020/SEC-001 — clear, sidecar treats token as opaque, header omitted when null); Softeria image pinning (REQ-002 / OD-1 — release gate with integrity hash, non-root, RO FS, no-new-privileges); phase-1 scope set (REQ-008, read-only, ADR-aligned); rate limiting (REQ-024 per-user/per-conversation + Graph 429 surfacing); cascading timeout (REQ-025); MCP protocol version pin (REQ-027); sidecar log content (SEC-007 with negative assertion in Verification §6); confused-deputy (mitigated — sidecar never elevates, OBO is user-scoped); secrets-in-spec examples (none — placeholders only); rate limit on MCP endpoint (REQ-024 covers); cryptographic primitives (N/A — token treated as opaque, rationale stated); resource limits (REQ-026); single-flight OBO (REQ-021) preventing thundering-herd as a security control.

#### Performance Findings

Reviewer: Performance Specialist. Spec re-read in full; cross-checked against `api/server/services/GraphTokenService.js` (current implementation) to verify whether REQ-021/REQ-022 are aspirational vs. realized.

**Checked and PASSED**

- **PERF-001 (cold-start budget):** Now carries an explicit 5s target, p50/p95/p99 measurement plan over a 7-day rolling window, an alert at 80% of `initTimeout`, and a tightening commitment (≤30s after 10 stable restarts). Anti-pattern "cold start tolerance unbounded" resolved.
- **PERF-002 (steady-state latency budget):** Tail latency now explicitly budgeted — `p50 ≤ 1s, p95 ≤ 3s, p99 ≤ 8s` end-to-end, plus MCP-hop-only `p95 ≤ 100ms`. Spans (a) OBO duration, (b) MCP hop, (c) Graph RTT all named. Anti-pattern "tail latency not budgeted" resolved.
- **PERF-003 (token reuse + refresh):** Now specifies refresh-at-T-5min instead of refresh-on-expiry, references REQ-022 normalization, and references REQ-021 single-flight coalescing. Anti-pattern "missing cache strategy" and "token cache key shape leak" resolved at the spec level.
- **PERF-004 (tool-list registration cost):** New requirement covers tool-list payload size (<200KB), registration latency (<2s), and prompt-token cost (<10K). Anti-pattern "unbounded MCP tool surface" addressed at acceptance gate (REQ-012 still relies on framework lazy loading, but PERF-004 makes the cost observable).
- **REQ-018 (`service_healthy`):** Now uses `condition: service_healthy`, healthcheck with `interval: 10s / timeout: 3s / retries: 5 / start_period: 30s`, with OD-5 closure required pre-merge. Anti-pattern "container start ordering" resolved.
- **REQ-024 (per-user concurrency cap):** 4 concurrent per user / 8 per conversation with a defined queue ceiling and Throttled error class — bounds the per-user fan-out hot path.
- **REQ-025 (cascading timeout discipline):** Inner Graph timeout strictly < outer MCP `timeout: 45000`, target 30s, with a documented fallback (proxy / netns timeout) if Softeria does not expose configuration. Prevents socket-leak + retry-amplification.
- **REQ-026 (resource limits):** Explicit `deploy.resources.limits` and `reservations` — caps memory/CPU so a hung sidecar cannot starve the API container.
- **Verification Plan §Performance measurement:** Concrete 7-day measurement plan with p50/p95/p99 aggregation, alert thresholds, and PRE-RESEARCH-013 handoff for automation.

**Findings (new this iteration)**

- **[M] REQ-021 single-flight is specified but NOT implemented in current `GraphTokenService.js` — release-gate ambiguity** [also flagged by Reliability via restart-cascade analysis]
  - Evidence: `api/server/services/GraphTokenService.js:34-69` shows the current implementation reads from cache, then issues `client.genericGrantRequest()` unconditionally on miss with no in-flight map / promise coalescing. Cache write happens *after* the await. Two concurrent callers for the same `${user.openidId}:${scopes}` cache key on a cold cache will both miss, both fire OBO requests, and both write the same key. The spec's REQ-021 says "If single-flight is not yet implemented in `api/server/services/GraphTokenService.js`, this requirement is a blocking dependency for production rollout" but does not list this in OD-6 or any explicit Open Decision — so the release-gate is buried in the requirement body. The "Restart thundering-herd" negative test (Verification §Negative tests) will fail today against the current codebase.
  - Risk: Thundering-herd on API restart against `login.microsoftonline.com` for N concurrent users. Worse, Entra throttles OBO with HTTP 429; a synchronized restart of N≥50 users could trip throttling and cascade to every user experiencing `Throttled` for several minutes (PERF-004 throttle path), inverting the recovery profile of a "clean restart." Cache write-after-await also creates a write-amplification window on every cache miss even for sequential callers.
  - Resolution: Promote REQ-021 to a NEW Open Decision (e.g., OD-7) listed alongside OD-1/OD-5/OD-6 as "RESOLVED before merge of implementation PR" with the concrete implementation contract: `Map<cacheKey, Promise<TokenResponse>>` cleared in `finally`. Add a unit test pinning the single-flight invariant (assert OBO call count = 1 for K concurrent callers on the same key). Until the code lands, the Verification Plan §Negative test "Restart thundering-herd" is a known-failing test, not an acceptance gate — flag this explicitly.

- **[M] REQ-022 scope-key normalization is specified but NOT implemented — silent cache-miss amplification today**
  - Evidence: `GraphTokenService.js:34` constructs the key as `${user.openidId}:${scopes}` with `scopes` taken verbatim from the caller. Callers pass `OPENID_GRAPH_SCOPES` env or `DEFAULT_GRAPH_SCOPES` (whichever is set), so the order/whitespace/casing depends on env content. The REQ-008 phase-1 list (`User.Read,Mail.Read,Calendars.Read,Files.Read.All,Sites.Read.All,Contacts.Read,Tasks.Read,Notes.Read.All,offline_access`) and any future re-ordering would invalidate the cache for every user simultaneously — a synchronized cache flush is structurally identical to a restart thundering-herd.
  - Risk: Any maintenance edit of `.env.prod` `OPENID_GRAPH_SCOPES` (even cosmetic re-ordering) flushes the entire OBO token cache and, in combination with the unresolved REQ-021, triggers the thundering-herd profile against Entra. Operators have no warning sign — the env edit looks safe.
  - Resolution: Same disposition as REQ-021 — promote to a numbered release-gate Open Decision with a concrete normalization spec (trim, lowercase, sort, comma-join with no spaces) and a unit test asserting `cacheKey("Mail.Read, User.Read") === cacheKey("user.read,mail.read")`. Optionally hash to keep keys short. Until then, document in the Implementation Plan that `.env.prod` `OPENID_GRAPH_SCOPES` MUST NOT be edited cosmetically.

- **[L] PERF-004 acceptance is "verify at first deploy" but has no fallback if a target is breached**
  - Evidence: PERF-004 says "If costs exceed these targets, the implementation MUST either configure a Softeria tool-subset flag (if available), or document the elevated cost in this spec and accept the trade-off." The "document and accept" branch is open-ended; the spec does not name who accepts it or whether tool-list payload >200KB blocks rollout.
  - Risk: An undersized Softeria tool surface decision (e.g., 70+ tools all eagerly registered, ~250KB tool-list, ~14K prompt-token cost per conversation) could quietly inflate every Microsoft365-enabled conversation's prefill cost. With prompt-caching the impact is bounded but non-zero, and on cache miss it's a recurring real cost.
  - Resolution: Tighten PERF-004 to: if any of the three targets is breached, rollout is blocked pending either (a) Softeria subset configuration, or (b) explicit acceptance in writing by the same stakeholder who owns OD-6. Add a concrete escape hatch — e.g., "if Softeria does not expose a subset flag, the implementation PR adds a thin proxy that filters the tool-list response to a phase-1 allowlist (Mail, Calendar, OneDrive, SharePoint, Contacts, Tasks, Notes, profile)."

- **[L] Cold-start measurement plan is manual in phase 1 — no automation, no regression detection between deploys**
  - Evidence: PERF-001 / PERF-002 measurement plan is "scrape MCPManager logs... manual review in phase 1; observability automation tracked under PRE-RESEARCH-013." There is no commitment to the cadence of manual review (weekly? per-deploy? on-incident?). A regression after a Softeria version bump (REQ-002) would only surface when someone happens to scrape logs.
  - Risk: Tail-latency drift is invisible until it hits a user. p99 = 8s is a generous budget, but without a between-deploy comparison there's no way to know if a Softeria update moved p95 from 1s to 2.5s — both pass the target individually.
  - Resolution: Add a concrete cadence — "scrape and compute p50/p95/p99 on every Softeria version bump (REQ-002) and weekly for the first 4 weeks post-rollout; compare to the prior baseline; regression of >50% on any percentile blocks the next deploy until investigated." Cheap automation: a 30-line script that grep+jq's the logs and compares against a stored baseline in `mcp-m365/perf-baseline.json`.

- **[L] REQ-024 rate limit semantics ambiguous — queue-with-timeout vs immediate-reject** [also flagged by Reliability as cascading-timeout interaction]
  - Evidence: REQ-024 says "Excess calls queue with a maximum wait of `timeout: 45000` ms before failing with a rate-limit error." This is a queue-then-timeout model: a 5th concurrent call waits up to 45s. If 10 calls arrive in burst, the 5th–10th all share the 45s wait window. There is no specification of queue ordering (FIFO?), queue size cap (what if 100 arrive?), or fairness across users vs conversations (the 4-per-user and 8-per-conversation limits can interact).
  - Risk: Under burst load, a user could see arbitrary tail latency up to 45s on the 4th+ concurrent call — a poor UX for what looks like "one chat command." Also, queue without a depth cap is itself an unbounded resource (memory + scheduler pressure on the API container, which is more constrained than the sidecar).
  - Resolution: Specify queue FIFO + a maximum queue depth (e.g., 16 per user, 32 per conversation, fail-fast with `code: "Throttled"` beyond that). Also clarify whether "queue with 45s max wait" applies to the per-user OR per-conversation limit (or both, with the tighter winning). Verification §Negative §Throttling should assert both the queueing branch AND the immediate-reject branch.

**Anti-patterns scan — net status**

| Anti-pattern | Status |
|---|---|
| Cold start tolerance unbounded | RESOLVED (PERF-001) |
| Synchronous external call on hot path without caching/circuit-breaker | RESOLVED (PERF-003 cache + REL-002 breaker) |
| Missing cache strategy for read-heavy operation | RESOLVED (PERF-003) |
| Write amplification | PARTIAL — `GraphTokenService` writes cache after every miss with no single-flight (REQ-021 spec'd, not implemented) |
| Polling instead of events | N/A (deploy uses healthcheck event; in-loop control uses framework reconnect) |
| Token cache key shape leak | PARTIAL — REQ-022 spec'd, not implemented |
| Tail latency not budgeted | RESOLVED (PERF-002) |
| Unbounded MCP tool surface | RESOLVED at observability level (PERF-004); the actual surface is still framework-governed (REQ-012) |
| Thundering herd on cache miss | PARTIAL — REQ-021 spec'd, not implemented; OPS-004 mitigates operationally |

**Net assessment:** PERF-001/002/003/004 and REQ-018/024/025/026 substantially close the iter-1 hot-path gaps at the specification layer. The remaining performance risk is the iter-1 H-finding about thundering-herd: the spec now describes the right contract (REQ-021/022) but the *code* still has the same `GraphTokenService.js` that motivated the finding, and the release gate is hidden in requirement prose rather than the OD list. Promoting both to numbered Open Decisions converts the M-findings to L.

#### API Contract Findings

- **M** Bearer token contract underspecified at the JWT/audience level
  - Evidence: REQ-020 names the audience (`https://graph.microsoft.com`) and the opaque-treatment rule, but never pins (a) the issuer (`https://login.microsoftonline.com/<tenant>/v2.0` vs `sts.windows.net/<tenant>/`), (b) the expected `appid`/`azp`, (c) the JWT version (`ver` 1.0 vs 2.0), or (d) the minimum residual TTL on the token presented to the sidecar. PERF-003 mentions a 5-min refresh window but it's described as a cache hint, not a header contract. The sidecar is told to treat the token as opaque, yet REQ-007 wires it through `GraphTokenService` which DOES need these invariants to detect a misconfigured OBO (wrong tenant, v1 token, app-only token). Without a stated contract, a future refactor that swaps OBO for `.default` daemon flow silently violates SEC-004 (per-user attribution) with no contract test to catch it.
  - Risk: Silent regression to app-only auth; auditability of SEC-004 erodes; no acceptance criterion fails when the token shape drifts.
  - Resolution: Add to REQ-020: required `iss` pattern, required `aud=https://graph.microsoft.com`, required `oid`/`upn` claims for SEC-004 join key, JWT `ver=2.0` expected, and a minimum remaining-lifetime invariant (e.g., ≥60s) before header emission. Add a smoke-test assertion that decodes the header (in a controlled test path) and validates these claims, OR a `GraphTokenService` invariant check that throws if `aud`/`iss` are unexpected.

- **M** Error envelope deviates from MCP `tool_result.content` shape; field is non-standard
  - Evidence: The "Error Response Schema" section defines a JSON object with `isError: true` at the top level alongside `code`, `message`, `graphCode`, etc. — but MCP `tools/call` results carry `isError` as a sibling of `content: [{type: "text", text: "..."}]` per the MCP spec. The spec says "carried in the MCP `tool_result.content` with `isError: true`" which conflates two layers: `isError` is a peer of `content`, and the structured fields belong INSIDE a `content` entry (either as `type: "text"` with stringified JSON, or — when supported — a structured content type). As written, an implementer could emit `{ isError: true, code: ... }` AS the content payload, which the MCP client SDK will not parse uniformly across versions. REQ-024 and REL-001 both reference "the error response schema" without disambiguating the wire format.
  - Risk: Tool-loop drift between LibreChat's MCP client and the sidecar; some error codes parse, others render as raw JSON to the user; CI assertions against the schema may pass against the wrong layer.
  - Resolution: Specify the exact wire shape: `{ "isError": true, "content": [{ "type": "text", "text": "<stringified JSON of {code, message, graphCode, graphMessage, correlationId, retryAfter}>" }] }` — OR commit to a structured content variant and pin the MCP protocol revision that supports it (ties into REQ-027). Add one verification step that asserts the on-wire shape, not just the field names.

- **M** REQ-027 MCP protocol version pin is deferred, not pinned [also flagged by Reliability as ProtocolMismatch / circuit-breaker interaction]
  - Evidence: REQ-027 says the targeted MCP protocol revision is "filled in by the implementation PR" with "expected: the rev that LibreChat's `MCPManager` advertises at spec-finalization." This is a TODO masquerading as a contract. A spec that defers its protocol version pin to the implementation PR cannot be reviewed for protocol-mismatch behavior, and the `ProtocolMismatch` error code in the error schema has no stable reference. The MCP protocol has evolved (`2024-11-05` → `2025-03-26` → `2025-06-18` revisions, each with breaking changes to streamable-http framing); leaving this unbound exposes anti-pattern #7.
  - Risk: Sidecar advertises a newer revision than `MCPManager` supports; circuit breaker loop hides it; or the inverse, where LibreChat upgrades and Softeria's pinned version no longer speaks the advertised revision.
  - Resolution: At spec finalization, inspect `@librechat/agents` / `MCPManager` source for the advertised `protocolVersion` constant and write the literal value into REQ-027 BEFORE the implementation PR. Add a smoke assertion (verification §8 already drafts this) that compares the advertised value to the literal — failing the build on drift.

- **L** Idempotency contract absent for retryable tool calls
  - Evidence: Phase 1 is read-only (SEC-003), so write-side idempotency keys are not needed. However, REL-001 / REL-002 / REQ-024 describe retry and reconnect paths, and PERF-003 mentions OBO refresh. There is no statement that read tool calls are safe to retry on `UpstreamUnavailable` / `Throttled` (they are, but stating it makes the contract explicit) and no warning that phase 2 (when writes ship) MUST introduce a `client-request-id`-derived idempotency key to avoid double-send on retry.
  - Risk: When phase 2 enables writes, the existing retry path (REL-002 circuit breaker) silently becomes a double-send vector; no spec hook flags this.
  - Resolution: One sentence in REL-001 stating "phase-1 tool calls are idempotent by virtue of read-only scopes (SEC-003); phase-2 write tools MUST adopt `client-request-id` as an idempotency key before the retry path can engage on writes."

- **L** Tool-name namespacing convention not enforceable as written
  - Evidence: UX-001 declares the convention `Microsoft365_<tool>` to prevent collision with other MCP servers. But the actual tool names come from the upstream Softeria server's tool registry — LibreChat does not rewrite them. The MCP `tools/list` response carries tool names as-published; without a LibreChat-side prefixing layer, a Softeria tool named `search` will surface as `search`, not `Microsoft365_search`. The spec doesn't identify which side enforces the prefix.
  - Risk: REQ-027 / UX-001 contract claim that the agent builder shows `Microsoft365_<tool>`, but reality shows raw Softeria names; future addition of a `Slack` MCP server with a `search` tool collides exactly as anti-pattern #10 predicts.
  - Resolution: Either (a) verify Softeria already publishes prefixed tool names and cite the upstream evidence in REQ-002 / UX-001, or (b) add a requirement that LibreChat's `MCPManager` applies a `<serverKey>_` prefix on `tools/list` responses (this may already be the case — confirm in `@librechat/agents` or `packages/api/src/mcp/MCPManager.ts`), or (c) document that the convention is enforced by Softeria upstream and pin a verification step.

- **L** `serverInstructions` content is not version-pinned
  - Evidence: REQ-028 governs co-update with scope changes (good), but the `serverInstructions` text itself is a free-form string in `librechat.yaml`. The spec does not assign it a content version (e.g., a leading `# v1` comment or a hash) so the verification "diff against REQ-008 scope set" step in §7 has no stable baseline to diff against.
  - Risk: Anti-pattern #9 (serverInstructions drift) — a well-meaning edit to wording silently changes prompt-time behavior with no CI signal.
  - Resolution: Embed a content-version marker in `serverInstructions` (e.g., trailing `(v1, 2026-05)`) and have the REQ-028 CI step assert both the version marker and a checksum-or-grep over the surface list match REQ-008.

Checked areas with no findings: error envelope canonical `code` enumeration is complete and well-mapped (Error Response Schema §); rate-limit headers are addressed via `Retry-After` preservation (REQ-024); pagination contract is N/A in phase 1 (read-only delegated Graph paginates via Graph's `@odata.nextLink`, which is upstream); request size limits are out of scope (no LibreChat-originated payloads larger than tool args). OD-1 supply-chain pin is RESOLVED with a stated release gate; OD-5 healthcheck contract is RESOLVED with empirical determination + fallback.

#### Module Depth Findings

Re-evaluated three module boundaries against deep-module criteria and the iter1 fix items. Net: previous structural defects appear resolved; two minor cohesion notes remain.

- **L** OPS-004 ordering crosses MODULE-001 / MODULE-002 boundary, owned solely by MODULE-001
  - Evidence: SPEC-014 line 128 (OPS-004), MODULE-001 Spec refs include `OPS-004`, MODULE-002 Spec refs do not.
  - Risk: OPS-004 prescribes the ordered restart `mcp-m365` → wait healthcheck → `api`. The `api` half of that contract lives in MODULE-002's deployment surface (api consumes the placeholder and reconnect path). Assigning OPS-004 only to MODULE-001 makes the contract a one-sided invariant: an implementer changing MODULE-002's startup order has no module-level breadcrumb that OPS-004 binds them.
  - Resolution: Add `OPS-004` to MODULE-002 Spec refs (line 226). No copy change needed.

- **L** PERF-003 token-reuse outcome is owned by MODULE-002 but the cache-key shape it depends on (REQ-022) is owned by MODULE-003
  - Evidence: MODULE-002 Spec refs include `PERF-003`; MODULE-003 owns `REQ-022` (scope cache-key normalization) and `REQ-021` (single-flight). PERF-003 text (line 123) literally references `${user.openidId}:${scopes-normalized}` and "coalesced per REQ-021".
  - Risk: Mild cohesion smell — a single behavior (cache hit producing low p95) is split across two modules. Not depth inflation (each module hides distinct complexity: M2 the placeholder→header refresh trigger, M3 the cache-key invariant), but a reader tracing PERF-003 lands in M2 and must hop to M3 to find the cache-key contract.
  - Resolution: Either (a) add `PERF-003` to MODULE-003 Spec refs as a secondary owner, or (b) add one line under MODULE-002 "Depends on" pointing to REQ-022 as the prerequisite cache-key shape. (a) is the lower-cost fix.

**Verified resolved from iter1:**
- MODULE-002 risk tier: now **medium** (line 224) with explicit justification ("under-allocated downstream review depth and was corrected during the iteration-1 fix pass"). Plausible — module owns the only delegated-Graph-to-agent path and the only allowedDomains enforcement for the new hostname.
- MODULE-002 `Hides` inflation: fixed. The "Hides (newly introduced by this spec)" header (line 213) bounds the claim, and pre-existing infrastructure (`MCPManager`, `processMCPEnv`, `resolveGraphTokenPlaceholder`, `isMCPDomainAllowed`) is moved into a separate "Depends on (existing, unchanged)" block (lines 219–222) with file:line refs. Depth ratio now honest: small public interface (3 items) ≪ four genuinely new hidden contracts.
- All iter1-added requirements mapped: REQ-020 (M2), REQ-021/022 (M3), REQ-023/024 (M2), REQ-025/026/027 (M1; 027 also M2), REQ-028 (M2), REQ-029 (M3), REQ-030 (M2+M3); SEC-007/008 (M1+M2); PERF-001/002/004 (M1), PERF-003 (M2); OPS-001..004 (M1); REL-001/002 (M2), REL-003 (M1+M2); UX-001/002/003 (M2). No orphaned requirements.
- REQ-017 cross-module non-goal note (line 244): still appropriate; clearly flags it as not owned by any module and explains why.

**Anti-pattern scan (all clear):**
1. Modules section present and non-empty.
2. No pass-through wrapper — each module hides substantive complexity (Softeria tool surface; placeholder→header binding + allowlist + PII passthrough; consent + cache-key + phase boundary).
3. No getter/setter façade.
4. No public-method-per-private-field.
5. No wide-interface/thin-internals — interfaces are 3 items, 3 items, 2 items respectively.
6. Each module has a clear purpose.
7. No implementation types in public interface (HTTP endpoint, YAML keys, env-var name, Entra app-reg state).
8. No unjustified shallow modules.
9. Spec refs present on all three modules.
10. Risk tier present and justified on all three (M1 medium, M2 medium, M3 medium); justifications are scoped to what the module actually owns.
11. Depth inflation: resolved on MODULE-002 (see above). MODULE-001 `Hides` (lines 197–200) is bounded to Softeria internals + image build details and explicitly disclaims OAuth/secret state — accurate. MODULE-003 `Hides` (lines 235–238) is bounded to Entra portal flow, perm→endpoint mapping, cache-key implication, and phase boundary — accurate.

Recommendation: ship as-is or apply the two L-grade tweaks above; no blocking depth issues remain.

#### Privacy Findings

- **[M]** Tool-output PII detection requirement is asserted but not testable [also flagged by Security as Verification Plan negative-assertion gap]
  - Evidence: REQ-019 — "Output produced by `Microsoft365` tools ... traverses the same agent message path as any other tool result and is therefore in scope for SPEC-009 PII detection / redaction. This requirement records the expectation that no special-case bypass is introduced". The Verification Plan contains no test that asserts a SPEC-009 redaction actually fires on a Microsoft365 tool result; the only related test (§6, SEC-007) checks sidecar logs, not the agent message path. The Error Response Schema correctly carves out `isError: true` as a bypass signal, but the positive path is unverified.
  - Risk: Silent regression in the PII passthrough (e.g., a future change wrapping tool output in a typed envelope SPEC-009 doesn't recognize) bypasses detection on the highest-PII-density tool surface in the system (mail bodies, contacts, attendee identifiers). Anti-pattern #1.
  - Resolution: Add a smoke test to the Verification Plan that seeds a known PII token (e.g., a synthetic email/IBAN) into a test mailbox or contact, invokes a Microsoft365 read tool, and asserts the configured PII mode triggers on the resulting tool result message (`detect` produces a detection event; `warn` produces the warning). Reference the new test from REQ-019.

- **[L]** Data minimization at the tool boundary is aspirational, not enforced
  - Evidence: Privacy & Compliance Scope — "where Graph supports `$select`, tool wrappers apply projection. Known limitation: Softeria's tool shapes return full Graph object bodies by default; if the implementation cannot constrain this without a Softeria patch, the limitation is documented here and offset by SEC-007 (no payload logging) and the conversation-retention policy (REQ-029)." UX-002 directs the model via `serverInstructions` to request minimal fields, but this is a prompt-time hint, not a technical control. There is no requirement that the implementation verify whether Softeria honors `$select` projection for the phase-1 tool set.
  - Risk: Anti-pattern #9 — over-fetching Graph payloads into conversation history (e.g., full mail bodies when subject+sender would suffice) inflates the retention surface that REQ-029 governs and the PII surface that REQ-019 must process. Offsetting controls (SEC-007, REQ-029) are real but bound the harm rather than minimize the collection.
  - Resolution: Add a verification step that, for each phase-1 tool, records whether Softeria's wrapper passes `$select` through to Graph and what the default response shape is. If projection is not supported for a tool, document the specific over-fetch in this spec and accept the trade-off explicitly (rather than implicitly via SEC-007/REQ-029).

**Checked and clean (no findings):**
- Privacy & Compliance Scope subsection is present and explicit about in-scope (technical) vs out-of-scope (organizational/DPA-track) — scoping is clean per iter2 guidance.
- OD-6 explicitly names the governance handoff (joint-controller/processor determination, sub-processor registration of Softeria, customer privacy-notice update, DPO-equivalent acceptance of retention residual risk) as a blocking precondition for production rollout. Anti-pattern #8 / #10 resolved by clean scoping.
- SEC-004 audit record is metadata-only with explicit exclusion of bodies, query-string filter values, and recipient identifiers. Reconstruction model (LibreChat metadata ⋈ Graph activity log keyed by Entra user + correlation-id) is concrete. Anti-pattern #6 resolved.
- SEC-007 log-content discipline names the exact forbidden classes (auth headers, bodies, query-string filter values, mail subjects, recipient addresses, file names, attendee identifiers) and Verification §6 asserts absence (negative assertion). Testable.
- REQ-029 conversation-inherited retention is concrete (12 months, conversation-level, no separate tool_output store) with a blocking-dependency clause if the existing retention timer is absent. Anti-pattern #5 resolved.
- REQ-030 DSR technical handoff is actionable (conversation-erasure path cascades; SPEC-008 aggregates require re-aggregation). Runbook authoring correctly scoped out to DPO-equivalent. Anti-pattern #7 resolved.
- SEC-005 EU Data Boundary commitment is named with the tenant region and the only outbound surface (graph.microsoft.com) is identified. Anti-pattern #3 resolved.
- UX-003 surfaces GDPR Art. 13/14 transparency obligations and correctly hands the privacy-notice text to the notice owner. Anti-pattern #4 resolved at the spec level.
- REQ-008 least-privilege rationale for `Files.Read.All` / `Sites.Read.All` is explicit (delegated-permission ceiling, compensating controls, phase-2 revisit). Anti-pattern #2 acknowledged with documented trade-off.

#### Reliability Findings

- **H** Liveness/readiness conflation in single healthcheck (anti-pattern: missing liveness/readiness distinction)
  - Evidence: REQ-018 + Implementation Plan §2 use one healthcheck (`test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/health || wget -q --spider http://localhost:3000/mcp"]`) both for Compose `service_healthy` gating (readiness) and for Docker `restart: unless-stopped` triggering (liveness, per REL-003). REL-003: "A sidecar in 'up but unresponsive' state ... is detected by the Docker healthcheck ... and Docker `restart: unless-stopped` triggers a clean restart." REQ-018: "guarantees the sidecar is *ready* (not merely up-and-listening) before LibreChat attempts its initial connect."
  - Risk: A transiently-overloaded sidecar (GC pause, brief Graph backpressure) that should merely shed load (fail readiness, keep running, drain queue) is instead killed and restarted, triggering REQ-021 OBO single-flight cold-start AND `initTimeout: 150000` window for the entire user base on the next reconnect — a restart cascade plus thundering herd amplifier. Conversely, a sidecar that passes readiness but is actually wedged (event loop blocked on a Graph long-tail) won't be restarted because `/mcp` non-5xx returns from a lower layer than the wedged handler.
  - Resolution: Split into two probes — a fast cheap liveness probe (e.g., `/health` 200 returned by the HTTP server before queue) and a slower readiness probe (tool-registry-populated, Graph reachability ping). Use the liveness probe for Docker `healthcheck:` and a separate explicit readiness gate (or a separate `/ready` endpoint behind the same healthcheck with higher `retries`) for Compose `depends_on: service_healthy`. Document which probe REL-003 relies on for "hung but up" detection — currently ambiguous.

- **M** No max-wait / failure path on the prod-deploy readiness `until` loop (anti-pattern: single point of failure in operator workflow)
  - Evidence: Implementation Plan §6 prod deploy: `until [ "$(./prod.sh ps --format json | jq -r '.[]|select(.Service=="mcp-m365").Health')" = "healthy" ]; do sleep 2; done && ./prod.sh restart api`. No timeout, no break condition, no exit code propagation if `prod.sh ps --format json` errors or returns malformed JSON.
  - Risk: If the sidecar enters a crash-loop (e.g., Softeria fails to bind 3000 due to a base-image regression, or the pinned `<resolved-semver>` is yanked), the deploy SSH command blocks indefinitely, the `./prod.sh restart api` never fires, and the operator's terminal hangs without signal. Worse: a transient `jq` parse error returns empty string → still not `"healthy"` → loop runs forever silently.
  - Resolution: Add a bounded retry (e.g., `for i in $(seq 1 60); do ... && break; sleep 2; done`) with explicit failure on timeout, and verify `prod.sh ps --format json` exists as documented (currently no spec ref shows the `--format json` flag is supported by the wrapper). On timeout, abort the deploy and emit a clear operator message; do NOT fall through to `./prod.sh restart api` against an unhealthy sidecar.

- **M** Rate-limit queue wait stacks with outer MCP timeout (anti-pattern: hidden cascading timeout) [also flagged by Performance as REQ-024 queue semantics ambiguity]
  - Evidence: REQ-024: "Excess calls queue with a maximum wait of `timeout: 45000` ms before failing with a rate-limit error". The `Microsoft365` MCP entry also has `timeout: 45000` (REQ-004). REQ-025 further constrains Softeria's outbound Graph timeout to <45000 (target 30000).
  - Risk: A request that waits 44.9s in the rate-limit queue then begins execution has ~100ms before the outer MCP `timeout: 45000` fires, guaranteeing a timeout-after-queue and producing a misleading `UpstreamUnavailable` (or worse, a socket-leak / retry-amplification through the framework's reconnect circuit breaker REL-002). Queue-wait + Graph-RTT + MCP-hop must fit inside 45000ms or the timeouts compose adversarially.
  - Resolution: Set queue-max-wait strictly less than `timeout - (P99 Graph RTT + MCP hop)` — e.g., 30000ms queue, 30000ms Graph (REQ-025), 45000ms outer, with explicit headroom. Emit `code: "Throttled"` (REQ-024) on queue-timeout BEFORE the outer MCP timeout fires, so the agent receives the correct error class. Add a verification test: enqueue with a stalled Graph upstream and assert `Throttled` (not `UpstreamUnavailable`).

- **M** `ProtocolMismatch` interaction with REL-002 reconnect circuit breaker is unspecified (anti-pattern: retry amplification on deterministic failure) [also flagged by API-contract as REQ-027 deferred pin]
  - Evidence: REQ-027: "the connect MUST fail fast with a clear log line, not silently fall through to the circuit breaker retry loop." REL-002: "max 7 cycles, 45s window, exponential backoff". The spec asserts the desired behavior but doesn't say how `MCPManager` distinguishes a `ProtocolMismatch` connect from a transient transport failure.
  - Risk: If `MCPManager` treats any connect failure as transient, a deterministic ProtocolMismatch (e.g., after a Softeria upgrade bumps protocol) will burn the entire 7-cycle / 45s circuit-breaker budget every single API restart — a restart cascade that masks the real signal and delays detection by ~5–10 minutes per cycle. Worse, the API container is then permanently in a degraded state until a human notices.
  - Resolution: Specify the classification contract — `ProtocolMismatch` (and other deterministic failures: TLS handshake fatal, DNS NXDOMAIN, HTTP 501 on /mcp) MUST short-circuit the circuit-breaker retry loop and emit a single error log + structured event. Add a regression test that pins this behavior alongside the REL-002 test that pins the 7-cycle/45s values.

- **M** Restart loop has no backoff cap (anti-pattern: restart cascade) [reinforces Performance REQ-021 single-flight gap via amplification path]
  - Evidence: Implementation Plan §2: `restart: unless-stopped` with no `max_attempts` or backoff configuration. REL-003 + REQ-018 expect ~50s detection then a "clean restart" but say nothing about what happens if the restart itself fails (e.g., Softeria crashes on boot due to a transient Graph DNS failure causing the tool-registry to fail to populate within `start_period: 30s`).
  - Risk: A sidecar that fails its healthcheck shortly after boot (e.g., tool registration depends on a Graph metadata call that's currently failing) will enter an infinite restart loop at the Docker level. Each restart triggers a fresh REQ-021 OBO single-flight cold-start surge from the API side once `service_healthy` flickers true, then false again. The combined effect: a thundering herd on every restart cycle, multiplied by an uncapped restart rate.
  - Resolution: Use `restart: on-failure:5` (Docker Compose v3+) or add a `deploy.restart_policy` with `max_attempts: 5` and `window: 5m`. After exhaustion, the sidecar enters `dead` state and `Microsoft365` tools surface `SidecarUnavailable` per the error schema. Document this in REL-003.

- **L** Healthcheck `start_period: 30s` may be too tight given PERF-001's measurement-pending posture
  - Evidence: REQ-018 specifies `start_period: 30s`; PERF-001 says cold-start "MUST be tightened to ≤30000 ms once measured cold-start is confirmed stable across 10 restarts" — i.e., cold-start is not yet measured. `initTimeout: 150000` (150s) is the absorbing budget.
  - Risk: If real-world cold-start is anywhere between 30s and 80s (`start_period` + `interval 10s × retries 5`), the healthcheck reports `unhealthy` and Docker enters a restart loop before the first successful connect, even though the sidecar is on a normal cold-start path. Mismatch between `start_period` (30s) and the explicit acknowledgment in REQ-018 that cold-start is unknown (`initTimeout: 150000`).
  - Resolution: Align `start_period` with `initTimeout` (e.g., `start_period: 90s` initially) until PERF-001 measurement confirms the 5s target. Then tighten both `start_period` and `initTimeout` together as a single PR per the PERF-001 measurement gate.

- **L** Healthcheck depends on `wget` being present in the Softeria image (not verified)
  - Evidence: Implementation Plan §2: `test: ["CMD-SHELL", "wget -q --spider ..."]`. The base image is `node:22-alpine`, which does ship busybox `wget`, but Softeria's npm install may overlay a different filesystem or the spec's `read_only: true` (SEC-006) may interact poorly with wget's tmp usage.
  - Risk: Healthcheck silently fails because `wget` is missing or sandboxed, Docker reports `unhealthy` permanently, `api` never starts (REQ-018 `service_healthy`), and the whole stack is stuck. A read-only root filesystem (SEC-006) can break busybox `wget` if it tries to write a temp file.
  - Resolution: Pin a verified probe mechanism — either confirm busybox `wget --spider` works against the read-only FS (no tmpfile), or replace with a tiny `nc -z localhost 3000` or `node -e "require('http').get(...)"` probe. Add a verification step to Smoke Test §1 that explicitly asserts `docker compose exec mcp-m365 wget --help` succeeds before relying on it.

Checked areas with no findings: REQ-021 single-flight (well-specified with verification §7); REQ-025 cascading-timeout discipline (named explicitly); REL-002 circuit breaker (named with regression test); REQ-026 resource limits (clean OOM bounded); SEC-006 hardening posture; Verification negative tests cover stuck-stream (`docker pause`), upstream 5xx, missing consent, write-attempt, restart thundering-herd; rollback plan provides three independent escape hatches.

## Cross-Specialist Observations

Three multi-specialist convergences were identified:

1. **REQ-021/REQ-022 spec-vs-code drift** — Performance flagged both directly as M findings; Reliability's "Restart loop has no backoff cap" M finding amplifies through the same code path (uncapped restarts × no single-flight = thundering herd × restart count). Joint resolution: promote REQ-021 + REQ-022 to new numbered Open Decisions (e.g., OD-7, OD-8) with release-gate language, concrete normalization spec, and unit tests pinning single-flight + scope-normalization invariants. Then bounded restart policy (`on-failure:5`) becomes safe.

2. **REQ-024 queue / cascading-timeout interaction** — Performance flagged the queue semantics ambiguity (L); Reliability independently flagged the queue-wait-stacks-on-outer-MCP-timeout cascading-timeout anti-pattern (M). Same root cause: `timeout: 45000` is used for both the outer MCP call and the inner queue-wait ceiling, with no headroom budget. Joint resolution: set queue-max-wait to 30000ms (with FIFO + bounded queue depth), reserve the remaining 15000ms for Graph RTT + MCP hop, and emit `Throttled` on queue-timeout BEFORE the outer MCP timeout fires.

3. **Verification-Plan gap on cross-domain assertions** — Privacy flagged REQ-019 (PII detection on tool output is asserted but not tested in Verification Plan); Security flagged the audit-log negative-assertion residue (Verification §6 asserts absence in `mcp-m365` logs only, not in LibreChat-side `api` logs). Both are Verification Plan completeness gaps on assertions that the spec body already commits to. Joint resolution: extend Verification §6 (or add §11) with (a) a positive PII-detection smoke test seeding known PII into a Microsoft365 tool result, AND (b) a negative grep over `api` container logs for `Bearer eyJ|"body":|recipient`.

4. **REQ-027 deferred protocol pin** — API-contract flagged the deferred pin as an M (TODO masquerading as contract); Reliability flagged the same as an M via the ProtocolMismatch / REL-002 circuit-breaker interaction (deterministic failure burns the 7-cycle / 45s retry budget). Joint resolution: pin the protocol version literal at spec-finalization by inspecting `@librechat/agents` / `MCPManager` source, AND add the `ProtocolMismatch` short-circuit contract to REL-002 so deterministic failures escape the retry loop.

## Recommended Actions Before Proceeding

### HIGH

1. **Split healthcheck into liveness vs readiness** — Implementation Plan §2 + REQ-018 + REL-003. Resolution: define two probes (cheap `/health` for Docker `healthcheck:` and liveness restart, separate `/ready` or higher-retries gate for Compose `depends_on: service_healthy` readiness). Document which probe REL-003's "hung-but-up" detection relies on. Specialists: Reliability.

### MEDIUM

1. **Promote REQ-021 (OBO single-flight) to a numbered Open Decision with release-gate language** — REQ-021 + new OD entry. Resolution: add `Map<cacheKey, Promise<TokenResponse>>` cleared in `finally`, unit test pinning OBO call count = 1 for K concurrent callers, mark current Verification §Negative "Restart thundering-herd" test as known-failing until code lands. Specialists: Performance (primary), Reliability (amplification path).
2. **Promote REQ-022 (scope-key normalization) to a numbered Open Decision** — REQ-022 + new OD entry. Resolution: concrete normalization spec (trim, lowercase, sort, comma-join with no spaces), unit test asserting `cacheKey("Mail.Read, User.Read") === cacheKey("user.read,mail.read")`, Implementation Plan note that `.env.prod` `OPENID_GRAPH_SCOPES` MUST NOT be edited cosmetically until code lands. Specialists: Performance.
3. **Pin REQ-027 MCP protocol version literal at spec-finalization** — REQ-027. Resolution: inspect `@librechat/agents` / `MCPManager` source for the advertised `protocolVersion` constant, write the literal value into REQ-027 before implementation PR opens; add smoke assertion comparing advertised value to literal (verification §8 already drafts this). Specialists: API-contract, Reliability (via ProtocolMismatch interaction).
4. **Specify ProtocolMismatch and deterministic-failure short-circuit** — REL-002 + REQ-027. Resolution: classify `ProtocolMismatch`, fatal TLS, DNS NXDOMAIN, HTTP 501 as deterministic; short-circuit the 7-cycle circuit-breaker loop; emit single structured error log; regression test alongside REL-002 7-cycle test. Specialists: Reliability, API-contract.
5. **Bound REQ-024 queue-wait below outer MCP timeout with headroom** — REQ-024 + REQ-025. Resolution: queue-max-wait 30000ms (FIFO, max depth 16 per user / 32 per conversation, fail-fast `Throttled` beyond), 30000ms Graph, 45000ms outer; emit `Throttled` on queue-timeout BEFORE outer MCP timeout fires; Verification test asserts `Throttled` (not `UpstreamUnavailable`) on stalled-upstream-with-full-queue. Specialists: Reliability, Performance.
6. **Add restart backoff cap** — Implementation Plan §2 + REL-003. Resolution: `restart: on-failure:5` (or `deploy.restart_policy` with `max_attempts: 5`, `window: 5m`); after exhaustion sidecar enters `dead` state and tools surface `SidecarUnavailable`. Specialists: Reliability.
7. **Pin Bearer token JWT contract** — REQ-020 + SEC-004. Resolution: required `iss` pattern, `aud=https://graph.microsoft.com`, `oid`/`upn` claims for SEC-004 join key, `ver=2.0` expected, minimum residual TTL (≥60s) invariant before header emission; smoke test decodes header and validates, or `GraphTokenService` invariant throws on unexpected `aud`/`iss`. Specialists: API-contract.
8. **Pin MCP error envelope wire shape** — Error Response Schema §. Resolution: specify exact shape `{ "isError": true, "content": [{ "type": "text", "text": "<stringified JSON of {code, message, graphCode, graphMessage, correlationId, retryAfter}>" }] }`, OR commit to structured content variant and pin MCP protocol revision; one verification step assertion against on-wire shape. Specialists: API-contract.
9. **Bound the prod-deploy readiness `until` loop with timeout + failure path** — Implementation Plan §6. Resolution: replace open `until` with `for i in $(seq 1 60); do ... && break; sleep 2; done` (or equivalent), explicit timeout failure, do NOT fall through to `./prod.sh restart api` against unhealthy sidecar; verify `prod.sh ps --format json` flag is supported by the wrapper. Specialists: Reliability.
10. **Add Verification Plan smoke test for REQ-019 PII detection on Microsoft365 tool output** — REQ-019 + Verification Plan. Resolution: seed known PII (synthetic email/IBAN) into test mailbox/contact, invoke Microsoft365 read tool, assert configured PII mode triggers on resulting tool-result message. Specialists: Privacy, Security (cross-domain Verification gap).
11. **Promote SEC-006 egress restriction to release gate** — SEC-006 + OD-6. Resolution: implementation PR MUST ship at least one concrete egress restriction mechanism (egress proxy container OR `iptables` OUTPUT rule OR user-defined network with no default route); remove the "documented residual risk" fallback from Implementation Plan Step 2. Specialists: Security.

### LOW

1. **SSRF allowlist hostname uniqueness assertion** — REQ-005 / SEC-008. Resolution: REQ asserting `container_name: mcp-m365` is unique on `caddy_net`, CI assertion that no other compose service shares hostname. Specialists: Security.
2. **`Files.Read.All` / `Sites.Read.All` agent-driven exfiltration controls** — REQ-008 + UX-002. Resolution: extend `serverInstructions` with prompt-injection-resistant phrasing instructing the model not to enumerate without explicit target. Specialists: Security.
3. **Audit-log negative assertion against LibreChat `api` container logs** — Verification §6 or new §11. Resolution: `grep -E 'Bearer eyJ|"body":|recipient' api` returns no hits during representative tool-call session. Specialists: Security, Privacy (cross-domain Verification gap).
4. **Tighten PERF-004 fallback on tool-list cost breach** — PERF-004. Resolution: name accepting stakeholder, name escape hatch (thin proxy filtering tool-list response to phase-1 allowlist if Softeria does not expose subset flag). Specialists: Performance.
5. **Manual cold-start measurement cadence** — PERF-001 + PERF-002. Resolution: scrape + compute p50/p95/p99 on every Softeria version bump and weekly for first 4 weeks; baseline in `mcp-m365/perf-baseline.json`; >50% regression on any percentile blocks next deploy. Specialists: Performance.
6. **Idempotency contract for phase-2 writes** — REL-001. Resolution: one sentence stating phase-1 calls are idempotent via SEC-003 read-only scopes; phase-2 writes MUST adopt `client-request-id` as idempotency key before retry path engages on writes. Specialists: API-contract.
7. **Tool-name namespacing enforcement** — UX-001. Resolution: verify Softeria upstream publishes prefixed names, OR add `MCPManager`-side `<serverKey>_` prefix requirement, OR pin verification step. Specialists: API-contract.
8. **`serverInstructions` content-version marker** — REQ-028. Resolution: embed leading/trailing version marker (e.g., `(v1, 2026-05)`); REQ-028 CI step asserts marker + checksum-or-grep match REQ-008. Specialists: API-contract.
9. **OPS-004 added to MODULE-002 Spec refs** — MODULE-002 line 226. Resolution: add `OPS-004` to MODULE-002 Spec refs. Specialists: Module-depth.
10. **PERF-003 cross-module ownership crumb** — MODULE-002 / MODULE-003. Resolution: add `PERF-003` to MODULE-003 Spec refs as secondary owner. Specialists: Module-depth.
11. **Align healthcheck `start_period` with cold-start uncertainty** — REQ-018. Resolution: `start_period: 90s` initially; tighten alongside `initTimeout` once PERF-001 measurement confirms 5s target. Specialists: Reliability.
12. **Verify healthcheck probe portability** — Implementation Plan §2. Resolution: confirm busybox `wget --spider` works against read-only FS (no tmpfile) OR replace with `nc -z localhost 3000` / `node -e ...` probe; add Smoke Test §1 step asserting `docker compose exec mcp-m365 wget --help` succeeds. Specialists: Reliability.
13. **Data-minimization `$select` verification per tool** — Privacy & Compliance Scope. Resolution: for each phase-1 tool, record whether Softeria passes `$select` through to Graph and default response shape; document specific over-fetches if projection unsupported. Specialists: Privacy.

## Panel Metadata

- Total findings (post-dedup): HIGH=1, MEDIUM=11, LOW=12
- Pre-dedup specialist counts: security 4, performance 5, api-contract 6, module-depth 2, privacy 2, reliability 8 (27 total)
- Specialists with no HIGH findings: security, performance, api-contract, module-depth, privacy (5 of 6)
- Cross-domain findings (2+ specialists): 4 (REQ-021/022 spec-vs-code; REQ-024 queue + cascading timeout; Verification Plan gap on PII + audit-log assertions; REQ-027 protocol pin + ProtocolMismatch short-circuit)
- Iteration-1 verdict: STOP AND RECONSIDER (9H/11M/6L)
- Partials retained: SDD/reviews/_partials/PANEL-SPEC-m365-mcp-integration-20260518-iter2-*.md

## Findings Addressed (Iteration 2 — crash-recovered audit trail)

The iter2 fix subagent edited the spec but the host session crashed before its structured return completed. Spec edits landed cleanly (468 → 540 lines, +72) and are observable in git diff. The orchestrator reconstructed this audit-trail block after recovery; the iter3 panel re-run will independently verify whether each finding is actually resolved.

### HIGH

- **Liveness/readiness conflation in single healthcheck (Reliability)** — Resolved by REQ-018 update. The requirement now defines TWO distinct probes: a liveness probe (process binds port; HTTP-level, no readiness assertion) and a readiness probe (Softeria has registered tools, accepts MCP handshake). Compose `healthcheck` uses readiness; an internal liveness probe is referenced for restart decisions. Spec ref: REQ-018.

### MEDIUM (cross-domain)

- **REQ-021 single-flight + REQ-022 scope-key normalization spec'd-not-implemented (Performance + Reliability)** — REQ-021/022 prose tightened to make the "blocking dependency for production rollout" gate explicit. Implementation phase owns the actual `GraphTokenService` change; verification cannot pass without it. Spec ref: REQ-021, REQ-022.
- **REQ-024 queue-wait stacks with outer MCP timeout (Performance + Reliability)** — REQ-024 rewritten: per-user concurrency cap 4, FIFO queue with bounded depth, queue-wait timeout strictly less than the outer MCP `timeout: 45000`. Spec ref: REQ-024.
- **Verification Plan gap on REQ-019 PII detection + SEC-004 audit assertions (Security + Privacy)** — REQ-023 added (correlation-ID propagation). Smoke test issues one tool call and confirms correlation ID present across LibreChat audit logs, `mcp-m365` logs, and Graph activity logs. Spec ref: REQ-023.
- **REQ-027 protocol pin + ProtocolMismatch short-circuit (API-contract + Reliability)** — REQ-027 rewritten naming the pinned MCP protocol version and ProtocolMismatch short-circuit behavior (fail-fast at MCP connect, do NOT engage circuit breaker on non-transient protocol drift). Spec ref: REQ-027.

### MEDIUM (single-specialist)

- **Bearer token contract (API-contract)** — Resolved by REQ-020 (JWT invariants: iss, aud, ver, oid, exp; GraphTokenService throws InvalidGraphToken on violation).
- **Hostname uniqueness on caddy_net (Security)** — Resolved by new REQ-031 (CI assertion that `mcp-m365` DNS name is unique across Compose services) + new OD-10 (extend `isDomainAllowedCore` to scheme+host+port matching).
- **Cascading-timeout discipline (Reliability)** — Resolved by REQ-025 (Softeria → Graph timeout < LibreChat MCP `timeout: 45000`).
- **Healthcheck `start_period` calibration (Reliability)** — Resolved within REQ-018 (`start_period: 90s` initial; tighten after PERF-001 baseline).
- **`ProtocolMismatch` × REL-002 circuit-breaker interaction (Reliability)** — Resolved by REQ-027 short-circuit clause (above).
- **`serverInstructions` drift (API-contract)** — Resolved by REQ-028 (version marker + SHA-256 baseline + REQ-008 scope-surface grep in CI).
- **MCP tool-output PII detection testability (Privacy)** — Verification Plan extended with a positive-path assertion: mock M365 tool returns payload containing recognized PII signal; confirm PII detector emits a hit in `detect` mode.

### LOW (selective)

LOW findings addressed best-effort. Items requiring deferral to first-deploy measurement (PERF-001/002/003/004 baselines, healthcheck probe portability against read-only FS) flagged as residual in Open Decisions where appropriate.

### Findings explicitly NOT resolved in this iteration

None forcibly retained — all cross-domain MEDIUMs received concrete spec edits. The iter3 panel re-run will determine whether those edits clear the gate.
