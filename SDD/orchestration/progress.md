# Progress

## Current State (2026-07-27 18:45) — ✅ CUTOVER COMPLETE, prod on v0.8.7, §6 fully verified

**DONE.** All runbook steps (0–6) executed and verified. Prod serves **v0.8.7** at `chat.memodo.de`,
api healthy `restarts=0`, 0 unhealthy containers, 14 GB free. Local `pablo` = local `memodo` =
`origin/pablo` = `origin/memodo` = prod = **`489abbbd6`**, all trees clean. Local and prod `.env.prod`
hold identical variable sets (994 lines each).

### §6 verification evidence (all confirmed by log, not assertion)

| Check | Evidence |
|---|---|
| App version | `v0.8.7` in the container's `package.json` (was v0.8.5) |
| Boot | no `MODULE_NOT_FOUND`, MongoDB connected, listening 3080, `restarts=0` |
| Chat routing (item 1b) | `switzerland` matches in api log = **0**; `memodo-openai-sweden` in use |
| **OBO / M365** | `16:03:27 Resolving OBO token for scopes: User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All` → `16:03:28 Connection successfully established`. **`AADSTS` count = 0.** |
| Finding #6 (no re-auth loop) | exactly **one** `[MCP Reinitialize]` — no hourly/post-restart cycling |
| People Search | `syncUserEntraGroupMemberships: Syncing 43 groups` → `Successfully synced` (Graph, not local fallback), on each login |
| RAG upload + Q&A | `…switzerland-north…/text-embedding-3-small/embeddings → 200 OK`; `rag_api:8000/embed → 200`; `rag_api:8000/query → 200` |
| Web search | `[onSearchResults]` returned — works (see caveat below) |
| Admin reporting | Active Users column verified by user |
| Public | `chat.memodo.de` 200 / 52 ms; `/guide` 200; guide MP4 200; `chat.memodo-eng.de` 301 |

### Open, non-blocking

- **Web search runs without a reranker.** `No reranker selected. Using default ranking` + 7×
  `No reranker provided for highlights`. Neither `JINA_API_KEY` nor `COHERE_API_KEY` exists in
  `.env.prod`. **Not a regression** — never configured; reranking is a v0.8.7 capability. Search
  returns results via Serper, just with default ordering. Optional improvement.
- 🔴 **Rotate `AZURE_OPENAI_API_KEY_SWEDEN`** — printed in plaintext into an agent transcript
  2026-07-27 (redaction pattern only matched names *ending* in `KEY`). Update prod **and** the local
  `.env.prod` (now in sync — keep it that way), then `./prod.sh up -d --force-recreate api`.
- `ADMIN_PANEL_SESSION_SECRET` / `METRICS_SECRET` unset — both benign, investigated (see below).
- Carried over: chat-test box still has a hand-edited dirty `librechat.yaml`
  (`memory.agent.enabled` applied manually 2026-07-23, backup `librechat.yaml.bak-mem019`).
  Reconcile with `git checkout librechat.yaml && git pull`. Prod unaffected.

---

## Cutover detail (2026-07-27) — prod moved v0.8.5 → v0.8.7

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-27_17-02-51.md`
- **Working on:** **PROD CUTOVER** of `feature/015-m365-obo-v0.8.7` to `chat.memodo.de`. Ad-hoc deploy
  work, NOT an SDD phase (SDD-FLOW 019 closed 2026-07-23 — see History). Deploy target branch is **`memodo`**
  (prod tracks it).
- **Runbook §5 steps 0–5 are DONE.** Prod serves **v0.8.7** on image `librechat:upgrade`, api healthy,
  `restarts=0`, all 23 containers healthy, `chat.memodo.de` 200. Both branches at **`c850e8697`**
  (`memodo` and `pablo` pushed and identical).
- **Remaining: §6 verification that needs an authenticated browser session** — fresh Entra login
  (mandatory), OBO/M365 tool attach (~93 tools), People Search group sync, v0.8.7 smoke (chat, agents,
  RAG, web search), `/d/reporting` Active Users column. Everything verifiable without a login has
  passed (see below).

### Incident during the window (resolved, root-caused, fixed in git)

The first `./prod.sh build api` **filled prod's disk and crashed MongoDB** (~51 s down: WiredTiger
abort 15:34:01 → auto-restart 15:34:52; unclean shutdown recovered cleanly, **no corruption**, and the
step-1 dump at 15:24:37 predates it). Root cause: `Dockerfile:54` is `COPY . .` and `.dockerignore`
never excluded the host runtime dirs — prod's `backups/` is **7.4 GB** (7.3 GB of it `backups/minio`),
so the build tried to write production backups into an image layer. The test box built fine only
because it carries no backups. Fixed by commit **`c850e8697`** (`backups`, `guide-media`, `logs`,
`uploads` added to `.dockerignore` — all four are bind-mounted over their container paths at runtime,
so the image copies were always dead weight). Context 7.5 GB → <200 MB; rebuild peaked at 14 GB free
and succeeded. Verified at image level: `/app/backups` does not exist in `librechat:upgrade`.

### Second incident: item 1b broke RAG file uploads (root-caused + FIXED + verified)

Minutes after the recreate, **all file uploads failed** — `[/files] Error processing file: File
embedding failed`, and in `rag_api` `openai.APIConnectionError: Connection error`. Caused by item 1b.

Checklist item 1b asserted "RAG is safe — it reads `RAG_OPENAI_API_KEY`/`RAG_OPENAI_BASEURL`, not the
generic `AZURE_OPENAI_*`". **That was wrong.** `RAG_OPENAI_*` is only read on the **`openai`** provider
path; prod runs `EMBEDDINGS_PROVIDER=azure`, which takes the azure branch of `rag_api`'s
`app/config.py`:

```python
AZURE_OPENAI_ENDPOINT     = get_env_variable("AZURE_OPENAI_ENDPOINT", "")
RAG_AZURE_OPENAI_ENDPOINT = get_env_variable("RAG_AZURE_OPENAI_ENDPOINT", AZURE_OPENAI_ENDPOINT)
```

`RAG_AZURE_OPENAI_*` were never set on prod — they **silently fell back** to the legacy pair that item
1b empties, leaving `azure_endpoint=""`. Both containers share one `.env.prod`, so one value cannot
serve both. **Timing trap:** it surfaces at the `rag_api` restart, which `--force-recreate api`
triggers as a dependency — i.e. *after* the api is declared healthy.

**Fix applied:** appended `RAG_AZURE_OPENAI_ENDPOINT` + `RAG_AZURE_OPENAI_API_KEY` (copied server-side
out of `/root/.env.prod.pre-1b`, no secret echoed), re-chown'd `1000:1000 600`, recreated `rag_api`.
LibreChat never reads `RAG_*`, so item 1b still holds. **Verified live 16:19:** embeddings
`POST …switzerland-north…/text-embedding-3-small/embeddings → 200 OK`, `rag_api:8000/embed → 200`,
`rag_api:8000/query → 200` (upload *and* Q&A), while `switzerland` matches in the LibreChat log stay
**0** (chat still Sweden Central). Both docs corrected: checklist item 1b + runbook step 5/5b.

⚠️ **Follow-up owed: rotate `AZURE_OPENAI_API_KEY_SWEDEN`** — it was printed in plaintext into an agent
session transcript on 2026-07-27 by a redaction pattern that only matched names *ending* in `KEY`.

### Verified on prod post-cutover (evidence, not assumption)

- `packages/api/dist/index.cjs` exists (stale v0.8.5 `index.js` deleted by the rsync); Finding #6
  marker `Skipping background reconnect for OBO server` = **1**; `isOboTokenNearExpiry` = **2**.
- `librechat.yaml`: `capabilities` includes `"tools"`, `memory.agent.enabled: true`,
  `modelSpecs.enforce: false`. `mcp-m365` env has `MS365_MCP_ORG_MODE=true` + the read-only scope set.
- `.env.prod` item 1b applied: `AZURE_OPENAI_ENDPOINT=` and `AZURE_OPENAI_API_KEY=` now empty,
  `AZURE_OPENAI_API_KEY_SWEDEN` untouched, file re-chown'd **`1000:1000` mode 600**.
- Boot log clean: no `MODULE_NOT_FOUND`, **no `switzerland` match**, **no `AADSTS`**.
  `[MCP][Microsoft365] Server Instructions: configured (2484 chars)` (v8 — the checklist's "1051 chars"
  line predates the OneDrive steering revision). `[MCP] … 0 tools` at startup is expected: M365 tools
  attach per-user via OBO after login.
- `guide-media` refreshed 64 MB → 92 MB; `/guide` and the July-2026 MP4 both 200.

### Two benign warnings (investigated, no action needed)

- `ADMIN_PANEL_SESSION_SECRET is not set` — referenced only by the base `docker-compose.yml` for an
  admin-panel service that is **not deployed** on prod (no such container). Compose interpolates vars
  for services it never starts.
- `METRICS_SECRET is not set - /metrics will return 401` — nothing scrapes LibreChat's own `/metrics`.
  The Prometheus `librechat` job targets the separate `librechat-exporter:8000`; all targets `up`.

### Rollback assets (all present)

`registry.librechat.ai/danny-avila/librechat:v0.8.5` image (3.48 GB, **do not `docker image prune`**),
`~/dist-v085-2026-07-27.tgz` (15 MB), `~/.env.prod.bak-2026-07-27` + `/root/.env.prod.pre-1b`,
Mongo dump `backups/mongodb/librechat_20260727_152436.archive.gz` (1.4 MB, pre-incident).
Rollback target commit **`be8c73562`**. Procedure: §7 of the deploy checklist.
- **Carried forward (still open, NOT upgrade-blocking):** the chat-test box has a manually-edited
  **dirty `librechat.yaml`** — the `memory.agent.enabled: true` fix was applied by hand there on
  2026-07-23 (backup `librechat.yaml.bak-mem019`). Reconcile at formal deploy:
  `git checkout librechat.yaml && git pull`. Prod is unaffected (it gets the flag via the repo yaml).

---

## History (rotated 2026-07-27 17:07)

This file is deliberately scoped to the **v0.8.7 + M365 upgrade/cutover**. Completed work was moved
out verbatim — nothing was summarized or discarded:

- **`progress-archived-2026-07-27_17-07-24.md`** — SDD-FLOW 019 (memory-write-fix, closed `DONE (2026-07-23)`); the prior
  feature-015 ad-hoc recording head; and the full "What's New (July 2026)" tutorial pipeline
  (recording → narration → MP4 → transcript → written guide → `/guide` selector), all shipped in
  commits `0dbafdf7b`…`8bad53a03`.
- Earlier rotations: `progress-archived-2026-07-22_10-19-36.md`,
  `progress-archived-2026-07-07_15-57-33.md`, `progress-archived-2026-06-16_18-10-43.md`.
- Session compactions live in `SDD/orchestration/compacted/` — latest
  `compact-2026-07-27_17-02-51.md` (full cutover state + runbook).
