# RESEARCH-018: Entra OBO→Graph fails — the OBO assertion token is the wrong type/audience

**Status:** **M365 MCP END-TO-END WORKING (local, 2026-07-07).** (1) OBO/assertion problem RESOLVED via
Entra Part A+B (login, app-audience assertion, native OBO→Graph all succeed — no `AADSTS`/`WWW-Authenticate`).
(2) **Tool-attachment blocker RESOLVED + VERIFIED 2026-07-07** — root cause was `librechat.yaml`
`endpoints.agents.capabilities` OMITTING `"tools"` (the MCP-tool capability gate), NOT an upstream defect
or version issue. Fix = add `"tools"` (commit `1fe8e546b`); verified live: `Storing tool context: 172/173
tools` + real Graph data. See "UPDATE 2026-07-06 (later) — ROOT CAUSE" below. (3) **OBO token-refresh
(C.6) RESOLVED 2026-07-07** (commit `67b1d66b0`) — proactive refresh-on-reuse; see "UPDATE 2026-07-07 —
token refresh (C.6)" below. Original OBO root cause **CONFIRMED via code trace** (2026-06-25).
Created 2026-06-25 during runtime verification of the M365 native-OBO migration (RESEARCH-015 / ADR-0004).
**Triggering context:** First real end-to-end test of M365 MCP on the native OBO path. The MCP/OBO
wiring works and reaches Microsoft Entra, but **Entra rejects the On-Behalf-Of token exchange.**
**Related:** [RESEARCH-015](RESEARCH-015-librechat-agent-bridge-byot-mcp.md) (bridge bug — RESOLVED),
[ADR-0004](../adr/0004-mcp-native-obo-over-handrolled-byot.md) (native OBO migration),
[[project_m365_mcp_integration]], [[project_entra_people_search]].
**Handoff:** [Entra admin runbook](../../docs/m365-obo-entra-admin-runbook.md) — Part A (portal) +
Part B (`OPENID_SCOPE`), shareable with the Entra/Microsoft admin. Executed record:
[runbook-executed](../../docs/m365-obo-entra-admin-runbook-executed.md).
**Follow-on enablement runbooks (org-mode tools, read-only):**
[SharePoint (Phase 1, config-only)](../../docs/m365-sharepoint-readonly-runbook.md) —
`MS365_MCP_ORG_MODE` + `MS365_MCP_ALLOWED_SCOPES`, no Entra change;
[Teams (Phase 2, needs admin consent)](../../docs/m365-teams-readonly-runbook.md) — 10 delegated Graph
scopes + admin consent + matching `obo.scopes`/`MS365_MCP_ALLOWED_SCOPES`, gated on the
[Teams risk assessment](../../docs/m365-teams-readonly-risk-assessment.md) (governance sign-off +
Tier A/B decision).

## UPDATE 2026-07-06 — auth chain RESOLVED on the branch; new blocker = MCP tool attachment

First full runtime test on `feature/015-m365-mcp-bridge` after the Entra admin executed Part A + Part B
(prod, verified 2026-07-04) and we mirrored the working config into the local `.env` and worktree
`.env.prod`.

**Entra config as actually applied (differs from the original runbook):**
- **Custom Application ID URI** `api://chat.memodo.de/323c5939-9fcf-4868-87e0-290a000be67c` (not the
  `api://<client-id>` default). So `OPENID_SCOPE` appends `…/access_as_user` on that URI.
- **Part B grew a B.2 step** the original runbook lacked: after B.1 the login access token is
  app-audience, so Microsoft's userinfo endpoint 401s (`OAUTH_WWW_AUTHENTICATE_CHALLENGE`). Fix:
  `OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true` + `OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=User.Read`.
- `OPENID_GRAPH_SCOPES` was expanded to all M365 + people-search scopes (people-search path).

**RESOLVED — the RESEARCH-018 problem itself:** login succeeds; the native OBO→Graph exchange succeeds
for all 8 scopes with **no `AADSTS50013`/`240002`** and **no scope-format error**; the bridge reconnects
(`[MCP Reinitialize]`) and the sidecar connection establishes; **172 tools discovered/cached**. Notably
the deferred **C.4 (scope prefixing) is NOT needed** — Entra accepted the unprefixed short scopes.

**NEW blocker (now the real one) — MCP tool ATTACHMENT, not auth:** the LLM is invoked with **0 tools**
(`[initializeClient] Storing tool context … 0 tools, registry size: 0`, `toolSchemaTokens: 0`) despite
172 discovered/cached AND 173 explicitly attached on a saved agent (`agent_HjWj7JvdJUJWFQ02OJ_RH`). True
for **both** the in-chat ephemeral path *and* a saved agent; **no skip-warning** logged. The MCP
*instructions* DO inject, so the model **hallucinates** ("0 emails" with no `tool_call`, no sidecar
traffic). It is **always** 0 — even seconds after a healthy 172-tool cache and before any SSE drop — so
it is **not** connection stability. It's an **upstream tool-resolution defect**
(`api/server/services/ToolService.js`, `packages/api/src/tools/definitions.ts`,
`api/server/services/Endpoints/agents/initialize.js`) — **not our OBO code**. → This is why we are
pursuing the **`v0.8.7` GA update** (GA changes `ToolService.js` + bumps `@librechat/agents`; we have 0
commits on those files so they apply cleanly).

**Secondary issues found (track separately):**
- **OBO token lifecycle (C.6 territory) — RESOLVED 2026-07-07 (commit `67b1d66b0`).** Was: the injected
  Graph token expires (~1 h); on reconnect the MCP transport reused the stale token → `401 invalid_token
  "access token has expired"`, and since the server is not an OAuth-discovery server it couldn't re-auth
  (`Server does not use OAuth`) → dead connection until re-login. Fixed via proactive refresh-on-reuse —
  see "UPDATE 2026-07-07 — token refresh (C.6)" below.
- **SSE instability:** `SSE stream disconnected: TypeError: terminated` ~every 5 min (streamable-http).
- **Local-only container perms:** container runs as uid 501 but `/app` is owned by `node` →
  `EACCES: mkdir ./data` for the file-backed *violation/log* caches (the OBO token cache is in-memory,
  unaffected — harmless to M365; prod runs uid 1000 so it doesn't hit this).

### v0.8.7 GA upgrade attempt — did NOT fix the tool-attachment bug (2026-07-06, later)

Rationale: the tool-attachment defect lives in **upstream** code (`ToolService.js` / `tools/definitions.ts`
/ `agents/initialize.js`), not our OBO code, so a GA bump *might* have fixed it. It didn't.

- **Merged `origin/main` (v0.8.7 GA, +96 commits, bumps `@librechat/agents` → 3.2.57)** into a new branch
  **`feature/015-m365-obo-v0.8.7`** (forked from `feature/015-m365-mcp-bridge`, which stays as the
  fallback). Only **3 conflicts**, none in OBO backend: `.gitignore` (union) + `useSSE.ts` /
  `useResumableSSE.ts` (our SPEC-009 PII-warn `showToast` vs GA's streaming refactor — resolved as a
  union). Compiles clean on Node 22.18; image `librechat:upgrade` rebuilt; container recreated
  (0 restarts, healthy).
- **Retest 2026-07-06 (fresh SSO account `6a4bc85d…`): STILL `Storing tool context … 0 tools`,
  `toolSchemaTokens: 0`** despite `[MCP Cache] Updated 172 tools`. Same on the in-chat ephemeral path
  and (earlier) a saved agent. **GA does not resolve it → this needs a real code fix, not a version
  bump.** Next: instrument the `172 → 0` gap (add temporary debug logging in `getOrFetchMCPServerTools`
  and the `definitions.ts` `mcp_all` expansion), rebuild `packages/api`, and trace why the cached tools
  aren't surfaced into the agent's tool registry for the per-user-OBO ("overlay") server.
- **Bonus regression found + fixed on GA:** the admin **Usage Reports** dashboard showed "Failed to
  load" on every panel — `api/server/routes/admin/usage.js` imported `logger` from `~/config`, which
  GA no longer exports (→ `auditLog` threw `Cannot read properties of undefined (reading 'info')`).
  Fixed by importing from `@librechat/data-schemas` (commit `df83958cf`). Also added an admin-gated
  **Serper Dashboard** side-nav link (`aa756c346`).

## UPDATE 2026-07-06 (later) — ROOT CAUSE FOUND: `agents.capabilities` omits `"tools"`

The tool-attachment blocker is **not** an upstream tool-resolution defect and **not** a version issue.
It is a **one-line `librechat.yaml` config gap**. Traced end-to-end from the debug log, not theorized.

**Root cause.** `endpoints.agents.capabilities` in `librechat.yaml` was
`["file_search", "web_search", "actions", "artifacts"]` — it **omits `"tools"`**. `AgentCapabilities.tools`
(`packages/data-provider/src/config.ts:576`, value `'tools'`) is the capability that gates **all MCP
tools** at agent tool-resolution time. In `loadToolDefinitionsWrapper`
(`api/server/services/ToolService.js:558,585-587,594`):

```js
const areToolsEnabled = checkCapability(AgentCapabilities.tools);   // FALSE — "tools" not in the yaml list
...
const filteredTools = agent.tools?.filter((tool) => {
  ...
  if (tool?.includes(Constants.mcp_delimiter)) {
    return areToolsEnabled && canUseMCP;   // false && … = every MCP tool dropped
  }
  ...
});
if (!filteredTools || filteredTools.length === 0) {
  return { toolDefinitions: [] };          // silent early return → "0 tools", NO warning
}
```

Because the framework default (`defaultAgentCapabilities`, `config.ts:692`) **does** include `tools`, a
vanilla install works — but a yaml that specifies a non-empty `capabilities` list **replaces** the
default wholesale, so omitting `tools` silently disables MCP-in-agents. `getOrFetchMCPServerTools` /
`definitions.ts` / the `mcp_all` path were **never reached** — the tools were filtered one step earlier.

**Why every prior clue fits this and only this:**
- **172 discovered/cached but 0 attached** — discovery runs via the frontend connect/reinitialize route
  (`reinitMCPServer` → `updateMCPServerTools`), which has **no capability gate**; the capability check
  lives only in the agent tool-resolution path. Confirmed in `logs/debug-2026-07-06.log`: L487 `[MCP Cache]
  Updated 172 tools … (user: 6a3b…)` then L510 `[initializeClient] Storing tool context … 0 tools` ~30s
  later, cache still warm.
- **No skip-warning** — the definitions-wrapper filter (unlike legacy `loadAgentTools`) logs nothing when
  it drops MCP tools; the early `return { toolDefinitions: [] }` is silent.
- **Both ephemeral (`azureOpenAI__gpt-5___GPT-5`) AND saved agent (`agent_HjWj7JvdJUJWFQ02OJ_RH`)** — both
  funnel through `loadToolDefinitionsWrapper` with the same (missing) capability. L1904→L1945 shows the
  saved-agent path identical to the ephemeral one.
- **MCP instructions still inject** — server instructions come from a different path, not gated by `tools`.
- **v0.8.7 GA didn't fix it** — GA cannot change your yaml.
- **`canUseMCP` is fine** — the connect route (`v1.js:701`) 403s if the user lacks `MCP_SERVERS.USE`;
  discovery succeeded, so that permission is granted (user is ADMIN). The **only** failing gate was `tools`.

**The prompt's stated premise was wrong in a load-bearing way.** `requiresEphemeralUserConnection()`
(`packages/api/src/mcp/utils.ts:191`) checks for `{{LIBRECHAT_BODY_*}}` runtime placeholders — **NOT
`obo`**. The M365 config has none, so it returns **FALSE**: M365 is user-scoped (obo) but **not**
request-scoped. Hence its 172 tools **are** persistently cached under `{userId, serverName}` (the
`[MCP Cache] Updated …` = caching path, not "Built … without caching"), and the `mcp_all` overlay path in
`load.ts` was never taken. The 172→0 gap was upstream of all that.

**Fix (applied).** `librechat.yaml` →
`capabilities: ["file_search", "web_search", "actions", "artifacts", "tools"]`. yaml is bind-mounted
locally → `docker restart LibreChat` (done, booted clean). **Deploy to prod = yaml path**: `git push` +
prod `git pull` + `./prod.sh restart api` (per `feedback_prod_yaml_deploy`). No `dist` rebuild needed
(no `packages/*/src` change). **VERIFIED live 2026-07-07** (fresh SSO): `Storing tool context: 172 tools`
(in-chat toggle) and `173 tools` (saved agent), with real Graph data returned. The 172 = the Softeria
`ms-365-mcp-server` personal (non-org) catalog (mail/calendar/files/excel/tasks/onenote/contacts + utility);
org tools (Teams/SharePoint/user-directory) excluded (phase 1). Read scopes work; write tools are exposed
but 403 at Graph (read-only OBO scopes). Prod deploy still pending (yaml path).

## UPDATE 2026-07-07 — token refresh (C.6) RESOLVED (proactive refresh-on-reuse)

**Commit `67b1d66b0`.** Fixes the "dead connection until re-login" after ~1 h of continuous M365 use.

**Mechanism of the bug.** The OBO Graph token (~1 h) was resolved once and baked into the streamable-http
transport's `Authorization: Bearer` header at connect time (`connection.ts` ~1704). `setOAuthTokens`
updates a field but not the live transport, and the OBO token isn't routed through the per-request
`requestHeaders` path — so a live connection's token can't change. OBO servers also get NO OAuth recovery:
`MCPConnectionFactory.createConnection` installs a `nonOAuthHandler` (only when `!usesObo` gets the real
handlers) that emits `oauthFailed` "Server does not use OAuth" on any 401. `UserConnectionManager` reuse
(line ~422) returned a still-"connected" connection without re-resolving the token. Because `callTool`
refreshes last-activity each call (MCPManager ~300), the 15-min idle teardown never fires during continuous
use → the connection outlived its token → 401 on every call until re-login.

**Fix (Option A — proactive refresh-on-reuse; chosen over reactive-on-401, which risks a stale assertion
and touches the shared OAuth event machinery people-search depends on).** Four coordinated parts:
1. `connection.ts` — `isOboTokenNearExpiry(skew=5m)` getter (true only for an OBO connection whose token
   is within the skew of expiry).
2. `UserConnectionManager.ts` — at the reuse point, a near-expiry OBO connection is disconnected and
   rebuilt on the live request, so it re-runs the OBO exchange with the current request's fresh assertion.
3. `OboTokenService.js` — stamp an absolute `expires_at` at mint time. **Dependent correctness fix:** the
   cache stored only a fixed `expires_in`, so `resolveOboToken` recomputed `expires_at = now + expires_in`
   on every read → a cache hit late in the token's life produced an INFLATED `expires_at` that would defeat
   the near-expiry check.
4. `obo.ts` — `resolveOboToken` prefers `expires_at`, and when the (cached) token is near expiry forces a
   cache-bypassing exchange so the rebuild gets a full-lifetime token (also removes reconnect churn in the
   last 5 min, since the OBO cache TTL == token lifetime).

**Assertion-freshness constraint:** refresh uses `req.user.federatedTokens.access_token`, kept fresh per
request by `OPENID_REUSE_TOKENS`. If the assertion itself has fully lapsed, the exchange fails and re-login
is still required — expected, not a regression.

**Tests:** new `MCPConnectionOboExpiry.test.ts` (getter, 9 cases), `MCPManager.test.ts` reuse/rebuild cases
(+2), `obo.spec.ts` force-fresh + `expires_at` cases (+3). The gated unit suite (`test:ci` exclusions) is
green: **46 suites / 1178 pass** for `src/mcp`. (The 6 `*.integration`/`*.cache_integration` suites are
excluded from unit/CI by `--testPathIgnorePatterns` and require a real Redis cluster / fixture servers;
they are infra-gated, unrelated to this change.)

**Residual (not addressed by Option A):** a mid-stream SSE auto-reconnect between `getConnection` calls
still reuses the baked-in header; the next `getConnection` rebuilds it. Full mid-run coverage would be the
reactive-on-401 path (Option B), deferred. The `|| rawToken` id_token-as-assertion fallback
(`openIdJwtStrategy.js`, original Part C.6/item-6) is a separate cold-session concern, still deferred.

**Deploy:** touches `packages/api/src` (dist bind-mounted) + `api/server/*.js` → prod needs
`npm run build` + `./prod-sync.sh`, not just git pull. Local: built + container restarted (symbols verified).
Not yet on prod.

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
