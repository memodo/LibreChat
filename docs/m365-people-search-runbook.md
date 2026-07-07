# M365 / Entra — Enable People Search (directory people picker)

**Audience:** LibreChat operator + (for a one-time check) Microsoft Entra admin.
**Goal:** Turn on live **Entra directory search** in LibreChat's Share-modal people picker — typing 3+
letters surfaces tenant colleagues (and groups) who have **never logged into LibreChat**, instead of
only the local Mongo users.
**Time:** ~10 minutes + a re-login.
**Background:** `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.
**Supersedes:** `HANDOFF-entra-people-search.md` — that doc's "COMPLETE / verified 2026-06-11" status is
**inaccurate** (see "State" below); this runbook is the current source of truth.

> **This is a different subsystem from the M365 assistant tools.** People Search is *not* the Softeria
> MCP sidecar and has nothing to do with org-mode or the SharePoint/Teams runbooks. It is LibreChat's
> own people picker → `GraphApiService` → Microsoft Graph `GET /users`, `GET /groups`, `GET /me/people`,
> using the same OBO token exchange. Enabling it is independent of Phases 1/2.

---

## How it works

- **Route:** `GET /api/permissions/search-principals` → `checkPeoplePickerAccess` → `searchPrincipals`
  (`api/server/controllers/PermissionsController.js`).
- **Feature gate** (`GraphApiService.js` `entraIdPrincipalFeatureEnabled`): requires **all** of
  `USE_ENTRA_ID_FOR_PEOPLE_SEARCH` enabled, `OPENID_REUSE_TOKENS` enabled, and an `openid` user with an
  `openidId`. If any is false, the controller serves **local Mongo users only** (the silent fallback).
- **OBO assertion:** `getOboAssertionToken(req)` = `req.user.federatedTokens.access_token` (the
  app-audience access token — fix "C.5"). An id_token here is invalid (`AADSTS240002`), which is why the
  feature returned only local results before the assertion source was corrected.
- **Graph scopes:** `OPENID_GRAPH_SCOPES`, fully-qualified to `https://graph.microsoft.com/<scope>`.
  `/users` needs `User.ReadBasic.All`; `/me/people` needs `People.Read`; group lookup needs
  `GroupMember.Read.All`.
- **Group sync:** at login, `oauth.js` calls `syncUserEntraGroupMemberships` so shared-with-group ACLs
  resolve. Same OBO/consent prerequisites.

---

## State (why this runbook exists)

People Search was deployed and flag-on in June 2026 and marked "verified complete", but
**RESEARCH-018 established it was silently falling back to local users** — the OBO assertion was the
wrong token type *and* login minted no app-audience token, so the Graph directory call always failed.
That root cause was only fixed by **Entra Part A+B (2026-07-04)** plus the **C.5 assertion fix**. So:

- ✅ OBO→Graph exchange works (Part A+B).
- ✅ C.5 assertion fix is in the code on `feature/015-m365-obo-v0.8.7`.
- ✅ `OPENID_GRAPH_SCOPES` already lists `User.ReadBasic.All, People.Read, GroupMember.Read.All`.
- ✅ `OPENID_REUSE_TOKENS=true`.
- ✅ `USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true` — **enabled + verified locally 2026-07-07.** Login
  `syncUserEntraGroupMemberships` fetched **43 groups from Graph** (live directory data via the same
  OBO exchange), with **0** `falling back to local results`, and the Share-modal picker returns results.
  Consent for `User.ReadBasic.All` is therefore effectively confirmed (the Graph directory calls
  succeed).
- ❓ **PROD still pending:** flip the flag in `.env.prod` **and** ensure the C.5 code is deployed
  (this branch is not yet pushed/deployed, so prod may still run the pre-fix controller).

---

## Steps

### 1. `[ENTRA-ADMIN]` Confirm the three directory scopes are admin-consented

App `323c5939-9fcf-4868-87e0-290a000be67c`, tenant `73927432-b62c-46ff-94a3-0339d48d5223` — under
**API permissions**, confirm **delegated** + *"Granted for <tenant>"* for:

- `User.ReadBasic.All` (for `GET /users`)
- `People.Read` (for `GET /me/people`)
- `GroupMember.Read.All` (for group membership / group results)

These are directory-read permissions; most tenants require **admin consent**. No new app-audience or
login change is needed — this reuses the working OBO topology.

### 2. `[CONFIG]` Enable the feature flag

In `.env` (local) / `.env.prod` (prod), set:

```
USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true
```

Confirm the companions are already present (they are, as of this runbook):

```
OPENID_REUSE_TOKENS=true
OPENID_GRAPH_SCOPES=...,User.ReadBasic.All,People.Read,GroupMember.Read.All,...
```

> Do **not** add these Graph scopes to `OPENID_SCOPE` — that is the *login* scope, and adding resource
> scopes there risks the login-break class of bug. `OPENID_GRAPH_SCOPES` is OBO-only.

### 3. `[CODE/DEPLOY]` Ensure the C.5 assertion fix is on the target

`PermissionsController.js` must resolve the assertion from `req.user.federatedTokens.access_token`
(grep for `getOboAssertionToken`). It's present on `feature/015-m365-obo-v0.8.7`. **Prod** runs
bind-mounted `api/server/*.js`, so the branch's JS must be deployed there — otherwise prod keeps using
the pre-fix code and falls back to local even with the flag on.

### 4. `[DEPLOY]` Apply

- **Local:** edit the real `.env` (it's a symlink to `../LibreChat/.env` — edit the target) and
  `docker restart LibreChat`. `.env` is read by dotenv at process start, so a restart suffices.
- **Prod:** People Search config lives in **`.env.prod`** — edit locally, `scp` to
  `Hetzner-personal:/opt/docker/librechat/.env.prod`, then `./prod.sh restart api`. **This is its own
  deploy path** — *not* the yaml path and *not* `prod-sync.sh`. (Re-`chown 1000:1000` `.env.prod` after
  editing as root — see the prod `.env.prod` chown trap.)

### 5. `[VERIFY]` Prove it hits Graph, not the local fallback

1. Re-login via **"Continue with Microsoft"** (restart cleared the session).
2. Open a **Share** modal (e.g., share an agent/prompt) and type **3+ letters** of a colleague who has
   **never** logged into LibreChat.
3. Success = that colleague appears. In `logs/debug-YYYY-MM-DD.log`, you should **not** see
   `Graph API search failed, falling back to local results`; you should see the Graph search path run.

---

## Rollback

Set `USE_ENTRA_ID_FOR_PEOPLE_SEARCH=false` and restart (local) / `./prod.sh restart api` (prod). The
picker reverts to local Mongo users only. No data or auth-state change.

---

## Governance note (lighter than Teams, but not zero)

People Search exposes the **org directory** — names, emails, job titles, and group membership — to any
LibreChat user who can open the people picker. That's standard collaboration data (a people picker),
materially lower-sensitivity than Teams message content, but it is still a directory-read grant via
admin consent. Confirm it's acceptable for your tenant; no DPIA-level review is implied by default, but
record the decision if your governance process expects it.

---

## Troubleshooting

- **Only previously-logged-in people appear** → the Graph path is failing and falling back. Check, in
  order: the flag is `true`; `OPENID_REUSE_TOKENS=true`; the three scopes are admin-consented; the
  logged-in user is `provider: openid`; and (on prod) the C.5 code is actually deployed. The debug log
  line `Graph API search failed, falling back to local results` names the underlying Graph error.
- **Login bounces to the sign-in page after enabling** → unrelated to this flag, but if it happens
  after any OIDC change, confirm `offline_access` is in `OPENID_SCOPE` (the `OPENID_REUSE_TOKENS` +
  no-refresh-token login-break; see `HANDOFF-entra-people-search.md` history).
- **`AADSTS65001` in the OBO exchange** → a directory scope isn't consented (Step 1).

---

## References

- OBO background & app identifiers: [`m365-obo-entra-admin-runbook.md`](m365-obo-entra-admin-runbook.md)
- Executed OBO record: [`m365-obo-entra-admin-runbook-executed.md`](m365-obo-entra-admin-runbook-executed.md)
- Original (superseded) handoff: [`HANDOFF-entra-people-search.md`](HANDOFF-entra-people-search.md)
- Root-cause context: `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`
