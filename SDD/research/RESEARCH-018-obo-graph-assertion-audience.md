# RESEARCH-018: Entra OBO→Graph fails — the OBO assertion token is the wrong type/audience

**Status:** Root cause **CONFIRMED via code trace** (2026-06-25) — assertion-token source identified
line-by-line. Fix is an **Entra app-registration + `OPENID_SCOPE`** change (admin-gated), plus two
minor code fixes; **NOT** a LibreChat version issue. Created 2026-06-25 during runtime verification of
the M365 native-OBO migration (RESEARCH-015 / ADR-0004).
**Triggering context:** First real end-to-end test of M365 MCP on the native OBO path. The MCP/OBO
wiring works and reaches Microsoft Entra, but **Entra rejects the On-Behalf-Of token exchange.**
**Related:** [RESEARCH-015](RESEARCH-015-librechat-agent-bridge-byot-mcp.md) (bridge bug — RESOLVED),
[ADR-0004](../adr/0004-mcp-native-obo-over-handrolled-byot.md) (native OBO migration),
[[project_m365_mcp_integration]], [[project_entra_people_search]].
**Handoff:** [Entra admin runbook](../../docs/m365-obo-entra-admin-runbook.md) — Part A (portal) +
Part B (`OPENID_SCOPE`), shareable with the Entra/Microsoft admin.

## TL;DR

OBO→Microsoft Graph appears to have **never actually worked** in this deployment — for either the
M365 MCP integration *or* the Entra people-search feature. The token LibreChat presents to Entra as
the OBO **assertion** is rejected:

- `AADSTS240002`: *"Input id_token cannot be used as 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant."*
- `AADSTS50013`: *"Assertion failed signature validation."*

The OBO grant requires the assertion to be an **access token whose audience is LibreChat's own app
registration**. LibreChat is instead presenting an **id_token** and/or an access token with the wrong
audience (Graph tokens are not valid OBO assertions → `50013`). The fix is in the **Entra app
registration + `OPENID_SCOPE`**, not in LibreChat code or its version.

## Root cause — CONFIRMED (code trace, 2026-06-25)

The original hypothesis is confirmed. The assertion-token source is now traced line-by-line, and it
explains **both** AADSTS errors and the people-search "local-only" symptom. There are **two OBO paths**
in this codebase, each sourcing the assertion differently, and **both are broken by the same upstream
gap**: login never acquires an app-audience access token (`OPENID_SCOPE` has no app/resource scope).

**The shared upstream cause.** `OPENID_SCOPE=openid profile email offline_access` requests only
reserved OIDC scopes — no resource/app scope. Against the Entra v2.0 `/token` endpoint this yields an
`access_token` whose `aud` is **Microsoft Graph** (`00000003-0000-0000-c000-000000000000`), issued as
a special nonce-signed token that **cannot be verified by any other resource**. Such a token is
categorically invalid as an OBO assertion → `AADSTS50013` "Assertion failed signature validation."
No app-audience access token is ever minted, so neither OBO path has a valid assertion to present.

**Path 1 — M365 MCP** (the three logged attempts). Assertion = `tokenInfo.accessToken`
(`obo.ts:145`) ← `user.federatedTokens.access_token` (`oidc.ts:67`). That field is set in
`api/strategies/openIdJwtStrategy.js:153-158`:

```js
user.federatedTokens = {
  access_token: accessToken || rawToken,   // accessToken = req.session.openidTokens.accessToken (= tokenset.access_token)
  id_token: idToken,                        // rawToken    = the Authorization-header Bearer (= the id_token)
  ...
};
```

- **Warm session:** `access_token` = `req.session.openidTokens.accessToken` = the raw login
  `tokenset.access_token` = the **Graph-audience nonce token** → `AADSTS50013` (attempts 2 & 3).
- **Cold/expired session:** `req.session.openidTokens.accessToken` is absent, so `|| rawToken` kicks
  in. `rawToken` is the Authorization-header Bearer, which for OpenID-reuse is the **id_token**
  (`AuthService.js:770`: `appAuthToken = tokenset.id_token || …`). An id_token is categorically
  invalid for the `jwt-bearer` grant → `AADSTS240002` "Input id_token cannot be used" (attempt 1).

**Path 2 — people-search** (separate impl, also broken). Assertion = `accessToken` taken **directly
from `req.headers.authorization` Bearer** (`PermissionsController.js:89` and `:450`), passed to
`GraphApiService.exchangeTokenForGraphAccess` (`assertion: accessToken`, line ~83). That Bearer is the
**id_token** (see above) → **always** `AADSTS240002` → `searchEntraIdPrincipals` throws →
`PermissionsController.js:481` logs *"Graph API search failed, falling back to local results"* →
returns only the local Mongo `users`. This is exactly the operator's "only people who have logged in"
observation, now confirmed in code. People-search is **doubly broken**: wrong token *type* (id_token,
not an access token) *and* the upstream missing app-audience scope.

**Bottom line:** one config gap (`OPENID_SCOPE` lacks the app's own API scope) starves every OBO path
of a valid assertion. Fix the scope (Part B below) and the M365 warm-session path works; the
people-search path additionally needs a code change to stop using the id_token as the assertion.

## What IS working (do not redo)

- **The M365 native-OBO migration (ADR-0004) is correct and live.** On branch
  `feature/015-m365-mcp-bridge`, the yaml `Microsoft365` server uses `obo: { scopes }`, and the
  runtime path runs end-to-end up to the Entra call:
  `createMCPTools` → `reconnectServer` → `reinitMCPServer` → `MCPManager.getConnection` →
  `MCPConnectionFactory.getOboTokens` → `resolveOboToken(user, oboConfig, exchangeOboToken)`.
  Log proof: `[MCP][Microsoft365][<user>] Resolving OBO token for scopes: User.Read Mail.Read …`
  immediately before the Entra rejection. The container runs the migrated `dist` (verified: 0
  `MCPCallQueue`, present `resolveOboToken`/`getOboTokens`). `packages/api` builds clean on Node
  22.18; MCP unit suite 1158 pass.
- **`OPENID_REUSE_TOKENS=true` is active** ("OpenID token reuse is enabled" at boot) and login
  succeeds. The token IS reaching the OBO exchange (we get `exchange_failed`, NOT
  `missing_upstream_token`) — so the earlier "session/user token disconnect" theory was **disproven**.

## Evidence (raw, from the running local stack 2026-06-25)

Three M365 tool-call attempts, all rejected by Entra at the OBO exchange:

```
[MCP][Microsoft365][6a3b…] Resolving OBO token for scopes: User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All
attempt 1 → AADSTS240002: Input id_token cannot be used as 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant.
attempt 2 → AADSTS50013: Assertion failed signature validation. [Key was found, but use of the key to verify the signature failed. Thumbprint '685926…', Found key Start=06/08/2026…]
attempt 3 → AADSTS50013 (same)
→ MCPConnectionFactory.createOboConnectionError → "The identity provider rejected the OBO token exchange."
```

- Zero successful OBO exchanges in 24h of logs (no "Cached fresh Graph token" / exchange success).
  The only `AADSTS` errors in the logs are these M365 attempts.
- DB: user `6a3b97997684c730b67220f9` (`p.oliva@memodo.de`) is `provider: 'openid'`, has `openidId`,
  but `federatedTokens` / `openidTokens` / `tokenset` are all empty on the user **document**.
- Reused tokens are written to the **server-side session** (`req.session.openidTokens` =
  `{ idToken, accessToken, refreshToken }`) at `api/server/services/AuthService.js:794` — NOT to the
  user document.

## Why "people-search proves OBO works" is FALSE (corrected assumption)

An earlier session leaned on people-search as proof the OBO machinery works. That is wrong:

1. People-search uses a **separate** OBO implementation — `api/server/services/GraphApiService.js`
   `exchangeTokenForGraphAccess` (line ~62), requesting `https://graph.microsoft.com/<scope>` — not
   the `exchangeOboToken`/`resolveOboToken` path M365 uses.
2. The operator's own observation: **people-search only returns people who have already logged into
   LibreChat** — i.e., it is serving the local Mongo `users` collection, the hallmark of the Graph
   directory search failing and the feature falling back to local data. A working Graph/OBO search
   would return any person in the tenant.
3. No evidence (logs/cache) that either OBO path has ever produced a Graph token in this environment.

**Conclusion:** treat OBO→Graph as *never having worked here*. This is a standing configuration gap,
not a regression introduced by the v0.8.7-rc1 upgrade or the M365 migration.

## Root-cause hypothesis

For the OAuth 2.0 OBO (`jwt-bearer`) grant, the **assertion** must be an **access token whose
audience (`aud`) is the middle-tier app itself** (LibreChat, app `323c5939-…`). Entra then exchanges
it for a downstream (Graph) token. The errors say LibreChat's assertion is invalid:

- `AADSTS240002` → an **id_token** was sent (id_tokens are categorically invalid for this grant).
- `AADSTS50013` → an access token whose signature/audience Entra won't accept for OBO — the classic
  symptom of an access token minted for **Microsoft Graph** (or otherwise not for this app).

With `OPENID_SCOPE=openid profile email offline_access` and **no scope for the app's own exposed API**,
Entra does not issue an app-audience access token suitable as an OBO assertion. The people-search
handoff already flagged the likely missing prerequisite: *"Verify an Application ID URI exists under
'Expose an API' — required for the OBO."*

## Fix runbook (ordered, by owner)

The assertion source is no longer in question (see "Root cause — CONFIRMED"), so the remaining work is
remediation, ordered by dependency. Steps are tagged by **who** can do them: `[ENTRA-ADMIN]` (Azure
portal, Global/Application Administrator on the app), `[CONFIG]` (env/yaml, deployable by the
operator), `[CODE]` (LibreChat source changes).

### Part A — Entra app registration `[ENTRA-ADMIN]` (prerequisite for everything else)

App `323c5939-9fcf-4868-87e0-290a000be67c`, tenant `73927432-b62c-46ff-94a3-0339d48d5223`:

1. **Expose an API → Application ID URI.** Confirm/create an Application ID URI (default
   `api://323c5939-9fcf-4868-87e0-290a000be67c`) and add a **delegated scope** named `access_as_user`
   (admins + users can consent). This is the scope login will request so Entra mints an app-audience
   access token usable as the OBO assertion. *Without this, Part B has nothing valid to request.*
2. **Microsoft Graph delegated permissions + admin consent.** Confirm the app has **delegated** Graph
   permissions for the M365 scopes (`Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`,
   `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `User.Read`) and people-search's (`People.Read`,
   `GroupMember.Read.All`), and that **admin consent is granted**. We never reached `AADSTS65001`
   (consent error), so consent is *unverified* — it becomes the next wall once the assertion is
   accepted. The app already has a client secret (confidential client), which OBO requires. ✓

### Part B — Make login acquire an app-audience access token `[CONFIG]`

3. **Add the app's own API scope to `OPENID_SCOPE`.** Change (in the symlinked `.env`):
   ```
   OPENID_SCOPE=openid profile email offline_access api://323c5939-9fcf-4868-87e0-290a000be67c/access_as_user
   ```
   Entra then mints `tokenset.access_token` with `aud` = the app (`api://323c…` / `323c…`) and
   `scp=access_as_user` — a **valid OBO assertion**. The id_token (still `aud=client_id`) and
   `appAuthToken` are unchanged, so the login Bearer / `openidJwt` JWKS validation path is unaffected.
   **Re-login is required** for the new token to land in the session. Then re-trigger an M365 tool call.
   - ⚠️ **Login-break risk.** This is the exact class of change (`OPENID_SCOPE` edit) that previously
     broke login here (the `offline_access` incident — see [[project_entra_people_search]]). Verify
     login *and* a tool call after deploying; have the prior `OPENID_SCOPE` value ready to roll back.

### Part C — Code fixes (secondary walls) `[CODE]`

**Progress (2026-06-25):** C.5 **DONE** (working tree on `feature/015-m365-mcp-bridge`, not yet
committed; tests + lint green). C.4 and C.6 are
intentionally **deferred** until Part A+B land, because both need the *real* post-fix token shapes to
get right without risking a regression (C.6 has cross-feature blast radius; C.4's correct scope format
must be confirmed empirically). See the per-item notes.

4. **OBO request scope format** (expected next error after the assertion is accepted).
   `exchangeOboToken` (`OboTokenService.js:68-72`) sends the raw yaml `obo.scopes`
   ("User.Read Mail.Read …") **unprefixed** as the grant `scope`. People-search's `GraphApiService`
   prefixes each with `https://graph.microsoft.com/`. For a v2.0 OBO→Graph exchange, prefer
   fully-qualified scopes or `https://graph.microsoft.com/.default`. Fix in the yaml `obo.scopes` or
   in the resolver. *Do not pre-emptively change this until Part B is in — confirm it's actually the
   next error first.*
5. ✅ **DONE — People-search now uses the federated access_token as its assertion.**
   `PermissionsController.js` previously took the Authorization-header Bearer (the **id_token**) at two
   sites (`:89` group-member fetching, `:450` principal search) and passed it as the OBO `assertion` —
   categorically invalid for `jwt-bearer` (`AADSTS240002`), which is why people-search has **never**
   returned Graph results. Both sites now call a new `getOboAssertionToken(req)` helper returning
   `req.user.federatedTokens?.access_token`, mirroring `AuthController.graphTokenController:328` and the
   M365 path. After Part B that access token is app-audience → the Graph search works; before Part B it
   still fails closed to the local fallback (no regression). Covered by two new `searchPrincipals` unit
   tests (asserts the federated token is used, asserts Graph is skipped when no token) — 14/14 pass,
   ESLint clean.
6. **`|| rawToken` id_token fallback** (`openIdJwtStrategy.js:154`) — **DEFERRED.** When the session
   lacks an access_token, the strategy puts the **id_token** into `federatedTokens.access_token`, which
   becomes an invalid OBO assertion (`AADSTS240002`) on cold/expired sessions. Not fixed yet because
   `federatedTokens.access_token` is consumed broadly — `graphTokenController` (`AuthController.js:328`),
   the `{{LIBRECHAT_OPENID_ACCESS_TOKEN}}` placeholder system (`env.ts:262`), `graph.ts:166`, and the
   M365 OBO path — so blindly removing the fallback risks regressing other consumers on cold sessions.
   The safer fix is a **targeted guard in the OBO path** (reject the assertion when it's actually an
   id_token, e.g. `aud == client_id` / no `scp`, with a self-documenting error pointing at
   `OPENID_SCOPE`), built + validated **after** Part B so the heuristic is checked against real
   app-audience vs id_token shapes. Note the deeper lifecycle gap this exposes: the OBO assertion lives
   only in the ~15-min session, so OBO needs the access token refreshed (via the stored refresh_token),
   not merely session-stored — a separate follow-up.

## What NOT to do

- **Do not upgrade LibreChat expecting it to fix this.** OBO has apparently never worked here; this is
  an Entra-app/OIDC-config gap, not a version regression. (A version bump won't change the Entra app
  or the audience of the login token.) The upgrade may be worthwhile for other reasons — keep separate.
- **Do not redo the SPEC-014 → native-OBO migration.** It is correct and reaches Entra (ADR-0004).
- **Do not delete `GraphTokenService.js` / `packages/api/src/utils/graph.ts`.** They are shared with
  the people-search Graph-token endpoint (`AuthController.graphTokenController`).
- **Do not treat people-search as proof OBO works** (it falls back to local users — see above).

## Open questions

1. **ANSWERED (code trace).** The M365 assertion is `federatedTokens.access_token` = the raw login
   `tokenset.access_token` (`aud` = Microsoft Graph, with `OPENID_SCOPE` lacking an app scope) — or
   the **id_token** via the `|| rawToken` fallback on a cold session. People-search's assertion is the
   id_token directly. (A live decode would only *confirm* `aud=Graph`; the source is no longer in
   doubt. It remains a cheap optional confirmation — `api/server` is bind-mounted, so a one-line
   decode log + container restart suffices, no `npm run build`.)
2. **OPEN — needs `[ENTRA-ADMIN]`.** Does app `323c5939-…` have "Expose an API" / an Application ID
   URI? Blocks Part A.1.
3. **OPEN — needs `[ENTRA-ADMIN]`.** Are the M365 + people-search Graph **delegated** scopes
   admin-consented? We never reached `AADSTS65001`, so consent is unverified; it becomes the next wall
   once the assertion is accepted. Part A.2.
4. **ANSWERED (code).** Yes — `PermissionsController.js:435/481`: people-search calls Graph only when
   local results are short and, on any Graph error, logs *"Graph API search failed, falling back to
   local results"* and returns local Mongo users. Matches the operator's observation.
5. **OPEN (deferred).** Likely yes — expect `https://graph.microsoft.com/`-prefixed scopes or
   `.default` (Part C.4). Confirm empirically *after* the assertion is accepted, not before.

## Pointers

- **OBO path (M365):** `packages/api/src/mcp/oauth/obo.ts` (`resolveOboToken`, line ~120),
  `packages/api/src/mcp/MCPConnectionFactory.ts` (`getOboTokens` ~332, `createOboConnectionError` ~362),
  `api/server/services/OboTokenService.js` (`exchangeOboToken`), `api/server/services/Tools/mcp.js:153`
  (`oboTokenResolver: exchangeOboToken`), `api/server/services/OboPolicyService.js`
  (`createOboTrustChecker` — yaml servers bypass).
- **Token extraction:** `packages/api/src/utils/oidc.ts` (`extractOpenIDTokenInfo` line 43,
  `isOpenIDTokenValid` line 104).
- **Token storage at login:** `api/server/services/AuthService.js:794` (`req.session.openidTokens`).
- **People-search OBO (separate impl):** `api/server/services/GraphApiService.js`
  (`exchangeTokenForGraphAccess`, `searchEntraIdPrincipals`), `api/server/controllers/PermissionsController.js`.
- **Config:** yaml `Microsoft365` `obo.scopes` in `librechat.yaml`; `.env` (symlink →
  `/Users/pablooliva/Dev/AI dev/LibreChat/.env`) — `OPENID_CLIENT_ID=323c5939-…`,
  `OPENID_ISSUER=…/73927432-…/v2.0/`, `OPENID_SCOPE=openid profile email offline_access`,
  `OPENID_REUSE_TOKENS=true` (set this session), `OPENID_GRAPH_SCOPES=User.Read,People.Read,GroupMember.Read.All`
  (people-search), `OPENID_ON_BEHALF_FLOW_*` (empty).
- **Reproduce:** send an agent prompt that calls a `Microsoft365_*` tool while signed in via Entra SSO;
  read `docker logs LibreChat --since 15m | grep -iE "OBO|AADSTS"`.

## Environment gotchas (local stack, 2026-06-25)

- Two Docker contexts exist (`default`, `desktop-linux`); the LibreChat stack runs under the
  **active** one — `docker context show` before `docker exec`/`logs`. A `docker compose down` removes
  the stack from `docker ps -a` entirely (not "Exited").
- `dist`, `librechat.yaml`, and `.env` are **bind-mounted** from the `LibreChat-worktree` (override
  compose), so `docker compose up -d` (or restart) picks up local changes — no image rebuild needed.
  The api image is `librechat:upgrade` (build-from-source). Build `dist` on **Node ≥22.18** (tsdown).
- `.env` is a **symlink** to the sibling worktree `/Users/pablooliva/Dev/AI dev/LibreChat/.env`
  (edit the real target, not through the symlink).
