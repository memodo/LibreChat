# ACS

LibreChat has a comprehensive access control system. This document describes what exists in this codebase and how to interact with it.

> **Note on the "Admin Panel"**: there is **no single Admin Panel UI** in this fork. The only dedicated admin page is the reporting dashboard at `/d/reporting`. Everything else listed below is either a REST API (no UI) or a small per-feature dialog scattered across the app. Plan accordingly: managing groups, roles, and users today means hitting the REST API directly (curl / scripts / Entra sync), not clicking through a panel.

## Groups

Group management is exposed **only as a REST API** at `/api/admin/groups` (`api/server/routes/admin/groups.js`). There is no Groups management UI.

Endpoints (all require JWT + `ACCESS_ADMIN` capability):

- `GET /api/admin/groups` — list (requires `READ_GROUPS`)
- `POST /api/admin/groups` — create (requires `MANAGE_GROUPS`)
- `GET /api/admin/groups/:id` — get one
- `PATCH /api/admin/groups/:id` — update
- `DELETE /api/admin/groups/:id` — delete
- `GET /api/admin/groups/:id/members` — list members
- `POST /api/admin/groups/:id/members` — add member
- `DELETE /api/admin/groups/:id/members/:userId` — remove member

Groups can also be synced automatically from Microsoft Entra ID (Azure AD) — see "Entra Group Sync" below.

## Entra Group Sync

Group sync is **per-user, on-login**. There is no scheduled batch job that pulls the entire tenant; groups materialize lazily as their members sign in.

### Trigger

Every successful OpenID login runs `syncUserEntraGroupMemberships` from the OAuth callback (`api/server/controllers/auth/oauth.js:70`):

```js
await syncUserEntraGroupMemberships(req.user, req.user.tokenset.access_token);
```

### Required configuration

```env
USE_ENTRA_ID_FOR_PEOPLE_SEARCH=true       # turns on Graph integration
OPENID_REUSE_TOKENS=true                  # keeps the user's access token for OBO calls
ENTRA_ID_INCLUDE_OWNERS_AS_MEMBERS=true   # optional — also include groups the user owns
```

Plus the standard OpenID config pointing at the Entra app registration. The Entra app must have Graph scopes for `GroupMember.Read.All` (or equivalent) so the on-behalf-of (OBO) token exchange can call `getMemberObjects`. Feature gate is in `api/server/services/GraphApiService.js:20` (`entraIdPrincipalFeatureEnabled`).

### What the sync does

In `api/server/services/PermissionService.js:483` (`syncUserEntraGroupMemberships`):

1. Call Microsoft Graph `getMemberObjects` to get the user's group IDs (and optionally owned groups).
2. Bulk-add the user to existing local groups matching `idOnTheSource` + `source: 'entra'`.
3. Query the DB for which of the user's Entra group IDs don't yet exist locally.
4. Fetch name/email/description for the missing groups via a Graph batch call.
5. `upsertGroupByExternalId` (race-safe) creates them locally with `source: 'entra'`.
6. Bulk-add the user to the newly created groups.
7. Remove the user from any local Entra-sourced groups they're no longer a member of (`$pullAll` on `memberIds`).

The group schema (`packages/data-schemas/src/types/group.ts`) carries `source: 'local' | 'entra' | 'ldap'` and `idOnTheSource` (the Entra object ID), with a unique compound index `idOnTheSource_1_source_1`.

### Groups overage

When a user belongs to so many groups that Entra moves them out of the ID token into `_claim_sources`, `openidStrategy.js:375` (`resolveGroupsFromOverage`) uses the same Graph endpoint to fetch them so role checks still work.

### Operational implications

- **Lazy materialization**: a group only exists locally after at least one member logs in. Empty/unused Entra groups never appear.
- **Removal lag**: removing someone from an Entra group only purges their local `memberIds` on their *next* login.
- **No "sync now" button, no cron**: log out / log back in is the only trigger today. A force-sync admin action would need to be built.
- **Per-user OBO**: the backend uses the user's own Graph permissions, not an app-only credential — each user only sees groups they have visibility into.

## Local vs Entra Groups

You are **not limited to Entra-mirrored groups**. Local groups and Entra-synced groups coexist, and the two sync paths don't collide.

Every Group document carries a `source` field — `'local' | 'entra' | 'ldap'` — and the sync paths are scoped by it:

- **Entra sync** (`PermissionService.js:518, 573, 598`) filters every bulk add/remove on `source: 'entra'`. It never touches local groups, so users placed into a local group won't be ejected on the next login.
- **Admin create** (`packages/api/src/admin/groups.ts:212`) defaults `source: 'local'` when `POST /api/admin/groups` doesn't specify a source.

```
[Entra tenant]                          [LibreChat]
  Engineering   ─── auto-sync on login ──►  Group(source=entra, name=Engineering)
  Marketing     ─── auto-sync on login ──►  Group(source=entra, name=Marketing)

                                            Group(source=local, name="TA Researchers")
                                              ← created via POST /api/admin/groups
                                              ← members added via POST /api/admin/groups/:id/members
```

ACL entries on resources don't care about `source` — a local group can be granted Viewer/Editor/Owner on an agent exactly the same way an Entra group can. The typical pattern:

- Use **Entra groups** for org-wide identity (Engineering, Sales, etc.) — managed in Entra, sync free.
- Use **local groups** for app-specific groupings that don't exist in Entra (e.g., "TA Researchers", "Pilot users", "Beta testers") and grant ACLs against those.

### Member ID nuance

`memberIds` on a Group stores `idOnTheSource` values, not Mongo ObjectIds (`packages/data-schemas/src/types/group.ts:10`). For Entra-authenticated users, that's their Entra `oid`. The admin create handler (`packages/api/src/admin/groups.ts:191`) auto-maps ObjectIds you pass to each user's `idOnTheSource`, so `{ "memberIds": ["<userObjectId>", ...] }` works. For users without an `idOnTheSource`, it falls back to the ObjectId string. The storage form is identifier-based, not a strict FK.

## Role-Based Access Control (RBAC)

There is **no central Roles management UI**. RBAC in this codebase has three layers that are easy to conflate — keep them straight:

| Layer | Stored as | What it gates | Edited via |
|---|---|---|---|
| **`User.role`** | Single string on User document (`packages/data-schemas/src/schema/user.ts:64`) | Hardcoded `user.role === 'ADMIN'` checks in some UIs | Admin API / DB / `set-role` script / Entra `OPENID_ADMIN_ROLE` |
| **Role permissions** | `Role.permissions` object per role | Feature toggles (can users with role X *use/create/share* agents at all?) | Per-feature `AdminSettings` dialogs, or `PUT /api/roles/:name/<feature>` |
| **System capabilities** | `SystemGrant` documents (one row per principal+capability) | Admin/management functions (manage roles, view usage, etc.) | `POST /api/admin/grants`, `DELETE /api/admin/grants/...` |

### Layer 1 — `User.role` string

A single string per user, defaults to `USER`. Two system roles exist (`packages/data-provider/src/roles.ts:24`): `ADMIN` and `USER`. Custom role names are allowed; `User.role` can be set to any role name that exists in the `Role` collection.

Some client checks bypass the capability system and gate UI directly on this string (e.g., `AgentFooter.tsx:82`: `user?.role === SystemRoles.ADMIN`). Delegated admins won't see those buttons even if they have the matching capability.

### Layer 2 — Role-level feature permissions

Each `Role` document carries a `permissions` object covering ~14 feature areas. Defaults live in `roleDefaults` (`packages/data-provider/src/roles.ts:124`).

**Per-feature `AdminSettings` dialogs** — small modals scattered in the UI that toggle which roles get which feature flags:

- `client/src/components/SidePanel/Agents/AdminSettings.tsx` — agent USE/CREATE/SHARE/SHARE_PUBLIC
- `client/src/components/SidePanel/MCPBuilder/MCPAdminSettings.tsx` — MCP servers
- `client/src/components/SidePanel/Memories/AdminSettings.tsx` — memories
- `client/src/components/Prompts/buttons/AdminSettings.tsx` — prompts
- `client/src/components/Agents/MarketplaceAdminSettings.tsx` — agent marketplace
- `client/src/components/Sharing/PeoplePickerAdminSettings.tsx` — people picker visibility (VIEW_USERS/GROUPS/ROLES)
- `client/src/components/Nav/SettingsTabs/Data/AgentApiKeys.tsx` — agent API keys

These call `PUT /api/roles/:roleName/<feature>` (`api/server/routes/roles.js`), guarded server-side by `requireCapability(MANAGE_ROLES)`.

Permission types and their flags (`packages/data-provider/src/permissions.ts`, schema in `packages/data-provider/src/roles.ts`):

| `PermissionTypes` | Flags |
|---|---|
| `PROMPTS` | USE, CREATE, SHARE, SHARE_PUBLIC |
| `BOOKMARKS` | USE |
| `MEMORIES` | USE, CREATE, UPDATE, READ, OPT_OUT |
| `AGENTS` | USE, CREATE, SHARE, SHARE_PUBLIC |
| `MULTI_CONVO` | USE |
| `TEMPORARY_CHAT` | USE |
| `RUN_CODE` | USE |
| `WEB_SEARCH` | USE |
| `PEOPLE_PICKER` | VIEW_USERS, VIEW_GROUPS, VIEW_ROLES |
| `MARKETPLACE` | USE |
| `FILE_SEARCH` | USE |
| `FILE_CITATIONS` | USE |
| `MCP_SERVERS` | USE, CREATE, SHARE, SHARE_PUBLIC |
| `REMOTE_AGENTS` | USE, CREATE, SHARE, SHARE_PUBLIC |

Custom roles can be created via `POST /api/admin/roles` and granted any subset of the above flags.

### Layer 3 — System capabilities (SystemGrant)

Capabilities gate **admin/management** functions and are stored as standalone `SystemGrant` documents (`packages/data-schemas/src/methods/systemGrant.ts`). Each grant is a tuple:

- `principalType`: `'user' | 'group' | 'role' | 'public'`
- `principalId`: the specific user/group/role ID
- `capability`: e.g., `'manage:roles'`
- `tenantId` (optional): for tenant-scoped grants

A user holds a capability if **any** of their principals (their userId, their role name, or any of their group memberships) has a matching SystemGrant. Implications expand automatically (`MANAGE_*` → `READ_*`).

#### All capabilities

Defined in `packages/data-schemas/src/admin/capabilities.ts:21` (`SystemCapabilities`):

| Constant | Value | Purpose |
|---|---|---|
| `ACCESS_ADMIN` | `access:admin` | Required to hit any `/api/admin/*` route |
| `READ_USERS` | `read:users` | List/view users |
| `MANAGE_USERS` | `manage:users` | Create, update, delete users (implies `READ_USERS`) |
| `READ_GROUPS` | `read:groups` | List/view groups |
| `MANAGE_GROUPS` | `manage:groups` | Create, update, delete groups, manage members (implies `READ_GROUPS`) |
| `READ_ROLES` | `read:roles` | View roles and their permissions |
| `MANAGE_ROLES` | `manage:roles` | Edit role permissions, create/delete custom roles, drives the `AdminSettings` dialogs (implies `READ_ROLES`) |
| `READ_CONFIGS` | `read:configs` | Read app configuration |
| `MANAGE_CONFIGS` | `manage:configs` | Modify configuration (implies `READ_CONFIGS`) |
| `ASSIGN_CONFIGS` | `assign:configs` | Assign config overrides to user/group/role principals |
| `READ_USAGE` | `read:usage` | View usage/reporting dashboards (`/d/reporting`, `/api/admin/usage/*`) |
| `MANAGE_USAGE` | `manage:usage` | Modify usage data / quotas (implies `READ_USAGE`) |
| `READ_AGENTS` | `read:agents` | Read any agent regardless of ACL |
| `MANAGE_AGENTS` | `manage:agents` | Manage any agent regardless of ACL (implies `READ_AGENTS`) |
| `MANAGE_MCP_SERVERS` | `manage:mcpservers` | Manage any MCP server regardless of ACL |
| `READ_PROMPTS` | `read:prompts` | Read any prompt group regardless of ACL |
| `MANAGE_PROMPTS` | `manage:prompts` | Manage any prompt group regardless of ACL (implies `READ_PROMPTS`) |
| `READ_ASSISTANTS` | `read:assistants` | **Reserved — not yet enforced by any middleware** |
| `MANAGE_ASSISTANTS` | `manage:assistants` | **Reserved — not yet enforced** (implies `READ_ASSISTANTS`) |

#### Dynamic / pattern-matched capabilities

Validator (`capabilities.ts:65`) also accepts these patterns, used for finer-grained config delegation:

| Pattern | Example | Status |
|---|---|---|
| `manage:configs:<section>` | `manage:configs:endpoints` | Scaffolded — not yet enforced (see TODO at `capabilities.ts:150`) |
| `read:configs:<section>` | `read:configs:endpoints` | Scaffolded — not yet enforced |
| `assign:configs:<principalType>` | `assign:configs:user`, `assign:configs:group`, `assign:configs:role` | Validated; gates `ASSIGN_CONFIGS` flow |

#### Implications (held automatically when you hold the broader capability)

```
MANAGE_USERS      ⇒ READ_USERS
MANAGE_GROUPS     ⇒ READ_GROUPS
MANAGE_ROLES      ⇒ READ_ROLES
MANAGE_CONFIGS    ⇒ READ_CONFIGS
MANAGE_AGENTS     ⇒ READ_AGENTS
MANAGE_PROMPTS    ⇒ READ_PROMPTS
MANAGE_USAGE      ⇒ READ_USAGE
MANAGE_ASSISTANTS ⇒ READ_ASSISTANTS
```

#### How ADMIN gets every capability

ADMIN is **not hardcoded** to hold every capability. At server startup, `seedSystemGrants()` (`systemGrant.ts:360`) inserts one `SystemGrant` row per capability with `principalType: 'role', principalId: 'ADMIN'`. The seed uses `$setOnInsert` and `upsert: true` — idempotent, doesn't overwrite if you've intentionally revoked something later.

#### Granting / revoking capabilities

REST API at `/api/admin/grants` (`api/server/routes/admin/grants.js`), all gated by `ACCESS_ADMIN`:

| Method | Path | What |
|---|---|---|
| `GET` | `/api/admin/grants` | List all grants |
| `GET` | `/api/admin/grants/effective` | Resolve effective capabilities for a principal |
| `GET` | `/api/admin/grants/:principalType/:principalId` | Grants for one principal |
| `POST` | `/api/admin/grants` | Assign a capability to a user/group/role |
| `DELETE` | `/api/admin/grants/:principalType/:principalId/:capability` | Revoke (URL-encode the capability) |

Examples:

```bash
# Give one specific user the ability to manage roles
curl -X POST /api/admin/grants \
  -d '{"principalType":"user","principalId":"<userObjectId>","capability":"manage:roles"}'

# Give a group the ability to view usage dashboards
curl -X POST /api/admin/grants \
  -d '{"principalType":"group","principalId":"<groupId>","capability":"read:usage"}'

# Create a custom "Admin-Lite" role and grant it ACCESS_ADMIN + MANAGE_ROLES
# (then set User.role = "Admin-Lite" for selected users)
```

### Other admin REST APIs

Beyond `/api/admin/grants`, the following are also `ACCESS_ADMIN`-gated and have no dedicated UI:

- `/api/admin/roles` — create/list/delete roles, edit permissions (`MANAGE_ROLES`)
- `/api/admin/users` — list users, change role assignments (`MANAGE_USERS`)
- `/api/admin/groups` — see "Groups" section above (`MANAGE_GROUPS`)
- `/api/admin/usage/*` — reporting endpoints (`READ_USAGE`); the `/d/reporting` UI consumes these
- `/api/admin/config` — runtime config overrides (`MANAGE_CONFIGS`)
- `/api/admin/auth` — auth-related admin actions

### Caveat: client-side hardcoded role checks

Several UIs gate visibility on `user.role === 'ADMIN'` directly rather than checking capabilities (e.g., the agent admin button at `client/src/components/SidePanel/Agents/AgentFooter.tsx:82`). For those surfaces, granting `MANAGE_ROLES` to a non-ADMIN user makes the API endpoint accept their calls, but the button doesn't render. To fully delegate, the client gates would need to be refactored to use a capability check (e.g., a `useHasCapability('manage:roles')` hook).

## Per-Resource ACL (Agent-Level Access)

This is the layer that **does** have a real UI. ACL entries on individual resources (agents, prompts, MCP servers) specify:

- **Who**: a specific User, Group, Role, or Public
- **What resource**: a specific resource by ID
- **Permission level**: Viewer (use only), Editor (modify), Owner (full control + delete)

The UI lives in `client/src/components/Sharing/`:

- `GenericGrantAccessDialog.tsx` — share dialog opened from a resource
- `PeoplePicker/` — search and select users/groups/roles
- `AccessRolesPicker.tsx` — choose Viewer/Editor/Owner
- `PublicSharingToggle.tsx` — public/private switch

To restrict the TA research agent to a specific person or group:

1. Create a group (e.g., "TA Researchers") via `POST /api/admin/groups` and add members via `POST /api/admin/groups/:id/members`. (No UI — use curl/script.)
2. Open the agent's share dialog in the app and grant that group "Viewer" access.
3. Don't make it public — only users/groups with explicit ACL entries can see and use it.

Enforcement is in `api/server/middleware/accessResources/canAccessAgentResource.js`, run on every agent API call.

## Groups and RBAC

Groups intersect RBAC at **two distinct points**, plus one special case at login. This section ties the previous Groups, RBAC, and Per-Resource ACL sections together.

### 1. Groups as principals on SystemGrants (capability layer)

A group can hold system capabilities directly. `SystemGrant.principalType` accepts `'user' | 'group' | 'role' | 'public'` (`packages/data-provider/src/accessPermissions.ts:16`):

```bash
curl -X POST /api/admin/grants \
  -d '{"principalType":"group","principalId":"<groupId>","capability":"manage:roles"}'
```

When a user makes a request, `hasCapabilityForPrincipals` (`packages/data-schemas/src/methods/systemGrant.ts:65`) computes their principals — userId + role + **all their group memberships** — and ORs them in the SystemGrant query. If any one of those principals has the capability, the request passes.

This is real, working delegation. Examples:

- Grant `READ_USAGE` to a "Reporting Viewers" group → members can hit `/api/admin/usage/*` and use `/d/reporting`.
- Grant `MANAGE_ROLES` to an "Admin Delegates" group → members can call `PUT /api/roles/:name/<feature>` (subject to the client-UI caveat: some buttons gate on `user.role === 'ADMIN'` directly).

### 2. Groups as principals on per-resource ACL (resource layer)

Groups are also a principal type on ACL entries against individual resources. The middleware checks both paths — per-resource ACL entry, and `MANAGE_<resource>` capability override (`ResourceCapabilityMap` in `packages/data-schemas/src/admin/capabilities.ts:139`):

| Resource | Capability override |
|---|---|
| `AGENT` | `MANAGE_AGENTS` |
| `PROMPTGROUP` | `MANAGE_PROMPTS` |
| `MCPSERVER` | `MANAGE_MCP_SERVERS` |
| `REMOTE_AGENT` | `MANAGE_AGENTS` |

So a group can grant access to a specific agent via ACL, **or** a group can hold `MANAGE_AGENTS` to bypass ACL on every agent.

### 3. What groups do NOT do

- **No automatic role assignment**: there is no field "members of group X get role Y" in the data model. Group membership does not change `User.role`.
- **No automatic feature-permission inheritance**: the role-level `Role.permissions` object (Layer 2 in RBAC — agent USE/CREATE/SHARE flags) is keyed by role name, not by group. Groups don't carry feature permissions; they carry capabilities and ACL entries.

### 4. The one role-related exception: OpenID admin mapping

`api/strategies/openidStrategy.js:607-664` — at login, if `OPENID_ADMIN_ROLE` matches an Entra group OID present in the user's groups claim, the strategy sets `User.role = 'ADMIN'`. This is the *only* group→role mapping anywhere, and it's:

- Login-time only (not query-time)
- Hardcoded to the ADMIN role specifically (no equivalent for custom roles)
- Driven by Entra groups via env var, not by local groups

### Quick reference: what a group membership gives you

| Layer | Effect of being in a group |
|---|---|
| `User.role` string | None (except the special OpenID admin mapping at login) |
| Role-level feature permissions | None — these are scoped to the user's `role` string |
| System capabilities | Any `SystemGrant` with `principalType:'group', principalId:<this group>` |
| Per-resource ACL | Any ACL entry with `principalType:'group', principalId:<this group>` |

### Practical patterns

- **"Reporting team" group** → grant `READ_USAGE` capability → members get the reporting dashboard.
- **"TA Researchers" group** → grant Viewer ACL on the TA agent → members can use just that agent.
- **"Admin Delegates" group** → grant `ACCESS_ADMIN` + `MANAGE_USERS` + `MANAGE_GROUPS` → members can run admin APIs without being full ADMINs (UIs may still hide; APIs work).

## Configuration

In `librechat.yaml`, the `interface` section controls which features and UI surfaces are exposed at all:

```yaml
interface:
  agents:
    use: true
    create: true
    share: true
    public: false   # don't allow public sharing by default
  peoplePicker:
    users: true
    groups: true
    roles: true
```

## Bottom Line

Yes — you can restrict the TA research agent to specific users or a specific group. The system supports it natively through ACL + groups, and no custom development is needed for the access control itself.

But operationally: until/unless someone builds a Groups/Roles/Users management UI, group and role administration in this fork is REST-API-only (or via Entra sync). Per-resource sharing is the only ACL surface that has a real in-app UI.
