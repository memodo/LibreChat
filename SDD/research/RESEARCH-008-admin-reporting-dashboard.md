# RESEARCH-008-admin-reporting-dashboard

**Research Question:** What infrastructure exists in LibreChat to build a built-in admin reporting dashboard for usage trends, user activity, and cost analysis?

**Date:** 2026-03-30
**Status:** COMPLETE (revised after critical review)
**Builds On:** RESEARCH-007 (usage-and-chat-logging)

---

## Executive Summary

LibreChat has the **backend data** and **authorization infrastructure** needed to build an admin reporting dashboard, but **no reporting UI or aggregation APIs exist today**. Key findings:

1. **Admin panel is a separate paid product** -- LibreChat sells the admin panel UI separately (`librechat.example.yaml:55`). The OSS repo provides only backend API routes (`/api/admin/*`) for config, roles, and groups management. Building a reporting dashboard within the main LibreChat client UI would be a custom addition outside the official admin panel pattern.

2. **Capability-based authorization is ready** -- A `READ_USAGE` capability already exists in `SystemCapabilities` (`packages/data-schemas/src/admin/capabilities.ts:32`) but is currently unused by any middleware or route. This is the intended gate for usage reporting access. Note: no `MANAGE_USAGE` counterpart exists yet -- see "Future-Proofing" section below.

3. **Transaction data supports aggregation** -- Every token spend is recorded with user, model, tokenType, rawAmount, tokenValue, rate, timestamps, and conversationId. However, the Transaction schema lacks a `createdAt` index, which would be required for efficient time-range queries.

4. **No charting library is installed** -- The client has `@tanstack/react-table` (already used for file listings), Radix UI, Tailwind, and Ariakit, but no charting library (no recharts, d3, nivo, etc.). For a small admin team, a table-only v1 with conditional formatting may be sufficient and avoids adding a dependency.

5. **Two deployment strategies** -- Either (a) embed reporting in the main LibreChat client as an admin-only route, or (b) add API endpoints that a separate admin panel can consume. Strategy (a) is simpler and self-contained; strategy (b) follows LibreChat's existing architecture.

---

## System Data Flow

### Transaction Recording Flow (from RESEARCH-007, extended)
1. User sends message -> AI client processes -> token count calculated
2. `spendTokens()` called -> `packages/data-schemas/src/methods/spendTokens.ts:26-73`
3. `createTransaction()` or `createStructuredTransaction()` writes Transaction document -> `packages/data-schemas/src/methods/transaction.ts:297-369`
4. Transaction stores: `user` (ObjectId ref to User), `model`, `tokenType` (prompt|completion|credits), `rawAmount`, `tokenValue`, `rate`, `conversationId`, `context`, `valueKey`, `inputTokens`, `writeTokens`, `readTokens`, `messageId`, plus `createdAt`/`updatedAt` from timestamps
5. Balance updated atomically -> `transaction.ts:176-263`

### Cost Calculation Flow (endpointTokenConfig and tokenValues)

**This section addresses the critical review finding that the cost model was incompletely analyzed.**

There are two pricing paths, determined at transaction creation time:

**Path 1: Default pricing (`tokenValues`)** -- When `endpointTokenConfig` is NOT set:
- `getMultiplier()` at `packages/data-schemas/src/methods/tx.ts:405-447` looks up the model in the `tokenValues` map (tx.ts:105-272) using `valueKey` or pattern matching
- The `rate` stored on the Transaction reflects the per-1M-token rate from `tokenValues`
- For structured tokens, `calculateStructuredTokenValue()` (`transaction.ts:95-169`) computes separate input/write/read multipliers from `cacheTokenValues` (tx.ts:278-328)

**Path 2: Custom pricing (`endpointTokenConfig`)** -- When `endpointTokenConfig` IS set:
- `getMultiplier()` short-circuits at tx.ts:420-421: `if (endpointTokenConfig && model) { return endpointTokenConfig[model][tokenType] ?? defaultRate; }`
- The custom rate **completely replaces** the `tokenValues` lookup
- `getCacheMultiplier()` similarly short-circuits at tx.ts:465-466 for cache pricing
- The resulting `rate` and `tokenValue` stored on the Transaction reflect the **custom rate**, not the default

**Path 3: Premium/tiered pricing** -- For models in `premiumTokenValues` (tx.ts:333-340), rates change based on prompt size:
- `getPremiumRate()` at tx.ts:387-400 checks if `inputTokenCount > threshold`
- Currently applies to `claude-opus-4-6`, `claude-sonnet-4-6`, and `gemini-3.1`
- The stored `rate` reflects the premium rate when triggered

**Key insight for dashboard:** The `tokenValue` field on stored transactions already reflects whatever pricing path was used (default, custom, or premium). The formula `costUSD = tokenValue / 1,000,000` remains correct regardless of pricing path. The `rate` field stores the effective per-1M-token rate that was applied. The `valueKey` field (when present) records which pricing tier was matched.

### `rateDetail` Field -- Persistence Analysis

**This section addresses the critical review finding about `rateDetail` not being in the schema.**

The `rateDetail` field is defined in two type interfaces:
- `InternalTxDoc` at `packages/data-schemas/src/methods/transaction.ts:33`: `rateDetail?: Record<string, number>`
- `TransactionData` at `packages/data-schemas/src/types/transaction.ts:16`: `rateDetail?: Record<string, number>`

It is populated by `calculateStructuredTokenValue()` at transaction.ts:121-125 with `{ input, write, read }` multipliers.

**However, `rateDetail` is NOT in the Mongoose schema** (`packages/data-schemas/src/schema/transaction.ts:23-66`). The Transaction schema does not set `strict: false` (no `strict` option is specified, and Mongoose defaults to `strict: true`). This means:

- **For `createTransaction()` / `createStructuredTransaction()`** (transaction.ts:297-369): These create a Mongoose document via `new Transaction(txData)`, then call `calculateStructuredTokenValue()` which sets `rateDetail` on the in-memory document. When `transaction.save()` is called, **Mongoose strict mode strips `rateDetail` because it is not in the schema**. The field is NOT persisted to MongoDB.
- **For `bulkInsertTransactions()`** (transaction.ts:411-422): This uses `Transaction.insertMany(docs)` where `docs` is `TransactionData[]` which includes `rateDetail`. However, `insertMany` on a strict-mode model also strips unknown fields.

**Conclusion:** `rateDetail` is computed in-memory for rate calculation purposes but is **not persisted** to MongoDB. Per-component cost breakdowns (input vs. write vs. read) cannot be reconstructed from stored transactions. The dashboard can only use the blended `rate` field. If per-component breakdowns are needed, the schema must be updated to include `rateDetail`.

**Workaround:** The individual `inputTokens`, `writeTokens`, and `readTokens` fields ARE stored. Combined with the `model` and `valueKey` fields, the per-component rates can be re-derived at query time by looking up the model in `tokenValues`/`cacheTokenValues`. This re-derivation would be approximate for transactions that used `endpointTokenConfig` unless the config is known at query time.

### Cancellation Surcharge Mechanism

**This section addresses the critical review finding about incomplete cancellation documentation.**

When a completion request is cancelled or incomplete:
- The `context` field is set to `'incomplete'` on the transaction
- `calculateTokenValue()` at transaction.ts:88-91 applies: `txn.tokenValue = Math.ceil(txn.tokenValue * 1.15)` and `txn.rate = txn.rate * 1.15`
- `calculateStructuredTokenValue()` at transaction.ts:161-169 does the same, and additionally inflates `rateDetail` values by 1.15x
- The `cancelRate` constant (1.15) is defined at transaction.ts:6 and also exported as `CANCEL_RATE` from `packages/data-schemas/src/utils/transactions.ts:3`

**Important for dashboard:** The stored `tokenValue` and `rate` for incomplete requests are **already inflated** by the 1.15x surcharge. This surcharge is an **internal LibreChat policy**, not a provider charge. The dashboard should:
1. Display the inflated value as "what was charged to the user's balance"
2. Optionally flag transactions with `context === 'incomplete'` and show base vs. surcharge breakdown
3. Document that totals will be ~15% higher than actual provider costs for cancelled requests
4. The `context` field can be filtered: `{ context: 'incomplete' }` identifies all surcharged transactions

Other `context` values found in the codebase: `'message'` (default for agent usage, `packages/api/src/agents/usage.ts:69`), `'summarization'` (for summarization sub-calls), and `'test'` (in test fixtures). These are informational and do not affect pricing -- only `'incomplete'` triggers the surcharge.

### Admin Authorization Flow
1. Request hits admin route -> JWT validated via `requireJwtAuth`
2. `requireCapability(SystemCapabilities.ACCESS_ADMIN)` checks principal grants -> `packages/api/src/middleware/capabilities.ts:160-191`
3. Principals resolved via `getUserPrincipals()` -> checks user's role + group memberships
4. `hasCapabilityForPrincipals()` queries `SystemGrant` collection -> `packages/data-schemas/src/methods/systemGrant.ts:31-65`
5. Capability implications checked (e.g., `MANAGE_USERS` implies `READ_USERS`) -> `packages/data-schemas/src/admin/capabilities.ts:47-56`
6. Per-request ALS cache avoids duplicate DB hits -> `packages/api/src/middleware/capabilities.ts:66-81`

### Data Available for Aggregation

**Transaction collection fields (indexable/aggregatable):**
- `user` (ObjectId, indexed) -- join to User for name/email
- `model` (String, indexed) -- model name
- `tokenType` (enum: prompt|completion|credits)
- `rawAmount` (Number) -- raw token count (negative = spend)
- `tokenValue` (Number) -- calculated cost value (already reflects endpointTokenConfig or premium pricing)
- `rate` (Number) -- effective $/1M tokens rate applied (may include 1.15x cancellation surcharge)
- `valueKey` (String) -- which pricing tier was matched (e.g., 'gpt-4o', 'claude-3-5-sonnet')
- `context` (String) -- transaction context ('message', 'summarization', 'incomplete', etc.)
- `conversationId` (String, indexed)
- `createdAt` (Date, NOT indexed -- needs index for time-range queries)
- `tenantId` (String, indexed)
- `inputTokens`, `writeTokens`, `readTokens` (Number) -- cache-aware token counts
- `messageId` (String)
- **NOT persisted:** `rateDetail`, `endpointTokenConfig`, `inputTokenCount` -- these are computed/used in-memory only

**Conversation collection fields:**
- `user` (**String** -- NOT ObjectId) -- see "Data Type Mismatch" section below
- `endpoint` (String), `model` (String), `title` (String)
- `createdAt`/`updatedAt` (timestamps)
- `isArchived` (Boolean)
- Indexes: `{ createdAt: 1, updatedAt: 1 }`, `{ conversationId: 1, user: 1, tenantId: 1 }` (unique)

**User collection fields:**
- `name`, `email`, `role`, `provider`, `createdAt`/`updatedAt`
- Indexed: `email+tenantId` (unique), `role+tenantId`

### Data Type Mismatch: Conversation.user (String) vs Transaction.user (ObjectId)

**This section addresses the critical review finding about the join mismatch.**

- `Conversation.user` is `type: String` (`packages/data-schemas/src/schema/convo.ts:18-20`)
- `Transaction.user` is `type: mongoose.Schema.Types.ObjectId` (`packages/data-schemas/src/schema/transaction.ts:26-30`)
- `User._id` is ObjectId (default Mongoose behavior)

**Impact on dashboard pipelines:**
- **Pipeline #3 (Top Users by Spend):** `$lookup` from Transaction.user (ObjectId) to users._id (ObjectId) -- **works correctly**, both are ObjectId.
- **Pipeline #4 (User Activity Summary):** Aggregates on `conversations.user` (String) -- **no join needed** if only counting conversations per user, but correlating with Transaction data requires type coercion.
- **Cross-collection correlation (Conversation + Transaction by user):** Would require `$toString` on Transaction.user or `$toObjectId` on Conversation.user. The `$toString` approach is preferred (convert ObjectId to String) since it always succeeds, but it **prevents index usage** on the converted field.

**Recommendation:** For the initial dashboard, keep Transaction and Conversation queries **separate** -- do not join them by user in a single pipeline. Pipeline #3 uses only Transaction + User (ObjectId-to-ObjectId, works). Pipeline #4 uses only Conversation (String user field, no join needed for counts). If a combined view is later needed (e.g., "user X spent Y on Z conversations"), use two queries and merge in application code, or add a `$toString` conversion stage accepting the index penalty.

---

## Stakeholder Mental Models

- **Product team / Deployment admin (Pablo/MemodoAI):** Wants to see: who is using the system, how much each user costs, which models are most popular, usage trends over time. Needs data to justify costs and plan capacity. Does not need to see chat content -- just metadata and usage stats. Expects a self-service dashboard that doesn't require MongoDB shell access.

- **Engineering team / LibreChat maintainers:** The admin panel is a separate paid product. Adding reporting to the OSS client would be outside that pattern. However, adding API endpoints under `/api/admin/usage` that serve aggregated data would be consistent with the existing admin route pattern and could be consumed by either the paid panel or a custom UI. Engineering concern: aggregation pipelines on large Transaction collections must be indexed properly; unindexed queries are a production risk.

- **Database administrator / DevOps:** Heavy aggregation pipelines on the primary MongoDB node can impact write performance. For replica set deployments, aggregation queries should use `readPreference: 'secondaryPreferred'` to route reads to secondary nodes. The `mongoose.Query` API supports `read('secondaryPreferred')`. This is a deployment-time configuration, not a code change, but the API endpoints should be designed to accept a configurable read preference.

- **Finance / accounting stakeholder:** The dashboard shows **internal LibreChat charges** (token credits deducted from user balances), which differ from actual provider invoices in two ways: (1) the 15% cancellation surcharge on incomplete requests inflates internal charges above provider costs, and (2) `endpointTokenConfig` custom rates may not match provider list prices. The dashboard should clearly label costs as "internal charges" and note that they may not match provider billing.

- **Support team:** Needs to quickly answer questions like "how much has user X spent this month?" or "which model is driving the most cost?" without direct DB access. Currently there is no support tooling -- all investigation requires MongoDB shell or Compass. A dashboard with per-user drill-down would eliminate the most common support queries.

- **Security / compliance stakeholder:** Beyond authorization, audit logging for dashboard access may be required in regulated environments -- knowing who accessed usage data and when. The user activity endpoints could be considered employee monitoring in some jurisdictions (EU GDPR, etc.). Consider adding audit log entries for reporting API access. Also, the existing `READ_USAGE` capability should be documented in the admin guide so that access can be granted narrowly.

- **End users:** May want to see their own usage breakdown (not just current balance). This is a separate feature from admin reporting but shares the same data source. Users currently see only a single balance number with no history or breakdown.

---

## Production Edge Cases

### Historical Issues and Community Patterns
- **No specific GitHub issues exist for a reporting dashboard** -- LibreChat's issue tracker does not have filed issues requesting an admin reporting feature in the OSS repo, because the admin panel is a separate paid product. The demand surfaces instead through community Discord discussions and deployment-specific needs (like MemodoAI's cost tracking requirement). Note: the LibreChat Discord and paid admin panel feature list were not directly surveyed -- the absence of GitHub issues does not confirm absence of existing solutions or demand.
- **Paid admin panel status unknown** -- The paid admin panel may already include reporting features that overlap with this work. Before investing heavily in custom reporting, a brief inquiry to the LibreChat team or review of the paid panel's documentation is recommended. If the paid panel covers 70%+ of the need, purchasing may be cheaper than building.
- **Support ticket pattern: "How much did user X spend?"** -- Without a dashboard, the only way to answer per-user spend questions is via direct MongoDB queries. This is the most common admin data need identified in RESEARCH-007.
- **Support ticket pattern: "Which model costs the most?"** -- Model cost breakdown requires aggregation pipelines that are not exposed via any existing API endpoint.
- **Error log pattern: slow queries** -- Deployments with >100K transactions and no `createdAt` index will see slow query warnings in MongoDB logs when attempting time-range filters on the Transaction collection. This is a known risk documented below.

### Performance Concerns
1. **Missing `createdAt` index on Transaction** -- `packages/data-schemas/src/schema/transaction.ts:23-66`: The schema defines indexes on `user`, `conversationId`, `model`, and `tenantId`, but NOT on `createdAt`. Any time-range aggregation (`$match` on date range) will do a collection scan. For a production system with millions of transactions, a compound index like `{ createdAt: 1, user: 1 }` or `{ createdAt: 1, model: 1 }` is critical.

2. **No pre-aggregated data** -- Every dashboard query would run MongoDB aggregation pipelines on raw transaction documents. For high-volume deployments, this could be slow. Consider materialized views or periodic aggregation jobs. **However:** the actual data volume for MemodoAI is currently unknown. Before investing in pre-aggregation infrastructure, query `db.transactions.estimatedDocumentCount()` and `db.transactions.stats()` on the production database. If the collection is under 100K documents, simple queries with proper indexes will likely suffice.

3. **Token pricing is stored on the transaction** -- The `rate` field stores the effective per-1M-token rate that was applied (including `endpointTokenConfig` overrides, premium tiering, and cancellation surcharge). The `tokenValue` field stores the computed cost in token credits. The formula `costUSD = tokenValue / 1,000,000` converts to USD (per `packages/data-schemas/src/schema/balance.ts:12` comment: "1000 tokenCredits = 1 mill ($0.001 USD)"). This formula is correct regardless of which pricing path was used, because `tokenValue` already reflects the effective rate. **Verification step:** Before deploying the dashboard, send a test message with a known model, retrieve the Transaction document from MongoDB, and manually verify the math end-to-end.

4. **Credits vs. actual spend** -- Transactions with `tokenType: 'credits'` represent admin-granted credits, not actual AI usage. Aggregation queries must filter these out when computing usage costs. The filter `tokenType: { $ne: 'credits' }` is correct and sufficient -- there are no other non-usage tokenType values.

### Data Integrity
5. **Agent batched transactions** -- `packages/api/src/agents/usage.ts` batches multiple sub-transactions for agent tool calls. A single user action may generate multiple Transaction documents with different `context` values ('message', 'summarization'). Aggregating by `conversationId` + `messageId` may be needed to get per-interaction costs.

6. **Cancelled requests** -- The `cancelRate` of 1.15 (`transaction.ts:6`, also exported as `CANCEL_RATE` from `packages/data-schemas/src/utils/transactions.ts:3`) applies a 15% surcharge when `context === 'incomplete'` AND `tokenType === 'completion'`. The surcharge is applied to both `tokenValue` and `rate` before persistence. These transactions are identifiable via `context: 'incomplete'` in the stored document. The dashboard should consider displaying a cancellation surcharge breakdown for transparency (total surcharged amount = sum of `tokenValue` where `context === 'incomplete'`).

7. **Multi-tenant isolation** -- `tenantId` field exists on Transaction, Balance, and User. All aggregation queries must include tenant filtering for multi-tenant deployments.

### UI/UX Edge Cases
8. **Large user base** -- User activity tables need server-side pagination. **Correction:** The existing admin routes for roles and groups use **offset-based pagination** (not cursor-based) via `parsePagination()` at `packages/api/src/admin/pagination.ts:4-17`, which parses `limit` and `offset` query params with `DEFAULT_PAGE_LIMIT=50` and `MAX_PAGE_LIMIT=200`. The `getConvosByCursor()` pattern is for user-facing conversation lists, not admin routes. New admin reporting endpoints should follow the **offset-based** pattern for consistency with other admin APIs.

9. **Time zone handling** -- MongoDB stores UTC. The dashboard must convert to the admin's local timezone for display. Date grouping (daily/weekly/monthly) should happen server-side using `$dateToString` with timezone parameter.

---

## Files That Matter

### Admin Infrastructure
- `api/server/middleware/roles/admin.js:1-14` -- Simple `checkAdmin` middleware (role === ADMIN check)
- `packages/api/src/middleware/capabilities.ts:88-194` -- `generateCapabilityCheck()` factory for fine-grained capability authorization
- `packages/data-schemas/src/admin/capabilities.ts:21-41` -- `SystemCapabilities` enum, including unused `READ_USAGE` at line 32
- `packages/data-schemas/src/admin/capabilities.ts:156-199` -- `CAPABILITY_CATEGORIES` array defining UI groupings (`READ_USAGE` is in the 'system' category at line 198)
- `packages/data-schemas/src/methods/systemGrant.ts:21-65` -- `hasCapabilityForPrincipals()` for capability checking
- `packages/data-schemas/src/types/admin.ts:1-120` -- Admin API response types

### Admin Routes (existing pattern to follow)
- `api/server/routes/admin/auth.js:1-127` -- Admin auth (login, verify, OAuth)
- `api/server/routes/admin/config.js:1-40` -- Config management (CRUD)
- `api/server/routes/admin/roles.js:1-43` -- Role management with `requireReadRoles`/`requireManageRoles`
- `api/server/routes/admin/groups.js:1-41` -- Group management
- `api/server/routes/index.js:4-7,36-39` -- Admin route imports and exports
- `api/server/index.js:155-158` -- Route mounting at `/api/admin/*`
- `packages/api/src/admin/pagination.ts:1-17` -- Offset-based pagination helper used by all admin list endpoints

### Transaction Data (source for reporting)
- `packages/data-schemas/src/schema/transaction.ts:1-68` -- Transaction Mongoose schema (indexes on user, conversationId, model, tenantId; NO createdAt index; `strict: true` by default -- strips unknown fields like `rateDetail`)
- `packages/data-schemas/src/methods/transaction.ts:1-438` -- Transaction CRUD methods, cost calculation logic, cancellation surcharge
- `packages/data-schemas/src/methods/transaction.ts:75-92` -- `calculateTokenValue()` -- simple pricing path
- `packages/data-schemas/src/methods/transaction.ts:95-169` -- `calculateStructuredTokenValue()` -- cache-aware pricing with `rateDetail` (in-memory only)
- `packages/data-schemas/src/methods/transaction.ts:374-382` -- `getTransactions(filter)` query method
- `packages/data-schemas/src/methods/transaction.ts:400-403` -- `deleteTransactions(filter)`
- `packages/data-schemas/src/methods/transaction.ts:411-422` -- `bulkInsertTransactions(docs)`
- `packages/data-schemas/src/schema/balance.ts:1-45` -- Balance schema (tokenCredits comment: "1000 tokenCredits = 1 mill ($0.001 USD)")
- `packages/data-schemas/src/methods/tx.ts:105-272` -- `tokenValues` mapping model names to prompt/completion rates ($/1M tokens)
- `packages/data-schemas/src/methods/tx.ts:278-328` -- `cacheTokenValues` for cache-aware pricing (write/read rates)
- `packages/data-schemas/src/methods/tx.ts:333-340` -- `premiumTokenValues` for tiered pricing above token thresholds
- `packages/data-schemas/src/methods/tx.ts:405-447` -- `getMultiplier()` -- the core pricing function, short-circuits for `endpointTokenConfig`
- `packages/data-schemas/src/methods/tx.ts:452-483` -- `getCacheMultiplier()` -- cache pricing, also short-circuits for `endpointTokenConfig`
- `packages/data-schemas/src/utils/transactions.ts:3` -- `CANCEL_RATE = 1.15` exported constant
- `packages/data-schemas/src/types/transaction.ts:1-17` -- `TransactionData` interface (includes `rateDetail` but this is not persisted)

### User/Conversation Data
- `packages/data-schemas/src/schema/user.ts:26-158` -- User schema (name, email, role, provider, timestamps)
- `packages/data-schemas/src/methods/user.ts:47-66` -- `findUsers()` and `countUsers()` methods
- `packages/data-schemas/src/schema/convo.ts:1-54` -- Conversation schema (**`user` is String, not ObjectId** -- type mismatch with Transaction.user)
- `packages/data-schemas/src/schema/convo.ts:47-49` -- Conversation indexes: `{ createdAt: 1, updatedAt: 1 }`, `{ conversationId: 1, user: 1, tenantId: 1 }` (unique)
- `packages/data-schemas/src/methods/conversation.ts:23-33` -- `getConvosByCursor()` with cursor pagination pattern (user-facing, not admin pattern)
- `packages/data-schemas/src/schema/message.ts:1-80` -- Message schema (model, endpoint, tokenCount, sender, timestamps)

### Agent Transaction Handling
- `packages/api/src/agents/usage.ts:56-100` -- `recordCollectedUsage()` -- batches agent sub-transactions with `context` values: 'message' (default), 'summarization'
- `packages/api/src/agents/transactions.ts:1-50` -- `prepareTokenSpend()` and `prepareStructuredTokenSpend()` for bulk transaction preparation

### Frontend Patterns
- `client/src/routes/Dashboard.tsx:1-82` -- Dashboard route structure (`/d/*`)
- `client/src/routes/Layouts/Dashboard.tsx:1-36` -- Dashboard layout component
- `client/src/routes/index.tsx:34-136` -- Router configuration (dashboard routes at line 97)
- `client/src/hooks/AuthContext.tsx:49-53` -- `useGetRole` for USER and ADMIN role fetching
- `client/src/components/ui/AdminSettingsDialog.tsx:97-274` -- Admin-only UI pattern (`user?.role !== SystemRoles.ADMIN` guard at line 144)
- `client/src/components/Chat/Input/Files/Table/DataTable.tsx:1-50` -- `@tanstack/react-table` usage pattern
- `client/src/data-provider/roles.ts:1-283` -- React Query mutation patterns for admin operations
- `packages/client/src/components/Table.tsx` -- Shared Table component
- `packages/client/src/components/DataTable.tsx` -- Shared DataTable component

### Existing Test Coverage Gaps
- **No tests for Transaction aggregation** -- `packages/data-schemas/src/methods/transaction.ts` has `getTransactions(filter)` but no tests verifying aggregation pipeline results (sum, group, date-range). All new aggregation logic will need tests from scratch.
- **No tests for `READ_USAGE` capability enforcement** -- Since `READ_USAGE` is defined but never used, there are no middleware tests asserting it blocks unauthorized access. Tests for other capabilities (e.g., `READ_ROLES`, `MANAGE_ROLES`) in the admin routes can serve as patterns.
- **No frontend tests for admin-only dashboard routes** -- The existing `Dashboard.tsx` route has no test coverage. New reporting components will need their own test suite.

### Methods Index
- `packages/data-schemas/src/methods/index.ts:108-210` -- `createMethods()` factory that wires all DB methods together
- `api/models/index.js:1-22` -- How `createMethods` is consumed (all methods spread onto `module.exports`)

---

## Security Considerations

### Authorization Strategy
1. **Use `READ_USAGE` capability** -- Already defined at `packages/data-schemas/src/admin/capabilities.ts:32` but not enforced anywhere. New reporting endpoints should use `requireCapability(SystemCapabilities.READ_USAGE)` following the pattern in `api/server/routes/admin/roles.js:11`.

2. **Require `ACCESS_ADMIN` as baseline** -- All admin routes require both JWT auth and `ACCESS_ADMIN` capability. Reporting routes should follow: `router.use(requireJwtAuth, requireAdminAccess)` then individual routes add `requireCapability(SystemCapabilities.READ_USAGE)`.

3. **Plan for `MANAGE_USAGE` capability** -- Every other resource type in `SystemCapabilities` has both READ and MANAGE variants (users, groups, roles, configs, agents, prompts, assistants). `READ_USAGE` exists but `MANAGE_USAGE` does not. Even if the initial dashboard is read-only, adding `MANAGE_USAGE` to the `SystemCapabilities` enum and `CapabilityImplications` map during implementation avoids a later schema-adjacent change when write operations (credit grants, balance adjustments, data export) are needed. This is a code-only addition to `capabilities.ts` -- no database migration required.

4. **No PII in aggregated data** -- Usage trend APIs should return aggregated data (counts, sums, averages) without exposing conversation content. User activity APIs should show usernames/emails but never message text.

5. **Tenant isolation** -- All queries must filter by `tenantId` for multi-tenant deployments. The capability system already supports tenant-scoped grants (`systemGrant.ts:57-59`).

6. **Audit logging consideration** -- In regulated environments, dashboard access should be audit-logged. Consider emitting a log entry (via existing Winston logger) when reporting endpoints are accessed, including the requesting user ID, endpoint, and date range queried.

### Data Access Boundaries
7. **Conversation content is off-limits** -- Per RESEARCH-007, conversation access is strictly user-scoped (`api/server/middleware/validate/convoAccess.js:60`). The reporting dashboard should only access metadata (counts, models used, timestamps) not message content.

8. **Rate limiting** -- Aggregation queries can be expensive. Admin reporting endpoints should have their own rate limiter, more permissive than user-facing routes but still bounded.

9. **Input validation** -- Date range parameters, pagination limits, and filter values must be validated. Use Zod schemas consistent with the codebase pattern.

---

## MongoDB Aggregation Pipelines Needed

### 1. Usage Over Time (line chart / table)
```javascript
// Aggregate token spend by day/week/month
db.transactions.aggregate([
  { $match: { createdAt: { $gte: startDate, $lte: endDate }, tokenType: { $ne: 'credits' } } },
  { $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } },
      totalTokenValue: { $sum: "$tokenValue" },
      totalRawAmount: { $sum: { $abs: "$rawAmount" } },
      transactionCount: { $sum: 1 },
      cancelledCount: { $sum: { $cond: [{ $eq: ["$context", "incomplete"] }, 1, 0] } }
  }},
  { $sort: { _id: 1 } }
])
// REQUIRES: compound index { createdAt: 1, tokenType: 1 }
```

### 2. Cost by Model (bar chart / pie chart / table)
```javascript
db.transactions.aggregate([
  { $match: { createdAt: { $gte: startDate, $lte: endDate }, tokenType: { $ne: 'credits' } } },
  { $group: {
      _id: "$model",
      totalTokenValue: { $sum: "$tokenValue" },
      promptTokens: { $sum: { $cond: [{ $eq: ["$tokenType", "prompt"] }, { $abs: "$rawAmount" }, 0] } },
      completionTokens: { $sum: { $cond: [{ $eq: ["$tokenType", "completion"] }, { $abs: "$rawAmount" }, 0] } },
      transactionCount: { $sum: 1 }
  }},
  { $sort: { totalTokenValue: 1 } }
])
```

### 3. Top Users by Spend (table)
```javascript
db.transactions.aggregate([
  { $match: { createdAt: { $gte: startDate, $lte: endDate }, tokenType: { $ne: 'credits' } } },
  { $group: {
      _id: "$user",
      totalTokenValue: { $sum: "$tokenValue" },
      transactionCount: { $sum: 1 }
  }},
  { $sort: { totalTokenValue: 1 } },
  { $skip: offset },  // offset-based pagination (consistent with admin pattern)
  { $limit: limit },
  { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userInfo" } },
  { $unwind: "$userInfo" },
  { $project: { name: "$userInfo.name", email: "$userInfo.email", totalTokenValue: 1, transactionCount: 1 } }
])
// NOTE: Transaction.user is ObjectId, User._id is ObjectId -- join works correctly.
// REQUIRES: index on { createdAt: 1, user: 1 }
```

### 4. User Activity Summary (table)
```javascript
// NOTE: Conversation.user is String (not ObjectId). Do NOT attempt to join with
// Transaction collection by user in the same pipeline without $toString/$toObjectId conversion.
// Keep this as a separate query from Transaction-based pipelines.
db.conversations.aggregate([
  { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
  { $group: {
      _id: "$user",
      conversationCount: { $sum: 1 },
      lastActive: { $max: "$updatedAt" },
      models: { $addToSet: "$model" },
      endpoints: { $addToSet: "$endpoint" }
  }},
  { $sort: { conversationCount: -1 } },
  { $skip: offset },
  { $limit: limit }
])
// Conversation already has index: { createdAt: 1, updatedAt: 1 }
```

### 5. System Overview (dashboard cards)
```javascript
// Active users in period
db.transactions.distinct("user", { createdAt: { $gte: startDate } }).length
// Total conversations in period
db.conversations.countDocuments({ createdAt: { $gte: startDate } })
// Total token spend in period
db.transactions.aggregate([
  { $match: { createdAt: { $gte: startDate }, tokenType: { $ne: 'credits' } } },
  { $group: { _id: null, total: { $sum: "$tokenValue" } } }
])
// Total registered users
db.users.countDocuments()
// Cancellation surcharge total in period
db.transactions.aggregate([
  { $match: { createdAt: { $gte: startDate }, context: 'incomplete' } },
  { $group: { _id: null, total: { $sum: "$tokenValue" } } }
])
```

---

## Testing Strategy

### Backend Tests
- **Aggregation pipeline correctness** -- Unit tests with seeded Transaction/User/Conversation data, verify aggregation results match expected sums/counts/groupings
- **Authorization** -- Verify `READ_USAGE` capability is enforced; non-admin users get 403; admin without `READ_USAGE` grant gets 403
- **Date range validation** -- Edge cases: invalid dates, future dates, very large ranges, timezone handling
- **Pagination** -- Offset-based pagination for user activity tables (consistent with admin route pattern at `packages/api/src/admin/pagination.ts`); verify correct ordering, offset/limit behavior, and no duplicates
- **Tenant isolation** -- Multi-tenant: admin of tenant A cannot see tenant B's data
- **Empty data** -- New deployment with no transactions should return empty results, not errors
- **Cost calculation verification** -- End-to-end test: seed a transaction with known model/tokens, verify `tokenValue / 1,000,000` produces expected USD, both with default and endpointTokenConfig pricing

### Frontend Tests
- **Component rendering** -- Dashboard renders correctly with mock data; loading states; error states
- **Admin gate** -- Non-admin users do not see dashboard route/link
- **Date range selector** -- Correct date formatting, range validation
- **Chart rendering** -- If charting library added, verify data-to-visual mapping
- **Table sorting/filtering** -- User activity table with `@tanstack/react-table` patterns

### Integration Tests
- **End-to-end flow** -- Seed transactions, hit reporting API, verify response matches expected aggregation
- **Performance** -- With large dataset (100K+ transactions), verify queries complete within acceptable time (<2s) with proper indexes
- **Cancellation surcharge accuracy** -- Seed normal and incomplete transactions, verify dashboard totals correctly include surcharges and breakdowns are accurate

---

## Documentation Needs

### Developer Documentation
- **API reference** for new `/api/admin/usage/*` endpoints (request params, response shapes, error codes)
- **Database index requirements** -- Document which indexes must be added for acceptable performance
- **Cost calculation documentation** -- Explain: (1) `tokenValue / 1,000,000 = USD`, (2) `tokenValue` already reflects effective rate from default/custom/premium pricing, (3) cancelled requests include 15% surcharge in `tokenValue` and `rate`, (4) `rateDetail` is NOT persisted, per-component rates must be re-derived from `inputTokens`/`writeTokens`/`readTokens` + model lookup

### Admin Documentation
- **Dashboard feature guide** -- What each metric means, how costs are calculated, how to interpret usage trends
- **Cost disclaimer** -- Dashboard shows internal LibreChat charges, not provider invoice amounts. Differences arise from cancellation surcharges and custom endpoint pricing.
- **Permission setup** -- How to grant `READ_USAGE` capability to non-superadmin roles
- **Performance considerations** -- For very large deployments, recommendation to set up TTL indexes or periodic data archival

### Configuration Documentation
- **Feature flag** -- If reporting is gated behind a feature flag in `librechat.yaml`
- **Data retention** -- How long transaction data should be kept for reporting vs. storage costs

---

## Implementation Architecture Options

### Option A: Embedded in Main Client
- Add admin-only route `/d/reporting` in existing dashboard routes (`client/src/routes/Dashboard.tsx`)
- Gate with `user?.role === SystemRoles.ADMIN` check (pattern from `AdminSettingsDialog.tsx:144`)
- Add React Query hooks to fetch reporting data from new API endpoints
- Use existing `@tanstack/react-table` for tabular data
- **v1 approach:** Ship without a charting library; use well-formatted tables with conditional formatting (e.g., color-coded spend levels, inline percentage bars via Tailwind). Add charting later if visual exploration proves valuable.
- **v2 optional:** Add lightweight charting library (recharts -- ~40KB gzipped, tree-shakeable, React-native)
- **Pros:** Self-contained, no separate deployment, uses existing auth
- **Cons:** Adds bundle size to main app for all users (mitigate with lazy loading)

### Option B: API-Only (Consumed by Separate Admin Panel)
- Add new endpoints under `/api/admin/usage/*`
- Follow existing admin route pattern (JWT + `ACCESS_ADMIN` + `READ_USAGE` capabilities)
- No frontend changes in OSS repo
- **Pros:** Follows LibreChat's architecture; compatible with paid admin panel; fastest to implement
- **Cons:** Requires separate UI deployment; doesn't benefit OSS users

### Option C: Hybrid (API + Embedded UI)
- Build API endpoints (Option B) first
- Build embedded UI (Option A) that consumes those endpoints
- API is reusable if admin panel later adopts it
- **Pros:** API endpoints are reusable; UI provides immediate value to MemodoAI
- **Cons:** More implementation work than either option alone

### Revised Recommendation

The original research recommended Option C without sufficient justification. Here is a more grounded analysis:

**For MemodoAI specifically:** Option B (API-only) + a minimal admin page that renders tables is the recommended starting point. This can be delivered faster than a full charting dashboard, provides 80%+ of the value (answering "who spent how much on what"), and the API endpoints are reusable. The "embedded UI" portion of Option C can be kept minimal -- a table-only view without charting dependencies, using the existing `@tanstack/react-table` and Tailwind. Charts can be added in a v2 iteration if the data warrants visual exploration.

**Estimated effort comparison:**
- Option B (API-only): ~2-3 days (5 endpoints + tests + indexes)
- Option B + minimal table UI: ~4-5 days (adds React components, React Query hooks, routing)
- Full Option C with charts: ~7-10 days (adds charting library integration, responsive chart components)

### Required Database Changes (All Options)
1. Add compound index on Transaction: `{ createdAt: 1, tenantId: 1 }` (for time-range queries)
2. Add compound index on Transaction: `{ user: 1, createdAt: 1 }` (for per-user queries)
3. Consider: `{ model: 1, createdAt: 1 }` (for per-model queries)

### New API Endpoints Needed
| Endpoint | Method | Description | Capability | Pagination |
|----------|--------|-------------|------------|------------|
| `/api/admin/usage/overview` | GET | System-level summary cards | READ_USAGE | N/A |
| `/api/admin/usage/trends` | GET | Time-series usage data | READ_USAGE | N/A (date-bounded) |
| `/api/admin/usage/models` | GET | Breakdown by model | READ_USAGE | Offset-based |
| `/api/admin/usage/users` | GET | Top users by spend | READ_USAGE | Offset-based |
| `/api/admin/usage/users/:userId` | GET | Single user detail | READ_USAGE | N/A |

### New Frontend Components Needed (Option A/C)
| Component | Purpose | v1 (tables only) | v2 (with charts) |
|-----------|---------|-------------------|-------------------|
| `ReportingDashboard` | Main layout with date range picker | Yes | Yes |
| `OverviewCards` | Total spend, active users, conversations, etc. | Yes | Yes |
| `UsageTrendChart` | Line chart of spend over time | No (table) | Yes |
| `ModelBreakdownChart` | Bar/pie chart of cost by model | No (table) | Yes |
| `UserActivityTable` | Sortable/paginated table of user spend | Yes | Yes |
| `DateRangePicker` | Period selector (7d, 30d, 90d, custom) | Yes | Yes |

---

## Gaps and Open Questions

| Gap | Impact | Recommendation | Status |
|-----|--------|----------------|--------|
| No `createdAt` index on Transaction | Time-range queries will be slow at scale | Add compound indexes before deploying | Open -- implement during API endpoint work |
| `READ_USAGE` capability unused | No authorization gate for reporting | Wire into new routes | Open -- implement during API endpoint work |
| No `MANAGE_USAGE` capability | No gate for future write operations (credit grants, balance adjustments) | Add to `SystemCapabilities` enum proactively | Open -- low effort, do during implementation |
| No charting library | Cannot render visual charts | Ship v1 as table-only; evaluate charting for v2 | Deferred |
| Token credits != USD | Dashboard must explain the unit | Display both: "12,500 credits ($0.0125)" | Open -- implement in UI |
| Admin panel is paid product | Embedding UI in OSS may conflict | API-first approach is safest; check paid panel feature overlap before building | Open -- quick inquiry needed |
| No data archival strategy | Transaction collection grows unbounded | Consider TTL index or archival job | Low priority for MemodoAI scale |
| `endpointTokenConfig` overrides | Custom pricing fully replaces default rates | Stored `tokenValue` already reflects custom rate -- no dashboard adjustment needed | **Resolved** |
| `rateDetail` not persisted | Per-component cost breakdown not directly available from stored data | Re-derive from `inputTokens`/`writeTokens`/`readTokens` + model lookup, or add field to schema | **Documented** |
| Conversation.user is String vs Transaction.user is ObjectId | Cross-collection joins require type coercion | Keep queries separate; merge in application code if needed | **Documented** |
| Cancellation surcharge baked into stored values | Dashboard totals include 15% surcharge on incomplete requests | Filter by `context === 'incomplete'` for transparency breakdown | **Documented** |
| Data volume unknown | Performance recommendations are ungrounded | Query production DB for actual counts before implementing pre-aggregation | Open -- first implementation step |
| Admin pagination pattern is offset-based | Original research incorrectly stated cursor-based | Use offset-based pagination via `parsePagination()` for consistency | **Corrected** |
