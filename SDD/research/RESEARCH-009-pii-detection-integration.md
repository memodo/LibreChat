# RESEARCH-009: PII Detection Integration

**Date**: 2026-03-31
**Updated**: 2026-03-31 (post-critical-review revision addressing all findings)
**Status**: COMPLETE (REVISED)
**Branch**: `feature/008-admin-reporting-dashboard` (to be moved to dedicated branch for implementation)
**Builds On**: Independent feature; follows moderateText.js middleware pattern

## Research Question

How should the redakt PII detection/anonymization API be integrated into LibreChat's chat lifecycle as Express middleware, following the existing `moderateText.js` pattern?

---

## System Data Flow

### Key Entry Points

All user chat messages enter LibreChat through **four** route groups:

1. **Agent chat**: `api/server/routes/agents/chat.js:46` -- `POST /api/agents/chat/`
   - Middleware chain (line 28-32): `moderateText` -> `checkAgentAccess` -> `checkAgentResourceAccess` -> `validateConvoAccess` -> `buildEndpointOption`
   - `moderateText` is the **first** middleware after auth/rate-limiting (auth applied in parent router at `api/server/routes/agents/index.js:41-43`)
   - Rate limiting applied conditionally at `api/server/routes/agents/index.js:314-319`

2. **Assistant chat v1/v2**: `api/server/routes/assistants/chatV1.js:24-32` and `chatV2.js:24-32`
   - Middleware chain: `validateModel` -> `buildEndpointOption` -> `validateAssistant` -> `validateConvoAccess` -> `setHeaders` -> `chatController`
   - **moderateText is NOT applied** to assistant routes (this is a gap in the existing moderation)

3. **OpenAI-compatible API**: `api/server/routes/agents/openai.js:78` -- `POST /api/agents/v1/chat/completions`
   - Middleware chain (openai.js:53-55): `requireApiKeyAuth` -> `configMiddleware` -> `checkRemoteAgentsFeature` -> `checkAgentPermission` -> `OpenAIChatCompletionController`
   - Mounted in `agents/index.js:39` **before** `requireJwtAuth` (line 41) -- uses API key auth, NOT JWT
   - **Request body uses `req.body.messages` (array of message objects with `.content` fields), NOT `req.body.text`**
   - No `moderateText` or any content-inspecting middleware applied
   - Text extraction requires iterating `messages` array and extracting `.content` from each (can be string or array of content parts)

4. **Open Responses API**: `api/server/routes/agents/responses.js:101` -- `POST /api/agents/v1/responses`
   - Middleware chain (responses.js:56-58): `requireApiKeyAuth` -> `configMiddleware` -> `checkRemoteAgentsFeature` -> `checkAgentPermission` -> `createResponse`
   - Mounted in `agents/index.js:33` **before** `requireJwtAuth` (line 41) -- uses API key auth, NOT JWT
   - **Request body uses `req.body.input` (string or array of input items), NOT `req.body.text`**
   - No `moderateText` or any content-inspecting middleware applied
   - Text extraction: if `input` is a string, use directly; if array, extract `.content` from items with `role: "user"`

### API Route Authentication Boundary

Routes 3 and 4 are mounted in `agents/index.js` at lines 33 and 39, **before** the JWT auth middleware at line 41. This means they operate in a separate authentication context (API key based) and bypass the entire standard middleware chain including rate limiters, `checkBan`, and `moderateText`. Any PII middleware added only to the chatRouter (route 1) or assistant routes (route 2) will NOT protect these API routes.

**Design Decision Required**: Whether PII detection applies to API-compatible routes. Options:
- **Option A**: Apply PII detection to all four routes (strongest protection, but requires text extraction adapters for different request formats)
- **Option B**: Apply only to interactive chat routes (1 and 2), explicitly document that API routes are unprotected (simpler, but creates a bypass)
- **Option C**: Apply to all routes but make API routes configurable separately (e.g., `PII_DETECTION_API_ROUTES=true`)

**Recommendation**: Option A for compliance-sensitive deployments. The PII middleware needs a text extraction function that handles three formats: `req.body.text` (string), `req.body.messages` (array), and `req.body.input` (string or array).

### Parent Router Middleware (applied before chat routes)

**Agents** (`api/server/routes/agents/index.js:41-44`):
- `requireJwtAuth` -> `checkBan` -> `uaParser`
- Then `configMiddleware` on the chatRouter sub-router (line 312)
- Then conditional `messageIpLimiter` / `messageUserLimiter` (lines 314-319)

**Assistants** (`api/server/routes/assistants/index.js:10-13`):
- `requireJwtAuth` -> `checkBan` -> `uaParser` -> `configMiddleware`

### Data Transformations

The user's message text is available as `req.body.text` (string). This is confirmed by:
- `api/server/middleware/moderateText.js:12` -- `const { text } = req.body;`
- `api/server/middleware/denyRequest.js:29` -- `const { messageId, conversationId: _convoId, parentMessageId, text } = req.body;`

The request body also contains: `messageId`, `conversationId`, `parentMessageId`, `endpoint`, `endpointType`, and model configuration fields.

### External Dependencies

- **redakt API**: FastAPI service wrapping Microsoft Presidio
  - Local: `http://localhost:8000`
  - Production: `https://redakt.memodo-eng.de`
  - Health check: `GET /api/health` (checks Presidio analyzer + anonymizer)
  - Detect: `POST /api/detect`
  - Anonymize: `POST /api/anonymize`
  - Deanonymize: `POST /api/deanonymize`

### Integration Points

The PII middleware should be inserted at the same position as `moderateText` -- as the **first content-inspecting middleware** after authentication and rate limiting, before any AI model interaction occurs.

---

## redakt API Contract

### POST /api/detect

Checks if text contains PII without modifying it.

**Request:**
```json
{
  "text": "string (required, max 512,000 chars)",
  "language": "string (default: 'auto')",
  "score_threshold": "number 0.0-1.0 (optional)",
  "entities": ["PERSON", "EMAIL_ADDRESS", ...] // optional filter
  "allow_list": ["CompanyName", ...] // optional, terms to skip
}
```

**Query parameter:** `?verbose=true` returns per-entity position details.

**Response (standard):**
```json
{
  "has_pii": true,
  "entity_count": 2,
  "entities_found": ["PERSON", "LOCATION"],
  "language_detected": "en",
  "language_confidence": 0.98
}
```

**Response (verbose, `?verbose=true`):**
```json
{
  "has_pii": true,
  "entity_count": 2,
  "entities_found": ["PERSON", "LOCATION"],
  "language_detected": "en",
  "language_confidence": 0.98,
  "details": [
    {"entity_type": "PERSON", "start": 0, "end": 10, "score": 0.85},
    {"entity_type": "LOCATION", "start": 20, "end": 26, "score": 0.85}
  ]
}
```

**Error responses:**
- `422` -- Validation error (bad request body), `{"detail": [...]}`
- `503` -- Presidio service unavailable, `{"detail": "..."}`
- `504` -- Presidio timeout, `{"detail": "..."}`

### POST /api/anonymize

Replaces PII with numbered placeholders and returns a mapping for later deanonymization.

**Request:**
```json
{
  "text": "string (required, max 512,000 chars)",
  "language": "string (default: 'auto')",
  "score_threshold": "number 0.0-1.0 (optional)",
  "entities": ["PERSON", ...] // optional
  "allow_list": ["term", ...] // optional
}
```

**Response:**
```json
{
  "anonymized_text": "Contact <PERSON_1> at <EMAIL_ADDRESS_1>",
  "mappings": {
    "<PERSON_1>": "John Smith",
    "<EMAIL_ADDRESS_1>": "john@example.com"
  },
  "language_detected": "en",
  "language_confidence": 0.98
}
```

### POST /api/deanonymize

Restores original values in text using a mapping from a prior anonymize call.

**Request:**
```json
{
  "text": "string (required, max 512,000 chars)",
  "mappings": {"<PERSON_1>": "John Smith", ...}
}
```

**Response:**
```json
{
  "text": "John Smith has been notified.",
  "replacements_made": 1
}
```

### GET /api/health

**Response:**
```json
{
  "status": "healthy",
  "presidio_analyzer": "healthy",
  "presidio_anonymizer": "healthy"
}
```

### GET /api/health/live

Always returns 200 if the process is running (liveness probe).

---

## Existing Moderation Pattern Analysis

### moderateText.js (`api/server/middleware/moderateText.js`)

**How it works:**

1. **Feature flag**: `isEnabled(process.env.OPENAI_MODERATION)` (line 8). If not enabled, calls `next()` immediately.
2. **Extracts text**: `const { text } = req.body;` (line 12).
3. **External API call**: POSTs to OpenAI moderation endpoint (or reverse proxy) with `input: text` (lines 14-25).
4. **Checks response**: If any result is flagged, calls `denyRequest()` with `ErrorTypes.MODERATION` (lines 28-33).
5. **Error handling on API failure**: Calls `denyRequest()` with a generic error string (lines 35-38). **This means if the moderation API is down, the message is BLOCKED, not allowed through.**
6. **Success path**: Calls `next()` (line 40).

**Key design decisions in existing pattern:**
- Fail-closed: API errors result in message denial
- Single env var toggle (`OPENAI_MODERATION`)
- Optional reverse proxy URL (`OPENAI_MODERATION_REVERSE_PROXY`)
- Separate API key env var (`OPENAI_MODERATION_API_KEY`)
- No timeout configuration (uses axios default)
- No caching of results
- Logs errors via `logger.error()` but does NOT log the text content

### denyRequest.js (`api/server/middleware/denyRequest.js`)

When a message is denied:
1. Extracts `text` from `req.body` (line 29)
2. Constructs a `userMessage` object containing the **original unredacted text** (line 32-39)
3. Sends this user message (with PII) to the client via SSE (`sendEvent`, line 40)
4. **If the conversation already exists** (line 42-43: `_convoId && parentMessageId && parentMessageId !== Constants.NO_PARENT`), calls `saveMessage()` with the full `userMessage` including PII text (lines 44-54)
5. Sends an error response via SSE (`sendError`) with the error type (lines 56-64)
6. `sendError` (in `error.js:22-84`) may also save the error message to DB when `shouldSaveMessage` is true (error.js:49-61)

**CRITICAL PII PERSISTENCE ISSUE**: When `denyRequest` is called for a PII-detected message:
- The user's **original PII-containing text is saved to MongoDB** via `saveMessage()` at line 44-54
- This happens for any message in an existing conversation (not new conversations)
- This directly contradicts the "no PII at rest" design principle
- A PII detection feature that saves detected PII to the database is counterproductive

**Mitigation Options** (for PII middleware design):
1. **Sanitize before denyRequest**: The PII middleware could replace `req.body.text` with a sanitized version (e.g., "[Message blocked: PII detected - PERSON, EMAIL_ADDRESS]") before calling `denyRequest`. This prevents PII from reaching `saveMessage()` while preserving the denial flow.
2. **Create PII-specific denial function**: A new `denyPIIRequest()` that skips `saveMessage()` entirely, only sending SSE error events to the client.
3. **Modify denyRequest to accept options**: Add an option like `{saveMessage: false}` or `{redactText: true}` to control persistence behavior.

**Recommended approach**: Option 1 (sanitize `req.body.text` before calling `denyRequest`). This is the least invasive -- it requires no changes to `denyRequest.js` itself, and the saved message will show what entity types were detected without containing actual PII.

**Important**: `denyRequest` uses SSE (Server-Sent Events), not standard HTTP response. This is because chat routes use SSE for streaming responses. A standard `res.status(400).json(...)` would break the client.

### Where moderateText Is Currently Used

Only in **agent chat routes** (`api/server/routes/agents/chat.js:28`):
```javascript
router.use(moderateText);
```

It is **NOT used** in assistant chat routes (`assistants/chatV1.js`, `assistants/chatV2.js`). This is a pre-existing gap.

---

## Chat Route Middleware Chains (Complete Map)

### Agent Chat: `POST /api/agents/chat/`

Full middleware chain in order:
1. `requireJwtAuth` (agents/index.js:41)
2. `checkBan` (agents/index.js:42)
3. `uaParser` (agents/index.js:43)
4. `configMiddleware` (agents/index.js:312)
5. `messageIpLimiter` (agents/index.js:315, conditional on `LIMIT_MESSAGE_IP`)
6. `messageUserLimiter` (agents/index.js:319, conditional on `LIMIT_MESSAGE_USER`)
7. **`moderateText`** (agents/chat.js:28) -- **PII middleware goes here or adjacent**
8. `checkAgentAccess` (agents/chat.js:29)
9. `checkAgentResourceAccess` (agents/chat.js:30)
10. `validateConvoAccess` (agents/chat.js:31)
11. `buildEndpointOption` (agents/chat.js:32)
12. Controller function (agents/chat.js:46)

### Assistant Chat v1: `POST /api/assistants/v1/chat/`

Full middleware chain in order:
1. `requireJwtAuth` (assistants/index.js:10)
2. `checkBan` (assistants/index.js:11)
3. `uaParser` (assistants/index.js:12)
4. `configMiddleware` (assistants/index.js:13)
5. `validateModel` (assistants/chatV1.js:24)
6. `buildEndpointOption` (assistants/chatV1.js:25)
7. `validateAssistant` (assistants/chatV1.js:26)
8. `validateConvoAccess` (assistants/chatV1.js:27)
9. `setHeaders` (assistants/chatV1.js:28)
10. `chatController` (assistants/chatV1.js:29)

**No moderation middleware at all.** PII middleware should be inserted before `validateModel`.

### Assistant Chat v2: `POST /api/assistants/v2/chat/`

Identical structure to v1, using `chatV2` controller. Same gap -- no moderation.

### Ephemeral Agent Chat: `POST /api/agents/chat/:endpoint`

Same middleware chain as agent chat (agents/chat.js:56). Uses the same router, so all `router.use()` middleware applies.

### OpenAI-Compatible Chat: `POST /api/agents/v1/chat/completions`

Full middleware chain in order:
1. `requireApiKeyAuth` (openai.js:53) -- API key auth, NOT JWT
2. `configMiddleware` (openai.js:54)
3. `checkRemoteAgentsFeature` (openai.js:55)
4. `checkAgentPermission` (openai.js:78)
5. `OpenAIChatCompletionController` (openai.js:78)

**No rate limiting, no moderation, no ban check.** User text is in `req.body.messages[].content` (string or array of content parts). The controller converts messages via `convertMessages()` (openai.js:88-107) where each message has `{role, content}` format. The last user message's content is the primary field to check for PII.

**PII middleware insertion point**: Between `checkRemoteAgentsFeature` and `checkAgentPermission`, or as a separate middleware on the route handler at line 78. Requires a text extraction adapter that concatenates user message contents.

### Open Responses API: `POST /api/agents/v1/responses`

Full middleware chain in order:
1. `requireApiKeyAuth` (responses.js:56)
2. `configMiddleware` (responses.js:57)
3. `checkRemoteAgentsFeature` (responses.js:58)
4. `checkAgentPermission` (responses.js:101)
5. `createResponse` controller (responses.js:101)

**No rate limiting, no moderation, no ban check.** User text is in `req.body.input` which can be:
- A plain string (simple case)
- An array of input items: `[{type: "message", role: "user", content: "text"}]`

The controller also loads previous conversation messages via `loadPreviousMessages()` (responses.js:104-135) using `db.getMessages({conversationId})`, meaning historical PII from previous turns is loaded and sent to the AI model.

**PII middleware insertion point**: Same as OpenAI-compatible route. Requires a text extraction adapter for the `input` field format.

### Abort Routes

- Agent abort: `POST /api/agents/chat/abort` (agents/index.js:214) -- handled before chatRouter, no moderation needed
- Assistant abort: `POST /api/assistants/v{1,2}/chat/abort` (chatV1.js:14, chatV2.js:14) -- no moderation needed

---

## Request Body Structure

### Standard Chat Request (`req.body`)

Based on `moderateText.js`, `denyRequest.js`, and `buildEndpointOption.js`:

```javascript
{
  text: "The user's message text",           // string -- PRIMARY FIELD TO CHECK
  messageId: "uuid",                          // string
  conversationId: "uuid" | "new",             // string
  parentMessageId: "uuid" | "__NO_PARENT__",  // string
  endpoint: "agents" | "assistants" | ...,    // string
  endpointType: "...",                        // string (optional)
  isTemporary: false,                         // boolean (optional)
  // ... model config, agent/assistant IDs, etc.
}
```

**Key finding**: For standard agent/assistant chat routes, the user's message content is in `req.body.text`. However, this is NOT true for all chat entry points (see below).

### OpenAI-Compatible API Request (`req.body` at `/api/agents/v1/chat/completions`)

```javascript
{
  model: "agent_id",                    // string -- agent ID
  messages: [                           // array -- OpenAI chat format
    { role: "system", content: "..." },
    { role: "user", content: "Hello" }, // string content
    { role: "user", content: [          // OR array of content parts
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "..." } }
    ]}
  ],
  stream: true,                         // boolean
  conversation_id: "uuid",             // string (optional)
  parent_message_id: "uuid",           // string (optional)
}
```

**PII text extraction**: Iterate `messages` array, filter for `role === "user"`, extract `.content` (handle both string and array-of-parts formats). All user content parts of type "text" should be concatenated and checked.

### Open Responses API Request (`req.body` at `/api/agents/v1/responses`)

```javascript
{
  model: "agent_id",                           // string -- agent ID
  input: "Hello" | [                           // string OR array of items
    { type: "message", role: "user", content: "Hello" }
  ],
  stream: true,                                // boolean (optional)
  previous_response_id: "conversation_id",     // string (optional)
  instructions: "...",                         // string (optional)
}
```

**PII text extraction**: If `input` is a string, check directly. If array, filter for items with `role === "user"`, extract `.content`.

### Text Extraction Strategy

The PII middleware needs a `extractTextForPII(req)` function that returns the text to check:
1. If `req.body.text` exists (standard chat routes) -- return it
2. If `req.body.messages` exists (OpenAI-compatible) -- concatenate user message contents
3. If `req.body.input` exists (Open Responses) -- extract from string or array format
4. If none found -- return null (skip PII check)

### File Attachments

File attachments are handled separately through the `/api/files` routes, not through the chat request body. Files are uploaded first, then referenced by ID in the chat request. The file content is not directly available in the chat `req.body`. Checking file content for PII would require a separate integration point (at file upload time, not at chat time).

### Streaming vs Non-Streaming

All chat routes use SSE (Server-Sent Events) for response streaming. The request itself is a standard POST. There is no separate "non-streaming" path for chat -- all chat goes through SSE. This is why `denyRequest` uses `sendEvent`/`sendError` instead of `res.json()`.

---

## Configuration Patterns

### Existing Env Var Pattern for Moderation (`.env.example`)

```bash
OPENAI_MODERATION=false           # Feature toggle (line 409)
OPENAI_MODERATION_API_KEY=        # API key (line 410)
# OPENAI_MODERATION_REVERSE_PROXY=  # Optional custom URL (line 411)
```

### Recommended Env Vars for PII Detection

Following the same pattern:

```bash
# PII Detection (redakt)
PII_DETECTION=false                                    # Feature toggle
PII_DETECTION_API_URL=http://localhost:8000             # redakt base URL
# PII_DETECTION_MODE=detect                            # "detect" (block) | "anonymize" (redact)
# PII_DETECTION_SCORE_THRESHOLD=                       # 0.0-1.0, optional
# PII_DETECTION_ALLOW_LIST=                            # Comma-separated terms to skip
# PII_DETECTION_LANGUAGE=auto                          # "auto", "en", "de"
# PII_DETECTION_TIMEOUT=2000                           # Timeout in ms (default 2000, based on benchmarks)
# PII_DETECTION_FAIL_OPEN=false                        # If true, allow messages when redakt is down
# PII_DETECTION_EXEMPT_ROLES=                          # Comma-separated roles to exempt (e.g., "admin")
# PII_DETECTION_API_ROUTES=true                        # Apply to OpenAI-compatible and Responses API routes
```

### isEnabled() Utility (`packages/api/src/utils/common.ts:20`)

```typescript
export function isEnabled(value?: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase().trim() === 'true';
  return false;
}
```

Works with `process.env.PII_DETECTION` directly. Returns `false` for `undefined`, `null`, `"false"`, empty string.

### librechat.yaml

Not recommended for initial implementation. The yaml config is primarily for endpoint/model configuration and interface customization. PII detection is an operational/compliance feature better controlled via env vars (like moderation). Could be moved to yaml later if per-endpoint configuration is needed.

---

## Security Considerations

### Authentication/Authorization

- For standard chat routes (agents, assistants): PII middleware runs after `requireJwtAuth` and `checkBan`, so only authenticated, non-banned users trigger PII checks.
- For API routes (OpenAI-compatible, Open Responses): PII middleware runs after `requireApiKeyAuth` -- these routes use API key authentication, NOT JWT. The `req.user` object is populated differently (by `requireApiKeyAuth` which looks up the user associated with the API key).
- No additional auth needed -- the middleware is transparently applied to all chat messages.
- Role-based exemptions supported via `PII_DETECTION_EXEMPT_ROLES` env var. The `req.user.role` field is available on both JWT-authenticated and API-key-authenticated requests.

### Data Privacy

**Critical**: The middleware MUST NOT log the user's message text or the PII entities found. This aligns with redakt's design principle of "no PII at rest" and metadata-only audit logging.

What to log:
- That a PII check occurred (action type)
- Whether PII was detected (boolean)
- Entity types found (e.g., "PERSON", "EMAIL_ADDRESS") -- these are category labels, not the PII itself
- Entity count
- Whether the message was blocked/anonymized
- Latency of the redakt API call

What NOT to log:
- The user's message text
- The PII values themselves
- The anonymization mappings (contain original PII)

### Input Validation

- `req.body.text` may be undefined/empty -- middleware should call `next()` for empty text
- redakt has a 512,000 character limit -- LibreChat messages are unlikely to exceed this, but should handle the 422 error gracefully
- No special characters or injection concerns -- redakt accepts arbitrary text

---

## Failure Mode Analysis

### redakt Service Down

**Current moderateText behavior**: Fail-closed (blocks the message). This is aggressive for a PII detection feature.

**Recommended approach**: Configurable via `PII_DETECTION_FAIL_OPEN` env var.
- Default `false` (fail-closed) for compliance-sensitive deployments
- Optional `true` for deployments where availability is more important than PII protection
- Log a warning when failing open so operators can detect outages

### Latency Benchmarks (measured 2026-03-31, local Docker, macOS)

Benchmarked against `POST /api/detect` with 5 runs per text length:

| Text Length | p50 | p95 | Notes |
|---|---|---|---|
| Short (~50 chars, 2 entities) | 7ms | 226ms | First request includes NLP model warm-up |
| Medium (~500 chars, 6 entities) | 17ms | 237ms | Warm p50 well under 50ms |
| Long (~1500 chars, 15+ entities) | 29ms | 46ms | Scales sub-linearly with text length |

**Key observations:**
- Cold-start latency (first request after idle) can reach ~230ms due to Presidio NLP model loading
- Warm requests are consistently under 50ms even for long texts
- p50 latency adds negligible overhead to the chat request path (7-29ms)
- p95 latency is dominated by cold-start effects, not text processing time

**Latency budget**: For a chat application, the PII detection overhead should be under 200ms at p99. Based on these benchmarks, this is achievable for warm requests. Cold-start spikes can be mitigated by:
1. Health check polling to keep the Presidio NLP model warm
2. The redakt `/api/health/live` endpoint as a liveness probe in Kubernetes/Docker
3. A warm-up request on service start

**Revised timeout recommendation**: 2 seconds (down from 5 seconds). The benchmarks show that even worst-case processing is well under 1 second. A 2-second timeout provides generous headroom while preventing excessive user-facing latency if redakt is truly unresponsive.

### Timeout

- redakt depends on Presidio NLP processing, which can be slow for long texts
- Default timeout should be **2 seconds** (`PII_DETECTION_TIMEOUT=2000`), revised from 5 seconds based on benchmarks
- Timeout should be treated as a service-down scenario (follow fail-open/fail-closed config)

### Rate Limiting

- redakt itself does not enforce rate limiting
- LibreChat's existing `messageIpLimiter` and `messageUserLimiter` protect redakt indirectly
- No additional rate limiting needed in the PII middleware

### Connection Pooling

- Use `axios` (already a dependency) with reasonable defaults
- Consider creating a shared axios instance with `baseURL` and `timeout` to avoid repeated config

---

## Response Strategy Analysis

### Option A: Detect + Block (like moderateText)

**How it works:**
1. `POST /api/detect` with `req.body.text`
2. If `has_pii === true`, call `denyRequest()` with a PII-specific error type
3. Client shows "Your message contains personal information" error

**Pros:**
- Simplest to implement (matches existing moderateText pattern exactly)
- No state management needed
- Clear user feedback
- Strongest PII protection -- no PII reaches the AI model

**Cons:**
- Frustrating UX -- users must manually remove PII
- Users may not know what triggered the block (which text is PII?)
- False positives block legitimate messages entirely

**Implementation effort:** Low. Nearly identical to moderateText.js.

### Option B: Detect + Warn (allow through with warning)

**How it works:**
1. `POST /api/detect` with `req.body.text`
2. If `has_pii === true`, attach metadata to request, call `next()`
3. After AI response, send a warning event to client
4. Client shows a non-blocking warning banner

**Pros:**
- Non-disruptive UX
- Educational -- helps users understand PII risks

**Cons:**
- PII still reaches the AI model (defeats the purpose for compliance)
- Requires client-side changes to display warning
- Complex: needs to inject warning into SSE stream at the right point

**Implementation effort:** Medium. Requires client changes and SSE stream modification.

### Option C: Anonymize + Deanonymize (redact round-trip)

**How it works:**
1. `POST /api/anonymize` with `req.body.text`
2. Replace `req.body.text` with `anonymized_text`
3. Store `mappings` on the request object (e.g., `req.piiMappings`)
4. AI sees and responds with placeholders (`<PERSON_1>`, etc.)
5. After AI response, `POST /api/deanonymize` with AI's response text + mappings
6. Replace AI response with deanonymized text

**Pros:**
- Best UX -- transparent to the user
- PII never reaches the AI model
- AI responses still make contextual sense (placeholders are consistent)
- This is redakt's intended workflow for AI agent integration

**Cons:**
- Most complex to implement
- Requires intercepting the AI response (after streaming completes or on each chunk)
- Deanonymization of streaming responses is non-trivial
- Mappings must be held in memory for the duration of the request
- If deanonymization fails, user sees raw placeholders
- AI quality may be slightly reduced with placeholders (AI doesn't know real names)

**Implementation effort:** High. Requires modifying response handling, possibly the streaming layer.

### Recommended Strategy: Start with Option A (Detect + Block), plan for Option C

**Rationale:**
1. Option A can be implemented in a single middleware file with zero changes to existing code paths
2. It follows the exact same pattern as moderateText.js, minimizing risk
3. It provides the strongest PII protection (no PII reaches AI models)
4. The error message can include the entity types found (e.g., "Personal information detected: names, email addresses") to help users self-correct
5. Option C (anonymize round-trip) can be added later as an enhancement once the basic integration is proven

**For v1 (detect + block):**
- Single new file: `api/server/middleware/detectPII.js`
- Add `router.use(detectPII)` to agents/chat.js and assistants/chatV1.js, chatV2.js
- New ErrorType or reuse `MODERATION` type
- 3 env vars minimum: `PII_DETECTION`, `PII_DETECTION_API_URL`, `PII_DETECTION_FAIL_OPEN`

**For v2 (anonymize round-trip, future):**
- Requires deeper integration with the request/response pipeline
- Mappings need session-scoped storage
- Response deanonymization needs to hook into the SSE stream or post-processing
- Consider storing mappings in Redis keyed by conversationId for multi-turn context

---

## Stakeholder Mental Models

### Product Team Perspective
- PII detection is a compliance/GDPR feature for enterprise deployments
- Must be opt-in (not all deployments need it)
- Should not degrade the user experience for non-PII messages (latency)
- Valuable differentiator for MemodoAI vs vanilla LibreChat

### Engineering Team Perspective
- Must follow existing middleware patterns (moderateText.js is the template)
- External service dependency adds a failure mode -- must be resilient
- Should not block the main chat path if redakt is misconfigured
- Testing: need to mock redakt API calls in unit tests

### Support Team Perspective
- Users will ask "why was my message blocked?"
- Error message must be clear about what was detected (entity types, not values)
- Admin documentation needed for env var setup

### User Perspective
- "I just want to chat -- why is my message being rejected?"
- Need clear, actionable error messages
- If using anonymize mode: should be transparent (user doesn't need to know)

### Security/Compliance Officer Perspective
- Needs specific GDPR article references (Articles 5(1)(c), 25, 32) to justify feature requirements
- Will want to know about the denyRequest PII persistence issue and how it is mitigated
- Will ask about file upload bypass and multi-turn leakage gaps
- May require fail-closed as non-negotiable for certain deployments

### DevOps/SRE Perspective
- Need monitoring/alerting for redakt service health
- Need runbook for when redakt goes down (what happens to chat, how to recover)
- Circuit breaker behavior should be observable (log when circuit opens/closes)
- Deploy/update redakt alongside LibreChat (Docker Compose service addition)

### QA/Testing Perspective
- Unit tests cover API mocking, but accuracy testing (false positives/negatives) requires real-world test data
- Need test corpus with PII in multiple languages (EN, DE)
- Need to test partial PII (e.g., first name only, partial phone number)
- Need to test code snippets with PII-like patterns (variable names, test data)

### Data Protection Officer (DPO) Perspective
- Should be consulted on detect+block vs. anonymize decision
- Must validate that the PII text sanitization approach in denyRequest is sufficient
- May require data processing impact assessment (DPIA) for the feature itself

---

## Production Edge Cases

### Historical Issues
- No existing PII detection in LibreChat -- this is a new feature
- moderateText.js has no known issues in the codebase (no related bug fixes found)

### Edge Cases to Test

1. **Empty message**: `req.body.text` is undefined, null, or empty string -- should call `next()` without calling redakt
2. **Very long message**: Near the 512KB limit -- should handle gracefully
3. **Non-text content**: Messages with only file attachments and no text -- should call `next()`
4. **Multiple rapid messages**: Rate limiting protects redakt, but verify no race conditions
5. **redakt returns unexpected response**: Schema validation on the response
6. **Network errors**: DNS resolution failure, connection refused, timeout
7. **PII in conversation context (multi-turn leakage)**: Only the current message text is checked, not the full conversation history. See "Multi-Turn Conversation PII Leakage" section below for detailed analysis.
8. **Mixed language content**: redakt supports English and German with auto-detection. Other languages may have reduced detection accuracy.
9. **Code snippets**: Variable names like `john_smith_email` might be flagged as PII. Consider the allow_list feature for common false positives.

### Error Logs (Anticipated Failure Patterns)
- `ECONNREFUSED` -- redakt not running
- `ETIMEDOUT` -- redakt overloaded or Presidio slow
- `422` -- Invalid request (should not happen with proper implementation)
- `503` -- Presidio services down but redakt running

---

## Files That Matter

### Core Logic (Implementation Targets)
- `api/server/middleware/moderateText.js` -- Template to follow (43 lines)
- `api/server/middleware/denyRequest.js` -- Denial mechanism (67 lines) -- **CAUTION: saves PII text to MongoDB, must sanitize before calling**
- `api/server/middleware/index.js` -- Middleware registry (must register new middleware here, line 15-49)
- `api/server/routes/agents/chat.js:28` -- Insert point for agent routes
- `api/server/routes/assistants/chatV1.js:24-32` -- Insert point for assistant v1 routes
- `api/server/routes/assistants/chatV2.js:24-32` -- Insert point for assistant v2 routes
- `api/server/routes/agents/openai.js:78` -- Insert point for OpenAI-compatible API routes (after line 55)
- `api/server/routes/agents/responses.js:101` -- Insert point for Open Responses API routes (after line 58)
- `api/server/controllers/agents/openai.js:88-107` -- `convertMessages()` reference for text extraction from OpenAI format
- `api/server/controllers/agents/responses.js:104-135` -- `loadPreviousMessages()` reference for conversation history loading

### Supporting Files
- `packages/api/src/utils/common.ts:20` -- `isEnabled()` utility
- `packages/data-provider/src/config.ts:1607` -- `ErrorTypes` enum (may need new PII type)
- `api/server/middleware/error.js:22` -- `sendError()` function
- `.env.example` -- Add new env vars documentation

### Configuration
- `.env.example` -- Document PII_DETECTION_* env vars
- No changes to `librechat.yaml` needed for v1

### Tests (Existing Coverage Gaps)
- `api/server/middleware/moderateText.js` -- No test file found. The new PII middleware should have comprehensive tests.
- `api/server/routes/__tests__/` -- Route-level tests exist; may need integration test additions
- Test file should be: `api/server/middleware/__tests__/detectPII.spec.js`

---

## Testing Strategy

### Unit Tests (`api/server/middleware/__tests__/detectPII.spec.js`)

1. **Feature disabled**: Returns `next()` when `PII_DETECTION` is not set or false
2. **No text**: Returns `next()` when `req.body.text` is empty/undefined
3. **No PII found**: Calls redakt, gets `has_pii: false`, returns `next()`
4. **PII found**: Calls redakt, gets `has_pii: true`, calls `denyRequest()` with correct error
5. **Error message content**: Verify entity types are included in error message
6. **API timeout**: Simulates timeout, verifies fail-closed behavior (or fail-open if configured)
7. **API error (500)**: Simulates server error, verifies correct behavior
8. **API connection refused**: Simulates ECONNREFUSED
9. **Fail-open mode**: With `PII_DETECTION_FAIL_OPEN=true`, API errors result in `next()`
10. **Custom URL**: Verifies `PII_DETECTION_API_URL` is used for the API call
11. **Score threshold**: Verifies `PII_DETECTION_SCORE_THRESHOLD` is passed to redakt
12. **Allow list**: Verifies `PII_DETECTION_ALLOW_LIST` is parsed and passed

12. **OpenAI-compatible format**: Verifies text extraction from `req.body.messages` array
13. **Open Responses format**: Verifies text extraction from `req.body.input` (string and array)
14. **Exempt roles**: Verifies `PII_DETECTION_EXEMPT_ROLES` bypasses PII check for listed roles
15. **PII text sanitization**: Verifies `req.body.text` is sanitized before `denyRequest()` saves to DB
16. **API route error format**: Verifies JSON error response (not SSE) for API routes

### Integration Tests

1. **Full middleware chain**: Verify PII middleware integrates correctly with agent chat route
2. **Full middleware chain**: Verify PII middleware integrates correctly with assistant chat routes
3. **Full middleware chain**: Verify PII middleware integrates correctly with OpenAI-compatible API route
4. **Full middleware chain**: Verify PII middleware integrates correctly with Open Responses API route
5. **SSE response format**: Verify denyRequest produces correct SSE events (standard chat routes)
6. **JSON response format**: Verify JSON error response (API routes)

### Edge Cases

1. Text at 512,000 character boundary
2. Text with only whitespace
3. Unicode/emoji content
4. Text with HTML/markdown
5. Concurrent requests (no shared state)

---

## Documentation Needs

### User-Facing Docs
- Error message text: "Your message was not sent because it appears to contain personal information ({entityTypes}). Please remove personal details and try again."
- Knowledge base article explaining PII detection, why it's enabled, and how to rephrase messages

### Developer Docs
- Env var reference in `.env.example` with comments
- Architecture note about middleware ordering
- Note about the assistant route gap (moderateText was never added there)

### Configuration Docs
- Setup guide: Install and configure redakt, set env vars
- Docker Compose: Add redakt service to existing docker-compose.yml for self-hosted deployments
- Production: Set `PII_DETECTION_API_URL` to production redakt URL

---

## Multi-Turn Conversation PII Leakage

### How Conversation History Is Loaded

When a user sends a message in an existing conversation, the AI model receives the full conversation history, not just the current message. This is how context works in all chat routes:

1. **Standard agent chat** (`BaseClient.js:214`): Calls `this.loadHistory(conversationId, head)` which calls `db.getMessages({conversationId})` at `BaseClient.js:669`. All messages in the conversation are loaded from MongoDB, ordered by the message tree, and sent to the AI model as context.

2. **OpenAI-compatible API** (`openai.js:228`): Passes `getMessages: db.getMessages` to `initializeAgent`, which loads conversation history when `conversation_id` is provided.

3. **Open Responses API** (`responses.js:378-391`): Explicitly calls `loadPreviousMessages(request.previous_response_id, userId)` which loads all messages via `db.getMessages({conversationId})` and merges them with new input before sending to the AI model.

### The PII Leakage Vector

**Scenario**: PII detection is enabled after a user has already shared PII in previous messages.
- Message 1 (before PII detection enabled): "My colleague John Smith's email is john@example.com"
- Message 5 (after PII detection enabled): "Can you summarize the contact info I shared earlier?"
- Result: The AI model receives messages 1-5 as context. Message 1 contains PII that was never checked. The AI model's response may repeat the PII.

**Scenario**: PII enters through an unprotected route (e.g., OpenAI-compatible API).
- Message 1 (via API, no PII check): "Process this for user John Smith, SSN 123-45-6789"
- Message 2 (via web UI, PII check passes): "What was the user's information?"
- Result: PII from message 1 is in the conversation context and may leak in the response.

### Known Limitation

This is a **known limitation** of the v1 detect+block approach. The middleware only checks the current inbound message, not the conversation history that will be sent to the AI model. This is consistent with how `moderateText` works (content moderation also only checks the current message).

**Why full history scanning is impractical for v1:**
- Each chat request would require scanning all previous messages (potentially hundreds), multiplying redakt API calls
- Previously-approved messages would be re-scanned on every subsequent message
- Latency impact would scale with conversation length
- Messages already stored in MongoDB cannot be retroactively blocked

**Mitigation strategies (for future consideration):**
1. **Scan on storage**: Check messages for PII at write time (not read time). If PII was allowed before the feature was enabled, it remains. But all new PII is caught regardless of route.
2. **Context-level scanning**: Before sending conversation history to the AI model, scan the assembled context. This catches historical PII but adds significant latency.
3. **Retroactive scan**: A background job that scans existing conversations and flags/redacts PII in stored messages. This is a data migration concern, not a middleware concern.

**Recommendation**: Document this limitation clearly in user-facing documentation. For v1, accept that PII entered before the feature is enabled (or through unprotected routes) may persist in conversation context. Address in v2 with context-level scanning if required by compliance.

---

## Admin and Role-Based Exemptions

### Current Role System

LibreChat has a role-based access control system. The `req.user.role` field is available on all authenticated requests. Admin checks exist in middleware (e.g., `api/server/middleware/roles/admin.js:5` checks `req.user.role !== SystemRoles.ADMIN`).

### Why Exemptions May Be Needed

- Admins may need to discuss PII in legitimate support/debugging scenarios
- Testing PII detection requires sending PII -- admins/QA need bypass capability
- Internal workflows (e.g., HR bot, support agent) may intentionally process PII
- An all-or-nothing block with no bypass could lead to feature abandonment

### Recommended Approach for v1

The middleware architecture should **support** exemptions even if v1 ships without them:

```javascript
// In detectPII middleware, before calling redakt:
if (process.env.PII_DETECTION_EXEMPT_ROLES) {
  const exemptRoles = process.env.PII_DETECTION_EXEMPT_ROLES.split(',').map(r => r.trim());
  if (req.user?.role && exemptRoles.includes(req.user.role)) {
    return next();
  }
}
```

**Env var**: `PII_DETECTION_EXEMPT_ROLES=` (empty by default, comma-separated list of role names to exempt)

This is a low-cost addition that keeps the feature flexible without adding complexity. For API routes (which use API key auth, not JWT), the `req.user` is populated by `requireApiKeyAuth` and may have a different role structure -- this needs verification during implementation.

---

## Compliance Context

### Regulatory Framework

This feature is driven by GDPR compliance requirements for the MemodoAI enterprise deployment. Key GDPR articles:
- **Article 5(1)(c)** -- Data minimization: Personal data should be adequate, relevant, and limited to what is necessary
- **Article 25** -- Data protection by design and by default
- **Article 32** -- Security of processing: Appropriate technical measures to ensure security

### What GDPR Requires vs. What This Feature Does

GDPR does **not** mandate blocking users from sending PII. It mandates:
1. Proper handling of personal data
2. Informed consent for data processing
3. Data minimization (don't collect more than necessary)
4. Right to erasure

The detect+block approach is a **data minimization** measure -- preventing PII from being sent to third-party AI models. This is a valid compliance strategy but is more aggressive than GDPR strictly requires.

### Fail-Open vs. Fail-Closed Revisited

Given this compliance context:
- **Fail-closed** (default): Appropriate when the primary concern is preventing PII from reaching AI models at all costs. Blocks all chat when redakt is down.
- **Fail-open**: Appropriate when availability is prioritized and PII protection is a best-effort measure. Should trigger alerts so operators know protection is degraded.

**Recommendation**: Keep fail-closed as default for compliance, but ensure the fail-open option is well-documented and easy to enable. Add a monitoring/alerting note: when failing open, log at WARN level so operators can set up alerts.

---

## File Upload PII Bypass Risk Assessment

### Current State

File attachments are uploaded via `/api/files` routes and stored independently. The chat `req.body` contains only file reference IDs, not file content. This means:
- A user can type "see attached" in the chat box (passes PII check)
- The attached file contains PII (never checked)
- The AI model processes the file content with PII

### Severity Assessment

For v1, this is an **acceptable gap** for the following reasons:
1. Not all AI models/endpoints process file attachments -- the risk depends on configuration
2. File content extraction and PII scanning requires different APIs (redakt's `/api/documents/upload`)
3. The primary PII vector is conversational text, not file uploads
4. Adding file PII scanning is a significant additional scope that should not delay the core feature

**However**, this bypass should be:
- Documented in user-facing materials ("PII detection applies to message text, not file attachments")
- Tracked as a Phase 3 enhancement (already noted in implementation phases)
- Assessed with the DPO/compliance officer to confirm acceptability

---

## Rate Limiting and Circuit Breaker Considerations

### Current Rate Limiter Coverage

The existing rate limiters (`messageIpLimiter`, `messageUserLimiter`) are **conditional** on environment variables:
- `LIMIT_MESSAGE_IP` must be enabled (agents/index.js:314)
- `LIMIT_MESSAGE_USER` must be enabled (agents/index.js:318)

If neither is set, there is no rate limiting on chat messages, and a burst of messages could overwhelm the redakt/Presidio service.

Additionally, API-compatible routes (OpenAI and Responses) have **no rate limiting at all** -- they bypass the chatRouter entirely.

### Recommendation

The PII middleware should implement basic self-protection:
1. **Circuit breaker**: If redakt returns errors for N consecutive requests (e.g., 5), temporarily bypass PII checking for a cooldown period (e.g., 30 seconds) rather than continuing to hammer a failing service. Follow fail-open/fail-closed config during circuit-open state.
2. **Logging**: Log when circuit opens/closes so operators can monitor redakt health.
3. **No additional rate limiting needed in the middleware itself** -- the circuit breaker handles the failure cascade concern.

---

## Implementation Recommendations Summary

### Phase 1: Detect + Block (v1)

1. Create `api/server/middleware/detectPII.js` following moderateText.js pattern
   - Include `extractTextForPII(req)` function handling three request body formats: `text`, `messages`, `input`
   - Sanitize `req.body.text` before calling `denyRequest()` to prevent PII persistence in MongoDB (replace with "[Message blocked: PII detected - {entity_types}]")
   - For API routes (OpenAI/Responses), use standard JSON error response instead of SSE-based `denyRequest()` since those routes do not use SSE
   - Support `PII_DETECTION_EXEMPT_ROLES` for role-based bypass
   - Default timeout: 2000ms (based on latency benchmarks)
2. Register in `api/server/middleware/index.js`
3. Add `router.use(detectPII)` to:
   - `api/server/routes/agents/chat.js` (after moderateText, line 28)
   - `api/server/routes/assistants/chatV1.js` (before validateModel, new line)
   - `api/server/routes/assistants/chatV2.js` (before validateModel, new line)
   - `api/server/routes/agents/openai.js` (after checkRemoteAgentsFeature, before checkAgentPermission)
   - `api/server/routes/agents/responses.js` (after checkRemoteAgentsFeature, before checkAgentPermission)
4. Add env vars to `.env.example`
5. Optionally add `PII_DETECTION` ErrorType to `packages/data-provider/src/config.ts`
6. Write unit tests (including tests for all three request body formats)

**Estimated effort**: 6-8 hours (increased from 4-6 due to multi-format support and PII sanitization)

### Phase 2: Anonymize Round-Trip (v2, future)

1. Create `api/server/middleware/anonymizePII.js` that replaces req.body.text and stores mappings
2. Create response post-processor that deanonymizes AI output before sending to client
3. Handle streaming deanonymization (accumulate chunks, deanonymize on completion)
4. Store mappings in Redis for multi-turn conversation context
5. Add `PII_DETECTION_MODE=anonymize` env var to switch between detect and anonymize

**Estimated effort**: 2-3 days (significant complexity in response handling)

### Phase 3: File Content PII Detection (v3, future)

1. Hook into file upload route (`/api/files`)
2. Use redakt's document upload endpoint (`POST /api/documents/upload`)
3. Check uploaded files for PII before they become available in conversations

**Estimated effort**: 1-2 days
