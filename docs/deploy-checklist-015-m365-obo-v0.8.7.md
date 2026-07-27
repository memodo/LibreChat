# Production Deploy Checklist — `feature/015-m365-obo-v0.8.7`

**Scope:** deploying the `feature/015-m365-obo-v0.8.7` branch to **production** (`chat.memodo.de`,
`/opt/docker/librechat`). This branch bundles three things, so the deploy touches several surfaces:

1. **The v0.8.5 → v0.8.7-rc1 upgrade** (~651 commits; toolchain change — tsdown/rolldown, the api now
   bundles `index.cjs`). This is the heaviest, riskiest part: **the base image contract changes**, so it
   is *not* a plain `prod-sync.sh` dist rsync.
2. **M365 read-only SharePoint (Phase 1)** — org-mode + allowed-scopes on the `mcp-m365` sidecar.
3. **Native OBO fixes** — token refresh (C.6), People-Search C.5 code, and the **`OPENID_SCOPE` fix**
   that OBO fundamentally depends on (see item 1 below).
4. **Admin reporting dashboard** — a small, late addition (`fe70ad7d0`): the **"Active Users"**
   per-period column on `/d/reporting`. Code-only, no config; it rides the Item 4 build + `prod-sync`
   with nothing bespoke (details in §4b).

> **Living document.** Started 2026-07-08 while verifying on the test env (`chat-test.memodo.de`).
> Items marked **⚠️ OPEN** still need to be nailed down. Check items off as completed.

> **Prod runs v0.8.5 today.** Advancing prod to v0.8.7 is a real version jump — do it in a maintenance
> window, take backups first, and have the rollback (bottom of this doc) ready.

---

## 1. ⭐ CRITICAL — `.env.prod` `OPENID_SCOPE` (the OBO blocker)

**Without this, M365 and People Search will fail on prod exactly as they did on the test env** — the OBO
exchange gets rejected by Entra with `AADSTS240002` (*"Input id_token cannot be used as jwt-bearer
grant"*) for M365, and `AADSTS50013` (*"Assertion failed signature validation"*) for the login-time Entra
group sync / People Search.

**Root cause:** OBO ("on behalf of") requires the assertion to be an **access token whose audience is the
app's own API** (`api://chat.memodo.de/323c5939-…/access_as_user`). You only get that token if the SSO
login *requests* the custom API scope.

**⚠️ VERIFY, don't assume — there is a known discrepancy.** The `project_m365_mcp_integration` memory
(2026-07-06) says this scope was applied to prod, but the **test-env clone's `.env.prod` (a snapshot of
prod) lacked it entirely** — which is why OBO failed on test until we added it. So either the clone
predates the 2026-07-06 edit (real prod is fine) **or** the scope only ever landed in the local `.env` /
a "worktree `.env.prod`" and the running prod server never got it (prod is broken). **Check the actual
prod server's `OPENID_SCOPE` first** and only edit if the `api://…/access_as_user` suffix is missing. The
Entra-side config (App ID URI + `access_as_user` exposed + admin-consented) IS tenant-wide and confirmed
working (adding the scope on test worked with no new consent), so this is purely an `.env.prod` question.

> ## ✅ RESOLVED 2026-07-27 — no action needed. Verified directly on the prod box: `OPENID_SCOPE`
> **already contains** the `api://…/access_as_user` app scope. The clone/prod discrepancy this item
> warned about was a stale *clone*, not a broken prod. **Do not edit `.env.prod` for this item** — every
> avoided edit is an avoided chown trap. The steps below are retained for reference / future rebuilds.

- [x] Inspect prod's current scope: `grep '^OPENID_SCOPE=' /opt/docker/librechat/.env.prod`
- [ ] If it lacks the `api://…/access_as_user` suffix, set it to exactly:
  ```
  OPENID_SCOPE=openid profile email offline_access api://chat.memodo.de/323c5939-9fcf-4868-87e0-290a000be67c/access_as_user
  ```
- [ ] **Re-chown after editing** (the `.env.prod` chown trap): editing as root strips `1000:1000`
  ownership → the UID-1000 container can't read it on recreate → crashes "env var not found".
  ```bash
  chown 1000:1000 /opt/docker/librechat/.env.prod
  ```
- [ ] Confirm the other OBO-critical vars are present on prod: `OPENID_REUSE_TOKENS=true`,
  `USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true`, `OPENID_CLIENT_ID=323c5939-…`, matching `OPENID_CLIENT_SECRET`.
- [ ] **Entra redirect URI:** no change needed for prod — the prod Entra app already trusts
  `https://chat.memodo.de/oauth/openid/callback`. (This differs from the test env, where we had to add
  the chat-test callback.)

> Deploy mechanism for `.env.prod`: edit in place (or scp) → re-chown `1000:1000` → recreate the api so it
> re-reads the file. A **fresh Entra login is required** afterward for any session to pick up the new
> scope in its token.

---

## 1b. ⭐ CRITICAL — neutralize legacy `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` (v0.8.7 regression)

**A confirmed v0.8.7 upgrade regression caught on the test env 2026-07-09. Without this fix, EVERY
tool-bearing agent (M365, file_search/RAG — i.e. almost all real agents) will 401 on prod after the
upgrade; tool-less agents keep working, which makes it easy to miss.**

**Root cause:** `.env.prod` carries the legacy single-instance vars
`AZURE_OPENAI_ENDPOINT=https://memodo-openai-switzerland-north.openai.azure.com/` and
`AZURE_OPENAI_API_KEY=<switzerland key>` (they belong to the RAG/embeddings resource; RAG itself uses the
separate `RAG_*` vars). The `librechat.yaml` `azureOpenAI` groups config (Sweden, `instanceName:
memodo-openai-sweden`) is supposed to be the source of truth, but under **v0.8.7** the updated OpenAI SDK
**auto-reads `AZURE_OPENAI_ENDPOINT` from the environment in the agent/tool completion path** and
overrides the yaml `instanceName`. Result: tool-bearing agent completions are sent to
`memodo-openai-switzerland-north…//openai/deployments/gpt-5/chat/completions` (note the double slash from
the trailing `/`) with the wrong key → **`401` MODEL_AUTHENTICATION** ("invalid subscription key or wrong
API endpoint"). Plain-chat / tool-less completions use the yaml path and are unaffected. On v0.8.5 (prod
today) this leak does not occur, which is why it only surfaces on the upgrade.

- [ ] Neutralize the two legacy vars for the **LibreChat container** (do NOT disturb RAG's `RAG_*` vars).
  On test this was an `.env.test` override; on prod, either remove/empty them in `.env.prod` **or** set
  them empty for the api service:
  ```
  AZURE_OPENAI_ENDPOINT=
  AZURE_OPENAI_API_KEY=
  ```
- [ ] If editing `.env.prod`, **re-chown `1000:1000`** (same trap as item 1).
- [ ] ⛔ **RAG IS *NOT* SAFE — this step BREAKS file uploads unless you also do the next one.**
  The previous claim here ("RAG reads its own `RAG_OPENAI_API_KEY` + `RAG_OPENAI_BASEURL` and does not
  read the generic `AZURE_OPENAI_*` vars") was **wrong, and it bit us live on 2026-07-27.**
  `RAG_OPENAI_API_KEY`/`RAG_OPENAI_BASEURL` are only read on the **`openai`** provider path. Prod runs
  `EMBEDDINGS_PROVIDER=azure`, which takes a different branch in `rag_api`'s `app/config.py`:
  ```python
  AZURE_OPENAI_ENDPOINT     = get_env_variable("AZURE_OPENAI_ENDPOINT", "")
  RAG_AZURE_OPENAI_ENDPOINT = get_env_variable("RAG_AZURE_OPENAI_ENDPOINT", AZURE_OPENAI_ENDPOINT)
  # AzureOpenAIEmbeddings(api_key=RAG_AZURE_OPENAI_API_KEY, azure_endpoint=RAG_AZURE_OPENAI_ENDPOINT, …)
  ```
  `RAG_AZURE_OPENAI_ENDPOINT`/`_API_KEY` were **never set on prod** — they silently **fell back** to the
  legacy pair. Emptying the legacy pair removes the fallback, leaving `azure_endpoint=""`, and every
  upload fails with `openai.APIConnectionError: Connection error` →
  `[/files] Error processing file: File embedding failed.` Note it is a *connection* error, not a 401,
  because the endpoint is empty rather than misauthenticated.
  It surfaces on the **`rag_api` restart**, not at the moment of the edit — and `rag_api` restarts as a
  dependency of `./prod.sh up -d --force-recreate api`, so the failure lands mid-cutover.
- [ ] **Set the RAG-namespaced vars so each container gets what it needs.** LibreChat never reads
  `RAG_*`, so this preserves item 1b while restoring embeddings. No compose change required. Copy the
  originals out of the pre-edit backup server-side so neither secret is ever echoed:
  ```bash
  cd /opt/docker/librechat && \
    sed -n 's/^AZURE_OPENAI_ENDPOINT=/RAG_AZURE_OPENAI_ENDPOINT=/p;s/^AZURE_OPENAI_API_KEY=/RAG_AZURE_OPENAI_API_KEY=/p' \
      /root/.env.prod.pre-1b >> .env.prod && \
    chown 1000:1000 .env.prod && chmod 600 .env.prod
  ./prod.sh up -d --force-recreate rag_api
  ```
  The `^AZURE_OPENAI_API_KEY=` anchor cannot match `AZURE_OPENAI_API_KEY_SWEDEN=` (next char is `_`),
  which `librechat.yaml` still needs for the Sweden Central group.
  `RAG_AZURE_OPENAI_API_VERSION` needs nothing — it is unset and langchain falls back to
  `OPENAI_API_VERSION=2024-02-01`, which is how it already worked.
- [ ] Verify: `docker inspect rag_api` shows `RAG_AZURE_OPENAI_ENDPOINT=https://memodo-openai-switzerland-north.openai.azure.com/`
  **and** `AZURE_OPENAI_ENDPOINT=` still empty, then upload a file end-to-end.
- [ ] Verify post-deploy (item 6): a tool-bearing agent completion routes to `memodo-openai-sweden` (not
  switzerland) with HTTP 200.

> How it was verified on test: OpenAI request logging (`OPENAI_LOG=debug`) showed tool-agent completions
> hitting the switzerland URL and 401ing while tool-less ones hit sweden and 200'd; emptying the two vars
> flipped tool agents back to sweden. Remove `OPENAI_LOG=debug` after diagnosis.
>
> **Alignment note (2026-07-09):** this was aligned across local + test — the test box neutralizes via
> `.env.test`; local `.env` was also neutralized (it carried the same Switzerland value, which is why the
> "local works / test 401s" split looked odd — the trigger is intermittent, but the correct state is the
> same everywhere: legacy var empty, yaml Sweden group authoritative).

---

## 1c. CRITICAL — `.env.prod` OBO userinfo flow (align to the known-good local values)

The env comparison (local `.env` vs the box's `.env.prod`) found the box was missing the OBO-userinfo
settings your working local config has. Set them on prod `.env.prod` (test box now has them via `.env.test`):

```
OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true
OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=User.Read
```

> ## ✅ RESOLVED 2026-07-27 — no action needed. Verified on the prod box:
> `OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true`, `OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=User.Read`,
> and the two related OBO vars (`OPENID_REUSE_TOKENS=true`, `USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true`) are
> all already aligned with the known-good local config. **Do not edit `.env.prod` for this item.**

- [x] Add/align both in `.env.prod` (was: `FOR_USERINFO_REQUIRED` empty, scope `user.read`).
- [x] Re-chown `1000:1000` after editing.

> Lower urgency than items 1/1b — M365 worked on the test box even with `FOR_USERINFO_REQUIRED` empty — but
> per the M365 OBO history it prevents userinfo `401`s in some flows, and it's a divergence from the
> known-good local config, so align it for parity.

---

## 1d. ⭐ CRITICAL — `librechat.yaml` `memory.agent.enabled: true` (v0.8.7 opt-in gate, silent write failure)

**A confirmed v0.8.7 upgrade regression, root-caused and fixed 2026-07-23 (SPEC-019 / RESEARCH-019).
Without this, automatic memory WRITES silently stop working on prod — READ (recalling existing
memories) keeps working, which makes the break easy to miss.**

**Root cause:** v0.8.7 made the post-turn memory-extraction agent opt-in.
`isMemoryAgentEnabled()` (`packages/data-schemas/src/app/memory.ts:37-40`) now requires
`config.agent.enabled === true` in addition to a valid provider+model. Prod's `librechat.yaml`
`memory.agent` block has a valid `provider`/`model` pair but (as of today) no `enabled` key — the same
gap chat-test hit after its 2026-07-09 v0.8.7 deploy. When the gate is `false`, `useMemory()` still runs
the READ path (existing memories keep recalling) but never installs the extraction processor, so every
"remember X" turn silently no-ops: the assistant replies "Saved…" but no `memoryentries` row is ever
written, and no error/warning is logged per-turn (only a one-time startup warn naming the missing key).

- [ ] Add `enabled: true` under `memory.agent` in prod's `librechat.yaml` (already present in this repo's
  `librechat.yaml` ~L266-271 — travels via the normal `git pull` yaml deploy path, no separate edit needed
  if prod pulls this branch's `librechat.yaml` verbatim; if prod's yaml was hand-maintained separately,
  verify the key made it across).
- [ ] Confirm after restart: the api log does **not** show `"[memory] Agent config detected without
  explicit \`enabled: true\`. Automatic memory extraction is now opt-in."` — its absence confirms the gate
  is closed correctly.
- [ ] Verify post-deploy (item 6): a real "remember X" chat turn actually persists — check
  `db.memoryentries` for a new row for the test user immediately after the repro, not just the assistant's
  narration (narration is unreliable evidence per RESEARCH-019 — this is exactly how the 2026-07-15
  chat-test smoke test produced a false positive).

> Deploy mechanism: config-only, same as Item 2 — `git pull` + `./prod.sh restart api`. No `npm run build`,
> no `prod-sync.sh`, no dist rsync; no code changed. See `SDD/requirements/SPEC-019-memory-write-fix.md`
> and `SDD/research/RESEARCH-019-memory-write-fix.md` ("Root Cause — CONFIRMED" / "Live Confirmation") for
> the full trace and the before/after DB evidence (chat-test: 14→16 `memoryentries` rows) that verified
> this fix.

---

## 2. `librechat.yaml` — agent capability + serverInstructions (yaml deploy path)

Changes on this branch: the `endpoints.agents.capabilities` **`"tools"`** entry (the root-cause fix that
lets MCP tools attach at all), the `Microsoft365` `serverInstructions` **v4** (SharePoint read live +
query steering), and the `Microsoft365.obo.scopes` block.

- [ ] Deploy via the yaml path: `git push` (done from local) → on prod `git pull` → `./prod.sh restart api`.
- [ ] Confirm after restart: `[MCP][Microsoft365] Server Instructions: configured (1051 chars)` in the api log.
- [ ] Sanity: `endpoints.agents.capabilities` still contains `"tools"` (without it, 0 MCP tools attach).

---

## 3. `docker-compose.prod.yml` — `mcp-m365` Phase 1 env (git path + recreate sidecar)

The `MS365_MCP_ORG_MODE: "true"` + `MS365_MCP_ALLOWED_SCOPES` block is committed, so it travels via git.

- [ ] On prod after `git pull`, recreate only the sidecar: `./prod.sh up -d mcp-m365` (no image rebuild — runtime env).
- [ ] Confirm the sidecar startup log shows `Organization mode enabled` + the read-only scope set.
- [ ] Keep `MS365_MCP_ALLOWED_SCOPES` in lockstep with `librechat.yaml` `Microsoft365.obo.scopes`.

---

## 4. ✅ DECIDED (2026-07-27) — build the image from source on prod + rsync dist

Prod runs a **pre-built base image + bind-mounted `dist/` overlays** built locally and rsync'd via
`prod-sync.sh`. The v0.8.7 upgrade changes the build output (api bundles `index.cjs`) and dependency tree,
so **the base image and the bind-mounted dist must both move to v0.8.7 together** — a stale-dist or
stale-image mismatch will silently run wrong/broken code.

**Decision: option (b), build from source on prod.** `docker-compose.prod.yml` keeps its
`build:` + `image: librechat:upgrade` block unchanged. Option (a) (pin the upstream registry image)
was evaluated in depth on 2026-07-27 and **rejected on evidence**:

- **No upstream image matches this tree.** The branch merged upstream `main` at `8fcb77fe6`
  (2026-07-05), i.e. **v0.8.7 GA + ~96 post-GA commits**. The registry's `v0.8.7` tag is the GA build
  (2026-06-24) and therefore *older than our code*. Checked exhaustively: every `v0.8.x` tag on
  `danny-avila/librechat`, plus all 101 SHA tags on `danny-avila/librechat-dev` — no tag matches
  `8fcb77fe6` or any of the 30 upstream commits preceding it.
- **The GA image crash-loops with our dist.** Booting it with our dist bind-mounted gives
  `MODULE_NOT_FOUND: @langchain/langgraph-checkpoint-mongodb`. That require sits in the *eager
  top-level* preamble of `packages/api/dist/index.cjs` (line ~117, beside `url`/`dedent`), so it fails
  at module load, not lazily. The module arrived with upstream's post-GA HITL checkpointer
  (`6dbf9d5ad`/`ed8547018`/`84fa6aa82` → `packages/api/src/agents/checkpointer.ts`), which GA predates.
- **Silent API skew behind it.** The GA image ships `@librechat/agents` **3.2.46**; this branch declares
  **^3.2.57** — 11 releases of skew on the engine every MCP/M365/tool call runs through. Module
  resolution would pass while runtime behaviour diverged.
- Overlaying both gaps as extra bind mounts (~40 MB) *does* resolve (verified), but it puts prod on a
  base image nothing was ever tested against and creates a hand-maintained `node_modules` patch to
  re-check at every upgrade — the exact silent-divergence pattern this project has repeatedly paid for.
- **The OOM concern against (b) was based on a wrong figure.** Prod is still *named*
  `ubuntu-4gb-p-ai-chat` but has been resized: `free -g` reports **15 GB total / 8 GB available**, with
  21 GB free disk. Building here is comparable to the 16 GB test box that already proved this path.

> ⚠️ **The dist rsync is NOT optional under option (b).** Prod's existing overlay dirs are v0.8.5-era
> (`packages/api/dist/index.js`, dated 2026-05-19 — no `index.cjs`, Finding #6 symbol count 0). They are
> bind-mounted *over* the freshly built image, so building alone leaves the container loading a stale
> `index.js` → `MODULE_NOT_FOUND` → crash-loop. Build **and** rsync, in that order, before recreating.
- [ ] Build dist for v0.8.7 with Node ≥22.18 (`nvm use 22.18.0`) — `npm run build` (5 workspaces, ~15s).
  - **⚠️ Build-blocker prerequisite (`unrun`):** `tsdown`'s config loader `unrun` is an *optional peer
    dependency absent from `package-lock.json`*, so a fresh checkout's `npm run build` dies with
    `Failed to import module "unrun". Please ensure it is installed.` Install it out-of-band **before**
    building, then restore the lock:
    ```bash
    npm install --no-save 'unrun@^0.3.0'      # NOT --no-package-lock (that forces a full re-resolve / hangs)
    git checkout -- package-lock.json          # macOS npm strips libc fields — cosmetic churn, do not commit
    ```
    (See the `reference_v087_local_build_toolchain` memory. Also confirm `node -v` ≥ 22.18 — the shell
    default is often v20, which the toolchain rejects.)
- [ ] Ship dist to prod (`prod-sync.sh` for path (a); image-extract for path (b)).
- [ ] Verify the bind-mounted host dist is fresh: `packages/api/dist/index.cjs` exists and contains a
  distinctive v0.8.7/branch symbol (e.g. `isOboTokenNearExpiry`), and `client/dist` is current.
- [ ] **Confirm the Finding #6 OBO re-auth-loop fix (`6631a4f7a`) is in the built dist** — a `packages/api`
  source patch, so it only ships if the dist is rebuilt from branch HEAD (not carried by yaml/git-pull):
  `grep -c 'Skipping background reconnect for OBO server' packages/api/dist/index.cjs` must be `1`.
  Without it, every prod user hits a spurious "Sign-in to mcp-m365" loop (~hourly + after api restart).
- [ ] Do **not** regenerate `package-lock.json` (`react-window` must stay `1.8.11` per the upgrade notes).

---

## 4b. Admin reporting dashboard — "Active Users" per-period column (delivered by Item 4)

Commit `fe70ad7d0` added an **Active Users** column to the Usage Trends table on `/d/reporting` (distinct
users with ≥1 non-credit transaction per period bucket). It touches only surfaces Item 4 already ships, so
**there is no separate deploy action** — it travels with the normal build + `prod-sync`:

- `packages/data-provider/src` → `packages/data-provider/dist` (a type-only field; runtime-inert)
- `client/src` → `client/dist` (the rendered column + CSV export)
- `api/server/routes/admin/usage.js` → bind-mounted **raw source** (the `/trends` two-stage `$group`
  that counts distinct users per period)

- [ ] **Nothing bespoke to deploy.** `npm run build` + `prod-sync.sh` (Item 4) rebuild `client/dist` +
  `data-provider/dist` and rsync `api/server`; this change is included automatically.
- [ ] **No `.env.prod` / `librechat.yaml` / `docker-compose` / DB migration / index changes** — it is a
  read-only aggregation over the existing `transactions` collection. Nothing to configure or migrate.
- [ ] Git stays aligned via the Item 5 `git pull` on prod (unlike the test env, which was deployed
  rsync-only and needed a manual `git reset --hard` to reconcile — prod does not).
- [ ] Verify in Item 6 (column renders + populates).

---

## 5. Deploy sequence — cutover runbook (2026-07-27, 17:00 window)

**Prod state verified 2026-07-27 (pre-window):** branch `memodo` @ `be8c73562`, working tree clean,
api on `registry.librechat.ai/danny-avila/librechat:v0.8.5` (restarts 0, up since 07-04), compose
v5.3.0, 15 GB RAM / 8 GB free, 21 GB free disk, v0.8.5 rollback image still present locally (3.48 GB),
`guide-media/` already present (64 MB, will be refreshed to 91 MB), nightly Mongo backup cron at 02:00.

**Branch flow:** `memodo` is a strict ancestor of `pablo` (0 behind / 692 ahead, merge-base ==
`memodo` tip) → **`pablo` → `memodo` is a clean fast-forward, no conflicts**. Prod tracks `memodo`,
so prod's `git pull` also fast-forwards.

**Pre-window `.env.prod` findings (verified on the box):** item 1 `OPENID_SCOPE` **already correct**
(no edit); item 1c OBO userinfo vars **already aligned** (no edit); item 1d travels via `git pull`.
**Only item 1b needs an edit** — both legacy Azure vars are set and non-empty.

### Step 0 — local (before the window)
- [ ] `git checkout memodo && git merge --ff-only pablo && git push origin memodo` (fast-forward).
- [ ] Confirm local dist is current: `packages/api/dist/index.cjs` contains
      `Skipping background reconnect for OBO server` (must be 1) and `isOboTokenNearExpiry`.
      A rebuild needs `npm install --no-save 'unrun@^0.3.0'` first (see §4 build-blocker) — `unrun`
      is *not* currently installed locally, so plan for it if a rebuild becomes necessary.

### Step 1 — announce + back up
- [ ] Maintenance window announced.
- [ ] Mongo dump: `./scripts/backup-mongodb.sh` (container `chat-mongodb`).
- [ ] **Back up the dist overlays — required for rollback, they get overwritten in step 4:**
      `tar czf ~/dist-v085-$(date +%F).tgz packages/api/dist packages/data-schemas/dist packages/data-provider/dist client/dist`
- [ ] Back up `.env.prod`: `cp .env.prod ~/.env.prod.bak-$(date +%F)`

### Step 2 — pull source (prod)
- [ ] `cd /opt/docker/librechat && git pull` → fast-forwards `memodo` to the merged tip.
      Brings `librechat.yaml` (incl. item 1d `memory.agent.enabled` + item 2 `capabilities`/
      serverInstructions), `docker-compose.prod.yml`, and the docs.

### Step 3 — build the image (service stays up on v0.8.5)
- [ ] `./prod.sh build api` — builds `librechat:upgrade` from source. Non-disruptive: the running
      container is untouched until it is recreated in step 5.
- [ ] Sanity: `docker images librechat:upgrade` shows a just-created image.

### Step 4 — ship the dist (from the local machine)
- [ ] `PROD_HOST=memodo-eng-prod ./prod-sync.sh --no-restart`
      (the script's default host was `Hetzner-personal`, which does not exist in ssh config — fixed to
      `memodo-eng-prod`, but pass it explicitly if running an older copy).
      Pushes `packages/{api,data-schemas,data-provider}/dist`, `client/dist`, `api/server`, `guide-media`.
      `--no-restart` because the recreate happens in step 5 on the new image.
- [ ] Verify on prod: `grep -c 'Skipping background reconnect for OBO server' packages/api/dist/index.cjs`
      → must be **1**, and `packages/api/dist/index.cjs` must now exist (it did not before — v0.8.5
      shipped `index.js`).

### Step 5 — env edit + recreate
- [ ] Back up first: `cp -p .env.prod /root/.env.prod.pre-1b` — step 5b reads the original values back
      out of this file, so it is a prerequisite, not just a safety net.
- [ ] Item 1b: empty both legacy vars in `.env.prod`:
      `AZURE_OPENAI_ENDPOINT=` and `AZURE_OPENAI_API_KEY=`.
      Anchor on the full `VAR=` — a looser pattern also nukes `AZURE_OPENAI_API_KEY_SWEDEN`, which
      `librechat.yaml` needs for the Sweden Central group.
- [ ] **Step 5b — do this in the SAME edit, before recreating anything** (see item 1b for why):
      ```bash
      sed -n 's/^AZURE_OPENAI_ENDPOINT=/RAG_AZURE_OPENAI_ENDPOINT=/p;s/^AZURE_OPENAI_API_KEY=/RAG_AZURE_OPENAI_API_KEY=/p' \
        /root/.env.prod.pre-1b >> .env.prod
      ```
      Without this, emptying the legacy pair strips the fallback that `rag_api`'s azure embeddings path
      depends on and **every file upload fails** (`File embedding failed`). It breaks at the `rag_api`
      restart — which `--force-recreate api` triggers as a dependency — so it lands mid-cutover.
- [ ] **Re-chown immediately:** `chown 1000:1000 /opt/docker/librechat/.env.prod` (uid 1000 =
      `librechat`; the container has `cap_drop: ALL`, so wrong ownership = unreadable = boot crash).
      `sed -i` renames a temp file into place, so it strips ownership every time.
- [ ] `./prod.sh up -d --force-recreate api`
- [ ] Item 3: `./prod.sh up -d mcp-m365`
- [ ] `./prod.sh up -d --force-recreate rag_api` (picks up the step-5b vars).

### Step 6 — verify (§6 below)
- [ ] Work §6 in order. **A fresh Entra login is mandatory** before any M365/OBO check.

---

## 6. Post-deploy verification (evidence, not vibes)

- [ ] **App boots:** api `healthy`, `Server listening on … 3080`, correct v0.8.7 build in Settings → About.
- [ ] **Fresh Entra login** (mandatory — old tokens lack the new scope).
- [ ] **OBO succeeds:** api log shows the OBO exchange resolving *without* `AADSTS240002/50013`; no
  `[OBO] Failed to exchange token`.
- [ ] **M365 tools attach:** `Storing tool context … ~93 tools` and a `list-sharepoint-*` call returns
  real Graph data (read-only surface; write tools trimmed).
- [ ] **People Search:** login group-sync pulls **N groups from Graph** (not "falling back to local").
- [ ] **v0.8.7 regression smoke:** chat + agent selection (watch the `modelSpecs.enforce:true` gotcha),
  RAG file Q&A, web search, conversations.
- [ ] **Admin reporting — Active Users column (§4b):** open `/d/reporting` as an admin; the Usage Trends
  table shows a populated **Active Users** column across the Day/Week/Month toggle. Sanity: the per-period
  values do **not** sum to the "Active Users" overview card — that card de-duplicates distinct users over
  the whole range, while each row de-duplicates within its own period.

---

## 7. Rollback (concrete, for the 2026-07-27 cutover)

Rollback target: branch `memodo` @ **`be8c73562`**, image
**`registry.librechat.ai/danny-avila/librechat:v0.8.5`** (confirmed still present on the box, 3.48 GB —
do **not** `docker image prune` during this deploy), and the **v0.8.5 dist tarball from step 1**.

- [ ] `cd /opt/docker/librechat && git checkout be8c73562` (restores the v0.8.5-era `librechat.yaml`
      *and* `docker-compose.prod.yml`, which pins the v0.8.5 image rather than building from source).
- [ ] **Restore the dist overlays** — without this the v0.8.5 image gets v0.8.7 `index.cjs` mounted over
      it and crash-loops, the same trap in reverse:
      `tar xzf ~/dist-v085-<date>.tgz -C /opt/docker/librechat`
- [ ] Restore `.env.prod` from the step-1 backup, then **re-chown `1000:1000`**.
- [ ] `./prod.sh up -d --force-recreate api mcp-m365`
- [ ] Restore MongoDB from the pre-deploy dump **only** if data actually migrated (no schema migration
      is expected in this cutover — memory/agent data is additive).

> The `api/server` and `guide-media` trees are also overwritten by the step-4 rsync. `api/server` is
> git-tracked, so `git checkout be8c73562` restores it. `guide-media` is **not** in git — the older
> 64 MB copy is only recoverable by re-syncing from a dev machine, but it is presentation-only (the
> `/guide` page) and never blocks a rollback.

---

## What the test env already proved (2026-07-08)

- v0.8.7 built from source + ran healthy; M365 Phase 1 SharePoint read verified end-to-end **locally**
  (93 tools / 212 skipped, real Graph data).
- The `OPENID_SCOPE` gap (item 1) was **discovered on the test env**: with the scope missing, OBO failed
  with `AADSTS240002/50013`; adding `api://…/access_as_user` (mirroring local `.env`) is the fix.
- See also: `docs/m365-sharepoint-readonly-runbook.md`, `docs/m365-people-search-runbook.md`,
  `docs/m365-softeria-fetchallpages-toon-bug.md`, `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.
