# ACS

LibreChat has a comprehensive access control system. Here's what's available:

## Groups

Full group management via Admin Panel > Groups (`/api/admin/groups`):

- Create local groups or sync from Microsoft Entra ID (Azure AD)
- Add/remove members from groups
- Each group gets a unique ID usable in permission assignments

## Role-Based Access Control (RBAC)

Roles are managed via Admin Panel > Roles and define permissions across 14+ feature areas:

- AGENTS — USE, CREATE, SHARE, SHARE_PUBLIC
- PROMPTS, MEMORIES, MCP_SERVERS, REMOTE_AGENTS, WEB_SEARCH, RUN_CODE, etc.

You can create custom roles (e.g., "Researcher") with specific permission sets and assign users to them.

## Per-Resource ACL (Agent-Level Access)

LibreChat implements granular ACL entries on individual resources (agents, prompts, MCP servers). Each ACL entry specifies:

- **Who**: a specific User, Group, Role, or Public
- **What resource**: a specific agent by ID
- **Permission level**: Viewer (use only), Editor (modify), Owner (full control + delete)

So to restrict the TA research agent to a specific person or group:

1. Create a group (e.g., "TA Researchers") in Admin > Groups
2. Add the allowed users to that group
3. On the agent, set sharing permissions to grant that group "Viewer" access
4. Don't make it public — only users/groups with explicit ACL entries can see and use it

The middleware at `api/server/middleware/accessResources/canAccessAgentResource.js` enforces this on every agent API call.

## Configuration

In `librechat.yaml`, the `interface` section controls which features are available at all:

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

Yes — you can restrict the TA research agent to only specific users or a specific group. The system supports it natively through the ACL + groups system without any custom development needed.
