# Research Progress

## Current: RESEARCH-007-usage-and-chat-logging

### Research Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`

### Research Question
Does LibreChat offer any ability to log usage? To log chats?

### Key Findings

#### 1. Token/Usage Tracking — FULL
- Transaction-based system records every token spend per user/conversation/model
- Balance management with auto-refill, CLI tools for admin balance management
- Per-model pricing hardcoded in `packages/data-schemas/src/methods/tx.ts`
- Optimistic concurrency for balance updates (10 retries, exponential backoff)

#### 2. Chat/Conversation Storage — FULL
- All messages and conversations stored in MongoDB with full CRUD
- Strictly user-scoped — admins **cannot** view user chats
- MeiliSearch integration for full-text search (user-filtered)

#### 3. Chat Export — CLIENT-SIDE, 5 FORMATS
- PNG, TXT, Markdown, JSON, CSV
- Export happens in browser, no server-side bulk export
- Supports message branches and recursive tree structures

#### 4. Application Logging — Winston
- Daily rotation, error + debug file logs, JSON console option
- Env vars: `DEBUG_LOGGING`, `DEBUG_CONSOLE`, `CONSOLE_JSON`, `AGENT_DEBUG_LOGGING`

#### 5. External Observability — NOT IMPLEMENTED
- Langfuse env vars exist as placeholders, no integration code

#### 6. No Analytics Dashboard
- All data exists in MongoDB but no reporting UI or usage history API

### Gaps Identified
1. No usage analytics dashboard (trends, costs, top users)
2. No admin access to user conversations
3. No server-side bulk export
4. Langfuse integration not implemented
5. No auto-cleanup of expired temporary chats
6. Token pricing hardcoded (not configurable)
7. No usage history/breakdown for users (only current balance)

### Research Document
`SDD/research/RESEARCH-007-usage-and-chat-logging.md`

---

---

## Current: RESEARCH-008-admin-reporting-dashboard

### Research Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`
**Builds On**: RESEARCH-007

### Research Question
What infrastructure exists in LibreChat to build a built-in admin reporting dashboard for usage trends, user activity, and cost analysis?

### Key Findings

#### 1. Admin Panel is a Separate Paid Product
- LibreChat sells admin panel UI separately; OSS repo provides only backend API routes
- Admin routes exist at `/api/admin/*` for config, roles, groups
- Building dashboard in main client UI would be a custom addition

#### 2. Capability-Based Authorization is Ready
- `READ_USAGE` capability exists (`packages/data-schemas/src/admin/capabilities.ts:32`) but is unused
- `requireCapability()` middleware pattern well-established across admin routes
- `ACCESS_ADMIN` + `READ_USAGE` should gate reporting endpoints

#### 3. Transaction Data Supports Aggregation
- Every token spend recorded with user, model, tokenType, rawAmount, tokenValue, rate, timestamps
- **Missing `createdAt` index** on Transaction schema -- required for time-range queries
- Token credit to USD: `tokenValue / 1,000,000`
- `tokenType: 'credits'` entries are admin grants, not AI usage -- must filter

#### 4. No Charting Library Installed
- `@tanstack/react-table` already present and used for file listings
- No charting lib (recharts, d3, nivo) -- needs to be added (~40KB for recharts)

#### 5. Recommended Architecture: Hybrid (Option C)
- Build API endpoints under `/api/admin/usage/*` first
- Build embedded UI at `/d/reporting` in existing dashboard routes
- API reusable by paid admin panel if adopted later

### Required Database Changes
1. Compound index: `{ createdAt: 1, tenantId: 1 }` on Transaction
2. Compound index: `{ user: 1, createdAt: 1 }` on Transaction
3. Optional: `{ model: 1, createdAt: 1 }` on Transaction

### New API Endpoints Identified
- `GET /api/admin/usage/overview` -- summary cards
- `GET /api/admin/usage/trends` -- time-series data
- `GET /api/admin/usage/models` -- breakdown by model
- `GET /api/admin/usage/users` -- top users by spend

### Gaps Identified
1. No `createdAt` index on Transaction (performance blocker)
2. `READ_USAGE` capability defined but unused
3. No charting library in client
4. No data archival/TTL strategy for transactions
5. Token credits unit needs clear USD conversion in UI

### Research Document
`SDD/research/RESEARCH-008-admin-reporting-dashboard.md`

---

## Previous: RESEARCH-007-usage-and-chat-logging (Superseded by RESEARCH-008 as current)

### Research Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`

### Research Question
Does LibreChat offer any ability to log usage? To log chats?

### Key Findings

#### 1. Token/Usage Tracking -- FULL
- Transaction-based system records every token spend per user/conversation/model
- Balance management with auto-refill, CLI tools for admin balance management
- Per-model pricing hardcoded in `packages/data-schemas/src/methods/tx.ts`
- Optimistic concurrency for balance updates (10 retries, exponential backoff)

#### 2. Chat/Conversation Storage -- FULL
- All messages and conversations stored in MongoDB with full CRUD
- Strictly user-scoped -- admins **cannot** view user chats
- MeiliSearch integration for full-text search (user-filtered)

#### 3. Chat Export -- CLIENT-SIDE, 5 FORMATS
- PNG, TXT, Markdown, JSON, CSV
- Export happens in browser, no server-side bulk export
- Supports message branches and recursive tree structures

#### 4. Application Logging -- Winston
- Daily rotation, error + debug file logs, JSON console option
- Env vars: `DEBUG_LOGGING`, `DEBUG_CONSOLE`, `CONSOLE_JSON`, `AGENT_DEBUG_LOGGING`

#### 5. External Observability -- NOT IMPLEMENTED
- Langfuse env vars exist as placeholders, no integration code

#### 6. No Analytics Dashboard
- All data exists in MongoDB but no reporting UI or usage history API

### Gaps Identified
1. No usage analytics dashboard (trends, costs, top users)
2. No admin access to user conversations
3. No server-side bulk export
4. Langfuse integration not implemented
5. No auto-cleanup of expired temporary chats
6. Token pricing hardcoded (not configurable)
7. No usage history/breakdown for users (only current balance)

### Research Document
`SDD/research/RESEARCH-007-usage-and-chat-logging.md`

---

## Previous Research

### RESEARCH-006 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-006-microsoft-entra-sso-2026-03-30.md`
**Topic**: Microsoft Entra SSO via OpenID Connect

### RESEARCH-005 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-005-m365-mcp-integration-2026-03-26.md`
**Topic**: Microsoft 365 MCP integration

### RESEARCH-004 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-004-cassandra-2026-03-26.md`
**Topic**: Self-hosted Cassandra for Astra Assistants API

### RESEARCH-002 & RESEARCH-003 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-002-003-file-upload-research-2025-12-19.md`
**Topics**: File upload alternatives, Astra Assistants API overview

### RESEARCH-001 (Archived)
**Archive Location**: `SDD/prompts/context-management/archive/progress-001-agent-workflow-api-2025-11-19.md`

---

### Critical Review Findings Addressed
**Date**: 2026-03-30

Critical review (`SDD/reviews/CRITICAL-RESEARCH-admin-reporting-dashboard-20260330.md`) findings resolved:
- **Conversation.user (String) vs Transaction.user (ObjectId) mismatch**: Verified and documented. Pipelines kept separate; cross-collection joins not recommended.
- **endpointTokenConfig cost model**: Fully traced. `tokenValue` already reflects effective rate regardless of pricing path. `costUSD = tokenValue / 1,000,000` correct in all cases.
- **rateDetail not persisted**: Confirmed -- Mongoose strict mode strips it. Workaround documented (re-derive from stored inputTokens/writeTokens/readTokens + model lookup).
- **Cancellation surcharge (1.15x)**: Fully documented. Applies when `context === 'incomplete'` AND `tokenType === 'completion'`. Stored values already inflated.
- **Admin pagination pattern**: Corrected from cursor-based to offset-based (`parsePagination()` at `packages/api/src/admin/pagination.ts`).
- **MANAGE_USAGE capability gap**: Documented; to be added during implementation.
- **Charting library**: Deferred to v2; v1 ships as table-only.
- **Option C justification**: Revised to recommend API + minimal table UI with effort estimates.
- **Data volume**: Flagged as first implementation step (query production DB).
- **Missing stakeholder perspectives**: Added DevOps (readPreference), Finance (internal vs. provider costs), Security (audit logging), and paid admin panel inquiry.

Research phase complete. RESEARCH-008-admin-reporting-dashboard.md finalized and revised. Ready for /planning-start.

---

## Planning Phase: SPEC-008-admin-reporting-dashboard

### Planning Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`
**Builds On**: RESEARCH-008-admin-reporting-dashboard.md

### Specification Document
`SDD/requirements/SPEC-008-admin-reporting-dashboard.md`

### Transition: Research -> Planning
- Research findings from RESEARCH-008 transformed into 16 functional requirements (REQ-001 through REQ-016) and 4 non-functional requirement categories (PERF, SEC, UX).
- 11 edge cases documented (EDGE-001 through EDGE-011), each mapped to specific research findings.
- 7 failure scenarios documented (FAIL-001 through FAIL-007) with trigger conditions, expected behavior, and recovery steps.
- 6 risks identified (RISK-001 through RISK-006) with mitigations.
- Implementation approach: API endpoints first (Phase 2), then minimal table UI (Phase 3), with database index preparation as Phase 1.
- Key decisions codified: v1 ships table-only (no charting library), offset-based pagination, separate Transaction/Conversation pipelines (no cross-collection joins), USD conversion in frontend display layer only.
- Critical review corrections carried forward: sort direction fix for top-users query (research shows ascending, spec corrects to descending).

### Next Step
Ready for implementation phase (critical review of spec, then coding).

## Planning Phase - COMPLETE
- Document: SDD/requirements/SPEC-008-admin-reporting-dashboard.md
- Completion: 2026-03-30
- Implementation ready: YES

---

## Critical Review Resolution: SPEC-008-admin-reporting-dashboard

### Resolution Summary
**Date**: 2026-03-30
**Status**: COMPLETE -- ALL FINDINGS RESOLVED
**Branch**: `pablo`

### Critical Review
`SDD/reviews/CRITICAL-SPEC-admin-reporting-dashboard-20260330.md`

### Findings Resolved (24 total)

#### HIGH severity (1)
- **AMB-001:** Added complete JSON response schemas for all 6 endpoints, plus response envelope and error format definitions

#### MEDIUM severity (10)
- **AMB-002:** Clarified cancellation surcharge -- two metrics: totalIncompleteSpend and estimatedSurchargeAmount with explicit formula
- **AMB-004:** Defined "active user" as user with at least one non-credit transaction in period
- **AMB-005:** Specified tenantId sourced from `req.user.tenantId`
- **MISS-001:** Added date parameter defaults (last 30 days), max range (366 days), validation rules
- **MISS-004:** Added REQ-017 for "Usage Reports" sidebar navigation link
- **MISS-005:** Added REQ-018 for React Query caching (staleTime: 5min, manual refresh)
- **DISC-002/RISK-001:** Elevated production volume check to formal precondition
- **RISK-004:** Upgraded with concrete mitigation (code comments + deployment guide)
- **IMPL-002:** Clarified REQ-010 as five sections with two separate user tables (REQ-004 and REQ-006)

#### LOW severity (13)
- **AMB-003:** Added implementation note about research pipeline sort direction correction
- **MISS-002:** Resolved by AMB-002 fix
- **MISS-003:** Added `search` parameter to REQ-004 and REQ-006
- **MISS-006:** Archived conversations explicitly included in counts
- **MISS-007:** Added error response format specification
- **DISC-001:** End-user usage view added to Deliberate Exclusions
- **DISC-003:** Specified $group+$count instead of distinct() for active users
- **DISC-004:** Feature flag gating added to Deliberate Exclusions
- **DISC-005:** Added RISK-008 for data retention (deferred to v2)
- **IMPL-001:** Fixed "five endpoints" to "six endpoints" throughout
- **IMPL-003:** Specified CSV exports current page only for paginated tables
- **NEW RISK (pagination):** Added RISK-007, acknowledged and accepted
- **NEW RISK (rate limiter):** Updated PERF-003 from 30 to 60 req/min

### New Requirements Added
- REQ-017: Navigation entry point (sidebar link)
- REQ-018: Data freshness and caching behavior
- RISK-007: Offset pagination with concurrent changes
- RISK-008: Data retention / unbounded growth
- Deliberate Exclusions section (5 items)

### Next Step
SPEC-008 is implementation-ready. Proceed to implementation phase.
