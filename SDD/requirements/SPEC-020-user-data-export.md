# SPEC-020: Per-User Data Export for the MemodoAI → Claude Migration

## Executive Summary

- **Based on Research:** RESEARCH-020-user-data-export.md
- **Creation Date:** 2026-10-21
- **Author:** Pablo Oliva (with Claude)
- **Status:** Implemented rev 3 on `feature/020-user-data-export` — spec review and implementation review findings applied (see "Review Resolution" and "Implementation Summary")

MemodoAI is being sunset in favour of Claude, and the production server will be deleted afterwards. This specification defines a self-service **"Download my data"** feature: a logged-in user clicks one button under Settings → Data controls and receives a zip archive of everything they own — conversations as Markdown, extracted artifacts, uploaded files, memories, their agents, skills, prompts and presets — plus a bilingual README explaining how to move each part into Claude. The archive is built on the server by a read-only export module in `packages/api` and streamed to the browser. The same module is exposed as an operator script that runs inside the API container as a fallback.

## Research Foundation

### Production Issues Addressed

1. **No way for users to take their data with them.** The only export today is per conversation, uses only the messages cached in the browser, and never includes file bytes (`client/src/hooks/Conversations/useExportConversation.ts:42-48`). There is no bulk, admin, or "download my data" export (RESEARCH-010 `:992`, SPEC-008 `:709`).
2. **The server will be deleted.** Anything a user does not download before shutdown is lost.
3. **Claude cannot import conversations.** Claude accepts memory text (paste-import), project instructions + knowledge files, and Skills — not chat history (RESEARCH-020 §3). The archive must therefore be readable by people and shaped for those three Claude surfaces.

### Stakeholder Validation

Decisions taken by Pablo (2026-10-20/21), binding for this spec:

- Data protection / works-council review: **out of scope** — users receive all their own data, unredacted.
- Delivery: **per-user, self-service download.**
- M365 OBO, RAG search, Redakt guardrail, Grafana reporting not carrying over: **accepted.**
- Shutdown cleanup: **out of scope** — the server is deleted wholesale. The exporter is read-only.
- User announcement, download deadline, deletion date: **handled by Pablo separately, out of scope.**
- RESEARCH-020 OD-1 … OD-8: **all accepted as recommended** (see REQ-006, REQ-007, REQ-009, REQ-013, REQ-017, REQ-003).
- Process: no full `/sdd-flow` cycle; this spec plus one adversarial spec review (done) and one implementation review.

### Production Sizing (measured 2026-10-21, RESEARCH-020 §4.0)

150 users (103 with messages) · 664 conversations · 3,935 messages · 210 files ≈ 248 MB, all on MinIO (`source: s3`; contexts `message_attachment` 194, `agents` 16) · worst-case user ≈ 158 MB of owned files · largest single file 44 MB · 8 files without `storageKey` · 16 conversations with branches · 24 messages with artifacts · content parts: `text` 1,931, `tool_call` 282, `error` 11, `think` 2, no image parts · 614 memories · 8 agents, 2 prompt groups, 1 skill, 3 presets · 0 archived, 0 temporary, 2 in chat projects.

**Resource ceiling:** the API container is limited to **2 GB RAM / 2 CPUs** (`docker-compose.prod.yml:59-64`) and is the only API instance; an OOM kill takes chat down for everyone. Sizing decisions use this limit, not host RAM.

### System Integration Points

- `api/server/routes/user.js:24-30` — add the export route; router mounted at `/api/user` (`api/server/index.js:286`). `requireJwtAuth` reads bearer tokens only, so a GET download has no cookie/CSRF surface.
- `packages/api/src/storage/s3/crud.ts:283-287` — `resolveStoredS3Key(file)` (`storageKey`, else key parsed from `filepath`); `:641` `extractKeyFromS3Url` passes raw keys through unchanged. Exported via `packages/api/src/index.ts:60`.
- `packages/api/src/cdn/s3.ts:17` — `initializeS3()` returns the shared `S3Client`; bucket from `AWS_BUCKET_NAME`.
- `packages/api/src/artifacts/update.ts:219` — `findAllArtifacts(message)` returns `{ start, end, source, partIndex, text }` per block; exported via `src/index.ts:3`.
- `packages/api/src/prompts/artifacts/index.ts:40-53` — artifact header attributes and types the model is taught.
- `packages/data-provider/src/messages.ts:5` — `buildTree` (roots returned as siblings, `:41-46`).
- `packages/data-schemas/src/methods/message.ts:347` — UI message fetch sorts by `createdAt` ascending.
- `client/src/components/Chat/Messages/MultiMessage.tsx:42` — the UI shows the **last** sibling by default.
- `packages/data-schemas/src/schema/{convo,message,file,memory,agent,skill,skillFile,promptGroup,prompt,chatProject,preset}.ts` — shapes and owner fields; `skillFile.ts:49-71` stores bytes in object storage, `content` (`:102-104`) is only a lazy cache.
- `packages/api/src/skills/import.ts:405-411` — imported skills store the whole SKILL.md (including front matter) in `body`.
- `client/src/components/Nav/Settings/registry.tsx:455-468` — Data controls tab entries (`ImportConversations`, `SharedLinks`).
- `packages/data-provider/src/api-endpoints.ts:44-50`, `data-service.ts:724-731` — endpoint + blob-download pattern (`getFileDownload`).
- `docker-compose.prod.yml:84-110` — prod bind mounts: `api/server`, the three package `dist/`s, `client/dist`, `logs/`; **not** `config/` or the root `package.json`.
- `node_modules/jszip/lib/nodejs/NodejsStreamInputAdapter.js:38-42` — an input stream error while the worker is paused is stored and never propagated (generation hangs). Drives REQ-011 and REQ-025.

## Intent

### Problem Statement

Every MemodoAI user needs a complete, self-contained copy of their own data before the server is deleted, in a form they can read without MemodoAI and can move into Claude with minimal effort. Today no such export exists.

### Solution Approach

1. A TypeScript export module in `packages/api/src/export/` collects one user's data from MongoDB with owner-scoped queries, checks every owned file in MinIO **before** responding, renders Markdown/text, and streams a zip whose file entries are opened lazily, one at a time, as JSZip reaches them.
2. A thin authenticated route `GET /api/user/export` resolves the user from the session only and pipes the zip to the response with `stream.pipeline` and an inactivity watchdog.
3. A "Download my data" entry in Settings → Data controls fetches the archive as a blob with progress and saves it.
4. An operator script inside the mounted `api/server` tree runs the same module and writes the zip to the host-mounted logs directory.

### Expected Outcomes

- Each of the ~100 active users can download their archive in one click.
- The archive contains every file the user owns, each exactly once, and opens anywhere (plain Markdown, original files). Its README explains, in German then English, how to move memories, agents, skills and conversations into Claude.
- No user can obtain another user's data through this feature.
- The worst-case account (≈160 MB) exports within a minute, the API container stays well under its 2 GB limit, and chat keeps answering.

## Success Criteria

### Functional Requirements

**Endpoint and access**

- **REQ-001: Export route.** `GET /api/user/export` is registered in `api/server/routes/user.js` with `requireJwtAuth`. It takes **no** path, query or body parameters; the subject is always `req.user.id`.
- **REQ-002: Streamed zip response.** On success the route responds `200` with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="memodoai-export-<local-part>-<YYYY-MM-DD>.zip"`, where `<local-part>` is the user's email local part reduced to `[a-z0-9._-]` (fallback `user`) and the date is in Europe/Berlin. The body is produced by JSZip `generateNodeStream({ streamFiles: true })` and connected to `res` with `stream.pipeline`, so an error on either side tears down both. Compression is per entry: **`STORE`** for exported user files and skill files (already-compressed formats; no CPU spent for ~0 % gain), **`DEFLATE`** for generated text entries. No entry is buffered whole in memory.
- **REQ-003: Concurrency limits (OD-7).** At most **one** export per user and **three** server-wide run at the same time, tracked in process (prod runs one API container). A request over either limit gets `429` with JSON `{ "error": "export_in_progress" }` or `{ "error": "export_busy" }` before any zip bytes are sent; the codes exist for logs, the client shows one message for both (REQ-023). A slot is released exactly once (guarded): when the run ends (success, error, abort, watchdog), or on client disconnect (`res` `close`) **once streaming has begun**. During preparation a disconnect does not free the slot — preparation finishes (bounded by REQ-026 timeouts) first, so abort-and-retry cannot stack concurrent preparations. No size cap.

**Collection**

- **REQ-004: Owner-scoped queries.** All ownership is enforced **in the MongoDB query**, never by comparing ids in JavaScript. Filters:

  | Collection | Filter |
  |---|---|
  | `conversations` | `user: <id>`, `isTemporary: { $ne: true }` |
  | `messages` | `user: <id>` |
  | `files` | `user: <id>`, `context: { $ne: 'avatar' }` |
  | `memoryentries` | `userId: <id>` |
  | `agents` | `author: <id>` |
  | `skills` | `author: <id>` |
  | `skillfiles` | `skillId ∈ <ids of the user's skills>` (parent scope only) |
  | `promptgroups` | `author: <id>` |
  | `prompts` | `groupId ∈ <ids of the user's prompt groups>` (parent scope only) |
  | `chatprojects` | `user: <id>` |
  | `presets` | `user: <id>` |

  Queries go through the Mongoose models from `createModels`, which cast the id to each path's schema type (string vs ObjectId). Where an id comparison in JavaScript is unavoidable (e.g. matching `tool_resources` file ids against owned files), both sides are normalized with `String()`.
- **REQ-005: Bounded queries.** One query per row of REQ-004 — the count does not grow with the number of conversations. Messages are fetched in one query sorted by `createdAt` ascending and grouped by `conversationId` in a single pass into a `Map`. Verified by code review (no dedicated test).

**Conversations**

- **REQ-006: Thread reconstruction (OD-1).** Per conversation, messages (sorted by `createdAt`) are turned into a parent→children tree (same root semantics as `buildTree`; built locally to avoid casting Date-typed lean documents to `TMessage`). Rules:
  - **Main thread:** at every level — including the root level — follow the **last** node, mirroring `MultiMessage.tsx:42`. Turns on the main thread are numbered 1, 2, 3 ….
  - **Other versions:** every non-last sibling subtree, at any depth, is rendered after the main thread under `## Weitere Versionen / Other versions`, in depth-first order. Each alternative is linearised by the same "follow the last child" rule; forks nested inside an alternative are appended to the same flat list. Each alternative starts with `↳ Abzweigung nach Beitrag N von Version V / Branches after turn N of version V` (V = the version it diverges from, so forks nested inside an alternative are expressible; N = `0` for an alternative root).
  - **Unreachable messages:** messages no root reaches (corrupt parent cycles) are emitted as extra versions after the rest, never dropped and never looped on.
  - **Orphans:** a message whose `parentMessageId` is missing is a root (as in `buildTree`) and is therefore subject to the root-level rule above — the last root is the main thread, earlier roots appear under "Other versions". This matches what the UI shows.
- **REQ-007: Content rendering (OD-2).** Each turn is a `### <speaker>` heading — `Du / You` for `isCreatedByUser`, otherwise the message `sender` — with the `createdAt` timestamp (Europe/Berlin) below it, then:
  - `quotes` on a user turn: each rendered as a Markdown blockquote before the text.
  - A message with `error: true`: one line `> Fehler / Error: <first 300 characters of the text, newlines collapsed>`, nothing else.
  - `text` parts (and legacy `message.text` when `content` is absent): verbatim, after artifact replacement (REQ-009).
  - `think`: **omitted**.
  - `tool_call`: one line `> Werkzeug / Tool: \`<name>\`` followed by the arguments as compact JSON truncated to 200 characters; the tool output is omitted.
  - `error` part: one line `> Fehler / Error: <message>`.
  - Any other part type (incl. `image_url` / `image_file`, which do not occur in prod): a one-line `> <type>` placeholder. Never raw JSON.
  - After the turn's content, links to the files that turn references (REQ-010).
- **REQ-008: Conversation files.** One Markdown file per conversation at `conversations/[<project>/]<YYYY-MM-DD>-<slug(title)>.md`, using the conversation `createdAt` date (Europe/Berlin) and, if `chatProjectId` resolves to one of the user's chat projects, a folder named `slug(project name)`. Archived conversations go to `conversations/archived/`. The file starts with YAML front matter generated by `js-yaml` `dump` (never hand-concatenated): `title`, `created`, `updated`, `model` (the conversation's model, omitted when it is an `agent_…` id), `assistant` (the name of the user's own agent when `agent_id` matches one, else the first assistant `sender`), `project` (if any), `tags` (if any). Conversations with zero messages are skipped.

**Artifacts**

- **REQ-009: Artifact extraction (OD-4).**
  - **Boundaries:** from `findAllArtifacts`. Only boundaries whose `source` matches what is being rendered are used (`content` when the message has `content[]`, `text` for legacy messages), because `findAllArtifacts` falls back to `message.text` when no content part has an artifact (`update.ts:247`).
  - **Header and body:** a helper parses `:::artifact{identifier="…" type="…" title="…"}` attributes and strips the optional inner code fence to get the body. An unclosed block runs to the end of the text (`update.ts:116-118`); this is accepted.
  - **Output:** each artifact is written to `artifacts/<conversation-file-stem>/<slug(title)>.<ext>` and its block is replaced by a link `[<title>](<relative path>)`.
  - **Which version:** when several blocks in one conversation share an `identifier`, exactly one file is written: the **last occurrence on the main thread** if there is one, else the last by `createdAt`. All blocks with that identifier link to that file.
  - **Extension map** (types from `packages/api/src/prompts/artifacts/index.ts`): `application/vnd.react`, `application/vnd.ant.react` → `.tsx`; `text/html`, `application/vnd.code-html` → `.html`; `image/svg+xml` → `.svg`; `application/vnd.mermaid` → `.mmd`; `text/markdown`, `text/md` → `.md`; `application/vnd.code` → language from the inner fence info string, else a header `language` attribute (`python`→`.py`, `typescript`/`ts`→`.ts`, `javascript`/`js`→`.js`, `json`→`.json`, `css`→`.css`, `sql`→`.sql`, `bash`/`sh`/`shell`→`.sh`, else `.txt`); `text/plain` and anything unknown → `.txt`.

**Files**

- **REQ-010: Ownership-based file selection.** The file set is exactly the REQ-004 `files` query result: every file the user owns, except avatars. Outside agent folders each owned file is written **once**, at the first location that applies:
  1. `agents/<slug(agent name)>/files/<filename>` if an agent the user authored lists it in `tool_resources`. Every other authored agent that lists the same file gets its **own copy** in its folder, so each agent folder is complete for upload to a Claude Project (copies are stored, not deflated, so they cost no CPU);
  2. `files/<conversation-file-stem>/<filename>` for the earliest conversation (by `createdAt`) whose messages reference it via `files[]` or `attachments[]`;
  3. `files/other/<filename>` otherwise (uploaded but never sent, or left from a deleted conversation).

  Every reference elsewhere (messages, other agents) links to that single relative path. A reference whose `file_id` is not in the owned set — another user's file or a deleted record — is skipped silently, with no placeholder and no manifest entry.
- **REQ-011: Pre-flight and missing files.** After collection and **before any response headers are sent**, each owned file (and each skill file, REQ-014) is checked sequentially with an S3 `HeadObject` on its resolved key (REQ-026). Failures go into a `missing` set, and the export continues:
  - the Markdown shows `> Datei nicht verfügbar / File unavailable: <filename>` at each reference;
  - `manifest.json → missingFiles` lists `{ filename, location, reason }` with `reason` one of `not_found`, `unreadable`, `unsupported_source`;
  - the file is not added to the zip.

  A failure **after** streaming has started (an object disappears or MinIO fails mid-read) cannot be reported inside the already-sent archive: the stream is aborted per FAIL-003. A MongoDB error during collection or pre-flight returns `500` before any bytes are sent.

**Other data**

- **REQ-012: Memories.** If the user has memory entries, `memories.txt` contains one line per entry, `- <value>`, sorted by `updated_at` ascending, with no keys and no token counts — ready to paste into Claude → Settings → Memory → "Start import". No file when there are none.
- **REQ-013: Agents (OD-5).** Only agents with `author` = user. Each becomes `agents/<slug(name)>/instructions.md` containing name, description, model, the full `instructions`, and `conversation_starters` as a list. Its knowledge files are the owned files it lists in `tool_resources`, placed (or copied) per REQ-010 rule 1; listed files the user does not own are omitted silently.
- **REQ-014: Skills.** Only skills with `author` = user. Each becomes `skills/<slug(name)>/SKILL.md`:
  - if `body` already starts with a YAML front-matter block (`---\n…\n---`, as imported skills do), `body` is written verbatim;
  - otherwise front matter is generated with `js-yaml` `dump` from `name`, `description` and the stored `frontmatter` keys, followed by `body`.

  Each skill file's **bytes are read from object storage** through the same file access as REQ-010/REQ-026 (never from the `content` cache) and written at `skills/<slug(name)>/<relativePath>` (traversal segments removed, otherwise verbatim — REQ-020) with `STORE` compression; failures follow REQ-011.
- **REQ-015: Prompts.** If the user authored prompt groups, `prompts.md` lists each group as `## <name>` with `command`, `category`, `oneliner` when present, followed by the text of the production prompt (`productionId`; fallback: the group's most recent prompt).
- **REQ-016: Presets.** If the user has presets, `presets.md` lists each as `## <title>` with model/endpoint and `promptPrefix` / `instructions` when present.
- **REQ-017: README (OD-6).** `README.md` is always present: German section first, English below, each covering (a) what the archive contains, with counts per type, (b) how to import `memories.txt` into Claude memory, (c) how to recreate an agent as a Claude Project (paste `instructions.md`, upload `files/`), (d) how to upload a skill folder as a Claude Skill, (e) how to add selected conversations to a Claude Project as knowledge, (f) that model reasoning and tool outputs are intentionally not included, and (g) that `files/other/` holds files not attached to any conversation. Sections for empty types are omitted.
- **REQ-018: Manifest.** `manifest.json` holds `exportedAt` (ISO), `formatVersion: 1`, counts per exported type, and `missingFiles` (REQ-011). It contains no message content.
- **REQ-019: Exclusions.** Not exported: model reasoning, tool outputs, raw JSON copies of messages (OD-3), avatars, balances/transactions, tool-call records, shared links, conversation tags (tags appear on conversations), API keys, plugin auth, tokens, sessions, agent API keys, ACL entries, MCP servers, guardrail events, audit logs, RAG vectors, agents/skills/prompt groups authored by others, temporary conversations.
- **REQ-020: Safe, unique archive paths.** Two rules:
  - **Generated** segments (conversation stems, artifact titles, project, agent and skill folder names) pass through `slug()`: Unicode letters/digits kept (umlauts preserved), other characters → `-`, repeated `-` collapsed, max 80 characters, empty → `untitled`.
  - **Original filenames and skill-file path segments** pass through `safeFilename()`, which keeps the user's name as-is except: `/ \ : * ? " < > |` and control characters → `_`, leading dots and trailing dots/spaces removed, capped at 200 UTF-8 bytes with the extension (case kept) preserved, empty → `untitled`. A skill file's `relativePath` is split on `/` and `\`, with `.`, `..` and empty segments dropped — so `scripts/check_offer.py` stays `scripts/check_offer.py` and SKILL.md references still resolve. Name collisions within a folder get suffixes `-2`, `-3`, …. No archive entry resolves outside the archive root.

**Streaming robustness**

- **REQ-025: Lazy file entries and watchdog.** File and skill-file entries are handed to JSZip as a small lazy `Readable` that opens the S3 object (`GetObject`) on its first `_read`, respects `push()` returning `false`, and forwards errors with `destroy(err)`. JSZip never receives a pre-opened S3 body, so at most one S3 response per export is open at a time. An **inactivity watchdog** destroys the response if no bytes have been written for 60 s (the only defence against the JSZip paused-error hang): the slot is released and the run logged with `outcome: 'aborted'`. Before starting the zip, the service checks whether the client has already disconnected during collection/pre-flight and, if so, stops without generating.
- **REQ-026: Shared file access in `packages/api`.** `packages/api/src/export/files.ts` provides `createFileAccess()` with `check(file)` (`HeadObject`) and `open(file)` (`GetObject` → `Readable`), both keyed by `resolveStoredS3Key(file)` and using `initializeS3()` and `AWS_BUCKET_NAME`. Files whose `source` is not `s3` are reported `unsupported_source`. `HeadObject` and the start of `GetObject` time out after 15 s (the GET timer stops once the response arrives, so long downloads are not cut); collection queries use `maxTimeMS(30 000)`. Errors are rethrown as content-free errors (code + `file_id` only), so object keys — which contain original filenames — never reach logs (SEC-003). The HTTP controller and the operator script both use it; `/api` builds nothing file-related.

**Client and data-provider**

- **REQ-021: Data-provider wiring.** `packages/data-provider` gains `endpoints.exportUserData()` → `/api/user/export` and `dataService.getUserDataExport(onDownloadProgress)` using `request.getResponse(..., { responseType: 'blob', headers: { Accept: 'application/zip' }, onDownloadProgress })`, following `getFileDownload`.
- **REQ-022: Settings entry.** A new component `client/src/components/Nav/SettingsTabs/Data/ExportData.tsx` is registered in `client/src/components/Nav/Settings/registry.tsx` on the `DATA` tab, section `data`, directly after `ImportConversations`. It shows a label and a button. The download and the save-to-disk step (filename from `Content-Disposition`) run in the promise chain started by the click, not in component state, so the file is still saved if the Settings dialog is closed meanwhile.
- **REQ-023: Client states.** While running, the button is disabled and shows a spinner with "Preparing your export…" and, once bytes arrive, the MB received so far. Success resets the state. Any `429` shows one message: "An export is already running — please try again in a few minutes." Any other failure shows a generic error. All strings use `useLocalize()` with new `com_ui_export_data*` keys added to `client/src/locales/en/translation.json` **and, as a one-off fork exception approved by Pablo (2026-10-21), to `client/src/locales/de/translation.json`** — upstream translation automation never covers fork-local keys, so without this German-locale users would see English.

**Operator script**

- **REQ-024: In-container fallback.** `api/server/scripts/export.js` (inside the bind-mounted `api/server` tree, so `git pull` deploys it) takes `<email> <outDir>`, connects with `connectDb` from `~/db` (as `api/server/index.js:33` does), looks the user up by email, runs the same export service with `createFileAccess()`, and writes the zip to `<outDir>/<same filename as REQ-002>`. Prod usage: `docker exec LibreChat node api/server/scripts/export.js <email> /app/logs/exports` → file appears on the host under `./logs/exports/`. It prints counts and missing-file totals to stderr, never content. A root `package.json` script is not added (not mounted in prod). After shutdown, the same script serves late requests from a locally restored backup (RESEARCH-020 OD-8).

### Non-Functional Requirements

- **PERF-001: Worst-case duration.** Exporting the largest prod account (≈158 MB owned files, 56 conversations) completes in under 60 s, measured on the test box with prod-like data.
- **PERF-002: Memory.** During a worst-case export the API container's memory (`docker stats LibreChat`) rises by less than 300 MB and stays below 1.5 GB of its 2 GB limit; with three concurrent worst-case exports it stays below the limit and chat requests still complete.
- **SEC-001: Session-only identity.** The HTTP route accepts no user identifier; the subject is `req.user.id` from `requireJwtAuth`. The operator script is reachable only from a shell on the host.
- **SEC-002: No cross-user data.** No archive contains conversations, messages, file bytes, agents, skills, skill files, prompts, presets, memories or chat projects owned by another user. Enforced by the query filters of REQ-004 and the owned-set lookup of REQ-010/REQ-013 — no other user's file document is ever loaded. **Exception (by design):** children of the user's own skills and prompt groups (skill files, prompt versions) are exported regardless of who authored them, because they belong to the user's skill or prompt group (REQ-004 parent scoping). Covered by the two-user integration test.
- **SEC-003: No content in logs.** The export logs one structured line per run: `{ event: 'user_export', userId, outcome, durationMs, counts, missingFiles: <count> }`, plus `errorName`/`errorCode` (never the message) when `outcome` is `error` — never titles, message text, filenames, object keys or memory values. Achieved for file access by REQ-026's content-free errors.
- **SEC-004: Path safety.** No archive entry escapes the archive root or contains `..` segments (REQ-020); covered by unit tests with hostile titles and skill `relativePath`s.
- **OPS-001: Deploy.** `packages/api`, `packages/data-provider` and `client` change → `npm run build` + `./prod-sync.sh` (dist rsync + api restart). `api/server` changes (route, controller, operator script) → `git push` + `git pull` on prod (bind-mounted). A bare `git pull` is not a complete deploy (stale dist).
- **OPS-002: Read-only.** The export module performs no writes to MongoDB, MinIO, or any other store.
- **UX-001: One click.** The whole archive downloads from one button; no email, no waiting room, no second step.
- **UX-002: Readable offline.** Every exported conversation, artifact and file opens without MemodoAI; internal links in Markdown are relative and resolve inside the unzipped folder.
- **MAINT-001: Workspace boundaries.** All logic lives in `packages/api/src/export/` with single-word file names (`service.ts`, `collect.ts`, `files.ts`, `thread.ts`, `markdown.ts`, `artifacts.ts`, `paths.ts`, `readme.ts`, `index.ts`). `/api` adds only the route line, a thin controller (slots + headers + pipeline), and the operator script. No `any`; no `Record<string, unknown>` for document shapes — reuse the existing `I*`/`T*` types from `data-schemas`/`data-provider`.

## Edge Cases (Research-Backed)

### Known Production Scenarios

- **EDGE-001: Branched conversations (16 in prod).** Main thread = last sibling at each level; alternatives (including nested forks) under "Other versions" with branch pointers. Test: fixture with a regenerated reply, an edited user turn, and a fork inside an alternative.
- **EDGE-002: Files without `storageKey` (8 in prod).** Key parsed from the presigned `filepath` by `resolveStoredS3Key`; file exported normally. Test: `files.spec.ts` with a presigned-style `filepath` asserts the resolved key.
- **EDGE-003: Same artifact re-emitted.** One file — last on the main thread, else last by time; every block links to it. Test: same `identifier` on the main thread and in an abandoned branch.
- **EDGE-004: Duplicate conversation titles** (many "New Chat" on one day). `-2`, `-3` suffixes; artifact/file folders follow the suffixed stem.
- **EDGE-005: Hostile names.** Titles/filenames with `/`, `..`, control characters, emoji, 200-character strings; skill `relativePath` `../../etc/passwd`. Sanitized per REQ-020.
- **EDGE-006: User with no data.** Archive with `README.md` + `manifest.json` only; `200`, not an error.
- **EDGE-007: Orphan message.** Becomes a root; if it is not the last root, its subtree appears under "Other versions" (REQ-006).
- **EDGE-008: Message referencing another user's file.** Not exported, no placeholder, no manifest entry (REQ-010).
- **EDGE-009: Agent lists a knowledge file uploaded by a collaborator.** Omitted silently (REQ-013); the collaborator's own export contains it.
- **EDGE-016: Two authored agents share a knowledge file.** Each agent folder gets its own copy (REQ-010 rule 1).
- **EDGE-017: Corrupt parent cycle.** Messages are kept as extra versions; the walk terminates (REQ-006).
- **EDGE-010: Legacy message without `content[]`.** `text` rendered with artifact extraction using `source: 'text'` boundaries.
- **EDGE-011: Umlauts in names** (`Übersicht Q3.xlsx`). Preserved in zip entry names (JSZip writes UTF-8 names).
- **EDGE-012: Owned file referenced by several conversations.** Written once (earliest conversation), linked from all.
- **EDGE-013: Owned file referenced by nothing.** Exported under `files/other/`.
- **EDGE-014: Imported skill with front matter inside `body`.** `body` written verbatim; no duplicate front matter.
- **EDGE-015: Error message** (`error: true`, provider JSON in `text`). One truncated error line, not raw JSON.

## Failure Scenarios

### Graceful Degradation

- **FAIL-001: MinIO object missing or MinIO down at pre-flight.** Affected files are recorded in `missingFiles` and marked inline (REQ-011); the archive is still delivered. If MinIO is down entirely, the user still gets every conversation, memory, agent and prompt.
- **FAIL-002: MongoDB error before streaming starts.** Respond `500` JSON `{ error: 'export_failed' }`; slot released; logged with `outcome: 'error'`.
- **FAIL-003: Error after bytes have been sent** (object vanished or read failed mid-stream). The lazy entry destroys with the error, `pipeline` tears down the response, the browser download fails, and the client shows the generic error. Logged with `outcome: 'aborted'`. The user can retry.
- **FAIL-004: Client disconnects** during collection, pre-flight or streaming. On `res` `close`, any open S3 stream is destroyed, generation stops, and the slot is released.
- **FAIL-005: Stall (JSZip paused-error hang or stuck socket).** The 60 s inactivity watchdog (REQ-025) destroys the response and releases the slot.
- **FAIL-006: Repeated clicks / multiple tabs.** The second concurrent request gets `429`; the button is disabled while its own request runs.

## Implementation Constraints

### Context Requirements

- Read before coding: RESEARCH-020 (§4–§6), this spec's "Review Resolution", `SDD/reviews/CRITICAL-SPEC-user-data-export-20261021.md`, `packages/api/src/artifacts/update.ts`, `packages/api/src/storage/s3/crud.ts:283-287, 641-700`, `packages/api/src/cdn/s3.ts`, `packages/data-provider/src/messages.ts`, `node_modules/jszip/lib/nodejs/NodejsStreamInputAdapter.js`, `client/src/components/Nav/Settings/registry.tsx`, `client/src/components/Nav/SettingsTabs/Data/ImportConversations.tsx`.

### Technical Constraints

- **JSZip** (already a dependency) and **js-yaml** (already a `packages/api` dependency); no new dependencies, no `package-lock.json` regeneration.
- **Do not reuse the client formatter** (`client/src/hooks/Conversations/format.ts`). It dumps tool calls as full JSON and renders reasoning, which contradicts REQ-007. This deliberately departs from RESEARCH-020 §2/§6.3, which proposed moving it to `data-provider`.
- `packages/api` cannot import from `/api`. The service receives the models and the file access as parameters (dependency injection), which also keeps tests free of module mocks.
- Prod runs a single API container, so in-process concurrency counters (REQ-003) are sufficient.
- No whole-entry buffering: the 2 GB container limit, not host RAM, is the ceiling.

## Validation Strategy

### Automated Testing

**Unit tests** (`packages/api/src/export/*.spec.ts`):

- `thread.spec.ts` — main path (last sibling at every level incl. roots), alternatives depth-first with branch pointers, nested fork inside an alternative, orphan root, single-message and empty conversations.
- `artifacts.spec.ts` — `content[]` and legacy `text` sources (boundary `source` filtering), header attribute parsing (missing/quoted attributes), inner fence stripping and fence language, version choice (main thread vs abandoned branch), extension map incl. `.svg`, two artifacts in one part, unclosed block.
- `markdown.spec.ts` — every rule of REQ-007 (quotes, `error: true`, `think` omitted, tool-call truncation, placeholder), YAML front matter with titles containing `:`, `"`, `#`, newlines (round-trips through `js-yaml` `load`), Europe/Berlin dates near midnight.
- `paths.spec.ts` — `slug()` cases (umlauts, emoji, `/`, `..`, control chars, 200-char titles, empty), collision suffixes, skill `relativePath` traversal.
- `files.spec.ts` — key resolution for `storageKey` vs presigned-style `filepath` (EDGE-002), `unsupported_source`, content-free error wrapping.

**Integration tests** (`packages/api/src/export/service.spec.ts`, `mongodb-memory-server`, real models via `createModels`; file access injected as a real object whose `check`/`open` serve in-memory buffers via `Readable.from`):

- Seed **two users** with conversations (incl. branches and an orphan), artifacts, owned files (referenced once, referenced twice, unreferenced), memories, agents (one listing a knowledge file uploaded by the other user), skills (one imported with front matter in `body`) with skill files, prompt groups (with a collaborator-authored production prompt), presets, chat projects. Export user A, unzip with JSZip, and assert:
  - **Presence:** exact counts of A's conversations, files (each once, at the REQ-010 location), agents, skills, skill files, memories, prompt groups, presets (M2: positive assertions, so a filter that silently matches nothing fails);
  - **Absence:** no entry, text, filename or memory value originating from user B (SEC-002);
  - README and manifest counts.
- **Missing at pre-flight:** `check` rejects for one file → `missingFiles` entry + inline marker, archive delivered.
- **Error mid-stream:** `open` returns a stream that errors after N bytes → output stream errors, all source streams destroyed.
- **No hang:** a stream that errors while queued behind a large entry → the generation ends (error or abort) within a 5 s test timeout.
- **Disconnect:** destroying the output during streaming destroys the open source stream.

**Controller test** (`api/server/controllers/__tests__/` or alongside): unauthenticated → `401`; with a controllable blocking file access holding exports open — second concurrent request for the same user → `429 export_in_progress`; fourth overall → `429 export_busy`; slots released after `close` and after watchdog abort (fake timers).

**Operator script smoke test**: run the script's main function against `mongodb-memory-server` with an injected file access and a temp `outDir`; assert the zip exists and its entry list matches the service output.

**Client test** (`client/src/components/Nav/SettingsTabs/Data/__tests__/ExportData.spec.tsx`, `test/layout-test-utils`): idle; loading (disabled, spinner, MB progress); success (save triggered with header filename, also after unmount); `429` → the single in-progress message; generic error.

### Manual Verification

On the test box (`chat-test.memodo.de`, prod-clone data):

1. Download the archive for a normal account and for the account with the most files; unzip; open several conversations, artifacts and files; confirm links resolve and each file appears once.
2. Confirm a branched conversation's main thread matches what the UI shows.
3. Paste `memories.txt` into a Claude account's memory import; upload one agent folder as a Claude Project; upload one skill folder (including an imported skill) as a Claude Skill. Confirm each is accepted.
4. Start an export in one tab and click again in another → the in-progress message.
5. Close the Settings dialog mid-download → the file is still saved.
6. Run `docker exec LibreChat node api/server/scripts/export.js <email> /app/logs/exports` and compare the entry list with the UI download.

### Performance Validation

- Duration and container memory (`docker stats LibreChat`) for the largest account (PERF-001, PERF-002).
- Three simultaneous worst-case exports: memory stays under the container limit, and a chat message sent meanwhile is answered.

## Dependencies and Risks

### External Dependencies

- MinIO (file bytes) and MongoDB — both on the same host.
- JSZip 3.10.1 and js-yaml (present).

### Identified Risks

- **RISK-001: German UI text.** CLAUDE.md allows only English keys, but upstream translation automation will not cover fork-local keys. Resolved: German keys are added by hand as a one-off exception (REQ-023). Other locales fall back to English.
- **RISK-002: Browser memory for blob download.** The client holds the whole zip (≤ ≈160 MB) in memory before saving. Acceptable at prod sizes.
- **RISK-003: Test box data is a July clone.** Sizes there are smaller than prod today; if the largest account is under 150 MB, seed one synthetic account with large files for PERF validation.
- **RISK-004: Long download through Caddy.** Streaming keeps bytes flowing, so idle timeouts should not trigger; verified by Manual Verification step 1.
- **RISK-005: JSZip internals.** The lazy wrapper and watchdog work around `NodejsStreamInputAdapter`'s paused-error behaviour; the "no hang" test pins it so a JSZip upgrade cannot silently reintroduce a hang.
- **RISK-006: Short lifespan.** The feature lives until server deletion; effort is kept proportional (no feature flags, no admin UI, no scheduling).

## Out of Scope

- Importing anything into Claude programmatically (no API exists).
- Data-protection review, redaction, works-council process.
- User announcement, download deadline and server deletion date (Pablo, separately).
- Deleting data in any store; account deletion changes.
- Migrating company-wide agents/prompts into Claude (admin task).
- Re-creating M365, RAG, Redakt or Grafana capabilities in Claude.
- Changes to the existing per-conversation export.
- Fixing the conv-log `agent_id`/`archived` field-name bug.

## Implementation Notes

### Suggested Approach

**Step 1: Paths and slugs.** `paths.ts` — `slug()`, collision-aware path registry, `relativePath` sanitizer. Tests first (SEC-004).

**Step 2: File access.** `files.ts` — `createFileAccess()` with `check`/`open` (REQ-026) and the lazy `Readable` wrapper (REQ-025).

**Step 3: Collection.** `collect.ts` — one owner-scoped query per REQ-004 row; messages grouped into a `Map<conversationId, IMessage[]>` in one pass; owned-file index by `file_id`; file location assignment per REQ-010.

**Step 4: Threads.** `thread.ts` — sort, `buildTree`, main path, depth-first alternatives with pointers.

**Step 5: Artifacts.** `artifacts.ts` — `findAllArtifacts` boundaries filtered by `source`, header parser, fence stripping, version choice, extension map.

**Step 6: Rendering.** `markdown.ts` — conversation renderer (REQ-006/007/008) and memories/agents/skills/prompts/presets renderers, `js-yaml` front matter. `readme.ts` — bilingual README from counts.

**Step 7: Service.** `service.ts` — `prepareUserExport({ userId, models, files })` runs collection + pre-flight and returns `{ filename, counts, start(output) }`; `start` builds the JSZip (STORE/DEFLATE per entry), runs `pipeline` to the given writable with the watchdog, and emits the single log line on completion.

**Step 8: Route + controller.** `router.get('/export', requireJwtAuth, exportUserDataController)` in `api/server/routes/user.js`; the controller in `api/server/controllers/ExportController.js` (a factory, so tests inject dependencies) takes a slot (REQ-003), calls `prepareUserExport`, returns `500` on preparation errors, otherwise sets headers and calls `start(res)`, releasing the slot through a guarded function on `close`.

**Step 9: Data-provider + client.** Endpoint and data-service function (REQ-021), `npm run build:data-provider`; `ExportData.tsx`, registry entry, `en` keys (REQ-022/023).

**Step 10: Operator script.** `api/server/scripts/export.js` (REQ-024), reusing `connectDb` from `~/db` and `createFileAccess()`.

**Step 11: Verify** per Validation Strategy, then `npm run build` + `./prod-sync.sh` + `git pull` on prod.

### Critical Implementation Considerations

- **Never hand JSZip a pre-opened stream and never `await` all opens up front** — use the lazy wrapper; otherwise sockets pile up and a paused error hangs the export.
- **Ownership lives in queries.** If a JavaScript id comparison is unavoidable, compare `String(a) === String(b)`; an `ObjectId` never `===` a string, which would silently drop data while the archive still "looks fine".
- **Never fetch `filepath` as a URL**: it is a presigned URL that may have expired; always resolve the key with `resolveStoredS3Key`.
- **Release the concurrency slot exactly once** (`finish`, `close`, error and watchdog can all fire); use a guarded release function.
- **No content in logs or errors** — wrap S3 errors (REQ-026); never interpolate titles, filenames or keys into messages.

## Review Resolution

Critical review: `SDD/reviews/CRITICAL-SPEC-user-data-export-20261021.md` (verdict REVISE, 2 HIGH · 7 MEDIUM · 7 LOW). All findings resolved in rev 2:

| Finding | Resolution |
|---|---|
| H1 JSZip stream semantics | Pre-flight `HeadObject` before headers (REQ-011), lazy wrapper + `pipeline` + 60 s watchdog + early-disconnect check (REQ-025, REQ-002), FAIL-003/004/005 restated, hang/abort tests added. |
| H2 reference-based file selection | Ownership-based selection, each file once with a location rule, unresolved references skipped silently (REQ-010, REQ-013, EDGE-012/013). |
| M1 skill bytes / front matter | Bytes via file access, verbatim `body` when it carries front matter, `js-yaml` (REQ-014, EDGE-014). |
| M2 vacuous owner-type test | Replaced with positive presence assertions; ownership in queries, `String()` for unavoidable JS comparisons (REQ-004, Validation). |
| M3 CLI not deployable | Operator script under bind-mounted `api/server/scripts/`, writes to `/app/logs/exports` (REQ-024, OPS-001). |
| M4 `openFile` in `/api`, EDGE-002 untested | `createFileAccess()` in `packages/api` shared by controller and script; `files.spec.ts` covers presigned-style keys (REQ-026). |
| M5 blob-typed 429 / lifecycle | One 429 message, MB progress, save in promise chain (REQ-021–023). |
| M6 branch/artifact ambiguity | Root-level rule, depth-first nested alternatives with pointers, version choice, boundary `source` filter (REQ-006, REQ-009). |
| M7 container limit / DEFLATE | Sizing against 2 GB container, no whole-entry buffering, STORE for files (REQ-002, PERF-002). |
| L1 extension map | `.svg` added, language from fence info string, unclosed blocks accepted (REQ-009). |
| L2 YAML escaping | `js-yaml` `dump` for all front matter (REQ-008, REQ-014). |
| L3 filenames in S3 logs | Own content-free S3 calls via `createFileAccess()` (REQ-026, SEC-003). |
| L4 author filters on children | Children scoped by parent id only (REQ-004). |
| L5 rendering gaps | `error: true` messages, `quotes`, Europe/Berlin (REQ-007, REQ-008, REQ-002). |
| L6 proportionality | Image parts → placeholder only; one 429 message; query-count test dropped (REQ-005 by review); preview types dropped from the map. |
| L7 test gaps | Script smoke test, blocking file access for controller tests, destroyed-stream assertions. |

## Rollback

The feature is read-only and additive. Rollback = revert the commit(s), `npm run build`, `./prod-sync.sh`, and `git pull` on prod for the `api/server` changes. No data migration, no state to undo.

## Implementation Summary

### Completion Details

- **Branch:** `feature/020-user-data-export` (from `pablo` at `6f4b98a09`); implementation commit `07bc1a105`, review fixes in the follow-up commit.
- **Reviews:** spec review `SDD/reviews/CRITICAL-SPEC-user-data-export-20261021.md` (REVISE → resolved in rev 2); implementation review `SDD/reviews/CRITICAL-IMPL-user-data-export-20261021.md` (REVISE, 0 HIGH / 3 MEDIUM / 9 LOW → all resolved, table below).
- **Test box (chat-test, 2026-10-21):** deployed via `PROD_HOST=memodo-eng-test ./prod-sync.sh --no-restart` + `./test.sh restart api`. Verified: unauthenticated `401`; operator-script runs on real Mongo + MinIO (largest account: 158 MB archive in ~7 s, container 344 → 789 MiB peak incl. a second Node process; artifact-heavy account: 89 conversations, 24 links all resolving); two browser downloads by Pablo (49 conversations, 14 links resolving, HTTP-path export 487 ms, log line complete). Fixes from that testing: log fields moved into the message text (the console transport drops metadata at info level), Berlin-time zip entries, no folder entries, README singular/plural (`2e4e6b579`, `2e5d96ee1`).
- **Not yet done:** Claude-side import checks (memory, project, skill), branch-vs-UI comparison on an account with regenerated answers; merge to `pablo`; prod deploy (OPS-001).

### Files

- `packages/api/src/export/` — `types`, `collect`, `thread`, `artifacts`, `markdown`, `readme`, `layout`, `paths`, `files`, `service`, `index` (+ 6 spec files).
- `api/server/controllers/ExportController.js` (+ real-HTTP spec), `api/server/routes/user.js` (one route), `api/server/scripts/export.js` (+ smoke spec).
- `packages/data-provider/src/{api-endpoints,data-service,keys}.ts`; `client/src/data-provider/Auth/mutations.ts` (`useExportUserDataMutation`); `client/src/components/Nav/SettingsTabs/Data/ExportData.tsx` (+ spec); `client/src/components/Nav/Settings/registry.tsx`; `client/src/locales/{en,de}/translation.json`.

### Deviations from the spec text (all recorded above where they change behaviour)

| Deviation | Why |
|---|---|
| Controller in its own `ExportController.js` | Keeps fork code and its test factory out of the 600-line upstream `UserController.js`. |
| Local parent→children map instead of `buildTree` | Avoids casting Date-typed lean documents to `TMessage`; same root semantics, plus cycle safety. |
| Controller reads `mongoose.models`, not `~/db/models` | Re-running `createModels` would apply the MeiliSearch plugin to shared schemas a second time. |
| Agent knowledge files copied into every authored agent folder | Each folder must be uploadable as-is (implementation review CRI-04). |
| Filenames keep their original form (`safeFilename`) | Slugging renamed every user file and broke skill-folder references (CRI-01). |

### Implementation review resolution

| Finding | Resolution |
|---|---|
| CRI-01 filenames over-sanitized | `safeFilename()` for original names and skill paths; `slug()` only for generated segments (REQ-020). |
| CRI-02 slot freed during preparation | Slot released on disconnect only after streaming began (REQ-003); real-HTTP test asserts the retry gets `429`. |
| CRI-03 controller tests used stand-ins | Replaced by real Express + `compression()` + real `runUserExport` over `mongodb-memory-server`: 200/headers/zip, both 429s, mid-stream abort, preparation-phase abort, watchdog, late 500. |
| CRI-04 shared agent files | Per-agent copies (REQ-010 rule 1, EDGE-016). |
| CRI-05 SEC-002 wording | Explicit exception for children of the user's skills and prompt groups. |
| CRI-06 no preparation timeouts | 15 s storage timeouts, `maxTimeMS(30 000)` on queries (REQ-026). |
| CRI-07 silent error paths | `errorName`/`errorCode` logged on every failed run; late 500 drops `Content-Disposition` and is JSON. |
| CRI-08 unreachable messages dropped | Visited-set walk; leftovers emitted as extra versions (REQ-006, EDGE-017). |
| CRI-09 script may not exit | `process.exit` after `main()` settles. |
| CRI-10 front matter | `model` + `assistant` (own agent name or sender) (REQ-008). |
| CRI-11 missing tests | Archived folder, exact log-line shape, archive-wide root check, error-log identity. |
| CRI-12 style | Type-import order fixed; unrelated `data-service.ts` reformatting reverted. |
