# conv-log Field Mapping Contract

**Spec:** SPEC-016-conversation-log-sidecar.md (rev 2, Approved)
**Status:** Canonical — REQ-T-2 drift gate parses this document and cross-checks against source code.

This document is the authoritative contract between the Mongo source collections and the Postgres destination tables.
Every source field name that appears in `src/mongo.ts` projections or `src/enrich.ts` mapping logic must be documented here,
and every field documented here must be referenced by code. Drift fails CI (REQ-T-2).

**Parser contract:** test parser expects markdown tables with the header row:
`| Source field | Target column | Notes |`

---

## `messages` collection -> `messages_log` table

| Source field | Target column | Notes |
|---|---|---|
| `messageId` | `message_id` | Direct copy. Part of the upsert compound key `(message_id, user_id)`. |
| `user` | `user_id` | Direct copy. Part of the upsert compound key. |
| `conversationId` | `conversation_id` | Direct copy. FK to `conversations_dim(conversation_id)` declared `ON DELETE SET NULL`. |
| `parentMessageId` | `parent_message_id` | Direct copy. NULL when absent. |
| `sender` | `sender` | Direct copy. NULL when absent. |
| `endpoint` | `endpoint` | Direct copy. NULL when absent. |
| `model` | `model_or_agent_id` | Copied verbatim. For agent traffic this is an `agent_*` ID string; for direct traffic it is the model name. Resolve to the underlying LLM via `JOIN agents_dim ON model_or_agent_id = agent_id`. |
| `isCreatedByUser` | `is_user` | Coerced: `Boolean(isCreatedByUser)`. |
| `text` | `text` | User messages: `messages.text` copied verbatim. Assistant messages: flattened concatenation of `content[].text` parts where `content[i].type === 'text'`, joined with a single newline. NULL when no text is available. |
| `content` | `content` | User messages: NULL (current production shape; if a future LibreChat version writes `content[]` for user messages both fields are populated the same way as for assistants). Assistant messages: the full `content[]` array stored as JSONB — lossless round-trip regardless of part types (`text`, `tool_call`, `tool_result`, `image_url`, future multimodal types). |
| `tokenCount` | `token_count` | Direct copy. NULL when absent. |
| `error` | `error` | Coerced: `Boolean(error)`. |
| `unfinished` | `unfinished` | Coerced: `Boolean(unfinished)`. |
| `attachments` | `has_attachments` | Derived: `Array.isArray(attachments) && attachments.length > 0`. |
| `files` | `has_files` | Derived: `Array.isArray(files) && files.length > 0`. |
| `feedback.rating` | `feedback_rating` | Optional path: `feedback?.rating ?? null`. NULL when `feedback` is absent. |
| `feedback.tag` | `feedback_tag` | Optional path: `feedback?.tag ?? null`. Mongo Mixed type — may be string, array, or object. Stored as JSONB via `JSON.stringify`. NULL when absent. |
| `feedback.text` | `feedback_text` | Optional path: `feedback?.text ?? null`. NULL when absent. |
| `createdAt` | `source_created_at` | Coerced to `Date`. Used as the watermark cursor field. |
| `updatedAt` | `source_updated_at` | Coerced to `Date`. |
| _(sidecar)_ | `synced_at` | Set to `NOW()` by the database on every upsert. Not derived from source. |
| _(sidecar)_ | `schema_version` | Constant `1` injected by `index.ts`. Bump requires truncate-and-rebuild per REQ-071. |

---

## `conversations` collection -> `conversations_dim` table

| Source field | Target column | Notes |
|---|---|---|
| `conversationId` | `conversation_id` | Direct copy. PK. |
| `title` | `title` | Direct copy. NULL when absent. |
| `agentId` | `agent_id` | Direct copy. NULL when conversation is not agent-backed. |
| `endpoint` | `endpoint` | Direct copy. NULL when absent. |
| `user` | `user_id` | Direct copy. NULL when absent. |
| `archived` | `archived` | Coerced: `Boolean(archived)`. |
| `tags` | `tags` | Array of strings stored as JSONB. NULL when absent. |
| `createdAt` | `source_created_at` | Coerced to `Date`. NULL when absent in source. |
| `updatedAt` | `source_updated_at` | Coerced to `Date`. NULL when absent in source. |
| _(sidecar)_ | `dim_updated_at` | Injected as `opts.now` from `enrich.ts`. Reflects when the sidecar last refreshed this row. |
| _(sidecar)_ | `schema_version` | Constant `1`. |

---

## `agents` collection -> `agents_dim` table

| Source field | Target column | Notes |
|---|---|---|
| `id` | `agent_id` | The string agent ID field (NOT the Mongo `_id`). PK. |
| `name` | `name` | Direct copy. NULL when absent. |
| `model` | `model_underlying` | **Renamed.** The underlying LLM (e.g., `gpt-4o`, `claude-3-5-sonnet`). Named `model_underlying` to prevent confusion with `messages_log.model_or_agent_id`, which for agent traffic holds the `agent_*` ID. Analysts must join to this column to resolve the actual model. |
| `description` | `description` | Direct copy. NULL when absent. |
| _(sidecar)_ | `last_seen_at` | Injected as `opts.now`. Updated on every batch that references this agent. |
| _(sidecar)_ | `dim_updated_at` | Injected as `opts.now`. |
| _(sidecar)_ | `schema_version` | Constant `1`. |

---

## `guardrailevents` collection -> `guardrail_events_log` table

| Source field | Target column | Notes |
|---|---|---|
| `eventId` | `event_id` | PK. Falls back to `String(_id)` when `eventId` is absent (SPEC-009 may use `_id` as the document identity). |
| `messageId` | `message_id` | Direct copy. No FK to `messages_log` — timing not guaranteed; loose reference reconciled on next sync. |
| `user` | `user_id` | Direct copy. NULL when absent. |
| `conversationId` | `conversation_id` | Direct copy. NULL when absent. |
| `route` | `route` | Direct copy. NULL when absent. |
| `entityTypes` | `entity_types` | Stored as JSONB. NULL when absent. |
| `entityCount` | `entity_count` | Direct copy. NULL when absent. |
| `createdAt` | `source_created_at` | Coerced to `Date`. NULL when absent. |
| _(sidecar)_ | `synced_at` | Set to `NOW()` by database on insert. |

---

## SCD Type and Refresh Semantics

Both `conversations_dim` and `agents_dim` implement **Type-1 Slowly Changing Dimension** (SCD) by design.

On every batch that references a conversation or agent, the sidecar performs an `ON CONFLICT ... DO UPDATE SET ...` that overwrites all columns with the current source values. Historical values are NOT preserved — there is no Type-2 versioning with `valid_from` / `valid_to` timestamps.

**Justification:** The analytical purpose of this store is to answer questions about the current state of agent configurations and conversation metadata as context for message analysis. For guardrail design, the currently-configured model for an agent (or the current title of a conversation) is the meaningful signal, not a historical series of changes. Implementing Type-2 SCD would double or triple the schema complexity, require more complex analytical queries, and provide negligible benefit at current MemodoAI scale. If agent assignment drift becomes analytically important, a follow-up SPEC can add a separate `agents_dim_history` table without schema changes to `agents_dim` itself.

---

## Drift Detection

REQ-T-2 implements a drift gate that runs in CI before the image build. The test parser:

1. Reads this file and extracts all Source field values from tables matching the header `| Source field | Target column | Notes |`.
2. Reads `src/mongo.ts` and `src/enrich.ts` and extracts all source field name references.
3. Asserts that every source field documented here appears in code, and every source field referenced in code is documented here.

**Exact format the parser expects:**

- Section headers containing `->` separate source collection from target table (e.g., `## \`messages\` collection -> \`messages_log\` table`).
- Each data row in the mapping table has the format `| field_name | column_name | Notes text |`.
- Source fields that are sidecar-injected (not from the Mongo document) are marked with `_(sidecar)_` in the Source field column. The parser skips these rows.

To add a new field mapping: add a row to the appropriate table in this document AND add the corresponding mapping logic in `src/enrich.ts` and/or `src/mongo.ts`. The CI gate ensures both stay in sync.
