# Research Progress Archive — RESEARCH-006-microsoft-entra-sso

**Archived**: 2026-03-30
**Status at archive**: COMPLETE

## Current: RESEARCH-006-microsoft-entra-sso

### Research Phase Summary
**Date**: 2026-03-30
**Status**: COMPLETE
**Branch**: `pablo`

### Research Question
How can we enable single sign-on (SSO) via Microsoft Entra ID for our LibreChat deployment?

### Key Findings

#### 1. No Code Changes Required
LibreChat has **full built-in support** for Microsoft Entra SSO via OpenID Connect. This is a configuration-only task:
- Azure App Registration + `.env` variables + `librechat.yaml` update

#### 2. Existing Azure-Specific Features
- **Group overage handling** — auto-resolves via Graph API OBO flow for orgs with >150 groups
- **Role-based access control** — restrict login to specific Entra security groups
- **Admin role mapping** — auto-assign admin based on Entra group membership
- **Token reuse** — persist OIDC tokens for downstream Graph API / MCP server use
- **People search** — Entra ID integration for @mentions
- **Federated logout** — optional sign-out from both LibreChat and Microsoft

#### 3. Configuration Requirements
- Azure Portal: App registration with redirect URI, client secret, API permissions
- `.env`: 6 required variables (`OPENID_CLIENT_ID`, `OPENID_CLIENT_SECRET`, `OPENID_ISSUER`, `OPENID_SESSION_SECRET`, `OPENID_SCOPE`, `OPENID_CALLBACK_URL`) + domain vars
- `librechat.yaml`: Add `openid` to `socialLogins` array

#### 4. Common Pitfalls
- Don't wrap `.env` values in quotes
- Session errors from MFA enforcement (need Redis in multi-instance)
- `DOMAIN_SERVER` must match external URL (not internal container address)
- Configure claim mappings explicitly for reliability

#### 5. Prerequisite for M365 MCP Integration
Entra SSO with `OPENID_REUSE_TOKENS=true` enables the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder needed for RESEARCH-005 M365 MCP integration.

### Decision Points
1. Single tenant vs multi-tenant app registration?
2. Enable auto-redirect (skip login page)?
3. Restrict login to specific Entra security groups?
4. Map Entra groups to LibreChat admin role?
5. Disable local email/password login?
6. Enable token reuse for future M365 MCP integration?
7. Enable federated logout?

### Research Document
`SDD/research/RESEARCH-006-microsoft-entra-sso.md`

### Key Files (No Changes Needed)
- `api/strategies/openidStrategy.js` — Full OIDC strategy with Azure features (855 lines)
- `api/server/socialLogins.js` — Strategy initialization
- `client/src/components/Auth/SocialLoginRender.tsx` — OpenID button rendering
- `.env.example` — All OPENID_* variables (lines 502-603)
