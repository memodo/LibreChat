# Production Deploy Checklist — `feature/015-m365-obo-v0.8.7`

**Scope:** deploying the `feature/015-m365-obo-v0.8.7` branch to **production** (`chat.memodo.de`,
`/opt/docker/librechat`). This branch bundles three things, so the deploy touches several surfaces:

1. **The v0.8.5 → v0.8.7-rc1 upgrade** (~651 commits; toolchain change — tsdown/rolldown, the api now
   bundles `index.cjs`). This is the heaviest, riskiest part: **the base image contract changes**, so it
   is *not* a plain `prod-sync.sh` dist rsync.
2. **M365 read-only SharePoint (Phase 1)** — org-mode + allowed-scopes on the `mcp-m365` sidecar.
3. **Native OBO fixes** — token refresh (C.6), People-Search C.5 code, and the **`OPENID_SCOPE` fix**
   that OBO fundamentally depends on (see item 1 below).

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
login *requests* the custom API scope. This scope has been living **only in the local dev `.env`** and was
**never propagated to `.env.prod`** — so it is almost certainly missing on real prod too, meaning M365 /
People Search do not currently work in production (consistent with People Search having silently fallen
back to local users).

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
- [ ] Build dist for v0.8.7 with Node ≥22.18 (`nvm use 22.18.0`) — `npm run build`.
- [ ] Ship dist to prod (`prod-sync.sh` for path (a); image-extract for path (b)).
- [ ] Verify the bind-mounted host dist is fresh: `packages/api/dist/index.cjs` exists and contains a
  distinctive v0.8.7/branch symbol (e.g. `isOboTokenNearExpiry`), and `client/dist` is current.
- [ ] Do **not** regenerate `package-lock.json` (`react-window` must stay `1.8.11` per the upgrade notes).

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
