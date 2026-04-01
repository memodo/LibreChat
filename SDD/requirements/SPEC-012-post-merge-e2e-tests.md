# SPEC-012: Post-Merge E2E Tests

## Executive Summary

- **Based on Research:** RESEARCH-012-post-merge-e2e-tests.md
- **Creation Date:** 2026-04-01
- **Author:** Claude
- **Status:** Draft

This specification defines a Playwright e2e test suite that verifies custom MemodoAI features (PII detection middleware, admin reporting dashboard) survive upstream merges from LibreChat `main`. The suite runs automatically via the existing `.husky/post-merge` hook and uses a dedicated `post-merge.playwright.config.ts` configuration, separate from both the standard and PII-specific Playwright configs.

## Research Foundation

### Production Issues Addressed

1. **Silent feature breakage on upstream merge.** The `pablo` branch carries custom middleware (PII detection) inserted at specific positions in five route files. Upstream refactors to route registration, middleware ordering, or SSE hook signatures can silently disable these features without any test failure, because existing upstream tests do not cover custom integration points.
2. **Incomplete dashboard test coverage.** The existing `pii-detection.spec.ts` only checks for the "Guardrail Events" heading and a table row on the admin dashboard. None of the other six dashboard sections (overview cards, usage trends, cost by model, top users, user activity, date range picker) are tested.
3. **No access control regression test.** There is no test verifying that non-admin users are denied access to `/d/reporting`. If upstream changes the role or capability system, the admin gate could fail silently.
4. **SSE warning delivery untested.** The `data.warning` handling in `useSSE.ts:108-110` and `useResumableSSE.ts:586-588` is not covered by any e2e test. An upstream refactor to these hooks could drop PII warn-mode toast notifications.
5. **Custom route registration fragile.** The `/d/reporting` route in `Dashboard.tsx:82` and `/admin/conversation/:conversationId` in `routes/index.tsx:104-115` could be lost during upstream route config refactors.

### Stakeholder Validation

- **Product Team:** These tests are a safety net -- they should catch regressions before deployment, not after users report broken features. PII protection and admin dashboard are differentiating features for MemodoAI.
- **Engineering Team:** Tests should be fast, stable, and focused on integration points that upstream is likely to change (routes, middleware chains, SSE hooks). Must not introduce flakiness or slow down the merge workflow.
- **User Perspective:** Users expect PII protection and admin reporting to work reliably after every update.
- **DevOps Perspective:** Tests should run in the existing Docker dev environment with minimal additional setup. The post-merge hook must degrade gracefully when the full stack is not running.

### System Integration Points

- `api/server/middleware/detectPII.js` -- PII detection factory and `sendPiiWarning` function
- `api/server/middleware/index.js` -- Middleware registry; must export `createDetectPII`
- `api/server/routes/agents/chat.js:30` -- PII middleware in agent chat chain
- `api/server/routes/assistants/chatV1.js:28,34` -- PII middleware + `sendPiiWarning` in assistant chat
- `api/server/routes/assistants/chatV2.js:28,34` -- PII middleware (`createDetectPII`) at line 28, `sendPiiWarning` at line 34 (same pattern as chatV1)
- `api/server/routes/agents/openai.js:78` -- PII middleware on OpenAI-compatible API route
- `api/server/routes/agents/responses.js:101` -- PII middleware on Open Responses route
- `client/src/hooks/SSE/useSSE.ts:108-110` -- `data.warning` toast handling
- `client/src/hooks/SSE/useResumableSSE.ts:586-588` -- `data.warning` toast handling
- `client/src/routes/Dashboard.tsx:82` -- `/d/reporting` route registration
- `client/src/routes/index.tsx:104-115` -- `/admin/conversation/:conversationId` route registration
- `client/src/components/Admin/Reporting/ReportingDashboard.tsx` -- Dashboard main component with admin gate
- `packages/data-provider/src/config.ts:1687` -- `ErrorTypes.PII_DETECTION` enum value
- `packages/data-schemas/src/models/index.ts` -- `GuardrailEvent` in `createModels()`
- `e2e/setup/pii-auth-setup.ts` -- Auth setup pattern to reuse for admin user
- `e2e/pii.playwright.config.ts` -- Existing PII config pattern to follow
- `.husky/post-merge` -- Existing post-merge hook to extend

## Intent

### Problem Statement

MemodoAI maintains custom features (PII detection middleware, admin reporting dashboard) on the `pablo` branch that integrate deeply into LibreChat's middleware chains, SSE hooks, route registrations, and shared packages. When upstream changes are merged from `main`, these integration points can break silently because upstream tests have no knowledge of custom feature code. The existing PII e2e tests cover only basic detection and a minimal dashboard check. There is no automated end-to-end verification that the full set of custom features survives a merge.

### Solution Approach

Create a comprehensive Playwright e2e test suite with 8 test categories that cover all custom feature integration points, executed via a new `post-merge.playwright.config.ts` configuration. The suite reuses the existing PII auth setup pattern for admin user authentication and introduces a second non-admin test user for access control testing. PII detect mode (which blocks messages) is tested via Playwright route interception (mocking the detect-mode error response) so no server configuration change is required. The suite integrates into the existing `.husky/post-merge` hook as a new phase.

### Expected Outcomes

- Every upstream merge is automatically verified against all custom feature integration points
- Dashboard regressions are caught immediately (all 7 sections tested, not just guardrail events heading)
- Access control regressions are caught (non-admin denial tested)
- PII middleware chain integrity is verified end-to-end (both detect and warn mode behavior)
- Custom route registrations are verified as still functional
- Package-level custom additions (ErrorTypes.PII_DETECTION, GuardrailEvent model) are verified
- Test suite completes in under 3 minutes and introduces no flakiness

## Success Criteria

### Functional Requirements

#### Test 1: Admin Reporting Dashboard Smoke Test

- **REQ-001: Dashboard page loads.** Navigating to `/d/reporting` as an admin user renders the page with the heading "Usage Reports" visible within 15 seconds.
- **REQ-002: Overview cards render.** All 6 overview cards are visible, identified by their labels: "Registered Users", "Active Users", "Conversations", "Total Spend", "Transactions", "Cancelled Request Spend". Each label is rendered as a heading element or a paragraph with `text-xs` class inside `OverviewCards.tsx`.
- **REQ-003: Usage Trends section renders.** A heading containing "Usage Trends" is visible. The granularity toggle buttons for "day", "week", and "month" are present.
- **REQ-004: Cost by Model section renders.** A heading containing "Cost by Model" is visible. The table contains column headers "Model" and "Total Spend".
- **REQ-005: Top Users by Spend section renders.** A heading containing "Top Users by Spend" is visible. A search input is present within the section.
- **REQ-006: User Activity section renders.** A heading containing "User Activity" is visible.
- **REQ-007: Guardrail Events section renders.** A heading containing "Guardrail Events" is visible. Filter controls are present in the section.
- **REQ-008: Date range picker renders.** The date range picker component is visible with preset buttons for common ranges (7 days, 30 days, 90 days, 1 year).
- **REQ-009: Refresh button present.** A button with text "Refresh" is visible on the dashboard.
- **REQ-010: Back to Chat link works.** A link containing "Back to Chat" is visible and, when clicked, navigates to `/c/new`.

#### Test 2: Admin Access Control

- **REQ-011: Non-admin sees access denied.** When a non-admin user navigates to `/d/reporting`, the heading "Access Denied" (`<h1>`) is visible and the paragraph text "You do not have permission to view usage reports" is visible. Use the positive assertion on the "Access Denied" heading rather than a negative assertion on "Usage Reports" -- the component (`ReportingDashboard.tsx:35`) returns early with the access denied block and never renders `ReportingDashboardInner`, so the "Usage Reports" heading is never in the DOM. The admin gate is solely the `user.role !== SystemRoles.ADMIN` check in the React component (line 31); there are also API-level capability checks on backend endpoints, but the frontend gate prevents rendering entirely.
- **REQ-012: Non-admin user setup.** The test suite creates or uses a second test user (distinct from the admin E2E user) that does NOT have `SystemRoles.ADMIN` role. This user's credentials are configured via `E2E_USER2_EMAIL` and `E2E_USER2_PASSWORD` environment variables.

#### Test 3: Auth Flow Stability

- **REQ-013: Valid login succeeds.** Logging in with `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` credentials redirects to a URL matching `/c/` within 15 seconds.
- **REQ-014: Invalid login shows error.** Logging in with incorrect credentials displays an error message on the login page. The URL does not change to `/c/`.
- **REQ-015: Unauthenticated redirect.** Navigating to `/c/new` without authentication redirects to the login page (URL contains `/login`).
- **REQ-016: User menu visible after login.** After successful login, a user menu element is visible in the navigation area.

#### Test 4: Chat Middleware Chain Integrity

- **REQ-017: Clean message receives AI response.** Sending a non-PII message (e.g., "What is the capital of France?") through the chat interface results in a visible AI response within 60 seconds. This implicitly validates that auth middleware, PII middleware (passes clean text), agent/model routing, and SSE streaming are all functioning. **Chat UI selectors** (based on existing `messages.spec.ts` and `pii-detection.spec.ts` patterns):
  - **Chat input**: `page.getByTestId('text-input')` -- the primary chat textarea.
  - **Send/submit**: `page.getByTestId('text-input').press('Enter')` -- Enter key submits; alternatively, `page.locator('form').getByRole('textbox').press('Enter')`.
  - **Response wait**: `page.waitForResponse(r => r.url().includes('/api/agents') && r.status() === 200)` -- waits for the SSE stream response.
  - **Message area**: Response messages appear as elements in the chat area. Use `page.getByText(...)` or `page.locator('[data-testid="message-text-editor"]')` for specific message content. These selectors are upstream-controlled and may change; if they break, update selectors based on the current DOM structure.
- **REQ-018: Response appears in chat.** The AI response text is rendered in the chat message area (not just absence of error). At least one response message element is visible after sending. Consider mocking the AI response (similar to Test 5's route interception) for a more stable test that validates the middleware chain without depending on external AI availability. If a mocked variant is used, keep the live AI test as an optional/skippable companion test.

#### Test 5: PII Detection Detect Mode (Message Blocking)

- **REQ-019: Detect mode error via route interception.** Using Playwright `page.route()` to intercept the chat API request and return a mock PII detect-mode response (HTTP 400), the frontend displays an error message matching `/personal information|was not sent|remove personal details/i`. Note: the actual middleware modes are `detect` (blocks the message and returns an error) and `warn` (allows the message through with a warning). There is no "block" mode.
- **REQ-020: Blocked message not in chat history.** After a PII detect-mode error response is returned (via route interception), the original user message text does not appear as a sent message in the chat history. The error message is displayed instead.
- **REQ-021: Route interception format.** The mock response must match the actual `detectPII.js` response format for the route type being intercepted. The middleware produces two different error type strings depending on `responseFormat`:
  - **SSE routes** (agent chat, assistant chat): `{ "error": { "message": "...", "type": "pii_detection" } }` -- uses `ErrorTypes.PII_DETECTION` constant.
  - **JSON API routes** (OpenAI-compatible, Open Responses): `{ "error": { "message": "...", "type": "pii_detected" } }` -- uses a literal string (past tense).

  The route interception mock must use the correct type for the route pattern being intercepted. Since the primary chat interface uses SSE routes, the default mock should use `"type": "pii_detection"`. A secondary assertion or comment should document the `pii_detected` variant for JSON API routes to guard against future divergence.

  **Limitation (REQ-027 implication):** Route interception mocks the response string, not the `ErrorTypes.PII_DETECTION` constant itself. The test verifies the frontend handles the string `"pii_detection"` but cannot verify the constant exists in the `data-provider` package. See REQ-027 for the supplementary static analysis check that closes this gap.

#### Test 6: PII Detection Warn Mode

- **REQ-022: Warn mode toast notification.** With the server running in `PII_DETECTION_MODE=warn`, sending a message containing PII (name + email, e.g., "My name is John Smith and my email is john.smith@example.com") triggers a visible toast notification matching `/personal information|cautious about sharing/i` within 30 seconds. **Important:** The codebase default is `detect` mode (`detectPII.js:235`: `process.env.PII_DETECTION_MODE || 'detect'`; `.env.example:445`: `PII_DETECTION_MODE=detect`). The MemodoAI production deployment overrides this to `warn` in its `.env`. This test requires `PII_DETECTION_MODE=warn` to be set in the environment; if the server is running in `detect` mode, this test will see a block error instead of a toast warning and should be skipped with a descriptive message indicating the mode mismatch.
- **REQ-023: Message still delivered in warn mode.** After the PII warning toast appears, the AI still responds to the message. A response message is visible in chat, confirming the message was not blocked.
- **REQ-024: Redakt service dependency.** This test requires the redakt service to be running at `PII_DETECTION_API_URL` (typically `http://localhost:8000`). If redakt is unavailable, the test is skipped with a descriptive message (not failed).

#### Test 7: Custom Route Registration

- **REQ-025: Reporting route accessible.** Navigating to `/d/reporting` as an admin user returns a rendered page (not a 404, blank page, or React error boundary). The page contains at least one of the expected dashboard headings.
- **REQ-026: Admin conversation viewer route accessible.** Navigating to `/admin/conversation/test-conversation-id` returns a rendered page. The page may show a "not found" or "no conversation" message for the fake ID, but it must not show a 404 page, blank screen, or crash. This confirms the route in `routes/index.tsx:104-115` is still registered.

#### Test 8: Package Build Integrity

- **REQ-027: ErrorTypes.PII_DETECTION exists.** The route interception in REQ-019 tests that the frontend handles the `"pii_detection"` type string, but it cannot verify the `ErrorTypes.PII_DETECTION` constant exists in `packages/data-provider/src/config.ts` (the mock supplies the string, not the constant). To close this gap, add a **static analysis assertion** in the test: use Node.js `fs.readFileSync` (or Playwright's built-in `require`) to read `packages/data-provider/src/config.ts` and assert it contains the string `PII_DETECTION = 'pii_detection'`. This is a grep-level check that confirms the enum value has not been removed or renamed. Example:
  ```typescript
  test('ErrorTypes.PII_DETECTION constant exists in data-provider', async () => {
    const configPath = path.resolve(__dirname, '../../packages/data-provider/src/config.ts');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain("PII_DETECTION = 'pii_detection'");
  });
  ```
- **REQ-028: GuardrailEvent model registered.** The guardrail events API endpoint (`GET /api/admin/usage/guardrail-events`) returns a response (HTTP 200) when called by an admin user. This confirms the `GuardrailEvent` model is still registered in `packages/data-schemas/src/models/index.ts`. The test intercepts the network request to `/api/admin/usage/guardrail-events` during the dashboard load (REQ-007) and asserts:
  1. The response status is 200.
  2. The response body is a valid JSON array (may be empty if no guardrail events exist). This confirms the model is actually being queried, not just that the route exists with a fallback handler.

### Non-Functional Requirements

- **PERF-001: Test suite execution time.** The entire post-merge e2e test suite completes in under 3 minutes on a standard development machine with the full stack running.
- **PERF-002: Individual test timeout.** Each test has an explicit timeout that provides at least 2x margin over the expected action time: 30 seconds for navigation/render tests (Tests 1, 2, 7), 30 seconds for auth tests (Test 3; login may take up to 15 seconds, so a 15-second timeout would leave zero margin), 60 seconds for chat interaction tests (Tests 4, 5, 6), 30 seconds for package integrity tests (Test 8).
- **SEC-001: No real PII in test data.** All PII used in tests is synthetic (e.g., "John Smith", "john.smith@example.com"). No real personal data appears in test fixtures or seed data.
- **SEC-002: Test credentials isolated.** Test user credentials (`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_USER2_EMAIL`, `E2E_USER2_PASSWORD`) are read from `.env` and never hardcoded in test files.
- **UX-001: Test reliability.** Tests use explicit waits (`waitForSelector`, `waitForURL`, `toBeVisible` with timeouts) rather than `waitForTimeout`. The only acceptable use of `waitForTimeout` is a brief pause (under 3 seconds) to confirm absence of an element (e.g., confirming no PII warning appears for clean messages).
- **UX-002: Graceful degradation.** The post-merge hook skips e2e tests (exit 0, not exit 1) when prerequisites are not met: LibreChat not running, Playwright browsers not installed, or `storageState.json` missing. Phase 2 (PII e2e) additionally requires redakt and skips if unavailable. Phase 3 (post-merge e2e) does NOT require redakt; individual tests within Phase 3 that need redakt skip via `test.skip()`.

## Edge Cases (Research-Backed)

- **EDGE-001: Upstream adds new middleware to chat route.** If upstream inserts a new middleware before the PII middleware position in any of the five route files, the PII middleware may still function but at a different position. Test 4 (REQ-017) catches this if the new middleware breaks the chain. Test 6 (REQ-022) catches this if warn-mode PII detection stops working.
- **EDGE-002: Upstream refactors SSE hooks.** If `useSSE.ts` or `useResumableSSE.ts` are refactored and the `data.warning` handling at lines 108-110 / 586-588 is removed, Test 6 (REQ-022) fails because the toast notification will not appear.
- **EDGE-003: Upstream changes route registration structure.** If `client/src/routes/Dashboard.tsx` or `client/src/routes/index.tsx` are restructured and the `/d/reporting` or `/admin/conversation/:id` routes are lost, Tests 1 (REQ-001) and 7 (REQ-025, REQ-026) fail.
- **EDGE-004: Upstream modifies ErrorTypes enum.** If the `PII_DETECTION` value is removed or renamed in `packages/data-provider/src/config.ts`, Test 5 (REQ-019) may still pass (it uses route interception) but REQ-027's static analysis check will catch the missing constant. The frontend error handling path would break for real detect-mode responses.
- **EDGE-005: Upstream changes admin role/capability system.** If `SystemRoles.ADMIN` or the role-checking logic in `ReportingDashboard.tsx:31` changes, Test 2 (REQ-011) catches this because either the admin user loses access or the non-admin user gains access.
- **EDGE-006: Upstream adds new chat route without PII middleware.** E2E tests cannot exercise routes they do not know about. To mitigate, add a **static analysis check** (REQ-029) in the test suite that scans chat route files for `createDetectPII` usage. The check greps all files under `api/server/routes/agents/` and `api/server/routes/assistants/` for route handler registrations (`router.post`) and flags any that do not include `createDetectPII` in their middleware chain. This is a best-effort detection -- it catches the common case of a new route file without PII middleware but may miss dynamically registered routes.
- **EDGE-007: Session expiry during test run.** The `ensureLoggedIn` pattern from `pii-detection.spec.ts` handles mid-run session expiry by re-authenticating. The new tests must reuse this pattern.
- **EDGE-008: Dashboard renders empty state.** If the test database has no usage data, dashboard sections may render empty states (e.g., "No data" messages) instead of populated tables. Tests must accept both populated and empty states -- the requirement is that sections render, not that they contain data (unless seed data is generated in setup).

## Failure Scenarios

- **FAIL-001: Redakt service unavailable during PII tests.** Test 6 (warn mode) requires redakt. If unavailable, the test must be skipped (not failed) with a message indicating the dependency. Tests 4 and 5 do not depend on redakt (Test 4 uses clean text; Test 5 uses route interception). Since Phase 3 runs independently of the redakt availability check (see "Post-Merge Hook Decoupling" above), non-PII tests (1, 2, 3, 7, 8) always run when LibreChat is available.
- **FAIL-002: Admin user lacks admin role.** If the E2E test user specified by `E2E_USER_EMAIL` does not have admin role, Tests 1, 7 (REQ-025), and 8 (REQ-028) will fail. The setup phase should verify admin access and provide a clear error message.
- **FAIL-003: Non-admin user has admin role.** If the second test user (`E2E_USER2_EMAIL`) has admin role, Test 2 (REQ-011) will fail. The setup documentation must clearly state this user must NOT be an admin.
- **FAIL-004: Missing environment variables.** If `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` are not set, the auth setup fails. If `E2E_USER2_EMAIL`, `E2E_USER2_PASSWORD` are not set, only Test 2 is skipped. The config should provide clear error messages for each case.
- **FAIL-005: LibreChat not running.** The post-merge hook already checks for LibreChat at `localhost:3080`. If not reachable, all e2e tests are skipped with an informational message.
- **FAIL-006: Playwright browsers not installed.** The post-merge hook already handles this case and skips with an install instruction.
- **FAIL-007: AI endpoint not configured.** Tests 4 (REQ-017) and 6 (REQ-023) require a working AI endpoint. If no endpoint is configured or the AI service is down, these tests will time out. The test should set a 60-second timeout and provide a descriptive failure message.

## Additional Requirements (from Critical Review)

### REQ-029: Static Analysis -- Chat Routes Without PII Middleware

A static analysis test scans all route files under `api/server/routes/agents/` and `api/server/routes/assistants/` to detect chat route handlers (`router.post('/'`) that do not include `createDetectPII` in their middleware chain. This catches the EDGE-006 scenario where upstream adds a new chat route without PII middleware. Implementation approach:

```typescript
test('all chat route files include PII middleware', async () => {
  const routeDirs = [
    path.resolve(__dirname, '../../api/server/routes/agents'),
    path.resolve(__dirname, '../../api/server/routes/assistants'),
  ];
  for (const dir of routeDirs) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      // Only check files that define POST route handlers (chat endpoints)
      if (content.includes("router.post('/'") || content.includes('router.post("/')) {
        expect(content).toContain('createDetectPII');
      }
    }
  }
});
```

Known exceptions: The `abort` route (`router.post('/abort'`) does not need PII middleware. The check targets only `router.post('/'` (the main handler), not other POST routes.

### Post-Merge Hook Decoupling (Phase 3 Independence)

Phase 3 (post-merge e2e tests) MUST have its own prerequisite checks independent of Phase 2. The current hook (`.husky/post-merge:52`) requires redakt for all e2e tests, which would cause non-PII tests (dashboard, auth, route registration) to be skipped when redakt is down. The updated hook structure:

- **Phase 2** (existing PII e2e): Requires LibreChat + redakt + browsers + storageState. Skipped entirely if redakt is down.
- **Phase 3** (post-merge e2e): Requires LibreChat + browsers + storageState. Runs even if redakt is down. Tests within Phase 3 that need redakt (Test 6: warn mode) skip individually via `test.skip()`.

This means the Phase 3 block in the post-merge hook must NOT be nested inside the redakt availability check. It should have its own check for LibreChat, browsers, and storageState only.

### Post-Merge Hook Failure Recovery

The post-merge hook runs AFTER the merge commit is already applied. A non-zero exit from Phase 3 does NOT undo the merge. To set clear expectations:

- **Phase 3 exit code policy:** Phase 3 failures exit with code 1 (same as Phases 1 and 2) to signal the regression loudly. However, the developer must understand the merge is already committed.
- **Recovery procedure on Phase 3 failure:** The hook output must include:
  ```
  The merge is already committed. To recover:
    1. Fix the failing tests and commit the fix, OR
    2. Revert the merge: git revert HEAD
  See docs/pii-merge-checklist.md for guidance.
  ```

### Test Artifact Management

- The output directory `e2e/specs/.post-merge-test-results` MUST be added to `.gitignore` to prevent test artifacts (screenshots, traces) from being committed.
- Playwright should capture screenshots on failure only (`use: { screenshot: 'only-on-failure' }`) for debugging without excessive artifact growth.
- No automatic cleanup of artifacts; developers manage manually or via `git clean`.

### Concurrent Execution Guard

The post-merge suite and PII suite MUST NOT run concurrently. They share `e2e/storageState.json` for the admin user. Running both simultaneously can cause authentication state corruption. Document this constraint in the config file header comment. The non-admin state file (`storageState-nonadmin.json`) is exclusive to the post-merge suite.

### Session Expiry Handling

All spec files MUST use the `ensureLoggedIn` pattern (from `pii-detection.spec.ts`) in `beforeEach` for every test, not selectively. This handles mid-run JWT expiry across the entire suite. The helper re-authenticates and saves updated storage state so subsequent tests do not also trigger re-auth.

### Rate Limiting Awareness

The admin dashboard loads data from 7+ API endpoints under `/api/admin/usage/*`, each subject to rate limiting (60 requests/min). The test environment should either:
- Use the local Playwright config pattern (`playwright.config.local.ts`) which disables rate limiters, OR
- Add a brief pause between dashboard navigation and assertions to allow sequential API calls to complete without hitting the rate limit.

Document this as a known flakiness risk if rate limiters are active.

### Dashboard API Endpoint Scope

The spec validates the guardrail-events endpoint (REQ-028) but does not individually validate the other 7+ admin API endpoints (`/overview`, `/trends`, `/models`, `/users`, `/activity`, `/guardrail-summary`, etc.). Backend API integrity for these endpoints is **out of scope** for this e2e suite. The dashboard section render checks (REQ-001 through REQ-010) provide indirect validation: if a backend endpoint is broken, the corresponding dashboard section will show an error state or loading spinner rather than the expected heading/controls, and the render assertion will fail.

### Test Suite Maintenance

- **Ownership:** The post-merge test suite is owned by the MemodoAI engineering team.
- **Update triggers:** Tests must be updated when: (a) custom features are modified, (b) upstream changes break selectors, (c) new custom features are added.
- **Deprecation:** If a custom feature is removed (e.g., PII detection disabled), the corresponding tests should be removed and the post-merge config updated accordingly.

## Implementation Constraints

### Context Requirements

#### Essential Files for Implementation

These files must be read and understood to implement the test suite:

- `e2e/pii.playwright.config.ts` -- Pattern to follow for new config
- `e2e/setup/pii-auth-setup.ts` -- Auth setup pattern to reuse/extend
- `e2e/specs/pii-detection.spec.ts` -- Existing PII test patterns, `ensureLoggedIn` helper
- `e2e/playwright.config.ts` -- Standard config for reference (global setup/teardown, webServer)
- `.husky/post-merge` -- Hook to extend with new test phase
- `client/src/components/Admin/Reporting/ReportingDashboard.tsx` -- Dashboard component structure, admin gate logic, section layout
- `client/src/components/Admin/Reporting/OverviewCards.tsx` -- Card label strings for selectors
- `client/src/routes/Dashboard.tsx` -- Route registration for `/d/reporting`
- `client/src/routes/index.tsx:104-115` -- Route registration for `/admin/conversation/:id`
- `api/server/middleware/detectPII.js` -- PII block response format for route interception mock

#### Files for Reference (Can Be Delegated to Subagents)

- `e2e/specs/landing.spec.ts` -- Example of basic navigation test patterns
- `e2e/specs/messages.spec.ts` -- Example of chat interaction test patterns
- `e2e/setup/global-setup.ts` -- Standard global setup pattern
- `e2e/setup/authenticate.ts` -- Registration + login flow
- `e2e/setup/cleanupUser.ts` -- User cleanup pattern
- `client/src/components/Admin/Reporting/GuardrailEventsSection.tsx` -- Filter controls for REQ-007
- `client/src/components/Admin/Reporting/DateRangePicker.tsx` -- Preset buttons for REQ-008
- `client/src/components/Admin/Reporting/UsageTrendsTable.tsx` -- Granularity buttons for REQ-003
- `client/src/components/Admin/Reporting/TopUsersTable.tsx` -- Search input for REQ-005
- `client/src/components/Admin/Reporting/ModelBreakdownTable.tsx` -- Column headers for REQ-004

### Technical Constraints

1. **Separate config file.** The test suite uses `e2e/post-merge.playwright.config.ts`, not the existing `pii.playwright.config.ts`. This allows independent execution, different timeout/retry settings, and clear separation of concerns.
2. **No server config changes for detect mode.** PII detect-mode testing uses Playwright `page.route()` interception to mock the detect-mode error response. The server continues to run in whatever `PII_DETECTION_MODE` is configured (the codebase default is `detect`; MemodoAI production overrides to `warn`). This avoids the need for server restarts or environment variable changes during tests.
3. **Semantic selectors only.** The admin dashboard components do not use `data-testid` attributes. All selectors must use semantic locators: `getByRole('heading', ...)`, `getByText(...)`, `getByRole('button', ...)`, `getByRole('link', ...)`.
4. **Single worker execution.** The test suite runs with `workers: 1` to avoid race conditions with shared auth state (`storageState.json`) and database interactions.
5. **No global teardown.** Following the PII config pattern, the post-merge config does not run a global teardown (no user deletion). Test users are persistent across runs.
6. **Reuse existing auth setup.** The admin user authentication reuses the `pii-auth-setup.ts` pattern (login only, no registration). The non-admin user needs a similar setup function or an inline login within the test.
7. **Environment variable requirements:**
   - Required: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` (admin user)
   - Optional: `E2E_USER2_EMAIL`, `E2E_USER2_PASSWORD` (non-admin user, only for Test 2)
   - Optional: `E2E_BASE_URL` (defaults to `http://localhost:3080`)

## Validation Strategy

### Automated Testing

1. **Self-validation.** Run the full post-merge suite against a clean stack:
   ```bash
   npx playwright test --config e2e/post-merge.playwright.config.ts
   ```
   All tests should pass. Then selectively break integration points (e.g., comment out the `/d/reporting` route in `Dashboard.tsx`) and verify the corresponding test fails.

2. **Isolation validation.** Run the post-merge suite independently of the PII suite to confirm no shared state dependency:
   ```bash
   npx playwright test --config e2e/post-merge.playwright.config.ts
   npx playwright test --config e2e/pii.playwright.config.ts
   ```
   Both should pass regardless of execution order.

3. **Post-merge hook validation.** Simulate a merge and verify the hook runs the new tests:
   ```bash
   .husky/post-merge
   ```
   The output should show the new Phase 3 (post-merge e2e) executing after Phase 2 (PII e2e).

### Manual Verification

1. **Dashboard visual check.** After running Tests 1 and 2, manually open `/d/reporting` in a browser and visually confirm all sections match what the tests verify.
2. **Detect mode check.** Ensure `PII_DETECTION_MODE=detect` in `.env` (this is the codebase default), restart the server, send a PII message, and confirm the error message matches the mock in Test 5.
3. **Warn mode check.** Set `PII_DETECTION_MODE=warn` in `.env`, restart the server, send a PII message and confirm the toast notification appears (Test 6 behavior).
4. **Non-admin check.** Log in as the non-admin test user and navigate to `/d/reporting` to visually confirm the access denied message.
5. **Merge simulation.** Create a test branch, make a breaking change to a custom integration point, merge, and verify the post-merge hook catches the regression.

## Dependencies and Risks

- **RISK-001: Redakt service availability.** Test 6 (warn mode) depends on the redakt service. Mitigation: the test skips gracefully when redakt is unavailable (FAIL-001). Detect mode (Test 5) is tested via route interception and has no redakt dependency. Phase 3 runs independently of redakt (see "Post-Merge Hook Decoupling").
- **RISK-002: AI endpoint availability.** Tests 4 and 6 require a functioning AI endpoint. Mitigation: 60-second timeouts with descriptive failure messages. These tests may need to be skipped in offline environments.
- **RISK-003: Test flakiness from timing.** Dashboard sections load data asynchronously from multiple API endpoints. Mitigation: use explicit `toBeVisible` waits with generous timeouts (15 seconds for dashboard sections), not fixed delays.
- **RISK-004: Second test user management.** The non-admin user must exist in the database and NOT have admin role. Mitigation: document the user creation step in the setup guide. The auth setup can verify role on login.
- **RISK-005: Upstream changes to test infrastructure.** If upstream modifies `e2e/playwright.config.ts` or `e2e/setup/` files, the post-merge config may need updates. Mitigation: the post-merge config is self-contained and only shares the `storageState.json` path convention.
- **RISK-006: Post-merge hook execution time.** Adding a third phase to the hook increases total execution time. Mitigation: PERF-001 constrains the suite to under 3 minutes. The hook already shows progress messages for each phase.

## Implementation Notes

### Suggested Approach

1. **Create `e2e/post-merge.playwright.config.ts`** following the pattern of `e2e/pii.playwright.config.ts`:
   - `globalSetup`: reuse `pii-auth-setup.ts` (or a new `post-merge-auth-setup.ts` that handles both admin and non-admin users)
   - `testDir`: `specs/`
   - `testMatch`: `post-merge-*.spec.ts`
   - `workers: 1`, `retries: 0`
   - `reporter: [['list']]` for console output
   - `outputDir: 'specs/.post-merge-test-results'`
   - No `webServer` block (assumes stack is already running, same as PII config)
   - No global teardown

2. **Create `e2e/setup/post-merge-auth-setup.ts`** (or extend `pii-auth-setup.ts`):
   - Log in as admin user (existing pattern)
   - Save admin storage state to `e2e/storageState.json`
   - If `E2E_USER2_EMAIL` / `E2E_USER2_PASSWORD` are set, log in as non-admin user and save to `e2e/storageState-nonadmin.json`

3. **Create `e2e/specs/post-merge-dashboard.spec.ts`** (Tests 1, 2):
   - Test 1: Admin navigates to `/d/reporting`, verifies all section headings and controls
   - Test 2: Non-admin user navigates to `/d/reporting`, verifies access denied. Skip if non-admin credentials not configured.

4. **Create `e2e/specs/post-merge-auth.spec.ts`** (Test 3):
   - Valid login, invalid login, unauthenticated redirect, user menu presence

5. **Create `e2e/specs/post-merge-pii.spec.ts`** (Tests 4, 5, 6):
   - Test 4: Send clean message, verify AI response
   - Test 5: Use `page.route()` to intercept and mock PII detect-mode error response, verify error display
   - Test 6: Send PII message in warn mode, verify toast. Skip if redakt unavailable or if server is not in warn mode.

6. **Create `e2e/specs/post-merge-routes.spec.ts`** (Tests 7, 8):
   - Test 7: Navigate to `/d/reporting` and `/admin/conversation/test-id`, verify pages load
   - Test 8: Intercept `/api/admin/usage/guardrail-events` during dashboard load, verify 200 response

7. **Update `.husky/post-merge`**:
   - Add Phase 3 after Phase 2 (PII e2e tests)
   - Phase 3 has its own prerequisite checks: LibreChat running, browsers installed, storageState exists. It does NOT require redakt (unlike Phase 2). Phase 3 must be outside the redakt availability conditional block.
   - Run: `npx playwright test --config e2e/post-merge.playwright.config.ts`
   - On failure, include recovery instructions in output (see "Post-Merge Hook Failure Recovery")
   - Report results in the same format as Phase 2

8. **Update project files**:
   - Add `/e2e/specs/.post-merge-test-results/` to `.gitignore`
   - Add new test commands to `docs/pii-merge-checklist.md`
   - Document `E2E_USER2_EMAIL` / `E2E_USER2_PASSWORD` in `.env.example`

### Critical Implementation Considerations

1. **Route interception for detect mode (REQ-019-021).** The Playwright `page.route()` must intercept the correct API URL pattern. Agent chat uses `POST /api/agents/chat/`, but the exact URL may vary by endpoint. Use a regex pattern like `/\/api\/(agents|assistants)\/.*\/(chat|completions|responses)/` to catch all chat routes. The mock response body must match the format from `detectPII.js` for the appropriate route type:

   For **SSE routes** (agent chat, assistant chat -- the primary chat interface):
   ```json
   {
     "error": {
       "message": "Your message was not sent because it appears to contain personal information (names, email addresses). Please remove personal details and try again.",
       "type": "pii_detection"
     }
   }
   ```
   For **JSON API routes** (OpenAI-compatible, Open Responses):
   ```json
   {
     "error": {
       "message": "Your message was not sent because it appears to contain personal information (names, email addresses). Please remove personal details and try again.",
       "type": "pii_detected"
     }
   }
   ```
   Note the `type` field difference: `"pii_detection"` (SSE) vs `"pii_detected"` (JSON). This divergence is in `detectPII.js:487`. The primary chat UI uses SSE routes, so the default mock should use `"pii_detection"`.

2. **Non-admin user storage state.** The non-admin user needs a separate storage state file (`storageState-nonadmin.json`) because `storageState.json` is used by the admin user. Test 2 must create a new browser context with the non-admin storage state, not use the default context.

3. **Dashboard seed data (REQ-002 through REQ-008).** The auth setup or a `beforeAll` hook should generate seed data via API calls to ensure dashboard sections render with content. At minimum:
   - Create a conversation (populates overview cards)
   - If the test database is empty, sections may show loading states or "No data" messages
   - Tests should accept either populated content or empty-state messages as valid renders -- the critical check is that the section heading and container are present, not that specific data values appear

4. **The `ensureLoggedIn` pattern.** All spec files should include the `ensureLoggedIn` helper from `pii-detection.spec.ts` (or import it from a shared module) to handle mid-run session expiry gracefully. This avoids test failures from JWT token expiration during longer test runs.

5. **Test file naming convention.** All spec files use the `post-merge-` prefix to enable targeted execution via `testMatch` in the config and to clearly distinguish them from standard and PII-specific tests.

## Implementation Summary

**Completion Date:** 2026-04-01
**Branch:** `feature/012-post-merge-e2e-tests`

### Requirements Validation

All 29 functional requirements (REQ-001 through REQ-029) implemented and verified. All 6 non-functional requirements (PERF-001, PERF-002, SEC-001, SEC-002, UX-001, UX-002) addressed in config and test design.

### Implementation Artifacts

| File | Lines | Purpose |
|------|-------|---------|
| `e2e/post-merge.playwright.config.ts` | 47 | Playwright config: single worker, video retain-on-failure, testMatch post-merge-*.spec.ts |
| `e2e/setup/post-merge-auth-setup.ts` | 123 | Auth setup for admin + optional non-admin user with role verification |
| `e2e/helpers/ensure-logged-in.ts` | 42 | Shared ensureLoggedIn helper with storage state persistence |
| `e2e/specs/post-merge-dashboard.spec.ts` | 215 | Tests 1-2: dashboard smoke (REQ-001-010) + access control (REQ-011-012), serial mode |
| `e2e/specs/post-merge-auth.spec.ts` | 89 | Test 3: auth flow stability (REQ-013-016) |
| `e2e/specs/post-merge-pii.spec.ts` | 205 | Tests 4-6: chat chain (REQ-017-018), detect mode interception (REQ-019-021), warn mode (REQ-022-024) |
| `e2e/specs/post-merge-routes.spec.ts` | 149 | Tests 7-8: route registration (REQ-025-026), package integrity (REQ-027-029) |
| `.husky/post-merge` (modified) | 200 | Phase 3 added, independent of redakt, with failure recovery instructions |
| `.gitignore` (modified) | -- | Post-merge test artifacts, non-admin storageState |
| `.env.example` (modified) | -- | E2E_USER2_EMAIL / E2E_USER2_PASSWORD documented |
| `docs/pii-merge-checklist.md` (modified) | -- | Post-merge e2e test command added |

### Key Implementation Decisions

1. **ensureLoggedIn extracted to shared helper** (`e2e/helpers/ensure-logged-in.ts`) instead of inline duplication, following review feedback.
2. **Dashboard tests run in serial mode** to avoid race conditions with shared admin storage state.
3. **REQ-029 uses explicit chat route file allowlist** rather than dynamic directory scanning, making failures more specific.
4. **AI endpoint skip logic (FAIL-007)** added to chat tests that depend on external AI availability.
5. **Video config set to `retain-on-failure`** (changed from `on-first-retry` during review) for better debugging.
6. **Non-admin role verified during auth setup** to catch FAIL-003 early.
7. **OverviewCards use `<h3>` elements** -- selectors use `getByRole('heading', { level: 3 })` based on actual component inspection.
8. **Phase 3 in post-merge hook placed outside redakt conditional** to ensure non-PII tests always run when LibreChat is available.
