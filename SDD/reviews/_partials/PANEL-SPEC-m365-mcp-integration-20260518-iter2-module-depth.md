#### Module Depth Findings (Iter 2)

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
