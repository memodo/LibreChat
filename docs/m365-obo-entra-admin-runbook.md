# M365 / Microsoft Graph On-Behalf-Of — Entra Admin Runbook

**Audience:** Microsoft Entra ID (Azure AD) administrator with Global Administrator or
Application Administrator + Privileged Role Administrator rights on the app below.
**Goal:** Make LibreChat's On-Behalf-Of (OBO) token exchange to Microsoft Graph succeed, so the
Microsoft 365 assistant tools and the Entra people-search both work.
**Time:** ~15 minutes in the portal + one config change + a re-login.
**Background (for context):** `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.

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

## Part B — LibreChat configuration change `[CONFIG]` (operator, after Part A)

This is a one-line environment change in LibreChat's `.env`, applied **after** Part A is complete.

**Variable:** `OPENID_SCOPE`

```diff
- OPENID_SCOPE=openid profile email offline_access
+ OPENID_SCOPE=openid profile email offline_access api://323c5939-9fcf-4868-87e0-290a000be67c/access_as_user
```

Adding the app's own API scope makes Entra issue, at login, an access token whose **audience is the
app** (`api://323c5939-…`) with `scp=access_as_user` — the valid OBO assertion. The id_token is
unchanged (still `aud` = the client ID), so LibreChat's own login/session authentication is
unaffected.

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

- [ ] Sign-in still works (user can log in via "Continue with Microsoft").
- [ ] In an agent chat, invoke a Microsoft 365 tool (e.g. "summarize my latest emails"). It returns
      real data rather than an error.
- [ ] API logs show **no** `AADSTS` errors during the tool call:
      `docker logs LibreChat --since 15m | grep -iE "OBO|AADSTS"` — expect an OBO success
      ("Cached fresh Graph token" / no rejection), not `AADSTS50013` / `AADSTS240002`.
- [ ] Entra people-search returns users who have **not** previously logged into LibreChat (proves the
      Graph directory search works, not the local-DB fallback). *Depends on code fix C.5 also being
      deployed — see RESEARCH-018 Part C.*

### If a new error appears after Part A+B

This is expected progress — the assertion is now being accepted and we've hit the next layer:

- `AADSTS65001` (consent) → a Graph delegated permission is missing or not admin-consented; revisit A.2.
- A Graph **scope-format** error → LibreChat sends short scope names; the fix is code-side
  (RESEARCH-018 Part C.4 — prefix with `https://graph.microsoft.com/` or use `.default`). Report it
  to the LibreChat maintainer; no Entra change needed.

---

## What is explicitly NOT the fix

- **Do not upgrade LibreChat** expecting it to resolve this — the assertion's audience is determined
  by the Entra app + `OPENID_SCOPE`, not by the LibreChat version.
- **Do not change the M365 sidecar (`mcp-m365`) configuration** — it is downstream of the token and
  is not involved in the rejection.
