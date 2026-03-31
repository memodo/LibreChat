# Code Review: PII Detection Integration

**Feature:** SPEC-009 PII Detection Integration
**Date:** 2026-03-31
**Branch:** `feature/008-admin-reporting-dashboard`
**Reviewer:** Claude (specification-driven code review)

## Artifact Verification

- [x] RESEARCH-009 found and complete (`SDD/research/RESEARCH-009-pii-detection-integration.md`)
- [x] SPEC-009 found and complete (`SDD/requirements/SPEC-009-pii-detection-integration.md`)
- [x] PROMPT-009 files preserved (`SDD/prompts/PROMPT-009-pii-detection-integration-2026-03-31.md`)
- [x] Context utilization <40% (PROMPT-009 shows controlled file set, implementation in single middleware file)

## Specification Alignment (70%)

### Requirements Coverage

| REQ | Description | Status | Notes |
|-----|-------------|--------|-------|
| REQ-001 | Feature toggle (`PII_DETECTION` env var) | PASS | `detectPII.js:224` checks `isEnabled(process.env.PII_DETECTION)` |
| REQ-002 | PII detection via redakt API `POST /api/detect` | PASS | `detectPII.js:322` calls `axios.post(...'/api/detect'...)` |
| REQ-003 | Agent chat route coverage (after `moderateText`) | PASS | `agents/chat.js:30` - `router.use(createDetectPII({responseFormat: 'sse'}))` after `router.use(moderateText)` at line 29 |
| REQ-004 | Assistant chat v1 route (before `validateModel`) | PASS | `assistants/chatV1.js:27` - `createDetectPII({responseFormat: 'sse'})` before `validateModel` at line 28 |
| REQ-005 | Assistant chat v2 route (before `validateModel`) | PASS | `assistants/chatV2.js:27` - identical structure to chatV1 |
| REQ-006 | OpenAI-compatible API route | PASS | `agents/openai.js:78` - `createDetectPII({responseFormat: 'json', isApiRoute: true})` after `checkRemoteAgentsFeature` (line 55), before `checkAgentPermission` |
| REQ-007 | Open Responses API route | PASS | `agents/responses.js:101` - `createDetectPII({responseFormat: 'json', isApiRoute: true})` after `checkRemoteAgentsFeature` (line 58), before `checkAgentPermission` |
| REQ-008 | Text extraction from standard chat format | PASS | `detectPII.js:55-57` checks `typeof body.text === 'string'` |
| REQ-009 | Text extraction from OpenAI-compatible format | PASS | `detectPII.js:60-78` iterates `body.messages`, filters `role === 'user'`, handles string and array content, extracts `.text` from `type: 'text'` parts |
| REQ-010 | Text extraction from Open Responses format | PASS | `detectPII.js:81-93` handles both string and array `body.input` |
| REQ-011 | PII text sanitization before denial | PASS | `detectPII.js:351-352` sanitizes before denyRequest/JSON response; `sanitizeRequestBody()` at lines 103-132 covers all 3 formats |
| REQ-012 | Human-readable entity type labels | PASS | `detectPII.js:22-31` maps all 8 Presidio types; `mapEntityLabels()` at line 38 with fallback to raw label |
| REQ-013 | Configurable redakt API URL | PASS | `detectPII.js:193` reads `PII_DETECTION_API_URL` with default `http://localhost:8000` |
| REQ-014 | Configurable fail-open/fail-closed | PASS | `detectPII.js:261` reads `PII_DETECTION_FAIL_OPEN`; `handleServiceError()` at lines 490-505 handles fail-closed |
| REQ-015 | Configurable timeout | PASS | `detectPII.js:194` reads `PII_DETECTION_TIMEOUT` with default 2000; passed to axios at line 325 |
| REQ-016 | Optional score threshold | PASS | `detectPII.js:304-307` includes `score_threshold` when set |
| REQ-017 | Optional allow list | PASS | `detectPII.js:310-313` parses comma-separated `PII_DETECTION_ALLOW_LIST` into array |
| REQ-018 | Role-based exemptions | PASS | `detectPII.js:238-251` checks `req.user?.role` against `PII_DETECTION_EXEMPT_ROLES` with case-insensitive matching |
| REQ-019 | Empty text passthrough | PASS | `detectPII.js:257-259` checks `!text || !text.trim()` |
| REQ-020 | SSE error response for standard chat routes | PASS | `detectPII.js:377-384` uses `denyRequest()` when `responseFormat === 'sse'` (factory pattern) |
| REQ-021 | JSON error response for API routes | PASS | `detectPII.js:369-376` returns `res.status(400).json({error: {message, type: 'pii_detected'}})` |
| REQ-022 | Circuit breaker with half-open probe | PASS | Full implementation at lines 264-298 (open/half-open check), 354-366 (close on success), 425-452 (re-open on failure). Threshold=5, cooldown=30s |
| REQ-023 | Middleware registration in index.js | PASS | `middleware/index.js:16` imports, line 38 exports `createDetectPII` |
| REQ-024 | ErrorType constant `PII_DETECTION` | PASS | `config.ts:1687` adds `PII_DETECTION = 'pii_detection'` to ErrorTypes enum |
| REQ-025 | Environment variable documentation | PASS | `.env.example:417-445` documents all 9 `PII_DETECTION_*` vars with descriptive comments |
| REQ-026 | Startup health check | PASS | `detectPII.js:157-183` - `performHealthCheck()` calls `GET /api/health`, non-blocking, fires on first `createDetectPII()` call (lines 210-212) |
| REQ-027 | Language hint configuration | PASS | `detectPII.js:316-319` reads `PII_DETECTION_LANGUAGE`, omits when `'auto'`, includes in request body otherwise |
| REQ-028 | API route toggle | PASS | `detectPII.js:228-236` checks `isApiRoute && !isEnabled(PII_DETECTION_API_ROUTES ?? 'true')` |
| REQ-029 | Detection mode validation | PASS | `detectPII.js:197-207` validates on first load, disables if mode !== 'detect', checked at line 219-221 |
| REQ-030 | Structured log fields | PASS | All logger calls include `{event, action, circuitState, route}` and contextual fields (`entityTypes`, `entityCount`, `latencyMs`) as specified |

**Requirements Score: 30/30 (100%)**

### Edge Case Coverage

| EDGE | Description | Handled | Tested | Notes |
|------|-------------|---------|--------|-------|
| EDGE-001 | Empty or missing text | PASS | PASS | Tests 3, 4, 5 cover `undefined`, `""`, whitespace |
| EDGE-002 | Very long text (512KB) | PASS | PARTIAL | Handled via FAIL-005 (422 error path), but no explicit test with large text |
| EDGE-003 | File attachments only (no text) | PASS | PASS | Covered by empty text passthrough (Test 3) |
| EDGE-004 | OpenAI mixed content types | PASS | PASS | Test 21 verifies array content with text + image_url parts |
| EDGE-005 | Open Responses string vs array | PASS | PASS | Tests 22 (string), 23 (array) |
| EDGE-006 | Non-English text | PASS | PASS | Test 32 verifies language hint (`de`) passed to redakt |
| EDGE-007 | Code snippets with PII-like patterns | PASS | PASS | Tests 11 (score_threshold), 12 (allow_list) verify config options passed correctly |
| EDGE-008 | Concurrent requests | PASS | N/A | Only circuit breaker is shared (safe in single-threaded Node.js); no per-request module state |
| EDGE-009 | Unexpected response schema | PASS | PASS | Test 19 verifies missing `has_pii` handling |
| EDGE-010 | Unicode/emoji/special chars | PASS | N/A | Text passed to redakt as-is; no pre-processing |

**Edge Case Score: 10/10 handled, 8/10 tested**

### Failure Scenario Coverage

| FAIL | Description | Handled | Tested | Notes |
|------|-------------|---------|--------|-------|
| FAIL-001 | ECONNREFUSED | PASS | PASS | Tests 16 (fail-closed), 17 (fail-open) |
| FAIL-002 | ETIMEDOUT | PASS | PASS | Tests 14 (fail-closed), 15 (fail-open) |
| FAIL-003 | 503 response | PASS | PASS | Test 18 |
| FAIL-004 | 504 response | PASS | N/A | Same error handling path as 503 (any non-422 error) |
| FAIL-005 | 422 validation error | PASS | N/A | `detectPII.js:420` checks `status === 422` to exclude from circuit breaker; no dedicated test for 422 |
| FAIL-006 | DNS resolution failure | PASS | N/A | Same error handling path as ECONNREFUSED |
| FAIL-007 | Other network errors | PASS | N/A | Catch-all in the try/catch block |
| FAIL-008 | Circuit breaker opens | PASS | PASS | Test 26 verifies 6th request bypasses redakt |
| FAIL-009 | Invalid response body | PASS | PASS | Test 19 verifies missing `has_pii` handling |

**Failure Scenario Score: 9/9 handled, 6/9 tested**

## Context Engineering (20%)

### PROMPT-009 Review

The PROMPT file at `SDD/prompts/PROMPT-009-pii-detection-integration-2026-03-31.md` is thorough and well-structured:

- **Traceability**: Every REQ, EDGE, and FAIL is mapped to specific file:line references in the implementation
- **Requirements table**: Complete 30/30 REQ mapping with status and location
- **Edge case table**: 10/10 mapped with test references
- **Failure scenario table**: 9/9 mapped with test references
- **Technical decisions log**: Documents 5 key implementation decisions with rationale (factory function pattern, fire-and-forget health check, circuit breaker reset for testing, sanitize-before-deny, language auto omission)
- **Test count**: 47 tests (37 spec + 10 additional helper unit tests)

The PROMPT file serves as effective traceability documentation from spec to implementation.

### Context Efficiency

The implementation is contained in a single middleware file (`detectPII.js`, 519 lines) plus minimal changes to 7 existing files (route insertions, middleware registry, ErrorType enum, env docs). This is clean context usage.

**Context Engineering Score: PASS**

## Test Coverage (10%)

### Spec-Required Tests (37 total)

| Spec Test | Test File | Status | Notes |
|-----------|-----------|--------|-------|
| 1. Feature disabled (unset/false) | Test 1 | PASS | |
| 2. Feature disabled (empty string) | Test 2 | PASS | |
| 3. Empty text (undefined) | Test 3 | PASS | |
| 4. Empty text (empty string) | Test 4 | PASS | |
| 5. Empty text (whitespace) | Test 5 | PASS | |
| 6. No PII found | Test 6 | PASS | |
| 7. PII found | Test 7 | PASS | |
| 8. Human-readable entity labels | Test 8 | PASS | |
| 9. PII text sanitization (standard) | Test 9 | PASS | |
| 9a. PII text sanitization (OpenAI) | Test 9a | PASS | |
| 9b. PII text sanitization (Responses) | Test 9b | PASS | |
| 10. Custom API URL | Test 10 | PASS | |
| 11. Score threshold | Test 11 | PASS | |
| 12. Allow list | Test 12 | PASS | |
| 13. Timeout | Test 13 | PASS | |
| 14. API timeout (fail-closed) | Test 14 | PASS | |
| 15. API timeout (fail-open) | Test 15 | PASS | |
| 16. Connection error (fail-closed) | Test 16 | PASS | |
| 17. Connection error (fail-open) | Test 17 | PASS | |
| 18. API 503 error | Test 18 | PASS | |
| 19. Invalid response | Test 19 | PASS | |
| 20. OpenAI format extraction | Test 20 | PASS | |
| 21. OpenAI array content | Test 21 | PASS | |
| 22. Open Responses string input | Test 22 | PASS | |
| 23. Open Responses array input | Test 23 | PASS | |
| 24. Exempt roles | Test 24 | PASS | |
| 25. Non-exempt role | Test 25 | PASS | |
| 26. Circuit breaker opens | Test 26 | PASS | |
| 27. Circuit breaker closes | Test 27 | PASS | Uses `resetCircuitBreaker()` rather than time simulation |
| 28. JSON error response | Test 28 | PASS | |
| 29. No PII in logs | Test 29 | PASS | |
| 30. Half-open probe success | Test 30 | PASS | Uses `Date.now` mock for time simulation |
| 31. Half-open probe failure | Test 31 | PASS | Uses `Date.now` mock for time simulation |
| 32. Language hint | Test 32 | PASS | |
| 33. API route toggle disabled | Test 33 | PASS | |
| 34. Detection mode validation | Test 34 | PASS | |
| 35. Startup health check | Test 35 | PASS | |
| 36. Structured log fields | Test 36 | PASS | |
| 37. Exempt role with undefined req.user | Test 37 | PASS | |

### Additional Tests (10)

The test file includes 10 additional unit tests for the `extractTextForPII` and `sanitizeRequestBody` helper functions beyond the spec requirements, providing good coverage of the internal APIs.

**Test Score: 37/37 spec tests present + 10 bonus helper tests = PASS**

## Issues Found

### Minor Issues (non-blocking)

1. **Test 27 uses `resetCircuitBreaker()` instead of time simulation.** The test for "circuit breaker closes after cooldown" resets all state instead of verifying the actual cooldown/half-open transition via time passage. Tests 30 and 31 do use `Date.now` mocking correctly, making Test 27 somewhat redundant rather than testing the actual cooldown flow. However, the half-open behavior is adequately tested by Tests 30-31.

2. **FAIL-005 (422 error) has no dedicated test.** While the code at `detectPII.js:420` correctly excludes 422 from the circuit breaker counter, there is no unit test that sends a 422 response and verifies: (a) it follows fail-open/fail-closed config, and (b) it does NOT increment the circuit breaker counter. This is a gap in test coverage.

3. **EDGE-002 (very long text) has no dedicated test.** The spec calls for a test with text at 512,000 characters. The handling exists via the 422 error path, but no explicit test exercises it.

4. **`handleServiceError` service-unavailable message for SSE routes.** At `detectPII.js:503`, the fail-closed SSE path calls `denyRequest(req, res, errorMsg)` where `errorMsg` is a plain string. The spec (REQ-020) pattern for SSE routes uses an object `{type, message}` when PII is detected (line 378-383), but the service-unavailable path passes a raw string. This inconsistency means the client may display the error differently for service-unavailable vs PII-detected denials. While `denyRequest` accepts both formats, the PII_DETECTION ErrorType is not used for service errors, which is reasonable since the error is not about PII detection results.

5. **Import path difference from spec suggestion.** The spec suggests `const { isEnabled } = require('~/server/utils')` but the implementation uses `require('@librechat/api')`. This is correct -- the `isEnabled` utility was moved to the `@librechat/api` package. The `logger` import similarly uses `@librechat/data-schemas` rather than `~/config`. These are correct for the current codebase.

## Decision: APPROVED

The implementation is a thorough, specification-compliant PII detection middleware. All 30 functional requirements are correctly implemented. All 10 edge cases are handled. All 9 failure scenarios are handled. All 37 spec-required tests are present and correctly structured. The factory function pattern, circuit breaker with half-open probe, three-format text extraction, and defense-in-depth sanitization are all well-implemented.

## Commendations

- **Excellent spec-to-code traceability.** The PROMPT file maps every requirement to exact file:line references, making future maintenance straightforward.
- **Defense-in-depth sanitization.** The `sanitizeRequestBody()` function sanitizes ALL three request body formats before any denial, not just the format being processed. This prevents PII leakage regardless of downstream handler behavior.
- **Clean factory function pattern.** The `createDetectPII({responseFormat, isApiRoute})` pattern avoids fragile request-body sniffing and makes route configuration explicit and readable.
- **Comprehensive circuit breaker.** The three-state (closed/open/half-open) circuit breaker with proper probe logic, 422 exclusion, and structured logging is production-grade.
- **No PII in logs.** Test 29 verifies that no PII values appear in any logger calls -- a critical security requirement that is often overlooked.
- **Single-file implementation.** Keeping all middleware logic in one 519-line file (with clear helper functions) follows the `moderateText.js` pattern and keeps the blast radius small.

## Recommended Follow-ups (non-blocking)

1. Add a dedicated test for FAIL-005 (422 response handling and circuit breaker exclusion).
2. Add a dedicated test for EDGE-002 (text near/exceeding 512KB limit).
3. Consider adding a FAIL-004 test (504 response) for completeness, even though it shares the same code path as 503.

## Findings Addressed (2026-03-31)

All recommended follow-ups and minor issues from this review have been resolved:

### Minor Issue #1: Test 27 uses `resetCircuitBreaker()` instead of time simulation
- **Resolution**: Test 27 (`detectPII.spec.js:554`) rewritten to use `Date.now` mocking (same approach as Tests 30-31), verifying actual cooldown-to-half-open-to-closed transition.

### Minor Issue #2: FAIL-005 (422 error) has no dedicated test
- **Resolution**: Test 38 (`detectPII.spec.js`) added. Simulates 422 response from redakt, verifies circuit breaker counter is NOT incremented (circuit stays at 4/5 failures, next request still reaches redakt).

### Minor Issue #3: EDGE-002 (very long text) has no dedicated test
- **Resolution**: Tests 40 and 41 (`detectPII.spec.js`) added. Test 40 sends 512K characters and verifies they reach redakt. Test 41 simulates a 422 response for oversized text and verifies circuit breaker exclusion.

### Minor Issue #4: `handleServiceError` sends plain string to `denyRequest`
- **Resolution**: `handleServiceError` at `detectPII.js:530-533` now passes a structured error object `{type: 'pii_service_unavailable', message: ...}` to `denyRequest`, matching the pattern used for PII detection denials.

### Additional improvements applied from CRITICAL-IMPL review:
- Multi-field extraction bypass fixed (`detectPII.js:51-96`): `extractTextForPII` now concatenates text from ALL present body fields instead of short-circuiting on first match.
- Half-open circuit breaker probe guard added (`detectPII.js:11`): `probeInFlight` flag ensures only one request probes redakt during half-open state.
- Score threshold validation added (`detectPII.js:333-342`): Invalid `PII_DETECTION_SCORE_THRESHOLD` values (NaN, out of 0-1 range) are logged and ignored.
- Process-local circuit breaker documented as known limitation (`detectPII.js:8-10`).
- 9 new tests added (Tests 38-46), bringing total to 57 tests (46 integration + 11 unit).
