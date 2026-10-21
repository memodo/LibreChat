# RESEARCH-020: Per-User Data Export for the MemodoAI → Claude Migration

**Date:** 2026-10-20
**Status:** COMPLETE — input to SPEC-020 (prod sizing measured 2026-10-21; all decisions in §7 resolved 2026-10-21)
**Author:** Pablo Oliva (with Claude)
**Trigger:** Memodo is considering sunsetting MemodoAI and moving users to Claude (claude.ai Team/Enterprise). Before the server is deleted, every user must be able to take their data with them in a form that is useful in Claude.

---

## 1. Research question

> How can each MemodoAI user download a complete archive of their own data (conversations, artifacts, files, memories, agents, skills, prompts), shaped so that the reusable parts can be moved into Claude's features, before the production server is deleted?

### Decisions already taken (Pablo, 2026-10-20)

| Topic | Decision |
|---|---|
| Data protection / works council | **Out of scope.** No redaction or filtering — users get everything they own. |
| Delivery | **Per-user download.** Each user downloads their own archive. |
| Features that won't carry over (M365 OBO, RAG search, Redakt guardrail, Grafana reporting) | Accepted. |
| Cleanup at shutdown | **Out of scope.** The whole server is deleted after the migration; no per-store deletion plan is needed. The exporter is strictly read-only. |

---

## 2. Prior art in this repo

| Doc / code | Relationship | Carry-over |
|---|---|---|
| RESEARCH-010 (Production Readiness), `:992` | Already flagged that GDPR Art. 20 portability has **no server-side export**. | This work closes that gap as a side effect. |
| SPEC-008 (Admin Reporting Dashboard), `:709` | Deferred "full export" to v2. | Nothing to reuse; confirms no export exists. |
| `scripts/gdpr-erase-user.sh` + `config/delete-user.js:76-113` | Finds a user by email, enumerates ~21 collections with the correct owner field each, walks MinIO `<basePath>/<userId>/` prefixes. | Best map of "everything a user owns". `delete-user.js` misses `chatprojects`, `skills`, `skillfiles` — the exporter must add them. |
| `client/src/hooks/Conversations/useExportConversation.ts` + `format.ts` | Per-conversation client export (png/txt/md/json/csv). Uses only messages already in the browser cache; never includes file bytes. | `format.ts` already renders every content-part type to text/Markdown. It depends only on `librechat-data-provider` plus a localize function — **can be moved to `packages/data-provider`** and reused server-side instead of writing a second formatter. |
| `packages/data-provider/src/messages.ts:5` `buildTree` | Shared parent→children tree builder. | Reusable server-side for thread reconstruction. |
| `packages/api/src/artifacts/update.ts` | `:::artifact` boundary parser (`ARTIFACT_START`/`ARTIFACT_END`, code-fence aware). | Reuse for artifact extraction instead of a new regex. |
| `api/server/utils/import/importers.js:16-23, 96-193` | Imports a **Claude** export (`chat_messages`) into LibreChat. | Only the reverse direction; documents Claude's export shape but does not help importing into Claude. |
| conv-log (SPEC-016) | Postgres mirror of messages. | **Not a usable source**: inserts only (misses edits/artifact rewrites), no files/memories/agents/prompts/skills, 24-month retention, and `agent_id`/`archived` are always NULL/false due to a field-name bug (`conv-log/src/mongo.ts:219,222` read `agentId`/`archived`, Mongo has `agent_id`/`isArchived`). |

---

## 3. What Claude can receive (verified 2026-10-19)

The target shapes the export. Claude has **no way to import conversations** as native chats.

| Claude surface | Accepts | Fit for MemodoAI data |
|---|---|---|
| Conversation import | Nothing. No admin bulk import or migration API for Team/Enterprise was found; Anthropic states a Claude export cannot be imported into another account. | Conversations can only travel as **documents**. |
| Memory import (Settings → Memory → "Start import") | Pasted text; Claude extracts individual memory entries the user can review. All plans incl. Team/Enterprise. Experimental; tuned to work-related facts. | `memoryentries` → one text block. Direct fit. |
| Projects | Custom instructions + knowledge files; paid plans switch to retrieval automatically when knowledge outgrows context; Team/Enterprise can share projects. | Agents → project (instructions + files). Selected conversations → knowledge files. |
| Skills | Folders with a `SKILL.md` (frontmatter `name`, `description` + body). | MemodoAI skills are already SKILL.md-shaped (`packages/data-schemas/src/schema/skill.ts`: kebab-case `name`, `description`, `body`, `frontmatter`; `skillFile.ts`: `relativePath`, `content`). Near 1:1. |

Consequence: the archive is a **personal record** plus **ready-to-paste/ready-to-upload pieces**. Markdown is the right primary format — human-readable, compact, and read well by Claude as project knowledge.

Sources: [Importing and exporting your memory](https://support.claude.com/en/articles/12123587), [What are projects?](https://support.claude.com/en/articles/9517075-what-are-projects), [Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data).

---

## 4. Data audit (code-level)

### 4.0 Production sizing (measured 2026-10-21, read-only, Appendix A)

| Metric | Value | Implication |
|---|---|---|
| Users / users with messages | 150 / 103 | ~100 archives to serve in total. |
| Conversations / messages | 664 / 3,935 (messages collection 10.4 MB) | Text volume is trivial. Busiest user: 580 messages, 56 conversations; average 38 messages, 6.4 conversations. |
| Message date range | 2026-04-29 → today | Six months of history; no legacy-format (pre-agents) messages to special-case. |
| Files | 210, ~248 MB (194 chat attachments 245 MB, 16 agent knowledge files 2.9 MB); all `source: s3` | MinIO on disk: `uploads/` 249 MB, `images/` 32 MB, `avatars/` 2.9 MB. |
| Largest per-user file volume | 158 MB (5 files); next 41 MB, 10 MB, 7 MB, 5 MB | Worst-case archive ≈ 160 MB. Largest single file 44 MB. |
| Files without `storageKey` | 8 | The URL-parsing fallback (`crud.ts:284-286`) is **required**, not theoretical. |
| Code-sandbox file paths | 0 | The "unrecoverable code output" case does not occur in prod; keep the manifest entry as a guard only. |
| Content-part types | `text` 1,931 · `tool_call` 282 · `error` 11 · `think` 2 | Tool-call summaries matter; reasoning is negligible either way (OD-2). |
| Messages containing artifacts | 24 | Artifact extraction is needed but low-volume. |
| Conversations with branches | 16 | Branch handling (OD-1) affects ~2.4% of conversations. |
| Archived / temporary / in a chat project | 0 / 0 / 2 | `archived/` folder and project folders will rarely appear; keep the logic, don't optimize for it. |
| Memories | 614 | ~6 per user on average; `memories.txt` is worth shipping. |
| Agents / prompt groups / skills / presets / shared links | 8 / 2 / 1 / 3 / 3 | Tiny. Export them, but they don't justify extra UX. |
| Owner-ID types | messages & conversations: string; files, memories, agents: ObjectId | Confirms the type split in §4.1 on real data. |
| Host headroom | 15 GB RAM (7.8 GB available), 19 GB free disk | A 160 MB in-flight archive is negligible. |

### 4.1 Collections in scope

Schemas: `packages/data-schemas/src/schema/`.

| Collection | Owner field (type) | Export content |
|---|---|---|
| `conversations` | `user` (**string**) | `title`, `createdAt`, `endpoint`/`model`/`agent_id`, `isArchived`, `tags`, `chatProjectId`, `files[]`. Skip `isTemporary` conversations. |
| `messages` | `user` (**string**) | Tree via `messageId`/`parentMessageId`. User text in `text`; assistant text in `content[]` (types: `text`, `think`, `tool_call`, `image_url`, `image_file`, `summary`, `error`, `agent_update`, …; `packages/data-provider/src/types/runs.ts:3-15`). `files[]` (uploads), `attachments[]` (generated outputs), `createdAt`. |
| `files` | `user` (**ObjectId**) | `file_id`, `filename`, `type`, `bytes`, `context` (`message_attachment`, `execute_code`, `image_generation`, `agents`, `avatar`), `conversationId`/`messageId`, **`storageKey`**, `filepath`. |
| `memoryentries` | `userId` (**ObjectId**) | `key`, `value`, `updated_at`. `getFormattedMemories` (`packages/data-schemas/src/methods/memory.ts:130`) already returns `withoutKeys` text. |
| `agents` | `author` (**ObjectId**) | `name`, `description`, `instructions`, `conversation_starters`, `model`, `tools`, `tool_resources` (file ids). Only agents the user **authored**. |
| `skills` / `skillfiles` | `author` | `name`, `description`, `body`, `frontmatter`; file `relativePath` + `content`. |
| `promptgroups` / `prompts` | `author` (**ObjectId**) | Group `name`, `oneliner`, `category`, `command`, `productionId` → current prompt text. |
| `chatprojects` | `user` (**string**) | `name`, `description` only; used to group conversations into folders. |
| `presets` | `user` (**string**) | `title` + `promptPrefix`/`instructions` — small, include as text. |

**Owner-ID type split is a correctness trap:** a query with the wrong type silently returns zero rows. The exporter needs one helper that queries each collection with its correct type.

### 4.2 Excluded (no migration value)

`balances`, `transactions`, `toolcalls`, `sharedlinks` (references to messages already exported), `conversationtags` (tags are on the conversation), `keys`, `pluginauths`, `tokens`, `sessions`, `agentapikeys`, `aclentries`, `mcpservers`, `guardrailevents`, `auditlogs`. RAG vectors in pgvector (derived from files we export as originals). MeiliSearch (search index copy).

### 4.3 Artifacts

- Stored **inline** as `:::artifact{identifier="…" type="…" title="…"} … :::` inside `content[i].text` (agents) or `text` (legacy).
- Edits rewrite the message in place (`api/server/routes/messages.js:193-269`) — only the latest version exists.
- The same `identifier` can appear in several messages of a conversation (the model re-emits an updated artifact). Export decision in OD-4.
- Type → file extension mapping needed (e.g. `text/html`→`.html`, `application/vnd.react`→`.jsx`, `application/vnd.mermaid`→`.mmd`, `image/svg+xml`→`.svg`, `text/markdown`→`.md`, code types → language extension).

### 4.4 Files

- `librechat.yaml:214` `fileStrategy: "s3"` → MinIO bucket `librechat`, keys `<basePath>/<userId>/<file_id>__<originalname>` (`packages/api/src/storage/s3/crud.ts:175-186`).
- **`filepath` is a presigned URL that expires** (`S3_URL_EXPIRY_SECONDS`). The durable key is `storageKey`, falling back to parsing the URL (`crud.ts:284-286`, already implemented as a helper).
- Streaming read: the S3 strategy's `getDownloadStream` (`getS3FileStream`, `api/server/services/Files/strategies.js:123`) — the same path the existing `GET /api/files/download/:userId/:file_id` uses.
- Code-interpreter outputs whose save failed point at `/api/files/code/download/<session>/<id>` (`Files/Code/process.js:69`) — the sandbox is ephemeral, so these are **unrecoverable**; list them in a "missing files" manifest rather than failing the export.

---

## 5. Archive layout (proposed)

```
memodoai-export-<email-local-part>-<YYYY-MM-DD>.zip
  README.md                         ← what's inside + step-by-step "move to Claude" guide
  conversations/
    <project-name>/                 ← if conversation belongs to a chat project
    <YYYY-MM-DD>-<title>.md         ← one file per conversation, main thread
    archived/<YYYY-MM-DD>-<title>.md
  artifacts/<YYYY-MM-DD>-<title>/<artifact-title>.<ext>
  files/<YYYY-MM-DD>-<title>/<original-filename>
  memories.txt                      ← paste into Claude: Settings → Memory → Start import
  agents/<agent-name>/
    instructions.md                 ← paste into a Claude Project's instructions
    files/<knowledge files>
  skills/<skill-name>/SKILL.md (+ skill files at their relativePath)
  prompts.md
  presets.md
  manifest.json                     ← counts, export timestamp, missing-files list
```

Conversation Markdown shape: front matter (title, date, model/agent, project, tags), then `## You` / `## <Assistant name>` turns; tool calls as one-line summaries; artifacts replaced by a link to their extracted file; attachments as relative links into `files/`.

---

## 6. Candidate approaches

### 6.1 Where the export is assembled

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Server-side streaming endpoint** | `GET /api/user/export` (JWT-auth, user from `req.user` only) streams a zip built by a module in `packages/api` reading Mongo + MinIO. | One source of truth; no browser memory limits; file bytes read directly from MinIO by `storageKey`; same module reusable from a CLI. | Needs a build + `prod-sync.sh` deploy (packages/api dist). | **Recommended.** |
| B. Client-side bulk export | Browser paginates existing APIs (`/api/convos`, `/api/messages/:id`, `/api/files/download/...`, `/api/memories`, `/api/agents`, `/api/prompts`) and zips with JSZip. | Frontend-only, no backend change. | Hundreds of requests per user; whole archive held in browser memory; brittle on large accounts; no reuse for an admin fallback. | Rejected. |
| C. Admin batch job | Script writes one zip per user to MinIO; users get a link. | Runs once; predictable load. | Contradicts "download per user" self-service; needs a link-delivery channel; stale if users keep chatting before shutdown. | Rejected as primary; **the same module run from a CLI** (`config/export-user.js`, matching `delete-user`/`create-user` conventions) is the fallback for users who miss the deadline or can't use the UI. |
| D. Extend the existing per-conversation export UI | Add "all conversations" to `ExportModal`. | Familiar UI. | Inherits the browser-cache limitation and lacks files, memories, agents, skills. | Rejected. |

### 6.2 Zip library

| Option | Notes |
|---|---|
| **JSZip** (already present: runtime dep of `/api`, peer dep of `packages/api`) | `generateNodeStream({ streamFiles: true })` streams output and accepts Node streams as inputs. Holds per-entry metadata in memory; fine for typical account sizes. Zero new dependencies. |
| `archiver` | True streaming with backpressure; adds a dependency (and `package-lock` churn, which is fragile in this repo per the v0.8.7 toolchain notes). |

Recommendation: **JSZip.** Measured worst case is ~160 MB for one user (§4.0) against 7.8 GB available RAM, so even full in-memory buffering would be safe; `archiver`'s backpressure buys nothing here.

### 6.3 Code placement (per CLAUDE.md workspace rules)

- `packages/api/src/export/` (single-word directory): `service.ts` (orchestration + streaming), `collect.ts` (per-collection queries with correct owner types), `thread.ts` (tree → main path + branches), `markdown.ts` (conversation rendering), `artifacts.ts` (extraction via `artifacts/update.ts`), `archive.ts` (zip assembly).
- `packages/data-provider`: move the content-part formatter out of `client/src/hooks/Conversations/format.ts` (label function injected) so client and server share it.
- `/api`: one route line in `api/server/routes/user.js` next to `DELETE /delete`, plus a thin controller.
- `/client`: a "Download my data" button in `client/src/components/Nav/SettingsTabs/Account/` beside `DeleteAccount.tsx`; strings via `useLocalize` (`com_ui_export_my_data*`).
- `config/export-user.js` + `npm run export-user -- <email> [outDir]` for the admin fallback.

---

## 7. Decisions for SPEC-020

**Resolved 2026-10-21:** Pablo accepted every recommendation below (OD-1 to OD-8) as written. Still to be set in OD-8: the concrete download deadline and server deletion dates.

- **OD-1. Branch handling.** Messages form a tree (regenerations/edits create siblings). Recommend: render the **main thread** following the most recent child at each fork, and append alternate branches under an "Other versions" section at the end of the file. (The SPEC must confirm this matches what the UI shows by default.)
- **OD-2. Reasoning (`think`) parts.** Recommend **exclude** — noise for reading and for Claude project knowledge. Tool calls: one-line summary (tool name + short args), outputs omitted.
- **OD-3. Machine-readable copy.** Also include `conversations.json` (raw message objects) for completeness? Recommend **no** — users won't use it, and the server is the only consumer that could. Revisit if anyone names a use.
- **OD-4. Artifact versions.** When one `identifier` appears in several messages, export **only the last version** (recommended) or every version as `-v1`, `-v2`…
- **OD-5. Shared agents.** Export only agents the user **authored** (recommended). Shared/company agents should be migrated once, centrally, by an admin as shared Claude Projects — not N times.
- **OD-6. README language.** German, English, or both. Recommend **German first, English below**.
- **OD-7. Limits and load.** Sizing done (§4.0): ~100 users, worst-case archive ~160 MB. Recommend **1 active export per user, 3 globally, no size cap**. Streaming keeps bytes flowing, so Caddy's idle timeouts are not a concern; the SPEC should still verify a 160 MB download end to end on the test box.
- **OD-8. Timeline.** Download deadline, announcement channel (welcome text + email), and server deletion date. Recommend keeping one final full backup (Mongo dump + MinIO) offline for a few months so the CLI fallback can serve late requests from a local restore.

---

## 8. Constraints carried into the SPEC

1. **Read-only.** The exporter never writes or deletes user data.
2. **Own data only.** User identity comes exclusively from the authenticated session (`req.user`); no user-id parameter on the HTTP route (no IDOR surface). The CLI is operator-only.
3. **Correct owner-ID types per collection** (string vs ObjectId) — covered by tests against `mongodb-memory-server`.
4. **Files read by `storageKey`**, never by presigned `filepath`.
5. **Partial failure tolerated:** a missing/unreadable file is recorded in `manifest.json`, not fatal.
6. **Deploy discipline:** `packages/*` changes → `npm run build` + `./prod-sync.sh`; `git pull` alone leaves stale dist.
7. **Workspace rules:** logic in TypeScript under `packages/api`; `/api` limited to the route + thin controller.

---

## 9. Out of scope (explicitly)

- Importing anything into Claude programmatically (no API exists).
- Data-protection review, redaction, works-council process (decided out of scope).
- Deleting data in any store (the server is deleted wholesale).
- Migrating shared/company agents and prompts into Claude (separate admin task, see OD-5).
- Re-creating M365, RAG, Redakt, or Grafana functionality in Claude.
- Fixing the conv-log `agent_id`/`archived` field-name bug (noted in §2; irrelevant once the server is gone).

---

## 10. Files that matter

- `packages/data-schemas/src/schema/{message,convo,file,memory,agent,skill,skillFile,prompt,promptGroup,chatProject,preset}.ts` — shapes and owner fields.
- `packages/data-schemas/src/methods/memory.ts:130` — `getFormattedMemories`.
- `packages/data-provider/src/messages.ts:5` — `buildTree`.
- `client/src/hooks/Conversations/format.ts`, `useExportConversation.ts` — existing formatter to move/reuse.
- `packages/api/src/artifacts/update.ts` — artifact boundary parser.
- `packages/api/src/storage/s3/crud.ts:175-186, 284-286` — S3 key layout, `storageKey` resolution.
- `api/server/services/Files/strategies.js:123` — `getDownloadStream` for S3.
- `api/server/routes/user.js:28` — where the export route goes (next to `DELETE /delete`).
- `client/src/components/Nav/SettingsTabs/Account/DeleteAccount.tsx` — UI placement reference.
- `config/delete-user.js:76-113`, `scripts/gdpr-erase-user.sh` — ownership map to mirror.
- `librechat.yaml:214` — `fileStrategy: "s3"`.

---

## Appendix A — Read-only sizing script

Run on 2026-10-21; results in §4.0. Re-run before go-live if usage grows. Requires SSH access to prod (port 22 is allow-listed). Prints counts and sizes only, never content. Note: the in-container cleanup needs `docker exec -u root`, because `docker cp` creates the file as root and the Mongo container runs as a non-root user.

```bash
cat > /tmp/sizing.js <<'EOF'
const d = db.getSiblingDB('LibreChat');
const c = n => d.getCollection(n).countDocuments({});
print(JSON.stringify({
  users: c('users'), convos: c('conversations'), messages: c('messages'), files: c('files'),
  memories: c('memoryentries'), agents: c('agents'), prompts: c('prompts'),
  skills: c('skills'), skillfiles: c('skillfiles'), chatprojects: c('chatprojects'), presets: c('presets'),
}));
print(JSON.stringify(d.files.aggregate([{ $group: { _id: { ctx: '$context', src: '$source' }, n: { $sum: 1 }, mb: { $sum: { $divide: ['$bytes', 1048576] } } } }, { $sort: { n: -1 } }]).toArray()));
print('topUsersByFileMB=' + JSON.stringify(d.files.aggregate([{ $group: { _id: '$user', mb: { $sum: { $divide: ['$bytes', 1048576] } }, n: { $sum: 1 } } }, { $sort: { mb: -1 } }, { $limit: 3 }, { $project: { _id: 0, mb: 1, n: 1 } }]).toArray()));
print('msgsPerUser=' + JSON.stringify(d.messages.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }, { $group: { _id: null, users: { $sum: 1 }, max: { $max: '$n' }, avg: { $avg: '$n' } } }]).toArray()));
print('artifactMsgs=' + d.messages.countDocuments({ $or: [{ text: /:::artifact/ }, { 'content.text': /:::artifact/ }] }));
print('branchedConvos=' + d.messages.aggregate([{ $group: { _id: { c: '$conversationId', p: '$parentMessageId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $group: { _id: '$_id.c' } }, { $count: 'n' }]).toArray().map(x => x.n));
print('filesMissingStorageKey=' + d.files.countDocuments({ source: 's3', $or: [{ storageKey: { $exists: false } }, { storageKey: null }] }));
print('contentPartTypes=' + JSON.stringify(d.messages.aggregate([{ $unwind: '$content' }, { $group: { _id: '$content.type', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray()));
EOF
scp /tmp/sizing.js memodo-eng-prod:/tmp/sizing.js
ssh memodo-eng-prod 'docker cp /tmp/sizing.js chat-mongodb:/tmp/sizing.js \
  && docker exec chat-mongodb sh -c "mongosh --quiet -u \"\$MONGO_INITDB_ROOT_USERNAME\" -p \"\$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin /tmp/sizing.js"; \
  docker exec -u root chat-mongodb rm -f /tmp/sizing.js; rm -f /tmp/sizing.js; \
  du -sh /opt/docker/librechat/minio-data/librechat/* 2>/dev/null'
```
