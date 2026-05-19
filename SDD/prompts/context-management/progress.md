# Research Progress

## Current: RESEARCH-010 & RESEARCH-011 (Production Readiness & SSO Gateway)

### Research Phase Summary
**Date**: 2026-04-01
**Status**: COMPLETE
**Branch**: `feature/production-ready`

### Documents Finalized
- `SDD/research/RESEARCH-010-production-readiness.md` — Backups, monitoring, guardrails, cost tracking, security hardening. Updated post-pablo-merge to incorporate SPEC-008 (admin dashboard) and SPEC-009 (PII detection) production implications. 40-item prioritized action plan across 5 phases.
- `SDD/research/RESEARCH-011-sso-gateway-deployment.md` — oauth2-proxy + Caddy + LibreChat native OIDC architecture for unified SSO across all MemodoAI services. Gate + native OIDC pattern (not header-trust). 30-item implementation checklist. Touches both LibreChat repo and infra repo.

### Completeness Notes
Both are infrastructure/operational research (not feature code). Standard SDD checklist sections for "Stakeholder Mental Models" and "Support ticket patterns" are N/A. All applicable sections are complete:
- Data flows, external dependencies, integration points: documented
- Production edge cases with issue numbers: documented (MongoDB #11808, #10304, PII circuit breaker)
- Security considerations: comprehensive (secrets, auth, network, SSRF, PII privacy, OIDC)
- Testing strategy: documented as operational checklists (backup restore testing, SSO flow testing)

Research phase complete. Ready for specification creation (/planning-start) if implementation specs are needed for either document.

### Planning Phase: SPEC-010
**Date**: 2026-04-01
**Status**: COMPLETE (Draft)
**Document**: `SDD/requirements/SPEC-010-production-readiness.md`

Specification created from RESEARCH-010 and two rounds of critical review (v1 and v2). Covers:
- 49 functional requirements (REQ-001 through REQ-049) across 5 phases
- 8 non-functional requirements (PERF, SEC, AVAIL, OPS)
- 11 edge cases (EDGE-001 through EDGE-011) with test approaches
- 8 failure scenarios (FAIL-001 through FAIL-008) with recovery procedures
- 9 identified risks with mitigations
- All 47 action plan items from research mapped to requirements (3 explicitly skipped: Redis, email, OpenAI moderation)
- Two code fixes tracked: admin rate limiting (REQ-042), MongoDB timeout codes (REQ-043)

All HIGH and MEDIUM findings from both critical reviews are addressed in the spec. Ready for implementation (/implement-start) when prioritized.

### Planning Phase: SPEC-010 — Critical Review Findings Addressed
**Date**: 2026-04-01
**Status**: Planning Phase - REVISED

All findings from CRITICAL-SPEC-production-readiness-20260401.md have been resolved:
- 6 ambiguities fixed (REQ-011 decision made, REQ-010 investigation task added, REQ-004 fallback defined, REQ-039 split, REQ-018 RTO revised to 4h/1h, REQ-028 topology decided)
- 8 missing specifications added (rollback procedures, phase ordering, cron management, MeiliSearch recovery, secret rotation, staging clarification, Redakt deployment details, monitoring health checks)
- 9 research disconnects addressed (2 new requirements: REQ-051 node_exporter, REQ-052 SSRF; 7 documented as out of scope with rationale)
- 3 risk severity levels updated (RISK-003 LOW->MEDIUM, RISK-005 LOW->MEDIUM, RISK-006 MEDIUM->HIGH)
- 2 new risks added (RISK-010 feature interaction cascade, RISK-011 config drift)
- 6 edge cases added (EDGE-012 through EDGE-017)
- 5 untestable criteria made testable (REQ-044, REQ-046, REQ-048, AVAIL-002, SEC-004)
- 3 contradictions resolved (REQ-041 fail-open default, REQ-014-A log escalation, REQ-023-A local backup cache)
- New requirements added: REQ-014-A, REQ-023-A, REQ-027-A, REQ-039-A, REQ-041-A, REQ-050 through REQ-053
- Findings Addressed section appended to the critical review document

### Implementation Phase: SPEC-010
**Date**: 2026-04-01
**Status**: Implementation - COMPLETE
**Tracking**: `SDD/prompts/PROMPT-010-production-readiness-2026-04-01.md`

All deliverables created across 5 phases:
- Phase 1 (Security): docker-compose.prod.yml, prod.sh, .env.prod.template, mongodb-auth-migration.sh, .gitignore updates
- Phase 2 (Backups): 4 backup scripts, crontab.prod, restore procedures
- Phase 3 (Monitoring): Prometheus + Grafana compose, scrape config, 12+ alert rules, monitoring watchdog
- Phase 4 (Guardrails): librechat.yaml.prod.example with registration restriction, balance, SSRF; REQ-042/043 already done
- Phase 5 (Operational): 6 runbooks (service-restart, backup-restore, secret-rotation, pii-override, disaster-recovery, log-escalation)

Key findings: REQ-042 and REQ-043 were already implemented in SPEC-008 work. CORS (REQ-010) is unconditional in code — needs Caddy rule in infra repo.

### Planning Phase: SPEC-010 — Validation
**Date**: 2026-04-01
**Status**: Planning Phase - COMPLETE

Validated SPEC-010-production-readiness against the planning-complete checklist. All sections pass:
- Executive Summary: research ref, date, author, status present
- Research Foundation: 15 production issues, stakeholder validation, 8 integration points with file:line refs
- Intent: problem statement, 5-phase solution approach, 14 measurable outcomes
- Success Criteria: 49 functional reqs (REQ-001..049), 16 non-functional reqs (PERF/SEC/AVAIL/OPS)
- Edge Cases: 11 cases (EDGE-001..011) with research refs, current/desired behavior, test approaches
- Failure Scenarios: 8 scenarios (FAIL-001..008) with triggers, behavior, user comms, recovery
- Implementation Constraints: context budget, essential files, 8 technical constraints
- Validation Strategy: unit/integration/edge/performance/manual tests all specified
- Dependencies and Risks: 7 external deps, 9 risks with mitigations
- Implementation Notes: phase ordering, 6 subagent delegation areas, 6 critical considerations

Cross-check with research: All 47 action plan items from RESEARCH-010 are accounted for (44 active items mapped to requirements, 3 explicitly skipped: Redis, email, OpenAI moderation). The spec adds 5 items beyond the action plan (REQ-001 compose file, REQ-002 prod.sh, REQ-017 gitignore, REQ-022 config backup, REQ-026 Caddy cert backup). No gaps found.

---

## Previous Research (Archived)

| Research | Topic | Status | Branch |
|----------|-------|--------|--------|
| RESEARCH-009 | PII detection integration | COMPLETE — Implemented as SPEC-009 | `feature/009` → merged to `pablo` |
| RESEARCH-008 | Admin reporting dashboard | COMPLETE — Implemented as SPEC-008 | `feature/008` → merged to `pablo` |
| RESEARCH-007 | Usage and chat logging | COMPLETE | — |
| RESEARCH-006 | Microsoft Entra SSO | COMPLETE | — |
| RESEARCH-005 | Microsoft 365 MCP integration | COMPLETE | — |
| RESEARCH-004 | Self-hosted Cassandra | COMPLETE (abandoned) | — |
| RESEARCH-003 | Astra Assistants API overview | COMPLETE | — |
| RESEARCH-002 | File upload alternatives | COMPLETE | — |
| RESEARCH-001 | Agent workflow API | COMPLETE | — |

## Implementation Phase - COMPLETE

### Feature: Production Readiness (SPEC-010)
- **Specification:** SDD/requirements/SPEC-010-production-readiness.md
- **Implementation:** SDD/prompts/PROMPT-010-production-readiness-2026-04-01.md
- **Summary:** SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-010-2026-04-01_23-00-00.md
- **Completion:** 2026-04-01

### Final Status
- All deliverable requirements: Implemented
- Manual/operational requirements: Documented as N/A with runbooks
- Code review: APPROVED WITH NOTES (5 issues, all addressed)
- Critical review: All 20 findings addressed
- REQ-042/043: Already implemented from SPEC-008

### Artifacts
- 22 new files created (configs, scripts, monitoring, runbooks)
- 1 file modified (.gitignore)
- No application code changes needed

### Next Steps
- Deploy Phase 1 (security hardening) first
- Follow implementation ordering in spec Section "Implementation Notes"
- Configure external services (uptime monitoring, Azure budget alerts)
- Run DR drill to validate RTO

---

# SPEC-014: Microsoft 365 MCP Integration

**Feature ID:** 014
**Feature name:** m365-mcp-integration
**Branch:** feature/014 (off pablo)
**Mode:** supervised (default; user opted-in to no-clarifying-questions for this session)
**Started:** 2026-05-18

## Phase entry state

- **Research Phase — COMPLETE (pre-existing)**
  - Substantive research at `SDD/research/RESEARCH-005-m365-mcp-integration.md` (2026-03-30; May 2026 verification confirmed against LibreChat v0.8.4-rc).
  - Pointer stub at `SDD/research/RESEARCH-014-m365-mcp-integration.md` (sequence-number alignment).
  - No CLARIFICATION artifact — clarification gate skipped (spec was hand-drafted by Pablo + Claude in collaboration); recorded for downstream visibility.
  - No fresh research subagent run; research validation already covered by Pablo's May 2026 Obsidian verification pass.

- **Planning Phase — IN PROGRESS**
  - Spec drafted at `SDD/requirements/SPEC-014-m365-mcp-integration.md` (2026-05-13, status: Draft).
  - Spec lacks SDD 1.2.0 frontmatter (`review_panel`, `eval_required`, `cross_cutting_decisions`) and `## Modules` section. Step 3a-equivalent (planning-augmentation) needed before Step 3c panel review.

## Phase log

### 2026-05-18 — Flow initialization
- Branch `feature/014` created from `pablo`.
- SDD bookkeeping directories created (`adr/`, `flow/`, `prompts/context-management/counters/`, `prompts/implementation-complete/`).
- Task list seeded (14 tasks covering Steps 3a-augmentation, 3b-3f, 4a-4i).
- Next action: spawn planning-augmentation subagent to add SDD 1.2.0 frontmatter + Modules section to the spec.

### 2026-05-18 — Step 3a planning-augmentation COMPLETE

**Spec frontmatter added** to `SDD/requirements/SPEC-014-m365-mcp-integration.md`:
- `review_panel: [security, performance, api-contract, module-depth, privacy, reliability]`
  - `security` — OBO/BYOT plumbing, SSRF allowlist, scope discipline.
  - `performance` — cold-start (PERF-001), steady-state latency budget (PERF-002), OBO token reuse (PERF-003).
  - `api-contract` — spec defines the MCP server interface plus the `librechat.yaml` contract.
  - `module-depth` — SDD 1.2.0 default; applies here (sidecar is the deep module).
  - `privacy` — user M365 data passes through tools and is subject to SPEC-009 PII detection (REQ-019).
  - `reliability` — start ordering (REQ-018), cold-start tolerance (PERF-001), clean failure surfacing (REQ-015/016).
  - `data-modeling` dropped — no DB schema changes; the OBO token-cache shape is pre-existing.
  - `cost` dropped — no high-traffic concern, no per-seat licensing.
- `eval_required: false` — config + Docker sidecar deployment; no LLM output to evaluate probabilistically.
- `cross_cutting_decisions: [mcp_byot_auth_pattern, phase1_readonly_graph_scopes]` — both bind future M365-style MCP work: REQ-006 (BYOT-only, never Softeria-managed OAuth) sets the pattern for any future Graph-backed sidecar; REQ-008's phase-1 read-only delegated-scopes choice is a deliberate boundary that future phase-2 / new-MCP work will inherit or explicitly override.
- `delivery_mode: whole-feature` — small config + sidecar, ships as one unit.

**Modules section added** (3 modules, inserted before "Out of Scope"):
- MODULE-001: `mcp-m365` sidecar (Softeria server) — deep, medium risk; owns 18 spec items (REQ-001/002/003/006/010/011/012/013/018, SEC-001/003/005, PERF-001/002, OPS-001/002/003, OD-1/5).
- MODULE-002: LibreChat MCP integration surface (librechat.yaml + BYOT plumbing) — low risk, config-only on tested infra; owns 13 spec items (REQ-004/005/007/014/015/016/019, SEC-002/004, PERF-003, UX-001/002, OD-2/3).
- MODULE-003: Entra app registration & OBO scope configuration — medium risk (scope changes invalidate token cache and require tenant admin consent); owns 3 spec items (REQ-008, REQ-009, OD-4).

**Spec-item mapping**: all REQ/SEC/PERF/OPS/UX items mapped to a module. REQ-017 (SharePoint file picker untouched) is intentionally not module-owned — it is an explicit cross-module non-goal; noted as such in the Modules section so a future reader does not flag it as orphan.

**Glossary initialized** at `SDD/UBIQUITOUS_LANGUAGE.md` — 12 canonical terms across "Auth & token plumbing" (Graph access token, OBO exchange, BYOT, delegated Graph scopes, Entra app registration, `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder), "MCP architecture" (MCP sidecar, streamable-HTTP transport, `mcpSettings.allowedDomains`, `serverInstructions`), and "Operational concepts" (phase-1 read-only, `caddy_net`, `./prod.sh`).

### 2026-05-18 — Step 3b ADR capture COMPLETE

Two cross-cutting ADRs captured (frontmatter-declared, Trigger C, pre-approved):

- **ADR 0001** — `SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md`
  - Title: "Authenticate Entra-delegated MCP servers via LibreChat-resolved BYOT over OBO"
  - Topic: `mcp_byot_auth_pattern` — binds all future Entra-delegated MCP servers in this stack to BYOT-only mode (no per-server OAuth client). Rejected alternatives: Softeria-side OAuth (issue #187 race), app-only (no per-user audit), MCP-server-side OAuth (duplicated infra).

- **ADR 0002** — `SDD/adr/0002-readonly-default-delegated-graph-scopes.md`
  - Title: "Default to read-only delegated Graph scopes for new MCP integrations"
  - Topic: `phase1_readonly_graph_scopes` — sets security posture: every new delegated-Graph scope rollout ships read-only with explicit promotion gate (soak + review per SPEC-014 OD-4). Subagent confirmed cross-cutting reading after applying scope test; treats this as a policy/invariant rather than a phase milestone. Rejected alternatives: read-write from day 1, per-scope mixed launch.

- Index reconciled at `SDD/adr/README.md` (both ADRs listed; orchestrator-driven write to avoid sibling-subagent race).

Next action: Step 3c specialist panel review on the augmented spec.

### 2026-05-18 — Step 3c panel review iteration 1 COMPLETE

Six specialists ran in parallel (security, performance, api-contract, module-depth, privacy, reliability) and wrote partial findings files. Aggregator consolidated into:
- `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md`

**Panel Review Iterations**

| Iteration | HIGH | MEDIUM | LOW | Verdict | Timestamp |
|-----------|------|--------|-----|---------|-----------|
| 1 | 9 | 11 | 6 | STOP AND RECONSIDER | 2026-05-18 ~12:55 |

Pre-dedup specialist counts: security 7, performance 7, api-contract 7, module-depth 3, privacy 10, reliability 9 (43 total). After cross-specialist dedup: 9H/11M/6L (26 total).

Cross-specialist clusters identified (6):
- Supply-chain: unpinned Softeria image (security + api-contract + privacy)
- Sidecar log content / token-in-logs (security + privacy)
- OBO thundering herd on restart (performance + reliability)
- Bearer/error-shape contract under-definition (security + api-contract)
- `allowedDomains` hostname-only weakness (security + api-contract)
- Readiness/liveness conflation (reliability + performance)
Plus 1 structural finding: MODULE-002 low-risk tier under-allocates downstream review depth on the PII-adjacent path.

Top HIGH actions for fix subagent:
1. Pin Softeria image with integrity hash; document supply-chain posture.
2. Narrow phase-1 Graph scopes to least privilege (drop `Files.Read.All` / `Sites.Read.All` to scoped alternatives where feasible; justify if retained).
3. Add information-governance subsection (sub-processor disclosure, retention, DSR pathway, controller role).
4. Replace `service_started` with `service_healthy`; resolve OD-5 readiness endpoint before merge.
5. Add single-flight / request coalescing for OBO exchanges; document restart-thundering-herd posture.

Verdict triggers the bounded fix-and-re-review loop (max 3 iterations). Iteration 1 fix subagent spawning next.

### 2026-05-18 — Step 3e fix iteration 1 + panel re-run COMPLETE

Fix subagent resolved all 9 HIGH and 11 MEDIUM findings from iter1 panel review. Added 11 new REQs (REQ-020..030), 9 new NFRs (SEC-006/007/008, PERF-004, OPS-004, REL-001/002/003, UX-003), promoted MODULE-002 risk low→medium, resolved OD-1 and OD-5, added OD-6 (governance handoff). Five organizational findings explicitly scoped out via Privacy & Compliance Scope subsection (DPA / sub-processor / DSR / joint-controller / egress-restriction-mechanism). Spec grew 344→468 lines.

Iter1 panel review renamed to `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518-iter1.md` for audit trail.

Iter2 panel re-run (six fresh specialists + aggregator) produced new panel doc at canonical path `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md`:

| Iteration | HIGH | MEDIUM | LOW | Verdict | Strict-decrease check |
|-----------|------|--------|-----|---------|----------------------|
| 1 (initial gate) | 9 | 11 | 6 | STOP AND RECONSIDER | — |
| 2 (after fix iter 1) | 1 | 11 | 12 | REVISE BEFORE PROCEEDING | HIGH ✓ (9→1) |

Pre-dedup specialist counts iter2: security 4, performance 5, api-contract 6, module-depth 2, privacy 2, reliability 8 (27 total). Post-dedup: 24 findings.

Top remaining items for iter2 fix:
- HIGH: Liveness/readiness conflation in single healthcheck (Reliability) — split into separate probes.
- MEDIUM (cross-domain): REQ-021 single-flight + REQ-022 cache-key normalization specified-but-not-implemented in `GraphTokenService.js` — promote to numbered ODs as release gates (Perf + Reliability flagged).
- MEDIUM (cross-domain): REQ-024 queue-wait stacks with outer MCP timeout — reduce queue cap, FIFO, bounded depth (Perf + Reliability).
- MEDIUM (cross-domain): Verification Plan gap on REQ-019 PII detection + SEC-004 audit assertion (Security + Privacy).
- MEDIUM: REQ-027 MCP protocol pin deferred — pin or document version-pin policy (API-contract + Reliability).

Iter2 fix subagent spawning next (loop iteration 2 of max 3).

### 2026-05-18 — Step 3e fix iteration 2 COMPLETE (crash-recovered)

The iter2 fix subagent edited SPEC-014 but the host session crashed before its return completed. Spec edits landed cleanly: 468 → 540 lines (+72). Confirmed via git diff and structural grep on the spec:
- REQ-018 expanded to split liveness + readiness probes (resolves the 1 HIGH from iter2 panel).
- REQ-020 Bearer token JWT-invariant contract (iss, aud, ver, oid, exp validation in `GraphTokenService`).
- REQ-021 single-flight OBO with explicit "blocking dependency for production rollout" gate language.
- REQ-022 scope cache-key normalization (trim/lowercase/sort/comma-join).
- REQ-023 correlation-ID propagation for audit reconstruction (REQ-019 + SEC-004 Verification gap).
- REQ-024 per-user rate limit with bounded FIFO queue + queue-wait timeout < MCP outer timeout.
- REQ-025 cascading-timeout discipline (Softeria → Graph timeout < LibreChat MCP timeout).
- REQ-027 MCP protocol version pin + ProtocolMismatch short-circuit (no circuit-breaker on non-transient protocol drift).
- REQ-028 `serverInstructions` drift control with version marker + SHA-256 baseline + REQ-008 scope-surface grep.
- REQ-031 NEW: `mcp-m365` hostname uniqueness on `caddy_net` (CI assertion); OD-10 added (extend `isDomainAllowedCore` to scheme+host+port).

Audit-trail block "Findings Addressed (Iteration 2 — crash-recovered audit trail)" appended to `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md` by the orchestrator (manual reconstruction from spec diff, since the iter2 fix subagent's structured return was lost in the crash).

Counter file `3e-fix-iter2-2026-05-18_13-20-00.md` showed Reads 2/10 at crash time, consistent with the subagent having loaded the panel doc + spec before editing.

Next action: Iter3 panel re-run to verify whether iter2 fix edits clear the gate. This is panel run #3 / loop iteration 2 of fix-and-re-review; one more loop iteration available before the cap.

### 2026-05-18 — Step 3c panel iteration 3 + Panel Review Halt

Iter3 panel ran (six fresh specialists + aggregator). Iter2 panel doc renamed to `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518-iter2.md`; iter3 wrote to the canonical path.

| Iteration | HIGH | MEDIUM | LOW | Verdict |
|-----------|------|--------|-----|---------|
| 1 (initial gate) | 9 | 11 | 6 | STOP AND RECONSIDER |
| 2 (after fix iter 1) | 1 | 11 | 12 | REVISE BEFORE PROCEEDING |
| 3 (after fix iter 2) | 1 | 11 | 12 | STOP AND RECONSIDER |

Pre-dedup iter3 specialist counts: security 4, performance 7, api-contract 6, module-depth 3, privacy 2, reliability 4 (26 total). Post-dedup: 24 findings.

**Progress-stall check (iter2 → iter3): HIGH strict-decrease ✗ (1 → 1).**

The iter2 HIGH (liveness/readiness conflation) WAS resolved by REQ-018 update. The iter3 HIGH is a NEW finding — Performance specialist surfaced a cascading-timeout arithmetic violation introduced by iter2's added REQ-024 / REQ-025 timeouts: `queue_wait_max (30s) + graph_inner_timeout (30s) = 60s > outer_mcp_timeout (45s)`. Calls escaping the queue can overrun the outer timeout and surface as `UpstreamUnavailable` rather than `Throttled`, potentially mistripping the REL-002 circuit breaker.

**Loop halt reason:** `progress-stall` (count-based). Per SDD-flow rationale, the rule is intentionally count-based and fires whenever HIGH does not strictly decrease while non-zero. Even though the specific iter2 HIGH was resolved, the count stayed at 1 — so the protocol halts and escalates to the human reviewer rather than spawning iter4. (The cap of 3 iterations was not reached; this halt is the progress-stall path, not cap-exhaustion.)

### Panel Review Halt

- Total iteration count: 3 (initial + 2 fix iterations)
- Final HIGH/MEDIUM/LOW (iter3, post-dedup): 1/11/12
- Halt reason: progress-stall (HIGH 1 → 1, did not strictly decrease)
- Final verdict: STOP AND RECONSIDER
- Latest panel review: `SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md`
- Iteration history: this section
- Spec state at halt: `SDD/requirements/SPEC-014-m365-mcp-integration.md` (~540 lines, iter2 fixes applied)

**Top items for the user to address manually:**

1. **[HIGH] Cascading-timeout arithmetic** — REQ-024 queue-wait + REQ-025 Graph timeout exceeds REQ-004 outer MCP timeout (30 + 30 > 45). Pick a coherent triplet (e.g., outer 60s, inner 30s, queue-wait 20s) and update the three REQs in lockstep. Cross-flagged by performance + reliability.
2. **[MEDIUM] REL-002 circuit-breaker pinned to "framework default" without file/line reference** — REQ-027's deterministic-failure short-circuit math depends on unverified breaker numbers. Inspect `packages/api/src/mcp/` or `MCPManager` for the actual 7-cycle/45s/exponential-backoff configuration and either cite it or override it explicitly in spec.
3. **[MEDIUM] Combined healthcheck collapses liveness/readiness back into one signal** — REQ-018's named "split" is conceptual only because Docker's `healthcheck` has one slot. Either (a) accept a single readiness-style probe and document trade-off, or (b) wire a separate liveness probe via Prometheus/Watchtower outside Compose. REL-003 "~50s detection" math also contradicts `retries: 8 × 10s = 80s`.
4. **[MEDIUM] Module-depth REQ assignments** — REQ-021 (single-flight OBO runtime) should move from MODULE-003 to MODULE-002; REQ-029/030 (retention + DSR) should also move to MODULE-002. MODULE-002's `Depends on` should add `GraphTokenService`. Mechanical fix.
5. **Several other MEDIUMs and LOWs** documented in the iter3 panel review.

Loop is halted. Per SDD-flow protocol, the orchestrator does NOT proceed to Step 3d (critical review) or beyond. The spec has not been accepted as planning-complete. The user can:

- Address the findings manually in the spec, then re-run the flow via `/sdd-flow continue` (which will resume by re-running the panel review on the fixed spec).
- OR accept the residual findings as known-issues and force-progress the flow (requires manual override since the SDD-flow protocol does not provide an automated "accept-with-residual" path).
- OR decide some of the iter3 findings are out-of-scope and revise the spec to scope them out cleanly.

Recommended path: the iter3 HIGH is narrow and fixable in ~10 minutes of design work (pick coherent timeout triplet). The two structural MEDIUMs (circuit-breaker pin, Docker single-slot healthcheck) benefit from human design judgment. Then `/sdd-flow continue`.

### 2026-05-18 — Step 3e fix iteration 1 COMPLETE (SPEC-014)

- Spec: SDD/requirements/SPEC-014-m365-mcp-integration.md (edited in place)
- Panel review: SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md (Findings Addressed section appended)
- Findings resolved: HIGH 9/9, MEDIUM 11/11, LOW 6/6 (LOW best-effort).
- Findings scoped out: 5 (joint-controller/processor DPA, sub-processor registration, privacy-notice rewrite, DSR runbook authoring, egress mechanism choice) — all surfaced in OD-6 + Privacy & Compliance Scope subsection, ownership named (DPO-equivalent / implementation PR).
- New functional REQs: REQ-020 (Bearer token contract), REQ-021 (single-flight OBO), REQ-022 (scope cache-key normalization), REQ-023 (correlation-id propagation), REQ-024 (rate limit), REQ-025 (cascading timeout), REQ-026 (resource limits), REQ-027 (MCP protocol pin), REQ-028 (serverInstructions drift), REQ-029 (retention), REQ-030 (DSR handoff).
- New NFRs: SEC-006 (sidecar hardening), SEC-007 (log content discipline), SEC-008 (allowedDomains inherited weakness), PERF-004 (tool-list cost), OPS-004 (ordered restart), REL-001 (Graph degradation), REL-002 (circuit breaker named), REL-003 (hung-but-up), UX-003 (Art. 13/14 transparency).
- Structural changes: New "Error Response Schema" subsection (canonical error codes), new "Privacy & Compliance Scope (Information Governance)" subsection, new "Performance measurement" subsection under Verification Plan, MODULE-002 risk tier raised low → medium, MODULE-002 Hides reframed (newly-hidden vs depends-on-unchanged).
- OD changes: OD-1 RESOLVED (release gate), OD-5 RESOLVED-before-merge, OD-6 ADDED (governance handoff blocking-for-production).
- PERF-001/002/003 rewritten with p50/p95/p99 targets and measurement plan; REQ-018 rewritten with `service_healthy` + healthcheck.
- Verification plan expanded from 6 smoke + 3 negative to 10 smoke + 7 negative + Performance measurement subsection.

### 2026-05-18 — Step 3e fix iteration 3 COMPLETE (user-directed) — SPEC-014

- Spec: SDD/requirements/SPEC-014-m365-mcp-integration.md (edited in place; 540 → 593 lines, +53 lines net).
- Panel review: SDD/reviews/PANEL-SPEC-m365-mcp-integration-20260518.md (Findings Addressed section appended).
- Findings resolved: HIGH 1/1, MEDIUM 11/11, LOW 12/12 (full coverage; loop-halt protocol bypassed by explicit user direction; user walked through design-decision items one-by-one).

**Investigation outcomes:**
- `@librechat/agents` reconnect/circuit-breaker grep: NOT in `@librechat/agents` (initial assumption wrong). Correct location: `packages/api/src/mcp/mcpConfig.ts:7-29` (consumed at `packages/api/src/mcp/connection.ts:289-365`). Real constants pinned: `CB_MAX_CYCLES=7`, `CB_CYCLE_WINDOW_MS=45_000`, `CB_CYCLE_COOLDOWN_MS=15_000`, `CB_MAX_FAILED_ROUNDS=3`, `CB_BASE_BACKOFF_MS=30_000`, `CB_MAX_BACKOFF_MS=300_000`. The "7 cycles / 45s window / exponential backoff" framing matches `CB_MAX_CYCLES + CB_CYCLE_WINDOW_MS`; the exponential-backoff path is more precisely `CB_BASE_BACKOFF_MS → CB_MAX_BACKOFF_MS` after `CB_MAX_FAILED_ROUNDS` consecutive failed rounds in `CB_FAILED_WINDOW_MS=120_000`. REL-002 rewritten with verbatim Jest regression test importing the `mcpConfig` constants.
- `node:22-alpine` digest resolution: BOTH `docker manifest inspect` AND Docker Hub API succeeded. Multi-arch OCI index digest `sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920` resolved 2026-05-18 (covers amd64 and arm64). Recorded in REQ-002, Implementation Plan §1 Dockerfile, and OD-1. Implementation PR re-resolves at PR time per OD-1 release-gate.

**New items added (numbering):** No new top-level REQ/SEC/PERF/OPS/UX/OD numbers (the 30+8+4+4+3+10 inventory was already present pre-iter3). Substantial extension of EXISTING items:
- REQ-002 (Node digest pin promoted from Future Work).
- REQ-018 (rewritten as single-probe with honest documentation).
- REQ-020 (added `tid`, `nbf`, `InvalidToken` distinction, structured log event).
- REQ-021 (backoff inside single-flight specified; unit-test stub).
- REQ-023 (privacy constraint codified; topology-leak trade-off folded into OD-6).
- REQ-024 (queue-wait tightened 30000 → 14000 ms; `throttleSource` added).
- REQ-025 (cascading-timeout invariant + cancellation semantics on outer-timeout; unit-test stub).
- REQ-027 (upstream-bump policy added).
- PERF-001 (alert threshold revised: 2× baseline OR >10s).
- PERF-002 (per-call vs per-turn budget interpretation; no phase-1 Graph cache).
- PERF-003 (refresh-at-emission, not entry; 60s threshold).
- PERF-004 (recurrence-aware CI check on `mcp-m365/VERSION` bumps).
- REL-002 (file:line pin + verbatim Jest regression test).
- REL-003 (math reconciled with retries: 5, bounded restart_policy explicit).
- UX-001 (MCPManager `_mcp_<server>` suffix-namespacing confirmed via `auth.ts:37-39`).
- OD-1 (unified three-pin Pin Policy: Softeria + Node base image + MCP protocolVersion).
- OD-10 (grep alternation aligned with REQ-031: includes aliases + networks.*.aliases:).
- Error Response Schema (added `schemaVersion: 1`, `throttleSource`, `InvalidToken`, open-enum policy).

**Structural changes:**
- MODULE-002 "Depends on" split into "existing, unchanged" vs "modified by this spec"; `GraphTokenService` added under the latter.
- REQ-021 moved MODULE-003 → MODULE-002. REQ-029, REQ-030 moved MODULE-003 → MODULE-002.
- MODULE-003 spec refs trimmed accordingly.
- Verification §1 extended with `getent hosts` runtime smoke test.
- Verification §8 extended with on-wire schema-shape assertion + retry-classification table assertion.
- Verification §13 updated to assert `tid` + `nbf` + `InvalidToken` distinction.
- Verification §17 extended with `throttleSource` assertions on all three paths + cancellation poll + PERF-003 emission-time refresh test.
- Verification §18 NEW: stuck-stream / slow-loris / chunked-response stall via toxiproxy-style fault injection.
- New Negative test: invariant-failing token surfaces `InvalidToken`.
- Future Work updated: digest pinning REMOVED (now phase-1); two phase-2 follow-ups ADDED (Graph-result cache, HMAC-derivative correlation-ID).

**Lines changed:** spec grew 540 → 593 lines (+53 net); ~25 distinct edit operations across REQs, OD, schema, modules, verification.

**Residual risk / next steps judgment:**
- All HIGH + MEDIUM + LOW findings are resolved IN THE SPEC. The cascading-timeout arithmetic that triggered the iter3 HIGH is now mathematically pinned (`14000 + 30000 + 500 = 44500 < 45000 ✓`) and unit-test enforceable.
- The bypassed protocol step is the auto-spawn of iter4 panel re-review. Given that ALL findings were explicitly walked-through with the user and the resolutions are well-grounded (two investigations confirmed real values, real file:line refs added), an iter4 panel re-run is OPTIONAL — most likely outcome is convergence on a small handful of new LOW findings adjacent to the new content (e.g., reviewers might want stronger language on AbortController handling in REQ-025 cancellation semantics, or a more concrete `mcp-hop-budget` measurement methodology). The user can call `/sdd-flow continue` to run iter4 if desired, or accept the spec as planning-complete and proceed to implementation (with the documented residuals: `node:22-alpine` digest re-resolution at PR time, REQ-029 retention-timer existence in this fork).
- Implementation PR remains the validation point for two items: (a) REL-002 Jest regression test landing alongside any future config tweak, (b) confirming OD-7 / OD-8 / OD-9 / OD-10 release gates close before merge.

### 2026-05-18 — Step 3e fix for Step 3d critical review COMPLETE (user-directed)

Applied user decisions and mechanical fixes for the Step 3d adversarial-generalist critical review (`SDD/reviews/CRITICAL-SPEC-m365-mcp-integration-20260518.md`). All findings closed in this single pass; no panel re-run.

**Resolved counts:** HIGH 2/2, MEDIUM 8/8, LOW 9/9.

**Five design calls walked by the user:**
1. HIGH-1 — REQ-024 queue lives in NEW `packages/api/src/mcp/queue.ts` as `MCPCallQueue` class; per-server-instance composition into `MCPManager.callTool`; bounds apply to `Microsoft365` only; AbortController wired to streamable-http `fetch`; PERF-003 token re-check in same dequeue path; tests at `packages/api/src/mcp/__tests__/queue.test.ts`.
2. MEDIUM-1 — Healthcheck replaced with status-tolerant probe parsing `wget --server-response /mcp` and accepting `200|400|405|406`. OD-5 RESOLVED 2026-05-18.
3. MEDIUM-2 — REQ-021 retry-classification table made explicit (429/5xx/network/DNS-transient retry vs 400/401/403/404/malformed surface).
4. MEDIUM-4 — OD-6 closure requires committed `SDD/governance/OD-6-closure-YYYY-NN.md`, PR-body checkbox, prod-deploy pre-check via `test -f`. Implementation PR creates the `SDD/governance/` directory.
5. LOW-6 — Teams/Chat read deferred to phase 2 alongside coordinated `--org-mode` decision; named entry added to Out-of-Scope; REQ-008 cross-references REQ-010.

**HIGH-2 mechanical fix outcome:** Dockerfile now does `npm pack` + `sha256sum -c` against the recorded SHA before `npm install -g <local-tarball-path>`. Build FAILS on hash mismatch. Closes the OD-1 bypass gap where the recorded SHA was documentation-only.

**Structural changes:**
- New "Cross-Spec Interactions" subsection inserted just before "Out of Scope" (SPEC-008 / SPEC-009 / SPEC-010 / SPEC-012 interaction lines).
- New OD-6 closure-mechanism subsection (closure file + PR checkbox + pre-deploy assertion).
- New REQ-002 build-time tarball-integrity verification subsection.
- New REQ-004 `startup: true` semantics + transport-choice rationale + naming-codification subsections.
- New REQ-010 deferral note (Teams/Chat/Presence/etc.) + phase-2 follow-up entry.
- New REQ-021 explicit retry-classification table.
- New REQ-024 implementation-locus subsection + phase-1 cross-conversation cap clarification.
- New Verification §11 PII canary test-infrastructure subsection.
- New MODULE-002 risk re-narrative paragraph (post-iter3 surface count).
- RESEARCH-014 stub inlined the May 2026 verification key findings; Obsidian-note external dependency removed.
- OD-5 reframed as RESOLVED 2026-05-18 (no more empirical `/health` check needed).
- Implementation Plan §1 Dockerfile rewritten to use `ARG SOFTERIA_VERSION` / `ARG SOFTERIA_SHA256` + VERSION sanity check + `npm pack` integrity verification.
- Implementation Plan §2 Compose healthcheck block rewritten to status-tolerant probe.
- Implementation Plan §4 adds admin-consent verification step (blocks §6).
- Implementation Plan §6 prod deploy command gated by OD-6 closure `test -f` pre-check.

**Glossary entries added (5):** `throttleSource`, `schemaVersion`, `InvalidToken` (vs. `Unauthenticated`), `deterministic-failure short-circuit`, `Cascading-timeout invariant`. Appended under a new "Error envelope & control-plane vocabulary" section in `SDD/UBIQUITOUS_LANGUAGE.md`.

**Lines changed (rough):** spec grew 593 → ~720 lines (+127 net); ~17 inline edit operations across REQs, OD-1/5/6, healthcheck/Dockerfile, module risk, verification §11/§17, cross-spec section, and Out-of-Scope. No new REQ-NNN numbers added (intentional — every change was an inline edit or new subsection within an existing REQ / new top-level subsection).

**Residual risk judgment:**
- Implementation PR remains the validation point for: (a) verifying the `npm pack` filename literal for the scoped package matches `softeria-ms-365-mcp-server-<semver>.tgz`, (b) creating the `SDD/governance/` directory and the first OD-6 closure file, (c) creating the seeded test-fixture documentation at `mcp-m365/test-fixtures.md` before running Verification §11, (d) re-resolving the `node:22-alpine` digest at PR time per OD-1.
- The `MCPCallQueue` is a new control-plane component, not a config tweak — MODULE-002's risk re-narrative now flags this for reviewer attention proportional to surface count. No tier bump (read-only blast radius still bounds consequence-of-failure).
- All adversarial-generalist critical-review concerns are closed in the spec; no further iteration needed before implementation.

### 2026-05-18 — Step 4c address code review findings COMPLETE — SPEC-014

Step 4b code review (`SDD/reviews/REVIEW-014-m365-mcp-integration-20260518.md`) returned APPROVED WITH NOTES with 0 HIGH / 0 MEDIUM / 5 LOW findings. Step 4c subagent resolved all 5.

- **LOW-1** — REQ-027 `protocolVersion` literal now recorded across all three loci: `librechat.yaml` (REQ-027 comment header at Microsoft365 entry), `mcp-m365/VERSION` (reformatted to `KEY=VALUE` two-line: `SOFTERIA_VERSION=1.0.0`, `MCP_PROTOCOL_VERSION=2024-11-05`), and `packages/api/src/mcp/MCPManager.ts` (`MICROSOFT365_EXPECTED_PROTOCOL_VERSION` with cross-locus comment). `mcp-m365/Dockerfile` updated to grep `^SOFTERIA_VERSION=` against the VERSION file rather than full-file string equality, preserving the build-time sanity check against the new format.
- **LOW-2** — Reconciled test-count claim in PROMPT-014. The 85 figure conflated `it()`/`test()` declaration count (65) with executed-test count (~85 once `test.each` parameterized cases are evaluated). New PROMPT-014 "Test-count correction" section documents the breakdown (42 graph + 13 queue + 10 errorEnvelope = 65 declarations → ~85 executed cases). Coverage unchanged; reporting only.
- **LOW-3** — `mcp-m365/serverinstructions.sha256` CI step: documentation acknowledgement only. Baseline file is committed; the GitHub Actions workflow (or shell pre-commit check) is operator-deferred at PR finalization per OD-1 release-gate. Recorded in PROMPT-014 Step 4c block as outstanding for implementation PR.
- **LOW-4** — Removed typo-defended `messageageId` fallback at `MCPManager.ts:534-543`. Verified canonical field name `messageId` against the agent-loop call site (`api/server/controllers/agents/client.js:730-734`: `requestBody: { messageId, conversationId, parentMessageId }`). Added verification-record comment block to prevent re-introduction of the fallback chain.
- **LOW-5** — Cannot in-checkout verify Softeria/SDK-advertised protocol version (no internet from subagent; no node_modules dump for `@softeria/ms-365-mcp-server` + `@modelcontextprotocol/sdk`). Literal kept at `2024-11-05` (latest published MCP stable spec revision per RESEARCH-005); added `TODO(impl-PR)` comment block at `MCPManager.ts:34-58` with: (a) three-locus pinning so the impl-PR knows which files to update if the literal must change, (b) the verification command (`docker exec mcp-m365 node -p "require('@modelcontextprotocol/sdk/package.json').version"`), (c) the consequence of drift (ProtocolMismatch perma-trips Microsoft365 tools).

**Files edited:**
- `librechat.yaml` (Microsoft365 entry — REQ-027 comment header)
- `mcp-m365/VERSION` (`KEY=VALUE` two-line format)
- `mcp-m365/Dockerfile` (grep-based VERSION sanity check)
- `packages/api/src/mcp/MCPManager.ts` (LOW-4 typo removal + LOW-5 verification TODO comment block)
- `SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md` (Step 4c block + LOW-2 reconciliation)
- `SDD/reviews/REVIEW-014-m365-mcp-integration-20260518.md` (Findings Addressed section)

**Outstanding for implementation PR (not Step 4c scope):**
- Resolve `SOFTERIA_VERSION` final value (`npm view @softeria/ms-365-mcp-server@latest version`)
- Resolve `SOFTERIA_SHA256` placeholder (`npm pack` + `sha256sum`)
- Re-resolve `node:22-alpine` digest at merge time per OD-1
- Wire the `serverinstructions.sha256` CI step (LOW-3)
- Verify upstream-advertised `protocolVersion` against pinned literal `2024-11-05` (LOW-5); update all three loci if it differs.

**Status:** Spec implementation now ready for Step 4d critical implementation review.

### 2026-05-19 — Step 4e address critical impl review COMPLETE

The Step 4d critical review returned REVISE BEFORE MERGE (1 HIGH + 5 MEDIUM + 6 LOW). User
ran Softeria 0.110.0 locally, captured the verified placeholder values (semver, tarball
SHA-256, node digest, advertised protocolVersion = `2025-11-25`), and surfaced a NEW HIGH:
Softeria requires `Authorization` on every JSON-RPC call including bare `initialize`,
making the prior `startup: true` bootstrap path unreachable.

Step 4e applied all 13 findings in one pass: protocol pin updated across three loci;
`librechat.yaml` flipped to `startup: false` with REQ-004 / REQ-007 / REQ-025 / REQ-027 /
OD-9 prose updated to match; inner-graph-timeout enforced in `MCPCallQueue` (no more
"thin proxy" hand-wave); `'unknown'` correlation-ID fall-throughs replaced with a typed
`MissingCallContextError`; AbortSignal listener cleanup hoisted out of executor branches
so the grace-fallback path no longer leaks listeners; per-call Authorization header
isolation via try/finally restore around `client.request`; `pumpQueue` now scans the full
queue so a capped user can't starve everyone behind them.

Tests: +7 new (5 in queue.test.ts, 2 in graph.test.ts), 2 tightened/fixed (depth-cap
exact-count + MCPManager mock extension). All 118 tests across the four affected suites
pass; full `packages/api` serial run reports 767 passed, 0 failed.

Build: `npm run build -w @librechat/api` clean.

**Status:** implementation production-ready; recommend Step 4f re-review pass to confirm.

### 2026-05-19 — Implementation Phase - COMPLETE ✓ — SPEC-014

Step 4f implementation-completion subagent: test gate clean, documentation
finalized, glossary updated, ready for Step 4h supervised checkpoint then
Step 4i commit on `feature/014`.

**Test gate**
- Command: `cd packages/api && npx jest --runInBand src/mcp/__tests__ src/utils/__tests__`
- Result: **768 passed, 1 skipped, 0 failed** across 33 suites.
- (Initial run from repo root failed with babel parse errors — Jest config
  in the root workspace cannot resolve TS via the shared babel preset for
  `packages/api`. Running from `packages/api` workspace as per CLAUDE.md
  "Run tests from their workspace directory" instruction worked cleanly.)
- SPEC-014-direct test files: 83 case declarations covering REQ-015 / REQ-020
  / REQ-021 / REQ-022 / REQ-023 / REQ-024 / REQ-025 / PERF-003 + Error
  Response Schema. REQ-027 covered implicitly via the `protocolMismatch`
  envelope test path.
- Integration tests: N/A (deploy-time Verification Plan §1-18).
- E2E tests: N/A (backend MCP, no UI affordances introduced).

**Spec coverage gap analysis**
- All in-code REQs have test coverage.
- 5 operator-deferred REQs have no CI tests by design: REQ-008 (Entra admin
  consent), REQ-013 (host-side egress at deploy), REQ-014 (admin-tool
  denylist at deploy), REQ-029 (LibreChat retention timer — inherited),
  REQ-030 (Memodo information-governance DSR cascade).

**Files written / edited (Step 4f)**
- NEW: `SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-014-2026-05-19_10-30-00.md`
- EDIT: `SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md` (Status
  → Complete; Implementation Completion Summary section appended)
- EDIT: `SDD/requirements/SPEC-014-m365-mcp-integration.md` (Implementation
  Summary section appended at end)
- EDIT: `SDD/UBIQUITOUS_LANGUAGE.md` (3 new terms: `MCPCallQueue`,
  `InvalidGraphTokenError`, `MissingCallContextError`)
- EDIT: this file (progress.md) — this block

**OD-6 governance gate status**
DEFERRED. The DPO-equivalent closure file (`SDD/governance/OD-6-closure-2026-NN.md`)
is operator action at release. Template authored at
`SDD/governance/OD-6-closure-template.md`. The `./prod.sh up` script-level
gate (`test -f SDD/governance/OD-6-closure-*.md`) remains the merge-time
checkpoint.

**Build outcome**
Clean per Step 4e (`npm run build -w @librechat/api`). No new build runs
required at Step 4f (no code touched).

**Pointer**
Full report: `SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-014-2026-05-19_10-30-00.md`.

**Status:** Ready for Step 4h (supervised checkpoint) → Step 4i (commit).
