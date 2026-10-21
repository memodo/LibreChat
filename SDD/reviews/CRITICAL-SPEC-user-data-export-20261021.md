# Specification Critical Review: Per-User Data Export (SPEC-020)

**Document reviewed:** SDD/requirements/SPEC-020-user-data-export.md
**Cross-reference:** SDD/research/RESEARCH-020-user-data-export.md (§7 decisions treated as final)
**Review date:** 2026-10-21
**Reviewer:** Claude (adversarial critical review, standalone run)

## Executive Summary

SPEC-020 is tight, well-scoped, and nearly all of its code references are accurate (see "Checked and confirmed" at the end). The owner filters in REQ-004 match the schemas exactly, and the session-only identity design leaves no IDOR surface. Two problems need fixing before implementation:

1. **The streaming design does not match how JSZip 3.10.1 actually works.** JSZip binds a stream input as soon as `zip.file()` is called, so a Promise of a stream cannot be passed in. If an input stream errors while JSZip has it paused, JSZip swallows the error, and the zip never finishes. If it errors while flowing, the whole archive aborts. As written, REQ-011 ("reading fails → export continues") and the inline "File unavailable" marker cannot both be met. The worst case is a hung download that also holds the REQ-003 slot.
2. **Files are selected by being referenced, not by being owned.** Owned files that no message or authored agent references are silently left out, and the server is then deleted. The reference-then-check approach is also the only place where another user's file record gets loaded at all. Selecting files by ownership is both simpler and safe by construction.

The MEDIUM findings cover: skill-file bytes and double front matter, an owner-type regression test that cannot fail under Mongoose, a CLI that cannot run on the prod container as deployed, the blob-typed 429 body on the client, gaps in the branch and artifact rules, and sizing against the host instead of the 2 GB container limit.

### Verdict: **REVISE BEFORE PROCEEDING**
### Overall Severity: HIGH (2 HIGH · 7 MEDIUM · 7 LOW)

All findings can be fixed inside the current architecture. None of them re-opens a §7 decision.

---

## HIGH

### H1. **REQ-002 / REQ-011 / Step 6 / FAIL-003/004: JSZip stream semantics break the "lazy, non-fatal" file design** -- HIGH

What the spec assumes: "file entries are added as Node `Readable` streams" (REQ-002), "adds file entries as lazily-opened streams" (Step 6), and "If opening **or reading** a file fails, the export continues … the Markdown shows `> Datei nicht verfügbar`" (REQ-011).

What JSZip 3.10.1 does (`node_modules/jszip`, version confirmed 3.10.1):
- **Inputs bind when `file()` is called, not when they are generated.** `lib/object.js:81-82` wraps a stream in `NodejsStreamInputAdapter` inside `zip.file()`. A Promise is resolved by `utils.prepareContent` (`lib/utils.js:449-480`). A Promise that resolves to a stream fails `getTypeOf` with "Can't read the data of '…'". `openFile` is necessarily async (`getS3FileStream` returns `Promise<Readable>`, `packages/api/src/storage/s3/crud.ts:859`), so "lazily-opened" cannot be handed to JSZip directly. The obvious workaround is to await every `openFile` before `generateNodeStream`. That leaves N S3 response bodies open and paused, waiting in the queue. They all share the AWS SDK v3 default socket pool (50 sockets), and up to 3 concurrent exports draw from the same pool. The result is idle-socket timeouts, or a deadlock once more than 50 files are open.
- **An error while paused is swallowed and the zip hangs.** In `lib/nodejs/NodejsStreamInputAdapter.js` `_bindStream`, the `error` handler does `if (self.isPaused) { this.generatedError = e; }`. Here `this` is the source stream, so the error is stored on the stream and never propagated. On resume, `this._stream.resume()` is called on a destroyed stream that never emits `end`, so the generation never finishes. "Paused" is the normal state for every queued entry, and it is also the state during backpressure from a slow browser (`NodejsStreamOutputAdapter.js`: `if (!self.push(data)) self._helper.pause()`). The result: the response never ends, and axios has no timeout (`packages/data-provider/src/request.ts:12-14` passes no `timeout`). The REQ-003 slot is only released when the user closes the tab. Every retry in the meantime gets `429 export_in_progress`.
- **An error while flowing is fatal.** `self.error(e)` propagates through `ZipFileWorker` to the output stream, which truncates the archive. A mid-file read failure is FAIL-003, not REQ-011.
- **The inline marker needs to know about failures in advance.** The "File unavailable" line in the conversation Markdown, and `manifest.json → missingFiles`, both require the failure to be known before those entries are generated. With lazy opening, the failure is discovered only after (or while) the Markdown entry is written.

**Recommended fix (small, proportional):**
1. **Pre-flight before headers.** For each owned file, sequentially, `await openFile(file)` and immediately `destroy()` the body (local MinIO makes this cheap: ~5–50 files per user). Record failures in a `missing` set, then render the Markdown and manifest from that set. A Mongo or pre-flight error can still return `500` before any bytes are sent.
2. **Add file entries through a small lazy `Readable` wrapper.** It opens the S3 stream on its first `_read`, honours `push()` returning `false`, and forwards errors. Never hand JSZip a pre-opened S3 body.
3. **Restate REQ-011:** "fails at pre-flight → non-fatal (manifest + inline marker); fails after streaming started → FAIL-003 abort."
4. **Pipe with `stream.pipeline(zip, res, cb)`**, not `.pipe()`, so that an error on either side tears down both. Add an **inactivity watchdog**: no bytes written for N seconds (e.g. 60) → destroy `res`, log `outcome: 'aborted'`, release the slot. The watchdog is the only defence against the JSZip swallow bug.
5. After the collection phase, check `res.destroyed` / `req.aborted` before starting the zip, because the client may have left during collection (FAIL-004).
6. **Tests:** an `openFile` that rejects (→ `missingFiles`, archive delivered); a stream that errors after N bytes (→ aborted, slot released); a stream that errors while queued behind a large entry (→ the test finishes inside a timeout, with no hang).

### H2. **REQ-010 / REQ-013: files are selected by reference, not ownership — owned files are silently lost and a cross-user lookup path is created** -- HIGH

REQ-010 exports only `file_id`s referenced by the user's messages (`files[]`, `attachments[]`). REQ-013 adds knowledge files of agents the user **authored**. The Executive Summary and Expected Outcomes, however, promise "everything they own — … uploaded files". Files owned by the user that this rule misses include:
- files uploaded but never sent, or re-attached from the "My Files" library;
- files left behind by deleted conversations (to verify: whether `deleteConvos` removes `files` records);
- knowledge files the user uploaded to an agent they edit but did not author;
- files of temporary conversations.

The research sizing that justified the design (§4.0, Appendix A `topUsersByFileMB`) aggregates `files` by `$user`, i.e. by **ownership**. So the archive as specified will not match the measured 248 MB / 158 MB. Because the server is deleted afterwards, anything omitted is gone permanently.

Secondary problems with the reference model:
- **Shared references.** The same file referenced by several conversations has an undefined location (`files/<conversation-file-stem>/` of which one?). It is either duplicated (doubling a 158 MB archive in the worst case) or ambiguous.
- **Dangling references.** A referenced `file_id` with no `files` document (deleted file, or an attachment with no backing record) has no specified behaviour.
- **Cross-user loading.** REQ-010's `file_id ∈ …` lookup has no `user` filter and relies on a post-check. It is the only place where another user's file document is loaded into the exporter.

**Recommended fix:**
- Make one query, `files.find({ user: <ObjectId>, context: { $ne: 'avatar' } })`, which is owner-correct by construction. This replaces both the reference lookup and the `files.user` post-check, so SEC-002 holds by construction.
- Export each file **once**. Location: the folder of the first conversation that references it; else `agents/<slug>/files/` if an authored agent lists it; else `files/other/`. Every other reference links to that single path.
- References that do not resolve inside the owned set are skipped silently. This covers both "another user's file" (EDGE-008/009) and deleted files, without revealing which case applies.
- Optional: before go-live, run a read-only count of owned-but-unreferenced files (same style as Appendix A) to size the gap.

---

## MEDIUM

### M1. **REQ-014: skill files are stored in object storage, and imported skills keep their front matter inside `body`** -- MEDIUM

- `packages/data-schemas/src/schema/skillFile.ts:49-71` stores each skill file as a storage object (`filepath`, `storageKey`, `source`, `bytes`). `content` (`:102-104`) is an optional **lazy cache**, filled only when someone views the file (`packages/api/src/skills/handlers.ts:671-723`). `isBinary` files never have `content`. REQ-014 says "each skill file is written" without naming a source. An implementer who reads `content` will produce empty or missing files.
- `packages/api/src/skills/import.ts:405-411` creates imported skills with `body: skillMdContent`, which is the **whole** SKILL.md including its YAML front matter. This contradicts the schema comment at `skill.ts:103`. REQ-014 ("YAML front matter `name`, `description` … and the `body`") would then write two front-matter blocks, and Claude's Skill upload may reject the result or parse it wrongly.
- **Fix:** read skill-file bytes through the same `openFile` path, applying the H1 pre-flight and H2 rules (scoped by `skillId`). If `body` starts with a `---\n…\n---` block, either write it verbatim or strip it and regenerate the front matter. Generate front matter with `js-yaml` `dump`, which is already a `packages/api` dependency (`packages/api/package.json:144`). Extend Manual Verification step 3 to cover an imported skill.

### M2. **Validation "owner-type regression" test cannot fail; the real silent-failure point is elsewhere** -- MEDIUM

Mongoose casts query values to the schema type. On a `String` path (`message.ts:18`) an `ObjectId` is cast with `toString()`. On an `ObjectId` path (`file.ts:7`) a 24-hex string is cast to `ObjectId`. So `Message.find({ user: new ObjectId(id) })` **returns rows**, and the test "that would return zero rows if `messages` were queried with an `ObjectId`" passes no matter what. The type trap from RESEARCH §4.1 is real for raw `mongosh` and aggregation `$match` (where Appendix A ran), but the spec uses Mongoose models (Step 2).

The actual silent-failure risk is **in-JS comparison**: `file.user === userId` on lean docs compares an `ObjectId` with a string and is always false. Every file would then be dropped while the archive still "looks fine". The same risk applies to `tool_resources` id matching.

**Fix:**
- Replace the test with positive assertions that user A's own files, agents, memories and skills **are present** (non-empty, exact counts), next to the existing B-absent assertions.
- Require owner checks in the query, not in JS (H2 removes the main one), or `String(a) === String(b)` where unavoidable.
- Tone down "Owner types are the #1 silent-failure risk" in Critical Implementation Considerations.

### M3. **REQ-024 / OPS-001 / Manual step 5: the CLI is not deployable or runnable on prod as specified** -- MEDIUM

- `docker-compose.prod.yml:84-110` bind-mounts only `.env.prod`, `librechat.yaml`, three package `dist/`s, `api/server`, `client/dist`, and data directories. **`config/` and the root `package.json` are not mounted.** The image `librechat:upgrade` is built on the box (`:22-25`). OPS-001's "`git pull` on prod for the … `config/` script and `package.json`" therefore never reaches the container, so step 5 ("Run `npm run export-user` inside the API container") fails.
- Running the CLI on the host instead needs host `node_modules` and a Mongo port, and the DB ports are deliberately unexposed (`docker-compose.prod.yml` header, REQ-013/SEC-001 of SPEC-010).
- `./exports` inside the container is not visible on the host.
- **Fix (pick one, then state it in OPS-001):**
  - (a) Put the CLI entry under a mounted path (e.g. `api/server/...`) so `git pull` deploys it. Run it with `docker exec LibreChat node <path> <email> -` and let it write the zip to **stdout** (`> out.zip` on the host).
  - (b) Declare the CLI a local/restore-only tool (matching RESEARCH OD-8's offline-backup fallback) and drop the "inside the API container" step.
  - In both cases the npm script is a dev convenience only.

### M4. **Step 7 / REQ-024: `openFile` is built in `/api` JS, duplicated in the CLI, and EDGE-002 is never tested automatically** -- MEDIUM

Step 7 builds `openFile` in `UserController.js` from `getStrategyFunctions`. REQ-024's CLI has to rebuild the same thing on its own. `service.spec.ts` injects `Readable.from(Buffer)`, so `resolveStoredS3Key` is never exercised for the 8 prod records without `storageKey` (EDGE-002 claims a test, but no automated test reaches that code).

Both pieces already live in `packages/api`: `resolveStoredS3Key` (`crud.ts:283-287`) and `getS3FileStream` (`crud.ts:859`), re-exported via `packages/api/src/index.ts:60`. So `/api` is not needed at all.

**Fix:** add `createS3OpenFile()` in `packages/api/src/export/` (e.g. inside `service.ts` or a single-word `files.ts`). It should: skip or mark-missing any `source !== 's3'`, call `getS3FileStream(req, resolveStoredS3Key(file))`, and be used by both the controller and the CLI. Unit-test key resolution with a presigned-style `filepath` (`extractKeyFromS3Url` is pure given env, `crud.ts:641-680`). This also shrinks the `/api` footprint (MAINT-001).

### M5. **REQ-021/REQ-023: with `responseType: 'blob'` the 429 JSON arrives as a `Blob`; download lifecycle and progress are unspecified** -- MEDIUM

- Under `responseType: 'blob'` (REQ-021, copied from `getFileDownload`, `data-service.ts:724-731`), axios hands **error** bodies to the browser as a `Blob`. `error.response.data.error` is therefore `undefined`, and REQ-023's in-progress-vs-busy distinction silently falls back to the generic message unless the code does `await data.text()` + `JSON.parse`.
- A 160 MB download can take minutes. The Settings dialog can be closed in the meantime, which unmounts `ExportData`. Reopening shows an idle button, and clicking it gets a 429. "Preparing your export…" is the only feedback for the whole transfer.
- **Fix:**
  - Collapse to **one** 429 message ("An export is already running — try again in a few minutes"), so the body never needs parsing. Keep the two server error codes for logs only.
  - Show MB received via axios `onDownloadProgress`.
  - Require that the save-to-disk step runs in the promise chain and not in component state, so the file is still saved after the component unmounts.
  - Add these to the client test list.

### M6. **REQ-006 / REQ-009 / EDGE-007: branch and artifact selection rules are ambiguous or contradictory** -- MEDIUM

- **(a) Orphans.** `buildTree` returns roots as **siblings** (`packages/data-provider/src/messages.ts:41-46`), and the UI's root `MultiMessage` shows only the **last** root (`MultiMessage.tsx:42`). Under REQ-006 ("last child at every fork" plus "orphan treated as a root"), an orphan's subtree therefore lands in "Other versions". EDGE-007 instead says it is "rendered as a root of the main thread". Choose one. Mirroring the UI means "Other versions".
- **(b) Nested forks.** An alternative subtree can contain its own forks, and its linearisation is unspecified. Proposal: depth-first; each alternative follows its own last child; nested alternatives are appended to the same flat list; each gets a pointer `↳ branches from turn N`, with turns numbered along the main thread.
- **(c) "Only the last is written" (REQ-009).** "Last" by `createdAt` across all branches and "last on the main thread" differ in branched conversations. With the former, a main-thread link can point to a version that exists only in an abandoned branch. Specify "last occurrence on the main thread if present, else the last by `createdAt`".
- **(d) Boundary source.** `findAllArtifacts` falls back to `message.text` boundaries whenever no `content[]` part contains an artifact (`packages/api/src/artifacts/update.ts:247`). REQ-007 renders `content[]` when present, so the renderer must ignore boundaries whose `source` does not match what it renders.
- **Fix:** add these four rules to REQ-006/REQ-009 and one fixture each to `thread.spec.ts` / `artifacts.spec.ts`.

### M7. **Production Sizing / PERF-002: the ceiling is the 2 GB API container, not 7.8 GB host RAM; DEFLATE burns event-loop CPU for no gain** -- MEDIUM

- `docker-compose.prod.yml:59-64` limits `api` to `memory: 2G`, `cpus: "2.0"`. The spec's sizing ("host: 7.8 GB RAM available") and RESEARCH §6.2 ("even full in-memory buffering would be safe") reason from host RAM. Buffering is the tempting workaround for H1. Three concurrent 160 MB exports plus the API baseline could get the **only** API container OOM-killed, which takes down every user's chat.
- REQ-002 applies `compression: 'DEFLATE'` to all entries. About 245 MB of the data is PDF, Office, image and zip files that are already compressed, so pako spends main-thread CPU (shared with chat traffic) for roughly 0 % size reduction. That works against the "chat still answers" check.
- **Fix:**
  - State "no whole-file buffering".
  - Measure PERF-002 against the 2 G container limit (`docker stats` already does this).
  - Use per-entry `compression: 'STORE'` for file entries, with `DEFLATE` only for the generated text entries. JSZip supports per-file compression options.

---

## LOW

### L1. **REQ-009 extension map: SVG missing, `language` source wrong, unclosed artifacts undocumented** -- LOW
`image/svg+xml` is an artifact type offered to the model (`packages/api/src/prompts/artifacts/index.ts:53`) but is missing from the map, so it becomes `.txt`. Map it to `.svg`. The artifact header the model is taught has only `identifier`, `type` and `title` (`:40`), so for `application/vnd.code`, take the language from the inner fence info string (e.g. a fence opened with `python`) and fall back to the header `language`. An unclosed block runs to the end of the text (`update.ts:116-118`), so the rest of the message becomes the artifact; state that this is accepted.

### L2. **REQ-008 / REQ-014: YAML front matter escaping unspecified** -- LOW
Titles, tags and project names containing `:`, `"`, `#` or newlines produce invalid YAML. Hand-rolled front matter for the `Mixed` skill `frontmatter` bag is error-prone. Use `js-yaml` `dump` for both (available, see M1).

### L3. **SEC-003 cannot be fully met through the reused S3 helpers** -- LOW
`getS3FileStream` logs the raw error (`crud.ts:875`), and its own error message interpolates the key (`crud.ts:871`). The key is `<basePath>/<userId>/<file_id>__<originalname>` (`crud.ts:175-186`), so the original filename appears in the log. `extractKeyFromS3Url` debug-logs full URLs (`crud.ts:668, 687, 698`). Either document this as an accepted exception or have the export's `openFile` call the S3 client directly with a content-free error.

### L4. **REQ-004: `author` filters on child collections drop legitimate content** -- LOW
Filtering `prompts` by `author` in addition to `groupId ∈ …` excludes a production version written by a collaborator, and REQ-015 then silently falls back to an older prompt. The same happens to skill files that a collaborator added to the user's skill. The parent filter (group or skill authored by the user) already scopes ownership. Filter children by parent id only.

### L5. **REQ-007 rendering gaps** -- LOW
- Messages with `error: true` keep provider error payloads (often JSON) in `text`, which conflicts with "never raw JSON". Render them as the `> Fehler / Error:` line.
- User `quotes` (`message.ts:153`) are not stored in `text`, so the quoted context of user turns is lost. Render them as blockquotes.
- No timezone is given for dates in file names and turn timestamps (UTC vs Europe/Berlin), which changes names near midnight. Specify Europe/Berlin.

### L6. **Proportionality: cut what prod data does not exercise** -- LOW
- `image_url` / `image_file` → "link to the exported file when it resolves" (REQ-007): prod has 0 such parts (Production Sizing). Use the one-line placeholder only.
- Two 429 variants with two localised messages (REQ-003/REQ-023): one is enough (see M5).
- PERF-003's Mongoose-hook query-count test: REQ-005 is structurally obvious (a fixed list of `find` calls). Code review suffices; drop the test.
- The `vnd.librechat.*-preview` types in REQ-009 are client-side preview types, not model-emitted artifacts. Dropping them costs nothing.
- Keep: the `archived/` rule and project folders (cheap) and the manifest.

### L7. **Test plan gaps** -- LOW
- No CLI smoke test (even one: run against `mongodb-memory-server` with the injected `openFile`, then assert the zip entry list).
- The route test "fourth concurrent request → `export_busy`" needs a controllable blocking `openFile` to hold three exports open; specify it.
- The FAIL-004 disconnect test should assert that open source streams are **destroyed**, not only that the slot is released.
- The H1 hang/abort tests are listed under H1.

---

## Checked and confirmed (no finding)

- `api/server/routes/user.js:24-30` route block; mounted at `/api/user` (`api/server/index.js:286`). `requireJwtAuth` extracts bearer tokens only (`api/strategies/jwtStrategy.js:10`, `openIdJwtStrategy.js:83`), so a GET download has no CSRF/cookie-triggered surface.
- `compression()` (`api/server/index.js:224`) skips `application/zip` (not compressible), so streaming is unaffected.
- `strategies.js` S3 strategy: `getDownloadStream: getS3FileStream` (≈ line 123).
- `crud.ts:283-287` `resolveStoredS3Key`, `:641` `extractKeyFromS3Url` passes raw keys through, `:859` `getS3FileStream(_req, filePath)`. All three are exported via `packages/api/src/index.ts:60`.
- `findAllArtifacts` exported at `artifacts/update.ts:219`, returns `start`/`end`/`source`/`partIndex`, and is re-exported via `src/index.ts:3`.
- `buildTree` at `packages/data-provider/src/messages.ts:5`. The UI fetch sorts by `createdAt` ascending (`packages/data-schemas/src/methods/message.ts:347`), so the REQ-006 input order mirrors the UI.
- `MultiMessage.tsx:42` `messagesTree.length - siblingIdx - 1`, last sibling by default ✓.
- Owner field types in all 11 schemas match the REQ-004 table exactly (convo/message/chatProject/preset `String`; file/memory/agent/skill/skillFile/promptGroup/prompt `ObjectId`). `chatprojects` have no ACL sharing.
- `getAllUserMemories` (`methods/memory.ts:114-119`) does an unsorted `find({ userId })`, so REQ-012's sort is the exporter's responsibility (fine).
- Settings registry `importConversations` / `sharedLinks` on `DATA`/`data` (`registry.tsx:455-468`); `getFileDownload` blob pattern (`data-service.ts:724-731`); `create-user` / `delete-user` scripts (`package.json:31-36`); JSZip 3.10.1 is installed and a dependency of both `/api` and `packages/api`.
- Concurrency design (in-process counters, guarded single release on `close`) is sound for a single API container. Node ≥ 18 always emits `close` after `finish`.

## Recommended Actions Before Proceeding

1. Rewrite the file pipeline per H1: pre-flight, lazy wrapper, `pipeline` + watchdog, and the restated REQ-011/FAIL-003 boundary, with the three hang/abort tests.
2. Switch file selection to ownership per H2: one `files` query, export once, link from references.
3. Fix REQ-014 skill export (storage bytes, existing front matter in `body`, `js-yaml`).
4. Replace the vacuous owner-type test with positive presence assertions (M2).
5. Decide the CLI's deploy and run path (M3) and move `openFile` into `packages/api` (M4).
6. Simplify the client 429 handling and add download progress (M5).
7. Add the four branch/artifact rules (M6) and the container-limit / STORE guidance (M7).
8. Apply the LOW items opportunistically; take the L6 cuts.
