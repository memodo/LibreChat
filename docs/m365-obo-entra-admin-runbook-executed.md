# M365 / Microsoft Graph On-Behalf-Of — Entra Admin Runbook

**Audience:** Microsoft Entra ID (Azure AD) administrator with Global Administrator or
Application Administrator + Privileged Role Administrator rights on the app below.
**Goal:** Make LibreChat's On-Behalf-Of (OBO) token exchange to Microsoft Graph succeed, so the
Microsoft 365 assistant tools and the Entra people-search both work.
**Time:** ~15 minutes in the portal + one config change + a re-login.
**Background (for context):** `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.

> ## Status — updated 2026-07-04
> - **Part A (Entra) + Part B (LibreChat env): ✅ done & verified.** SSO login works and the OBO
>   assertion + userinfo exchange succeed — the `AADSTS50013` / `AADSTS240002` and the
>   `WWW-Authenticate` (`OAUTH_WWW_AUTHENTICATE_CHALLENGE`) errors are all resolved. Part B grew a
>   second step (**B.2**) that the original runbook was missing.
> - **M365 assistant tools: ❌ still not working — but this is NOT an Entra/OBO issue.** It is a
>   LibreChat **v0.8.5 MCP→agent bridge** limitation (`SDD/research/RESEARCH-015`). Full findings and
>   the fix (upgrade/rebase to upstream **v0.8.7**) are in the new **Part C** below.

---

## The problem in one paragraph

When a user signs in, LibreChat receives an access token from Entra. It then uses the
**OAuth 2.0 On-Behalf-Of grant** (`urn:ietf:params:oauth:grant-type:jwt-bearer`) to exchange that
token for a Microsoft Graph token scoped to the user's mail/calendar/files/etc. That exchange is
**currently rejected by Entra** with `AADSTS50013` ("Assertion failed signature validation") and
`AADSTS240002` ("Input id_token cannot be used as jwt-bearer grant"). Root cause: the access token
LibreChat acquires at login has its **audience set to Microsoft Graph** (because the sign-in requests
no scope for LibreChat's *own* API), and a Graph-audience token is not a valid OBO *assertion*. The
OBO assertion must be an access token whose **audience is LibreChat's own app registration**. Fixing
this requires (A) exposing an API on the app so it can mint an app-audience token, and (B) asking for
that scope at login.

---

## Identifiers (verify before starting)

| Item | Value |
|---|---|
| Application (client) ID | `323c5939-9fcf-4868-87e0-290a000be67c` |
| Directory (tenant) ID | `73927432-b62c-46ff-94a3-0339d48d5223` |
| App is a confidential client (has a client secret) | Yes — required for OBO. ✔ already configured. |
| Sign-in authority | `https://login.microsoftonline.com/73927432-b62c-46ff-94a3-0339d48d5223/v2.0/` |

> LibreChat is **both** the sign-in client *and* the OBO middle-tier (same app registration). So the
> app requests an access token for **its own** exposed API at login, then presents that token as the
> OBO assertion to obtain a Graph token. This is the standard "OBO with a single app registration"
> topology.

---

## Part A — Entra portal changes `[ENTRA-ADMIN]`

> **✅ DONE — configured & checked on the Entra side, 2026-07-04.** Note: this app uses a **custom
> Application ID URI** `api://chat.memodo.de/323c5939-…` (not the `api://323c5939-…` default suggested
> in A.1). Use the URI actually set under **Expose an API** verbatim in Part B.

All steps are on **App registrations → (the app `323c5939-…`)**.

### A.1 — Expose an API (create the app-audience scope)

1. Open **Expose an API**.
2. **Application ID URI:** if none is set, click **Add** and accept the default
   `api://323c5939-9fcf-4868-87e0-290a000be67c`. *(If a custom URI already exists, keep it and use it
   verbatim in Part B instead of the default.)*
3. **Add a scope:**
   - **Scope name:** `access_as_user`
   - **Who can consent:** **Admins and users**
   - **Admin consent display name:** `Access LibreChat as the signed-in user`
   - **Admin consent description:** `Allows LibreChat to call Microsoft Graph on behalf of the signed-in user.`
   - **State:** Enabled
   - Click **Add scope**. The full scope string becomes
     `api://323c5939-9fcf-4868-87e0-290a000be67c/access_as_user`.
4. **(Recommended) Pre-authorize the app to itself** so users aren't prompted to consent to the
   app's own API: still under **Expose an API → Authorized client applications → Add a client
   application**, enter client ID `323c5939-9fcf-4868-87e0-290a000be67c` and tick the
   `access_as_user` scope.

### A.2 — Microsoft Graph delegated permissions + admin consent

1. Open **API permissions**.
2. Ensure the following **Microsoft Graph → Delegated** permissions are present (add any missing via
   **Add a permission → Microsoft Graph → Delegated permissions**):

   **For the M365 assistant tools:**
   `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`,
   `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`

   **For Entra people-search (group/principal lookup):**
   `People.Read`, `GroupMember.Read.All` *(User.Read is shared with the list above)*

3. Click **Grant admin consent for <tenant>** and confirm. All rows should show a green
   "Granted for <tenant>" status. *(All scopes above are read-only.)*

> Note: we have not yet seen `AADSTS65001` (the missing-consent error) because the request never got
> past the assertion-rejection step. Granting consent now avoids it becoming the next blocker once
> Part B lands.

### A.3 — Confirm a client secret exists (no action if already present)

Open **Certificates & secrets**. There must be a **valid, unexpired client secret** (the OBO grant is
a confidential-client flow). LibreChat already holds one (`OPENID_CLIENT_SECRET`); if it has expired,
mint a new one and hand the **value** to the LibreChat operator to update `.env`.

---

## Part B — LibreChat configuration changes `[CONFIG]` (operator, after Part A)

> **✅ DONE — deployed & verified 2026-07-04** in `/opt/docker/librechat/.env.prod`. These changes
> make login + the userinfo OBO exchange succeed. They do **not**, on their own, make the M365
> assistant *tools* work — that is a separate LibreChat blocker; see **Part C**.

Two environment steps, applied **after** Part A is complete. The original runbook only had B.1; B.2
turned out to be required as well.

### B.1 — Request the app-audience assertion scope

**Variable:** `OPENID_SCOPE` — append the app's own exposed-API scope.

```diff
- OPENID_SCOPE=openid profile email offline_access
+ OPENID_SCOPE=openid profile email offline_access api://chat.memodo.de/323c5939-9fcf-4868-87e0-290a000be67c/access_as_user
```

> Uses the **custom Application ID URI** (`api://chat.memodo.de/<client-id>`), not the
> `api://<client-id>` default. Use whatever is set under **Expose an API** verbatim.

Adding the app's own API scope makes Entra issue, at login, an access token whose **audience is the
app** with `scp=access_as_user` — the valid OBO assertion. The id_token is unchanged (still
`aud` = the client ID), so LibreChat's own login/session authentication is unaffected.

### B.2 — Enable the On-Behalf-Of exchange for the userinfo call (the step B.1 alone was missing)

After B.1 the login access token's audience is the **app API**, not Microsoft Graph. LibreChat's
`getUserInfo` calls Microsoft's Graph-backed userinfo endpoint, which rejects that app-audience token
with a 401 challenge — the `OAUTH_WWW_AUTHENTICATE_CHALLENGE` / `[openidStrategy] getUserInfo` error
seen in `logs/error-*.log`. The fix is to have LibreChat perform an OBO exchange to a Graph token
**before** calling userinfo:

```diff
+ OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true
+ OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=User.Read
```

Prerequisite (already set in this deployment): `OPENID_REUSE_TOKENS=true`. If Entra returns a
scope-format error on this exchange, fully-qualify the scope as `https://graph.microsoft.com/User.Read`.

**Deploy + verify:**

1. Apply the `.env` change and restart the LibreChat API service.
   - *Local dev:* `.env` is a symlink to `../LibreChat/.env`; edit the real target, then
     `docker compose up -d` / restart the `LibreChat` container (bind-mounted, no image rebuild).
   - *Prod:* edit `.env.prod`, **re-`chown 1000:1000`** the file (see the prod env-chown trap note),
     then restart the api service.
2. **Every signed-in user must sign out and sign back in** — the new scope only takes effect on a
   fresh login (the old session still holds a Graph-audience token).
3. Verify (see checklist below).

> ⚠️ **Login-break risk + rollback.** Editing `OPENID_SCOPE` is the same class of change that
> previously broke sign-in in this deployment (the `offline_access` incident). Keep the previous value
> (`openid profile email offline_access`) ready; if login fails after deploy, revert `OPENID_SCOPE`,
> restart, and re-test before investigating further.

---

## Verification checklist (operator)

After Part A + Part B + a fresh login:

- [x] Sign-in still works (user can log in via "Continue with Microsoft"). **Verified 2026-07-04** —
      `[openidStrategy] login success … m.wagner@memodo.de`.
- [x] API logs show **no** `AADSTS` assertion errors and **no** `WWW-Authenticate` challenge during
      login. **Verified 2026-07-04** — the `AADSTS50013` / `AADSTS240002` rejections and the
      `OAUTH_WWW_AUTHENTICATE_CHALLENGE` userinfo errors are gone after B.1 + B.2 (last occurrence
      15:35, before the 15:47 restart; none since).
- [ ] In an agent chat, invoke a Microsoft 365 tool (e.g. "summarize my latest emails"). It returns
      real data rather than an error. — ❌ **STILL FAILING**, and **not** an Entra/OBO problem. Blocked
      by the LibreChat MCP→agent bridge; see **Part C**. (When testing, use the **"WhoAmI - Test m365"**
      agent — it is the only agent with the M365 tools attached.)
- [ ] Entra people-search returns users who have **not** previously logged into LibreChat (proves the
      Graph directory search works, not the local-DB fallback). — Not yet verified; gated on the same
      bridge issue (Part C) and code fix C.5 (RESEARCH-018 Part C).

### If a new error appears after Part A+B

This is expected progress — the assertion is now being accepted and we've hit the next layer:

- `AADSTS65001` (consent) → a Graph delegated permission is missing or not admin-consented; revisit A.2.
- A Graph **scope-format** error → LibreChat sends short scope names; the fix is code-side
  (RESEARCH-018 Part C.4 — prefix with `https://graph.microsoft.com/` or use `.default`). Report it
  to the LibreChat maintainer; no Entra change needed.

---

## Part C — M365 assistant tools still blocked: findings & solution `[ENGINEERING]`

**Status:** ❌ Open as of 2026-07-04. This is **not** an Entra or OBO problem — the auth chain
(Parts A + B) is verified working. The block is inside LibreChat.

### What actually happens

A user asks an agent e.g. "list my last 5 mails" and gets no data. The request **never reaches
Microsoft Graph or the `mcp-m365` sidecar** — so there is no `AADSTS`/Graph error to find. The agent
simply has **0 Microsoft 365 tools** available to call.

### Evidence (live prod, read-only, 2026-07-04)

- `Microsoft365` MCP server is configured `startup: false`; at boot it only does a config-parse
  "init" (`[MCP][Microsoft365] Tools: undefined`, `Initialized in 0ms`) — never a real connection.
- `db.mcpservers` has **no `Microsoft365` record** (only a stale `test` server from 2026-05-12).
  yaml-sourced MCP servers do not persist their discovered `tools` / `toolFunctions`.
- **0** `[MCP Reinitialize]` and **0** `GraphToken*` lines across the ~3-week container log buffer —
  the per-user connection + `GraphTokenService` that mints `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` never
  runs at agent runtime.
- `mcp-m365` sidecar logs are **empty** — it is never contacted.
- Of all agents, only **"WhoAmI - Test m365"** (`agent_SraD157ZDAp_pD9eQ4tVv`) has the 176 M365
  tools attached (keyed `..._mcp_Microsoft365`). Every other agent has 0 — so testing with any other
  agent fails by definition.

### Root cause

The LibreChat **v0.8.5 MCP→agent bridge** is broken for this topology, documented in
`SDD/research/RESEARCH-015`:

- **Issue A** — yaml-sourced MCP servers don't persist `toolFunctions`; `getMCPTools` returns empty
  at agent runtime (`Storing tool context: 0 tools`, `toolSchemaTokens: 0`).
- **Deeper cause** — the per-user MCP connection establishes at sign-in but flips to `disconnected`
  before agent runtime (reproduced against a non-M365 server too, so it is not M365-specific).

### Solution — upgrade / rebase the fork to LibreChat v0.8.7 `[ENGINEERING]`

This is RESEARCH-015's own #1 recommended path, and the release now exists (**v0.8.7**, 2026-06-24).
Its changelog fixes map directly onto the root causes:

- `fix: Reuse Request-Scoped MCP Connections per Run` → the connection-flip-to-`disconnected` bug.
- `fix: Paginate MCP tools/list to Load All Tools` → runtime tool definitions not loading.
- `feat: Add On-Behalf-Of (OBO) token exchange support for MCP connections` (PR #13429) → a native
  `obo:` block that may **replace** the custom `GraphTokenService` / `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`
  BYOT plumbing.
- `fix: Add Durable MCP Config Tombstones` → MCP config durability.

**Plan / caveats:**

1. This is a **fork** (`github.com/memodo/LibreChat`, branch `memodo`) with custom SPEC-014 code
   (`api/server/services/GraphTokenService.js`, patched `packages/api/src/mcp/MCPManager.ts`,
   protocol pin `2025-11-25`). The upgrade is a **rebase onto upstream v0.8.7**, not a container bump.
2. Evaluate whether native MCP `obo:` can replace the custom Graph token plumbing (fork shrinks).
3. Config schema is behind: `librechat.yaml` version **1.3.6** vs upstream ~**1.3.13** — review migration.
4. Do it on staging, then re-test the M365 agent surface **using the "WhoAmI - Test m365" agent**.
5. **Do not** modify the `mcp-m365` sidecar or the Part A/B auth config — both are verified correct.

**Fallback if not upgrading:** patch the bridge in the fork per RESEARCH-015 §Investigation-path 2
(make yaml-source tool discovery persist + resolve at runtime). Higher effort and higher long-term
maintenance than the upgrade.

---

## What is explicitly NOT the fix

- **For the auth / assertion problem (Parts A+B):** do **not** expect a LibreChat upgrade to fix it —
  the assertion's audience is determined by the Entra app + `OPENID_SCOPE`, not by the LibreChat
  version. (This was fixed via config in Part B.)
- **For the M365 *tools* problem (Part C):** the opposite — a LibreChat **upgrade to v0.8.7 is the
  recommended fix**. No `.env` / Entra change resolves the MCP→agent bridge bug on v0.8.5.
- **Do not change the M365 sidecar (`mcp-m365`) configuration** — it is verified working end-to-end
  and is downstream of the token; it is not involved in either the auth rejection or the bridge bug.
