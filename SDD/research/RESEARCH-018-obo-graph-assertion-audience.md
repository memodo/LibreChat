# RESEARCH-018: Entra OBO→Graph fails — the OBO assertion token is the wrong type/audience

**Status:** Open — investigation + fix needed. Created 2026-06-25 during runtime verification of the
M365 native-OBO migration (RESEARCH-015 / ADR-0004).
**Triggering context:** First real end-to-end test of M365 MCP on the native OBO path. The MCP/OBO
wiring works and reaches Microsoft Entra, but **Entra rejects the On-Behalf-Of token exchange.**
**Related:** [RESEARCH-015](RESEARCH-015-librechat-agent-bridge-byot-mcp.md) (bridge bug — RESOLVED),
[ADR-0004](../adr/0004-mcp-native-obo-over-handrolled-byot.md) (native OBO migration),
[[project_m365_mcp_integration]], [[project_entra_people_search]].

## TL;DR

OBO→Microsoft Graph appears to have **never actually worked** in this deployment — for either the
M365 MCP integration *or* the Entra people-search feature. The token LibreChat presents to Entra as
the OBO **assertion** is rejected:

- `AADSTS240002`: *"Input id_token cannot be used as 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant."*
- `AADSTS50013`: *"Assertion failed signature validation."*

The OBO grant requires the assertion to be an **access token whose audience is LibreChat's own app
registration**. LibreChat is instead presenting an **id_token** and/or an access token with the wrong
audience (Graph tokens are not valid OBO assertions → `50013`). The fix is almost certainly in the
**Entra app registration + OIDC scope configuration**, not in LibreChat code or its version.

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

## Investigation paths (rough order)

1. **Decode the actual assertion token's `aud` claim.** Definitive first step. Trace the token
   `resolveOboToken`/`exchangeOboToken` sends (from `tokenInfo.accessToken`, set in
   `extractOpenIDTokenInfo`, `packages/api/src/utils/oidc.ts:67/72` ← `user.federatedTokens` /
   `user.openidTokens`). Decode its JWT payload: is `aud` = Graph (`00000003-0000-0000-c000-…`), the
   client id (`323c5939-…`), or an App ID URI (`api://323c5939-…`)? Is it actually an id_token? This
   tells us exactly what's wrong.
2. **Entra app registration (portal, needs admin).** On app `323c5939-9fcf-4868-87e0-290a000be67c`
   (tenant `73927432-b62c-46ff-94a3-0339d48d5223`): confirm/add **"Expose an API" → Application ID
   URI** and a delegated scope (e.g. `access_as_user`). Confirm Microsoft Graph **delegated**
   permissions exist + are admin-consented for the M365 scopes (`Mail.Read`, `Calendars.Read`,
   `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`).
3. **Make login acquire an app-audience access token.** Add the app's own API scope to `OPENID_SCOPE`
   (e.g. `… api://323c5939-…/access_as_user`) so the stored access token has `aud` = the app — the
   valid OBO assertion. Re-login, re-decode `aud`, confirm.
4. **Verify which token is passed as the assertion.** `AADSTS240002` (id_token used) suggests the
   wrong field may be selected. Check the session→user token mapping (where `req.session.openidTokens`
   {idToken, accessToken} becomes `user.openidTokens`/`federatedTokens` {id_token, access_token});
   confirm the id_token isn't landing in the access_token slot.
5. **Scope FORMAT (secondary wall after the assertion is fixed).** `exchangeOboToken`
   (`api/server/services/OboTokenService.js`) sends the raw yaml `obo.scopes` ("User.Read Mail.Read …")
   as the grant `scope`, **unprefixed**. People-search's `GraphApiService` prefixes each with
   `https://graph.microsoft.com/`. A Graph OBO request likely needs fully-qualified scopes or
   `https://graph.microsoft.com/.default`. Expect this to be the next error after the assertion is
   accepted; consider prefixing in the yaml `obo.scopes` or in the resolver.

## What NOT to do

- **Do not upgrade LibreChat expecting it to fix this.** OBO has apparently never worked here; this is
  an Entra-app/OIDC-config gap, not a version regression. (A version bump won't change the Entra app
  or the audience of the login token.) The upgrade may be worthwhile for other reasons — keep separate.
- **Do not redo the SPEC-014 → native-OBO migration.** It is correct and reaches Entra (ADR-0004).
- **Do not delete `GraphTokenService.js` / `packages/api/src/utils/graph.ts`.** They are shared with
  the people-search Graph-token endpoint (`AuthController.graphTokenController`).
- **Do not treat people-search as proof OBO works** (it falls back to local users — see above).

## Open questions

1. What is the `aud` of the access token LibreChat currently sends as the OBO assertion?
2. Does the Entra app `323c5939-…` "Expose an API" / have an Application ID URI?
3. Are the M365 Graph delegated scopes admin-consented on that app? (We never reached `AADSTS65001`,
   so consent is currently unverified — it becomes relevant only once the assertion is accepted.)
4. Does people-search's `searchEntraIdPrincipals` fall back to local users on Graph failure (confirm
   the operator's observation in code)?
5. Does the OBO grant scope need `https://graph.microsoft.com/` prefixing or `.default`?

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
