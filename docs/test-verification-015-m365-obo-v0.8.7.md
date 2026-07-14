# Test & Verification Plan — `feature/015-m365-obo-v0.8.7`

**What this validates:** the **v0.8.5 → v0.8.7-rc1 upgrade** (~470 upstream commits, two releases) **and**
the **Microsoft 365 MCP integration** (native OBO, read-only SharePoint Phase 1). This is the
regression + feature-coverage tracker; the *deploy* steps live in
[`deploy-checklist-015-m365-obo-v0.8.7.md`](deploy-checklist-015-m365-obo-v0.8.7.md).

> **Purpose:** started 2026-07-09 so testing can resume in a fresh session. Work top-down; check items
> off as verified. **Part A is already done — do not redo it.** Start at Part B.

---

## How to use this

- **Test surface:** the test env **https://chat-test.memodo.de** (Hetzner clone, branch
  `feature/015-m365-obo-v0.8.7`, built from source). Sign in via **"Continue with Microsoft"** (Entra SSO)
  — M365/OBO only works through SSO, not local email login.
- **Two kinds of check:** _(browser)_ = you drive it in the UI; _(log)_ = Claude confirms it from the
  server logs. Many items are both: you exercise it, Claude verifies the evidence.
- **A change is "verified" only with evidence** (a log line, real data returned) — not just "looked OK".

## Environment & access (for a fresh session)

- **SSH:** `ssh memodo-eng-test` (ssh-config alias; host IP redacted), user `root`. Repo at `/opt/docker/librechat`.
  Compose helper: `./test.sh` (layers `docker-compose.yml` + `override.yml` + `prod.yml` + `test.yml`,
  `--env-file .env.prod`). Recreate api: `./test.sh up -d --force-recreate api`.
- **Logs:**
  - API: `docker logs LibreChat` (add `--since 15m`); file logs bind-mounted at
    `/opt/docker/librechat/logs/debug-YYYY-MM-DD.log` and `error-*.log`.
  - M365 sidecar (Graph calls): `docker exec mcp-m365 sh -c 'tail -n 40 /root/.ms-365-mcp-server/logs/mcp-server.log'`.
- **Config:** `librechat.yaml` (git-tracked, identical everywhere); `.env.test` (git-tracked, aligned —
  holds the OBO/Azure overrides); `.env.prod` (gitignored, secrets, prod-clone).
- **Auth model:** Azure OpenAI chat = **Sweden Central** (`memodo-openai-sweden`, deployments `gpt-5` /
  `gpt-5-mini`); embeddings/RAG = **Switzerland North** (its own `RAG_*` vars). Entra app
  `323c5939-…`, tenant `73927432-…`.

## Status legend

`[x]` verified with evidence · `[ ]` not yet tested · `[~]` partial / inferred · `(browser)` `(log)`

---

## Part A — Already verified (2026-07-08/09, on the test box) — do NOT redo

- [x] **App boots** healthy on the from-source v0.8.7 build (`RestartCount 0`, listening on 3080). _(log)_
- [x] **Entra SSO login** via "Continue with Microsoft" (real Entra identity). _(browser/log)_
- [x] **OBO token exchange** succeeds — **0 AADSTS** after the `OPENID_SCOPE` fix. _(log)_
- [x] **Outlook / mail** — `list-mail-folder-messages` returned real inbox data (~3.7 KB). _(log)_
- [x] **SharePoint read (Phase 1)** — `list-sharepoint-site-lists` / `-list-items` via `$search` returned
  real data; read-only surface **93 registered / 212 skipped**; v4 steering held (no
  `contains()`/non-indexed-`Title`/`fetchAllPages`). _(log)_
- [x] **Tool-less agent** ("You are the best") responds correctly. _(browser)_
- [x] **Tool-bearing agents** (M365, file_search) complete after the Azure-endpoint fix (route to Sweden,
  HTTP 200). _(browser/log)_

**Two v0.8.7 regressions found + fixed + re-verified here** (see deploy checklist items 1 & 1b):
`OPENID_SCOPE` missing the `api://…/access_as_user` scope; and legacy `AZURE_OPENAI_ENDPOINT` misrouting
tool-agent completions to Switzerland → 401.

---

## Part B — Gating pre-checks (run FIRST; they decide whether some Part C items are testable)

- [x] **`redakt` reachable from the box?** **YES (2026-07-13).** All three redakt containers
  (`redakt-redakt-1`, `-presidio-analyzer-1`, `-presidio-anonymizer-1`) `healthy`; `LibreChat` shares the
  `caddy_net` network with redakt (redakt's `8000/tcp` is unpublished to host but reachable in-network).
  Proven live: PII detection fired end-to-end (see C1). PII config is in `.env.prod` (dotenv-loaded, so it
  does NOT show in `docker exec … env`); current `PII_DETECTION_MODE=warn`. _(log)_
- [x] **`conv-log` actually capturing? YES (2026-07-13).** Store = `convlog` DB on `vectordb`; source =
  `chat-mongodb/LibreChat` via watermark+interval poll. **882 msgs / 225 convos**; both today's test
  convos present (`afb482b1` RAG 19:21, `f3c789ee` PII 18:31); watermark 19:20:41, `last_sync_status=ok
  batchSize:4` @19:24 → near-real-time capture works. **Sub-finding:** `guardrail_events_log` = 0 rows —
  the 18:31 PII detection did NOT produce a guardrail-event row (see C1.3 note). _(log)_
- [x] **`admin-panel` status** — **DECIDED: does not block us.** admin-panel is NOT running (confirmed
  absent from `docker ps`; Grafana owns `:3000`). SPEC-008's dashboard is a **LibreChat in-app React
  route** at `chat-test.memodo.de/d/reporting` (`client/src/components/Admin/Reporting/…`, admin-only,
  lazy-loaded) — NOT Grafana and NOT the bundled admin-panel → C1's dashboard test is unaffected. _(log)_

---

## Findings discovered during testing (consolidated)

Issues surfaced while verifying, gathered here for follow-up/ticketing. **None block the v0.8.7 + M365
deploy.** Ranked by severity. Each links back to the test item where the evidence lives.

| # | Severity | Finding | Where observed | Impact | Suggested follow-up |
|---|---|---|---|---|---|
| 1 | ✅ RESOLVED | **conv-log never mirrors guardrail events to Postgres** (was 0 rows in `guardrail_events_log` vs 100 in Mongo). **FIXED** on `fix/convlog-guardrail-mirror` (`f64ddab7c`), merged to feature/015 as `97bdefdaf` (2026-07-14): (A) guardrail sync decoupled onto its own `guardrail_high_watermark` + epoch backfill; (B) `request.js` back-links the real `messageId`/`conversationId`; + orphan-row retention sweep. Clean merge, back-link test 4/4. | C1.3 (conv-log) | Grafana **SPEC-017** guardrail view populates after conv-log restart (auto-backfills ~100 events). | **Deploy:** rebuild `conv-log` **and** api dist (touches `conv-log/` + `api/server/`), not yaml-only. |
| 2 | ✅ RESOLVED | **OneDrive "list files" is fragile** — `search-onedrive-files` with `q="*"` → Graph `400` "potentially dangerous Request.Path (*)"; model works around with single-letter searches. Auth/OBO fine. **FIXED** on `fix/onedrive-list-files` (`f9f419875` + `1495f90a6`), merged to feature/015 as `f2a535581` (2026-07-14): `Microsoft365` serverInstructions now steer list/browse to `list-drives` → `get-drive-root-item` → `list-folder-files` (avoid `q="*"`), and the SPEC-014 UX-002 non-enumeration guardrail was restored; marker bumped to `v6`, REQ-028 checksum regenerated to `d89c21dc…` (reproduced + verified). Clean merge, YAML valid, capabilities intact (8). | C2 (OneDrive) | "List my files" degrades into wildcard-fail → letter-guessing; data ends up correct but path is inefficient. | **Deploy:** yaml + checksum only — `git pull` + recreate api on the box (no rebuild). |
| 3 | ✅ RESOLVED | **Settings → About: Commit/Branch/Built blank** (`–`) — build didn't inject git build-metadata env. **FIXED** on `fix/inject-git-build` (`66e17d3ab`), merged to feature/015 as `e1bc41554` (2026-07-14): `prod.sh`/`test.sh`/`rebuild-local.sh` export `BUILD_COMMIT`/`BUILD_BRANCH`/`BUILD_DATE` from host git at recreate; `docker-compose.override.yml` passes them to the api service. Consumer `packages/api/src/app/build.ts` (`resolveBuildInfo`, already in tree) prefers env over in-container git (unavailable — the blank cause). `build.spec.ts` 5/5. | C3 (About) | "Copy diagnostics" block can't identify the exact commit for support. | **Deploy:** deploy-script/compose only, no rebuild — `git pull` + `./test.sh up -d --force-recreate api` (`--force-recreate` required; env change isn't picked up by a plain restart). Evidence: `curl -s localhost:3080/api/config` → `buildInfo` populated, or reload Settings → About. |
| 4 | Low | **RAG `DELETE /documents` 404 wrinkle** — on file removal `rag_api` logged `200` then `404 "One or more IDs not found"`; UI removal still succeeded. | C1.4 (RAG) | Benign idempotency noise in logs; no functional impact. | Monitor; low priority. |

---

## Part C — To test, by priority

### C1 — High-risk MemodoAI customizations (most likely to regress on a two-release jump)

- [~] **PII detection warning toast (SPEC-009).** The exact code we merge-resolved (`useSSE.ts` /
  `useResumableSSE.ts` vs the v0.8.7 streaming refactor). Set `PII_DETECTION_MODE=warn`, send a PII
  message → **warning toast appears, message goes through**; set `=detect`, send again → **blocked with
  error**. Gated on B (redakt). _(browser + log: PII middleware fires)_ **Highest priority.**
  - [x] **`warn` half VERIFIED (2026-07-13).** Browser: orange toast "Your message appears to contain
    personal information (names)…" shown for *"My name is Pablo and I live in Augsburg…"*, and GPT-5 still
    answered (message passed). Log: `[detectPII] PII detected in message, warning (allow through)`
    (18:31, userId `<redacted>`). Confirms the merge-resolved streaming path survived the v0.8.7 refactor.
  - [~] **`detect` half SKIPPED (Pablo's call, 2026-07-14)** — too disruptive (needs env edit + ~2 api
    restarts that drop the live session). Warn-path (the merge-sensitive SSE code) is proven; detect uses
    the same detection with a blocking response. If revisited: edit `PII_DETECTION_MODE=detect` in the
    box env file (confirm whether it's `.env.prod` via `--env-file` or a bind-mounted `.env` via dotenv
    first) → re-chown `1000:1000` if `.env.prod` → recreate api → expect blocked-with-error → revert to `warn`.
- [x] **Admin reporting dashboard (SPEC-008). VERIFIED (2026-07-13).** `/d/reporting` rendered fully as
  admin (`/api/roles/ADMIN` 200): overview tiles (Registered / Active / Conversations / Total Spend /
  Transactions — real non-zero figures rendered; specific values redacted), Usage Trends daily table, Cost by Model (`gpt-5`, `gpt-5-mini`),
  Users section. **All data endpoints 200** — `/api/admin/usage/{overview,trends,models,users,activity}`
  + `/api/admin/usage/guardrail-events` (the SPEC-009 PII audit feed is wired in). No "Failed to load".
  Note: Total Spend renders as negative credits (internal token-credit convention, not a bug). _(browser + log)_
- [x] **Conversation logging (conv-log / SPEC-016). VERIFIED (2026-07-13).** Both test convos landed in
  `convlog.conversations_dim` + `messages_log` within ~3 min (near-real-time interval sync, watermark
  19:20:41, `last_sync ok batchSize:4`). 882 msgs / 225 convos total.
  - **FINDING (not a v0.8.7 regression, own ticket): conv-log does not mirror guardrail events.** Mongo
    `GuardrailEvent` (source of truth) has **100** rows incl. today's 18:31 `pii/warn` event → PII
    persistence works; the LibreChat admin dashboard reads Mongo directly so its guardrail feed is fine.
    But conv-log's Postgres `guardrail_events_log` = **0** rows all-time → the Mongo→PG guardrail sync
    isn't populating. Impact limited to the **Grafana SPEC-017** guardrail view (empty), not the app.
    conv-log is a separate sidecar untouched by the upgrade. **Root cause identified:** conv-log
    `src/mongo.ts` `fetchGuardrailEvents(client, messageIds)` only pulls guardrail events whose `messageId`
    is in the current message batch, but `GuardrailEvent` is created pre-generation (no `messageId`) and
    back-linked later via `agents/request.js` `updateOne` — the link evidently never matches, so events
    are never synced. **✅ RESOLVED 2026-07-14:** fixed on `fix/convlog-guardrail-mirror` (`f64ddab7c`),
    merged to feature/015 as `97bdefdaf` — guardrail sync decoupled onto its own `guardrail_high_watermark`
    + epoch backfill (A); `request.js` back-links the real `messageId`/`conversationId` at the source (B);
    + orphan-row retention sweep. Back-link test 4/4 green on the merge. **Deploy:** needs conv-log rebuild
    + api dist rebuild (not yaml-only). _(log)_
- [x] **RAG retrieval (file_search). VERIFIED (2026-07-13).** Uploaded `rag-probe.md` (planted
  unguessable facts) with File Search ON → GPT-5 returned the exact facts (serial `ZQX-77413-VELDT`,
  `8,431.72 kilohertz`, codename "Operation Marzipan Lighthouse") with a "Searched your files → rag-probe.md
  42%" citation. Log (`rag_api`): `POST /embed 200` on upload + `POST /query 200` ×2 at ask-time, each via
  `memodo-openai-switzerland-north … text-embedding-3-small` 200 → genuine retrieval, not hallucination.
  Confirms MinIO + RAG API + **Switzerland** embeddings, and corroborates item 1b (RAG unaffected by the
  neutralized `AZURE_OPENAI_ENDPOINT`). Minor: `DELETE /documents` logged `404 "IDs not found"` on file
  removal (UI removal still worked) — benign idempotency wrinkle, low priority, not a regression blocker. _(browser + log)_

### C2 — M365 surfaces (re-verify on the upgraded test env; worked locally 2026-07-07, not re-run here)

- [~] **People Search (Entra)** — search a colleague by name → real Entra people (not local users);
  login group-sync pulls **N groups from Graph** (not "falling back to local"). _(browser + log)_
  - [x] **group-sync VERIFIED (2026-07-13):** at 18:57 login, `[PermissionService.syncUserEntraGroupMemberships]
    Syncing 43 groups … Successfully synced` → **43 real Entra groups from Graph**, not local fallback.
    Also **0 `AADSTS` errors in 90m** → OBO exchange clean (upgrade linchpin, deploy items 1/1c). _(log)_
  - [x] **name-search half CONFIRMED (2026-07-13)** by Pablo's own manual test (people picker returns real
    Entra people, not local users). OBO/Graph foundation it depends on independently verified here. _(browser)_
- [x] **Calendar VERIFIED (2026-07-13).** "What's on my calendar today?" → GPT-5 "Ran get-calendar-view in
  Microsoft365" → 2 real events returned with times + titles (titles redacted).
  Sidecar: `get-calendar-view` → `GET graph.microsoft.com/v1.0/me/calendarView` → `Response size: 1660`. _(browser + log)_
- [x] **OneDrive / Files VERIFIED (2026-07-13).** "List my 5 most recent OneDrive files" → real files
  returned (5 real filenames — redacted). `list-drives` → real business drive
  (name + owner email redacted). **Rough edge (steering, not auth):** `search-onedrive-files`
  with `q="*"` → Graph 400 "potentially dangerous Request.Path (*)"; model worked around via single-letter
  searches (q=a/e/o) — no clean "list drive-root children" path used. Data correct; path inefficient. _(browser + log)_
- [x] **Contacts VERIFIED (2026-07-13).** "List a few of my Outlook contacts" → "Ran list-outlook-contacts"
  → 6 real contacts (names + memodo.de/external emails; PII kept out of this doc). Sidecar: `list-outlook-contacts`
  → `GET /me/contacts?$top=10&$select=id,displayName,emailAddresses` → `Response size: 2890`. Clean, no errors. _(browser + log)_
- [x] **To Do / Planner / OneNote VERIFIED (2026-07-13)** (Excel not smoke-tested — needs a workbook).
  "Used 3 tools": `list-todo-task-lists` → "Tasks" + "Flagged Emails"; `list-planner-tasks` → empty
  (legit — no plans, `Response size: 9`, not an error); `list-onenote-notebooks` → "Pablo @ Memodo GmbH".
  All via OBO/Graph, no errors. Excel read tools expected to behave the same (untested). _(browser + log)_
- [x] **Read-only posture VERIFIED at config+registration level (2026-07-13).** `MS365_MCP_ALLOWED_SCOPES`
  = `User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All`
  (NO `.Send`/`.ReadWrite`); `MS365_MCP_ORG_MODE=true`. → 212 write tools skipped (`send-mail`,
  `create-calendar-event`, `upload-file-content`, `delete-onedrive-file`, `send-chat-message`, …) — the
  agent has no write tool to invoke. Strongest form of the posture. Behavioral confirmation below. _(log)_
  - [x] behavioral VERIFIED: asked to send an email → GPT-5 declined: "my Microsoft 365 access here is
    read-only … Sending mail requires write permissions (e.g. Mail.Send), which are not enabled" — no
    tool call made, offered a `mailto:` link instead. Nothing sent. _(browser)_

### C3 — General v0.8.7 regression

- [x] **Plain chat / streaming VERIFIED (2026-07-13).** gpt-5 streamed completions throughout the session
  (calendar, RAG, web search, PII) render token-by-token and complete cleanly. _(browser)_
- [x] **Model / agent switching VERIFIED (2026-07-13).** Switched GPT-5 spec → "Concierge" agent
  mid-conversation via picker (My Agents / MemodoAI categories both list correctly). Agent responded
  cleanly ("I'm the Memodo Concierge…"), composer → "Message Concierge". **No "No model spec selected"**
  error — `modelSpecs.enforce:false` confirmed not triggering the gotcha. _(browser)_
- [~] **Conversations (2026-07-13).** Auto-title ✅ (many: "Today's Calendar Events", "Widget Serial,
  Frequency, Codename", "Augsburg Weather Forecast"), save ✅, reload-from-history ✅ (all session convos
  persist + reopen). **Delete deferred** — destructive; left for Pablo to exercise (didn't hard-delete
  user conversations without explicit OK). _(browser)_
- [x] **Web search (Serper) VERIFIED (2026-07-13).** "Today's weather for Augsburg?" → "Searched the web"
  → real current forecast (high 30°C / low 17°C, dated Mon 13 Jul 2026) with inline citations to
  wetter.com + Deutscher Wetterdienst + Source section. Log: `[onSearchResults] thread_id 9f3659dd…`. _(browser + log)_
- [~] **File upload / MinIO (2026-07-13).** Upload + store ✅ via the RAG probe (`rag-probe.md` uploaded,
  chip rendered, embedded through RAG API). Image-**preview** not separately tested (couldn't drive the
  file picker programmatically). Upload mechanics proven; image thumbnail preview untested. _(browser)_
- [x] **Settings / presets / parameters VERIFIED (2026-07-13).** Settings dialog opens clean — General/Chat/
  Speech/Data & Privacy/Account/About tabs all render, toggles present, no errors. _(browser)_
- [x] **Settings → About shows v0.8.7 VERIFIED (2026-07-13).** About tab → Version `v0.8.7` (also footer
  "LibreChat v0.8.7"). Not a stale image. Minor: Commit/Branch/Built blank (`–`) — build didn't inject git
  metadata env; cosmetic, inject `BUILD_*` args at deploy for support traceability. _(browser)_

### C4 — New v0.8.7 features (optional adoption — NOT regressions; lowest priority)

- [x] **Reviewed as an adoption/decision exercise (2026-07-14), not pass/fail testing.** Full grounded
  review → **[`v0.8.7-feature-adoption-decisions.md`](v0.8.7-feature-adoption-decisions.md)** (each feature
  tagged with its actual state in our deployment + what enabling takes + trade-off + blank Decision column).
  Key facts established from the deployed `librechat.yaml` + v0.8.7 `AgentCapabilities` enum:
  - **Active now:** Chat Projects, Global Memory (`personalize:true`), People Picker, File Citations, Prompts, Bookmarks.
  - **Off, yaml-only to enable:** OCR, Subagents, Chain, Memory-capability, Context, Marketplace, Multi-convo, Remote Agents.
  - **Off, needs infra (bundle together):** Code Interpreter (`execute_code`) + **Agent Skills** (`skills`) — both need a code-execution sandbox; `skills` is NOT in our `capabilities` today.
  - **Cost display:** usage tracking ON (`transactions`), balance enforcement OFF; per-user cost gauge = policy decision (verify in UI).
  - Deployed `agents.capabilities` = `[file_search, web_search, actions, artifacts, tools]` (5 of 16).

---

## Part D — How Claude verifies from logs (helper reference)

- **OBO / auth:** `docker logs LibreChat --since 15m | grep -iE 'AADSTS|OBO|Failed to establish'` → expect none.
- **Which Azure instance / status:** `docker logs LibreChat --since 15m | grep -iE 'openai.azure.*chat/completions.*status'`
  → expect `memodo-openai-sweden … 200`, never `switzerland`. (Temp deep debug: set `OPENAI_LOG=debug`
  in `.env.test` + recreate — **remove after**.)
- **M365 tool count / read-only surface:** sidecar log `Tool registration complete: N registered, M skipped`;
  API log `Storing tool context … N tools`.
- **M365 Graph calls + errors:** sidecar `mcp-server.log` — tool name, URL, `Response size`, any 4xx.
- **People Search group-sync:** API log at login — "N groups from Graph" vs "falling back to local results".

---

## Related docs (all on this branch)

- Deploy: `docs/deploy-checklist-015-m365-obo-v0.8.7.md` (prod `.env.prod` items 1/1b/1c; v0.8.7 image is OPEN)
- M365: `docs/m365-sharepoint-readonly-runbook.md`, `docs/m365-people-search-runbook.md`,
  `docs/m365-softeria-fetchallpages-toon-bug.md`
- Research/ADR: `SDD/research/RESEARCH-018-…`, `SDD/adr/0004-…`

## Session-continuity notes (state as of 2026-07-09)

- Local, `origin`, and the chat-test box are all at commit **`b494dfbea`**, clean.
- `.env.test` is committed/aligned (OBO scope, Azure-neutralization, userinfo flow, SSO enabled). Local
  `.env` aligned too (applies on next local restart). Prod `.env.prod` deltas are manual → deploy checklist.
- The temporary `OPENAI_LOG=debug` has been **removed** from the box.
- Nothing is on `pablo` or prod yet. Next milestones after testing: `pablo` fast-forward → prod deploy.
