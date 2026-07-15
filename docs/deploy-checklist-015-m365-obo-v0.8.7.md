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

- [ ] Inspect prod's current scope: `grep '^OPENID_SCOPE=' /opt/docker/librechat/.env.prod`
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
- [ ] RAG is safe — **confirmed** RAG reads its own `RAG_OPENAI_API_KEY` + `RAG_OPENAI_BASEURL`
  (`EMBEDDINGS_PROVIDER=azure`, `text-embedding-3-small`) and does NOT read the generic `AZURE_OPENAI_*`
  vars, so emptying them in the shared `.env.prod` does not affect embeddings/RAG.
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

- [ ] Add/align both in `.env.prod` (was: `FOR_USERINFO_REQUIRED` empty, scope `user.read`).
- [ ] Re-chown `1000:1000` after editing.

> Lower urgency than items 1/1b — M365 worked on the test box even with `FOR_USERINFO_REQUIRED` empty — but
> per the M365 OBO history it prevents userinfo `401`s in some flows, and it's a divergence from the
> known-good local config, so align it for parity.

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

## 4. ⚠️ OPEN — the v0.8.7 image / dist (the heavy part)

Prod runs a **pre-built base image + bind-mounted `dist/` overlays** built locally and rsync'd via
`prod-sync.sh`. The v0.8.7 upgrade changes the build output (api bundles `index.cjs`) and dependency tree,
so **the base image and the bind-mounted dist must both move to v0.8.7 together** — a stale-dist or
stale-image mismatch will silently run wrong/broken code.

- [ ] **DECIDE the prod image strategy** (this is the open question):
  - (a) point `docker-compose.yml` at the upstream **v0.8.7** registry image + rsync v0.8.7 dist, or
  - (b) build from source on prod (as we did on the test env: `Dockerfile` build, then extract the
    freshly-built `dist/` into the host bind-mount dirs — see `test.sh` / the test-env procedure).
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

## 5. Deploy sequence (suggested order)

- [ ] Maintenance window announced; DB + volume backup taken.
- [ ] `git pull` on prod (yaml, compose, SDD/docs artifacts).
- [ ] Item 4: image/dist to v0.8.7 (the big one).
- [ ] Item 1: `.env.prod` `OPENID_SCOPE` fix (+ re-chown).
- [ ] Item 3: recreate `mcp-m365`.
- [ ] Recreate/restart api so it picks up new image + `.env.prod` + `librechat.yaml`.
- [ ] Item 6: verify.

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

## 7. Rollback

- [ ] Revert `docker-compose.yml` image tag to v0.8.5 + restore the previous v0.8.5 dist (keep the prior
  dist tree or image tagged before overwriting).
- [ ] `git checkout` the prior prod commit; `./prod.sh up -d` / `restart api`.
- [ ] Restore `.env.prod` from backup (re-chown `1000:1000`).
- [ ] Restore MongoDB/volumes from the pre-deploy backup only if data migrated.

---

## What the test env already proved (2026-07-08)

- v0.8.7 built from source + ran healthy; M365 Phase 1 SharePoint read verified end-to-end **locally**
  (93 tools / 212 skipped, real Graph data).
- The `OPENID_SCOPE` gap (item 1) was **discovered on the test env**: with the scope missing, OBO failed
  with `AADSTS240002/50013`; adding `api://…/access_as_user` (mirroring local `.env`) is the fix.
- See also: `docs/m365-sharepoint-readonly-runbook.md`, `docs/m365-people-search-runbook.md`,
  `docs/m365-softeria-fetchallpages-toon-bug.md`, `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.
