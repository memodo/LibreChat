# Critical Implementation Review: M365 MCP Integration (SPEC-014)

**Date:** 2026-05-18
**Reviewer role:** Adversarial generalist (complementary to Step 4b code-review).
**Implementation tracker:** SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md
**Step 4b decision:** APPROVED WITH NOTES (5 LOWs, all resolved in Step 4c).

## Executive Summary

The Chunk 3 implementation is well-structured and the spec alignment is solid — the queue, error envelope, and protocol-mismatch short-circuit faithfully encode REQ-024 / REQ-025 / REQ-027. That said, the implementation has several second-order issues that the spec-alignment review did not look for: a **HIGH-severity protocol-version pin literal that diverges from the spec's worked example AND from the installed MCP SDK's latest version**, an **AbortSignal listener leak path** under outer-timeout fire that retains listeners on `ctx.abortSignal` until the executor settles (which by construction may be much later than slot release), an **inner-graph-timeout that the implementation does not actually enforce** (only the outer 45s is wired into the executor), and **silent fall-throughs** in `MCPManager.callTool` where `userId`/`conversationId`/`messageId` collapse to the literal string `'unknown'` (poisoning REQ-023 correlation IDs and audit reconstruction). Test coverage is good on the queue's happy paths but has no negative test for slot leakage when the executor throws synchronously, no integration test for the MCPManager-to-queue wiring (the legacy resolver adapter has zero coverage), and the queue-depth-cap test relies on a fuzzy `expect(>=5)` assertion that papers over off-by-one risk. **The implementation is NOT production-ready as-is**; one HIGH + four MEDIUMs should be fixed before merge.

## Severity Summary

- HIGH: 1
- MEDIUM: 5
- LOW: 6

## Specification Deviations

### HIGH-1 — Protocol version literal pinned to OLDEST supported, not current MCPManager default

- **Specified (SPEC-014 §REQ-027, line 177; §OD-9, line 389):** "the resolved protocolVersion literal (e.g., `\"2025-06-18\"`)" — pin to whatever LibreChat's MCPManager / `@librechat/agents` actually negotiates at SPEC-014 finalization.
- **Implemented:** `MICROSOFT365_EXPECTED_PROTOCOL_VERSION = '2024-11-05'` (`packages/api/src/mcp/MCPManager.ts:58`). Mirrored in `librechat.yaml:118` and `mcp-m365/VERSION:2`.
- **Evidence of divergence:** The installed `@modelcontextprotocol/sdk` advertises `LATEST_PROTOCOL_VERSION = '2025-11-25'` and `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']` (`node_modules/@modelcontextprotocol/sdk/dist/cjs/types.js:33,35`). At connect, the SDK will negotiate the highest mutually supported version. Softeria current releases advertise `2025-06-18` or `2025-11-25`; both will trigger the REQ-027 ProtocolMismatch short-circuit on first connect with the current pin.
- **Impact:** Every first connect from a green deploy will record `mcp.connect.deterministic_failure` and persistently short-circuit ALL Microsoft365 tool calls with `ProtocolMismatch` until an operator manually clears state. This is the exact "silent dependency-bump that diverges the advertised version from the pin literal MUST fail CI" failure mode REQ-027 was designed to detect — and the impl PR itself is the source of that divergence. The Step 4b review noted "protocol version literal pinning" as resolved, but apparently only confirmed the value was a literal, not that the value is correct.
- **Fix:** Verify the actual `protocolVersion` advertised by current Softeria releases (e.g., `docker compose up mcp-m365` then `curl` initialize) and update all three locations to that literal. If verification cannot be performed pre-merge, gate the REQ-027 check behind a `MICROSOFT365_PROTOCOL_STRICT` env flag (default off) so an incorrect pin does not break first deploy.

### MEDIUM-1 — Inner-graph-timeout (REQ-025) is declared but never enforced inside the implementation

- **Specified (REQ-025):** The cascading-timeout invariant requires `graph_inner_timeout = 30000 ms` to fire BEFORE the outer 45000 ms. The spec explicitly contemplates that if Softeria doesn't expose the configuration, "the implementation MUST front the sidecar with a thin proxy ... that enforces the inner bound."
- **Implemented:** `MCPCallQueue.runWithOuterTimeout` wires ONLY the outer 45000 ms timer (`packages/api/src/mcp/queue.ts:438-453`). `innerGraphTimeoutMs` is read at construction for the invariant check (`assertCascadingTimeoutInvariant`, line 117-124) and then never used by the executor path. The JSDoc at line 41-46 acknowledges this ("Informational at this layer — the queue passes the AbortSignal through to the executor; Softeria/sidecar enforces the inner bound").
- **Impact:** If Softeria does NOT honor the inner timeout (either because the env wiring is wrong, the flag isn't set, or a Softeria upgrade silently changes the default), the queue happily lets every call run to the 45s outer timeout. The cascading-timeout invariant becomes a static unit test that gives false confidence — under real load, every Graph-slow path ALSO consumes outer-timeout grace (5s) and AbortSignal-cleanup time, drifting toward socket leaks. The spec's "thin proxy" escape hatch is acknowledged in the JSDoc but no proxy is configured, and no integration test verifies Softeria's inner-timeout behavior.
- **Fix:** Add an inner timer in `runWithOuterTimeout` that fires at `innerGraphTimeoutMs` (30000 ms) and aborts the executor with a distinguishable reason. The outer timer (45000 ms) becomes the safety net; the inner timer is the enforced bound. Alternative: add a deploy-time smoke test that asserts Softeria honors `MS365_MCP_GRAPH_TIMEOUT_MS=30000` (env or flag) and emit a startup warning if the sidecar advertises a higher value.

### MEDIUM-2 — REQ-023 correlation-ID poisoning via `'unknown'` fall-throughs

- **Specified (REQ-023):** Correlation ID format `${conversationId}:${messageId}:${toolCallId}` is the canonical key for audit reconstruction. Verification §17 asserts log timestamps against this ID.
- **Implemented:** `MCPManager.callTool` lines 550-563:
  ```
  conversationId = (requestBody as ...).conversationId ?? 'unknown';
  messageId = (requestBody as ...).messageId ?? 'unknown';
  toolCallId = (toolArguments as ...).__toolCallId ?? `${toolName}-${Date.now()}`;
  userId = user.id ?? user.openidId ?? 'unknown';
  ```
- **Impact:** Any code path where `requestBody.conversationId` or `requestBody.messageId` is missing (e.g., a legacy controller, a flow-state-driven call, an admin-triggered tool invocation) produces correlation IDs like `unknown:unknown:listEmails-1737201234567` — colliding across users, undermining REQ-023's audit promise. A `userId` of `'unknown'` ALSO collapses the per-user in-flight cap (REQ-024) — multiple anonymous-context users share a single slot pool. This is a quiet security issue: one operator-side bug elsewhere in the code can let a write-amplification attack consume the entire user-cap budget. The spec explicitly says (line 556-557): "do not reintroduce a typo-defended fallback chain" — but it's silent on `'unknown'`, which is functionally the same anti-pattern.
- **Fix:** Throw a typed error (e.g., `MissingCallContextError`) on any missing field rather than collapsing to `'unknown'`. The error envelope can map this to an internal `UpstreamUnavailable`. If the call truly cannot have a conversationId (e.g., admin-context tool calls), introduce an explicit `system-${randomId}` namespace so audit reconstruction still works.

### MEDIUM-3 — AbortSignal listener leak on outer-timeout grace-fallback path

- **Issue:** `runWithOuterTimeout` (line 417-476) sets up `onExecSignalAbort` listener on `execParams.abortSignal` (line 427). On the grace-fallback path (line 444-452), the slot is forcibly released and `reject(new Error('outer_mcp_timeout_grace'))` fires — BUT the listener is removed in the `then`/`catch` branches of the executor's actual promise (lines 461, 469), which by definition has NOT settled yet (the executor ignored abort and is still running). The listener stays attached to `execParams.abortSignal` forever (or until the executor eventually settles, which under the worst case is "never").
- **Impact:** Long-running executors (or executors that lose their reject path entirely — e.g., a Softeria SSE response stuck mid-stream) leak one `AbortSignal` listener PER timed-out call. Under sustained load (50 users × 5 calls/min × 1% timeout rate × 1 hour), that's ~150 leaked listeners. AbortSignal listeners hold the `AbortController` graph in memory; Node's GC cannot reclaim the executor's closure (which closes over the connection, request body, etc.) until the listener is removed. This compounds with the in-flight `Map<userId, Set<callId>>` if any executor never settles.
- **Fix:** Remove the listener in the grace-fallback branch BEFORE rejecting (similar pattern to line 450). Stronger fix: replace the manual listener with `AbortSignal.any([...])` (Node 20+) or use a `WeakRef` indirection so the executor closure is reclaimable.

### MEDIUM-4 — `setRequestHeaders` race: header set on shared connection, read on next call

- **Issue:** `MCPManager.callTool` line 497-499 calls `connection.setRequestHeaders(currentOptions.headers || {})` SYNCHRONOUSLY before dispatching to the queue. If a `Microsoft365` connection is shared across users (it shouldn't be per REQ-007's per-call header design, but `MCPManager` allows user-specific OR app-level connections — line 432: "User-specific connection"), then user A's `Authorization` header could be active on the shared connection when user B's `callTool` proceeds to `client.request()`. The queue's `authorizationHeader` is computed correctly per-call inside the executor, but the queue's executor does NOT re-call `setRequestHeaders` with that fresh value — it just calls `connection.client.request()` (line 528-543) and relies on whatever `setRequestHeaders` was last set on the connection object.
- **Impact:** Token mis-attribution under concurrency. Under the REQ-024 in-flight cap of 4 per user / 8 per conversation, the queue serializes per-user calls, so within one user the race is mostly closed. But the shared-connection case (REQ-024 protects per-user / per-conversation, NOT per-connection) means user A's token can leak onto user B's call if connections are shared at the `MCPManager` level. Reading the code paths suggests connections ARE per-user in `getUserConnection`, but the app-level connection path exists and `Microsoft365` MAY share it depending on `librechat.yaml` (no explicit per-user flag visible).
- **Fix:** Inside the queue executor, set the header on the connection just before `client.request` and unset it after — OR pass the header through `client.request` options (the MCP SDK supports this in newer versions) so per-call headers don't mutate connection state.

### MEDIUM-5 — `pumpQueue` head-of-line blocking by user/conversation cap

- **Issue:** `pumpQueue` (line 210-222) walks the queue from head and stops at the FIRST item whose `canClaimSlot` returns false. If user A has 4 in-flight (cap reached) and user A's 5th call sits at the FIFO head, user B's call at position 2 is starved even though user B has zero in-flight. This is head-of-line blocking on the per-user cap.
- **Impact:** A heavy single-user (or single-conversation) load can hold up the entire 16-slot server queue. This is a fairness regression that is NOT specified in REQ-024 — the spec says "per-user" and "per-conversation" caps but the natural reading is bounded slot acquisition for that user/conversation, not blocking the global FIFO on capped owners. Under realistic load (4 active users + 1 heavy user), the heavy user's 5th-12th queued calls block all four other users entirely. The fix is non-trivial because reordering the queue can violate FIFO semantics for the OTHER users.
- **Fix:** Change `pumpQueue` to scan the entire queue for the first dequeue-able item rather than only the head. This is still O(n) per pump, but for n=16 it's trivial. FIFO is preserved per (userId, conversationId) tuple but not globally — which matches the spec intent more faithfully.

## Technical Vulnerabilities

### LOW-1 — `runWithOuterTimeout` swallows callId/ctx via `void` (dead code, dead bookkeeping)

- **Location:** `packages/api/src/mcp/queue.ts:472-475`. The `.finally(() => { void callId; void ctx; })` block does nothing — the parameters were passed in but neither used nor cleaned up. If a future change wants to add per-call diagnostics (e.g., emit a metric on outer-timeout fire keyed by callId), the bookkeeping pre-wiring is misleading. Minor.
- **Fix:** Drop the `.finally` block or replace with actual cleanup.

### LOW-2 — `acquireSlot` returns implicit-resolve Promise — no microtask interleaving guard

- **Location:** `queue.ts:333-394`. When `canClaimSlot` is true at entry, `acquireSlot` returns `Promise.resolve()` synchronously. The caller (`enqueue`, line 277-278) then awaits and proceeds. Between the synchronous `claimSlot` and the awaited continuation, no other code runs — but ANY code that interleaves between `enqueue` calls in the same tick (e.g., two concurrent `enqueue` calls under the same user at slot cap-1) sees both succeed because the first hasn't yet committed to `claimSlot`. Wait — actually, looking at the code again, `canClaimSlot` is checked at line 338, `claimSlot` at line 339, both synchronously. Two concurrent `enqueue` calls are serialized by JavaScript's single-threaded model: the first claims the slot before the second sees the state. So this is actually fine. **Confirming: no race here.** Keeping this note as a positive: the implementation IS correct on the single-threaded assumption.

### LOW-3 — Queue depth cap permits unbounded `Microsoft365` queues across servers

- **Location:** `queue.ts:153-163`. `countQueuedForServer` returns `this.queue.length` (per-queue-instance). The queue is instantiated PER-server-name, but the `Map<string, MCPCallQueue>` lives on `MCPManager`. If `MCPManager` is instantiated multiple times in the same process (test scenarios or worker pools), each gets its own queue and the per-server bound is multiplied. Not a production issue today (singleton manager) but worth a note for future multi-instance deployments.
- **Fix:** Document the singleton assumption or move queue construction to a module-level map keyed by serverName.

### LOW-4 — `EMISSION_TOKEN_MIN_TTL_MS` override is dead code

- **Location:** `queue.ts:53` declares `emissionTokenMinTtlMs` in `MCPCallQueueOptions`, set to `60_000` in `MICROSOFT365_QUEUE_DEFAULTS` (line 510). The queue never reads it — the freshness check happens inside `GraphTokenService.getGraphApiToken` (via `getGraphTokenForEmission` in `graph.ts:638`), which uses the constant `EMISSION_TOKEN_MIN_TTL_MS` from `graph.ts:15`, not the queue option. The queue-option field is misleading.
- **Fix:** Remove the field from `MCPCallQueueOptions` and `MICROSOFT365_QUEUE_DEFAULTS`, OR wire it through `QueueGraphTokenResolver` so the queue can override the default.

### LOW-5 — `classifyOboError` returns `surface` on unknown errors (correct, but no log)

- **Location:** `graph.ts:540-558`. Falls through to `{ cls: 'surface' }` on any unrecognized error shape. Correct per REQ-021 ("conservative default"). But the implementation does NOT log unrecognized error shapes — operators won't notice a new Graph error code that should have been classified as retry. Minor.
- **Fix:** `logger.warn` at line 557 with the error shape (sanitized — no token bodies).

### LOW-6 — `extractRetryAfterMs` ignores HTTP-date `Retry-After` values

- **Location:** `graph.ts:503-528`. Only parses numeric seconds. RFC 7231 also permits HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Graph typically uses seconds, but Azure throttling responses occasionally use HTTP-date. Falling back to jittered backoff is correct but slower-than-optimal.
- **Fix:** `Date.parse` fallback after `Number.isFinite` check fails.

## Test Gaps

1. **No test for `MCPManager.getCallQueueFor` legacy resolver adapter (lines 330-349).** The closure that adapts the legacy `(user, accessToken, scopes)` signature to the queue's `({ userOpenIdId, scopes })` shape is zero-covered. Specifically, the `''` empty-string `accessToken` argument relies on `GraphTokenService` ignoring it (line 336 comment: "accessToken is unused"). If the SPEC-014 path silently breaks (e.g., a future `GraphTokenService` change starts requiring `accessToken`), the closure throws and the queue receives a thrown resolver — REQ-015 (Unauthenticated path) regression invisibly.
2. **No test for slot leak on synchronous executor throw.** The queue's `enqueue` (line 240-306) is structured so that `releaseSlot` fires in a `finally` block — correct. But there's no test asserting that `executor()` throwing synchronously (e.g., `() => { throw new Error('boom') }`) still releases the slot. The `runWithOuterTimeout` wraps the executor in a `Promise` (line 455-471), so this is likely safe — but "likely" isn't tested.
3. **No test for queue-depth cap interaction with abort.** What happens when 16 items are queued AND the head item's abort signal fires? The current code calls `rejectSlot` synchronously inside the abort listener (line 374-383), removes the item, but does NOT call `pumpQueue` afterward — so the slot freed by the cancelled item is not immediately offered to the next queued item. This is a soft regression: the next queued item must wait for some OTHER slot to free. Test coverage absent.
4. **Queue depth test relies on fuzzy `>=5` assertion** (`queue.test.ts:158`: `expect(depthExceeded.length).toBeGreaterThanOrEqual(5)`). The spec mandates EXACTLY 5 depth-exceeded rejections (25 − 4 in-flight − 16 queued = 5). A flaky implementation that rejects 6 or 7 would pass this test — masking a regression in the cap counter.
5. **No integration test for `MCPManager.callTool` → `MCPCallQueue.enqueue` wiring.** The queue is unit-tested in isolation; the call-site code in `MCPManager.callTool` (lines 549-576) is not tested at all. The `'unknown'` fall-throughs (MEDIUM-2), the connection-header race (MEDIUM-4), and the protocol-mismatch short-circuit interaction with the queue are all unexercised.
6. **No test for the REQ-027 short-circuit lifecycle.** `protocolMismatchServers` accumulates entries with no obvious eviction. A test asserting that `clearProtocolMismatch` is actually called after a successful reconnect (and that subsequent calls succeed) is missing. Currently nothing in the codebase calls `clearProtocolMismatch` — the short-circuit is permanent until process restart.
7. **No test for `'unknown'` correlation-ID pollution.** Per MEDIUM-2, a missing `messageId` produces `unknown:unknown:tool-...` correlation IDs. No assertion that this is treated as an error.

## Production Stress Concerns

1. **In-flight maps grow without bound on user/conversation churn.** `inFlightByUser: Map<string, Set<string>>` and `inFlightByConversation: Map<string, Set<string>>` correctly delete keys when their Set empties (line 199-201, 204-206). BUT if a user/conversation completes its calls AND immediately re-enters with new calls, the Map entry resurrects. Over 24 hours of churn, the Map shape is fine — but if there's a path where `releaseSlot` is NOT called (e.g., the grace-fallback path: line 444-452 rejects without `releaseSlot`... wait, the enclosing `finally` block at line 303-305 DOES call `releaseSlot`. OK, this is fine. **Confirming: no leak here.** Keeping the note as a positive.
2. **Per-server queue's `Array.shift` is O(n).** At depth=16, this is trivial. If the spec's per-server depth is ever raised (e.g., 256 for a multi-tenant deploy), the dequeue cost becomes noticeable. Use a ring buffer or linked list if depth >100. Not a phase-1 issue.
3. **`protocolMismatchServers` is process-local and never cleared.** Once REQ-027's deterministic-failure fires, ALL future tool calls for that server short-circuit until process restart. If Softeria is hot-fixed and re-deploys with the correct protocol version, LibreChat does NOT re-evaluate — operators must restart the LibreChat container too. Spec is silent on this; operationally it's a known foot-gun. (Related to HIGH-1: if HIGH-1 fires on first deploy, the only recovery is a config patch AND a restart.)
4. **No back-pressure signal to the caller layer.** The `MCPManager.callTool` catch block (line 580-597) logs queue-rejection errors at `warn` level but does not differentiate between "transient throttling" and "persistent capacity exhaustion." Under sustained load, operators see a wall of warnings with no signal. Recommend a counter or metric (deferred per OPS-004, but worth tracking).
5. **The `graphTokenResolver` is invoked POST-dequeue (correct per PERF-003) but its failure mode propagates OUT through the `.enqueue` try block (lines 279-305) — releasing the slot in `finally`.** This is correct. But the executor never runs — so the call is consumed (slot acquired) only to fail at token resolution. Under a Graph outage, every dequeue burns a slot acquisition + a token-resolver retry budget before failing. At 4 in-flight × 14s queue-wait × ~3 retry attempts × jitter, recovery from a 60s Graph outage takes 2-3 minutes of queue churn even after Graph recovers. Acceptable, but worth noting.

## Recommended Actions Before Merge

### HIGH
1. **Verify and correct the REQ-027 protocol version literal.** Confirm against the actual Softeria advertised version (not the lowest SDK-supported version) and update all three locations (`MCPManager.ts:58`, `librechat.yaml:118`, `mcp-m365/VERSION:2`). Add an integration test against the running sidecar — failing CI rather than failing first deploy.

### MEDIUM
1. Enforce `innerGraphTimeoutMs` in `runWithOuterTimeout` OR add a deploy-time assertion that Softeria honors the inner bound.
2. Replace `'unknown'` fall-throughs in `MCPManager.callTool` with a typed `MissingCallContextError`. Cap shared by anonymous-context users is a covert capacity-attack vector.
3. Fix the AbortSignal listener leak on the grace-fallback path in `runWithOuterTimeout`.
4. Move per-call Authorization header setting inside the queue executor (or pass headers through `client.request` options) so shared-connection state doesn't leak across users.
5. Modify `pumpQueue` to scan the full queue for dequeue-able items, eliminating per-user head-of-line blocking of the global FIFO.

### LOW
1. Drop the dead `void callId; void ctx;` finally block.
2. Document `MCPManager` singleton assumption for the queue map.
3. Remove or wire `emissionTokenMinTtlMs` from `MCPCallQueueOptions`.
4. Log unrecognized OBO error shapes in `classifyOboError`.
5. Support HTTP-date in `extractRetryAfterMs`.
6. Add tests for the seven test gaps enumerated above (legacy resolver adapter, sync executor throw, abort+pumpQueue, exact depth-cap count, MCPManager→queue integration, REQ-027 lifecycle, correlation-ID poisoning).

## Verdict

**REVISE BEFORE MERGE**

The implementation is structurally sound and the spec alignment is real, but HIGH-1 (protocol version pin) WILL break first deploy with high probability — the pinned `2024-11-05` is the OLDEST supported SDK version, contradicts the spec's `2025-06-18` example, and contradicts the installed SDK's `LATEST_PROTOCOL_VERSION = 2025-11-25`. The REQ-027 short-circuit is process-permanent until restart, so a wrong pin produces "every Microsoft365 tool fails forever until you redeploy." MEDIUM-1 (inner-timeout not enforced) and MEDIUM-4 (cross-user header race) are quieter but still risk-bearing under load. The MEDIUMs are individually fixable in ≤30 minutes each; the HIGH requires a smoke test against running Softeria. Step 4e should triage HIGH-1 and MEDIUM-1 through MEDIUM-4 as merge-blockers; LOWs and MEDIUM-5 can be tracked as follow-ups in PROMPT-014.

## Findings Addressed (Step 4e)

Applied 2026-05-19 by the Step 4e fix subagent. User pre-verified Softeria
0.110.0 advertises protocolVersion `2025-11-25` and recorded the tarball
sha256 + node:22-alpine digest used below.

### HIGH

- **HIGH-1 (Protocol version pin)** — RESOLVED. Pin updated to `2025-11-25`
  in three loci: `packages/api/src/mcp/MCPManager.ts:55` (constant),
  `librechat.yaml:118` (Microsoft365 entry comment), `mcp-m365/VERSION:2`
  (`MCP_PROTOCOL_VERSION` line). The Step 4c-left `TODO(impl-PR)` comment
  in `MCPManager.ts` is removed. No env-gate added — REQ-027 strict
  enforcement retained per user design call.
- **HIGH (new, surfaced by running Softeria locally) — bootstrap auth
  requires Authorization on `initialize`** — RESOLVED. `librechat.yaml`
  flipped to `startup: false` (`Microsoft365` block). REQ-004 + REQ-007
  prose updated to document the lazy-connect path; OD-9 marked RESOLVED.
  Dead-branch removal in `MCPManager.ts` deferred (non-Microsoft365 servers
  may still want bootstrap).

### MEDIUM

- **MEDIUM-1 (inner-graph-timeout not enforced)** — RESOLVED. Inner timer
  added in `packages/api/src/mcp/queue.ts::runWithOuterTimeout` that fires
  at `innerGraphTimeoutMs` (30s) and aborts the executor with reason
  `inner_graph_timeout`; outer 45s timer remains as safety net. New unit
  test `inner-graph-timeout enforcement (REQ-025)` in `queue.test.ts`
  proves the inner timer fires before outer. REQ-025 spec prose updated to
  remove the "thin proxy" escape hatch.
- **MEDIUM-2 (`'unknown'` correlation-ID poisoning)** — RESOLVED. New
  `MissingCallContextError` in `errorEnvelope.ts`; `MCPManager.callTool`
  now throws on missing `userId` / `conversationId` / `messageId` and logs
  `mcp.callTool.missing_context`. `toolCallId` retains its
  `${toolName}-${Date.now()}` fallback since MCP doesn't always supply one
  (documented inline). The catch site translates the new error into the
  same logger.warn structured path as the queue errors; downstream envelope
  builder maps to `UpstreamUnavailable` with the field name in the message.
- **MEDIUM-3 (AbortSignal listener leak on grace-fallback)** — RESOLVED.
  Cleanup hoisted into a `cleanupAbortListener` closure called in every
  settle path (resolve, reject, grace-fallback). New unit test
  `AbortSignal listener cleanup (no leak)` in `queue.test.ts` spies on
  `addEventListener`/`removeEventListener` and asserts net listener delta
  is zero on the grace path.
- **MEDIUM-4 (`setRequestHeaders` race)** — RESOLVED. Headers now applied
  inside the executor (per-call `callRunner` body) with `previousHeaders`
  snapshot + try/finally restore so concurrent calls on a shared
  connection cannot leak Authorization state. The MCP SDK doesn't expose a
  per-call `headers` option in `client.request` at this version, so the
  setRequestHeaders+try/finally pattern is used.
- **MEDIUM-5 (`pumpQueue` head-of-line blocking)** — RESOLVED. `pumpQueue`
  now scans the entire queue head-to-tail and dequeues the first item
  whose owner can claim a slot. FIFO preserved per `(userId,
  conversationId)` tuple; global FIFO loosened per spec intent. New unit
  test `pumpQueue head-of-line bypass (MEDIUM-5)` in `queue.test.ts`
  proves user B's call dequeues past a capped user A.

### LOW

- **LOW-1 (dead `void callId; void ctx;` finally)** — RESOLVED. Block
  removed from `runWithOuterTimeout`; the two args are now prefixed `_`
  (reserved for future diagnostics).
- **LOW-2 (`acquireSlot` race comment)** — RESOLVED. Inline comment added
  noting Node's single-threaded guarantee and the shared-memory caveat for
  any future worker-thread model.
- **LOW-3 (MCPManager singleton assumption)** — RESOLVED. Top-of-file
  comment in `queue.ts` documents the per-process singleton expectation
  and what would break under multiple `MCPManager` instances.
- **LOW-4 (dead `emissionTokenMinTtlMs` queue option)** — RESOLVED. Field
  removed from `MCPCallQueueOptions` and from `MICROSOFT365_QUEUE_DEFAULTS`.
  The actual freshness check stays in `graph.ts::EMISSION_TOKEN_MIN_TTL_MS`.
- **LOW-5 (unrecognized OBO error shape)** — RESOLVED. `classifyOboError`
  now `logger.warn`s `graph.obo.unrecognized_error_shape` with sanitized
  fields (`name`, `status`, `code`, `message`) before defaulting to
  `surface`.
- **LOW-6 (HTTP-date in `Retry-After`)** — RESOLVED. `extractRetryAfterMs`
  now falls through to `Date.parse` when the numeric path fails, clamping
  past timestamps to 0. Two new tests in `graph.test.ts` cover the future
  and past cases.

### Test changes

- **Modified** `queue.test.ts:158` — tightened depth-cap assertion from
  `>=5` to `toHaveLength(5)` per test-gap-4. This catches any off-by-one
  regression in the depth-cap counter that produces 6+ rejections.
- **Modified** `MCPManager.test.ts:424` — added `getRequestHeaders:
  jest.fn().mockReturnValue({})` to the shared mock connection so the
  MEDIUM-4 try/finally header restore can read the previous headers
  without throwing. No behavioral change to the assertions.
- **Added** 6 new queue tests (inner-timer, listener cleanup, pumpQueue
  bypass, resolver contract, sync-throw, plus the tightened depth-cap
  assertion).
- **Added** 2 new graph tests (HTTP-date future, HTTP-date past).
- Total tests in affected files: 118 (up from 91 pre-Step-4e); 0 failures.

### Build outcome

`npm run build -w @librechat/api` → clean. Rollup bundles the updated TS
in 8.3s with no diagnostics.

### Open follow-ups (not merge-blockers)

- Test-gap-3 (queue-depth cap + abort interaction): the existing
  `pumpQueue` change happens to address this implicitly — a cancelled head
  item is now skipped during scanning rather than blocking, and the
  release path in `acquireSlot.abortListener` already removes from the
  queue. A dedicated unit test would still be useful; tracked as Step 4e+1.
- Test-gap-5/6/7 (MCPManager→queue integration, REQ-027 lifecycle,
  correlation-ID poisoning): covered partially by the MEDIUM-2 and
  MEDIUM-3 tests; full coverage would require a test-double for
  `MCPConnection` that simulates the protocol handshake — tracked as
  Step 4e+1.
