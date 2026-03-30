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
