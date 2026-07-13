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

- **SSH:** `ssh memodo-eng-test` (alias for `178.105.91.145`, user `root`). Repo at `/opt/docker/librechat`.
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

- [ ] **`redakt` reachable from the box?** Determines whether PII detection (C1) can be tested at all
  (locally it was unreachable → PII fails *open*). Check: `docker exec LibreChat sh -c 'curl -s -o /dev/null -w "%{http_code}" http://host.docker.internal:8000/...'`
  or from the box against the `redakt` service/URL. _(log)_
- [ ] **`conv-log` actually capturing?** It's `Up`, but confirm it writes conversation rows post-upgrade
  (query its store / check its logs). _(log)_
- [ ] **`admin-panel` status** — it failed to start on a `127.0.0.1:3000` port conflict with Grafana.
  Decide if that matters for the SPEC-008 dashboard test (our dashboard is LibreChat's `/d/reporting`,
  distinct from the bundled admin-panel). _(log)_

---

## Part C — To test, by priority

### C1 — High-risk MemodoAI customizations (most likely to regress on a two-release jump)

- [ ] **PII detection warning toast (SPEC-009).** The exact code we merge-resolved (`useSSE.ts` /
  `useResumableSSE.ts` vs the v0.8.7 streaming refactor). Set `PII_DETECTION_MODE=warn`, send a PII
  message → **warning toast appears, message goes through**; set `=detect`, send again → **blocked with
  error**. Gated on B (redakt). _(browser + log: PII middleware fires)_ **Highest priority.**
- [ ] **Admin reporting dashboard (SPEC-008).** Load `/d/reporting` as an admin user → overview/trends/
  costs render (no "Failed to load … data"). Confirm it doesn't collide with the bundled admin-panel. _(browser + log)_
- [ ] **Conversation logging (conv-log / SPEC-016).** Hold a conversation → confirm it's captured in the
  conv-log store. _(log)_
- [ ] **RAG retrieval (file_search).** Upload a doc, ask a question about it → **grounded** answer, and a
  retrieval call actually happened (not a hallucination). Exercises MinIO + RAG API (Switzerland embeddings). _(browser + log)_

### C2 — M365 surfaces (re-verify on the upgraded test env; worked locally 2026-07-07, not re-run here)

- [ ] **People Search (Entra)** — search a colleague by name → real Entra people (not local users);
  login group-sync pulls **N groups from Graph** (not "falling back to local"). _(browser + log)_
- [ ] **Calendar** — "what's on my calendar today?" → real events. _(browser + log)_
- [ ] **OneDrive / Files** — list files → real data. _(browser + log)_
- [ ] **Contacts** — list/search contacts → real data. _(browser + log)_
- [ ] **To Do / Planner / OneNote / Excel** — quick smoke each → real data. _(browser + log)_
- [ ] **Read-only posture** — ask an agent to send an email / create a file → it declines or the write
  tool isn't available (v4 instructions + trimmed scopes). _(browser)_

### C3 — General v0.8.7 regression

- [ ] **Plain chat / streaming** with the default model. _(browser)_ _(partly seen: gpt-5 completions succeed)_
- [ ] **Model / agent switching** — switch models + agents; watch the `modelSpecs.enforce:true` gotcha
  ("No model spec selected"). Note: `enforce` is currently `false` in `librechat.yaml`. _(browser)_
- [ ] **Conversations** — new convo auto-titles (title-gen calls succeeded in logs), saves, reloads from
  history, deletes. _(browser)_
- [ ] **Web search (Serper)** — a query needing current info → it searches + cites. _(browser + log)_
- [ ] **File upload / MinIO** — upload works + stores + previews. _(browser)_
- [ ] **Settings / presets / parameters** panels open without errors. _(browser)_
- [ ] **Settings → About** shows the **v0.8.7** build (commit/branch) — confirms not a stale image. _(browser)_

### C4 — New v0.8.7 features (optional adoption — NOT regressions; lowest priority)

Several need enabling in `librechat.yaml` first (check what's on before testing):
- [ ] Chat Projects (folders) + Pinned Conversations
- [ ] Context Usage Gauge (note: **cost display is on by default** in v0.8.7 — decide if wanted for users)
- [ ] Agent Skills / Subagents
- [ ] Code Interpreter (secure code execution + file generation)
- [ ] Memory as an agent capability
- [ ] Human-in-the-Loop tool approval
- [ ] Keyboard shortcuts / new message navigation

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
