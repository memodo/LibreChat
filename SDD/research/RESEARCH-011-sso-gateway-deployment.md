# RESEARCH-011: SSO Gateway Deployment

**Date:** 2026-04-01
**Status:** Research Complete
**Scope:** Unified authentication gateway using oauth2-proxy + Microsoft Entra ID to protect LibreChat, Redakt, and other services behind a single SSO layer.
**Related:** RESEARCH-006 (Microsoft Entra SSO), RESEARCH-010 (Production Readiness)

---

## Table of Contents

1. [Goal](#1-goal)
2. [Architecture](#2-architecture)
3. [Why LibreChat Needs Its Own OIDC Flow](#3-why-librechat-needs-its-own-oidc-flow)
4. [Authentication Flow (User Experience)](#4-authentication-flow-user-experience)
5. [Component Configuration](#5-component-configuration)
6. [Infrastructure Changes](#6-infrastructure-changes)
7. [LibreChat Configuration](#7-librechat-configuration)
8. [Redakt and Other Services](#8-redakt-and-other-services)
9. [Why Not Pure Proxy Header Auth?](#9-why-not-pure-proxy-header-auth)
10. [Open Questions & Decisions](#10-open-questions--decisions)
11. [Implementation Checklist](#11-implementation-checklist)
12. [Sources](#12-sources)

---

## 1. Goal

Deploy a single authentication gateway (oauth2-proxy with Microsoft Entra ID) in front of all MemodoAI services so that:

- Users authenticate once via Microsoft SSO
- All services (LibreChat, Redakt, MinIO console, Research Agent) are protected
- LibreChat retains its full feature set (Graph API, group sync, token balance, MCP tokens)
- Services without their own auth (Redakt, MinIO console) are fully protected by the gateway

---

## 2. Architecture

### Recommended Pattern: Gate + Native OIDC

```
Internet
   |
Caddy (TLS termination, automatic HTTPS via Let's Encrypt)
   |
oauth2-proxy (Microsoft Entra ID OIDC gate)
   | forward_auth on all routes
   |
   +-- chat.memodo-eng.de -------> LibreChat:3080 (own OIDC against same Entra tenant)
   +-- redact.memodo-eng.de -----> Redakt API:8000 (protected by gate only)
   +-- minio-console.memodo-eng.de -> MinIO:9001 (protected by gate only)
   +-- minio.memodo-eng.de ------> MinIO:9000 (S3 API, may need special handling)
   +-- ta-agent.memodo-eng.de ---> Research Agent:8000 (protected by gate only)
   +-- proc.memodo-eng.de -------> Jira Process:80 (protected by gate, replaces basic auth)
   +-- memodo-eng.de ------------> Landing page (protected by gate, replaces basic auth)
```

### Key Design Decision

oauth2-proxy acts as a **network perimeter gate**, not as a session provider for downstream apps. LibreChat runs its own independent OIDC flow against the **same** Entra app registration. Other services that lack their own auth are fully protected by the gate alone.

---

## 3. Why LibreChat Needs Its Own OIDC Flow

LibreChat does **not** support proxy-based / header-based authentication. There is no middleware to create sessions from `X-Auth-Request-User` or `X-Auth-Request-Email` headers.

More importantly, LibreChat's OIDC integration powers features beyond basic authentication:

| Feature | Requires LibreChat's Own OIDC |
|---------|-------------------------------|
| User auto-creation from Entra claims | Yes |
| Admin role mapping from Entra groups (`OPENID_ADMIN_ROLE`) | Yes |
| Access restriction by group (`OPENID_REQUIRED_ROLE`) | Yes |
| Token balance initialization on first login | Yes |
| Microsoft Graph API via On-Behalf-Of flow | Yes |
| SharePoint file picker | Yes |
| MCP token injection (`{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`) | Yes |
| Entra group membership sync | Yes |
| OIDC token refresh / session lifecycle | Yes |

Bypassing LibreChat's OIDC and relying only on proxy headers would break all of these.

---

## 4. Authentication Flow (User Experience)

From the user's perspective, there is **one login**:

1. User navigates to `chat.memodo-eng.de`
2. oauth2-proxy intercepts (no valid session cookie) -> redirects to Microsoft login
3. User signs in with Microsoft credentials -> Entra issues tokens to oauth2-proxy
4. oauth2-proxy sets session cookie (`_oauth2_proxy`) -> redirects back to LibreChat
5. LibreChat's `OPENID_AUTO_REDIRECT=true` triggers its own OIDC flow -> redirects to Entra
6. Entra already has an active session (from step 3) -> **silently** issues tokens to LibreChat (no user interaction)
7. LibreChat creates its session -> user is fully logged in

**For subsequent service visits:**
- Navigate to `redact.memodo-eng.de` -> oauth2-proxy session cookie is valid -> immediate access
- Navigate back to `chat.memodo-eng.de` -> both oauth2-proxy and LibreChat sessions are active -> immediate access

**Net effect: one explicit login, access to everything.**

---

## 5. Component Configuration

### 5.1 Entra ID App Registration

A single app registration can serve both oauth2-proxy and LibreChat:

- **Redirect URIs** (both needed):
  - `https://chat.memodo-eng.de/oauth2/callback` (oauth2-proxy)
  - `https://chat.memodo-eng.de/oauth/openid/callback` (LibreChat)
- **API Permissions:** `openid`, `profile`, `email` (minimum); add `User.Read`, `People.Read`, `GroupMember.Read.All` if using Graph API features
- **Token configuration:** Enable `groups` optional claim if using role-based access

**Alternative:** Use two separate app registrations (one for oauth2-proxy, one for LibreChat) in the same tenant. SSO still works because Entra maintains a tenant-level session. This provides better separation of concerns and independent secret rotation.

### 5.2 oauth2-proxy

```
--http-address=0.0.0.0:4180
--provider=oidc
--provider-display-name=Microsoft
--oidc-issuer-url=https://login.microsoftonline.com/<TENANT_ID>/v2.0
--client-id=<OAUTH2_PROXY_CLIENT_ID>
--client-secret=<OAUTH2_PROXY_CLIENT_SECRET>
--redirect-url=https://chat.memodo-eng.de/oauth2/callback
--email-domain=memodo.de,memodo-eng.de       # Restrict to company domains
--cookie-name=_oauth2_proxy
--cookie-secret=<GENERATED_SECRET>
--cookie-secure=true
--cookie-httponly=true
--cookie-samesite=lax
--cookie-expire=168h                          # 7 days
--cookie-refresh=1h
--cookie-domain=.memodo-eng.de               # Share cookie across subdomains
--skip-provider-button=true                   # Skip oauth2-proxy login page
--reverse-proxy=true
--upstream=static://202                       # Forward-auth mode
--set-xauthrequest=true
--pass-access-token=true
--pass-authorization-header=true
--pass-user-headers=true
```

**Critical: `--cookie-domain=.memodo-eng.de`** — the leading dot allows the session cookie to be shared across all subdomains, so authenticating on `chat.memodo-eng.de` also works on `redact.memodo-eng.de`.

### 5.3 Caddy (Caddyfile)

```caddyfile
# oauth2-proxy handles for all domains
(oauth2_gate) {
    handle /oauth2/* {
        reverse_proxy oauth2-proxy:4180
    }
}

chat.memodo-eng.de {
    import oauth2_gate

    # LibreChat's own OIDC callback must pass through without gate interference
    handle /oauth/* {
        reverse_proxy LibreChat:3080 {
            header_up Host {host}
            header_up X-Real-IP {remote}
            header_up X-Forwarded-For {remote}
            header_up X-Forwarded-Proto {scheme}
        }
    }

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email X-Auth-Request-Access-Token
        }
        reverse_proxy LibreChat:3080 {
            header_up Host {host}
            header_up X-Real-IP {remote}
            header_up X-Forwarded-For {remote}
            header_up X-Forwarded-Proto {scheme}
        }
    }
}

redact.memodo-eng.de {
    import oauth2_gate

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email
        }
        reverse_proxy redakt-api:8000
    }
}

minio-console.memodo-eng.de {
    import oauth2_gate

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email
        }
        reverse_proxy minio:9001 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_down -Content-Security-Policy
        }
    }
}

# S3 API — may need to bypass oauth2-proxy for programmatic access
minio.memodo-eng.de {
    reverse_proxy minio:9000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

ta-agent.memodo-eng.de {
    import oauth2_gate

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email
        }
        reverse_proxy ta-agent-api:8000
    }
}

proc.memodo-eng.de {
    import oauth2_gate

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email
        }
        reverse_proxy jira-process:80
    }
}

memodo-eng.de {
    import oauth2_gate

    handle {
        forward_auth oauth2-proxy:4180 {
            uri /oauth2/auth
            copy_headers X-Auth-Request-User X-Auth-Request-Email
        }
        root * /srv/simple-auth
        file_server
    }
}
```

**Key points:**
- LibreChat's `/oauth/*` routes are excluded from the gate so the OIDC callback can complete
- The MinIO S3 API (`minio.memodo-eng.de`) bypasses the gate because LibreChat accesses it programmatically with its own credentials
- Basic auth is fully replaced by the SSO gate on all routes

---

## 6. Infrastructure Changes

### What Changes in the Infra Repo (`/Users/pablooliva/Dev/infra/`)

| Change | Details |
|--------|---------|
| Replace `simple-auth/` with SSO-based setup | New Caddyfile, docker-compose with oauth2-proxy |
| Add oauth2-proxy service | Image: `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0` |
| Update Caddyfile | Replace basic auth with `forward_auth` pattern |
| Add `.env` for Entra credentials | Client ID, secret, tenant ID, cookie secret |
| Remove basic auth users | `admin` and `it-lead` basic auth entries no longer needed |
| Network change | Evaluate whether to keep `caddy_net` or switch to `auth_network` from SSO prototype |

### Docker Network Considerations

**Option A: Keep `caddy_net`** (minimal disruption)
- Add oauth2-proxy to existing `caddy_net` network
- LibreChat's `docker-compose.override.yml` unchanged
- Simplest migration path

**Option B: Switch to `auth_network`** (cleaner naming)
- Rename network in both infra and LibreChat compose files
- Requires coordinated update and brief downtime

**Recommendation:** Option A — add oauth2-proxy to `caddy_net`, avoid unnecessary network renaming.

### Docker Compose Addition (infra repo)

```yaml
services:
  caddy:
    # ... existing config ...
    depends_on:
      - oauth2-proxy

  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
    container_name: oauth2-proxy
    restart: unless-stopped
    command:
      # ... flags from section 5.2 ...
    networks:
      - caddy_net
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:4180/ping"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

---

## 7. LibreChat Configuration

### .env Changes

```env
# --- OIDC Authentication (Microsoft Entra ID) ---
OPENID_CLIENT_ID=<librechat-app-client-id>
OPENID_CLIENT_SECRET=<librechat-app-client-secret>
OPENID_ISSUER=https://login.microsoftonline.com/<TENANT_ID>/v2.0/
OPENID_SESSION_SECRET=<generated-secret>
OPENID_SCOPE=openid profile email
OPENID_CALLBACK_URL=/oauth/openid/callback
OPENID_AUTO_REDIRECT=true

# Optional: PKCE for additional security
OPENID_USE_PKCE=true

# Optional: Restrict to specific Entra group
OPENID_REQUIRED_ROLE=<security-group-id>
OPENID_ADMIN_ROLE=<admin-group-id>

# Claim mapping
OPENID_EMAIL_CLAIM=email
OPENID_USERNAME_CLAIM=preferred_username

# --- Registration lockdown ---
ALLOW_REGISTRATION=false
ALLOW_SOCIAL_REGISTRATION=true      # Allow OIDC to create new users
ALLOW_SOCIAL_LOGIN=true
ALLOW_EMAIL_LOGIN=false              # Disable local email/password login
ALLOW_UNVERIFIED_EMAIL_LOGIN=false

# --- Domain restriction ---
# Also set in librechat.yaml under registration.allowedDomains
```

### librechat.yaml Changes

```yaml
registration:
  allowedDomains:
    - "memodo.de"
    - "memodo-eng.de"
```

---

## 8. Redakt and Other Services

Services without their own authentication are protected solely by the oauth2-proxy gate:

- **Redakt API:** Receives `X-Auth-Request-User` and `X-Auth-Request-Email` headers from Caddy. If Redakt needs to know who is making requests (e.g., for audit logging), it can read these headers. No code changes needed for basic protection.
- **MinIO Console:** Protected by gate. Users must be SSO-authenticated to access the web UI.
- **Research Agent:** Protected by gate. API key authentication (`RESEARCH_AGENT_API_KEY`) still applies for LibreChat-to-agent communication on the internal network.
- **MinIO S3 API:** Should **not** be behind the gate — LibreChat accesses it programmatically with its own S3 credentials.

### If Redakt Needs User Identity

If the Redakt API needs to act on the authenticated user's identity (e.g., per-user audit trails), it can read the forwarded headers:

```python
# In Redakt API
user_email = request.headers.get("X-Auth-Request-Email")
user_name = request.headers.get("X-Auth-Request-User")
```

No OIDC integration needed in Redakt itself — the gate provides identity via headers.

---

## 9. Why Not Pure Proxy Header Auth?

Three alternative patterns were evaluated and rejected:

### Pattern A: Header-trust (oauth2-proxy headers → LibreChat auto-login)
- LibreChat has no middleware to accept `X-Auth-Request-*` headers for session creation
- Would require custom code (~100-200 lines) touching the auth chain
- Breaks on LibreChat upgrades
- Loses Graph API, group sync, MCP token injection, SharePoint integration
- **Rejected: too fragile, loses features**

### Pattern B: Token relay (oauth2-proxy injects ID token → LibreChat validates)
- oauth2-proxy can forward the Entra ID token via `Authorization: Bearer` header
- LibreChat's `openIdJwtStrategy.js` can validate it against Entra JWKS
- But LibreChat expects a full tokenset (access_token, id_token, refresh_token) for downstream features
- A single forwarded ID token is insufficient
- **Rejected: incomplete token context**

### Pattern C: Shared cookie / session
- oauth2-proxy and LibreChat on same domain sharing session cookies
- Completely different cookie formats and session schemas
- No community evidence of this working
- **Rejected: not viable**

---

## 10. Open Questions & Decisions

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Single or separate Entra app registrations? | Single (shared client_id) vs. two separate | **Two separate** — independent secret rotation, clearer audit trail |
| 2 | Which domains should be behind the gate? | All vs. selective | **All except MinIO S3 API** — S3 needs programmatic access |
| 3 | Cookie domain scope? | Per-subdomain vs. `.memodo-eng.de` wildcard | **Wildcard** — enables cross-subdomain SSO |
| 4 | Email domain restriction? | Open vs. `memodo.de,memodo-eng.de` | **Restrict to company domains** |
| 5 | Keep `caddy_net` or rename to `auth_network`? | Keep vs. rename | **Keep `caddy_net`** — minimal disruption |
| 6 | What happens to existing basic auth users? | Migrate to Entra accounts | Must ensure `admin` and `it-lead` have Entra accounts |
| 7 | Staging/rollback plan? | Blue-green vs. in-place | Deploy SSO config alongside simple-auth, test, then switch |
| 8 | Session timeout alignment? | oauth2-proxy 7d cookie vs. LibreChat 15m session | Review — oauth2-proxy cookie outlasts LibreChat session; Entra SSO handles re-auth silently |

---

## 11. Implementation Checklist

### Phase 1: Entra ID Setup
1. [ ] Create Entra app registration for oauth2-proxy (or reuse existing)
2. [ ] Create Entra app registration for LibreChat (or reuse existing)
3. [ ] Configure redirect URIs for both
4. [ ] Add API permissions (`openid`, `profile`, `email`)
5. [ ] Grant admin consent
6. [ ] Create security groups for access control and admin role mapping (optional)

### Phase 2: Infrastructure (Infra Repo)
7. [ ] Add oauth2-proxy service to docker-compose
8. [ ] Update Caddyfile with `forward_auth` pattern
9. [ ] Add `.env` with Entra credentials and cookie secret
10. [ ] Add oauth2-proxy to `caddy_net` network
11. [ ] Remove basic auth entries from Caddyfile
12. [ ] Add health check for oauth2-proxy

### Phase 3: LibreChat Configuration
13. [ ] Add OIDC environment variables to `.env`
14. [ ] Set `OPENID_AUTO_REDIRECT=true`
15. [ ] Set `ALLOW_EMAIL_LOGIN=false`, `ALLOW_REGISTRATION=false`
16. [ ] Set `ALLOW_SOCIAL_REGISTRATION=true`
17. [ ] Add `allowedDomains` to `librechat.yaml`
18. [ ] Test OIDC login flow end-to-end

### Phase 4: Redakt & Other Services
19. [ ] Add `redact.memodo-eng.de` route to Caddyfile with `forward_auth`
20. [ ] Verify Redakt receives `X-Auth-Request-*` headers
21. [ ] Verify MinIO S3 API remains accessible without gate (programmatic access)
22. [ ] Verify Research Agent is protected by gate but accessible from LibreChat internally

### Phase 5: Testing & Cutover
23. [ ] Test SSO flow: single login → access all services
24. [ ] Test Entra session sharing: oauth2-proxy login → silent LibreChat OIDC
25. [ ] Test domain restriction: non-company emails blocked
26. [ ] Test group-based access control (if configured)
27. [ ] Test logout: verify session cleanup across services
28. [ ] Verify Caddy TLS certificates regenerate correctly
29. [ ] Cutover from simple-auth to SSO config
30. [ ] Remove old basic auth configuration

---

## 12. Sources

### LibreChat
- [OpenID Connect Strategy](https://www.librechat.ai/docs/configuration/authentication/OIDC) — LibreChat OIDC configuration
- [Authentication System](https://www.librechat.ai/docs/configuration/authentication) — overview of all auth methods
- `api/strategies/openidStrategy.js` — OIDC strategy implementation (855 lines)
- `api/strategies/openIdJwtStrategy.js` — JWT validation for OIDC tokens
- `api/server/middleware/requireJwtAuth.js` — auth middleware chain

### oauth2-proxy
- [oauth2-proxy Documentation](https://oauth2-proxy.github.io/oauth2-proxy/) — official docs
- [Forward Auth with Caddy](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview#forwardauth-with-static-upstreams) — Caddy integration pattern

### Caddy
- [forward_auth Directive](https://caddyserver.com/docs/caddyfile/directives/forward_auth) — Caddy forward auth documentation

### Microsoft Entra ID
- [Entra ID App Registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) — setup guide
- RESEARCH-006: Microsoft Entra SSO — prior research on Entra integration for this project

### Prior Research
- RESEARCH-010: Production Readiness — security hardening, secrets management context
- SSO Prototype: `/Users/pablooliva/Dev/infra/SSO/` — existing oauth2-proxy + Caddy prototype (not yet deployed)
