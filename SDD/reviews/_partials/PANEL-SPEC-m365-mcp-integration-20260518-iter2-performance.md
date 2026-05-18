#### Performance Findings (Iter 2)

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

- **[M] REQ-021 single-flight is specified but NOT implemented in current `GraphTokenService.js` — release-gate ambiguity**
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

- **[L] REQ-024 rate limit semantics ambiguous — queue-with-timeout vs immediate-reject**
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
