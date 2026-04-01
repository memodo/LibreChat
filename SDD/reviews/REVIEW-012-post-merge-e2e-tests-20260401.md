# REVIEW-012: Post-Merge E2E Tests

**Date:** 2026-04-01
**Spec:** SPEC-012-post-merge-e2e-tests
**Branch:** feature/012-post-merge-e2e-tests
**Reviewer:** Claude Opus 4.6 (automated spec-driven review)

## Decision: APPROVED (with minor findings)

All 29 requirements (REQ-001 through REQ-029) are implemented. All EDGE and FAIL scenarios are addressed. The findings below are minor observations that do not block approval.

---

## 1. SPECIFICATION ALIGNMENT (70%)

### Requirement-to-Implementation Mapping

| REQ | Description | File | Status | Notes |
|-----|-------------|------|--------|-------|
| REQ-001 | Dashboard page loads | `post-merge-dashboard.spec.ts:55-63` | PASS | Heading `Usage Reports` checked, 15s timeout within 30s test timeout |
| REQ-002 | 6 overview cards render | `post-merge-dashboard.spec.ts:65-86` | PASS | All 6 labels checked with `level: 3` per PROMPT decision |
| REQ-003 | Usage Trends + granularity | `post-merge-dashboard.spec.ts:88-104` | PASS | Heading + day/week/month buttons |
| REQ-004 | Cost by Model + headers | `post-merge-dashboard.spec.ts:106-119` | PASS | Heading + "Model" and "Total Spend" text |
| REQ-005 | Top Users + search | `post-merge-dashboard.spec.ts:121-136` | PASS | Heading + search input via placeholder pattern |
| REQ-006 | User Activity | `post-merge-dashboard.spec.ts:138-147` | PASS | Heading with regex `/User Activity/` |
| REQ-007 | Guardrail Events + filters | `post-merge-dashboard.spec.ts:149-163` | PASS | Heading + select filter controls in section |
| REQ-008 | Date range presets | `post-merge-dashboard.spec.ts:165-177` | PASS | All 4 preset buttons checked |
| REQ-009 | Refresh button | `post-merge-dashboard.spec.ts:179-188` | PASS | Button with name "Refresh" |
| REQ-010 | Back to Chat link | `post-merge-dashboard.spec.ts:190-201` | PASS | Link click + waitForURL `/c/new` |
| REQ-011 | Non-admin access denied | `post-merge-dashboard.spec.ts:210-239` | PASS | Separate browser context with `storageState-nonadmin.json`, positive assertion on "Access Denied" h1, message text checked |
| REQ-012 | Non-admin user setup | `post-merge-auth-setup.ts:72-86` | PASS | Optional E2E_USER2_EMAIL/PASSWORD, saves to `storageState-nonadmin.json`, skip if not configured |
| REQ-013 | Valid login redirects | `post-merge-auth.spec.ts:51-70` | PASS | Clears cookies, logs in, waitForURL `/c/` |
| REQ-014 | Invalid login error | `post-merge-auth.spec.ts:72-90` | PASS | Uses role="alert" or text-red classes for error detection |
| REQ-015 | Unauthenticated redirect | `post-merge-auth.spec.ts:92-102` | PASS | Clears cookies, navigates to `/c/new`, expects `/login` |
| REQ-016 | User menu visible | `post-merge-auth.spec.ts:104-119` | PASS | Multi-selector approach for user menu/avatar |
| REQ-017 | Clean message gets AI response | `post-merge-pii.spec.ts:65-79` | PASS | 60s timeout, checks for "Paris" in response |
| REQ-018 | Response appears in chat | `post-merge-pii.spec.ts:65-79` | PASS | Combined with REQ-017 (checking for visible "Paris" text) |
| REQ-019 | Detect mode via route interception | `post-merge-pii.spec.ts:83-137` | PASS | `page.route()` intercepts POST to agents/assistants, returns 400 with mock |
| REQ-020 | Blocked message not in history | `post-merge-pii.spec.ts:129-137` | PASS | Iterates message elements, checks no john.smith@example.com |
| REQ-021 | Route interception format | `post-merge-pii.spec.ts:92-94, 107` | PASS | Uses `"pii_detection"` for SSE route. `"pii_detected"` variant documented in comments (lines 19-21, 92-94) |
| REQ-022 | Warn mode toast | `post-merge-pii.spec.ts:141-201` | PASS | Races warn toast vs detect error, skips if wrong mode |
| REQ-023 | Message delivered in warn mode | `post-merge-pii.spec.ts:197-201` | PASS | Checks last `message-text-editor` is visible |
| REQ-024 | Redakt dependency skip | `post-merge-pii.spec.ts:147-157` | PASS | Health check at `PII_DETECTION_API_URL`, `test.skip()` if unavailable |
| REQ-025 | Reporting route accessible | `post-merge-routes.spec.ts:54-73` | PASS | Races "Usage Reports" vs "Access Denied" headings |
| REQ-026 | Admin conversation viewer route | `post-merge-routes.spec.ts:75-94` | PASS | Navigates to fake ID, checks body not empty and no "Cannot GET" |
| REQ-027 | ErrorTypes.PII_DETECTION exists | `post-merge-routes.spec.ts:98-111` | PASS | `fs.readFileSync` + `toContain("PII_DETECTION = 'pii_detection'")` |
| REQ-028 | GuardrailEvent API returns 200 | `post-merge-routes.spec.ts:113-135` | PASS | Intercepts GET to guardrail-events, asserts 200 + JSON array |
| REQ-029 | Chat routes include PII middleware | `post-merge-routes.spec.ts:137-166` | PASS | Scans agents/ and assistants/ dirs, checks `router.post('/')` files for `createDetectPII` |

**Result: 29/29 requirements implemented.**

### Edge Case Coverage

| Edge Case | Handling | Status |
|-----------|----------|--------|
| EDGE-001: New middleware breaks chain | REQ-017 catches broken chain (clean message fails) | PASS |
| EDGE-002: SSE hook refactor drops warning | REQ-022 catches missing toast | PASS |
| EDGE-003: Route registration lost | REQ-001, REQ-025, REQ-026 catch missing routes | PASS |
| EDGE-004: ErrorTypes enum modified | REQ-027 static analysis catches missing constant | PASS |
| EDGE-005: Admin role/capability changes | REQ-011 catches access control regression | PASS |
| EDGE-006: New chat route without PII | REQ-029 static analysis scan catches missing middleware | PASS |
| EDGE-007: Session expiry mid-run | `ensureLoggedIn` in `beforeEach` for all specs | PASS |
| EDGE-008: Dashboard empty state | Tests check section headings/controls, not data content | PASS |

### Failure Scenario Coverage

| Failure | Handling | Status |
|---------|----------|--------|
| FAIL-001: Redakt unavailable | REQ-024 `test.skip()` in warn mode test; Phase 3 independent of redakt in hook | PASS |
| FAIL-002: Admin lacks role | Test will fail with clear assertion error (heading not found) | PASS |
| FAIL-003: Non-admin has admin role | REQ-011 will fail (Access Denied not shown) | PASS |
| FAIL-004: Missing env vars | Auth setup exits with error for required vars; Test 2 skipped for optional vars | PASS |
| FAIL-005: LibreChat not running | Hook checks `curl localhost:3080`, exits 0 if down | PASS |
| FAIL-006: Browsers not installed | Hook checks for "Executable doesn't exist" in output | PASS |
| FAIL-007: AI endpoint not configured | REQ-017 has 60s timeout; descriptive timeout failure | PASS |

### Specific Verification Checks

**Mock response format (`pii_detection` vs `pii_detected`):**
- SSE mock uses `"type": "pii_detection"` -- CORRECT (line 107 of pii spec)
- JSON API variant `"pii_detected"` documented in comments (lines 19-21, 92-94) -- CORRECT
- This matches the spec requirement for REQ-021

**Selector patterns (semantic, no data-testid for admin dashboard):**
- All dashboard selectors use `getByRole('heading', ...)`, `getByRole('button', ...)`, `getByRole('link', ...)`, `getByText(...)`, `locator('select')` -- CORRECT
- Chat selectors appropriately use `data-testid` (`text-input`, `message-text-editor`) as these are upstream-controlled -- CORRECT per spec

**Timeout values (PERF-002):**
- Navigation/render tests (Tests 1, 2, 7): `test.setTimeout(30000)` -- CORRECT
- Auth tests (Test 3): `test.setTimeout(30000)` -- CORRECT
- Chat interaction tests (Tests 4, 5, 6): `test.setTimeout(60000)` -- CORRECT
- Package integrity tests (Test 8): `test.setTimeout(30000)` -- CORRECT

**`ensureLoggedIn` in `beforeEach` for every spec:**
- `post-merge-dashboard.spec.ts`: `beforeEach` at line 50-52 -- CORRECT
- `post-merge-auth.spec.ts`: `beforeEach` at line 47-49 -- CORRECT
- `post-merge-pii.spec.ts`: `beforeEach` at line 60-62 -- CORRECT
- `post-merge-routes.spec.ts`: `beforeEach` at line 49-51 -- CORRECT

**Non-admin uses separate browser context with `storageState-nonadmin.json`:**
- `post-merge-dashboard.spec.ts:218-219`: `browser.newContext({ storageState: nonAdminStoragePath })` -- CORRECT
- Context is closed in `finally` block -- CORRECT

**Phase 3 in post-merge hook is OUTSIDE redakt conditional:**
- Phase 2 (PII e2e) is inside `if [ "$PHASE2_SKIP" = false ]` block (lines 102-142)
- Phase 3 (post-merge e2e) starts at line 144, completely outside that conditional -- CORRECT
- Phase 3 only depends on LibreChat running + storageState (checked earlier in hook) -- CORRECT

**Post-merge hook failure recovery message:**
- Lines 180-184 include the exact recovery instructions specified in the spec -- CORRECT

### `.gitignore` Entries

- `/e2e/specs/.post-merge-test-results/` -- CORRECT
- `/e2e/post-merge-auth-setup-*-failure.png` -- CORRECT (covers auth setup failure screenshots)
- `/e2e/storageState-nonadmin.json` -- CORRECT

### Config File

- `globalSetup`: points to `post-merge-auth-setup` -- CORRECT
- `testMatch`: `post-merge-*.spec.ts` -- CORRECT
- `workers: 1` -- CORRECT
- `retries: 0` -- CORRECT
- `outputDir: 'specs/.post-merge-test-results'` -- CORRECT
- `reporter: [['list']]` -- CORRECT
- No webServer block -- CORRECT
- No global teardown -- CORRECT
- Concurrent execution warning in header comment -- CORRECT
- `screenshot: 'only-on-failure'` -- CORRECT

---

## 2. CONTEXT ENGINEERING (20%)

| Criterion | Status | Notes |
|-----------|--------|-------|
| PROMPT document exists | PASS | `SDD/prompts/PROMPT-012-post-merge-e2e-tests-2026-04-01.md` |
| PROMPT tracks all files | PASS | Created and modified files listed with REQ coverage |
| PROMPT records decisions | PASS | 5 decisions documented (h3 elements, User Activity heading, select elements, ensureLoggedIn pattern, Phase 3 placement) |
| Implementation traceable to spec | PASS | Each test name includes REQ number(s) |

---

## 3. TEST QUALITY (10%)

| Criterion | Status | Notes |
|-----------|--------|-------|
| Explicit waits, not fixed delays | PASS with note | All primary waits use `toBeVisible({ timeout })`, `waitForURL`, `waitForResponse`. One `waitForTimeout(2000)` in REQ-020 for absence check and one `waitForTimeout(3000)` in REQ-026 for page render -- both are acceptable per UX-001 (under 3s, used for absence confirmation) |
| Descriptive test names | PASS | Every test includes REQ number and plain-English description |
| Skip conditions are clear | PASS | All `test.skip()` calls include descriptive reason strings |
| No hardcoded credentials | PASS | All credentials from `process.env` (SEC-002) |
| No real PII in test data | PASS | Uses "John Smith" / "john.smith@example.com" synthetic data (SEC-001) |

---

## Minor Findings (Non-Blocking)

### Finding 1: REQ-026 uses `waitForTimeout(3000)` instead of explicit wait

In `post-merge-routes.spec.ts:87`, the admin conversation viewer route test uses `page.waitForTimeout(3000)` before checking body text. This is technically within the UX-001 tolerance (under 3 seconds for absence/render confirmation), but could be replaced with a more deterministic wait, e.g., `page.waitForLoadState('networkidle')`. Not blocking because UX-001 explicitly allows brief pauses under 3 seconds.

### Finding 2: REQ-028 guardrail-events response shape assumption

The spec says "response body is a valid JSON array (may be empty)." The implementation at `post-merge-routes.spec.ts:133-134` asserts `Array.isArray(body)`. However, looking at common paginated API patterns, the endpoint might return `{ data: [...], total: N }` instead of a bare array. If the API returns an object wrapper, this assertion would fail. This is spec-compliant as written -- just a note that the assertion depends on the actual API response shape.

### Finding 3: Auth setup timeout could be tight

The `loginUser` function in `post-merge-auth-setup.ts:31` uses `timeout: 10000` for `page.goto()`. If the server is slow after a merge (package rebuild), 10 seconds may be tight. The spec does not specify a setup timeout, but the 15-second `waitForURL` on line 38 provides some buffer.

---

## Summary

The implementation faithfully covers all 29 functional requirements, all 8 edge cases, and all 7 failure scenarios defined in SPEC-012. The post-merge hook correctly places Phase 3 outside the redakt conditional. Mock response formats match the spec. Timeout values match PERF-002. The `ensureLoggedIn` pattern is present in `beforeEach` for all four spec files. Non-admin access control uses a separate browser context with its own storage state file. The `.gitignore` includes all required artifact paths.

**Decision: APPROVED**

---

## Findings Addressed (2026-04-01)

All findings from this review and the companion critical implementation review have been resolved:

### Finding 1 (REQ-026 `waitForTimeout`): Addressed
Replaced `waitForTimeout(3000)` with `waitForLoadState('networkidle')` plus a fallback, and added a stronger assertion checking for the app shell (`nav, main, [role="main"], #root > div`).

### Finding 2 (REQ-028 response shape): Acknowledged
No code change needed -- this was a spec-compliant observation. The test correctly matches the current API response shape.

### Finding 3 (Auth setup timeout): Acknowledged
No change -- the existing 15-second `waitForURL` provides sufficient buffer. The spec does not require a longer setup timeout.

### Additional Fixes Applied (from CRITICAL-IMPL review)
See `CRITICAL-IMPL-post-merge-e2e-tests-20260401.md` "Findings Addressed" section for the full list of P0-P3 fixes.
