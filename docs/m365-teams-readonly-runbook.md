# M365 MCP — Enable read-only Teams (Phase 2)

**Audience:** Microsoft Entra ID administrator (Global Administrator or Application Administrator +
Privileged Role Administrator on the app below) **and** the LibreChat operator.
**Goal:** Surface the Softeria sidecar's **read-only Teams** tools (chats, channels, messages, members,
tabs, installed apps) to the Microsoft 365 assistant.
**Time:** ~15 minutes in the portal (admin consent) + one config change + a re-login.
**Prerequisite:** Phase 1 is deployed — `MS365_MCP_ORG_MODE=true` and `MS365_MCP_ALLOWED_SCOPES` are
already set on the `mcp-m365` service. See
[`m365-sharepoint-readonly-runbook.md`](m365-sharepoint-readonly-runbook.md).
**Background:** `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.

---

## ⚠️ Read this before you start — this is a governance decision, not just config

Phase 1 (SharePoint) exposed data the signed-in user already had personal access to, using scopes that
were already consented. **Teams is different.** The two message-reading scopes below —
`ChannelMessage.Read.All` and `ChatMessage.Read` — expose **message content** across every team and
chat the signed-in user belongs to, and most Teams delegated scopes require **tenant-wide admin
consent**. Enabling Teams therefore materially widens the assistant's data-access surface and must be
signed off by whoever owns Entra consent and data governance. This is almost certainly why Teams was
deferred out of phase 1.

Everything here is **read-only** (no send/create/update/delete), but "read" includes message bodies.

---

## Identifiers (verify before starting)

| Item | Value |
|---|---|
| Application (client) ID | `323c5939-9fcf-4868-87e0-290a000be67c` |
| Directory (tenant) ID | `73927432-b62c-46ff-94a3-0339d48d5223` |
| Permission type | **Delegated** Microsoft Graph (OBO on-behalf-of the signed-in user) |

---

## The scopes this adds

Ten new **delegated** Microsoft Graph scopes, none currently granted:

| Scope | Unlocks (read-only) | Admin consent |
|---|---|---|
| `Chat.Read` | list/get 1:1 and group chats | Required |
| `ChatMessage.Read` | **chat message content**, replies, pinned messages | Required |
| `ChatMember.Read` | chat member lists | Required |
| `Team.ReadBasic.All` | teams the user has joined; team details | Required |
| `TeamMember.Read.All` | team member lists | Required |
| `Channel.ReadBasic.All` | channels within a team | Required |
| `ChannelMessage.Read.All` | **channel message content** + replies | Required |
| `ChannelSettings.Read.All` | channel settings | Required |
| `TeamsTab.Read.All` | channel tabs | Required |
| `TeamsAppInstallation.ReadForUser` | the user's installed Teams apps | Required |

> Treat the whole set as one **admin-consent** grant. For the authoritative, version-exact permission
> manifest, run `ms-365-mcp-server --list-permissions` inside the `mcp-m365` container and hand the
> output to the admin.

---

## Steps (order matters — consent first)

### 1. `[ENTRA-ADMIN]` Add the delegated permissions and grant admin consent

App `323c5939-9fcf-4868-87e0-290a000be67c`, tenant `73927432-b62c-46ff-94a3-0339d48d5223`:

1. **App registrations → (this app) → API permissions → Add a permission → Microsoft Graph →
   Delegated permissions.** Add all ten scopes from the table above.
2. **Grant admin consent for <tenant>.** Confirm each of the ten shows *"Granted for <tenant>"* with a
   green check. If any stays un-consented, its Teams tools will `403` at call time.

> No new client secret or app-audience change is required — Phase 2 reuses the existing OBO topology
> (the app is already a confidential client and already exposes its API for the OBO assertion). This
> step only broadens the **downstream Graph** permissions the OBO token may carry.

### 2. `[CONFIG]` Append the scopes to `librechat.yaml`

Add the ten scopes to `Microsoft365.obo.scopes` (space-separated, on the existing Phase-1 value):

```yaml
  Microsoft365:
    # ...
    obo:
      scopes: "User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All Chat.Read ChatMessage.Read ChatMember.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All ChannelSettings.Read.All TeamMember.Read.All TeamsTab.Read.All TeamsAppInstallation.ReadForUser"
```

This is what makes the OBO exchange request a Graph token that carries the Teams scopes.

### 3. `[CONFIG]` Append the same scopes to `MS365_MCP_ALLOWED_SCOPES`

In **`docker-compose.override.yml`** (local) and **`docker-compose.prod.yml`** (prod), extend the
`mcp-m365` env var set in Phase 1 so it matches `obo.scopes` exactly:

```yaml
    environment:
      MS365_MCP_ORG_MODE: "true"
      MS365_MCP_ALLOWED_SCOPES: "User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All Chat.Read ChatMessage.Read ChatMember.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All ChannelSettings.Read.All TeamMember.Read.All TeamsTab.Read.All TeamsAppInstallation.ReadForUser"
```

> `MS365_MCP_ALLOWED_SCOPES` and `obo.scopes` **must stay identical.** One gates the tool registry, the
> other gates the token; drift means either invisible tools or `403`ing tools.

### 4. `[DEPLOY]`

- **`librechat.yaml`** is the yaml deploy path: `git push` + on prod `git pull` +
  `./prod.sh restart api`. (No `dist` rebuild — it's config only.)
- **Compose env** change: recreate the sidecar — local `docker compose up -d mcp-m365`; prod recreate of
  `mcp-m365` after the pull. No image rebuild.
- **Re-login** so the next OBO exchange mints a token carrying the new scopes. (The OBO token cache is
  keyed by the scope string, so changing `obo.scopes` forces a fresh exchange on the next tool call.)

### 5. `[VERIFY]`

1. Sign in via **"Continue with Microsoft"**.
2. Ask, e.g., *"List my Teams chats"* → expect a `list-chats` call returning data; then
   *"Show recent messages in <channel>"* → `list-channel-messages`.
3. In `logs/debug-YYYY-MM-DD.log`, `Storing tool context: N tools` should rise by the 21 Teams read
   tools.
4. If Teams tools appear but every call `403`s → a scope is not admin-consented (revisit Step 1). If
   Teams tools **don't appear at all** → `MS365_MCP_ALLOWED_SCOPES` is out of sync with `obo.scopes`
   (revisit Step 3) or the sidecar wasn't recreated.

---

## Rollback

1. Remove the ten Teams scopes from `MS365_MCP_ALLOWED_SCOPES` and recreate the sidecar → Teams tools
   disappear from the surface immediately (fastest kill switch, no Entra action).
2. Remove them from `librechat.yaml` `obo.scopes` and redeploy (api restart) → the OBO token stops
   carrying Teams scopes.
3. Optionally, revoke the delegated permissions / admin consent in Entra to fully remove the grant.

---

## Notes

- **Kill switch is the sidecar, not Entra.** Because the tool surface is gated by
  `MS365_MCP_ALLOWED_SCOPES`, you can instantly hide Teams tools by trimming that env var and
  recreating the sidecar, without waiting on an Entra change.
- **This does not change login or the OBO assertion** (still `access_as_user` on the app's own API).
  It only widens the *downstream* Graph permissions — so it carries none of the login-break risk of the
  original `OPENID_SCOPE` changes (see `m365-obo-entra-admin-runbook.md`).
- **Writes remain disabled** — no `.ReadWrite` scopes are added and the surface stays read-only.
