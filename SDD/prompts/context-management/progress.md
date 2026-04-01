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
