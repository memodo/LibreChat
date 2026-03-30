# RESEARCH-005: Microsoft 365 MCP Integration

## Research Question

How can LibreChat be connected to the Microsoft 365 environment (OneDrive, Outlook, Teams, SharePoint, Calendar) via MCP servers, and what are the best available options?

## Context

LibreChat supports MCP (Model Context Protocol) servers that expose tools to agents. The goal is to give LibreChat agents access to M365 services — reading emails, browsing OneDrive/SharePoint files, accessing calendars, and interacting with Teams — through an MCP server backed by the Microsoft Graph API.

---

## LibreChat's Existing M365 Integration Points

### Built-in SharePoint File Picker

LibreChat already has a **SharePoint file picker** feature (not yet fully wired up in all branches):

| Component | Path |
|-----------|------|
| SharePoint file handling hook | `client/src/hooks/Files/useSharePointFileHandling.ts` |
| SharePoint download hook | `client/src/hooks/Files/useSharePointDownload.ts` |
| SharePoint icon | `packages/client/src/svgs/SharePointIcon.tsx` |
| Config flags | `api/server/routes/config.js` |

**Environment variables:**
```bash
ENABLE_SHAREPOINT_FILEPICKER=true
SHAREPOINT_BASE_URL=https://yourtenant.sharepoint.com
SHAREPOINT_PICKER_GRAPH_SCOPE=Files.Read.All
SHAREPOINT_PICKER_SHAREPOINT_SCOPE=https://yourtenant.sharepoint.com/AllSites.Read
```

This is a UI-level file picker — it lets users attach SharePoint/OneDrive files to conversations. It does **not** give agents autonomous access to M365 services.

### Microsoft Graph Token Exchange

LibreChat has a Graph API token exchange system already built:

| Component | Path |
|-----------|------|
| Graph token resolver | `packages/api/src/utils/graph.ts` |
| Placeholder | `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` |

**How it works:**
1. MCP server config contains `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` in headers/env/url
2. `preProcessGraphTokens()` extracts the user's OpenID token
3. Performs On-Behalf-Of (OBO) token exchange with Microsoft Entra
4. Injects the Graph access token into the MCP server's config
5. Configurable via `GRAPH_API_SCOPES` env var (default: `https://graph.microsoft.com/.default`)

This means LibreChat can **natively pass Graph API tokens to MCP servers** — a critical integration point.

---

## MCP Server Options

### Option 1: Softeria ms-365-mcp-server (Recommended)

**Repo:** https://github.com/Softeria/ms-365-mcp-server
**Stars:** ~566 | **npm:** `@softeria/ms-365-mcp-server`
**Transport:** stdio AND HTTP (with OAuth)
**Language:** TypeScript/Node.js

**Capabilities (70+ tools):**

| Domain | Tools |
|--------|-------|
| Email | List, get, send, manage folders |
| Calendar | List, create, update, delete events, calendar views |
| OneDrive | File operations, upload, download |
| Teams & Chats | Messaging, channels (requires `--org-mode`) |
| SharePoint | Site/list/item management (requires `--org-mode`) |
| Excel | Worksheet management, charts, formatting |
| OneNote | Notebooks, sections, pages |
| To Do | Task management |
| Planner | Task planning |
| Contacts | CRUD operations |

**Auth:** Device Code Flow (stdio), OAuth Authorization Code Flow (HTTP), or Bring Your Own Token.

**Maturity:** Most mature community option. Active development, published on npm, well-documented. Supports multi-cloud (Global, China 21Vianet).

**LibreChat compatibility:** HTTP transport mode is compatible with LibreChat's `sse` or `streamable-http` types. Stdio works if running on same host.

### Option 2: Microsoft Official MCP Servers

**Catalog:** https://github.com/microsoft/mcp
**Transport:** Remote HTTP (`agent365.svc.cloud.microsoft`)
**Status:** GA (Mail, Calendar, Chat, User) / Public Preview (Enterprise)

| Server | Status |
|--------|--------|
| Microsoft 365 Mail | GA |
| Microsoft 365 Calendar | GA |
| Microsoft 365 Copilot Chat (search across docs, emails, sites, chats) | GA |
| Microsoft 365 User (user details, org chart) | GA |
| Microsoft Admin Center | GA |
| MCP Server for Enterprise (Entra ID directory, read-only) | Public Preview |

**Auth:** Microsoft Entra ID OAuth2 with delegated permissions. Requires Azure app registration, tenant provisioning via PowerShell, and admin consent for MCP-specific scopes (`MCP.User.Read.All`, `MCP.GroupMember.Read.All`, etc.).

**Key limitation:** Designed primarily for Microsoft's own ecosystem (VS Code Copilot, Copilot Studio). Integrating into LibreChat requires registering a custom MCP client app in Entra and handling OAuth flows — but LibreChat's MCP OAuth system supports this.

### Option 3: Lokka by Merill Fernando

**Repo:** https://github.com/merill/lokka
**Stars:** ~231 | **Transport:** stdio only
**Language:** TypeScript/Node.js

**Approach:** Generic Microsoft Graph API caller — 3 meta-tools where the LLM constructs Graph API paths itself. Flexible but depends on LLM knowledge of Graph API endpoints.

**Auth:** Interactive browser login, App-Only with certificate/secret, or Client-Provided Token.

**Limitation:** stdio only — no HTTP/SSE transport. Would need same-host deployment.

### Option 4: hvkshetry office-365-mcp-server

**Repo:** https://github.com/hvkshetry/office-365-mcp-server
**Stars:** ~13 | **Transport:** stdio AND SSE (`/sse` endpoint)
**Language:** Node.js

**Capabilities:** 24 tools across 14 domains (Mail, Calendar, Teams, OneDrive, SharePoint, Contacts, Planner, To Do, etc.)

**Limitation:** Early stage, explicitly marked "not production-ready."

### Option 5: elyxlz microsoft-mcp

**Repo:** https://github.com/elyxlz/microsoft-mcp
**Stars:** ~44 | **Transport:** stdio only
**Language:** Python

**Capabilities:** 35 tools (Email, Calendar, Contacts, OneDrive, Unified Search).

**Limitation:** Python-based (less convenient for Node.js stack), stdio only.

---

## Comparison Matrix

| Criteria | Softeria | Microsoft Official | Lokka | hvkshetry | elyxlz |
|----------|----------|--------------------|-------|-----------|--------|
| Tool count | 70+ | ~20-30 | 3 (meta) | 24 | 35 |
| Transport | stdio + HTTP | Remote HTTP | stdio | stdio + SSE | stdio |
| Maturity | High | High (GA) | Medium | Low | Low |
| SharePoint | Full CRUD | Search only ¹ | Yes (generic) | Yes | No |
| Teams | Full CRUD | Search only ¹ | Yes (generic) | Yes | No |
| OneDrive | Full CRUD | Search only ¹ | Yes (generic) | Yes | Yes |
| Outlook | Full CRUD | Dedicated server ² | Yes (generic) | Yes | Yes |
| Calendar | Full CRUD | Dedicated server ² | Yes (generic) | Yes | Yes |
| Multi-user auth | Entra: AuthCode, Device Code, or BYOT ³ | Entra: delegated + MCP scopes ⁴ | App-only or BYOT | Entra: AuthCode | Entra: Device Code |
| LibreChat compat | High | Medium-High | Medium | Medium | Low |

**Notes:**
1. **Search only** — The Microsoft 365 Copilot Chat server provides cross-service search across SharePoint, Teams, and OneDrive content, but does not expose dedicated tools for CRUD operations (e.g., creating lists, sending messages, managing files). It is a unified retrieval interface, not a per-service toolkit.
2. **Dedicated server** — Microsoft offers separate, purpose-built MCP servers for Mail and Calendar with full read/write operations.
3. **Softeria auth** — All flows authenticate against Microsoft Entra ID. Supports Authorization Code Flow (HTTP mode, best for multi-user), Device Code Flow (stdio, interactive), or Bring Your Own Token (BYOT). In a LibreChat deployment, the recommended path is LibreChat's OBO token exchange via `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`, which handles Entra auth at the LibreChat layer and passes the Graph token to the MCP server.
4. **Microsoft Official auth** — Also Entra ID, but requires additional setup: tenant provisioning via PowerShell, admin consent for MCP-specific permission scopes (e.g., `MCP.User.Read.All`), and registering the client as an MCP consumer app. More administrative overhead than Softeria but first-party supported.

---

## LibreChat MCP Configuration Details

### Supported Transports

| Transport | Type | Notes |
|-----------|------|-------|
| stdio | Local command | Admin-only (YAML config), most secure |
| SSE | Server-Sent Events | Deprecated in MCP spec March 2025, still supported |
| WebSocket | ws/wss | Real-time bidirectional |
| Streamable HTTP | `streamable-http` | Recommended for new deployments |

### OAuth Support

LibreChat has robust MCP OAuth handling:
- **Auto-discovery** on 401 responses
- **PKCE** support for security
- **Token refresh** with expiry tracking
- **OBO flow** for Microsoft Graph via `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`
- Token endpoint auth methods: `client_secret_basic`, `client_secret_post`, `none`

### Security

- SSRF protection blocks localhost, private IPs, `.internal`/`.local` TLDs by default
- Allowlist via `mcpSettings.allowedDomains` in YAML
- User-created servers cannot use stdio (admin-only)
- Encrypted API key storage
- Circuit breaker for reconnection (max 7 cycles, 45s window, exponential backoff)

### Example Configuration (Softeria)

```yaml
mcpServers:
  microsoft365:
    # Option A: stdio (same host)
    command: npx
    args:
      - -y
      - "@softeria/ms-365-mcp-server"
      - "--org-mode"
    timeout: 300000
    env:
      MS365_CLIENT_ID: "${AZURE_AD_CLIENT_ID}"
      MS365_TENANT_ID: "${AZURE_AD_TENANT_ID}"

  # Option B: HTTP/SSE (remote)
  microsoft365:
    url: http://localhost:3002/sse
    timeout: 60000
    headers:
      Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"
```

---

## Authentication Architecture

### For Multi-User Deployment

The key challenge is **per-user authentication** against Microsoft Entra. Three approaches:

1. **LibreChat Graph Token Placeholder (Best fit)**
   - Users log in via OpenID Connect (Microsoft)
   - LibreChat performs OBO exchange for Graph scopes
   - `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` injected into MCP server config
   - MCP server uses the token to call Graph API on behalf of the user
   - Requires: Azure AD app registration with OBO permissions

2. **MCP Server-Side OAuth**
   - MCP server handles its own OAuth flow
   - LibreChat's MCP OAuth handler manages the redirect/callback
   - Each user authenticates independently
   - More isolated but duplicates auth infrastructure

3. **App-Only (Service Account)**
   - Single app registration with application permissions
   - All users share one identity — no per-user delegation
   - Simpler but less secure, no user-specific access control
   - Only suitable for read-only scenarios with shared data

### SSO-to-MCP Auth Flow (Recommended)

The recommended approach uses LibreChat's existing SSO and OBO infrastructure so that **users authenticate once** and their identity flows transparently through to M365 services. No separate MCP server login is required.

**End-to-end flow:**

```
┌──────────┐     OIDC/SSO      ┌───────────┐    OBO Exchange    ┌──────────────┐
│          │ ─────────────────► │           │ ─────────────────► │              │
│   User   │  1. Login with     │ LibreChat │  3. Exchange user  │ Microsoft    │
│ (Browser)│     Microsoft      │  Server   │     token for      │ Entra ID     │
│          │ ◄───────────────── │           │ ◄───────────────── │              │
└──────────┘  2. Entra token    └─────┬─────┘  4. Graph API      └──────────────┘
              stored in session        │           access token
                                       │
                                       │ 5. Inject Graph token
                                       │    via placeholder
                                       ▼
                                ┌─────────────┐     Graph API     ┌──────────────┐
                                │  MCP Server  │ ─────────────────►│  Microsoft   │
                                │  (Softeria)  │  6. Call Graph    │  Graph API   │
                                │              │     as the user   │              │
                                └─────────────┘ ◄─────────────────┘──────────────┘
                                                 7. M365 data
                                                    (emails, files,
                                                     calendar, etc.)
```

**Step-by-step:**

1. **User logs into LibreChat** via OpenID Connect with Microsoft Entra ID (SSO). This is configured in `.env` with `OPENID_ISSUER`, `OPENID_CLIENT_ID`, `OPENID_CLIENT_SECRET`, etc.

2. **LibreChat stores the Entra ID token** in the user's session (`user.openidTokens` or `user.federatedTokens`).

3. **Agent invokes an MCP tool** (e.g., "search my recent emails"). LibreChat detects `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` in the MCP server config.

4. **LibreChat's `preProcessGraphTokens()`** (`packages/api/src/utils/graph.ts`) extracts the user's stored Entra token and performs an **On-Behalf-Of (OBO) exchange** with Microsoft Entra. This exchanges the user's OIDC token for a Microsoft Graph API access token with the configured scopes.

5. **The Graph access token is injected** into the MCP server's headers, environment variables, or URL — wherever the `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder appears.

6. **The MCP server calls Microsoft Graph API** using the injected token, acting **as that specific user**. The user's M365 permissions apply — they can only access what they'd normally have access to in SharePoint, Outlook, Teams, etc.

7. **M365 data is returned** through the MCP server back to the agent, which incorporates it into the conversation.

**Key properties of this flow:**
- **Single sign-on** — user authenticates once, no separate MCP login
- **Per-user scoping** — each user's Graph token reflects their own M365 permissions
- **Token refresh** — LibreChat's OBO flow handles token expiry and refresh automatically
- **No secrets in the MCP server** — the MCP server never stores credentials; it receives a short-lived token per request

**LibreChat configuration for this flow:**

```yaml
# librechat.yaml
mcpServers:
  microsoft365:
    url: http://localhost:3002/sse
    timeout: 60000
    headers:
      Authorization: "Bearer {{LIBRECHAT_GRAPH_ACCESS_TOKEN}}"
```

```bash
# .env — OpenID Connect SSO with Microsoft Entra
OPENID_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
OPENID_CLIENT_ID=your-app-client-id
OPENID_CLIENT_SECRET=your-app-client-secret
OPENID_SCOPE=openid profile email
OPENID_REUSE_TOKENS=true

# Graph API scopes for OBO exchange
GRAPH_API_SCOPES=Mail.Read Calendars.Read Files.Read.All Sites.Read.All Team.ReadBasic.All Chat.Read
```

### Required Azure AD App Registration

A **single app registration** in Microsoft Entra covers both SSO login and Graph API access:

```
App Registration:
  - Name: LibreChat-M365-MCP
  - Platform: Web
  - Redirect URI: https://your-librechat-domain/oauth/openid/callback
  - Supported account types: Single tenant (recommended)
  - Client Secret or Certificate: Yes (for OBO exchange)

  API Permissions (Delegated — requires admin consent):
    Microsoft Graph:
      - openid, profile, email          (for SSO login)
      - Mail.Read                        (read emails)
      - Mail.ReadWrite                   (send/manage emails — optional, Phase 2+)
      - Calendars.Read                   (read calendar events)
      - Calendars.ReadWrite              (create/modify events — optional)
      - Files.Read.All                   (read OneDrive/SharePoint files)
      - Files.ReadWrite.All              (upload/modify files — optional)
      - Sites.Read.All                   (read SharePoint sites/lists)
      - Team.ReadBasic.All              (read Teams info)
      - Chat.Read                        (read Teams chat messages)
      - User.Read                        (basic user profile)

  Expose an API (for OBO):
    - Application ID URI: api://{client-id}
    - Scope: api://{client-id}/access_as_user
    - Authorized client applications: add LibreChat's client ID
```

**Note on permissions:** Start with read-only scopes (`.Read`) and expand to read-write (`.ReadWrite`) only when needed. This limits blast radius if a token is compromised and simplifies admin consent.

---

## Decision Points

1. **Which MCP server?**
   - **Softeria is the clear choice for a single-server deployment.** It has the broadest tool coverage (70+), covers all M365 services (Mail, Calendar, Teams, SharePoint, OneDrive, Excel, etc.), and is the most mature community option. Running a second server (Microsoft Official) alongside it would add deployment complexity, duplicate auth configuration, and require additional monitoring — with no meaningful capability gain. Microsoft's official servers are narrower (Mail/Calendar only as dedicated servers, search-only for the rest) and require extra admin overhead (PowerShell provisioning, MCP-specific scopes). The only scenario where Microsoft Official might be worth evaluating later is if Softeria proves unreliable for a specific service, as a targeted replacement — not as a default complement.

2. **Transport type?**
   - stdio (simplest, same-host only) vs. HTTP (scalable, containerizable)
   - For Docker deployment: HTTP recommended

3. **Authentication model?**
   - On-Behalf-Of (OBO) via `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` — LibreChat exchanges the user's SSO token for a Graph API token, then passes it to the MCP server. Single sign-on, per-user scoping, leverages existing LibreChat infra. **(Recommended)**
   - MCP server-managed OAuth — the MCP server handles its own auth flow independently. More isolated but duplicates auth infrastructure.
   - App-only — a single service account shared by all users. Simplest but least secure, no per-user access control.

4. **Scope of M365 access?**
   - Read-only (safer, simpler permissions) vs. read-write (full agent autonomy)
   - Start read-only, expand incrementally

5. **Deployment model?**
   - Sidecar container alongside LibreChat
   - Separate service
   - Same process (stdio)

---

## Recommendations

### Phase 1: Quick Win — SharePoint File Picker
- Enable the existing `ENABLE_SHAREPOINT_FILEPICKER` feature
- Configure Azure AD app with Files.Read.All scope
- Requires OpenID Connect auth with Microsoft

### Phase 2: MCP Agent Access — Softeria Server
- Deploy `@softeria/ms-365-mcp-server` via stdio or HTTP
- Configure in `librechat.yaml` under `mcpServers`
- Use `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` for per-user auth
- Start with read-only scopes: Mail.Read, Calendars.Read, Files.Read.All
- Enable `--org-mode` for Teams/SharePoint access

### Phase 3: Evaluate Microsoft Official Servers
- Register as MCP client in Microsoft Entra
- Test Mail and Calendar servers for reliability
- Compare tool quality with Softeria
- Potentially use alongside Softeria for best coverage

---

## Sources

- [Softeria ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server)
- [Microsoft Official MCP Catalog](https://github.com/microsoft/mcp)
- [Microsoft MCP Server for Enterprise](https://learn.microsoft.com/en-us/graph/mcp-server/overview)
- [Lokka MCP Server](https://github.com/merill/lokka)
- [hvkshetry office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server)
- [elyxlz microsoft-mcp](https://github.com/elyxlz/microsoft-mcp)
- [LibreChat MCP Servers Docs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- [MCP SSE Deprecation](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)
- LibreChat codebase: `packages/api/src/mcp/`, `packages/api/src/utils/graph.ts`, `api/server/routes/config.js`
