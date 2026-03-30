# SPEC-008-admin-reporting-dashboard

## Executive Summary
- **Based on Research:** RESEARCH-008-admin-reporting-dashboard.md
- **Creation Date:** 2026-03-30
- **Status:** Final (Revised 2026-03-30 -- post-critical-review)

This specification defines a built-in admin reporting dashboard for LibreChat that surfaces usage trends, user activity, and cost analysis. The feature consists of six backend API endpoints under `/api/admin/usage/*` and a minimal table-based frontend UI at `/d/reporting`, accessible only to administrators with the `READ_USAGE` capability. The implementation follows the "Option B + minimal table UI" approach recommended by research, shipping tables-only in v1 with optional charting deferred to v2.

## Research Foundation

### Production Issues Addressed
1. **No usage analytics dashboard** -- Admins currently have no way to view usage trends, costs, or top users without direct MongoDB shell access (RESEARCH-007 Gap #1, RESEARCH-008 Executive Summary).
2. **"How much did user X spend?"** -- The most common admin data need has no self-service answer; requires MongoDB Compass or shell queries (RESEARCH-008 Production Edge Cases).
3. **"Which model costs the most?"** -- Model cost breakdowns require aggregation pipelines not exposed via any existing API (RESEARCH-008 Production Edge Cases).
4. **Missing database indexes** -- Transaction collection lacks `createdAt` index, making any time-range query a collection scan (RESEARCH-008 Performance Concern #1).
5. **Unused `READ_USAGE` capability** -- Defined in the capability system but never wired to any route or middleware (RESEARCH-008 Security Considerations #1).

### Stakeholder Validation
- **Deployment admin (MemodoAI):** Needs self-service dashboard to track per-user costs, model popularity, and usage trends without MongoDB access. Does not need conversation content -- metadata and usage stats only.
- **DevOps:** Aggregation queries should support `readPreference: 'secondaryPreferred'` for replica set deployments to avoid impacting write performance on the primary node.
- **Finance:** Dashboard must clearly label costs as "internal LibreChat charges" (token credits), not provider invoice amounts. Differences arise from cancellation surcharges (1.15x) and custom endpoint pricing.
- **Security/compliance:** Dashboard access should be audit-logged. User activity endpoints may constitute employee monitoring in some jurisdictions; `READ_USAGE` capability should be grantable narrowly.
- **Support:** Needs quick answers to per-user spend and per-model cost questions without direct DB access.

### System Integration Points
- **Transaction collection** (`packages/data-schemas/src/schema/transaction.ts`) -- Primary data source for spend, token counts, model usage.
- **Conversation collection** (`packages/data-schemas/src/schema/convo.ts`) -- Source for conversation counts and user activity. Note: `user` field is String (not ObjectId).
- **User collection** (`packages/data-schemas/src/schema/user.ts`) -- User metadata (name, email) for join in top-users query.
- **Capability system** (`packages/data-schemas/src/admin/capabilities.ts`, `packages/api/src/middleware/capabilities.ts`) -- Authorization gate via `READ_USAGE`.
- **Admin route pattern** (`api/server/routes/admin/`) -- Existing JWT + `ACCESS_ADMIN` + capability middleware chain.
- **Pagination utility** (`packages/api/src/admin/pagination.ts`) -- Offset-based pagination with `parsePagination()`.
- **Dashboard routing** (`client/src/routes/Dashboard.tsx`) -- Existing `/d/*` route structure for embedded UI.
- **React Query** (`client/src/data-provider/`) -- Data fetching pattern for frontend hooks.
- **@tanstack/react-table** -- Already installed; used for tabular data display.

---

## Intent

### Problem Statement
LibreChat records detailed transaction data (token spend per user, model, conversation) and conversation metadata in MongoDB, but provides no API endpoints or UI to aggregate and present this data to administrators. The only way to answer basic operational questions -- total spend, top users by cost, most expensive models, usage trends over time -- is direct MongoDB access. This creates a dependency on technical staff for routine reporting needs and prevents non-technical admins from monitoring system usage.

### Solution Approach
Build a two-layer solution:

1. **Backend API layer** -- Six new endpoints under `/api/admin/usage/*` that run MongoDB aggregation pipelines on Transaction, Conversation, and User collections. Endpoints are gated by `ACCESS_ADMIN` + `READ_USAGE` capabilities and support date-range filtering, timezone-aware grouping, and offset-based pagination.

2. **Frontend table UI** -- A minimal admin-only page at `/d/reporting` that renders summary cards, usage trends, model cost breakdown, and user activity tables using `@tanstack/react-table` and Tailwind CSS. No charting library in v1; tables with conditional formatting provide the core reporting experience.

3. **Database indexes** -- Add compound indexes on Transaction collection to support time-range aggregation without collection scans.

### Expected Outcomes
- Admins can self-serve answers to "who spent how much on what model" questions.
- Usage trends visible by day/week/month with date range filtering.
- Token credit costs displayed alongside USD conversion (`tokenValue / 1,000,000`).
- API endpoints reusable by paid admin panel or external tooling.
- Query performance under 2 seconds for date-range aggregations with proper indexes.

---

## Success Criteria

### Functional Requirements

#### Date Parameter Defaults (applies to REQ-001 through REQ-006)

All reporting endpoints accept optional `startDate` and `endDate` query parameters (ISO 8601 format, e.g., `2026-01-01T00:00:00Z`). When omitted:
- `startDate` defaults to **30 days before the current server time**.
- `endDate` defaults to **the current server time**.
- Both parameters are optional individually -- omitting only `startDate` defaults it to 30 days before the provided `endDate`; omitting only `endDate` defaults it to now.
- If `endDate` is before `startDate`, return 400 Bad Request.
- If `endDate` is in the future, clamp it to the current server time.
- Maximum allowed date range: 366 days. Ranges exceeding this return 400 Bad Request with message "Date range cannot exceed 366 days."

#### API Response Envelope

All reporting endpoints use a consistent response envelope:

```json
{
  "status": "success",
  "data": { ... },
  "meta": {
    "startDate": "2026-03-01T00:00:00Z",
    "endDate": "2026-03-30T23:59:59Z",
    "generatedAt": "2026-03-30T14:22:00Z"
  }
}
```

Paginated endpoints add pagination metadata inside `meta`:
```json
{
  "meta": {
    "startDate": "...",
    "endDate": "...",
    "generatedAt": "...",
    "pagination": {
      "offset": 0,
      "limit": 50,
      "total": 247
    }
  }
}
```

#### Error Response Format

All error responses (400, 403, 404, 504) use a consistent format matching the existing LibreChat error pattern:

```json
{
  "status": "error",
  "message": "Human-readable error description",
  "errors": [
    { "field": "startDate", "message": "Must be a valid ISO 8601 date" }
  ]
}
```

The `errors` array is present only for 400 validation errors (populated from Zod). For 403 and 504, only `status` and `message` are returned.

#### Endpoint Definitions

- **REQ-001: Overview endpoint** -- `GET /api/admin/usage/overview` returns summary metrics for the specified period. Accepts `startDate`, `endDate` query parameters.

  **"Active user" definition:** A user who has at least one non-credit transaction (`tokenType != 'credits'`) in the specified date range. Users who only logged in or read conversations without generating transactions are NOT counted as active.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "totalRegisteredUsers": 142,
      "activeUsers": 87,
      "totalConversations": 3210,
      "totalTokenValue": 4500000,
      "totalTransactions": 12480,
      "cancellation": {
        "totalIncompleteSpend": 150000,
        "estimatedSurchargeAmount": 19565
      }
    },
    "meta": { "startDate": "...", "endDate": "...", "generatedAt": "..." }
  }
  ```

  Field definitions:
  - `totalRegisteredUsers` (integer): Count of all users in the tenant, regardless of date range.
  - `activeUsers` (integer): Distinct users with at least one non-credit transaction in the period.
  - `totalConversations` (integer): Conversations created in the period (from Conversation collection; includes archived conversations -- see MISS-006 resolution below).
  - `totalTokenValue` (integer): Sum of `tokenValue` for all non-credit transactions in the period. This total includes the cancellation surcharge baked into incomplete transactions.
  - `totalTransactions` (integer): Count of non-credit transactions in the period.
  - `cancellation.totalIncompleteSpend` (integer): Sum of `tokenValue` for all transactions where `context === 'incomplete'` in the period. This is the **total amount charged** for incomplete requests (already includes the 1.15x surcharge).
  - `cancellation.estimatedSurchargeAmount` (integer): The estimated surcharge portion only, computed as `Math.round(totalIncompleteSpend - (totalIncompleteSpend / 1.15))`. This represents the approximate incremental cost above what would have been charged without the cancellation policy.

  **Note on active user count:** Uses `$group` + `$count` aggregation (NOT `distinct()`) to avoid MongoDB's 16MB BSON document size limit for large user bases (DISC-003).

- **REQ-002: Trends endpoint** -- `GET /api/admin/usage/trends` returns time-series data grouped by day, week, or month. Accepts `startDate`, `endDate`, `granularity` (day|week|month, default: `day`), `timezone` (IANA timezone string, default: `UTC`) query parameters.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "buckets": [
        {
          "date": "2026-03-01",
          "totalTokenValue": 150000,
          "totalRawTokens": 5200000,
          "transactionCount": 412,
          "cancelledCount": 18
        },
        {
          "date": "2026-03-02",
          "totalTokenValue": 175000,
          "totalRawTokens": 6100000,
          "transactionCount": 487,
          "cancelledCount": 22
        }
      ]
    },
    "meta": {
      "startDate": "...", "endDate": "...", "generatedAt": "...",
      "granularity": "day",
      "timezone": "America/New_York"
    }
  }
  ```

  Field definitions:
  - `date` (string): Date label formatted per granularity -- day: `"2026-03-01"`, week: `"2026-W09"`, month: `"2026-03"`.
  - `totalTokenValue` (integer): Sum of `tokenValue` for non-credit transactions in the bucket.
  - `totalRawTokens` (integer): Sum of `$abs(rawAmount)` for non-credit transactions in the bucket.
  - `transactionCount` (integer): Count of non-credit transactions in the bucket.
  - `cancelledCount` (integer): Count of transactions where `context === 'incomplete'` in the bucket.

- **REQ-003: Model breakdown endpoint** -- `GET /api/admin/usage/models` returns per-model aggregation. Accepts `startDate`, `endDate` query parameters. Supports offset-based pagination via `parsePagination()`.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "models": [
        {
          "model": "gpt-4o",
          "totalTokenValue": 2100000,
          "promptTokens": 18000000,
          "completionTokens": 4500000,
          "transactionCount": 3200
        }
      ]
    },
    "meta": {
      "startDate": "...", "endDate": "...", "generatedAt": "...",
      "pagination": { "offset": 0, "limit": 50, "total": 12 }
    }
  }
  ```

  Field definitions:
  - `model` (string): Model name as stored on the Transaction document.
  - `totalTokenValue` (integer): Sum of `tokenValue` for this model.
  - `promptTokens` (integer): Sum of `$abs(rawAmount)` where `tokenType === 'prompt'`.
  - `completionTokens` (integer): Sum of `$abs(rawAmount)` where `tokenType === 'completion'`.
  - `transactionCount` (integer): Count of non-credit transactions for this model.

  Sorted by `totalTokenValue` descending (highest-cost model first).

- **REQ-004: Top users endpoint** -- `GET /api/admin/usage/users` returns per-user aggregation. Joined from Transaction.user (ObjectId) to User._id (ObjectId). Sorted by `totalTokenValue` descending. Accepts `startDate`, `endDate`, and optional `search` query parameters. Supports offset-based pagination.

  **Search parameter:** When `search` is provided (string, min length 2), filter results to users whose `name` or `email` contains the search string (case-insensitive). The search is applied after the aggregation via a `$match` stage on the joined user fields. This enables the common "How much did user X spend?" support query without requiring the admin to know the userId in advance.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "users": [
        {
          "userId": "507f1f77bcf86cd799439011",
          "name": "Jane Smith",
          "email": "jane@example.com",
          "totalTokenValue": 890000,
          "transactionCount": 1540
        }
      ]
    },
    "meta": {
      "startDate": "...", "endDate": "...", "generatedAt": "...",
      "pagination": { "offset": 0, "limit": 50, "total": 142 }
    }
  }
  ```

  Field definitions:
  - `userId` (string): The User._id as a hex string.
  - `name` (string): User's display name from User collection.
  - `email` (string): User's email from User collection.
  - `totalTokenValue` (integer): Sum of `tokenValue` for this user's non-credit transactions.
  - `transactionCount` (integer): Count of non-credit transactions for this user.

- **REQ-005: Single user detail endpoint** -- `GET /api/admin/usage/users/:userId` returns detailed spend breakdown for a specific user. Accepts `startDate`, `endDate` query parameters. The `userId` path parameter must be a valid MongoDB ObjectId hex string; invalid values return 400.

  This endpoint runs **two separate queries** and merges results in application code (due to EDGE-001 type mismatch):
  1. Transaction aggregation (by `user` ObjectId) for spend data.
  2. Conversation count query (by `user` String, using `userId.toString()`) for conversation count.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "userId": "507f1f77bcf86cd799439011",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "totalTokenValue": 890000,
      "transactionCount": 1540,
      "conversationCount": 312,
      "lastActiveDate": "2026-03-29T18:45:00Z",
      "modelBreakdown": [
        {
          "model": "gpt-4o",
          "totalTokenValue": 520000,
          "transactionCount": 980
        },
        {
          "model": "claude-sonnet-4-20250514",
          "totalTokenValue": 370000,
          "transactionCount": 560
        }
      ]
    },
    "meta": { "startDate": "...", "endDate": "...", "generatedAt": "..." }
  }
  ```

  Field definitions:
  - `userId` (string): The User._id as hex string.
  - `name` (string): User's display name.
  - `email` (string): User's email.
  - `totalTokenValue` (integer): Total spend across all models.
  - `transactionCount` (integer): Total non-credit transactions.
  - `conversationCount` (integer): Conversations created in the period (from Conversation collection, separate query). Includes archived conversations.
  - `lastActiveDate` (string, ISO 8601): Most recent `createdAt` from the user's transactions in the period, or `null` if no transactions.
  - `modelBreakdown` (array): Per-model spend for this user, sorted by `totalTokenValue` descending.

  If the `userId` does not exist, return 404 with message "User not found."

- **REQ-006: User activity endpoint** -- `GET /api/admin/usage/activity` returns per-user conversation activity. Sourced from Conversation collection only (no cross-collection join with Transaction). Accepts `startDate`, `endDate`, and optional `search` query parameters. Supports offset-based pagination.

  **Search parameter:** Same behavior as REQ-004 -- filters by user ID substring match (since Conversation stores user as String, not joined to User collection). Note: this searches the raw user ID string, not name/email, because REQ-006 does not join to the User collection.

  **Archived conversations:** Included in all counts. The `isArchived` field on Conversation does not affect reporting totals. Archival is a user-facing organizational feature, not a data lifecycle event.

  **Response schema:**
  ```json
  {
    "status": "success",
    "data": {
      "users": [
        {
          "userId": "507f1f77bcf86cd799439011",
          "conversationCount": 312,
          "lastActive": "2026-03-29T18:45:00Z",
          "models": ["gpt-4o", "claude-sonnet-4-20250514"],
          "endpoints": ["openAI", "anthropic"]
        }
      ]
    },
    "meta": {
      "startDate": "...", "endDate": "...", "generatedAt": "...",
      "pagination": { "offset": 0, "limit": 50, "total": 142 }
    }
  }
  ```

  Field definitions:
  - `userId` (string): The Conversation.user field value (String type -- this is the user's ObjectId as a string, consistent with how Conversation stores it).
  - `conversationCount` (integer): Number of conversations in the period.
  - `lastActive` (string, ISO 8601): Most recent `updatedAt` from the user's conversations.
  - `models` (array of strings): Distinct model names used across conversations.
  - `endpoints` (array of strings): Distinct endpoint names used across conversations.

- **REQ-007: Credits exclusion** -- All spend aggregation queries filter out `tokenType: 'credits'` entries (admin-granted credits, not AI usage). The filter `tokenType: { $ne: 'credits' }` is applied to every aggregation pipeline that computes cost totals.

- **REQ-008: Authorization gate** -- All `/api/admin/usage/*` endpoints require: (a) valid JWT via `requireJwtAuth`, (b) `ACCESS_ADMIN` capability, (c) `READ_USAGE` capability. Unauthorized requests receive 403 with body `{ "status": "error", "message": "Insufficient permissions. The READ_USAGE capability is required to access usage reports." }`.

- **REQ-009: Tenant isolation** -- All aggregation queries include `tenantId` filter for multi-tenant deployments. Admin sees only data for their tenant. The `tenantId` is sourced from the authenticated user's profile via `req.user.tenantId`, consistent with how existing admin routes in `api/server/routes/admin/` obtain tenant context. For single-tenant deployments where `tenantId` is undefined, the filter is omitted (no match on `tenantId`).

- **REQ-010: Frontend dashboard page** -- Admin-only route at `/d/reporting` renders four distinct sections:
  1. **Summary cards** (REQ-001 data): Registered users, active users, conversations, total spend, cancellation breakdown.
  2. **Usage trends table** (REQ-002 data): Time-series buckets with granularity selector.
  3. **Model breakdown table** (REQ-003 data): Per-model cost and token counts with pagination.
  4. **Top users by spend table** (REQ-004 data): Per-user spend with search and pagination.
  5. **User activity table** (REQ-006 data): Per-user conversation activity with pagination.

  REQ-004 and REQ-006 are rendered as **two separate tables**, not merged. REQ-004 shows spend data from Transactions; REQ-006 shows conversation activity from Conversations. They are displayed in sequence under a "Users" section heading. Each table fetches independently and has its own pagination controls. No client-side merging of the two data sources is required.

  Lazy-loaded to avoid bundle size impact for non-admin users.

- **REQ-011: Date range picker** -- Frontend provides preset date ranges (7 days, 30 days, 90 days, 1 year) and custom date range input. Selected range is passed to all API calls. Default selection on page load: "30 days" (matching the API default).

- **REQ-012: USD conversion display** -- All cost values are displayed as both token credits and USD equivalent. Format: "12,500 credits ($0.0125)". Conversion formula: `costUSD = tokenValue / 1,000,000`.

- **REQ-013: Cancellation breakdown** -- Overview cards display two cancellation metrics:
  1. **Total incomplete spend** (`cancellation.totalIncompleteSpend`): The full amount charged for all transactions where `context === 'incomplete'` in the period. This is the total cost including the baked-in 1.15x surcharge.
  2. **Estimated surcharge amount** (`cancellation.estimatedSurchargeAmount`): The approximate incremental cost attributable to the cancellation policy, computed as `Math.round(totalIncompleteSpend - (totalIncompleteSpend / 1.15))`.

  The UI labels the first metric as "Cancelled Request Spend" and the second as "Est. Cancellation Surcharge (~15%)". A tooltip or info note explains: "When a request is cancelled or incomplete, LibreChat applies a 15% surcharge to the token cost. 'Cancelled Request Spend' is the total charged for these requests. 'Est. Cancellation Surcharge' is the approximate amount above what would have been charged at normal rates."

  Trends data (REQ-002) includes `cancelledCount` per bucket but does not include per-bucket surcharge amounts (to keep the trends response lightweight).

- **REQ-014: Export capability** -- API endpoints return JSON that can be consumed programmatically. Frontend provides a "Download CSV" button for each table. CSV export behavior:
  - For **non-paginated** tables (trends): Exports all currently loaded data.
  - For **paginated** tables (models, top users, user activity): Exports **the current page only**. The button label reads "Export Current Page (CSV)". A full export would require fetching all pages, which contradicts the pagination approach; full data export is deferred to v2 (dedicated backend export endpoint).

- **REQ-015: MANAGE_USAGE capability** -- Add `MANAGE_USAGE` to the `SystemCapabilities` enum and `CapabilityImplications` map (where `MANAGE_USAGE` implies `READ_USAGE`). Not wired to any route in v1, but prevents a future schema-adjacent change when write operations are added.

- **REQ-016: Database indexes** -- Add the following compound indexes to the Transaction collection:
  - `{ createdAt: 1, tenantId: 1 }` -- for time-range queries with tenant filtering
  - `{ user: 1, createdAt: 1 }` -- for per-user time-range queries
  - `{ model: 1, createdAt: 1 }` -- for per-model time-range queries

- **REQ-017: Navigation entry point** -- A link to the reporting dashboard is added to the dashboard sidebar navigation, visible only to users with `role === ADMIN`. The link text is "Usage Reports" and appears below existing admin links (consistent with the sidebar pattern in `client/src/routes/Dashboard.tsx`). Non-admin users do not see this link. If an admin lacks the `READ_USAGE` capability, the link is still visible but the page displays a permission error message (per FAIL-002).

- **REQ-018: Data freshness and caching** -- React Query configuration for reporting hooks:
  - `staleTime`: 5 minutes (300,000 ms). Data is considered fresh for 5 minutes after fetch.
  - `gcTime` (garbage collection): 10 minutes.
  - No automatic background refetch (`refetchOnWindowFocus: false`).
  - A manual "Refresh" button is displayed in the dashboard header. Clicking it invalidates all reporting queries and triggers a refetch.
  - When the date range picker selection changes, all reporting queries are automatically refetched with the new parameters.

### Non-Functional Requirements

- **PERF-001: Query response time** -- All reporting API endpoints return within 2 seconds for collections up to 500K transactions, given proper indexes (REQ-016) are in place. **Precondition:** Before implementation begins, verify the production Transaction collection size by running `db.transactions.estimatedDocumentCount()`. If the count exceeds 500K documents, revisit this target and evaluate pre-aggregated daily rollup collections before building live aggregation endpoints.

- **PERF-002: Lazy loading** -- The reporting dashboard page and its dependencies are code-split and lazy-loaded so they do not affect bundle size or load time for non-admin users.

- **PERF-003: Rate limiting** -- Reporting endpoints have a dedicated rate limiter: 60 requests per minute per admin user. This accommodates the dashboard's load pattern (5 parallel API calls per page load, plus pagination and date range changes) while still preventing aggregation abuse. If rate-limited, the API returns 429 Too Many Requests.

- **SEC-001: No PII in aggregated data** -- Usage trend and model breakdown endpoints return only counts and sums, never conversation content or message text. User endpoints expose only name and email (already visible to admins via existing user management routes).

- **SEC-002: Audit logging** -- Each reporting API access emits a Winston log entry including: requesting user ID, endpoint path, date range queried, and timestamp.

- **SEC-003: Input validation** -- All query parameters (dates, pagination, granularity, timezone, userId) validated via Zod schemas. Invalid input returns 400 with the error response format defined above (including `errors` array from Zod).

- **UX-001: Internal charges labeling** -- Dashboard prominently labels all cost figures as "Internal Charges (Token Credits)" with a tooltip or info note explaining these may differ from actual provider invoices due to cancellation surcharges and custom endpoint pricing.

- **UX-002: Empty state** -- New deployments with zero transactions display a meaningful empty state ("No usage data yet") rather than errors or blank tables.

- **UX-003: Loading states** -- Each data section displays a loading skeleton while API calls are in flight. Error states display a retry button and descriptive error message.

- **UX-004: Responsive layout** -- Dashboard is usable on tablet-sized screens (768px+). Tables support horizontal scrolling on smaller viewports.

---

## Edge Cases (Research-Backed)

- **EDGE-001: Conversation.user (String) vs Transaction.user (ObjectId)**
  - **Research Reference:** RESEARCH-008 "Data Type Mismatch" section
  - **Current Behavior:** Conversation stores `user` as String; Transaction stores `user` as ObjectId. A `$lookup` between them requires type coercion (`$toString` or `$toObjectId`), which prevents index usage.
  - **Desired Behavior:** Transaction-based and Conversation-based queries are kept in separate pipelines. The single-user detail endpoint (REQ-005) runs two separate queries and merges results in application code.
  - **Test Approach:** Integration test that seeds a user, creates transactions and conversations for that user, calls REQ-005, and verifies both spend and conversation data are returned correctly.

- **EDGE-002: rateDetail not persisted**
  - **Research Reference:** RESEARCH-008 "rateDetail Field -- Persistence Analysis" section
  - **Current Behavior:** `rateDetail` (per-component input/write/read rates) is computed in-memory but stripped by Mongoose strict mode before persistence. Only the blended `rate` field is stored.
  - **Desired Behavior:** Dashboard uses the blended `tokenValue` and `rate` fields for cost display. No attempt to show per-component rate breakdowns in v1. If needed in v2, rates can be re-derived from stored `inputTokens`/`writeTokens`/`readTokens` + model lookup.
  - **Test Approach:** Unit test verifying that cost calculations using `tokenValue / 1,000,000` match expected USD for a transaction with known values, without relying on `rateDetail`.

- **EDGE-003: Cancellation surcharge baked into stored values**
  - **Research Reference:** RESEARCH-008 "Cancellation Surcharge Mechanism" section
  - **Current Behavior:** Transactions with `context === 'incomplete'` have `tokenValue` and `rate` already inflated by 1.15x. The surcharge is an internal policy, not a provider charge.
  - **Desired Behavior:** Dashboard totals include the surcharge. A separate cancellation breakdown (REQ-013) shows the total surcharged amount so admins understand the delta between internal charges and approximate provider costs.
  - **Test Approach:** Seed transactions with `context: 'incomplete'` and `context: 'message'`, verify that the overview endpoint returns both a total (including surcharge) and a separate cancellation total.

- **EDGE-004: tokenType 'credits' entries are admin grants**
  - **Research Reference:** RESEARCH-008 Data Integrity item #4 (credits vs. actual spend)
  - **Current Behavior:** Transactions with `tokenType: 'credits'` represent admin-granted balance credits, not AI usage.
  - **Desired Behavior:** All spend aggregations exclude `tokenType: 'credits'` via filter. The overview may optionally show total credits granted as a separate metric.
  - **Test Approach:** Seed both usage transactions and credit grant transactions, verify spend totals exclude credit grants.

- **EDGE-005: Agent batched transactions**
  - **Research Reference:** RESEARCH-008 Data Integrity item #5
  - **Current Behavior:** A single agent action can generate multiple Transaction documents with different `context` values ('message', 'summarization'). Aggregating by `conversationId` + `messageId` would be needed for per-interaction costs.
  - **Desired Behavior:** Dashboard aggregates at the transaction level (not the interaction level) for simplicity. Each transaction contributes individually to totals. A note in documentation explains that a single user action may correspond to multiple transactions.
  - **Test Approach:** Seed multiple transactions for the same conversationId with different context values, verify they are all counted individually in the trends and overview.

- **EDGE-006: endpointTokenConfig custom pricing**
  - **Research Reference:** RESEARCH-008 "Cost Calculation Flow" section (Path 2)
  - **Current Behavior:** When `endpointTokenConfig` is set, custom rates completely replace default `tokenValues` lookup. The stored `tokenValue` already reflects the custom rate.
  - **Desired Behavior:** Dashboard uses stored `tokenValue` as-is, which is correct regardless of pricing path. No special handling needed for custom-priced transactions.
  - **Test Approach:** Seed transactions with varying `rate` values (simulating custom pricing), verify aggregation sums use stored `tokenValue` without re-deriving from rate tables.

- **EDGE-007: Premium/tiered pricing**
  - **Research Reference:** RESEARCH-008 "Cost Calculation Flow" section (Path 3)
  - **Current Behavior:** Models in `premiumTokenValues` have rates that change based on prompt size. The stored `rate` reflects the premium rate when triggered.
  - **Desired Behavior:** Same as EDGE-006 -- stored `tokenValue` already accounts for premium pricing. No dashboard-level adjustment.
  - **Test Approach:** Covered by same test strategy as EDGE-006; verify stored values are used directly.

- **EDGE-008: Time zone handling for date grouping**
  - **Research Reference:** RESEARCH-008 UI/UX Edge Cases item #9
  - **Current Behavior:** MongoDB stores all dates in UTC.
  - **Desired Behavior:** The trends endpoint (REQ-002) accepts a `timezone` parameter and uses `$dateToString` with that timezone for date grouping. Frontend displays dates in the admin's local timezone.
  - **Test Approach:** Seed transactions spanning a UTC day boundary, request trends with a timezone offset (e.g., "America/New_York"), verify grouping buckets reflect the timezone.

- **EDGE-009: Large user base pagination**
  - **Research Reference:** RESEARCH-008 UI/UX Edge Cases item #8
  - **Current Behavior:** No admin reporting endpoints exist; existing admin list endpoints use offset-based pagination via `parsePagination()`.
  - **Desired Behavior:** User spend (REQ-004) and user activity (REQ-006) endpoints use offset-based pagination with configurable `limit` (default 50, max 200) and `offset` parameters, consistent with `parsePagination()`.
  - **Test Approach:** Seed 100+ users with transactions, request with offset=0/limit=10, then offset=10/limit=10, verify no duplicates and correct ordering.

- **EDGE-010: Empty deployment (no transaction data)**
  - **Research Reference:** RESEARCH-008 Testing Strategy -- "Empty data" test case
  - **Current Behavior:** N/A (no endpoints exist).
  - **Desired Behavior:** All endpoints return well-formed responses with zero values or empty arrays when no transaction data exists. No 500 errors.
  - **Test Approach:** Call each endpoint against a clean database with no transactions, verify 200 responses with zeroed summary fields and empty data arrays.

- **EDGE-011: Multi-tenant data isolation**
  - **Research Reference:** RESEARCH-008 Data Integrity item #7
  - **Current Behavior:** `tenantId` field exists on Transaction, Balance, and User.
  - **Desired Behavior:** Every aggregation pipeline includes a `tenantId` match stage. Admin of tenant A cannot see tenant B's data, even if they have `READ_USAGE` capability.
  - **Test Approach:** Seed transactions for two tenants, call endpoints as admin of tenant A, verify only tenant A data is returned.

---

## Failure Scenarios

- **FAIL-001: Missing database indexes**
  - **Trigger:** Deployment omits REQ-016 index creation; Transaction collection grows beyond 100K documents.
  - **Expected Behavior:** API endpoints still return correct results but response times degrade significantly (>10s). MongoDB slow query log warnings appear.
  - **User Communication:** API response includes an `X-Query-Slow` header or logs a warning when query execution exceeds 2 seconds, prompting admin to check index status.
  - **Recovery:** Run index creation commands against the Transaction collection. Indexes build in the background without downtime.

- **FAIL-002: Unauthorized access attempt**
  - **Trigger:** Non-admin user or admin without `READ_USAGE` capability calls a reporting endpoint.
  - **Expected Behavior:** 403 Forbidden response with a message indicating insufficient permissions. No data is returned.
  - **User Communication:** Frontend hides the reporting route/link for non-admin users entirely. If an admin lacks `READ_USAGE`, the page displays "You do not have permission to view usage reports. Contact your administrator to request the READ_USAGE capability."
  - **Recovery:** Admin grants `READ_USAGE` capability to the user's role or group.

- **FAIL-003: Invalid date range parameters**
  - **Trigger:** Client sends malformed dates, endDate before startDate, or dates in the far future.
  - **Expected Behavior:** 400 Bad Request with Zod validation error detailing which parameter is invalid.
  - **User Communication:** Frontend date range picker prevents invalid selections (endDate >= startDate, no future dates). If validation fails server-side, the error message is displayed inline.
  - **Recovery:** User corrects the date range input.

- **FAIL-004: MongoDB aggregation timeout**
  - **Trigger:** Very large collection (>1M transactions) with complex aggregation and missing or suboptimal indexes.
  - **Expected Behavior:** MongoDB operation times out after the configured `maxTimeMS` (set to 10 seconds on aggregation pipelines). API returns 504 Gateway Timeout.
  - **User Communication:** "Report generation timed out. Try a shorter date range or contact your administrator about database optimization."
  - **Recovery:** Admin adds missing indexes (REQ-016), reduces date range, or implements pre-aggregation for high-volume deployments.

- **FAIL-005: Data volume exceeds reasonable aggregation limits**
  - **Trigger:** A single query attempts to aggregate >500K documents (e.g., 1-year range on a high-volume deployment).
  - **Expected Behavior:** Query completes but may be slow. No memory issues because aggregation pipelines use MongoDB's streaming approach.
  - **User Communication:** If response time exceeds 5 seconds, display a note: "Large date ranges may take longer to load. Consider using a shorter period."
  - **Recovery:** Use shorter date ranges. For persistent performance issues, implement pre-aggregated daily rollup collections (v2 enhancement).

- **FAIL-006: Network or API error during frontend data fetch**
  - **Trigger:** API server unreachable, network timeout, or unexpected server error.
  - **Expected Behavior:** React Query retries once, then surfaces the error.
  - **User Communication:** Error banner in the dashboard: "Failed to load [section name]. [Retry button]." Each section fails independently; a failed trends query does not prevent the overview from displaying.
  - **Recovery:** User clicks retry. If persistent, check API server health.

- **FAIL-007: Concurrent index creation impacts write performance**
  - **Trigger:** REQ-016 indexes are created on a production database during peak usage.
  - **Expected Behavior:** MongoDB builds indexes in the background by default (MongoDB 4.2+). Writes continue but may experience slightly elevated latency during index build.
  - **User Communication:** Document in deployment guide: "Run index creation during off-peak hours for large collections."
  - **Recovery:** Index build completes automatically. If urgent, the `dropIndex` command can abort a build.

---

## Implementation Constraints

### Context Requirements
- The implementation must build on existing LibreChat patterns documented in RESEARCH-008 "Files That Matter" section.
- The capability system, admin route middleware, pagination utility, and React Query patterns are all pre-existing and must be reused, not reimplemented.
- Transaction data model is fixed; no schema changes to the Transaction document itself (indexes are additive, not schema-altering).

### Essential Files (from RESEARCH-008 "Files That Matter")
- `packages/data-schemas/src/admin/capabilities.ts` -- SystemCapabilities enum, READ_USAGE definition, CapabilityImplications map
- `packages/api/src/middleware/capabilities.ts` -- `generateCapabilityCheck()` / `requireCapability()` middleware
- `packages/data-schemas/src/schema/transaction.ts` -- Transaction Mongoose schema and indexes
- `packages/data-schemas/src/methods/transaction.ts` -- Transaction CRUD, cost calculation, cancellation surcharge
- `packages/data-schemas/src/methods/tx.ts` -- tokenValues, getMultiplier(), getCacheMultiplier()
- `packages/data-schemas/src/schema/convo.ts` -- Conversation schema (user is String, not ObjectId)
- `packages/data-schemas/src/schema/user.ts` -- User schema (name, email, role)
- `packages/api/src/admin/pagination.ts` -- parsePagination() offset-based pagination helper
- `api/server/routes/admin/` -- Existing admin route pattern (roles.js, groups.js, config.js)
- `api/server/routes/index.js` -- Admin route imports/exports
- `api/server/index.js` -- Route mounting at `/api/admin/*`
- `client/src/routes/Dashboard.tsx` -- Dashboard route structure (`/d/*`)
- `client/src/components/Chat/Input/Files/Table/DataTable.tsx` -- @tanstack/react-table usage pattern
- `client/src/data-provider/roles.ts` -- React Query mutation patterns for admin operations
- `packages/data-schemas/src/methods/index.ts` -- createMethods() factory
- `api/models/index.js` -- How createMethods is consumed

### Technical Constraints
- **No charting library in v1** -- The initial implementation uses `@tanstack/react-table` and Tailwind CSS for all data display. Charting is deferred to v2.
- **No cross-collection joins by user** -- Due to the Conversation.user (String) vs Transaction.user (ObjectId) mismatch, Transaction and Conversation queries must be separate pipelines, merged in application code where needed (EDGE-001).
- **Offset-based pagination only** -- All paginated endpoints use the existing `parsePagination()` utility (default limit 50, max 200). Cursor-based pagination is not used for admin routes.
- **tokenValue is the source of truth for cost** -- The formula `costUSD = tokenValue / 1,000,000` is correct regardless of pricing path (default, custom, premium). Do not re-derive costs from rate tables at query time.
- **rateDetail is unavailable** -- Per-component cost breakdowns (input/write/read) are not available from stored data. The blended `tokenValue` is the only reliable cost field (EDGE-002).
- **Existing admin panel is paid** -- This implementation adds API endpoints and a minimal table UI to the OSS codebase. It does not replace or duplicate the paid admin panel's functionality. The API design should be compatible with future adoption by the paid panel.
- **Multi-tenant support required** -- All queries must include `tenantId` filtering even if the current deployment is single-tenant.

---

## Validation Strategy

### Automated Testing

**Backend unit tests:**
- Aggregation pipeline correctness: Seed Transaction/User/Conversation documents with known values, run each endpoint's aggregation logic, verify sums, counts, and groupings match expected results.
- Authorization enforcement: Verify `READ_USAGE` capability is checked; test that (a) admin with `READ_USAGE` gets 200, (b) admin without `READ_USAGE` gets 403, (c) non-admin user gets 403.
- Date range validation: Test invalid dates, endDate < startDate, missing parameters, future dates.
- Pagination: Verify offset/limit behavior, default values, max limit enforcement, no duplicate records across pages.
- Tenant isolation: Seed data for two tenants, verify each admin sees only their tenant's data.
- Empty state: Call endpoints against empty collections, verify 200 with zeroed/empty responses.
- Credits exclusion: Seed `tokenType: 'credits'` transactions alongside usage transactions, verify credits are excluded from all spend totals.
- Cancellation surcharge: Seed `context: 'incomplete'` transactions, verify surcharge amounts appear in the cancellation breakdown and are included in totals.
- Cost verification: Seed a transaction with known `tokenValue`, verify `tokenValue / 1,000,000` matches expected USD.

**Frontend unit tests:**
- Component rendering with mock data (summary cards, tables, date picker).
- Admin gate: Non-admin user does not see the reporting route or navigation link.
- Loading and error states render correctly.
- Table sorting and pagination controls function.
- CSV export generates correct output from displayed data.
- Empty state displays meaningful message.

**Integration tests:**
- End-to-end API flow: Seed Transaction/User/Conversation documents, call each reporting endpoint via HTTP, verify response shape and data correctness against seeded values.
- Authorization chain: Verify the full middleware chain (JWT + ACCESS_ADMIN + READ_USAGE) rejects unauthorized requests at each level with appropriate status codes.
- Multi-endpoint consistency: Call overview (REQ-001) and trends (REQ-002) for the same date range, verify that the total tokenValue from trends buckets sums to the overview total.

**Edge case tests:**
- EDGE-001: Seed user with both transactions and conversations, call REQ-005, verify both spend and conversation data returned (separate queries, merged in application code).
- EDGE-003: Seed `context: 'incomplete'` and `context: 'message'` transactions, verify overview includes cancellation breakdown.
- EDGE-004: Seed `tokenType: 'credits'` alongside usage transactions, verify credits excluded from all spend totals.
- EDGE-005: Seed multiple transactions for same conversationId with different context values, verify individual counting.
- EDGE-008: Seed transactions spanning a UTC day boundary, request trends with non-UTC timezone, verify correct bucket assignment.
- EDGE-009: Seed 100+ users, paginate through REQ-004 results, verify no duplicates and correct descending sort.
- EDGE-010: Call all endpoints against empty database, verify 200 responses with zeroed/empty data.
- EDGE-011: Seed transactions for two tenants, verify tenant isolation for each endpoint.

### Manual Verification
- End-to-end walkthrough: Log in as admin, navigate to `/d/reporting`, verify all sections populate.
- Cross-reference dashboard totals with direct MongoDB queries on the same date range.
- Verify date range picker restricts to valid ranges and updates all sections.
- Verify pagination of user tables (navigate pages, verify consistent ordering).
- Verify authorization: Log in as non-admin, confirm reporting page is not accessible.
- Verify USD conversion labels appear alongside token credit values.
- Verify the "Internal Charges" labeling and tooltip are present and clear.

### Performance Validation
- Seed 500K transaction documents spanning 12 months.
- With REQ-016 indexes: All endpoints respond within 2 seconds (PERF-001).
- Without indexes: Document degraded response times for comparison (justifies index requirement).
- Verify that aggregation queries use indexes via `explain()` output.
- Measure frontend bundle size impact: Lazy-loaded reporting chunk should not increase main bundle.

---

## Dependencies and Risks

- **RISK-001: Data volume unknown [PRECONDITION -- MUST COMPLETE BEFORE IMPLEMENTATION]**
  - **Description:** The actual number of Transaction documents in the MemodoAI production database is unknown. Performance recommendations are based on estimates. PERF-001 guarantees 2-second response times only for collections up to 500K documents.
  - **Impact:** If volume exceeds 500K, the entire live-aggregation approach may be fundamentally inadequate, requiring pre-aggregated daily rollups instead.
  - **Mitigation:** Before any implementation code is written, run `db.transactions.estimatedDocumentCount()` and `db.transactions.stats()` on the production database. **If count exceeds 500K:** (a) revisit PERF-001 targets, (b) evaluate pre-aggregated rollup strategy, (c) consider limiting default date range to 7 days instead of 30 days. This is a go/no-go gate, not a background risk.

- **RISK-002: Paid admin panel overlap**
  - **Description:** LibreChat's paid admin panel may already include reporting features that overlap with this work. Building custom reporting when a paid solution covers 70%+ of needs would be wasted effort.
  - **Impact:** Potential rework or redundancy.
  - **Mitigation:** Before starting implementation, make a brief inquiry to the LibreChat team or review the paid panel's feature list to confirm no overlap. If significant overlap exists, consider purchasing the paid panel instead.

- **RISK-003: Index creation on production database**
  - **Description:** Adding compound indexes (REQ-016) on a large Transaction collection takes time and temporarily increases I/O.
  - **Impact:** Brief write latency increase during index build.
  - **Mitigation:** Schedule index creation during off-peak hours. MongoDB 4.2+ builds indexes in the background by default.

- **RISK-004: Aggregation impact on primary node [MEDIUM]**
  - **Description:** Heavy aggregation pipelines on the primary MongoDB node can impact write performance for all users.
  - **Impact:** Degraded application performance during report generation.
  - **Mitigation:** (a) Add a code comment on each aggregation query documenting that `readPreference: 'secondaryPreferred'` can be configured at the Mongoose query level for replica set deployments. (b) Include a "Performance Configuration" section in the deployment guide documenting how to enable secondary reads. (c) The implementation must NOT hardcode `readPreference` since it depends on deployment topology.

- **RISK-005: Frontend bundle size**
  - **Description:** Adding reporting components increases the client bundle.
  - **Impact:** Slower initial load for all users if not code-split.
  - **Mitigation:** Lazy-load the entire reporting page. No charting library in v1 keeps the reporting chunk minimal (table components + React Query hooks).

- **RISK-006: Token pricing changes**
  - **Description:** The `tokenValues` map in `tx.ts` is hardcoded and periodically updated. Historical transactions were priced at old rates; the stored `tokenValue` reflects the rate at transaction time.
  - **Impact:** Dashboard totals accurately reflect what was charged, but "current cost for the same usage" comparisons are not possible without rate history.
  - **Mitigation:** Document that dashboard costs reflect charges at time of usage. Do not attempt to retroactively re-price historical transactions.

- **RISK-007: Offset-based pagination with concurrent data changes [LOW]**
  - **Description:** Offset-based pagination on aggregation results (REQ-004, REQ-006) can produce duplicates or skipped records if new transactions are inserted between page requests.
  - **Impact:** Minor data inconsistency across pages. Acceptable for admin reporting where data is approximate by nature.
  - **Mitigation:** Acknowledged and accepted. Cursor-based pagination would be more correct but the spec intentionally uses offset for consistency with existing admin routes. No action required.

- **RISK-008: Data retention -- Transaction collection grows unbounded [LOW]**
  - **Description:** The Transaction collection has no TTL index or archival strategy. Over time it will grow without bound, degrading aggregation performance.
  - **Impact:** Gradually increasing query times as collection grows beyond initial volumes.
  - **Mitigation:** Deferred to v2. For v1, the maximum 366-day date range limit provides a natural cap on query scope. A future enhancement should evaluate TTL indexes or periodic archival jobs for transactions older than a configurable retention period (e.g., 2 years).

---

## Implementation Notes

### Suggested Approach

**Phase 1: Database preparation**
1. Query production DB for actual Transaction document count and collection size.
2. Add compound indexes (REQ-016) to Transaction schema definition.
3. Run index creation on production database.

**Phase 2: Backend API (estimated 2-3 days)**
1. Add `MANAGE_USAGE` to `SystemCapabilities` enum and `CapabilityImplications` map (REQ-015).
2. Create `api/server/routes/admin/usage.js` with six endpoints (REQ-001 through REQ-006).
3. Wire authorization: `requireJwtAuth` + `requireCapability(ACCESS_ADMIN)` + `requireCapability(READ_USAGE)`.
4. Implement aggregation pipelines from RESEARCH-008 "MongoDB Aggregation Pipelines Needed" section. **Note:** Research Pipeline #3 shows `$sort: { totalTokenValue: 1 }` (ascending) -- correct this to `totalTokenValue: -1` (descending) for the top-users endpoint per REQ-004.
5. Add Zod validation schemas for query parameters (SEC-003), including date defaults and max range enforcement.
6. Add audit logging for endpoint access (SEC-002).
7. Register routes in `api/server/routes/index.js` and mount in `api/server/index.js`.
8. Write backend unit and integration tests.

**Phase 3: Frontend UI (estimated 2-3 days)**
1. Create `client/src/components/Admin/Reporting/` directory with components: `ReportingDashboard`, `OverviewCards`, `UsageTrendsTable`, `ModelBreakdownTable`, `TopUsersTable`, `UserActivityTable`, `DateRangePicker`.
2. Add React Query hooks in `client/src/data-provider/` for the six API endpoints, with `staleTime: 300000` and `refetchOnWindowFocus: false` per REQ-018.
3. Add lazy-loaded route at `/d/reporting` in Dashboard routes, gated by admin role check.
4. Add "Usage Reports" navigation link in dashboard sidebar, visible only to admin users (REQ-017).
5. Implement CSV export for each table (current page only for paginated tables, per REQ-014).
6. Write frontend component tests.

### Deliberate Exclusions (Out of Scope for v1)

The following items were identified during research but are intentionally excluded from this specification:

1. **End-user usage view** (RESEARCH-008 Stakeholder section): End users may want to see their own usage breakdown (not just current balance). This is a separate feature from admin reporting, sharing the same Transaction data source but requiring different authorization, routes, and UI. It should not be built on top of the admin-only endpoints defined here.

2. **Feature flag gating** (RESEARCH-008 Documentation Needs): The reporting dashboard is not gated behind a `librechat.yaml` feature flag. It is available to all admins with `READ_USAGE` capability by default. If feature-flag gating is needed for a specific deployment, it can be added as a future enhancement without spec changes.

3. **Charting / visualization library**: v1 ships as table-only using `@tanstack/react-table`. Charting (e.g., recharts) is deferred to v2 if visual exploration proves valuable.

4. **Full data export**: Server-side bulk export (all pages) is deferred to v2. v1 exports current page only (REQ-014).

5. **Data retention / TTL indexes**: Transaction archival strategy is deferred (RISK-008).

### Critical Implementation Considerations

1. **Always filter `tokenType: { $ne: 'credits' }`** in every spend aggregation pipeline. Omitting this filter inflates totals with admin credit grants.

2. **Always include `tenantId` in `$match` stages** for multi-tenant correctness, even in single-tenant deployments.

3. **Use `$abs` on `rawAmount`** when summing token counts. Spend transactions store `rawAmount` as negative values; the absolute value gives the actual token count.

4. **Set `maxTimeMS` on aggregation pipelines** (recommended: 10000ms) to prevent runaway queries from blocking the database connection pool.

5. **The Transaction.user to User._id join works** (both ObjectId). The Conversation.user to Transaction.user join does NOT work without type coercion. Keep these query paths separate.

6. **Sort by `totalTokenValue: 1` (ascending) in model and user aggregations** means lowest spend first. For "top users by spend" the sort should be `totalTokenValue: -1` (descending). The research pipelines show ascending sort which should be corrected to descending for the top-users use case.

7. **Granularity date formats for `$dateToString`:**
   - Day: `"%Y-%m-%d"`
   - Week: `"%Y-W%V"` (ISO week number)
   - Month: `"%Y-%m"`

8. **USD conversion is display-only** -- Store and transmit `tokenValue` (integer token credits). Convert to USD (`tokenValue / 1,000,000`) only in the frontend display layer. This avoids floating-point precision issues in aggregation.

9. **readPreference configuration** -- Add a comment in the endpoint code documenting that `readPreference: 'secondaryPreferred'` can be configured at the Mongoose connection or query level for replica set deployments. Do not hardcode it, as it depends on deployment topology.
