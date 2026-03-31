# Research Progress

## Current: RESEARCH-009-pii-detection-integration

### Research Phase Summary
**Date**: 2026-03-31
**Status**: COMPLETE
**Branch**: `feature/008-admin-reporting-dashboard` (to be moved to dedicated branch)

### Research Question
How should the redakt PII detection/anonymization API be integrated into LibreChat's chat lifecycle as Express middleware?

### Key Findings

#### 1. redakt API Contract -- Well-Documented
- `POST /api/detect`: returns `{has_pii, entity_count, entities_found}` -- lightweight check
- `POST /api/anonymize`: returns `{anonymized_text, mappings}` -- full round-trip support
- `POST /api/deanonymize`: restores original values using mappings
- Max text length: 512,000 chars; auto language detection (EN/DE)
- Health endpoint: `GET /api/health` checks Presidio services
- Error format: `{"detail": "..."}` with standard HTTP codes (400, 422, 503, 504)

#### 2. Existing Moderation Pattern (moderateText.js)
- Feature toggle via `isEnabled(process.env.OPENAI_MODERATION)` -- same pattern for PII
- Extracts `req.body.text`, calls external API, blocks via `denyRequest()` on failure
- **Fail-closed**: API errors block the message (aggressive but safe)
- Uses SSE-based error responses (not standard HTTP JSON)

#### 3. Chat Route Middleware Chains -- TWO INSERTION POINTS
- **Agent chat** (`api/server/routes/agents/chat.js:28`): Already has `moderateText` as first content middleware
- **Assistant chat v1/v2** (`assistants/chatV1.js`, `chatV2.js`): **NO moderation middleware at all** -- pre-existing gap
- PII middleware should be inserted at position matching moderateText in all chat routes

#### 4. Request Body -- `req.body.text` Is the Field to Check
- All chat routes pass user message as `req.body.text` (string)
- File attachments handled separately via `/api/files` (not in chat body)
- All chat uses SSE streaming -- error responses must use `denyRequest()`/`sendEvent()`, not `res.json()`

#### 5. Recommended Strategy: Detect + Block (v1)
- Simplest implementation, follows moderateText pattern exactly
- Single new middleware file (`api/server/middleware/detectPII.js`)
- Strongest PII protection -- no PII reaches AI model
- Error message includes entity types to help users self-correct
- Future v2: anonymize round-trip (complex, requires response interception)

### Configuration Design
```bash
PII_DETECTION=false                   # Feature toggle
PII_DETECTION_API_URL=http://localhost:8000  # redakt URL
PII_DETECTION_FAIL_OPEN=false         # Allow messages if redakt is down
PII_DETECTION_TIMEOUT=5000            # API timeout in ms
PII_DETECTION_SCORE_THRESHOLD=        # Optional confidence threshold
PII_DETECTION_ALLOW_LIST=             # Comma-separated skip terms
```

### Gaps Identified
1. Assistant chat routes have no moderation middleware (pre-existing gap)
2. No ErrorType for PII detection in `packages/data-provider/src/config.ts`
3. No tests exist for moderateText.js (no test template to follow)
4. File upload PII detection not addressed in v1
5. Streaming response deanonymization (for future anonymize mode) is non-trivial

### Research Document
`SDD/research/RESEARCH-009-pii-detection-integration.md`

Research completeness validation done. All checklist items verified.

### Critical Review Findings Resolution (2026-03-31)

**Review document**: `SDD/reviews/CRITICAL-RESEARCH-pii-detection-integration-20260331.md`
**Status**: ALL FINDINGS RESOLVED

#### HIGH findings resolved:
1. **Missed chat entry points**: Verified. OpenAI-compatible (`/api/agents/v1/chat/completions`) and Open Responses (`/api/agents/v1/responses`) routes confirmed. Both bypass JWT auth and all standard middleware. Research updated with all four entry points, request body formats, and text extraction strategy.
2. **denyRequest PII persistence**: Verified. `denyRequest.js:44-54` saves PII text to MongoDB. Research updated with mitigation: sanitize `req.body.text` before calling `denyRequest()`.
3. **No latency benchmarks**: Resolved. Benchmarked redakt locally: p50=7-29ms, p95=46-237ms. Default timeout revised from 5s to 2s.
4. **Multi-turn PII leakage**: Verified. `BaseClient.js:669` loads full conversation history via `db.getMessages()`. Documented as known v1 limitation with future mitigation strategies.
5. **Admin exemptions**: Resolved. Added `PII_DETECTION_EXEMPT_ROLES` env var design.

#### MEDIUM findings resolved:
6. Compliance context: GDPR articles 5(1)(c), 25, 32 documented
7. File upload bypass risk: Assessed as acceptable v1 gap, documented
8. Admin exemptions: Covered under HIGH #5

#### LOW findings resolved:
9. Timeout: Revised to 2000ms based on benchmarks. Circuit breaker pattern added.

#### Questionable assumptions: All 5 addressed
#### Missing perspectives: All 5 stakeholder perspectives added

**Proceed/Hold**: Changed from HOLD to PROCEED. Research ready for specification.

---

## Previous Research

### RESEARCH-008 (Archived)
**Archive Location**: Previous progress.md content
**Topic**: Admin reporting dashboard
**Status**: COMPLETE -- Implemented on `feature/008-admin-reporting-dashboard`

### RESEARCH-007 (Archived)
**Topic**: Usage and chat logging
**Status**: COMPLETE

### RESEARCH-006 (Archived)
**Topic**: Microsoft Entra SSO via OpenID Connect

### RESEARCH-005 (Archived)
**Topic**: Microsoft 365 MCP integration

### RESEARCH-004 (Archived)
**Topic**: Self-hosted Cassandra for Astra Assistants API

### RESEARCH-002 & RESEARCH-003 (Archived)
**Topics**: File upload alternatives, Astra Assistants API overview

### RESEARCH-001 (Archived)
**Topic**: Agent workflow API
