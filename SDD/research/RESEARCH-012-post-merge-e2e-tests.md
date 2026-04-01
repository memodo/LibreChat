# RESEARCH-012-post-merge-e2e-tests

## Overview

Design a Playwright e2e test suite that verifies custom MemodoAI features survive upstream merges from `main`. The `pablo` branch contains customizations (PII detection, admin reporting dashboard) that integrate into core LibreChat code paths. When upstream changes routes, middleware chains, SSE hooks, or routing, these features can silently break.

## System Data Flow

### Authentication Flow for E2E Tests

- **Standard tests**: `e2e/setup/global-setup.ts` → `authenticate.ts` registers/logs in user → saves `storageState.json` with cookies/tokens
- **PII tests**: `e2e/setup/pii-auth-setup.ts` → login only (no registration), assumes user exists
- **Storage state**: `e2e/storageState.json` — contains JWT cookies (`token`, `refreshToken`, `token_provider`)
- **Cleanup**: `e2e/setup/cleanupUser.ts` deletes user + all related data from MongoDB
- **Admin access**: Requires `SystemRoles.ADMIN` role + `ACCESS_ADMIN` + `READ_USAGE` capabilities
- **Environment vars**: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` from `.env`

### Chat Message Flow (Middleware Chain)

Four route entry points with PII middleware:

1. **Agent chat** (`api/server/routes/agents/chat.js:30`):
   - `moderateText` → `createDetectPII({ responseFormat: 'sse' })` → `checkAgentAccess` → ...

2. **Assistant chat v1** (`api/server/routes/assistants/chatV1.js:28,34`):
   - `createDetectPII({ responseFormat: 'sse' })` → `validateModel` → ... → `setHeaders` → `sendPiiWarning` → `chatController`

3. **OpenAI-compatible** (`api/server/routes/agents/openai.js:78`):
   - `createDetectPII({ responseFormat: 'json', isApiRoute: true })` → `checkAgentPermission` → controller

4. **Open Responses** (`api/server/routes/agents/responses.js:101`):
   - `createDetectPII({ responseFormat: 'json', isApiRoute: true })` → `checkAgentPermission` → controller

### PII Warning Delivery

- **SSE routes**: `sendPiiWarning` writes SSE event after `setHeaders`; client handles in `useSSE.ts:108-110` and `useResumableSSE.ts:586-588` via `showToast()`
- **JSON routes**: 400 error response with `{ error: { message, type: 'pii_detection' } }`

### Admin Dashboard Data Flow

- **Route**: `/d/reporting` → lazy-loaded `ReportingDashboard`
- **API endpoints**: All under `GET /api/admin/usage/*` with JWT + admin access + rate limiting (60/min)
- **Endpoints**: `/overview`, `/trends`, `/models`, `/users`, `/users/:userId`, `/activity`, `/guardrail-events`, `/guardrail-summary`, `/conversation/:conversationId`

## Stakeholder Mental Models

- **Product Team**: These tests are a safety net — they should catch regressions before deployment, not after users report broken features
- **Engineering Team**: Tests should be fast, stable, and focused on integration points that upstream is likely to change (routes, middleware, hooks)
- **User perspective**: Expect PII protection and admin dashboard to work reliably after every update
- **DevOps perspective**: Tests should run in existing Docker dev environment with minimal additional setup

## Production Edge Cases

- Upstream adds new middleware to a chat route → displaces PII middleware position
- Upstream refactors SSE hooks → drops `data.warning` handling or `useToastContext` import
- Upstream changes route registration in `client/src/routes/index.tsx` → custom routes silently removed
- Upstream modifies `ErrorTypes` enum in `packages/data-provider/src/config.ts` → `PII_DETECTION` entry lost
- Upstream adds new chat route → no PII middleware coverage (detection gap)
- Upstream changes admin role/capability system → dashboard access breaks

## Files That Matter

### Core Logic (Custom Feature Integration Points)

- `api/server/middleware/detectPII.js` — PII detection factory + sendPiiWarning
- `api/server/middleware/index.js` — middleware registry (must export `createDetectPII`)
- `api/server/routes/agents/chat.js:30` — PII middleware in agent chat
- `api/server/routes/assistants/chatV1.js:28,34` — PII middleware + sendPiiWarning in assistant chat
- `api/server/routes/assistants/chatV2.js` — same as v1
- `api/server/routes/agents/openai.js:78` — PII middleware on API route
- `api/server/routes/agents/responses.js:101` — PII middleware on responses route
- `client/src/hooks/SSE/useSSE.ts:108-110` — data.warning toast handling
- `client/src/hooks/SSE/useResumableSSE.ts:586-588` — data.warning toast handling
- `client/src/routes/Dashboard.tsx:82` — /d/reporting route
- `client/src/routes/index.tsx:104-115` — admin conversation viewer route
- `client/src/components/Admin/Reporting/ReportingDashboard.tsx` — dashboard main component
- `packages/data-provider/src/config.ts` — ErrorTypes.PII_DETECTION enum
- `packages/data-schemas/src/models/index.ts` — GuardrailEvent in createModels()

### Existing Tests

- `e2e/specs/pii-detection.spec.ts` — 3 PII detection tests + 2 admin dashboard tests (uses `pii.playwright.config.ts`)
- `e2e/specs/landing.spec.ts` — landing page + conversation creation
- `e2e/specs/messages.spec.ts` — core messaging flow
- `e2e/specs/nav.spec.ts` — navigation UI
- `e2e/specs/settings.spec.ts` — settings persistence
- `e2e/specs/keys.spec.ts` — API key management
- `e2e/specs/popup.spec.ts` — endpoint presets
- `e2e/specs/a11y.spec.ts` — accessibility

### Configuration

- `e2e/playwright.config.ts` — standard config (global setup/teardown, storageState)
- `e2e/playwright.config.local.ts` — local config (disabled rate limiters)
- `e2e/pii.playwright.config.ts` — PII-specific config (pii-auth-setup, no teardown, single worker)

## Security Considerations

- **Authentication/Authorization**: Admin dashboard tests need an admin-role user; standard tests use regular user
- **Data Privacy**: Test data should not contain real PII; use synthetic test data
- **Input Validation**: PII tests already validate that PII is detected/blocked; new tests verify this survives merges

## Testing Strategy

### Test 1: Admin Reporting Dashboard Smoke Test (HIGH priority)

**Purpose**: Verify all dashboard sections render after merge. Currently only "Guardrail Events" heading is tested in pii-detection.spec.ts.

**What to test**:
- Admin user navigates to `/d/reporting`
- Page title "Usage Reports" visible
- All 6 overview cards render: Registered Users, Active Users, Conversations, Total Spend, Transactions, Cancelled Request Spend
- Usage Trends section renders with granularity buttons (day/week/month)
- Cost by Model table renders with column headers
- Top Users by Spend table renders with search input
- User Activity table renders
- Guardrail Events section renders with filter controls
- Date range picker renders with preset buttons (7 days, 30 days, 90 days, 1 year)
- Refresh button is present
- Back to Chat link navigates to `/c/new`

**Selectors** (semantic, no data-testid):
- `getByRole('heading', { name: /Usage Reports/ })`
- `getByRole('heading', { name: 'Registered Users' })` (and other card labels)
- `getByRole('heading', { name: 'Usage Trends' })`
- `getByRole('heading', { name: 'Cost by Model' })`
- `getByRole('heading', { name: 'Top Users by Spend' })`
- `getByRole('heading', { name: /User Activity/ })`
- `getByRole('heading', { name: 'Guardrail Events' })`
- `getByRole('button', { name: 'Refresh' })`
- `getByRole('link', { name: /Back to Chat/ })`

**Prerequisite**: Test user must have admin role

### Test 2: Admin Access Control (HIGH priority)

**Purpose**: Verify non-admin users cannot access reporting dashboard.

**What to test**:
- Non-admin user navigates to `/d/reporting`
- Access denied message visible: "You do not have permission to view usage reports"
- Admin user can access (positive case covered by Test 1)

**Prerequisite**: Need both admin and non-admin test users

### Test 3: Auth Flow Stability (MEDIUM-HIGH priority)

**Purpose**: Verify login/logout works — if auth breaks, everything breaks.

**What to test**:
- Login with valid credentials → redirects to `/c/new` or `/c/*`
- Login with invalid credentials → shows error message
- Unauthenticated access to `/c/new` → redirects to login page
- After login, user menu is visible in navigation

### Test 4: Chat Middleware Chain Integrity (HIGH priority)

**Purpose**: Verify that sending a message through the primary chat endpoint works end-to-end. If upstream breaks the middleware chain (reordering, removing), this test fails.

**What to test**:
- Send a simple message (non-PII) → receive AI response
- This implicitly validates: auth middleware, PII middleware (passes clean text), agent/model routing, SSE streaming
- Verify response appears in chat (not just no error)

**Note**: This overlaps with existing `messages.spec.ts` but is specifically scoped to verify the middleware chain doesn't break custom middleware positioning.

### Test 5: PII Detection Block Mode (HIGH priority)

**Purpose**: Verify PII detection blocks messages in detect mode. Already partially covered in `pii-detection.spec.ts` but that test is mode-agnostic.

**What to test**:
- Send message with PII (name + email) → message blocked
- Error message contains "personal information" or "was not sent"
- Message does NOT appear in chat history (was actually blocked, not just warned)

### Test 6: PII Detection Warn Mode (MEDIUM priority)

**Purpose**: Verify SSE warning toast appears in warn mode. This catches regressions in `useSSE.ts:108-110` and `useResumableSSE.ts:586-588`.

**What to test**:
- With `PII_DETECTION_MODE=warn`: send PII message
- Toast notification appears with warning
- Message still goes through (AI responds)

**Challenge**: Requires switching `PII_DETECTION_MODE` env var, which may need server restart. May need to be a separate test config or manual verification.

### Test 7: Custom Route Registration (MEDIUM priority)

**Purpose**: Verify custom routes aren't silently removed when upstream refactors routing.

**What to test**:
- Navigate to `/d/reporting` → page loads (not 404/blank)
- Navigate to `/admin/conversation/test-id` → page loads (may show "not found" but doesn't crash/404)
- These routes exist in `client/src/routes/Dashboard.tsx:82` and `client/src/routes/index.tsx:104-115`

### Test 8: Package Build Integrity (LOW-MEDIUM priority)

**Purpose**: Verify custom additions to shared packages survive merges.

**What to test**:
- Send PII in block mode → error response type is `pii_detection` (confirms `ErrorTypes.PII_DETECTION` in data-provider)
- Guardrail events API returns data (confirms `GuardrailEvent` model registered in data-schemas)

**Approach**: Could be verified via API call intercept in Playwright or as a separate API-level test.

## Implementation Considerations

### Config Approach

Two options for the new test suite:

**Option A: Extend pii.playwright.config.ts**
- Pros: Reuses existing PII auth setup (admin user), single config
- Cons: Mixes PII-specific and general merge-protection tests

**Option B: New post-merge.playwright.config.ts** (RECOMMENDED)
- Pros: Clear separation, can run independently of PII feature, different timeout/retry settings
- Cons: Another config file to maintain

### Auth Setup

- Admin tests (dashboard, access control) need admin-role user → reuse PII test user (already admin)
- Auth flow tests need both admin and non-admin users → may need separate setup
- Simplest approach: use existing `pii-auth-setup.ts` pattern for admin user

### Test Data

- Dashboard tests: Need some usage data in DB for sections to render meaningfully. Could use API calls in setup to generate seed data, or just verify sections render (even if empty state).
- PII tests: Need redakt service running. Already documented in pii-merge-checklist.md.

### Run Frequency

- After every merge from `main` (post-merge hook already exists in `.husky/post-merge`)
- Can be added to CI pipeline
- Manual: `npx playwright test e2e/specs/post-merge-*.spec.ts --config e2e/post-merge.playwright.config.ts`

## Documentation Needs

- Update `docs/pii-merge-checklist.md` with new test commands
- Add section to CLAUDE.md for post-merge verification
- Document required environment variables for new tests

## Priority Summary

| # | Test | Priority | Complexity | Catches |
|---|------|----------|------------|---------|
| 1 | Admin Dashboard Smoke | HIGH | Low | Route removal, component breakage, lazy-load issues |
| 2 | Admin Access Control | HIGH | Low | Role/capability system changes |
| 3 | Auth Flow Stability | MEDIUM-HIGH | Medium | Auth strategy changes, cookie/JWT changes |
| 4 | Chat Middleware Chain | HIGH | Medium | Middleware reordering, route refactors |
| 5 | PII Block Mode | HIGH | Low | PII middleware removal, error type changes |
| 6 | PII Warn Mode | MEDIUM | High | SSE hook refactors, toast system changes |
| 7 | Custom Route Registration | MEDIUM | Low | Route config refactors |
| 8 | Package Build Integrity | LOW-MEDIUM | Medium | Shared package enum/model changes |

## Decisions (Resolved 2026-04-01)

1. **PII detection mode**: Production runs `warn` mode. Warn-mode tests run against live server as-is. Block-mode test uses **Playwright route interception** to mock a PII block response — tests frontend error handling without changing server config. Backend block mode already covered by 62 unit + 24 integration tests.

2. **Dashboard seed data**: Generate realistic seed data for dashboard tests so sections render with actual content, not just empty states.

3. **Non-admin access control**: Create a second non-admin test user to verify access denied behavior.

4. **Execution**: Add to existing `.husky/post-merge` hook since all tests protect custom features that upstream merges could break.
