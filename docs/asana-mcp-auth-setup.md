# Asana MCP server — authentication setup and OBO feasibility

**Date:** 2026-07-29
**Status:** Analysis complete. OAuth is the only viable mode and is specified below, ready to
execute. All three alternatives are ruled out by measurement — OBO and Auto-detect structurally, API
Key (both admin and per-user) by live probe. OBO would additionally need an external dependency that
does not yet exist (see [OBO feasibility](#obo-feasibility-what-would-be-required)).
**Scope:** Adding Asana's hosted MCP server (`https://mcp.asana.com/v2/mcp`) to MemodoAI
(`chat.memodo.de`) via the **Add MCP Server** dialog.

---

## TL;DR

| Auth mode | Verdict |
|---|---|
| **OAuth** | ✅ **Use this.** Requires an Asana OAuth app (client_id + secret) and explicit auth/token URLs. |
| None (Auto-detect) | ❌ Fails — Asana offers no Dynamic Client Registration. |
| On-Behalf-Of (OBO) | ❌ Fails — OBO is Entra-only; Asana is a third-party authorization server. |
| API Key (admin **or** per-user) | ❌ Fails — the endpoint requires an OAuth-**signed** token; Asana PATs are rejected. |

Plus one non-obvious deployment step that will otherwise silently break the connection:
[add `mcp.asana.com` to `mcpSettings.allowedDomains`](#3-add-mcpasanacom-to-mcpsettingsalloweddomains).

---

## Measured evidence

All of the following was probed live on 2026-07-29. It is recorded here so future readers do not
have to re-derive it.

### The MCP endpoint returns a Bearer challenge

```
POST https://mcp.asana.com/v2/mcp
→ HTTP/2 401
   www-authenticate: Bearer realm="Asana MCP",
     resource_metadata="https://mcp.asana.com/.well-known/oauth-protected-resource/v2"
```

### Protected resource metadata

`GET https://mcp.asana.com/.well-known/oauth-protected-resource/v2`

```json
{
  "resource": "https://mcp.asana.com/v2/mcp",
  "authorization_servers": ["https://app.asana.com"],
  "scopes_supported": ["default"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://developers.asana.com/docs/using-asanas-mcp-server",
  "resource_name": "Asana MCP"
}
```

### Authorization server metadata

`GET https://app.asana.com/.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://app.asana.com",
  "authorization_endpoint": "https://app.asana.com/-/oauth_authorize",
  "token_endpoint": "https://app.asana.com/-/oauth_token",
  "revocation_endpoint": "https://app.asana.com/-/oauth_revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer"
  ],
  "authorization_grant_profiles_supported": ["urn:ietf:params:oauth:grant-profile:id-jag"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
  "code_challenge_methods_supported": ["S256"]
}
```

`https://app.asana.com/.well-known/openid-configuration` returns **404** — there is no OIDC
discovery document, only the OAuth 2.0 AS metadata above.

### Three facts this establishes

1. **No `registration_endpoint`** → no Dynamic Client Registration. You must bring your own client.
2. **No `none` in `token_endpoint_auth_methods_supported`** → a public / PKCE-only client is not
   accepted. Asana requires a confidential client with a secret.
3. **`id-jag` is in `authorization_grant_profiles_supported`** → Asana already supports MCP
   Enterprise-Managed Authorization. This is the basis of the OBO analysis further down.

---

## Why the other three modes fail

### On-Behalf-Of (OBO)

OBO in this fork is **specifically the Entra ID OBO grant**, not a generic delegation feature:

- `api/server/services/OboTokenService.js:144` calls `getOpenIdConfig()` — *your* Entra tenant's
  OIDC configuration.
- Line 68 issues `client.genericGrantRequest(config, 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  { scope })`.

The resulting token is therefore minted **by Entra**, **for an audience registered in your Entra
tenant**. That is why the dialog's placeholder is `api://<client-id>/Mcp.Tools.ReadWrite` — the
shape of an Entra-exposed API scope.

Asana's authorization server is `https://app.asana.com`, which has no trust relationship with the
Memodo Entra tenant. An Entra-issued token would be rejected, and in practice Entra would refuse to
issue one at all (no app registration exposes an Asana audience) — surfacing as an `AADSTS` scope
error, which misleadingly points at Entra rather than at the configuration mistake.

OBO exists in this fork for exactly one case: the `mcp-m365` sidecar (SPEC-014), where the
downstream API genuinely *is* registered in our own tenant.

### None (Auto-detect)

Auto-detect correctly *discovers* that OAuth is required (`detectOAuthRequirement` reads the
`WWW-Authenticate` challenge and the resource metadata). It then attempts Dynamic Client
Registration via `registerClient()` (`packages/api/src/mcp/oauth/handler.ts:468`). Asana publishes
no `registration_endpoint`, so LibreChat falls back to guessing `https://app.asana.com/register`
(`handler.ts:268`), which does not exist. Combined with the absence of `none` as a token-endpoint
auth method, there is no credential-free path.

### API Key — including "Each user provides their own key"

**Ruled out by measurement on 2026-07-29.** Asana Personal Access Tokens (PATs) work against the
Asana REST API, but the MCP v2 endpoint rejects them. Sending any non-OAuth Bearer token returns:

```
HTTP/2 401
www-authenticate: Bearer realm="Asana MCP",
  resource_metadata="https://mcp.asana.com/.well-known/oauth-protected-resource/v2",
  error="invalid_token",
  error_description="Invalid token signature - token was not issued by Asana OAuth"
```

The operative words are **"Invalid token signature"** and **"not issued by Asana OAuth"**: the
resource server cryptographically validates the bearer token against Asana's OAuth signing keys. An
Asana PAT is an opaque credential minted in user account settings — not a signed artifact of the
OAuth authorization server — so it cannot satisfy that check.

Tested with two token shapes to rule out a format-dependent code branch:

| Probe token | Result |
|---|---|
| `Bearer 0/invalid-pat-shaped-token-probe` | `invalid_token` — "not issued by Asana OAuth" |
| `Bearer 1/1201234567890123:abcdef…` (realistic PAT format) | `invalid_token` — identical error |

Both realistic PAT shapes take the same signature-validation path, so there is no separate PAT
lookup branch to fall into. Residual caveat: this was not tested with a genuine live PAT, but a real
PAT would have to be a validly signed OAuth token to pass, which PATs are not by construction.

**This eliminates API Key mode entirely — both the admin-provided and the per-user variants.** The
`source: 'user'` toggle only changes *who supplies* the credential
(`packages/data-provider/src/mcp.ts:199-214`); it does not change how Asana validates it. With no
credential type available other than an OAuth-issued token, the choice collapses to
[OAuth](#oauth-setup-procedure).

#### For reference: what per-user API keys do on other MCP servers

The mechanism is sound and worth reusing where a server *does* accept static keys. Per
`packages/data-provider/src/mcp.ts:199-230`:

- `apiKey.source: 'admin'` — one key, stored encrypted, shared by every user.
- `apiKey.source: 'user'` — each user supplies their own key via `customUserVars`, which renders a
  masked per-user input (`sensitive` defaults to masked; set `false` for non-secret setup values such
  as a username or base URL).
- `apiKey.authorization_type` (`bearer` / `basic` / `custom`) controls header formatting, with
  `custom_header` naming the header when set to `custom`.

Prefer `source: 'user'` for any per-seat SaaS credential: a single admin key makes every MemodoAI
user act as one shared upstream identity, which destroys attribution and audit trails on the
upstream side.

---

## OAuth setup procedure

### 1. Register an OAuth app in Asana

Asana developer console → <https://app.asana.com/0/my-apps> → create app → OAuth. Redirect URI:

```
https://chat.memodo.de/api/mcp/Asana/oauth/callback
```

The pattern comes from
`client/src/components/SidePanel/MCPBuilder/MCPServerDialog/sections/AuthSection.tsx:45-47`:

```ts
const redirectUri = serverName
  ? `${window.location.origin}/api/mcp/${serverName}/oauth/callback`
  : '';
```

`serverName` is the **Name** field typed into the dialog (`Asana`). Note the value is interpolated
without `encodeURIComponent`, so keep server names free of characters needing escaping.

**Register the URI in Asana before creating the LibreChat entry.** LibreChat only renders this field
in *edit* mode (the `isEditMode && redirectUri` guard at `AuthSection.tsx:269`), so otherwise you
must create the server, reopen it, copy the URI, and only then can the flow succeed.

### 2. Fill the Add MCP Server dialog

| Field | Value |
|---|---|
| Name | `Asana` |
| MCP Server URL | `https://mcp.asana.com/v2/mcp` |
| Transport | Streamable HTTPS |
| Authentication | **OAuth** |
| Client ID | *(from the Asana app)* |
| Client Secret | *(from the Asana app)* |
| Auth URL | `https://app.asana.com/-/oauth_authorize` |
| Token URL | `https://app.asana.com/-/oauth_token` |
| Scope | `default` |
| I trust this application | ✅ (required) |

Transport note: Streamable HTTPS is correct for `/v2/mcp`. Asana's older `/sse` endpoint is the SSE
one.

**Both URLs are mandatory once a secret is supplied — not optional.** The schema at
`packages/data-provider/src/mcp.ts:22` rejects `client_id` + `client_secret` without both
`authorization_url` and `token_url`:

> `OAuth client_secret with client_id requires both authorization_url and token_url`

and `handler.ts:394` logs the matching refusal:

> `OAuth client_secret requires both oauth.authorization_url and oauth.token_url; refusing to use it
> with auto-discovered OAuth endpoints.`

This is a deliberate anti-secret-leak pin: a stored secret must never be transmitted to an endpoint
that an MCP server advertised at runtime, since a compromised or malicious server could otherwise
harvest it.

`scope: default` comes from `scopes_supported` in the protected resource metadata above.

### 3. Add `mcp.asana.com` to `mcpSettings.allowedDomains`

**This is the step most likely to cause a confusing failure.** `librechat.yaml:108-115` currently
reads:

```yaml
mcpSettings:
  allowedDomains:
    - 'docs.mcp.cloudflare.com'
    - 'mcp-m365'
```

A **non-empty** list is a strict allowlist, not a hint — `isDomainAllowedCore`
(`packages/api/src/auth/domain.ts:325-360`) iterates the entries and returns `false` on no match.
Add:

```yaml
    - 'mcp.asana.com'
```

**Failure mode without it:** the server **saves successfully** (the create controller
`api/server/controllers/mcp.js` performs no domain validation), then fails at *connect* time inside
`UserConnectionManager.assertResolvedRuntimeConfigAllowed`
(`packages/api/src/mcp/UserConnectionManager.ts:471`). The visible symptom is "no tools" or a
connection failure — not a validation error in the dialog — which sends you debugging the Asana
credentials instead of the allowlist.

**`app.asana.com` does *not* need to be added.** `validateOAuthUrl`
(`handler.ts:1051-1081`) does not throw when a URL is outside the allowlist; it falls through to the
SSRF checks (`isSSRFTarget`, `resolveHostnameSSRF`), which a public host passes. The allowlist only
governs whether the SSRF-safe dispatcher is bypassed (`hardenedFetch.ts:14-20`). Adding
`app.asana.com` would be harmless but would dilute the allowlist's meaning, so it is deliberately
omitted.

Related: the allowlist is resolved through `MCPServersRegistry.resolveAllowlists()`, which consults
an optional `allowlistResolver`. **No resolver is wired in this deployment** (no call sites outside
`MCPServersRegistry.ts` itself), so the effective allowlist is exactly the `librechat.yaml` value.

### 4. Deploy

Config-only change → the light path from `CLAUDE.md`'s deploy table:

```
git push
# on prod:
git pull
./prod.sh restart api
```

No `npm run build` / `prod-sync.sh` — no workspace with a bind-mounted `dist/` is touched.

### 5. Per-user consent

OAuth tokens are stored per user. Every person who wants Asana tools completes the Asana consent
screen once themselves. This cannot be pre-provisioned by an admin (unlike an admin-supplied API
key), which is the correct security posture — each user's Asana permissions remain their own — but
it does mean a one-time click per user.

---

## OBO feasibility: what would be required

Asana advertises `urn:ietf:params:oauth:grant-profile:id-jag`, so the silent, IdP-mediated,
no-consent-screen flow that OBO *conceptually* provides does exist on Asana's side. It is
**Enterprise-Managed Authorization (EMA)** — the MCP extension
`io.modelcontextprotocol/enterprise-managed-authorization`, built on **ID-JAG** (Identity Assertion
JWT Authorization Grant, marketed as Cross-App Access / XAA). EMA reached stable status
2026-06-18, with Asana among the launch-supported servers.

It is not reachable by configuration. Below is the full gap.

### The protocol gap: our OBO is one hop, EMA is two

Current implementation (`packages/api/src/mcp/oauth/obo.ts:140-210`):

1. Take the user's Entra **access token** (`extractOpenIDTokenInfo(user)`).
2. Pass it to `oboTokenResolver` → `exchangeOboToken` → `OboTokenService.performOboExchange`, which
   issues `jwt-bearer` with only `scope` against **our own tenant**.
3. Return `{ access_token, token_type: 'Bearer' }`, which the connection layer writes directly to
   the wire: `headers['Authorization'] = Bearer ${...}` (`connection.ts:1611`, `:1714`).

One exchange, one issuer.

EMA requires two:

| | Hop 1 — at our IdP | Hop 2 — at Asana |
|---|---|---|
| Endpoint | Entra token endpoint | `https://app.asana.com/-/oauth_token` |
| Input | the user's **ID token** (identity assertion) | the ID-JAG from hop 1 |
| Grant | RFC 8693 token exchange, `requested_token_type=...:token-type:id-jag`, `resource=https://mcp.asana.com/v2/mcp` | `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion=<ID-JAG>` |
| Client auth | our Entra client | an **Asana** client_id + secret |
| Output | short-lived, audience-bound ID-JAG | an **Asana** access token |

The decisive structural difference: **the token that lands in the Authorization header is minted by
Asana, not by Entra.** Our resolver's return value goes straight onto the wire — there is no concept
of a second exchange against a third-party token endpoint.

Note what EMA does *not* remove: a registered Asana OAuth client with a secret is still required for
hop 2. EMA eliminates the per-user **consent screen** and centralizes policy; it does not eliminate
client registration.

### Prerequisite 1 (blocker): Entra must be able to *issue* ID-JAG

**Unconfirmed as of 2026-07-29.** Verify before doing anything else — if Entra cannot issue the
assertion, none of the code work has anywhere to go.

- **Confirmed issuers:** Okta (reference XAA implementation, first supported IdP at EMA launch),
  Auth0, Keycloak; writeups from WorkOS and Descope.
- **Entra:** Microsoft is engaged with EMA, but all findings are on the **resource-server** side —
  App Service protecting *our own* MCP servers with Entra auth (preview), Entra Agent ID (GA), and
  Microsoft describing the EMA flow. The MCP spec page names "Okta, Azure AD, or a corporate SSO
  system" as example IdPs, but that is illustrative, not evidence that Entra ships the issuer half.
- No confirmation found that Entra issues an ID-JAG scoped to a third-party resource such as
  `https://mcp.asana.com/v2/mcp`.

Treat as "unverified, plausibly in preview." Check the Entra release notes and the
XAA / cross-app-access section of the Entra docs.

### Prerequisite 2: Asana-side federation

An Asana admin (Enterprise / Enterprise+ tier) must register LibreChat as a requesting app for
Cross-App Access and federate our Entra tenant, so Asana's authorization server validates ID-JAGs
signed by our tenant's JWKS.

Account linking: Asana maps the ID-JAG `sub` claim (primary, stable identifier) and falls back to
`email` for accounts predating federation. Memodo Entra identities and Asana accounts share the
`@memodo.de` domain, so this should line up — but any user whose Asana account uses a different
address will not link.

### Prerequisite 3: Entra policy configuration

Which users/groups may reach the Asana MCP server, expressed as Entra policy. This is the actual
payoff: central grant/revoke, conditional-access enforcement, and an audit trail, instead of
per-user consent and per-user, per-service revocation.

### Code changes required in this fork

Verified 2026-07-29: the tree has **zero** ID-JAG or EMA support. `rg` for `id-jag`,
`token-type:id`, `clientCapabilities`, and `enterprise-managed` across `packages/api/src` returns
nothing.

1. **`OboOptionsSchema`** — `packages/data-provider/src/mcp.ts:152-155` is exactly
   `{ scopes: z.string().min(1) }`. Needs a `resource` (hop-1 audience) plus hop-2 `token_url`,
   `client_id`, `client_secret`. This makes the OBO config largely subsume the OAuth config's
   confidential-client fields, so a **mode discriminator** (`entra-obo` vs `id-jag`) is also
   required — `mcp-m365` must retain the existing single-hop behavior untouched.

2. **`OboTokenResolver` type** — `obo.ts:15-20` is
   `(user, accessToken, scopes, fromCache?) => { access_token, expires_in?, expires_at? }`. No
   resource/audience parameter, and no way to express "return an assertion, not a usable access
   token." Widening it ripples through `packages/api/src/mcp/types/index.ts`,
   `MCPConnectionFactory.ts`, `MCPManager.ts`, and all three injection sites
   (`api/server/services/MCP.js:844`, `api/server/services/Tools/mcp.js:153` and `:190`).

3. **`OboTokenService.js`** — `performOboExchange` hardcodes `jwt-bearer` with only `scope`. Needs a
   second path emitting RFC 8693 parameters (`subject_token`, `subject_token_type`,
   `requested_token_type`, `resource`). Its cache key is `${user.openidId}:${scopes}` (line 149) —
   fold the resource in, or two different downstream resources sharing a scope string collide.

4. **A new second-hop module** — nothing today POSTs an assertion to a *third-party* token endpoint.
   It should reuse `hardenedFetch.ts` / `createOAuthFetch` and `validateOAuthUrl` so Asana's token
   endpoint receives the same SSRF and allowlist treatment as the OAuth path, and reuse the existing
   encrypted-credential storage for the Asana client secret rather than inventing new storage.

5. **Token lifetime and refresh — highest risk.** The comment at `obo.ts:174-178` is explicit:
   *"OBO tokens are baked into the transport with no in-place refresh,"* which is why
   `OBO_REFRESH_SKEW_MS` (5 min, `obo.ts:121`) forces a fresh exchange up front via
   `isOboResponseNearExpiry`. With two hops the governing
   lifetime is the **Asana** token's, not the Entra assertion's. Keying the skew off the wrong one
   produces a connection that 401s mid-session and re-triggers auth — the same spurious re-auth loop
   class already hit and fixed in `6631a4f7a`.

6. **Client capability declaration** — EMA requires advertising the extension in per-request
   `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`. That is a change in the MCP
   **request** path, not just auth config; the fork does not touch that area today.

7. **UI + permissions** — new fields in `AuthSection.tsx`, new `client/src/locales/en/translation.json`
   keys, and `CONFIGURE_OBO` gating extended to cover them (including the edit-mode read-only
   carve-out at `AuthSection.tsx:59-60`).

**Meta-cost:** items 2, 4, and 6 land in the MCP auth core. `docs/fork-upstream-divergences.md`
already tracks fork-local patches to upstream MCP files needing re-checking on every upstream merge,
with no CI on the merge path. This would materially deepen that divergence in the area that is
already most fragile.

### Cheaper alternative: an `mcp-asana` sidecar

Reuse the SPEC-014 `mcp-m365` pattern. Register a sidecar as an Entra API exposing e.g.
`Mcp.Tools.ReadWrite`; **the existing OBO code then works unchanged**, because the downstream
genuinely is an Entra-registered API in our tenant. The sidecar owns the Asana side however it
likes — its own per-user OAuth, or the ID-JAG exchange internally once Entra supports it.

- **Trade-off:** the sidecar still needs a per-user Asana token from somewhere, so it *defers* the
  consent problem rather than solving it — unless it performs the ID-JAG exchange itself, which
  reintroduces prerequisites 1–3 behind a boundary we control. A single Asana service account would
  eliminate consent but destroy per-user attribution in Asana; treat that as disqualifying.
- **Gain:** all EMA churn lives in a service we own; LibreChat's auth core stays untouched.
- **Cost:** another container to operate, monitor, and back up.

### Recommendation

**Ship plain OAuth; do not build EMA yet.**

1. **The blocker is external.** Until Entra issues ID-JAG for third-party resources, none of the
   seven code changes can be tested end-to-end. Building against an unconfirmed IdP capability is
   speculative.
2. **Upstream will likely implement EMA natively.** The extension went stable in June 2026;
   Asana/Atlassian/Linear already support it; LibreChat tracks the MCP spec closely. A fork-local
   implementation in the MCP auth core means maintaining a large divergence in the most
   merge-fragile area against an upstream that will probably ship the same thing.

The cost of waiting is one Asana consent click per user, once — small next to owning items 1–7
across an unknown number of upstream merges.

**Watch for:** Entra release notes announcing ID-JAG / XAA issuance, and upstream LibreChat adding
EMA extension support. When both land this becomes a config change plus a version bump. If per-user
consent becomes a real adoption blocker first, the sidecar is the escape hatch — and that point
warrants an ADR, since it is a cross-cutting decision about where third-party identity brokering
lives.

---

## References

### Code touchpoints

| Path | Relevance |
|---|---|
| `client/src/components/SidePanel/MCPBuilder/MCPServerDialog/sections/AuthSection.tsx` | Auth-mode radio, OAuth/OBO fields, redirect-URI formula (`:45-47`), OBO permission gating (`:59-60`) |
| `packages/data-provider/src/mcp.ts:5-27, 152-155` | `validateOAuthClientCredentials`, `OboOptionsSchema` |
| `packages/api/src/mcp/oauth/handler.ts` | DCR (`:468`), metadata fallback (`:268`), secret pinning (`:394`), config URL validation (`:520-530`), `validateOAuthUrl` (`:1051-1081`) |
| `packages/api/src/mcp/oauth/detectOAuth.ts` | RFC 9728 OAuth requirement detection |
| `packages/api/src/mcp/oauth/obo.ts:15, 121, 140, 174-178` | `OboTokenResolver` type, `OBO_REFRESH_SKEW_MS`, `resolveOboToken`, no-in-place-refresh note; `isOboConfigStillTrusted` below |
| `api/server/services/OboTokenService.js:66-105, 144` | Entra OBO exchange; cache key at `:149` |
| `packages/api/src/auth/domain.ts:295-360, 421-445, 459-525` | `isDomainAllowedCore`, `isMCPDomainAllowed`, `isOAuthUrlAllowed` |
| `packages/api/src/mcp/UserConnectionManager.ts:461-489` | Connect-time allowlist enforcement |
| `packages/api/src/mcp/registry/MCPServersRegistry.ts:233-257` | `resolveAllowlists` (no resolver wired in this deployment) |
| `packages/api/src/mcp/oauth/hardenedFetch.ts:14-20` | Allowlist-driven SSRF dispatcher bypass |
| `librechat.yaml:108-115` | `mcpSettings.allowedDomains` |

### External

- [Asana MCP server docs](https://developers.asana.com/docs/using-asanas-mcp-server)
- [Enterprise-Managed Authorization — Model Context Protocol](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [Enterprise-Managed Authorization: Zero-touch OAuth for MCP — MCP Blog](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/)
- [Identity Assertion JWT Authorization Grant (IETF draft)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-identity-assertion-authz-grant)
- [Cross-App Access — OAuth.net](https://oauth.net/cross-app-access/)
- [MCP Enterprise Authorization Goes Stable (2026-06-19)](https://www.techtimes.com/articles/318708/20260619/mcp-enterprise-authorization-goes-stable-zero-touch-sso-okta-anthropic-vs-code.htm)
- [Enterprise-Managed Authorization for Rovo MCP with XAA and ID-JAG — Atlassian](https://www.atlassian.com/blog/development/enterprise-managed-authorization-rovo-mcp-xaa-id-jag)
- [Cross App Access (XAA) — Auth0 Docs](https://auth0.com/docs/secure/call-apis-on-users-behalf/xaa)
- [MCP Enterprise Authorization Is Here — Microsoft](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-enterprise-authorization-is-here-%E2%80%94-what-entra-and-app-service-can-do-today/4537433)
- [Microsoft Entra releases and announcements](https://learn.microsoft.com/en-us/entra/fundamentals/whats-new)

### Related internal docs

- `docs/m365-mcp-features.md`, `docs/m365-obo-entra-admin-runbook.md` — the working Entra OBO case
- `SDD/requirements/SPEC-014-m365-mcp-integration.md` — `mcp-m365` sidecar pattern, `allowedDomains`
  extension precedent (REQ-005)
- `docs/fork-upstream-divergences.md` — fork hooks into upstream MCP files
