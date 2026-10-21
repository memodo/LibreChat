# CRITICAL-IMPL-user-data-export-20261021

**Subject:** SPEC-020 Per-user data export: standalone adversarial implementation review
**Inputs reviewed:** SPEC-020 rev 2 (incl. Review Resolution); `SDD/reviews/CRITICAL-SPEC-user-data-export-20261021.md`; commit `07bc1a105` on `feature/020-user-data-export`: `packages/api/src/export/*` (types, collect, thread, artifacts, markdown, readme, layout, paths, files, service, index + specs), `api/server/controllers/ExportController.js` (+ spec), `api/server/routes/user.js`, `api/server/scripts/export.js` (+ spec), `client/src/components/Nav/SettingsTabs/Data/ExportData.tsx` (+ spec), `registry.tsx`, `Auth/mutations.ts`, data-provider endpoint/service/key, en/de locales. Also read: `node_modules/jszip/lib/nodejs/*`, `jszip/lib/object.js`, `packages/api/src/artifacts/update.ts`, `packages/api/src/cdn/s3.ts`, `packages/data-schemas/src/{models,schema}/*` (relevant parts), `api/db/index.js`, `api/server/index.js` (middleware).
**Reviewer:** Critical-review subagent (Opus 5.5)
**Date:** 2026-10-21

---

## 1. Executive summary

The implementation is careful and mostly on-spec. The parts most likely to fail all hold up:

- **Owner scoping:** every collection query filters by owner, and the owned-file map decides which file bytes go into the archive.
- **Lazy streaming:** the S3 streams really are lazy. JSZip calls `pause()` before it attaches its `data` listener, so no wrapper is opened early.
- **Teardown:** `pipeline` plus the watchdog cleans up correctly.

I checked the streaming path beyond the unit tests. I ran the real controller under real Express with `compression()` and the real `writeExportArchive` from the built `packages/api` dist. Four cases behaved correctly:

- **Normal run:** 200, `application/zip`, chunked, not compressed, valid zip.
- **Client abort:** the open source was destroyed and the slot was free for the next request.
- **S3 failure mid-stream:** the socket was reset (`ECONNRESET`) and no truncated zip was delivered as a success.
- **Failure while the client was slow:** the request terminated and did not hang.

All existing tests pass: packages/api 68/68, api 8/8, client 6/6.

I found no cross-user leak and no path-escape. The problems are in four areas:

1. **Over-aggressive filename sanitizing (spec-inherited).** Every exported file is renamed, and paths inside skill folders change, so a skill's `SKILL.md` no longer matches its files.
2. **Concurrency slot freed too early.** The slot is released on client disconnect while preparation keeps running, so the "one per user" limit can be bypassed.
3. **Weak controller test.** It replaces both the service and `res`, so the real controller → service → Express composition has no automated coverage.
4. **Smaller gaps:** error-path diagnostics, preparation timeouts, and messages silently dropped from the thread view.

**Severity counts:** HIGH = 0, MEDIUM = 3, LOW = 9.

**Verdict:** **REVISE (small, targeted fix pass).** Nothing blocks a test-box trial today. CRI-01 and CRI-02 should be fixed before users download. CRI-01 cannot be undone after the server is deleted: users would keep mangled filenames and broken skill folders. CRI-03 should be fixed in the same pass because it is the test that would have caught CRI-02.

---

## 2. Methodology

- Read the spec in full, the prior spec review, and every source and test file in the commit.
- Read JSZip's `NodejsStreamInputAdapter`, `NodejsStreamOutputAdapter` and `object.js` to check the lazy-stream claim. The adapter's `_bindStream` calls `stream.pause()` **before** `.on('data')`, so Node does not schedule `resume_ → read(0)` and the wrapper does not open early. The "opens one file at a time" test (`service.spec.ts:551-569`) would fail if it did.
- Ran all three test suites named in the brief (all green).
- **Probe 1 (real HTTP):** built a minimal app in `/tmp` (outside the repo) with real `express` and `compression`, `createExportController`, and the built `writeExportArchive`. FileAccess served 3 × 5 MB files. Ran normal, abort, mid-stream failure and slow-client failure, then a follow-up request after each to check the slot was free.
- **Probe 2 (thread):** transpiled `thread.ts` and fed it a self-parented message and a 2-cycle.
- **Probe 3 (paths):** transpiled `paths.ts` and ran realistic filenames and skill paths through it.
- Checked the three stated deviations (§5) against the code they bypass.

---

## 3. Findings

### MEDIUM severity

#### CRI-01-MEDIUM: Filenames and skill paths are over-sanitized, so skill folders break and every user file is renamed

- **Category:** functional correctness / spec defect carried into code
- **Location:** `packages/api/src/export/paths.ts:5-13` (`slug` keeps only `\p{L}\p{N}`), `:16-28` (`splitFilename` slugs the stem), `:31-39` (`safeRelativePath` slugs every segment); used at `layout.ts:64-65` (owned files) and `layout.ts:182-184` (skill files).
- **Spec reference:** REQ-020 mandates `slug()` for "every path segment derived from user data". This contradicts Expected Outcomes ("opens anywhere (plain Markdown, **original files**)") and REQ-014/README (d) ("upload a skill folder as a Claude Skill").
- **Evidence (probe 3):**
  - `safeRelativePath('scripts/check_offer.py')` → `scripts/check-offer.py`
  - `safeRelativePath('references/api.v2.md')` → `references/api-v2.md`
  - `splitFilename('Angebot (final) v2.1_Kunde.pdf')` → `Angebot-final-v2-1-Kunde.pdf`
  - `splitFilename('Q3_Report.XLSX')` → `Q3-Report.xlsx`
- **Failure scenario:**
  - A skill's `SKILL.md` body says "run `scripts/check_offer.py`". In the archive the file is `scripts/check-offer.py`, so the uploaded Claude Skill points at a file that doesn't exist.
  - Separately, all ~210 user files reach the user under altered names: `_`, `.`, `(`, `)`, `,`, `&` and `'` all become `-`, and the extension is lowercased. Users who search their files by name later won't find them, and once the server is deleted the original names survive only as Markdown link labels.
- **Why it matters despite small numbers:** prod has 1 skill, but every file is affected. This is the one defect users would be left with permanently after shutdown.
- **Recommendation:**
  - Keep `slug()` for **generated** segments (conversation, artifact, project, agent and skill folder names).
  - Add a separate `safeFilename()` for original filenames and skill path segments that only:
    - removes `/ \ : * ? " < > |` and control characters,
    - strips leading dots and trailing dots/spaces,
    - rejects `.`/`..`,
    - caps the length (UTF-8 byte-aware).
  - Keep the original case of the extension.
  - Skill `relativePath` is already validated by the schema to `^[a-zA-Z0-9._\-/]+$` (`skillFile.ts:8,33`), so after dropping `.`/`..`/empty segments it can be used verbatim.
  - Collision suffixes from `PathRegistry` still apply.
  - Update REQ-020 and `paths.spec.ts:48-50`, which currently expects the mangling.

#### CRI-02-MEDIUM: The concurrency slot is released on disconnect while preparation keeps running, so REQ-003's limits can be bypassed

- **Category:** resource safety
- **Location:** `api/server/controllers/ExportController.js:37-40` (`res.once('close', … release())`); `packages/api/src/export/service.ts:157-167` (preparation runs to completion and only then checks `isAborted()`); `ExportController.spec.js:107-120` asserts this behaviour (`maxConcurrent: 1`, two runs in flight).
- **Spec reference:** REQ-003 ("at most **one** export per user and **three** server-wide run at the same time"). The ceiling exists to protect the 2 GB single container (PERF-002).
- **Failure scenario:** A user clicks Download and reloads the page while "Preparing…" is shown. The `close` event frees the slot, but `collectUserData` plus the sequential HEAD pre-flight keep running. The user clicks again and a second preparation starts for the same user. Repeating abort-and-retry, from a script or from several tabs opened one after another, gives N concurrent preparations, each loading every message of the user with full `content` (tool outputs are loaded even though they are never rendered). The global cap of 3 counts only runs whose response is still open, so it does not bound this either.
- **Recommendation:**
  - Release on `close` only once streaming has started: set a flag in `onReady`, because from then on `pipeline` ends the run promptly.
  - Before that point, keep the slot until `finally`.
  - The original reason for releasing on `close` (a hung preparation holding the slot forever) is better handled by a preparation timeout (CRI-06).
  - Change the controller test to assert the corrected behaviour.

#### CRI-03-MEDIUM: Controller tests replace both the service and `res`; the real composition is untested and the spec-required cases are missing

- **Category:** test quality
- **Location:** `api/server/controllers/__tests__/ExportController.spec.js:4-23` (an `EventEmitter` stand-in for `res`), `:28-44` (a blocking `run` stand-in plus `getModels: () => ({})`, `fileAccess: () => ({})`).
- **Spec reference:** Validation Strategy → Controller test: "with a controllable blocking **file access** holding exports open … slots released after `close` and after watchdog abort (fake timers)". CLAUDE.md: "Real logic over mocks."
- **Gap:** No automated test covers any of these:
  - the `getModels: () => mongoose.models` deviation (§5);
  - headers set in `onReady` going out before the first byte through Express and `compression()`;
  - the 500-after-`onReady` path (CRI-07);
  - slot release after a watchdog abort. The controller cannot even pass `inactivityMs` through, so that test cannot be written today.

  The controller's real value is how it composes these pieces, and none of that composition is exercised. I verified it by hand (probe 1) and it works today, but no test will catch a regression.
- **Recommendation:**
  - Write one `http`/supertest test with real `express` + `compression`, real `runUserExport` over `mongodb-memory-server` (`createModels(mongoose)`, then `getModels` left at its default), and an in-memory FileAccess whose `open()` blocks until released. Assert:
    1. 200 + headers + a zip that loads;
    2. 429 `export_in_progress` / `export_busy`;
    3. after the client aborts, the source is destroyed and the next request gets 200;
    4. with a small `inactivityMs` (add an `inactivityMs` option to `createExportController`), a stalled `open()` leads to an abort and a released slot.
  - Keep the current fast unit tests if wanted.

### LOW severity

#### CRI-04-LOW: An agent folder is incomplete when two authored agents share a knowledge file, yet the README says to upload the folder

- **Location:** `layout.ts:60-63` (`place` writes a file once), `:76-88` (the first agent wins); `readme.ts` agent text ("lade die Dateien aus `agents/<Name>/files/` … hoch").
- **Scenario:** Agents "Vertrieb" and "Service" both list `Preisliste.xlsx`. It is written to `agents/Vertrieb/files/` only. `agents/Service/instructions.md` links to `../Vertrieb/files/Preisliste.xlsx`, but a user following the README uploads `agents/Service/files/` and their Claude Project lacks the price list. The spec's own rationale for rule 1 ("so each agent folder is complete") is not met.
- **Fix:** Either duplicate agent knowledge files into each authored agent's folder (STORE costs nothing; the "once" rule then applies only outside agent folders), or change the README to "upload the files listed under *Wissensdateien / Knowledge files* in `instructions.md`".

#### CRI-05-LOW: SEC-002's wording contradicts REQ-004 and the tests for collaborator-authored prompts and skill files

- **Location:** `service.spec.ts:280-291` (a skill file with `author: userB` inside A's skill is exported); `:306-315`, `:469` (a production prompt authored by B is exported and asserted). SEC-002 lists "skill files, prompts … owned by another user" as never exported.
- **Assessment:** The code follows REQ-004 (children scoped by parent only, spec-review L4). That is the right call, because the content belongs to A's skill or prompt group. The spec text is self-contradictory, which invites a future "fix" in the wrong direction or a false leak report.
- **Fix (spec only):** Add to SEC-002: "Exception: children of the user's own skills and prompt groups are exported regardless of who authored them."

#### CRI-06-LOW: Preparation has no timeout, so a hung MinIO or MongoDB leaves the user on "Preparing…" indefinitely

- **Location:**
  - `files.ts:57-63`: `HeadObject` on the shared client from `initializeS3()` (`cdn/s3.ts:40-56`), configured with no `requestHandler` timeouts.
  - `collect.ts:39-82`: queries without `maxTimeMS`.
  - `service.ts:98-109`: the watchdog is armed only inside `writeExportArchive`.
  - Client side: `data-provider/src/request.ts` sets no axios timeout.
- **Scenario:** MinIO accepts the TCP connection but stalls. Pre-flight waits forever, the button spins forever, the run promise never settles (the collected data stays in memory), and the slot is held until the tab closes. With the CRI-02 fix it is held until the run ends, which makes this timeout a prerequisite.
- **Fix:** `s3.send(cmd, { abortSignal: AbortSignal.timeout(15_000) })` in `check`/`open`, mapped to `unreadable`; `.maxTimeMS(30_000)` on the collection queries. Optionally an overall preparation deadline in `runUserExport`.

#### CRI-07-LOW: Error paths are silent or mislabelled

- **Location:**
  - `ExportController.js:56-59` catches and discards the error.
  - `service.ts:150-154` logs `outcome: 'error'` with no error identity.
  - `service.ts:167`: a synchronous throw from `writeExportArchive` (e.g. from `zip.file`) skips the log line entirely.
  - After `onReady` has run, the 500 is sent as `res.json` with `Content-Type: application/zip` and `Content-Disposition: attachment` still set. Express's `res.json` keeps an existing Content-Type.
- **Impact:** For FAIL-002 on prod the only record is `outcome: 'error'`; the operator cannot tell a Mongo timeout from a rendering bug without reproducing it.
- **Fix:**
  - Log `errorName`/`code` (never `message`, to stay SEC-003-safe).
  - Wrap the `writeExportArchive` call so every run logs once.
  - In the controller's 500 branch, `res.removeHeader('Content-Disposition')` and set `res.type('json')`.

#### CRI-08-LOW: Messages that can't be reached from any root are silently dropped; the "identical root semantics" claim is not exact

- **Location:** `thread.ts:25-34`. A message is attached to its parent if the parent id exists **anywhere** in the conversation. Upstream `buildTree` (`data-provider/src/messages.ts`) attaches only to a parent that appeared **earlier** in `createdAt` order, which by construction can never form a cycle.
- **Evidence (probe 2):** input `[r (root), a (parent a)]` gives versions `[["r"]]`; `a` is gone. A 2-cycle `x↔y` disappears the same way. Meanwhile `counts.messages` (`layout.ts:150`) still counts them, so README and manifest overstate what the Markdown contains.
- **Likelihood:** very low (corrupt data only). The custom map is otherwise a sound choice (see §5).
- **Fix:** Track visited ids in `linearize`. After the walk, emit any unvisited messages as an extra version (or treat the earliest unvisited message as a root). This costs one `Set`.

#### CRI-09-LOW: The operator script may not exit after writing the zip (plausible, not verified)

- **Location:** `api/server/scripts/export.js:39-60`. `main()` disconnects mongoose but never calls `process.exit(0)`. `require('~/db')` (`api/db/index.js:11`) loads `indexSync`, which requires `~/cache` (cache/Redis clients when `USE_REDIS` is set) and `@librechat/api`, and data-schemas' winston uses `DailyRotateFile`. Any of these handles can keep the event loop alive. `main()` has no test; the smoke test covers only `exportUser`.
- **Fix:** `process.exit(0)` after the `finally`. Confirm during Manual Verification step 6.

#### CRI-10-LOW: Conversation front matter has `assistant`, not REQ-008's `model` or agent name

- **Location:** `markdown.ts:225, 241-248`; `collect.ts:40-43` does not select `model`/`endpoint`/`agent_id`.
- **Impact:** `sender` usually equals the model label or agent name, so the practical difference is small, but it is an unrecorded deviation. Either add `model` (and the agent name via the authored-agent map when `agent_id` is set) or record the deviation in the spec.

#### CRI-11-LOW: Test gaps against REQs the spec explicitly lists

- Archived conversations → `conversations/archived/` (REQ-008): no test (`grep isArchived *.spec.ts` finds nothing). There are 0 archived conversations in prod, so the risk is low.
- SEC-003 log shape: `logger` is mocked in `service.spec.ts:13-16` but never inspected. A future edit that adds `title` to the log line would pass.
- SEC-004 at archive level: the integration test does not assert that no entry contains a `..` segment or a leading `/` (one line over `names`).
- **Fix:** add these three assertions.

#### CRI-12-LOW: Code style (CLAUDE.md)

- Type-import order: in `layout.ts:1-9` and `markdown.ts:4-15` the multi-line `import type {…} from './types'` is the longest local type import and should come first.
- `packages/data-provider/src/data-service.ts`: the commit also reformats three unrelated fork-local functions (`buildUsageQueryString`, `getUsageTrends`, `getAdminConversation`). This is diff noise.
- Each conversation's messages are walked about six times (grouping, file refs, `buildThread` × 2, `splitMessage` map, `chooseArtifacts`, render), against "minimize looping". At 3,935 messages the cost is negligible; noted for completeness, no action required.

---

## 4. Checked and confirmed (no finding)

**SEC-001: route identity**
- `router.get('/export', requireJwtAuth, …)` (`user.js:29`).
- The controller reads only `req.user.id`/`req.user.email`; there are no params, query or body.
- No `/:id` route in `user.js` shadows `/export`.
- The filename comes from `[a-z0-9._-]` only (`service.ts:28-34`), so `Content-Disposition` cannot be used for header injection.

**SEC-002: cross-user data**
- Every REQ-004 filter is present (`collect.ts:39-82`). Children are scoped by parent id only.
- Mongoose casts string vs ObjectId per path.
- File bytes are reached only through `owned` (`layout.ts:56`). Message `files[]`/`attachments[]` (both persisted Mixed, `message.ts:106,128`) and agent `tool_resources` ids are looked up in it, so a foreign or deleted id is skipped.
- Project names resolve only against the user's own projects (`layout.ts:116,135-137`).
- Temporary conversations are excluded, and their messages are never rendered because rendering is driven by the conversation list.
- Skill files are matched to skills with `String()` on both sides (`layout.ts:179`).
- The operator script looks the user up by lowercased email; the User schema lowercases emails, and a miss fails closed.
- The two-user integration test asserts positive counts and absence of B's data.

**SEC-004: path safety**
- `slug()` removes every non-letter/digit, so no `.`, `..`, `/` or `\` can survive into a generated segment, and extensions are letters/digits only.
- `safeRelativePath` drops `.`/`..`/empty segments.
- The fixed top-level names (`README.md`, `manifest.json`, `memories.txt`, `prompts.md`, `presets.md`) cannot collide with registry paths, because all registry paths carry a folder prefix.
- `PathRegistry` is case-insensitive, so no two `zip.file()` calls share a name. JSZip silently overwrites duplicates, which makes this the important property.
- A skill file named `SKILL.md` gets `SKILL-2.md`, because the generated one is claimed first.

**Lazy stream and JSZip**
- No early open (see §2).
- Backpressure: `push()` returning false pauses the source, and `_read` resumes it.
- An open that resolves after the wrapper is destroyed destroys the late stream (`files.ts:104-107`).
- Errors are forwarded with `destroy(err)`.
- `streamFiles: true`, so `ZipFileWorker` emits the local header at `openedSource` and does not accumulate. Text entries go through `DataWorker` in chunks.
- Nothing is buffered whole apart from the generated Markdown strings (a few MB).

**pipeline, monitor and watchdog**
- The timer is cleared in the callback, and every source is destroyed on any outcome.
- The watchdog measures output progress after JSZip. A slow but live client keeps arming it; only a true stall trips it.
- Probe 1 confirmed `ECONNRESET` on mid-stream failure: the browser gets a failed download, never a truncated "successful" zip.

**Express integration**
- `compression()` leaves `application/zip` uncompressed (`content-encoding` absent in probe 1).
- Headers are set in `onReady` and flushed with the first byte; preparation errors before that return a 500 JSON (tested).
- The early-disconnect check happens before `onReady` (`service.ts:162-166`, tested).

**Slot release**
- The guarded `release()` covers finish/close/finally exactly once. The only issue is timing (CRI-02).

**Pre-flight**
- Sequential HEADs before headers are sent. A missing file goes into `missingFiles`, gets an inline marker, and is not added to the zip (tested).
- `unsupported_source` is detected; errors are content-free (`ExportFileError`, `files.spec.ts`).

**REQ coverage**
- REQ-001…REQ-026 are implemented as specified, except CRI-01 (REQ-020 itself), CRI-10 (REQ-008 front matter) and the branch-pointer wording (§5).
- EDGE-001 to EDGE-015 are covered by tests, except archived (CRI-11).

**Client**
- Save happens inside `mutationFn`, so it survives unmount (tested).
- 429 is detected from `error.response.status`, which works with blob response types.
- Progress is shown in MB; strings are localized in en and de (REQ-023 exception).
- The registry entry sits directly after `ImportConversations`.

**Data-provider**
- Endpoint, `getUserDataExport` (`responseType: 'blob'`, `Accept`, `onDownloadProgress`) and `MutationKeys.exportUserData` are present.

**Deploy note (OPS-001)**
- In v0.8.7 the dist entry is `packages/api/dist/index.cjs`, not `index.js` as CLAUDE.md's "stale dist" check says.
- Verify the deploy with `grep -c "archive stalled" /opt/docker/librechat/packages/api/dist/index.cjs`; the local build returns 1.

---

## 5. Stated deviations: judgement

| Deviation | Verdict |
|---|---|
| Controller in its own `ExportController.js` instead of `UserController.js` | **Sound.** It keeps the export's dependencies (and its injectable factory for tests) out of the large shared controller, and the route line is the only change to `user.js`. |
| `thread.ts` builds its own parent→children map instead of calling `buildTree` | **Sound, with one gap.** It avoids casting Date-typed lean docs to `TMessage`, and for well-formed data it matches the "last sibling at every level, orphan = root" rule. It is not *identical*: `buildTree` attaches only to an earlier-seen parent, which rules out cycles, whereas the id-set rule can drop corrupt subtrees silently (CRI-08). Where `createdAt` ordering is inconsistent (e.g. imports with tied timestamps), the export can show a better tree than the UI; that is acceptable. |
| Models from `mongoose.models` instead of `~/db/models` | **Sound.** `createConversationModel` applies `mongoMeili` to the shared schema *before* its `mongoose.models.Conversation ||` check (`data-schemas/src/models/convo.ts:10-21`), so calling `createModels` again would register the plugin twice. Model names match the `createModels` keys (`MemoryEntry`, `SkillFile`, `ChatProject`, …). It is untested in `/api` (CRI-03). |
| 401 relies on `requireJwtAuth` and is not re-tested | **Acceptable.** The middleware is shared with every `/api/user` route; re-testing it would only test passport. |
| Branch pointer text "after turn N **of version V**" instead of "from turn N" | **Better than the spec.** Nested forks inside an alternative cannot be expressed as a main-thread turn. Record it in the spec. |

---

## 6. Recommended actions (keyed to findings)

1. **CRI-01:** add `safeFilename()` for original filenames and skill segments (keep `_ . ( )` etc. and the extension's case), use skill `relativePath` verbatim after dropping traversal segments, and update REQ-020 and `paths.spec.ts`.
2. **CRI-02 + CRI-06:** release on `close` only after `onReady`; add HEAD/GET `abortSignal` timeouts and `maxTimeMS`.
3. **CRI-03:** add one real-HTTP controller test (real express + compression + `runUserExport` + mongodb-memory-server + blocking FileAccess, with `inactivityMs` injectable) covering 200/429/abort/watchdog.
4. **CRI-07:** log `errorName`/`code` on every failed run; clean up the headers on the late 500.
5. **CRI-04, CRI-08, CRI-09, CRI-10, CRI-11:** small code or test fixes as described.
6. **CRI-05, CRI-10 (if not coded), §5 branch wording:** update the spec text.
7. **CRI-12:** optional tidy-up.
