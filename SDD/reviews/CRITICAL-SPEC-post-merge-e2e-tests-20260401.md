# Specification Critical Review: Post-Merge E2E Tests

**Spec:** SPEC-012-post-merge-e2e-tests.md
**Research:** RESEARCH-012-post-merge-e2e-tests.md
**Reviewer:** Claude (adversarial review)
**Date:** 2026-04-01

### Overall Severity: MEDIUM-HIGH

The spec is well-structured and covers the main integration points, but contains several factual errors about the codebase, a critical terminology mismatch on PII detection modes, underspecified failure recovery paths, and missing edge cases around the post-merge hook workflow. These issues will cause implementation confusion and could result in tests that pass while missing real regressions.

---

## Ambiguities That Will Cause Problems

### 1. REQ-022: "Default PII_DETECTION_MODE=warn (production configuration)" is factually wrong

The spec states throughout that production runs in `warn` mode and that `warn` is the default. The actual codebase tells a different story:

- `detectPII.js:235`: `const mode = process.env.PII_DETECTION_MODE || 'detect';` -- default is **detect**, not warn.
- `detectPII.js:236`: Only `'detect'` and `'warn'` are valid modes. There is no `'block'` mode.
- `.env.example:445`: `PII_DETECTION_MODE=detect`

The spec uses "block mode" and "detect mode" interchangeably (REQ-019 says "Block mode error via route interception" while the actual mode name is `detect`). The entire Test 5 description calls it "PII Detection Block Mode" but the enum value it claims to test is `PII_DETECTION` and the actual blocking behavior happens under `mode === 'detect'`.

- **Possible interpretations:** (A) The spec means `detect` mode when it says "block mode" and `warn` mode is indeed what production uses. (B) The spec is confused about mode names and the implementer must figure out the actual production config.
- **Recommendation:** Fix all references. The modes are `detect` (blocks) and `warn` (allows through with warning). Clarify what the actual production `.env` sets. If production uses `detect`, then REQ-022's premise about warn mode being the production default is wrong and the entire test strategy for Tests 5 vs 6 may need rethinking.

### 2. REQ-019/REQ-021: Route interception mock uses `"type": "pii_detection"` but actual JSON routes use `"type": "pii_detected"`

Line 487 of `detectPII.js`:
```js
type: responseFormat === 'json' ? 'pii_detected' : ErrorTypes.PII_DETECTION,
```

For JSON API routes (OpenAI-compatible, Open Responses), the error type is `pii_detected` (past tense), NOT `ErrorTypes.PII_DETECTION`. The spec's mock response body in REQ-021 uses `"type": "pii_detection"` which matches the SSE-route behavior but not the JSON-route behavior. An implementer following the spec literally would create a mock that doesn't match what either route type actually returns (SSE routes use the `ErrorTypes.PII_DETECTION` constant, JSON routes use the literal string `'pii_detected'`).

- **Possible interpretations:** (A) The test should mock the SSE-route error format. (B) The test should mock the JSON-route error format. (C) Both should be tested.
- **Recommendation:** Specify which route format is being mocked. If intercepting the agent chat endpoint (SSE route), the type should match `ErrorTypes.PII_DETECTION`. If intercepting an API route, it should be `'pii_detected'`. The spec should also note this dual-type divergence as an additional regression to watch for.

### 3. REQ-011: Access denied text does not match the actual component

The spec says to check for: `"You do not have permission to view usage reports"`

The actual `ReportingDashboard.tsx:36-38` renders:
```
You do not have permission to view usage reports. Contact your administrator to request the READ_USAGE capability.
```

This is a minor issue since the spec text is a substring, but the spec also says to check that the `"Usage Reports"` heading is NOT visible. The actual component renders an `<h1>` with text "Access Denied", not "Usage Reports". The heading check seems redundant since a non-admin never sees the dashboard at all -- the component returns early with the access denied block.

- **Recommendation:** The test should check for "Access Denied" heading visibility (positive assertion) rather than asserting "Usage Reports" heading absence (negative assertion). Positive assertions are more robust.

### 4. REQ-012: Non-admin user role verification is underspecified

The spec says the user must not have `SystemRoles.ADMIN` role. But `ReportingDashboard.tsx:31` checks `user.role !== SystemRoles.ADMIN`. The research document mentions the dashboard also requires `ACCESS_ADMIN` + `READ_USAGE` capabilities. The spec does not clarify which check is authoritative or whether both gates exist.

If there are two layers of access control (role check in the component + capability check on the API), a non-admin user might see a rendered dashboard that makes failing API calls. The test would pass (sections render) but the user would see empty/error states.

- **Recommendation:** Clarify whether the admin gate is solely the `user.role` check in the React component or whether API-level capability checks also apply. Document which check the test is actually validating.

### 5. REQ-028: "HTTP 200 from guardrail-events endpoint" is an incomplete verification

The spec says to intercept the network request to `/api/admin/usage/guardrail-events` and assert status 200. This only proves the endpoint exists and accepts authenticated requests. It does not prove the `GuardrailEvent` model is registered -- the endpoint could return 200 with an empty array from a fallback handler or generic route.

- **Recommendation:** Assert the response body structure (e.g., is an array or has an expected shape) to confirm the model is actually being queried, not just that the route exists.

### 6. PERF-002: Timeout values inconsistent with test descriptions

Test 3 (auth tests) gets 15 seconds per the spec, but REQ-013 says login should redirect "within 15 seconds." If the test timeout equals the expected action time, there is zero margin for Playwright overhead, browser startup, or network jitter.

- **Recommendation:** Test timeouts should be at least 2x the expected action time. If login takes up to 15s, the test timeout should be 30s.

---

## Missing Specifications

### 1. No specification for chatV2 assistant route

The research document and spec both mention `chatV2.js` as having the "same pattern as chatV1" but neither provides the line number for PII middleware insertion in chatV2. The spec lists chatV1 at lines 28 and 34 but says nothing specific about chatV2. If chatV2 has different middleware ordering, the tests would miss it.

- **Why it matters:** An upstream refactor could break chatV2 independently of chatV1.
- **Suggested addition:** Add explicit line references for chatV2 PII middleware and consider whether Test 4 should exercise the chatV2 route specifically (e.g., assistant-based chat vs. agent-based chat).

### 2. No specification for handling post-merge hook failures that leave the repo in a bad state

The spec says Phase 1 (unit tests) exits with code 1 on failure, which blocks the merge. But the post-merge hook runs AFTER the merge is already committed. Exiting with code 1 does not undo the merge. The developer is left with a broken state and no documented recovery path.

- **Why it matters:** A developer who sees "PII TESTS FAILED" after a merge may not know whether to revert, fix forward, or ignore.
- **Suggested addition:** Add a FAIL scenario for "tests fail after merge is committed" with an explicit recovery procedure (e.g., `git revert HEAD` or "fix and commit").

### 3. No specification for concurrent test suite execution

The spec says `workers: 1` for the post-merge suite, but does not address what happens if someone runs the post-merge suite and PII suite simultaneously. Both share `storageState.json`. The non-admin suite writes to `storageState-nonadmin.json` which could conflict if the PII suite is extended later.

- **Why it matters:** A developer might run both suites in parallel for speed.
- **Suggested addition:** Document that the suites must not run concurrently, or use distinct storage state file paths.

### 4. No specification for test output artifacts

The spec mentions `outputDir: 'specs/.post-merge-test-results'` but does not specify whether this directory should be in `.gitignore`, how large artifacts can grow, or when they should be cleaned up.

- **Why it matters:** Test result artifacts (screenshots, traces, videos) can accumulate and bloat the repo.
- **Suggested addition:** Add `.post-merge-test-results` to `.gitignore` and specify whether Playwright should capture screenshots/traces on failure (useful for debugging) or never (to keep things lean).

### 5. No specification for what happens when Phase 2 (existing PII e2e) passes but Phase 3 (post-merge e2e) fails

The current post-merge hook has two phases. Adding Phase 3 creates a new failure mode: Phase 1 passes, Phase 2 passes, Phase 3 fails. The spec does not clarify whether Phase 3 failure should exit 1 (block) or exit 0 (warn). Given these are post-merge (already committed), hard blocking is debatable.

- **Suggested addition:** Explicit exit code policy for Phase 3 failures.

### 6. Missing NFR: Test suite maintenance burden

The spec creates 4 new spec files and a new config. There is no guidance on who maintains these tests, how to update them when custom features change, or what the deprecation path is if a custom feature is removed.

- **Suggested addition:** A maintenance section documenting ownership and update triggers.

---

## Research Disconnects

### 1. Research identified "upstream adds new chat route without PII middleware" as an ongoing risk (EDGE-006) but the spec dismisses it as a "detection gap that e2e tests cannot catch directly"

The research identified this as a core risk. The spec acknowledges it but offers no mitigation beyond "code review during merge." This is the most likely real-world regression scenario -- upstream adds a new route, the merge goes through, and the new route has no PII protection. A static analysis check (grep for route files without `createDetectPII`) would be more valuable than many of the UI-level smoke tests.

- **Recommendation:** Add a lightweight static analysis step to the post-merge hook that greps for chat route handlers and flags any that lack PII middleware.

### 2. Research mentions the admin dashboard has a rate limiter (60/min) but the spec does not account for this

If the test suite makes many rapid API calls during dashboard rendering (loading all 7+ sections), rate limiting could cause intermittent failures.

- **Recommendation:** Add this as a risk or document that the test environment should disable rate limiting (as `playwright.config.local.ts` apparently does).

### 3. Research lists 8 API endpoints under `/api/admin/usage/*` but the spec only validates one (guardrail-events)

The research documents: `/overview`, `/trends`, `/models`, `/users`, `/users/:userId`, `/activity`, `/guardrail-events`, `/guardrail-summary`, `/conversation/:conversationId`. The spec only intercepts and validates the guardrail-events endpoint. If any of the other 7 endpoints are broken, the dashboard sections will render but show errors or loading spinners.

- **Recommendation:** Either intercept all API calls during dashboard load and assert they return 200, or explicitly state that backend API integrity is out of scope for these e2e tests.

### 4. Research mentions `PII_DETECTION_FAIL_OPEN` config but the spec does not test any circuit breaker behavior

The detectPII middleware has a circuit breaker that opens after consecutive failures. The spec tests warn mode and detect mode but not the fail-open/fail-closed degradation path. An upstream merge could break the circuit breaker logic.

- **Recommendation:** Document this as explicitly out of scope or add a test that verifies behavior when redakt is unreachable (which could be done by temporarily intercepting the redakt API call).

---

## Risk Reassessment

### RISK-001 (Redakt availability): Actually HIGH, not adequately mitigated

The spec says Test 6 skips when redakt is unavailable. But the current post-merge hook (line 52) already skips ALL e2e tests if redakt is not running. This means the new Phase 3 tests would ALSO be skipped entirely when redakt is down -- not just Test 6. The spec implies Tests 1-5 and 7-8 would still run, but the current hook logic would skip the entire phase.

- **Recommendation:** Phase 3 must have its own prerequisite check separate from Phase 2. The hook should not require redakt for non-PII tests (dashboard, auth, routes).

### RISK-003 (Test flakiness): Actually HIGH because of AI endpoint dependency

Tests 4 and 6 require a working AI endpoint to produce a response. AI endpoints are inherently variable in latency and availability. The 60-second timeout is generous but AI service outages would cause consistent test failures unrelated to merge quality. This is the most likely source of false negatives in the entire suite.

- **Recommendation:** Consider mocking the AI response for Test 4 (similar to how Test 5 mocks the block response) so the middleware chain is tested without depending on external AI availability. Keep one "live" AI test as optional.

### RISK-005 (Upstream changes to test infrastructure): Actually MEDIUM-HIGH

The spec says the post-merge config is "self-contained" but it shares the `storageState.json` path, the `e2e/specs/` directory, the `e2e/setup/` utilities, and the Playwright dependency version. Any upstream Playwright version bump or restructuring of the e2e directory would break this suite.

---

## Contradictions

### 1. Spec says "production configuration" is warn mode; codebase default is detect mode

REQ-022 states `PII_DETECTION_MODE=warn` is the "production configuration." The `.env.example` sets `PII_DETECTION_MODE=detect`. The `detectPII.js` default is `detect`. Either the spec is wrong about the production default, or the deployment uses a different `.env` than `.env.example`. This needs explicit clarification because it determines whether Test 5 (block/detect mode) needs route interception at all -- if production is already in detect mode, the real behavior can be tested directly.

### 2. Spec says "no global teardown" but also says tests are "persistent across runs"

If test users are persistent and never cleaned up, repeated test runs will accumulate data (conversations, messages) that could affect dashboard tests (EDGE-008 becomes impossible -- there will always be data). This contradicts the notion that tests should "accept both populated and empty states."

### 3. REQ-027 says it's "implicit" but then describes explicit verification

REQ-027 states the `ErrorTypes.PII_DETECTION` check is "implicit" via Test 5. But Test 5 uses route interception -- the mock response contains the type string, not the actual `ErrorTypes` constant. The test cannot verify the constant exists in the codebase; it only verifies the frontend handles that string. If someone hardcodes `"pii_detection"` in the frontend error handler instead of using the `ErrorTypes` constant, Test 5 still passes but the coupling to the package is broken.

---

## Critical Questions Answered

### 1. What will cause arguments during implementation due to spec ambiguity?

The detect/warn/block mode terminology. The spec uses three terms (block, detect, warn) for two modes. Implementers will argue about whether to mock the `detect` mode response or a separate `block` mode response, and whether the test names should say "block" or "detect."

### 2. Which requirements will be hardest to verify as "done"?

REQ-027 (ErrorTypes.PII_DETECTION exists) and REQ-028 (GuardrailEvent model registered). Both are described as "implicit" verifications bundled into other tests. There is no standalone assertion that directly validates these. The implementer and reviewer will disagree on whether the implicit check is sufficient.

### 3. What's the most likely way this spec leads to wrong implementation?

An implementer reads the spec, sees "PII_DETECTION_MODE=warn (production configuration)" and "Block mode error via route interception," assumes production is in warn mode, builds the route interception mock, and ships it. Then on actual deploy, production is in `detect` mode and the real block behavior is never tested end-to-end because the spec said to mock it.

### 4. Which edge cases are still missing?

- **EDGE-MISSING-1:** Upstream changes the login page URL or removes the `/login` route. REQ-015 checks for `/login` in the URL but this is upstream-controlled.
- **EDGE-MISSING-2:** Upstream changes the chat input selector or message rendering. Tests 4/5/6 must find the chat input and message area but no selectors are specified.
- **EDGE-MISSING-3:** Multiple PII entities in a single message -- the spec only tests name + email, but the redakt service might return different entity types that the error message template doesn't handle.
- **EDGE-MISSING-4:** The admin user's session expires between Test 1 and Test 8. The spec mentions `ensureLoggedIn` but does not specify which tests use it or whether it's in `beforeEach` for every test or only some.
- **EDGE-MISSING-5:** The `/admin/conversation/test-conversation-id` route (REQ-026) might render differently depending on whether a conversation with that ID exists. The spec says "may show not found" but does not specify what selector to check -- just "not 404, blank, or crash." How does the test distinguish between a React error boundary (crash) and a legitimate "not found" render? Both render visible DOM elements.

---

## Recommended Actions Before Proceeding

1. **[CRITICAL] Resolve the detect/warn/block terminology.** Audit the actual production `.env` to determine the real mode. Fix all spec references to use only `detect` and `warn` (the two actual modes). Clarify whether Test 5 should use route interception or test real detect-mode behavior.

2. **[CRITICAL] Fix the `pii_detected` vs `pii_detection` type mismatch.** The mock response must match the actual error type for the route being intercepted. Document the dual-type behavior (JSON routes use `pii_detected`, SSE routes use `ErrorTypes.PII_DETECTION`).

3. **[HIGH] Decouple Phase 3 prerequisite checks from Phase 2.** The current hook requires redakt for all e2e tests. Phase 3 should have independent checks so dashboard/auth/route tests run even without redakt.

4. **[HIGH] Specify chat input and message area selectors.** Tests 4, 5, and 6 need to interact with the chat UI but no selectors are given. These are the most fragile part of the suite if upstream changes the chat interface.

5. **[MEDIUM] Add static analysis step for new chat routes missing PII middleware.** This closes the biggest detection gap (EDGE-006) that e2e tests cannot address.

6. **[MEDIUM] Consider mocking the AI response in Test 4.** External AI dependency is the most likely source of false failures. A mocked AI test validates the middleware chain; a live AI test validates the full stack. Consider having both, with the live test skippable.

7. **[LOW] Add test artifact cleanup and .gitignore entries.** Prevent `.post-merge-test-results` from being committed.

---

## Findings Addressed

**Date:** 2026-04-01
**Addressed by:** Claude (spec revision)
**Verified against:** Actual codebase files (detectPII.js, .husky/post-merge, messages.spec.ts, pii-detection.spec.ts, ReportingDashboard.tsx, chatV2.js, config.ts, .env.example)

### Ambiguities Resolved

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | detect/warn/block terminology | CRITICAL | Fixed all references. The two modes are `detect` (blocks messages, returns error) and `warn` (allows through with warning). All "block mode" references changed to "detect mode." Clarified that codebase default is `detect` (`detectPII.js:235`, `.env.example:445`); MemodoAI production overrides to `warn`. REQ-022 now documents this and specifies that Test 6 should skip if server is running in detect mode. |
| 2 | `pii_detected` vs `pii_detection` type mismatch | CRITICAL | REQ-021 now documents both error type variants: SSE routes use `ErrorTypes.PII_DETECTION` = `"pii_detection"`, JSON API routes use literal `"pii_detected"` (past tense). Mock format specified for both. Source: `detectPII.js:487`. |
| 3 | REQ-011 access denied text/heading | MEDIUM | Changed from negative assertion ("Usage Reports" NOT visible) to positive assertion ("Access Denied" heading IS visible). Verified from `ReportingDashboard.tsx:35` that the `<h1>` renders "Access Denied". Documented that the admin gate is the `user.role !== SystemRoles.ADMIN` check at line 31. |
| 4 | REQ-012 admin vs capability check | MEDIUM | Clarified in REQ-011 that the frontend gate is solely the role check; API-level capability checks also exist but the frontend prevents rendering entirely. |
| 5 | REQ-028 incomplete verification | MEDIUM | Added assertion that response body is a valid JSON array (not just status 200). |
| 6 | PERF-002 timeout margin | MEDIUM | Auth test timeout increased from 15s to 30s to provide 2x margin over expected login time. |

### Missing Specifications Added

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | chatV2 line references | HIGH | Added explicit line numbers: `chatV2.js:28,34` (createDetectPII at 28, sendPiiWarning at 34). Verified from actual file. |
| 2 | Post-merge hook failure recovery | HIGH | Added "Post-Merge Hook Failure Recovery" section with explicit recovery procedure and exit code policy for Phase 3. |
| 3 | Concurrent test suite execution | MEDIUM | Added "Concurrent Execution Guard" section documenting that suites must not run concurrently due to shared storageState.json. |
| 4 | Test output artifacts | LOW | Added "Test Artifact Management" section. Specified `.post-merge-test-results` must be in `.gitignore` and screenshots captured only on failure. |
| 5 | Phase 3 failure exit code | MEDIUM | Documented in "Post-Merge Hook Failure Recovery": Phase 3 exits with code 1 on failure, with recovery instructions in output. |
| 6 | Test suite maintenance burden | LOW | Added "Test Suite Maintenance" section with ownership, update triggers, and deprecation guidance. |

### Research Disconnects Resolved

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | EDGE-006 -- new chat routes without PII middleware | HIGH | Added REQ-029: static analysis check that greps route files for `createDetectPII` usage. Updated EDGE-006 description with concrete mitigation approach. |
| 2 | Rate limiter interference | MEDIUM | Added "Rate Limiting Awareness" section documenting the 60/min limit and mitigation strategies (local config or brief pause). |
| 3 | Only guardrail-events endpoint validated | MEDIUM | Added "Dashboard API Endpoint Scope" section explicitly stating other endpoints are out of scope, with rationale that section render checks provide indirect validation. |
| 4 | PII_DETECTION_FAIL_OPEN circuit breaker | LOW | Explicitly out of scope. The circuit breaker is tested by the 62 unit + 24 integration tests in Phase 1. E2E tests focus on user-facing behavior. |

### Risk Reassessments Addressed

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | RISK-001 redakt coupling | HIGH | Added "Post-Merge Hook Decoupling" section. Phase 3 runs independently of redakt. Only Test 6 (warn mode) skips individually when redakt is down. Updated FAIL-001, RISK-001, UX-002, and hook update instructions. |
| 2 | RISK-003 AI endpoint dependency | HIGH | REQ-018 now recommends mocking the AI response for Test 4 (like Test 5) with the live AI test as optional/skippable. |
| 3 | RISK-005 upstream test infra changes | MEDIUM | Acknowledged in existing RISK-005 text. The "Concurrent Execution Guard" documents shared paths. |

### Contradictions Resolved

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Spec says "production config is warn"; codebase default is detect | Fixed. REQ-022 now documents both: codebase default = detect, MemodoAI production = warn (override in .env). Test 6 skips if server is not in warn mode. |
| 2 | "No global teardown" vs "persistent across runs" | Acknowledged as intentional design: test users persist, data accumulates. EDGE-008 already handles this ("accept both populated and empty states"). No change needed. |
| 3 | REQ-027 says "implicit" but uses route interception | Fixed. REQ-027 now includes an explicit static analysis assertion (grep for the constant in config.ts) instead of relying on implicit verification through route interception. |

### Edge Cases Addressed

| # | Finding | Resolution |
|---|---------|------------|
| EDGE-MISSING-2 | Chat UI selectors not specified | Added detailed selectors to REQ-017: `getByTestId('text-input')` for input, Enter key for submit, `waitForResponse` for stream. Noted these are upstream-controlled and documented update guidance. |
| EDGE-MISSING-4 | Session expiry between tests | Added "Session Expiry Handling" section requiring `ensureLoggedIn` in `beforeEach` for every test. |

### Summary

All 7 recommended actions from the critical review have been addressed:
1. [CRITICAL] detect/warn/block terminology -- FIXED throughout spec
2. [CRITICAL] pii_detected vs pii_detection type mismatch -- FIXED with dual-format documentation
3. [HIGH] Phase 3 decoupled from Phase 2 redakt dependency -- ADDED new section
4. [HIGH] Chat input and message area selectors -- ADDED to REQ-017
5. [MEDIUM] Static analysis for EDGE-006 -- ADDED as REQ-029
6. [MEDIUM] AI response mocking for Test 4 -- ADDED recommendation in REQ-018
7. [LOW] Test artifact .gitignore entries -- ADDED section with specifics
