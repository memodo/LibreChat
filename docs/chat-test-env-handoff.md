# Handoff — `chat-test.memodo.de` test environment for the v0.8.7-rc1 upgrade

**Status as of 2026-06-24:** Repo work is **done and pushed** (both repos). Next is a server-side
deploy on the prod clone, which is **BLOCKED on a DNS record a server admin must create** (see
Blocker). Paused here intentionally to work on other things; this doc is the cold-resume point.

---

## Goal

Stand up a prod-like test instance of LibreChat running the upgrade branch
(`feature-upgrade-15-06-26` — the v0.8.6 + latest-upstream merge, branch version `v0.8.7-rc1`) at
**https://chat-test.memodo.de**, on the existing Hetzner clone of prod, to validate the upgrade
before it goes to real prod.

## Key constraints / decisions

- The upgrade moved `@librechat/api` to the **tsdown** toolchain → ships `dist/index.cjs` (not
  `index.js`) and needs **Node ≥ 22.18** to build. The pinned `v0.8.6` release image + dist-overlay
  deploy model **crash-loops** on this branch, so the api must be **built from source**. (Validated
  locally — the from-source image boots clean and serves the app.)
- **Explicit, version-controlled** test files (not ad-hoc server edits).
- **Hybrid isolation:** keep Azure OpenAI / Entra reachable; isolate the stateful + noisy bits
  (Teams alerting OFF, the clone's own DBs/MinIO).
- **Local email/password login** (no Entra SSO) at the test domain.
- **Stop-and-replace, reuse data:** stop the clone's auto-booted prod-copy stack + monitoring, deploy
  the upgrade in its place, reusing the clone's Mongo / pgvector / MinIO snapshot data.

## Environment

- Test/clone server: **178.105.91.145** (`snapshot-400356890-…`, CPX42 / 16 GB; a snapshot of prod
  `ubuntu-4gb-p-ai-chat` @ 91.98.236.105).
- Domain: **chat-test.memodo.de**.

---

## ⛔ Blocker (why this is paused)

A **DNS A record `chat-test.memodo.de → 178.105.91.145`** must be created by a server admin
(DNS access is not available to the current operator). Caddy issues the Let's Encrypt cert via
HTTP-01, which needs this record to resolve to the clone + ports 80/443 reachable. Until then the
public HTTPS URL won't work. (The app stack itself can be deployed/tested by IP before DNS — only
public TLS access is gated on this.)

**Action:** hand this record to whoever manages `memodo.de` DNS.

---

## What's DONE (committed + pushed)

### LibreChat — branch `feature-upgrade-15-06-26` (origin `github.com/memodo/LibreChat`)
Branch tip on origin: `ef7295b8b`. Test-env scaffolding = commit **`37242eacd`**.
- `docker-compose.prod.yml` — api **builds from source** (Node 24 `Dockerfile`, `image: librechat:upgrade`).
  *Revert to a pinned release image + drop `build` once upstream ships one on the new toolchain.*
- `docker-compose.override.yml` — local build tag aligned to `librechat:upgrade`.
- `docker-compose.test.yml` *(new)* — adds `env_file: [.env.test]` to the api service.
- `.env.test` *(new, NO secrets, un-ignored in `.gitignore`)* — chat-test domain,
  `ALLOW_EMAIL_LOGIN=true`, `OPENID_CLIENT_ID=` (SSO off), relaxed rate limits. Secrets/DB creds
  inherit from the clone's `.env.prod` (the app's `dotenv` is non-override, so the `env_file` wins).
- `test.sh` *(new)* — launcher = `prod.sh`'s files + `docker-compose.test.yml`, `--env-file .env.prod`.

### platform/edge — branch `main` (origin `gitlab.dev.memodo.de/memodoai/platform`)
Tip on origin: **`3fea4fd`**.
- `edge/sites/chat-test.caddy` *(new)* — `chat-test.memodo.de → LibreChat:3080`, local login (no
  `/sso-bridge`, no auth gate).
- `edge/sites/none.caddy` *(new)* — comment-only no-op default.
- `edge/Caddyfile` — `import {$EDGE_EXTRA_SITES:/etc/caddy/sites/none.caddy}` (per-host gate; unset on
  prod = no-op).
- `edge/docker-compose.yml` — mounts `./sites:/etc/caddy/sites:ro`.
- `edge/caddy.env.example` + `README.md` — documented `EDGE_EXTRA_SITES`; README "Per-host extra sites".

### Validation already run
- LibreChat: build 5/5; PII 86/86; MCPManager 30/30; client hooks 57/57; local stack boots clean on
  the from-source image; web/file search pinned.
- Edge: `caddy adapt` clean both ways (unset → no chat-test, no warning; `EDGE_EXTRA_SITES` set →
  chat-test served).

---

## NEXT STEPS (resume here)

### Step 0 — UNBLOCK: DNS (server admin)
Create A record **`chat-test.memodo.de → 178.105.91.145`**.

### Step 1 — Deploy the upgrade app stack on the clone (`178.105.91.145`)
```sh
# stop the cloned prod stacks (monitoring FIRST → no phantom Teams alerts to the shared channel)
./prod-mon.sh down
./prod.sh down
# get the upgrade branch (already on origin)
git fetch origin && git checkout feature-upgrade-15-06-26
# build the from-source image (Node 24 Dockerfile; a few minutes) and start
./test.sh build api
./test.sh up -d
# create a local-password test user (clone users are SSO-only, no local password)
docker exec LibreChat npm run create-user <email> <name> <password>
```

### Step 2 — Enable the edge test site on the clone (platform/edge)
```sh
# in the platform repo checkout on the clone:
git pull                     # gets edge commit 3fea4fd
# enable the gated site by adding this line to the edge's caddy.env (gitignored/SOPS):
#   EDGE_EXTRA_SITES=/etc/caddy/sites/chat-test.caddy
docker compose up -d         # recreate caddy with the ./sites mount + the new env
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
*(Caddy can only issue the cert once Step 0's DNS resolves.)*

### Step 3 — Verify
- `./test.sh ps` → api healthy; `./test.sh logs api | grep -iE 'readiness|listening'` → clean boot
  on `index.cjs` (no crash-loop).
- `https://chat-test.memodo.de` → **local login form** (no SSO auto-redirect).
- Log in as the test user; send a message; confirm **web/file search pinned by default**.
- Confirm **no Teams alert** fired (monitoring stack is down).

---

## Gotchas / notes

- **Do NOT regenerate `package-lock.json`** — it pulls `react-window` 2.x and breaks `react-vtree`
  (`FixedSizeList`/`VariableSizeList` named exports). The committed lock pins `1.8.11`.
- **Build needs Node 22.18+** — fine inside the Dockerfile (uses node:24); only relevant if building
  dist on the host directly.
- **MCPManager.ts** kept the memodo SPEC-014 implementation; upstream's competing OBO refactor was
  deferred to RESEARCH-015 (MCP is disabled in the UI anyway).
- The edge env file is **`caddy.env`** (not `.env`).
- The edge `Caddyfile` is shared across hosts; `EDGE_EXTRA_SITES` is the **per-host** gate — set it
  ONLY on the clone's `caddy.env`. Prod leaves it unset (imports `none.caddy`, a no-op).
- Pre-existing edge lint warnings (`basicauth` deprecated, redundant `header_up X-Forwarded-For`)
  were intentionally left untouched (separate cleanup if ever wanted).

## References

- Plan file: `~/.claude/plans/crispy-mixing-lagoon.md`
- Memory: `project_test_env_chat_test`, `project_v086_upgrade`, `reference_infra_repo`,
  `project_test_env_clone_alerts`
- Commits: LibreChat `37242eacd` (test-env scaffolding) on `feature-upgrade-15-06-26`;
  platform/edge `3fea4fd` (env-gated chat-test site) on `main`.
