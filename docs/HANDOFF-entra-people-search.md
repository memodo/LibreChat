# Handoff — Entra ID People Search (live Graph directory search in the people picker)

**Status:** DEPLOYED to prod but NOT FUNCTIONAL yet — blocked on Entra admin-center consent.
Paste this note back to resume.
**Blocked on:** Pablo granting admin consent in the Entra admin center (see "Remaining work").
**Date:** 2026-06-10. All `.env.prod` changes are live on prod; api container restarted clean.

---

## Goal

Enable the live Entra ID directory search in LibreChat's people picker (Share modal):
typing 3+ letters should surface tenant users/groups who have *never* logged into
LibreChat, not just users already in the local Mongo DB. Mechanism: On-Behalf-Of (OBO)
token exchange with the signed-in user's delegated token → Microsoft Graph
`GET /users`, `GET /groups`, `GET /me/people`.

## What is DONE (deployed 2026-06-10, ~13:28 CEST)

Three changes in `.env.prod` (edited locally, scp'd to
`Hetzner-personal:/opt/docker/librechat/.env.prod`, api restarted via `./prod.sh restart api`):

1. **Line 631:** `OPENID_REUSE_TOKENS=true` — stores users' access/refresh tokens in
   MongoDB, enables the OBO exchange, and turns on login-time Entra group sync
   (`syncUserEntraGroupMemberships`).
2. **Line 693:** `USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true` — enables the live Graph search
   augmentation in the people picker.
3. **Line 707:** added `User.ReadBasic.All` to `OPENID_GRAPH_SCOPES` (after `User.Read`).
   Without it, the tenant-wide `GET /users` call 403s and the error is swallowed
   (`GraphApiService.js:460-462`) → directory users silently absent.

Left as-is (deliberate): `ENTRA_ID_INCLUDE_OWNERS_AS_MEMBERS=false`,
`OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=` (empty).

Deploy hygiene facts:
- Local and prod `.env.prod` were **byte-identical (sha256) before the edit**, so the
  local copy is an exact mirror of what's running.
- Backup of the pre-change file exists on prod:
  `/opt/docker/librechat/.env.prod.bak-20260610` — restore + `./prod.sh restart api`
  is the full rollback.
- `.env.prod` is gitignored (`.env*`); it does NOT travel via git push/pull or
  `prod-sync.sh`. Local edit + scp is the deploy path used here.
- Startup logs after restart were clean (MCP Microsoft365 initialized, no errors).

## Remaining work (resume here)

**1. Entra admin center** — app registration `323c5939-9fcf-4868-87e0-290a000be67c`
(the `OPENID_CLIENT_ID`), API permissions → Microsoft Graph → **Delegated**:

- **Add `User.ReadBasic.All`** ← the one almost certainly missing (we just added it to
  the env scope string; env and consent must agree).
- Verify `GroupMember.Read.All`, `People.Read`, `offline_access` show as consented.
- Click **"Grant admin consent"** after adding.
- Verify an **Application ID URI** exists under "Expose an API" — required for the OBO
  exchange. The M365 MCP setup (SPEC-014) probably already configured it; if absent,
  people search silently degrades to local-DB-only results.
- (Optional upgrade: `User.Read.All` instead of `User.ReadBasic.All` if richer profile
  fields — job title, department, phone — are wanted in the picker.)

**2. Verification (after consent):**

1. Log out of LibreChat, log back in via Microsoft (re-issues token under the new flag,
   triggers first group sync for the account).
2. Share modal → type 3+ letters of a colleague who has never logged into LibreChat.
   Appearing = live `/users` path works. Only-existing-users = consent for
   `User.ReadBasic.All` still missing.
3. On failure, api logs: grep for `[searchUsers]`, `[searchGroups]`,
   `[searchEntraIdPrincipals]` — distinguishes scope/consent errors from
   OBO/app-registration errors.

## Expected behaviors (not bugs)

- **Groups fill in lazily** — an Entra group lands in the local `groups` collection only
  after a member logs in, or via live `/groups` search. No bulk import; coverage grows
  as people sign in.
- **Results are searcher-scoped** — OBO uses the searcher's delegated token, so each
  user sees only what the tenant allows them to see.

## Open risk noted at deploy time

`OPENID_REUSE_TOKENS=true` persists user OAuth tokens in MongoDB
(flagged by the comment at `.env.prod:630`). Confirm encryption at rest on the Mongo
volume or accept the exposure. Not yet reviewed.
