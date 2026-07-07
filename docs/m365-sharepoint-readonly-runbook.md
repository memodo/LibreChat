# M365 MCP — Enable read-only SharePoint (Phase 1)

**Audience:** LibreChat operator (deploys config; no Entra admin action required).
**Goal:** Surface the Softeria sidecar's **read-only SharePoint** tools (sites, drives, lists,
list-items, and SharePoint-hosted OneNote) to the Microsoft 365 assistant.
**Time:** ~10 minutes + a re-login.
**Prerequisite:** M365 MCP is already working end-to-end (native OBO; the `"tools"` agent capability is
enabled). See `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.
**Companion:** Teams needs new Entra-consented scopes — see
[`m365-teams-readonly-runbook.md`](m365-teams-readonly-runbook.md) (Phase 2).

---

## Why this is a config-only change

The Softeria sidecar (`ms-365-mcp-server`) classifies each tool by the Graph scope it needs:
**personal** scopes (e.g. `Mail.Read`) vs **organizational / work** scopes (e.g. `Sites.Read.All`).
By default the sidecar runs in *personal* mode and filters out every work-scoped tool — which is why
SharePoint (and Teams) tools don't appear even though they include read-only operations. The gate is
**org-mode**, a different axis from read/write.

The 18 SharePoint **read** tools need only `Sites.Read.All` and `Notes.Read`. LibreChat already grants
`Sites.Read.All` and `Notes.Read.All` in `librechat.yaml` `Microsoft365.obo.scopes`, and those are
already admin-consented and working. So Phase 1 is purely: **turn on org-mode, and constrain the tool
surface to the scopes we already grant.** No Entra change, no `librechat.yaml` scope change.

Two sidecar env vars do it:

| Env var | Effect |
|---|---|
| `MS365_MCP_ORG_MODE=true` | Un-filters the organizational tool categories (SharePoint, Teams, directory). |
| `MS365_MCP_ALLOWED_SCOPES="<space-separated>"` | Registers **only** tools whose required scopes are all covered by this set. The matcher understands scope hierarchy (`Notes.Read.All` covers `Notes.Read`). |

Setting `MS365_MCP_ALLOWED_SCOPES` equal to the granted `obo.scopes` makes the exposed tool surface a
pure function of what we grant: SharePoint **read** tools appear; Teams tools stay filtered (their
scopes aren't granted); and — a deliberate bonus — the ~104 write tools that currently register and
`403` at Graph drop out, giving a genuinely read-only surface.

> **Keep these in sync.** `MS365_MCP_ALLOWED_SCOPES` (sidecar) and `Microsoft365.obo.scopes`
> (`librechat.yaml`) are two copies of the same intent — one gates the tool registry, the other gates
> the OBO token. If you change one, change the other.

---

## Current value to mirror

`librechat.yaml` → `Microsoft365.obo.scopes` (as of this runbook):

```
User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All
```

---

## Steps

### 1. `[CONFIG]` Add the two env vars to the `mcp-m365` service

The `mcp-m365` service is defined in **`docker-compose.override.yml`** (local) and
**`docker-compose.prod.yml`** (prod). Add the same `environment:` block to **both** so local and prod
stay consistent:

```yaml
  mcp-m365:
    build:
      context: ./mcp-m365
      # ... existing args ...
    container_name: mcp-m365
    # ... existing config ...
    environment:
      # Surface organizational tool categories (SharePoint, Teams, directory).
      MS365_MCP_ORG_MODE: "true"
      # Register only tools whose required scopes we actually grant. MUST stay in
      # lockstep with librechat.yaml Microsoft365.obo.scopes. All-read => read-only surface.
      MS365_MCP_ALLOWED_SCOPES: "User.Read Mail.Read Calendars.Read Files.Read.All Sites.Read.All Contacts.Read Tasks.Read Notes.Read.All"
```

No image rebuild is needed — these are runtime env vars, read on sidecar start. The SHA-pinned
Dockerfile (`mcp-m365/Dockerfile`, `ENTRYPOINT [... --http 3000 --toon]`) is left untouched.

### 2. `[DEPLOY]` Recreate only the sidecar

- **Local:** `docker compose up -d mcp-m365` (recreates the container with the new env). The LibreChat
  API does not need restarting — it re-reads the sidecar's tool list on the next connect.
- **Prod:** `git push` the compose change, then on prod `git pull` and recreate the sidecar via the
  standard deploy tooling (`./prod.sh` recreate of `mcp-m365`). No `packages/*` build, no image rebuild.

### 3. `[VERIFY]` Re-login and test

1. Sign in via **"Continue with Microsoft"** (a restart clears the session).
2. Enable **Microsoft365** in a chat and ask, e.g., *"Search my SharePoint sites"* or
   *"List the document libraries in <site>"*.
3. Confirm a `search-sharepoint-sites` / `get-sharepoint-site` / `list-sharepoint-site-drives` tool
   call runs and returns real data (not a hallucinated answer).
4. In `logs/debug-YYYY-MM-DD.log`, confirm `Storing tool context: N tools` reflects the new surface:
   the ~104 write tools drop out and the 18 SharePoint read tools appear (expect roughly **86** tools:
   ~68 personal reads + 18 SharePoint reads — confirm the exact count from the log).

---

## Rollback

Remove the `environment:` block (or set `MS365_MCP_ORG_MODE: "false"`) and recreate the sidecar. The
tool surface returns to the prior personal set. No data or auth state is affected.

---

## Notes & gotchas

- **`Notes.Read` vs `Notes.Read.All`.** The four SharePoint-hosted OneNote read tools declare
  `Notes.Read`; you grant `Notes.Read.All`, and the matcher collapses hierarchy, so it should cover
  them. If those `*-sharepoint-site-onenote-*` tools don't appear, add a literal `Notes.Read` to
  `MS365_MCP_ALLOWED_SCOPES` and recreate.
- **Write-tool trimming is intentional.** Setting `MS365_MCP_ALLOWED_SCOPES` to read-only scopes
  removes the write tools from the surface entirely. That is the desired read-only posture; if you
  ever need writes, you must add the matching `.ReadWrite` scopes to *both* `obo.scopes` (with Entra
  consent) and `MS365_MCP_ALLOWED_SCOPES`.
- **Org-mode also un-filters the directory (`users`) and Teams categories** — but those tools stay out
  because their scopes (`User.Read.All`, `Chat.Read`, …) aren't in `MS365_MCP_ALLOWED_SCOPES`. That's
  the allowed-scopes filter doing its job.
- **Enumerate the required permissions authoritatively** at any time with
  `ms-365-mcp-server --list-permissions` (run inside the `mcp-m365` container).
