# RESEARCH-006-microsoft-entra-sso

## Research Question

How can we enable single sign-on (SSO) via Microsoft Entra ID (formerly Azure AD) for our LibreChat deployment?

## Executive Summary

**LibreChat already has full, built-in support for Microsoft Entra SSO via OpenID Connect.** No code changes are required. This is a configuration-only task involving:

1. Creating an App Registration in the Azure/Entra portal
2. Setting environment variables in `.env`
3. Adding `'openid'` to the `socialLogins` array in `librechat.yaml`

LibreChat uses the `openid-client` v6.5+ npm package (by panva) with a custom Passport.js strategy that includes Azure-specific features: group overage handling via Microsoft Graph, On-Behalf-Of token exchange, and Entra group-to-role mapping.

---

## System Data Flow

### Authentication Flow (OpenID Connect / Entra)

```
User clicks "Login with [Entra]" button
  → Frontend redirects to /oauth/openid
  → api/server/routes/oauth.js (line ~94): Passport authenticate('openid')
  → api/strategies/openidStrategy.js: CustomOpenIDStrategy
    → Redirects to https://login.microsoftonline.com/<TENANT>/v2.0/authorize
    → User authenticates with Entra (MFA if configured)
    → Entra redirects to /oauth/openid/callback
  → api/server/routes/oauth.js (line ~109): Callback handler
  → api/strategies/openidStrategy.js: processOpenIDAuth() (lines 330-690)
    → Validates tokens, extracts claims
    → Resolves email (email → preferred_username → upn fallback)
    → Checks required roles (if OPENID_REQUIRED_ROLE set)
    → Handles Azure group overage via Graph API OBO flow (lines 350-420)
    → Creates or updates user in MongoDB
    → Assigns admin role if claim matches (lines 607-650)
  → api/server/controllers/auth/oauth.js (line ~24): oauthHandler
    → Calls syncUserEntraGroupMemberships() if token reuse enabled
    → Sets JWT auth tokens (HTTP-only cookies)
    → Redirects to client app
```

### Key Entry Points

| Step | File | Lines |
|------|------|-------|
| OAuth route init | `api/server/routes/oauth.js` | 94-111 |
| Strategy setup | `api/server/socialLogins.js` | 23-52 |
| OpenID strategy | `api/strategies/openidStrategy.js` | 1-855 |
| OpenID JWT strategy | `api/strategies/openIdJwtStrategy.js` | 1-80 |
| OAuth callback handler | `api/server/controllers/auth/oauth.js` | 24-75 |
| Config endpoint | `api/server/routes/config.js` | 46-50 |
| Frontend social buttons | `client/src/components/Auth/SocialLoginRender.tsx` | 84-100 |
| Frontend login page | `client/src/components/Auth/Login.tsx` | 1-129 |

### External Dependencies

- **Microsoft Entra ID** (identity provider): OpenID Connect discovery, token issuance, JWKS
- **Microsoft Graph API** (optional): Group overage resolution, people search
- **openid-client** npm package (v6.5+): OIDC client library
- **MongoDB**: User storage and session management

### Integration Points

- **MCP Token Placeholder**: `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` in `packages/api/src/utils/oidc.ts` — passes user's Graph token to MCP servers
- **SharePoint File Picker**: Requires Entra SSO as prerequisite (`ENABLE_SHAREPOINT_FILEPICKER`)
- **Entra People Search**: `USE_ENTRA_ID_FOR_PEOPLE_SEARCH` for mention autocomplete
- **Permission Service**: `syncUserEntraGroupMemberships()` in `api/server/services/PermissionService.js` (line 475)
- **Graph API Service**: `api/server/services/GraphApiService.js` — client for Microsoft Graph

---

## What Is Required: Configuration Steps

### Step 1: Azure Portal — App Registration

1. Go to **Azure Portal > Entra ID > App registrations > New registration**
2. **Name**: e.g., "LibreChat SSO" or "MemodoAI Chat"
3. **Supported account types**: Single tenant (your org only)
4. **Redirect URI**: Platform = "Web", URI = `https://<YOUR_DOMAIN>/oauth/openid/callback`
5. Under **Certificates & secrets** > New client secret — copy the **Value** (not Secret ID)
6. Under **API permissions** > Add: `openid`, `profile`, `email` (delegated, Microsoft Graph)
7. Note the **Application (client) ID** and **Directory (tenant) ID** from Overview page

Optional permissions (for group-based access control):
- `GroupMember.Read.All` (delegated) — needed if using `OPENID_REQUIRED_ROLE` with group IDs
- `User.Read` (delegated) — for user info via Graph
- `People.Read` (delegated) — for people search feature

Optional token configuration:
- Under **Token configuration** > Add groups claim > Select "Security groups" — emits group IDs in ID token
- For orgs with >150 groups, LibreChat automatically handles "overage" by calling Graph API

### Step 2: Environment Variables (.env)

**Required variables:**

```env
DOMAIN_CLIENT=https://your-domain.com
DOMAIN_SERVER=https://your-domain.com

OPENID_CLIENT_ID=<Application (client) ID from Azure>
OPENID_CLIENT_SECRET=<Client secret Value from Azure>
OPENID_ISSUER=https://login.microsoftonline.com/<TENANT_ID>/v2.0/
OPENID_SESSION_SECRET=<generate a random string>
OPENID_SCOPE=openid profile email
OPENID_CALLBACK_URL=/oauth/openid/callback
```

**Recommended optional variables:**

```env
# Custom button appearance
OPENID_BUTTON_LABEL=Continue with Microsoft
OPENID_IMAGE_URL=<URL to Microsoft icon>

# Skip login form, go straight to Entra
OPENID_AUTO_REDIRECT=false

# Claim mapping (defaults usually work for Entra)
OPENID_EMAIL_CLAIM=email
OPENID_USERNAME_CLAIM=preferred_username
```

**For role-based access control (restrict who can log in):**

```env
# Require user to be member of specific Entra group(s)
OPENID_REQUIRED_ROLE=<group-id-1>,<group-id-2>
OPENID_REQUIRED_ROLE_TOKEN_KIND=id
OPENID_REQUIRED_ROLE_PARAMETER_PATH=groups
```

**For admin role mapping:**

```env
OPENID_ADMIN_ROLE=<admin-group-id>
OPENID_ADMIN_ROLE_TOKEN_KIND=id
OPENID_ADMIN_ROLE_PARAMETER_PATH=groups
```

**For Graph API integration (needed for M365 MCP, SharePoint, people search):**

```env
OPENID_REUSE_TOKENS=true
OPENID_GRAPH_SCOPES=User.Read,People.Read,GroupMember.Read.All
OPENID_ON_BEHALF_FLOW_FOR_USERINFO_REQUIRED=true
OPENID_ON_BEHALF_FLOW_USERINFO_SCOPE=user.read
```

### Step 3: librechat.yaml

Ensure `openid` is listed in social logins:

```yaml
registration:
  socialLogins:
    - openid
```

### Step 4: Restart

Restart LibreChat (or `docker-compose up -d --force-recreate`). The OpenID login button should appear on the login page.

---

## Stakeholder Mental Models

- **Product Team perspective**: SSO is a standard enterprise requirement. Enables seamless login for all org users without separate account creation. Pairs well with existing M365 integration plans (RESEARCH-005).

- **Engineering Team perspective**: Zero code changes needed — this is purely configuration. The OpenID Connect implementation is mature with Azure-specific features already built in (group overage, OBO flow, Graph integration). Complexity lies in Azure portal setup and env var configuration.

- **Support Team perspective**: Common issues include: (1) `.env` values wrapped in quotes causing parse errors, (2) session errors from MFA enforcement, (3) SSL/proxy misconfiguration where `DOMAIN_SERVER` doesn't match the external URL, (4) multi-instance deployments needing Redis for session sharing.

- **User perspective**: Single "Continue with Microsoft" button on login page. If `OPENID_AUTO_REDIRECT=true`, users skip the login page entirely and go straight to Entra authentication.

---

## Production Edge Cases

### Historical Issues (from GitHub)

| Issue | Problem | Resolution |
|-------|---------|------------|
| [#4309](https://github.com/danny-avila/LibreChat/issues/4309) | Entra config questions | Documentation walkthrough |
| [#3249](https://github.com/danny-avila/LibreChat/issues/3249) | 500 error on SSO redirect | Misconfigured redirect URI or secret |
| [Discussion #4219](https://github.com/danny-avila/LibreChat/discussions/4219) | Azure AD login error | Configuration troubleshooting |
| [Discussion #1387](https://github.com/danny-avila/LibreChat/discussions/1387) | Azure SSO with Nginx | Proxy/SSL certificate issues |
| [Discussion #2212](https://github.com/danny-avila/LibreChat/discussions/2212) | OpenID AzureAD errors | Various error patterns |
| [Discussion #3087](https://github.com/danny-avila/LibreChat/discussions/3087) | OpenID not working v0.7.3 | Session/MFA-related failures |

### Common Pitfalls

1. **Do NOT wrap `.env` values in quotes** — use `OPENID_SCOPE=openid profile email`, not `"openid profile email"`
2. **Session errors** ("did not find expected authorization request details in session") — often caused by Azure Default Security MFA enforcement or missing Redis in multi-instance deploys
3. **SSL/proxy issues** — `DOMAIN_SERVER` must match the externally accessible URL (what users see in browser), not the internal container address
4. **User identity collision** — configure `OPENID_USERNAME_CLAIM` and `OPENID_EMAIL_CLAIM` explicitly if defaults don't match your Entra token claims
5. **Group overage** — organizations with >150 security groups will hit token size limits; LibreChat handles this automatically via OBO flow to Graph API, but requires `GroupMember.Read.All` permission

---

## Files That Matter

### Core Logic

| File | Purpose |
|------|---------|
| `api/strategies/openidStrategy.js` | Full OIDC strategy (855 lines), Azure-specific features |
| `api/strategies/openIdJwtStrategy.js` | JWT bearer token validation for API access |
| `api/server/socialLogins.js` | Strategy initialization, env var checks |
| `api/server/controllers/auth/oauth.js` | Callback handler, token setting, Entra group sync |
| `api/server/services/GraphApiService.js` | Microsoft Graph API client |
| `api/server/services/PermissionService.js` | Entra group → LibreChat role sync (line 475) |

### Frontend

| File | Purpose |
|------|---------|
| `client/src/components/Auth/SocialLoginRender.tsx` | Renders OpenID button (lines 84-100) |
| `client/src/components/Auth/Login.tsx` | Login page with auto-redirect logic |
| `client/src/components/Auth/SocialButton.tsx` | Generic OAuth button component |

### Configuration

| File | Purpose |
|------|---------|
| `.env` / `.env.example` | All OPENID_* variables (lines 502-603) |
| `librechat.yaml` | `registration.socialLogins` array |
| `api/server/routes/config.js` | Backend config endpoint (lines 46-50: OpenID validation) |

### Tests

| File | Purpose |
|------|---------|
| Need to check for existing OpenID strategy tests | Coverage gaps TBD |

---

## Security Considerations

- **Authentication/Authorization**: Uses standard OAuth 2.0 Authorization Code flow (not implicit grant). PKCE available via `OPENID_USE_PKCE=true`. JWT tokens validated against Entra JWKS endpoint with configurable clock tolerance (default 300s).

- **Data Privacy**: Only standard OIDC claims requested by default (`openid profile email`). Graph API scopes should be minimized to what's needed. Token reuse (`OPENID_REUSE_TOKENS`) stores access/refresh tokens — ensure database encryption at rest.

- **Input Validation**: Claims are validated by the `openid-client` library. Email fallback chain (`email → preferred_username → upn`) handles Entra's varying claim availability. Username sanitization via `convertToUsername()` in strategy.

- **Session Security**: `OPENID_SESSION_SECRET` encrypts session data. For multi-instance deployments, Redis is required for session sharing (or use sticky sessions).

- **Logout**: `OPENID_USE_END_SESSION_ENDPOINT=true` enables federated logout (signs out of both LibreChat and Entra). `OPENID_POST_LOGOUT_REDIRECT_URI` controls where users land after logout.

---

## Testing Strategy

- **Manual testing**: Create test app registration in Azure, configure `.env`, verify login flow end-to-end
- **Edge cases to test**:
  - User with MFA enabled
  - User not in required group (should be denied)
  - User in admin group (should get admin role)
  - Token refresh after expiry
  - Logout flow (federated vs local-only)
  - Auto-redirect behavior
  - Multiple concurrent sessions
- **No automated tests are practical** for this — it's external IdP configuration, not code changes

---

## Documentation Needs

- **User-facing**: Internal guide for org users explaining "Click Continue with Microsoft to log in"
- **Admin docs**: Step-by-step Azure portal setup guide with screenshots
- **Configuration docs**: Reference for all OPENID_* env vars and their Entra-specific values

---

## Relationship to RESEARCH-005 (M365 MCP Integration)

Entra SSO is a **prerequisite** for the M365 MCP integration researched in RESEARCH-005:
- `OPENID_REUSE_TOKENS=true` enables the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder
- Graph API scopes requested during SSO login become available to MCP servers
- SharePoint file picker requires Entra authentication

Enabling SSO first provides the authentication foundation for the broader M365 integration.

---

## Decision Points

1. **Single tenant vs multi-tenant?** — Single tenant recommended for enterprise SSO
2. **Auto-redirect?** — If Entra is the only auth method, set `OPENID_AUTO_REDIRECT=true` to skip login page
3. **Role-based access?** — Restrict login to specific Entra security groups?
4. **Admin mapping?** — Auto-assign LibreChat admin role based on Entra group membership?
5. **Disable local login?** — If SSO is mandatory, consider disabling email/password registration
6. **Token reuse?** — Enable `OPENID_REUSE_TOKENS=true` if planning M365 MCP integration (RESEARCH-005)
7. **Federated logout?** — Should logging out of LibreChat also sign out of Microsoft?

---

## References

- [Azure Entra | LibreChat Docs](https://www.librechat.ai/docs/configuration/authentication/OAuth2-OIDC/azure)
- [OAuth2/OIDC Overview | LibreChat Docs](https://www.librechat.ai/docs/configuration/authentication/OAuth2-OIDC)
- [Token Reuse | LibreChat Docs](https://www.librechat.ai/docs/configuration/authentication/OAuth2-OIDC/token-reuse)
- [Environment Variables | LibreChat Docs](https://www.librechat.ai/docs/configuration/dotenv)
- [OpenID Connect on Microsoft Identity Platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [openid-client npm package](https://www.npmjs.com/package/openid-client)
- [LibreChat GitHub](https://github.com/danny-avila/LibreChat)
