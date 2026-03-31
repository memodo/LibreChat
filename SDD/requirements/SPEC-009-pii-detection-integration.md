# SPEC-009: PII Detection Integration

## Executive Summary

- **Based on Research:** RESEARCH-009-pii-detection-integration.md
- **Creation Date:** 2026-03-31
- **Author:** Claude
- **Status:** Draft

This specification defines an Express middleware that intercepts outbound chat messages, checks them for personally identifiable information (PII) via the external redakt API, and blocks messages containing PII before they reach any AI model. The middleware follows the existing `moderateText.js` pattern and covers all four chat entry points in LibreChat.

## Research Foundation

### Production Issues Addressed

1. **No PII protection exists today.** LibreChat currently sends all user message text directly to AI models without any PII screening, creating GDPR compliance risk for enterprise deployments (Articles 5(1)(c), 25, 32).
2. **Assistant routes lack even content moderation.** The existing `moderateText` middleware is only applied to agent chat routes; assistant chat v1/v2 routes have no content inspection at all.
3. **API-compatible routes bypass all content middleware.** The OpenAI-compatible (`/api/agents/v1/chat/completions`) and Open Responses (`/api/agents/v1/responses`) routes are mounted before JWT auth and skip moderation, rate limiting, and ban checks entirely.
4. **denyRequest persists PII to MongoDB.** When a message is denied, `denyRequest.js:44-54` saves the original user text (including PII) to the database, contradicting the "no PII at rest" principle.

### Stakeholder Validation

- **Product Team:** PII detection is a compliance/GDPR differentiator for MemodoAI; must be opt-in and not degrade latency for non-PII messages.
- **Engineering Team:** Must follow `moderateText.js` middleware pattern; external service dependency requires resilience (fail-open option, circuit breaker).
- **Support Team:** Users need clear, actionable error messages stating which PII entity types were detected (not the values).
- **Security/Compliance Officer:** Requires GDPR article references, documentation of the denyRequest persistence mitigation, and acknowledgment of file upload and multi-turn leakage gaps.
- **DevOps/SRE:** Needs monitoring for redakt health, circuit breaker observability, and a runbook for redakt outages.
- **QA/Testing:** Needs multi-language test corpus (EN, DE), false positive testing with code snippets, and coverage for all four route formats.
- **DPO:** Must validate the detect+block approach and the PII text sanitization mitigation.

### System Integration Points

- `api/server/middleware/moderateText.js` -- Template middleware pattern (feature toggle, text extraction, external API call, denyRequest)
- `api/server/middleware/denyRequest.js:29-54` -- Denial mechanism; saves PII text to MongoDB (must sanitize before calling)
- `api/server/middleware/index.js:15-49` -- Middleware registry (register new middleware here)
- `api/server/routes/agents/chat.js:28` -- Agent chat insertion point (after moderateText)
- `api/server/routes/assistants/chatV1.js:24` -- Assistant v1 insertion point (before validateModel)
- `api/server/routes/assistants/chatV2.js:24` -- Assistant v2 insertion point (before validateModel)
- `api/server/routes/agents/openai.js:55-78` -- OpenAI-compatible API insertion point (after checkRemoteAgentsFeature)
- `api/server/routes/agents/responses.js:58-101` -- Open Responses API insertion point (after checkRemoteAgentsFeature)
- `packages/api/src/utils/common.ts:20` -- `isEnabled()` utility for feature toggle
- `packages/data-provider/src/config.ts:1607` -- `ErrorTypes` enum (add PII_DETECTION type)
- `.env.example` -- Document new environment variables

## Intent

### Problem Statement

LibreChat has no mechanism to prevent users from sending personally identifiable information (PII) to AI models. In enterprise deployments subject to GDPR, this creates compliance risk: user names, email addresses, phone numbers, and other personal data flow unprotected to third-party AI providers. The platform needs a configurable, middleware-based PII detection layer that blocks PII-containing messages before they reach any AI model endpoint.

### Solution Approach

Create a single Express middleware (`api/server/middleware/detectPII.js`) that:
1. Extracts user message text from the request body (handling three different formats across four route types)
2. Sends the text to the external redakt API (`POST /api/detect`) for PII analysis
3. If PII is detected, sanitizes the request body text and denies the request with an informative error message listing detected entity types
4. If no PII is detected, passes the request through to the next middleware
5. Handles redakt unavailability via configurable fail-open/fail-closed behavior with circuit breaker protection

### Expected Outcomes

- All four chat entry points are protected against PII in user messages (when feature is enabled)
- PII-containing messages are blocked before reaching any AI model
- Denied messages do NOT persist PII text to MongoDB (sanitized before denyRequest)
- Users receive clear error messages identifying which PII entity types were detected
- Admins can configure the feature entirely via environment variables
- The system degrades gracefully when the redakt service is unavailable
- Detection adds less than 200ms latency at p99 for warm requests

## Success Criteria

### Functional Requirements

- **REQ-001: Feature toggle.** The middleware is completely disabled when `PII_DETECTION` env var is unset, empty, or `"false"`. When disabled, `next()` is called immediately with zero external calls.
- **REQ-002: PII detection via redakt API.** When enabled, the middleware sends user message text to `POST {PII_DETECTION_API_URL}/api/detect` and blocks the message if the response contains `has_pii: true`.
- **REQ-003: Agent chat route coverage.** The middleware is applied to `POST /api/agents/chat/` after `moderateText` in the middleware chain. This also covers the ephemeral agent chat route (`POST /api/agents/chat/:endpoint`, `agents/chat.js:56`) because both routes share the same router and all `router.use()` middleware applies to both. Verified: `agents/chat.js:28` registers middleware via `router.use(moderateText)` which applies to both `router.post('/', controller)` (line 46) and `router.post('/:endpoint', controller)` (line 56).
- **REQ-004: Assistant chat v1 route coverage.** The middleware is applied to `POST /api/assistants/v1/chat/` before `validateModel`.
- **REQ-005: Assistant chat v2 route coverage.** The middleware is applied to `POST /api/assistants/v2/chat/` before `validateModel`.
- **REQ-006: OpenAI-compatible API route coverage.** The middleware is applied to `POST /api/agents/v1/chat/completions` after `checkRemoteAgentsFeature`, before `checkAgentPermission`.
- **REQ-007: Open Responses API route coverage.** The middleware is applied to `POST /api/agents/v1/responses` after `checkRemoteAgentsFeature`, before `checkAgentPermission`.
- **REQ-008: Text extraction from standard chat format.** The middleware extracts text from `req.body.text` (string) for agent and assistant chat routes.
- **REQ-009: Text extraction from OpenAI-compatible format.** The middleware extracts text from `req.body.messages` by iterating the array, filtering for `role === "user"`, and concatenating content values separated by newlines. For each user message: if `.content` is a string, include it directly; if `.content` is an array of parts, include only parts with `type: "text"` and extract the `.text` field (not `.content`) from each part, since the OpenAI format uses `{type: "text", text: "Hello"}`. Parts are joined with newlines within a message, and messages are joined with newlines between them.
- **REQ-010: Text extraction from Open Responses format.** The middleware extracts text from `req.body.input` -- if string, uses directly; if array, filters for items with `role === "user"` and extracts `.content`.
- **REQ-011: PII text sanitization before denial.** Before calling `denyRequest()` or returning a JSON error, the middleware sanitizes ALL user text fields in the request body to prevent PII persistence. The sanitized replacement string is: `"[Message blocked: PII detected - {entity_types}]"` (e.g., `"[Message blocked: PII detected - PERSON, EMAIL_ADDRESS]"`). Specifically:
  - For standard chat routes: replace `req.body.text` with the sanitized string.
  - For OpenAI-compatible routes: replace the `.content` of each user message in `req.body.messages` with the sanitized string (defense-in-depth; prevents PII persistence if any downstream handler or future error handler persists request body data).
  - For Open Responses routes: replace `req.body.input` (if string) with the sanitized string, or replace the `.content` of each user item in the array with the sanitized string.
  This defense-in-depth approach ensures PII is never available in the request body after denial, regardless of route type or downstream behavior changes.
- **REQ-012: Informative error message.** The error message sent to the user includes the detected entity types as human-readable labels (not actual PII values): "Your message was not sent because it appears to contain personal information ({entityTypes}). Please remove personal details and try again." The middleware maps Presidio entity types to user-friendly labels: `PERSON` -> "names", `EMAIL_ADDRESS` -> "email addresses", `PHONE_NUMBER` -> "phone numbers", `CREDIT_CARD` -> "credit card numbers", `IBAN_CODE` -> "bank account numbers", `US_SSN` -> "social security numbers", `LOCATION` -> "addresses", `IP_ADDRESS` -> "IP addresses". For any unmapped entity type, use the raw Presidio label as a fallback (acceptable for v1).
- **REQ-013: Configurable redakt API URL.** The base URL for the redakt API is configurable via `PII_DETECTION_API_URL` (default: `http://localhost:8000`).
- **REQ-014: Configurable fail-open/fail-closed.** When the redakt API is unavailable (connection error, timeout, 5xx response), behavior is controlled by `PII_DETECTION_FAIL_OPEN`:
  - `false` (default): Message is blocked (fail-closed, for compliance-sensitive deployments).
  - `true`: Message is allowed through with a warning log (fail-open, for availability-first deployments).
- **REQ-015: Configurable timeout.** The redakt API call timeout is configurable via `PII_DETECTION_TIMEOUT` (default: `2000` ms).
- **REQ-016: Optional score threshold.** When `PII_DETECTION_SCORE_THRESHOLD` is set (0.0-1.0), it is passed to the redakt API as `score_threshold` to filter low-confidence detections.
- **REQ-017: Optional allow list.** When `PII_DETECTION_ALLOW_LIST` is set (comma-separated), it is parsed into an array and passed to the redakt API as `allow_list` to skip specific terms.
- **REQ-018: Role-based exemptions.** When `PII_DETECTION_EXEMPT_ROLES` is set (comma-separated role names), users whose `req.user.role` matches any listed role bypass PII detection entirely. Verified: `req.user.role` is available on both JWT-authenticated routes (populated by Passport.js) and API key-authenticated routes (populated by `createRequireApiKeyAuth` in `packages/api/src/apiKeys/middleware.ts:90`, which calls `findUser()` and sets `req.user` to the full `IUser` object, which includes `role?: string` per `packages/data-schemas/src/types/user.ts:13`). If `req.user` or `req.user.role` is undefined (e.g., unauthenticated edge case), the middleware treats the request as non-exempt and proceeds with PII detection.
- **REQ-019: Empty text passthrough.** When the extracted text is undefined, null, empty, or whitespace-only, the middleware calls `next()` without contacting redakt.
- **REQ-020: SSE error response for standard chat routes.** For agent and assistant chat routes (which use SSE streaming), the middleware uses `denyRequest()` / `sendError()` to communicate errors, not `res.json()`. The middleware determines response format using a configuration parameter: when mounting the middleware on each route, pass `{responseFormat: 'sse'}` or `{responseFormat: 'json'}`. This avoids fragile request body sniffing and survives future route changes. Implementation: export a factory function `createDetectPII({responseFormat})` that returns the middleware configured for the correct response format. Alternatively, export the middleware with a `req.piiResponseFormat` property set by a preceding micro-middleware on each route.
- **REQ-021: JSON error response for API routes.** For OpenAI-compatible and Open Responses API routes (which do not use SSE), the middleware returns a standard JSON error response (e.g., `res.status(400).json({error: {message: "...", type: "pii_detected"}})`) instead of SSE-based `denyRequest()`. The response format is determined by the `responseFormat` configuration described in REQ-020, set to `'json'` when mounting the middleware on API routes.
- **REQ-022: Circuit breaker with half-open probe.** If redakt returns errors for 5 consecutive requests, the circuit opens for a 30-second cooldown period. During the cooldown, behavior follows the fail-open/fail-closed configuration (fail-closed: all messages blocked; fail-open: all messages pass through). After the cooldown expires, the circuit enters a **half-open** state: the next incoming request is used as a **probe** -- it is sent to redakt normally. If the probe succeeds, the circuit closes and normal operation resumes. If the probe fails, the circuit re-opens for another 30-second cooldown. All non-probe requests during half-open state continue to follow the fail-open/fail-closed configuration. When the circuit opens, enters half-open, or closes, log at WARN level. **Note:** In fail-closed mode, the circuit breaker provides no user-facing benefit (messages remain blocked) -- it only reduces load on a failing redakt instance. This is an intentional tradeoff for compliance-sensitive deployments that accept chat unavailability over unprotected PII transmission.
- **REQ-023: Middleware registration.** The middleware is exported from and registered in `api/server/middleware/index.js`.
- **REQ-024: ErrorType constant.** A `PII_DETECTION` error type is added to the `ErrorTypes` enum in `packages/data-provider/src/config.ts`.
- **REQ-025: Environment variable documentation.** All `PII_DETECTION_*` env vars are documented in `.env.example` with comments explaining each.
- **REQ-026: Startup health check.** On middleware initialization (first load), if `PII_DETECTION` is enabled, make a single `GET {PII_DETECTION_API_URL}/api/health` call. If it fails, log a WARN-level message: "PII detection is enabled but redakt service is unreachable at {url}. Messages will be [blocked/allowed] per PII_DETECTION_FAIL_OPEN config." Do not block server startup.
- **REQ-027: Language hint configuration.** The `PII_DETECTION_LANGUAGE` env var (default: `"auto"`, options: `"auto"`, `"en"`, `"de"`) controls the `language` parameter sent to the redakt API. When set to `"auto"` (default), redakt uses its built-in language detection. When set to a specific language code, it is passed as the `language` field in the detect request body, optimizing detection accuracy for single-language deployments.
- **REQ-028: API route toggle.** The `PII_DETECTION_API_ROUTES` env var (default: `"true"`) controls whether PII detection is applied to OpenAI-compatible and Open Responses API routes (REQ-006, REQ-007). When `"false"`, the middleware calls `next()` immediately on API routes. This allows operators to enable PII detection for interactive chat while allowing automated API consumers (which may intentionally process PII) to bypass detection. Operators can also use `PII_DETECTION_EXEMPT_ROLES` for per-user API key exemptions.
- **REQ-029: Detection mode env var (future-proofing).** The `PII_DETECTION_MODE` env var (default: `"detect"`) is accepted and validated. In v1, only the value `"detect"` is supported (detect + block). If set to `"anonymize"` or any unsupported value, log an ERROR at startup: "PII_DETECTION_MODE='{value}' is not supported in v1. Only 'detect' is supported. PII detection disabled." and disable the feature. This prepares the upgrade path for v2 anonymize round-trip mode.
- **REQ-030: Structured log fields.** All PII detection log entries use a consistent structured format with the following fields: `{event: "pii_detection", action: "block" | "allow" | "bypass" | "error" | "circuit_open" | "circuit_close" | "circuit_halfopen", entityTypes: [...] | null, entityCount: N | null, latencyMs: N, circuitState: "closed" | "open" | "half-open", route: "agent" | "assistant" | "openai" | "responses"}`. This enables operators to build monitoring dashboards and alerting rules.

### Non-Functional Requirements

- **PERF-001: Warm request latency.** The PII detection middleware adds less than 50ms at p50 and less than 200ms at p99 to the chat request path when the redakt service is warm. (Based on benchmarks: p50 = 7-29ms, p95 = 46-237ms.)
- **PERF-002: No latency when disabled.** When `PII_DETECTION` is not enabled, the middleware adds zero measurable latency (immediate `next()` call, no async operations).
- **PERF-003: Timeout enforcement.** The middleware never blocks a request for longer than `PII_DETECTION_TIMEOUT` ms waiting for redakt.
- **SEC-001: No PII in logs.** The middleware never logs the user's message text, PII values, or anonymization mappings. Only entity type labels, counts, and boolean detection results are logged.
- **SEC-002: No PII persistence on denial.** When a message is denied for PII, all user text fields in the request body are sanitized before denial (per REQ-011), preventing PII from being saved to MongoDB via `denyRequest()` or any other downstream persistence handler.
- **SEC-003: Secure API communication.** The middleware communicates with the redakt API over the configured URL. For production deployments, HTTPS should be used (configurable via `PII_DETECTION_API_URL`).
- **UX-001: Actionable error messages.** Blocked users see which PII entity types were detected using human-readable labels (e.g., "names, email addresses") per REQ-012 entity type mapping, so they can remove the specific information and retry.
- **UX-004: Client-side display of blocked messages.** When a message is blocked for PII, the client displays the sanitized placeholder text (from REQ-011) as the user's message in the conversation. This is acceptable for v1 because: (a) the user has already seen their original text in the input field, (b) showing the original PII-containing text server-side would re-expose it, and (c) the sanitized text provides a clear indication of why the message was blocked. The original user text remains only in the client's local input state and is never persisted.
- **UX-002: No impact when disabled.** When the feature is disabled, there is no user-visible change in behavior.
- **UX-003: Transparent for non-PII messages.** Messages that pass PII detection proceed without any user-visible indication that checking occurred.
- **PERF-004: Cold-start latency awareness.** The first request after redakt has been idle may incur ~230ms latency due to Presidio NLP model loading (research benchmarks). To mitigate: (a) the startup health check (REQ-026) doubles as a warm-up request that triggers model loading, and (b) production deployments should configure Docker/Kubernetes health check probes against `GET /api/health` to keep the service warm. The middleware does not implement its own keep-alive polling -- this is an operational concern.
- **MAINT-001: Single file implementation.** The core middleware logic resides in a single file (`api/server/middleware/detectPII.js`) following the `moderateText.js` pattern for maintainability.

## Edge Cases (Research-Backed)

### Known Production Scenarios

- **EDGE-001: Empty or missing text**
  - Research reference: Production Edge Cases, item 1
  - Current behavior: `moderateText.js` extracts `req.body.text`; if undefined, the moderation API call would fail or behave unpredictably
  - Desired behavior: Middleware calls `next()` immediately when text is undefined, null, empty string, or whitespace-only. No redakt API call is made.
  - Test approach: Unit test with `req.body.text` set to `undefined`, `null`, `""`, and `"   "`.

- **EDGE-002: Very long text (near 512KB limit)**
  - Research reference: Production Edge Cases, item 2; redakt API contract (max 512,000 chars)
  - Current behavior: No text length enforcement exists
  - Desired behavior: Text up to 512,000 characters is sent to redakt normally. If redakt returns a 422 error (validation failure), treat as a service error and follow fail-open/fail-closed config.
  - Test approach: Unit test with text at 512,000 characters and text exceeding 512,000 characters. Verify 422 handling.

- **EDGE-003: Messages with only file attachments (no text)**
  - Research reference: Production Edge Cases, item 3; File Attachments section
  - Current behavior: File references are IDs in the request body; file content is not in `req.body.text`
  - Desired behavior: If `req.body.text` is empty/missing but the request contains file references, call `next()`. File content PII scanning is out of scope for v1.
  - Test approach: Unit test with `req.body.text` undefined and `req.body.files` populated.

- **EDGE-004: OpenAI-compatible format with mixed content types**
  - Research reference: Request Body Structure, OpenAI-compatible section
  - Current behavior: No PII checking on this route
  - Desired behavior: `extractTextForPII(req)` iterates `req.body.messages`, filters `role === "user"`, and for each message: if `.content` is a string, includes it; if `.content` is an array, includes only parts with `type: "text"` and extracts the `.text` field from each part (not `.content`, since the OpenAI format uses `{type: "text", text: "Hello"}`), ignoring `image_url` and other non-text parts. All extracted text is concatenated with newlines (`\n`) for a single redakt API call.
  - Test approach: Unit test with messages containing string content, array content with text parts, array content with mixed text and image parts, and system/assistant messages (which should be excluded).

- **EDGE-005: Open Responses format with string vs array input**
  - Research reference: Request Body Structure, Open Responses section
  - Current behavior: No PII checking on this route
  - Desired behavior: `extractTextForPII(req)` handles both `req.body.input` as a plain string and as an array of items, extracting `.content` from items with `role === "user"`.
  - Test approach: Unit test with `input` as a string and `input` as an array of message items.

- **EDGE-006: Non-English text (German and other languages)**
  - Research reference: Production Edge Cases, item 8
  - Current behavior: No PII checking
  - Desired behavior: redakt supports English and German with auto-detection. The middleware passes text as-is without specifying language (uses redakt's `language: "auto"` default). Other languages may have reduced detection accuracy -- this is a known limitation of the underlying Presidio NLP models, not the middleware.
  - Test approach: Integration test with German text containing PII (e.g., names, addresses). Verify detection works. Document that other languages are best-effort.

- **EDGE-007: Code snippets with PII-like patterns**
  - Research reference: Production Edge Cases, item 9
  - Current behavior: No PII checking
  - Desired behavior: Variable names like `john_smith_email` or test data in code blocks may trigger false positives. The `PII_DETECTION_ALLOW_LIST` env var provides a mechanism to whitelist common false-positive terms. The `PII_DETECTION_SCORE_THRESHOLD` can be raised to reduce low-confidence matches.
  - Test approach: Unit test with code snippets containing PII-like variable names. Verify that allow_list and score_threshold configuration options are passed to redakt correctly.

- **EDGE-008: Concurrent requests (no shared mutable state)**
  - Research reference: Production Edge Cases, item 4
  - Current behavior: N/A
  - Desired behavior: The middleware must not use shared mutable state across requests (no module-level variables that store per-request data). Each request's PII check is independent. The only shared state is the circuit breaker counter, which must be thread-safe (Node.js is single-threaded, so simple counter operations are safe).
  - Test approach: Unit test sending multiple concurrent requests through the middleware; verify no cross-contamination of results.

- **EDGE-009: redakt returns unexpected response schema**
  - Research reference: Production Edge Cases, item 5
  - Current behavior: N/A
  - Desired behavior: If the redakt response does not contain the expected `has_pii` field (or is not valid JSON), treat as a service error and follow fail-open/fail-closed config. Log the unexpected response structure at ERROR level (without logging any text content).
  - Test approach: Unit test with redakt returning malformed JSON, missing `has_pii` field, and non-JSON response body.

- **EDGE-010: Unicode, emoji, and special characters**
  - Research reference: Testing Strategy, Edge Cases, item 3
  - Current behavior: No PII checking
  - Desired behavior: Text with emoji, Unicode characters, RTL text, and special characters is sent to redakt as-is. The middleware does not pre-process or sanitize text before sending to redakt.
  - Test approach: Unit test with text containing emoji, CJK characters, and mixed scripts alongside PII.

## Failure Scenarios

### Graceful Degradation

- **FAIL-001: redakt service not running (ECONNREFUSED)**
  - Trigger condition: redakt container/process is not running; `axios` throws `ECONNREFUSED`
  - Expected behavior: If `PII_DETECTION_FAIL_OPEN=true`, log warning and call `next()`. If `false` (default), deny the request with a generic service error message (not PII-specific, since detection could not run).
  - User communication: Fail-closed: "Message could not be sent: content safety check unavailable. Please try again later." Fail-open: No user-visible indication.
  - Recovery approach: Automatic -- once redakt is restarted, the next request succeeds. Circuit breaker prevents hammering a down service.

- **FAIL-002: redakt API timeout (ETIMEDOUT)**
  - Trigger condition: redakt does not respond within `PII_DETECTION_TIMEOUT` ms (default 2000ms); Presidio NLP processing is slow or service is overloaded
  - Expected behavior: Same as FAIL-001 (follows fail-open/fail-closed config). Timeout counts toward circuit breaker threshold.
  - User communication: Same as FAIL-001.
  - Recovery approach: Automatic. If timeouts persist, circuit breaker opens and bypasses PII checking for cooldown period. Operators should investigate redakt/Presidio performance.

- **FAIL-003: redakt returns 503 (Presidio service unavailable)**
  - Trigger condition: redakt is running but its Presidio analyzer or anonymizer service is down (checked via `/api/health`)
  - Expected behavior: Same as FAIL-001. The 503 status code triggers fail-open/fail-closed behavior. Counts toward circuit breaker.
  - User communication: Same as FAIL-001.
  - Recovery approach: Restart Presidio services. redakt health endpoint (`GET /api/health`) can be used for monitoring.

- **FAIL-004: redakt returns 504 (Presidio timeout)**
  - Trigger condition: Presidio NLP processing exceeds redakt's internal timeout
  - Expected behavior: Same as FAIL-001. Counts toward circuit breaker.
  - User communication: Same as FAIL-001.
  - Recovery approach: Same as FAIL-002.

- **FAIL-005: redakt returns 422 (validation error)**
  - Trigger condition: Request body does not match redakt's expected schema (e.g., text exceeds 512,000 chars, invalid score_threshold value)
  - Expected behavior: Log the error at ERROR level (without logging text content). Follow fail-open/fail-closed config. Does NOT count toward circuit breaker (this is a client-side error, not a service failure).
  - User communication: Same as FAIL-001 in fail-closed mode. In fail-open mode, message passes through.
  - Recovery approach: Fix the middleware's request construction. For text length issues, consider truncating text before sending (future enhancement).

- **FAIL-006: DNS resolution failure**
  - Trigger condition: `PII_DETECTION_API_URL` hostname cannot be resolved
  - Expected behavior: Same as FAIL-001. Counts toward circuit breaker.
  - User communication: Same as FAIL-001.
  - Recovery approach: Fix DNS configuration or `PII_DETECTION_API_URL` value.

- **FAIL-007: Network error (other)**
  - Trigger condition: Any other network error (e.g., connection reset, TLS handshake failure)
  - Expected behavior: Same as FAIL-001. Counts toward circuit breaker.
  - User communication: Same as FAIL-001.
  - Recovery approach: Investigate network connectivity between LibreChat and redakt.

- **FAIL-008: Circuit breaker opens**
  - Trigger condition: 5 consecutive redakt errors (any type counted by circuit breaker: connection, timeout, 5xx)
  - Expected behavior: Circuit breaker opens. For the next 30 seconds, all PII checks are bypassed. Behavior during bypass follows fail-open/fail-closed config. Log at WARN level: "PII detection circuit breaker opened after {n} consecutive failures. PII checking bypassed for {cooldown}s." In fail-closed mode, the circuit breaker provides no user-facing benefit -- it only reduces load on a failing redakt instance (all messages remain blocked). This is an intentional compliance tradeoff.
  - User communication: Fail-closed during circuit open: messages are blocked with service unavailable message. Fail-open during circuit open: messages pass through silently.
  - Recovery approach: After 30-second cooldown, the circuit enters half-open state. The next request is sent to redakt as a probe. If the probe succeeds, the circuit closes and normal operation resumes. If the probe fails, the circuit re-opens for another 30-second cooldown. Non-probe requests during half-open continue to follow fail-open/fail-closed config.

- **FAIL-009: Invalid or unexpected redakt response body**
  - Trigger condition: redakt returns 200 but the response body is not valid JSON or does not contain `has_pii` field
  - Expected behavior: Log at ERROR level with the response status and content type (not the body content if it could contain echoed text). Follow fail-open/fail-closed config.
  - User communication: Same as FAIL-001.
  - Recovery approach: Investigate redakt API version compatibility. The middleware should validate the presence of `has_pii` in the response before acting on it.

## Implementation Constraints

### Context Requirements

Essential files for implementation (with reasons):

| File | Reason |
|------|--------|
| `api/server/middleware/moderateText.js` | Template pattern: feature toggle, text extraction, external API, denyRequest flow |
| `api/server/middleware/denyRequest.js` | Understanding PII persistence issue at lines 44-54; sanitization target |
| `api/server/middleware/index.js` | Registration point for new middleware export |
| `api/server/middleware/error.js` | `sendError()` function used by denyRequest; SSE error format |
| `api/server/routes/agents/chat.js` | Agent chat middleware chain; insertion point at line 28 |
| `api/server/routes/assistants/chatV1.js` | Assistant v1 middleware chain; insertion before line 24 |
| `api/server/routes/assistants/chatV2.js` | Assistant v2 middleware chain; insertion before line 24 |
| `api/server/routes/agents/openai.js` | OpenAI-compatible API; insertion between lines 55-78; `messages` format reference |
| `api/server/routes/agents/responses.js` | Open Responses API; insertion between lines 58-101; `input` format reference |
| `packages/api/src/utils/common.ts` | `isEnabled()` utility at line 20 |
| `packages/data-provider/src/config.ts` | `ErrorTypes` enum at line 1607; add PII_DETECTION type |
| `.env.example` | Document new PII_DETECTION_* environment variables |

### Technical Constraints

1. **SSE vs JSON responses.** Standard chat routes (agent, assistant) use SSE streaming; error responses must use `denyRequest()`/`sendError()`. API routes (OpenAI-compatible, Responses) use standard HTTP; error responses must use `res.status().json()`.
2. **No shared mutable state.** Express middleware runs in a single-threaded event loop. Circuit breaker state (counter, timestamp) can be module-level since Node.js is single-threaded, but must not store per-request data at module level.
3. **axios dependency.** Use the existing `axios` dependency (already in the project). Create a shared axios instance with `baseURL` and `timeout` configuration.
4. **Package rebuild.** If `ErrorTypes` is added to `packages/data-provider/src/config.ts`, the `data-provider` package must be rebuilt (`npm run build:data-provider`) before the backend can reference the new type.
5. **redakt text limit.** The redakt API accepts up to 512,000 characters. LibreChat messages are unlikely to exceed this, but the middleware must handle the 422 error gracefully.
6. **No changes to denyRequest.js.** The PII persistence mitigation is achieved by sanitizing `req.body.text` before calling `denyRequest()`, not by modifying `denyRequest.js` itself. This minimizes changes to existing code.

## Validation Strategy

### Automated Testing

**Unit Tests** (`api/server/middleware/__tests__/detectPII.spec.js`):

1. Feature disabled: `PII_DETECTION` unset/false -- calls `next()`, no axios call
2. Feature disabled: `PII_DETECTION=""` -- calls `next()`, no axios call
3. Empty text: `req.body.text` is `undefined` -- calls `next()`, no axios call
4. Empty text: `req.body.text` is `""` -- calls `next()`, no axios call
5. Empty text: `req.body.text` is whitespace-only -- calls `next()`, no axios call
6. No PII found: redakt returns `{has_pii: false}` -- calls `next()`
7. PII found: redakt returns `{has_pii: true, entities_found: ["PERSON"]}` -- calls `denyRequest()` with PII_DETECTION error type
8. Error message includes human-readable entity types: verify "names, email addresses" appears in error message when PERSON and EMAIL_ADDRESS are detected
9. PII text sanitization (standard chat): when PII is found, verify `req.body.text` is replaced with sanitized string before `denyRequest()` is called
9a. PII text sanitization (OpenAI format): when PII is found on API route, verify `req.body.messages[].content` for user messages is replaced with sanitized string
9b. PII text sanitization (Open Responses format): when PII is found on API route, verify `req.body.input` is replaced with sanitized string
10. Custom API URL: verify axios calls `PII_DETECTION_API_URL` value
11. Score threshold: verify `score_threshold` is included in redakt request body when `PII_DETECTION_SCORE_THRESHOLD` is set
12. Allow list: verify `allow_list` array is included in redakt request body when `PII_DETECTION_ALLOW_LIST` is set
13. Timeout: verify axios timeout is set to `PII_DETECTION_TIMEOUT` value
14. API timeout (fail-closed): simulate axios timeout, verify `denyRequest()` is called
15. API timeout (fail-open): simulate axios timeout with `PII_DETECTION_FAIL_OPEN=true`, verify `next()` is called
16. API connection error (fail-closed): simulate ECONNREFUSED, verify `denyRequest()` is called
17. API connection error (fail-open): simulate ECONNREFUSED with `PII_DETECTION_FAIL_OPEN=true`, verify `next()` is called
18. API 503 error (fail-closed): simulate 503 response, verify `denyRequest()` is called
19. Invalid response (missing has_pii): simulate response without `has_pii` field, verify error handling follows fail config
20. OpenAI-compatible format: `req.body.messages` with user messages -- verify text extraction and PII check
21. OpenAI-compatible format with array content: verify extraction of `.text` field (not `.content`) from parts with `type: "text"`
22. Open Responses format (string input): `req.body.input` as string -- verify text extraction
23. Open Responses format (array input): `req.body.input` as array -- verify extraction of user message content
24. Exempt roles: `PII_DETECTION_EXEMPT_ROLES=admin` with `req.user.role = "admin"` -- verify `next()` called, no redakt call
25. Non-exempt role: `PII_DETECTION_EXEMPT_ROLES=admin` with `req.user.role = "user"` -- verify normal PII check occurs
26. Circuit breaker opens: simulate 5 consecutive errors, verify 6th request bypasses redakt
27. Circuit breaker closes: after cooldown, verify next request calls redakt
28. JSON error response for API routes: verify `res.status(400).json()` is used (not `denyRequest()`) for OpenAI-compatible and Responses routes
29. No PII logging: verify that `logger.error`/`logger.warn` calls never include `req.body.text` or entity values
30. Circuit breaker half-open probe: after cooldown, verify first request is sent to redakt (probe); if probe succeeds, verify circuit closes
31. Circuit breaker half-open probe failure: after cooldown, if probe fails, verify circuit re-opens for another cooldown
32. Language hint: verify `PII_DETECTION_LANGUAGE` value is passed as `language` field in redakt request body
33. API route toggle disabled: with `PII_DETECTION_API_ROUTES=false`, verify `next()` called on OpenAI-compatible route without redakt call
34. Detection mode validation: with `PII_DETECTION_MODE=anonymize`, verify feature disables with error log
35. Startup health check: verify `GET /api/health` is called on first middleware load when feature is enabled
36. Structured log fields: verify PII detection log entries include all fields from REQ-030
37. Exempt role with undefined req.user: verify middleware proceeds with PII detection (non-exempt default)

**Integration Tests:**

1. Agent chat route: full middleware chain with PII middleware in correct position
1a. Ephemeral agent chat route: verify `POST /api/agents/chat/:endpoint` is covered by the same `router.use()` as standard agent chat
2. Assistant chat v1 route: full middleware chain with PII middleware before validateModel
3. Assistant chat v2 route: full middleware chain with PII middleware before validateModel
4. OpenAI-compatible route: full middleware chain with PII middleware in correct position
5. Open Responses route: full middleware chain with PII middleware in correct position
6. SSE error format: verify denyRequest produces correct SSE events for standard chat routes
7. JSON error format: verify JSON error response for API routes

### Manual Verification

1. **Standard chat flow (PII blocked):** Enable PII detection, send a message containing a name and email in the web UI. Verify the message is blocked with an error listing entity types. Verify the message text in MongoDB (via Mongo shell) shows the sanitized string, not the original PII.
2. **Standard chat flow (no PII):** Send a message without PII. Verify it passes through normally with no visible delay.
3. **Feature disabled:** Set `PII_DETECTION=false`. Send a message with PII. Verify it passes through normally.
4. **Fail-open test:** Set `PII_DETECTION_FAIL_OPEN=true`, stop the redakt container. Send a message with PII. Verify it passes through. Check logs for warning.
5. **Fail-closed test:** Set `PII_DETECTION_FAIL_OPEN=false`, stop the redakt container. Send a message. Verify it is blocked with service unavailable error.
6. **API route test:** Use the OpenAI-compatible API endpoint with an API key. Send a messages array containing PII. Verify JSON error response.
7. **Admin exemption test:** Set `PII_DETECTION_EXEMPT_ROLES=admin`. Log in as admin, send PII. Verify it passes through. Log in as regular user, send PII. Verify it is blocked.

### Performance Validation

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Warm request p50 latency | < 50ms added | Measure time between middleware entry and `next()` or `denyRequest()` call across 100 requests |
| Warm request p99 latency | < 200ms added | Same as above |
| Disabled feature overhead | < 1ms | Measure middleware execution time with `PII_DETECTION=false` |
| Circuit breaker bypass latency | < 1ms | Measure middleware execution time when circuit is open |
| Timeout enforcement | Exactly `PII_DETECTION_TIMEOUT` ms max | Simulate a non-responsive server, measure time until middleware returns |

## Dependencies and Risks

### External Dependencies

1. **redakt API service.** The middleware depends on a running redakt instance. redakt wraps Microsoft Presidio for NLP-based PII detection. It must be deployed alongside LibreChat (Docker Compose service or separate host). **Deployment prerequisite:** A Docker Compose service definition for redakt must be created (or documented) as part of this feature's deployment guide. Without it, self-hosted operators must manually deploy and configure redakt, increasing setup friction and error potential. At minimum, add a `redakt` service to `docker-compose.override.yml` with health check configuration.
2. **axios HTTP client.** Already a project dependency. Used for redakt API calls.
3. **Presidio NLP models.** redakt depends on Presidio, which loads spaCy NLP models for entity recognition. Cold-start latency (first request after idle) can reach 230ms due to model loading.

### Identified Risks

- **RISK-001: False positives blocking legitimate messages.**
  - Likelihood: Medium. Code snippets, test data, and common names may trigger false PII detection.
  - Impact: High (user frustration, workflow disruption).
  - Overall severity: **HIGH** (Medium likelihood x High impact).
  - Mitigation: `PII_DETECTION_ALLOW_LIST` for whitelisting terms. `PII_DETECTION_SCORE_THRESHOLD` to raise confidence threshold. `PII_DETECTION_EXEMPT_ROLES` for admin bypass. Clear error messages help users understand what triggered the block.
  - Recommended deployment strategy: Start with a **monitoring-only period** (`PII_DETECTION_FAIL_OPEN=true` with logging) to observe detection patterns and build an initial allow list before switching to fail-closed mode. This reduces the risk of user complaints on initial rollout.

- **RISK-002: redakt service unavailability blocks all chat (fail-closed mode).**
  - Likelihood: Low-Medium (depends on infrastructure reliability).
  - Impact: Critical (all chat is blocked). **Blast radius: In fail-closed mode, redakt downtime is equivalent to a full platform outage for all chat functionality. Every user on the platform is unable to send any message. This is a P0/SEV1 incident.**
  - Mitigation: Circuit breaker limits cascade duration. `PII_DETECTION_FAIL_OPEN` option for availability-first deployments. Health monitoring via `GET /api/health`. Docker Compose health checks and restart policies. Production deployments should run redakt with high availability (multiple replicas, health check restarts, container restart policies).

- **RISK-003: Multi-turn PII leakage (known v1 limitation).**
  - Likelihood: Medium. PII entered before the feature was enabled, or through unprotected routes, persists in conversation history.
  - Impact: Medium (PII reaches AI models via conversation context, not current message).
  - Mitigation: Document as known limitation. Plan context-level scanning for v2. Recommend enabling PII detection early in deployment lifecycle.

- **RISK-004: File upload PII bypass (known v1 limitation).**
  - Likelihood: Low-Medium. Users can upload files containing PII; file content is not checked.
  - Impact: Medium (PII reaches AI models via file processing).
  - Mitigation: Document as known limitation. Plan file content PII scanning for v3 using redakt's document upload endpoint.

- **RISK-005: Added latency to every chat message.**
  - Likelihood: Certain (every message makes an HTTP call to redakt when feature is enabled).
  - Impact: Low for warm requests (benchmarks show 7-29ms p50). **Cold-start impact: the first request after redakt has been idle can reach ~230ms due to Presidio NLP model loading.** If redakt is configured with aggressive container scaling (scale-to-zero), every burst of chat after idle periods will incur cold-start latency.
  - Mitigation: 2-second timeout cap. Circuit breaker prevents latency spikes during outages. Feature can be disabled if latency is unacceptable. Cold-start mitigation: the startup health check (REQ-026) warms the NLP models on LibreChat start. Production deployments should configure health check probes to keep redakt warm (see PERF-004).

- **RISK-006: DPIA may be required before production deployment.**
  - Likelihood: Medium (depends on organizational compliance posture).
  - Impact: Medium (could delay deployment timeline).
  - Mitigation: Consult the DPO early in the implementation phase. A Data Protection Impact Assessment (DPIA) may be required for the PII detection feature itself, as it involves automated processing of personal data for compliance purposes. The DPIA should be initiated in parallel with implementation, not sequentially after it.

- **RISK-007: PII detection accuracy varies by language.**
  - Likelihood: Medium. Presidio's NLP models are optimized for English; German support exists but other languages have reduced accuracy.
  - Impact: Low-Medium (PII in unsupported languages may not be detected).
  - Mitigation: Document language support limitations. Auto-detection handles EN/DE well. Future Presidio model updates may improve coverage.

## Implementation Notes

### Suggested Approach

**Step 1: Create the middleware file.**
Create `api/server/middleware/detectPII.js` following `moderateText.js` as a template. Key structure:

```javascript
const axios = require('axios');
const { isEnabled } = require('~/server/utils');
const { logger } = require('~/config');
const denyRequest = require('./denyRequest');

// Circuit breaker state (module-level, safe in single-threaded Node.js)
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let circuitState = 'closed'; // 'closed' | 'open' | 'half-open'
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30000;

// Entity type label mapping (REQ-012)
const ENTITY_LABELS = {
  PERSON: 'names', EMAIL_ADDRESS: 'email addresses',
  PHONE_NUMBER: 'phone numbers', CREDIT_CARD: 'credit card numbers',
  IBAN_CODE: 'bank account numbers', US_SSN: 'social security numbers',
  LOCATION: 'addresses', IP_ADDRESS: 'IP addresses',
};

function extractTextForPII(req) { /* ... */ }
function sanitizeRequestBody(req, sanitizedText) { /* sanitize all text fields per REQ-011 */ }

// Factory function for route-specific response format (REQ-020)
function createDetectPII({ responseFormat = 'sse' } = {}) {
  return async function detectPII(req, res, next) { /* ... */ };
}

module.exports = { createDetectPII };
```

**Step 2: Implement `extractTextForPII(req)` helper.**
Handle three formats:
1. `req.body.text` (string) -- standard chat routes
2. `req.body.messages` (array) -- OpenAI-compatible: filter `role === "user"`, for each message: if `.content` is string, include it; if `.content` is array, extract `.text` field from parts with `type: "text"`. Join all with newlines.
3. `req.body.input` (string or array) -- Open Responses: if string, return directly; if array, filter `role === "user"`, extract `.content`

Return `null` if no text found (triggers passthrough).

**Step 3: Implement the main middleware logic.**
1. Validate `PII_DETECTION_MODE` on first load -- if unsupported, log ERROR and disable feature
2. Check `isEnabled(process.env.PII_DETECTION)` -- return `next()` if disabled
3. Check `PII_DETECTION_API_ROUTES` -- if `false` and route is API type, return `next()`
4. Check exempt roles -- return `next()` if `req.user?.role` matches exempt list (default to non-exempt if `req.user` is undefined)
5. Extract text via `extractTextForPII(req)` -- return `next()` if null/empty/whitespace
6. Check circuit breaker -- if open, follow fail config; if half-open, allow first request through as probe
7. Call `POST {PII_DETECTION_API_URL}/api/detect` with axios (timeout, score_threshold, allow_list, language from `PII_DETECTION_LANGUAGE`)
8. On success with `has_pii: true`: sanitize ALL user text fields in request body (per REQ-011), use configured `responseFormat` to deny the request
9. On success with `has_pii: false`: reset circuit breaker counter (close circuit if half-open), call `next()`
10. On error: increment circuit breaker counter (re-open if half-open probe), follow fail-open/fail-closed config
11. Log structured fields per REQ-030 for every PII detection action

**Step 4: Register the middleware.**
Add export to `api/server/middleware/index.js`.

**Step 5: Insert into route files.**
Add `detectPII` to the middleware chains of all four route groups at the positions specified in REQ-003 through REQ-007.

**Step 6: Add ErrorType.**
Add `PII_DETECTION` to `ErrorTypes` in `packages/data-provider/src/config.ts`. Rebuild the data-provider package.

**Step 7: Document env vars.**
Add all `PII_DETECTION_*` variables to `.env.example` with descriptive comments.

**Step 8: Write tests.**
Create `api/server/middleware/__tests__/detectPII.spec.js` with all unit tests listed in the Validation Strategy. Mock axios for all external calls.

### Critical Implementation Considerations

1. **Text extraction must handle all three formats.** The `extractTextForPII(req)` function is the key abstraction. It must correctly handle string content, array-of-parts content (OpenAI format), and the input field (Responses format). Missing a format means PII bypasses detection on that route.

2. **Sanitize `req.body.text` BEFORE calling `denyRequest()`.** This is the most critical implementation detail. `denyRequest.js:44-54` saves `req.body.text` to MongoDB. The middleware must replace `req.body.text` with the sanitized string (e.g., `"[Message blocked: PII detected - PERSON, EMAIL_ADDRESS]"`) before calling `denyRequest()`. For API routes that use `messages` or `input` instead of `text`, the same sanitization principle applies -- replace the user content in the request body before any persistence occurs.

3. **Route type detection for error response format.** The middleware uses a factory function `createDetectPII({responseFormat})` (per REQ-020) rather than sniffing the request body. Each route mounts the middleware with the correct `responseFormat` parameter (`'sse'` for standard chat routes, `'json'` for API routes). This avoids fragile body-field detection and survives future route changes.

4. **Circuit breaker 422 exclusion.** HTTP 422 errors from redakt indicate a client-side issue (bad request body), not a service failure. These should NOT count toward the circuit breaker threshold. Only connection errors, timeouts, and 5xx responses should count.

5. **Logging discipline.** Every `logger.error()` and `logger.warn()` call must be reviewed to ensure no PII text is included. Log entity types, counts, error codes, and latency -- never message content.

6. **Multi-turn PII leakage is a known v1 limitation.** The middleware only checks the current inbound message, not conversation history loaded from MongoDB. This is consistent with `moderateText.js` behavior. Document this limitation and plan context-level scanning for v2.

7. **File upload PII bypass is a known v1 limitation.** File content is not available in the chat `req.body`. File PII scanning requires a separate integration point at the file upload route. Document and defer to v3.
