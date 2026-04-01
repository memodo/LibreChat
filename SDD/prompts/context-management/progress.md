# Research Progress

## Current: RESEARCH-012-post-merge-e2e-tests

### Research Phase Summary
**Date**: 2026-04-01
**Status**: COMPLETE
**Branch**: `feature/012-post-merge-e2e-tests`

### Research Question
What Playwright e2e tests should be written to guarantee custom MemodoAI features (PII detection, admin reporting dashboard) survive upstream merges from `main`?

### Key Findings

#### 1. Existing E2E Coverage
- 8 spec files: a11y, landing, messages, keys, popup, settings, nav, pii-detection
- PII detection tests: 3 detection cases + 2 admin dashboard checks (heading + table row only)
- Standard LibreChat tests cover core functionality but NOT custom feature integration points

#### 2. High-Risk Merge Points Identified
- 5 route files with PII middleware placement (agents/chat, assistants/chatV1, chatV2, agents/openai, agents/responses)
- 2 SSE hooks with data.warning handling (useSSE.ts:108-110, useResumableSSE.ts:586-588)
- 2 package files (ErrorTypes enum, GuardrailEvent model)
- Route registration (Dashboard.tsx, routes/index.tsx)
- Admin role/capability system

#### 3. Test Suite Design — 8 Tests Proposed

| # | Test | Priority |
|---|------|----------|
| 1 | Admin Dashboard Smoke | HIGH |
| 2 | Admin Access Control | HIGH |
| 3 | Auth Flow Stability | MEDIUM-HIGH |
| 4 | Chat Middleware Chain | HIGH |
| 5 | PII Block Mode | HIGH |
| 6 | PII Warn Mode | MEDIUM |
| 7 | Custom Route Registration | MEDIUM |
| 8 | Package Build Integrity | LOW-MEDIUM |

#### 4. Implementation Approach
- New `post-merge.playwright.config.ts` (separate from PII config)
- Reuse PII auth setup for admin user
- Semantic selectors (getByRole, getByText) — no data-testid attributes in admin components
- Run after every merge from main

### Research Document
`SDD/research/RESEARCH-012-post-merge-e2e-tests.md`

### Decisions Resolved
1. PII block mode: Playwright route interception (mock block response), no server config change needed
2. Dashboard: generate realistic seed data
3. Access control: create second non-admin test user
4. Execution: extend existing `.husky/post-merge` hook

### Phase Transition
Research phase complete. RESEARCH-012-post-merge-e2e-tests.md finalized. Ready for /sdd:spec-start.

---

## Planning: SPEC-012-post-merge-e2e-tests

### Specification Phase Summary
**Date**: 2026-04-01
**Status**: COMPLETE
**Document**: `SDD/requirements/SPEC-012-post-merge-e2e-tests.md`

### Specification Scope

8 test categories mapped to 28 functional requirements (REQ-001 through REQ-028):

| Test | Requirements | Priority | Spec File |
|------|-------------|----------|-----------|
| 1. Admin Dashboard Smoke | REQ-001 to REQ-010 | HIGH | post-merge-dashboard.spec.ts |
| 2. Admin Access Control | REQ-011 to REQ-012 | HIGH | post-merge-dashboard.spec.ts |
| 3. Auth Flow Stability | REQ-013 to REQ-016 | MEDIUM-HIGH | post-merge-auth.spec.ts |
| 4. Chat Middleware Chain | REQ-017 to REQ-018 | HIGH | post-merge-pii.spec.ts |
| 5. PII Block Mode | REQ-019 to REQ-021 | HIGH | post-merge-pii.spec.ts |
| 6. PII Warn Mode | REQ-022 to REQ-024 | MEDIUM | post-merge-pii.spec.ts |
| 7. Custom Route Registration | REQ-025 to REQ-026 | MEDIUM | post-merge-routes.spec.ts |
| 8. Package Build Integrity | REQ-027 to REQ-028 | LOW-MEDIUM | post-merge-routes.spec.ts |

### Key Design Decisions in Spec
1. New `post-merge.playwright.config.ts` (separate from PII config)
2. PII block mode tested via Playwright route interception (no server config change)
3. Non-admin user with `E2E_USER2_EMAIL` / `E2E_USER2_PASSWORD` env vars
4. Separate storage state file for non-admin user (`storageState-nonadmin.json`)
5. Phase 3 added to `.husky/post-merge` hook
6. Seed data generation in setup for dashboard content
7. `ensureLoggedIn` pattern reused from existing PII tests

### Files to Create
- `e2e/post-merge.playwright.config.ts`
- `e2e/setup/post-merge-auth-setup.ts`
- `e2e/specs/post-merge-dashboard.spec.ts`
- `e2e/specs/post-merge-auth.spec.ts`
- `e2e/specs/post-merge-pii.spec.ts`
- `e2e/specs/post-merge-routes.spec.ts`

### Files to Modify
- `.husky/post-merge` — Add Phase 3
- `docs/pii-merge-checklist.md` — Add new test commands
- `.env.example` — Document E2E_USER2_* variables

### Phase Transition
Specification phase complete. SPEC-012-post-merge-e2e-tests.md finalized. Ready for implementation.

---

## Critical Review Resolution: SPEC-012-post-merge-e2e-tests

### Review Resolution Summary
**Date**: 2026-04-01
**Status**: COMPLETE
**Review Document**: `SDD/reviews/CRITICAL-SPEC-post-merge-e2e-tests-20260401.md`
**Updated Spec**: `SDD/requirements/SPEC-012-post-merge-e2e-tests.md`

### Issues Resolved

| Severity | Count | Key Changes |
|----------|-------|-------------|
| CRITICAL | 2 | Fixed detect/warn/block mode terminology throughout; fixed pii_detected vs pii_detection error type mismatch with dual-format documentation |
| HIGH | 4 | Decoupled Phase 3 from redakt dependency; added chat UI selectors; added chatV2 line references; added post-merge hook failure recovery procedure |
| MEDIUM | 6 | Added REQ-029 static analysis for EDGE-006; added rate limiting awareness; clarified dashboard API scope; fixed REQ-011 access denied assertions; added concurrent execution guard; increased auth test timeout |
| LOW | 3 | Added test artifact management; added test suite maintenance section; circuit breaker explicitly out of scope |

### New Requirements Added
- **REQ-029**: Static analysis check for chat routes missing PII middleware
- **Post-Merge Hook Decoupling**: Phase 3 independent of redakt availability
- **Post-Merge Hook Failure Recovery**: Exit code policy and recovery instructions
- **Test Artifact Management**: .gitignore entries and screenshot policy
- **Concurrent Execution Guard**: Document shared storageState constraint
- **Session Expiry Handling**: ensureLoggedIn in beforeEach for all tests
- **Rate Limiting Awareness**: Mitigation for admin API rate limits
- **Dashboard API Endpoint Scope**: Out-of-scope declaration for non-guardrail endpoints
- **Test Suite Maintenance**: Ownership and update triggers

### Codebase Facts Verified
- PII modes: `detect` (default, blocks) and `warn` (allows with warning). No "block" mode. Source: `detectPII.js:235-236`
- Error types: SSE routes use `ErrorTypes.PII_DETECTION` = `'pii_detection'`; JSON routes use literal `'pii_detected'`. Source: `detectPII.js:487`
- chatV2 PII middleware at line 28, sendPiiWarning at line 34. Source: `chatV2.js:28,34`
- ReportingDashboard access denied renders `<h1>Access Denied</h1>`. Source: `ReportingDashboard.tsx:35`
- Chat selectors: `getByTestId('text-input')` for input. Source: `pii-detection.spec.ts`, `messages.spec.ts`
- Post-merge hook skips all e2e if redakt is down (line 52). Source: `.husky/post-merge`

### Phase Transition
Critical review findings fully addressed. Spec updated. Ready for implementation.
