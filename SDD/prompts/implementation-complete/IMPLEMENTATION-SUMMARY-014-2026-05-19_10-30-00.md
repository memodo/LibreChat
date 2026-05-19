# Implementation Summary: M365 MCP Integration (SPEC-014)

## Feature Overview
- **Specification:** SDD/requirements/SPEC-014-m365-mcp-integration.md
- **Research Foundation:** SDD/research/RESEARCH-005-m365-mcp-integration.md (substantive); SDD/research/RESEARCH-014-m365-mcp-integration.md (sequence-number pointer stub)
- **Implementation Tracking:** SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md
- **ADRs:** SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md, SDD/adr/0002-readonly-default-delegated-graph-scopes.md
- **Glossary:** SDD/UBIQUITOUS_LANGUAGE.md
- **Completion Date:** 2026-05-19 10:30:00
- **Delivery Mode:** whole-feature
- **Branch:** feature/014

## Phase History

| Phase | Outcome |
|-------|---------|
| Step 3a augmentation | Added SDD 1.2.0 frontmatter, 3 modules, initialized glossary |
| Step 3b ADR capture | 2 ADRs published (BYOT auth pattern, read-only scope policy) |
| Step 3c panel review | 3 iterations: 9H/11M/6L → 1H/11M/12L → 1H/11M/12L (progress-stall halt) |
| Step 3e fix (user-directed) | All findings resolved across 2 rounds |
| Step 3d critical review | 2H / 8M / 9L |
| Step 3e fix critical (user-directed) | All 19 findings resolved |
| Step 3f commit | feature/014 commit d7dc62b14 (planning) |
| Step 4a implementation | 3 sub-chunks: Infrastructure, GraphTokenService, MCP code |
| Step 4b code review | APPROVED WITH NOTES (5 LOWs) |
| Step 4c fix code review | All 5 LOWs resolved |
| Step 4d critical impl review | REVISE BEFORE MERGE (1H / 5M / 6L) |
| Step 4e fix critical impl (user-directed) | All 13 findings resolved; placeholders verified by user running Softeria 0.110.0 locally |

## Requirements Completion Matrix

### Functional Requirements (REQ-001..031)

| REQ | Description | Status | Validation |
|---|---|---|---|
| REQ-001 | Sidecar service in both compose files | Complete in code | `docker-compose.override.yml`, `docker-compose.prod.yml` |
| REQ-002 | Sidecar Dockerfile pinned base + Softeria + tarball SHA-256 | Complete in code | `mcp-m365/Dockerfile`, `mcp-m365/VERSION` |
| REQ-003 | No env-resident secrets on sidecar | Complete in code | Compose service env block (empty) |
| REQ-004 | Microsoft365 entry in librechat.yaml | Complete in code | `librechat.yaml` (with `startup: false`) |
| REQ-005 | mcpSettings.allowedDomains extended with `mcp-m365` | Complete in code | `librechat.yaml` |
| REQ-006 | GraphTokenService cache ≤60s margin + on-demand refresh | Complete in code | `graph.ts::getGraphTokenForEmission`, tests |
| REQ-007 | Per-request header substitution on `tools/call` | Complete in code | `queue.ts` post-dequeue resolver; tests |
| REQ-008 | Phase-1 read-only scope set | Operator deferred (Entra admin consent) | `.env.example` records default |
| REQ-009 | Error classification for token + Graph errors | Complete in code | `errorEnvelope.ts` 8-value `code` enum + 3-way `throttleSource`; tests |
| REQ-010 | Retry budget bounded (≤1 token refresh per call) | Complete in code | `graph.ts::runWithOboRetry`; tests |
| REQ-011 | Docker network connectivity (default + caddy_net) | Complete in code | Compose service block |
| REQ-012 | Audit log shape (tool, status, ms, user id; no PII bodies) | Complete in code | `queue.ts` + `MCPManager.ts` structured logger |
| REQ-013 | No host-side egress for sidecar | Operator deferred (working-tree check verified at deploy) | Compose-verified |
| REQ-014 | Tool surface filtered (no admin tools) | Operator deferred (Softeria flag or post-list filter at deploy) | `serverInstructions` policy text |
| REQ-015 | User-error handling (null on no Entra session) | Complete in code | `graph.ts` null return; `queue.ts` null-emission path; tests |
| REQ-016 | serverInstructions hash drift guard | Complete in code | `mcp-m365/serverinstructions.sha256` baseline + CI step (operator-deferred for PR finalization) |
| REQ-017 | initTimeout cold-start budget enforced | Complete in code | `librechat.yaml` `initTimeout: 150000` |
| REQ-018 | Sidecar healthcheck + restart policy | Complete in code | Compose `healthcheck` + `restart: on-failure` |
| REQ-019 | API startup-handshake regression | Complete in code | Cascading-timeout invariant unit test |
| REQ-020 | JWT-invariant validation at Bearer emission | Complete in code | `graph.ts::validateGraphTokenInvariants`; 11 cases |
| REQ-021 | Single-flight OBO exchange + jittered backoff | Complete in code | `graph.ts::SingleFlightCache` + `classifyOboError` + `runOboWithSingleFlightAndRetry`; tests |
| REQ-022 | Scope cache-key normalization | Complete in code | `graph.ts::normalizeScopeKey` + `buildCacheKey`; 7 cases |
| REQ-023 | Correlation-ID propagation for audit reconstruction | Complete in code | `queue.ts::buildCorrelationId` (`conversationId:messageId:toolCallId`); tests |
| REQ-024 | Per-user FIFO queue with bounded depth | Complete in code | `queue.ts::MCPCallQueue`; 4/8 in-flight, 16/32 queued, 14s wait, 5s grace |
| REQ-025 | Cascading-timeout discipline + AbortController | Complete in code | `assertCascadingTimeoutInvariant` at construction; abort + grace-fallback; tests |
| REQ-026 | Resource limits (256m / 0.5 CPU) | Complete in code | Compose `deploy.resources.limits` |
| REQ-027 | Protocol version pin + deterministic-failure short-circuit | Complete in code | `MCPManager.ts::MICROSOFT365_EXPECTED_PROTOCOL_VERSION = '2025-11-25'`; tests |
| REQ-028 | serverInstructions drift control with version marker | Complete in code | SHA-256 baseline committed + marker in `librechat.yaml` |
| REQ-029 | Conversation-inherited retention for tool output | Operator deferred (existing LibreChat retention mechanism) | Inherited from base platform |
| REQ-030 | DSR technical handoff | Operator deferred (Memodo information-governance program) | OD-6 closure template authored |
| REQ-031 | Container hostname uniqueness on caddy_net | Complete in code | Compose service name |

### Non-Functional Requirements

- **SEC-001** No env-resident credentials on sidecar — Complete in code.
- **SEC-002** Token in-flight only (never logged / persisted) — Complete in code. Verified by absence of token in log shape and by `errorEnvelope` redaction posture.
- **SEC-003** Audit-log redaction — Operator deferred (Verification §12 scrape check at deploy).
- **SEC-004** Tool denylist enforcement — Operator deferred (Softeria flag or post-list filter at deploy).
- **SEC-005** SSRF allowlist scope minimized — Complete in code (only `mcp-m365` added).
- **SEC-006** `no-new-privileges`, `cap_drop: ALL`, read-only root — Complete in code.
- **SEC-007** Pinned versions (node:22-alpine digest + Softeria semver + tarball SHA-256) — Complete in code. Re-resolve at PR-merge per OD-1.
- **SEC-008** PII canary fixture — Documented in `mcp-m365/test-fixtures.md`; manual smoke at deploy.
- **PERF-001** Cold-start budget — `initTimeout: 150000` configured. First-deploy baseline measurement deferred to post-deploy.
- **PERF-002** Per-call latency p95 ≤ 3s — First-deploy benchmark; PRE-RESEARCH-013 observability automation.
- **PERF-003** Post-dequeue Bearer freshness re-check — Complete in code (`graph.ts::getGraphTokenForEmission`, `queue.ts` post-dequeue call); 5 cases.
- **PERF-004** Memory steady-state under load — First-deploy measurement deferred.
- **OPS-001** Sidecar hostname stable + greppable — Complete in code.
- **OPS-002** Sidecar logs flow to stdout/stderr — Complete in code (Docker default logging driver).
- **OPS-003** Operator runbook — Deferred to operator docs.
- **OPS-004** Cold-start metric exposed — Deferred to PRE-RESEARCH-013.
- **REL-001** Sidecar self-restarts on crash — Complete in code (`restart: on-failure` + bounded `max_attempts: 5 / window: 5m`).
- **REL-002** API survives sidecar OOM/restart — Complete in code (circuit-breaker pinned; REQ-027 short-circuit bypasses CB on protocol failure).
- **REL-003** Restart-loop bounded — Complete in code.
- **UX-001** Tool descriptions discoverable in builder UI — Complete via `Microsoft365` mcpServers entry.
- **UX-002** Plain-language `serverInstructions` with version marker — Complete in code; SHA baseline committed.
- **UX-003** Privacy-notice rewrite — Deferred to privacy-notice owner per spec.

## Implementation Artifacts

### New Files Created
- `mcp-m365/Dockerfile` — sidecar build; pinned `node:22-alpine` digest + Softeria 0.110.0 + tarball SHA-256.
- `mcp-m365/VERSION` — `KEY=VALUE` two-line: `SOFTERIA_VERSION=0.110.0`, `MCP_PROTOCOL_VERSION=2025-11-25`.
- `mcp-m365/serverinstructions.sha256` — REQ-028 drift control baseline (SHA-256 over `serverInstructions` body in `librechat.yaml`).
- `mcp-m365/test-fixtures.md`, `mcp-m365/tool-projection.md`, `mcp-m365/README.md` — operator-facing.
- `SDD/governance/README.md`, `SDD/governance/OD-6-closure-template.md` — OD-6 governance scaffolding.
- `packages/api/src/mcp/queue.ts` — `MCPCallQueue` class implementing REQ-024 + REQ-025 + REQ-007 post-dequeue resolver; ~511 lines.
- `packages/api/src/mcp/errorEnvelope.ts` — 8-value `code` enum, 3-way `throttleSource`, schemaVersion, `MissingCallContextError`.
- `packages/api/src/mcp/__tests__/queue.test.ts` — ~26 declared cases.
- `packages/api/src/mcp/__tests__/errorEnvelope.test.ts` — 12 declared cases.
- `packages/api/src/utils/__tests__/graph.test.ts` — 45 declared cases.
- `SDD/prompts/PROMPT-014-m365-mcp-integration-2026-05-18.md` — tracker.
- `SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-014-2026-05-19_10-30-00.md` — this file.

### Modified Files
- `docker-compose.override.yml`, `docker-compose.prod.yml` — `mcp-m365` service + `api.depends_on` (map-form, re-declaring base list).
- `librechat.yaml` — `Microsoft365` mcpServers entry (with `startup: false`); REQ-027 comment header; `mcpSettings.allowedDomains` hostname entry.
- `.env.example` — `OPENID_GRAPH_SCOPES` default + `MEMODO_TENANT_ID` + `GRAPH_EXPECTED_AUDIENCE`.
- `api/server/services/GraphTokenService.js` — minimal delegation into `@librechat/api` graph utilities; preserves the legacy Keyv cache while adding REQ-022 cache-key normalization + PERF-003 emission-time re-check.
- `packages/api/src/utils/graph.ts` — REQ-020 / REQ-021 / REQ-022 / PERF-003 (JWT-invariant validation, single-flight + retry classification, scope cache-key normalization, post-dequeue freshness, `InvalidGraphTokenError`).
- `packages/api/src/mcp/MCPManager.ts` — queue composition + REQ-027 ProtocolMismatch short-circuit + REQ-023 correlation-ID propagation.
- `SDD/requirements/SPEC-014-m365-mcp-integration.md` — Implementation Summary section appended.
- `SDD/prompts/context-management/progress.md` — Implementation Phase - COMPLETE block appended.
- `SDD/UBIQUITOUS_LANGUAGE.md` — 3 new terms (`MCPCallQueue`, `InvalidGraphTokenError`, `MissingCallContextError`).

## Verified Production Values

These values were verified by running Softeria locally during Step 4e:
- Softeria semver: **`0.110.0`**
- Softeria tarball SHA-256: **`38e495a29e7357f6777af6bf643c71ee9fd662fcd0aeec754c966ad8ea76ad8e`**
- `node:22-alpine` digest (2026-05-19): **`sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c`**
- MCP `protocolVersion` advertised by Softeria 0.110.0: **`2025-11-25`**
- Server identity: **`Microsoft365MCP v0.110.0`**

NOTE: Re-resolve these at PR merge time — the `node:22-alpine` tag mutates and Softeria may publish a new version between now and merge.

## Cross-Cutting Decisions (ADRs)

- **ADR 0001** — Authenticate Entra-delegated MCP servers via LibreChat-resolved BYOT over OBO. Binds future M365-style MCP integrations to BYOT-only mode (no per-server OAuth client). Rejected: Softeria-side OAuth, app-only, MCP-server-side OAuth.
- **ADR 0002** — Default to read-only delegated Graph scopes for new MCP integrations. Soak-period gate per OD-4 before any phase-2 write enablement.

## Test Coverage Summary

- **Test Suite Result:** 768 passed, 1 skipped, 0 failed (full `packages/api` `mcp/__tests__` + `utils/__tests__` serial run, 33 suites).
- **Unit Tests:** 90+ cases across `queue.test.ts` (26), `errorEnvelope.test.ts` (12), `graph.test.ts` (45) directly cover REQ-015 / REQ-020 / REQ-021 / REQ-022 / REQ-023 / REQ-024 / REQ-025 / REQ-027 / PERF-003 / Error Response Schema. Coverage extends across 33 affected suites (768 cases) including unchanged MCP plumbing that the new queue composes into.
- **Integration Tests:** N/A. Justification — the LibreChat side has no isolated integration test framework for MCP server end-to-end interactions; integration testing happens at deploy time via Verification Plan §1-18 (deploy + smoke) using a live Softeria sidecar and a real Memodo Entra test user.
- **E2E / Playwright Tests:** N/A. Justification — SPEC-014 is a backend MCP integration with NO web-facing UI changes; the existing agent-builder surface is data-driven from the unchanged MCP toolchain. No new UI affordance, no E2E selectors to write. (Phase-2 write surfaces would re-introduce E2E requirements.)
- **Operator-deferred REQs (no CI tests by design):** REQ-008 (Entra admin consent), REQ-013 (host-side egress check verified at deploy), REQ-014 (admin-tool denylist verified at deploy), REQ-029 (LibreChat retention timer; inherited from platform), REQ-030 (DSR cascade; Memodo information-governance program).
- **Spec contains no EDGE-XXX or FAIL-XXX** (whole-feature delivery mode; REQs encode failure handling inline) — N/A.

## Architecture Decisions (in code)

1. **`MCPCallQueue` as composition over inheritance.** New module wrapping `MCPManager.callTool` for the Microsoft365 server only (per-server instance). Other servers bypass the queue entirely. Cleaner than surgically modifying `MCPManager`. Surfaced late (Step 3d HIGH-1) and explicit in REQ-024.
2. **JWT claim shape validation, NOT signature verification** (`graph.ts::validateGraphTokenInvariants`). Microsoft already signed the token; LibreChat's job is to enforce business invariants (`aud`, `tid`, `oid`, `appid`, `exp`, `nbf`). Avoids importing `jose` / `jsonwebtoken` as a new dependency.
3. **Single-flight retry inside the in-flight promise**, not at each caller (`graph.ts::SingleFlightCache` + `classifyOboError`). K=10 concurrent callers see exactly 1 successful resolve and ≤3 Entra calls total even under transient 5xx.
4. **`startup: false` for Microsoft365** (verified late in Step 4e): Softeria 0.110.0 requires `Authorization` at `initialize`. Lazy connect deferred to first user-scoped tool call; PERF-001 5s cold-start budget covers it.
5. **Inner timer enforced by LibreChat**, not by Softeria (`queue.ts` post-Step 4e). Removes dependence on Softeria honoring an env-var inner timeout; cleaner cascading-timeout invariant.

## Deployment Readiness

### Environment Requirements (production-side)
- `OPENID_GRAPH_SCOPES=User.Read,Mail.Read,Calendars.Read,Files.Read.All,Sites.Read.All,Contacts.Read,Tasks.Read,Notes.Read.All,offline_access` (operator-applied to `.env.prod`).
- `MEMODO_TENANT_ID=<Memodo Entra tenant ID>` (`.env.prod`).
- `GRAPH_EXPECTED_AUDIENCE=https://graph.microsoft.com` (default is correct for most tenants).
- REQ-009 / OD-6 `.env.prod` update is operator action.

### Database / Schema Changes
- None.

### API Changes
- None directly. The `Microsoft365` MCP server registers ~70 tools into the agent toolchain via the existing `MCPManager` surface.

### OD-6 Governance Gate
The prod deploy command is gated by `test -f SDD/governance/OD-6-closure-*.md`. The DPO-equivalent's closure attestation (per `SDD/governance/OD-6-closure-template.md`) must be committed before `./prod.sh up` will run.

## Rollback Plan

### Rollback Triggers
- Microsoft365 tool calls failing with `code: ProtocolMismatch` after first deploy → Softeria advertised a `protocolVersion` different from `2025-11-25`. Recovery: update `MICROSOFT365_EXPECTED_PROTOCOL_VERSION` in `MCPManager.ts` + `librechat.yaml` + `mcp-m365/VERSION`; redeploy.
- `code: InvalidToken` storming → `MEMODO_TENANT_ID` or `LIBRECHAT_CLIENT_ID` misconfigured. Recovery: verify `.env.prod` Entra values; redeploy.
- Sidecar OOM at sustained load → REQ-026 limits (256m / 0.5 CPU) too tight. Recovery: raise limits in compose files; redeploy.

### Rollback Steps
1. Comment out the `Microsoft365` entry in `librechat.yaml` AND remove `mcp-m365` from `api.depends_on` in compose files.
2. `./prod.sh restart api` (sidecar stays running but unused).
3. Investigate root cause; the sidecar can be redeployed independently.

## Lessons Learned

1. **Verify upstream behavior empirically.** Step 4c's TODO ("verify Softeria's `protocolVersion`") would have silently bricked first deploy. Step 4e's "run the sidecar locally" pattern surfaced the truth in ~5 minutes (literal was `2024-11-05`, advertised was `2025-11-25`).
2. **Critical review catches what spec-aligned review misses.** Step 4b approved with 5 LOWs; Step 4d found a HIGH that would have broken production (the inner-timeout hand-wave). Both reviews are necessary.
3. **Bounded fix loops with progress-stall checks work.** The 3-iteration cap + HIGH-strict-decrease rule routed back to user judgment exactly when the panel was no longer converging.
4. **User-directed design calls at gate boundaries.** ~12 distinct design decisions across Steps 3e (iter3 + critical), 4c, 4d, 4e. Each one made the spec more precise than the panel/critical reviewer alone could have.

## Next Steps

### Immediate (deploy)
1. Commit implementation (Step 4i, pending supervised checkpoint at Step 4h).
2. PR finalization: re-resolve `node:22-alpine` digest and Softeria tarball SHA-256 at PR merge time.
3. Draft `SDD/governance/OD-6-closure-2026-NN.md` with DPO-equivalent.
4. Update `.env.prod` on prod host (REQ-009 + new `MEMODO_TENANT_ID` + `GRAPH_EXPECTED_AUDIENCE`).
5. Grant admin consent on Memodo Entra app registration for the 9 phase-1 scopes (Implementation Plan §4).
6. Deploy per Implementation Plan §6.

### Post-Deployment
- Watch `mcp.connect.deterministic_failure` log (REQ-027 short-circuit indicator).
- Run Verification Plan §1-18 smoke tests.
- Collect first 10 cold-start latencies → commit `mcp-m365/perf-baseline.json`.

### Phase 2 (deferred, separate spec)
- Decide `--org-mode` alongside any write-scope promotion.
- Re-evaluate per-tool Graph-result cache if telemetry shows >30% repeat-fetch rate in 60s windows.
- Promote selective phase-1 read scopes to read-write per business value (OD-4 soak gate).
