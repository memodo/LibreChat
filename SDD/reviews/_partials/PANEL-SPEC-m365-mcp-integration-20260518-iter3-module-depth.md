#### Module Depth Findings (Iter 3)

- **M** REQ-021 (single-flight OBO) misassigned to MODULE-003
  - Evidence: Modules section, MODULE-003 Spec refs line 273 lists REQ-021; REQ-021 text (lines 120) targets `api/server/services/GraphTokenService.js` — runtime LibreChat code, not Entra app registration or scope env configuration.
  - Risk: Cross-module ownership crumb breaks cohesion. MODULE-003's stated purpose is "Entra app registration & OBO scope configuration" (Azure portal + `OPENID_GRAPH_SCOPES` env). Single-flight is a LibreChat-process concurrency control owned by the BYOT plumbing surface (MODULE-002). Implementer searching MODULE-002's spec refs for the single-flight obligation will not find it; reviewer auditing MODULE-003 sees a code-shaped REQ that does not match the module's "Hides" (consent flow, scope-to-endpoint mapping, cache-key implications).
  - Resolution: Move REQ-021 from MODULE-003 to MODULE-002 spec refs. Keep REQ-022 (scope cache-key normalization) in MODULE-003 — it is a direct consequence of MODULE-003's "OBO scope-set cache-key implications" already named under "Hides" (line 268). The panel guidance ("REQ-022 owned by MODULE-003 cache-key but REQ-021 owned by MODULE-002 single-flight") is the intended end state; spec currently places both in MODULE-003.

- **M** REQ-029 / REQ-030 misassigned to MODULE-003
  - Evidence: MODULE-003 Spec refs (line 273) lists REQ-029 and REQ-030. Both REQs concern LibreChat conversation-retention enforcement (`messages` collection purge timer; conversation-erasure DSR path) — lines 213-214. Neither involves Entra app registration or `OPENID_GRAPH_SCOPES`.
  - Risk: Module with no clear purpose / depth inflation. MODULE-003 advertises ownership of LibreChat-internal retention plumbing it does not actually own; its "Hides" section (lines 266-269) names only Azure consent flow, scope-to-endpoint mapping, OBO cache-key implications, and phase-1/2 boundary. MODULE-003 cannot meaningfully verify or change retention behavior. Implementer reading MODULE-003 looking for the retention timer will find nothing in scope.
  - Resolution: Either (a) move REQ-029 and REQ-030 to MODULE-002 (LibreChat MCP integration surface — closer fit since tool output flows through MCP plumbing), or (b) add a fourth narrow module / cross-cutting note for "LibreChat retention & DSR plumbing" if those concerns warrant their own boundary. Option (a) is lower-cost; (b) avoids overloading MODULE-002.

- **L** MODULE-002 "Depends on" omits `GraphTokenService` cache + single-flight surface
  - Evidence: MODULE-002 "Depends on (existing, unchanged)" lines 250-253 lists `MCPManager`, `processMCPEnv()`, `resolveGraphTokenPlaceholder()`, `isMCPDomainAllowed`, `extractMCPServerDomain`. `GraphTokenService` (which owns REQ-020 JWT-invariant validation, REQ-021 single-flight, REQ-022 cache-key normalization, PERF-003 cache TTL) is not named.
  - Risk: Missing dependency crumb. After the REQ-021 reassignment above, MODULE-002 will own three GraphTokenService-touching REQs but its dependency list silently excludes the service. Reviewer auditing the trust boundary at MODULE-002 has no entry-point to `GraphTokenService` from the Modules section.
  - Resolution: Add `GraphTokenService` (`api/server/services/GraphTokenService.js`) to MODULE-002's "Depends on" list, noting that REQ-021 (single-flight) introduces NEW code inside it — i.e., not strictly "unchanged". Consider splitting "Depends on (existing, unchanged)" from "Depends on (modified by this spec)".

Checked and passing:
- Three modules present with non-empty Public Interface / Hides / Risk / Spec refs.
- No pass-through wrapper, getter/setter façade, or wide-thin interfaces.
- MODULE-002 risk tier "medium" (line 255) remains appropriate given REQ-020 JWT-invariant validation, REQ-024 rate limit + queue, REQ-027 protocol-mismatch classification, REQ-028 serverInstructions drift CI — all now sit on this module; downstream regression blast radius justifies medium over low.
- MODULE-001 risk tier "medium" (line 233) appropriate — sole user-token-handling process, even in flight.
- MODULE-003 risk tier "medium" (line 271) appropriate — admin-consent irreversibility + cache-invalidation on scope drift.
- REQ-017 cross-module non-goal note (line 275) still correctly framed as bounding-scope, not orphan.
- REQ-020, REQ-023, REQ-024, REQ-027, REQ-028, REQ-031 (new in iter1/iter2) all reach modules.
- SEC-001..008, PERF-001..004, OPS-001..004, REL-001..003, UX-001..003, OD-1..10 all mapped.
- No "Hides" claims infrastructure the module does not own (no depth inflation in MODULE-001 or MODULE-002).
