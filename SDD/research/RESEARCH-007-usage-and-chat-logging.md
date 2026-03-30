# RESEARCH-007-usage-and-chat-logging

**Research Question:** Does LibreChat offer any ability to log usage? To log chats?

**Date:** 2026-03-30
**Status:** COMPLETE

---

## Executive Summary

LibreChat has **robust built-in capabilities** for both usage tracking and chat logging, though they serve different purposes:

1. **Token/Usage Tracking** — Full transaction-based system with per-model pricing, balance management, and token counting. Designed for cost control, not analytics.
2. **Chat/Conversation Storage** — All messages and conversations are stored in MongoDB with full CRUD access, but strictly user-scoped (no admin access to user chats).
3. **Chat Export** — Client-side export in 5 formats (PNG, TXT, Markdown, JSON, CSV). No server-side bulk export.
4. **Application Logging** — Winston with daily rotation, debug/error file logs, JSON console output option.
5. **External Observability** — Langfuse env vars exist as placeholders but are **not implemented** in code.
6. **No Analytics Dashboard** — No built-in reporting UI for usage trends, user activity, or cost analysis.

---

## System Data Flow

### Token Usage Flow
1. User sends message → AI client processes request
2. Token count calculated during/after completion
3. `spendTokens()` or `spendStructuredTokens()` called → `packages/data-schemas/src/methods/spendTokens.ts:26-145`
4. `createTransaction()` writes Transaction record + updates Balance → `packages/data-schemas/src/methods/transaction.ts:297`
5. Balance updated with optimistic concurrency (10 retries, exponential backoff) → `transaction.ts:176`
6. For agents: `recordCollectedUsage()` batches multiple transactions → `packages/api/src/agents/usage.ts`

### Message Storage Flow
1. User sends message → stored in MongoDB via Message model
2. If MeiliSearch enabled → message indexed for full-text search (user-scoped filter)
3. Conversation metadata updated (title, model, endpoint, timestamps)
4. If temporary chat → `expiredAt` set based on retention config (default 30 days)

### Chat Export Flow (Client-Side Only)
1. User clicks export in UI → `client/src/components/Chat/ExportAndShareMenu.tsx`
2. Export modal shows format options → `client/src/components/Nav/ExportConversation/ExportModal.tsx:15-20`
3. Export hook processes messages client-side → `client/src/hooks/Conversations/useExportConversation.ts:30-394`
4. File downloaded directly to user's browser — no server round-trip for export generation

---

## Detailed Findings

### 1. Token/Usage Tracking (FULL)

**Transaction Model** — `packages/data-schemas/src/types/transaction.ts:1-18`
- Fields: `user`, `conversationId`, `tokenType` (prompt|completion|credits), `model`, `inputTokens`, `completionTokens`, `writeTokens`, `readTokens`, `tokenValue`, `rate`, `rawAmount`, `context`, `messageId`
- Indexed on: `user`, `conversationId`, `model`, `tenantId`

**Balance Model** — `packages/data-schemas/src/types/balance.ts:1-24`
- Fields: `tokenCredits`, `autoRefillEnabled`, `refillIntervalValue`, `refillIntervalUnit`, `refillAmount`, `lastRefill`

**Token Pricing** — `packages/data-schemas/src/methods/tx.ts:1-150+`
- Hardcoded per-model pricing for Bedrock, OpenAI, Anthropic, Google, etc.
- Supports cache multipliers (read/write) for Claude cache pricing

**Balance Management CLIs:**
- `config/add-balance.js` — Add tokens to user
- `config/list-balances.js` — List all user balances
- `config/set-balance.js` — Set user balance

**Environment Variables:**
- `CHECK_BALANCE=false` — Enable/disable balance checking (`.env.example:450`)
- `START_BALANCE=20000` — Initial tokens after registration (`.env.example:451`)

**API Endpoint:**
- `GET /api/balance/` — Fetch authenticated user's balance → `api/server/routes/balance.js:6`

### 2. Chat/Conversation Storage (FULL)

**Message Model** — `packages/data-schemas/src/types/message.ts:1-51`
- Stores: `messageId`, `conversationId`, `user`, `model`, `endpoint`, `text`, `summary`, `tokenCount`, `feedback` (rating/tag/text), `isCreatedByUser`, `files`, `attachments`, `metadata`, timestamps

**Conversation Model** — `packages/data-schemas/src/types/convo.ts`
- Stores: `conversationId`, `endpoint`, `title`, `model`, `user`, `isArchived`, `files`, `tags`, timestamps

**API Endpoints:**
- `GET /api/convos/` — Paginated conversations (user-scoped) → `api/server/routes/convos.js:28`
- `GET /api/convos/:conversationId` — Single conversation → `convos.js:58`
- `GET /api/messages/` — Messages with search/filter → `api/server/routes/messages.js:13`
- `GET /api/messages/:conversationId` — All messages in conversation → `messages.js:269`
- `DELETE /api/convos/` — Delete conversation → `convos.js:97`
- `DELETE /api/convos/all` — Delete all user conversations → `convos.js:141`
- `POST /api/convos/archive` — Archive/unarchive → `convos.js:160`
- `POST /api/convos/import` — Import conversations → `convos.js:232`

### 3. Chat Export (CLIENT-SIDE, 5 FORMATS)

**Export Formats** — `client/src/components/Nav/ExportConversation/ExportModal.tsx:15-20`:
| Format | Function | Notes |
|--------|----------|-------|
| PNG | `exportScreenshot()` | HTML-to-image capture |
| CSV | `exportCSV()` | Uses export-from-json library |
| Markdown | `exportMarkdown()` | Includes metadata + message history |
| TXT | `exportText()` | Plain text with sections |
| JSON | `exportJSON()` | Full recursive tree structure support |

**Key File:** `client/src/hooks/Conversations/useExportConversation.ts:30-394`
- Supports exporting message branches
- Supports including endpoint options/config
- Recursive vs sequential export for JSON

### 4. Access Control (STRICT USER ISOLATION)

**Conversation Access Middleware** — `api/server/middleware/validate/convoAccess.js:1-82`
- Line 60: Enforces `conversation.user !== userId` check
- Caches access decisions for 10 minutes
- Logs and denies unauthorized access

**Admin Limitations:**
- Admins **cannot** view user conversations
- Admin capabilities limited to: system config, roles, groups
- Admin routes: `api/server/routes/admin/` (auth, config, roles, groups)
- No admin endpoint exists for querying user chat data

**MeiliSearch Isolation:**
- Search filtered by `user = "${user}"` → `api/server/routes/messages.js:42`
- Tenant isolation applied in mongoMeili plugin

### 5. Application Logging (Winston)

**Logger Config** — `packages/data-schemas/src/config/winston.ts:1-121`
- Custom levels: error, warn, info, http, verbose, debug, activity, silly
- **Error log**: Daily rotation, 20MB max, 14-day archive, gzip compressed
- **Debug log**: Enabled when `DEBUG_LOGGING=true`, same rotation policy
- **Console**: Conditional based on `DEBUG_CONSOLE` and `CONSOLE_JSON`

**Environment Variables** (`.env.example:55-72`):
| Variable | Default | Purpose |
|----------|---------|---------|
| `CONSOLE_JSON` | false | JSON logging to console |
| `DEBUG_LOGGING` | true | Debug-level file logging |
| `DEBUG_CONSOLE` | false | Debug output to console |
| `AGENT_DEBUG_LOGGING` | false | Agent-specific debug |
| `DEBUG_OPENAI` | false | OpenAI request/response logging |

### 6. External Observability (NOT IMPLEMENTED)

**Langfuse** — `.env.example:100-107`:
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`
- **Placeholder only** — no integration code found in the codebase

### 7. Data Retention

**Temporary Chat Expiration** — `packages/data-schemas/src/utils/tempChatRetention.ts`
- Default: 30 days (`DEFAULT_RETENTION_HOURS = 24 * 30`)
- Configurable: `TEMP_CHAT_RETENTION_HOURS` env var or `interfaceConfig.temporaryChatRetention`
- Range: 1 hour to 8760 hours (1 year)
- **No automatic cleanup job exists** — expired records are marked but not auto-deleted

---

## Stakeholder Mental Models

- **Product Team perspective:** LibreChat tracks token usage for cost control (balance/quota enforcement), not for business analytics. There's no dashboard showing usage trends, top users, or cost breakdowns over time.
- **Engineering Team perspective:** All the data is in MongoDB (transactions, messages, conversations). Building analytics/reporting is feasible by querying these collections directly, but nothing is pre-built.
- **Support Team perspective:** No way to view a user's conversations from an admin panel. Troubleshooting requires direct database access.
- **User perspective:** Users can export their own chats in multiple formats. They can see their token balance but not a usage history/breakdown.

---

## Production Edge Cases

- **Balance race conditions:** Handled via optimistic concurrency with 10 retries and exponential backoff (`transaction.ts:176`)
- **Temporary chat cleanup:** `expiredAt` is set but no cron job deletes expired records — MongoDB TTL indexes or a manual cleanup script would be needed
- **Token pricing staleness:** Model prices are hardcoded in `tx.ts` — new models or price changes require code updates
- **No server-side export:** Large conversations must be fully loaded client-side before export; could be problematic for very long chats

---

## Files That Matter

### Core Logic
- `packages/data-schemas/src/methods/transaction.ts` — Transaction creation, balance updates
- `packages/data-schemas/src/methods/spendTokens.ts` — Token spending interface
- `packages/data-schemas/src/methods/tx.ts` — Token pricing values
- `packages/api/src/agents/usage.ts` — Agent usage recording
- `packages/api/src/agents/transactions.ts` — Transaction preparation

### Models/Schemas
- `packages/data-schemas/src/types/transaction.ts` — Transaction type
- `packages/data-schemas/src/types/balance.ts` — Balance type
- `packages/data-schemas/src/types/message.ts` — Message type
- `packages/data-schemas/src/types/convo.ts` — Conversation type
- `packages/data-schemas/src/schema/transaction.ts` — Transaction Mongoose schema
- `packages/data-schemas/src/schema/message.ts` — Message schema (with MeiliSearch)

### Routes/API
- `api/server/routes/balance.js` — Balance endpoint
- `api/server/routes/convos.js` — Conversation CRUD
- `api/server/routes/messages.js` — Message retrieval/search
- `api/server/routes/search.js` — MeiliSearch health check
- `api/server/routes/admin/` — Admin routes (config, roles, groups)

### Client Export
- `client/src/hooks/Conversations/useExportConversation.ts` — Export logic (5 formats)
- `client/src/components/Nav/ExportConversation/ExportModal.tsx` — Export UI
- `client/src/components/Chat/ExportAndShareMenu.tsx` — Export trigger

### Logging
- `packages/data-schemas/src/config/winston.ts` — Logger configuration
- `api/server/middleware/logHeaders.js` — Header logging middleware

### Access Control
- `api/server/middleware/validate/convoAccess.js` — Conversation access validation

### CLI Tools
- `config/add-balance.js`, `config/list-balances.js`, `config/set-balance.js` — Balance management

### Configuration
- `.env.example:55-72` — Logging variables
- `.env.example:100-107` — Langfuse placeholders
- `.env.example:450-451` — Balance variables

---

## Security Considerations

- **Authentication/Authorization:** All data endpoints require JWT auth. Conversations are strictly user-scoped with no admin bypass.
- **Data Privacy:** No admin access to user chat content. MeiliSearch search is user-filtered. Export is client-side only.
- **Input Validation:** Conversation access validated and cached. Transaction updates use optimistic concurrency.
- **Tenant Isolation:** MeiliSearch plugin applies tenant isolation. All queries filter by user ID.

---

## Testing Strategy

- **Unit tests:** Token calculation accuracy, balance update concurrency, export format correctness
- **Integration tests:** Transaction creation → balance update flow, message indexing → search flow
- **Edge cases:** Race conditions on balance updates, very large conversation exports, expired temp chat behavior

---

## Documentation Needs

- **User-facing docs:** How to export conversations, how to view token balance
- **Developer docs:** Transaction data model, how to query usage data directly from MongoDB
- **Configuration docs:** Logging env vars, balance settings, MeiliSearch setup, temp chat retention

---

## Gaps and Opportunities

| Gap | Impact | Effort Estimate |
|-----|--------|-----------------|
| No usage analytics dashboard | Cannot see trends, top users, costs over time | Medium-High (new admin UI + API) |
| No admin access to user chats | Cannot audit or troubleshoot user issues from UI | Low-Medium (add admin route) |
| No server-side bulk export | Cannot export data for compliance/backup | Medium |
| Langfuse not implemented | No LLM observability (latency, quality, traces) | Medium |
| No auto-cleanup of expired chats | DB grows unbounded for temp chats | Low (MongoDB TTL index) |
| Token pricing hardcoded | Requires code change for new models/prices | Low (move to config) |
| No usage history API for users | Users see balance but not spending breakdown | Low-Medium |
