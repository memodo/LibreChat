# RESEARCH-015: LibreChat v0.8.5 — BYOT placeholder vs UI-source MCP tool persistence

**Status:** Stub — investigation needed. Created 2026-05-19 during SPEC-014 deployment debug.
**Triggering deployment:** SPEC-014 M365 MCP Integration (Softeria + BYOT), prod commits
`986ab2b47` (impl) + `038c81021` (tmpfs fix) + `e7f7e5aac` (healthcheck 401).
**Related ADR:** [0001-mcp-byot-over-librechat-resolved-obo](../adr/0001-mcp-byot-over-librechat-resolved-obo.md).

## Problem statement

LibreChat v0.8.5 has **mutually-exclusive paths** for MCP server configuration that
prevent SPEC-014's BYOT-via-OBO pattern from reaching the agent runtime. The
SPEC-014 infrastructure layer (sidecar, BYOT plumbing, queue, JWT-invariant
validation, error envelope) is deployed and verified — but the agent never sees
M365 tools as callable functions. Three independent upstream issues, each on
its own enough to break the path:

### Issue A — yaml-sourced MCP servers don't persist toolFunctions to DB

When an MCP server is configured via `librechat.yaml` (`source: yaml`), LibreChat
v0.8.5 stores the server record in the admin DB with `tools` and `toolFunctions`
**absent** (compare to UI-sourced servers, which have both populated after first
discovery). Side effect: at agent runtime, `getMCPTools` returns empty for
yaml-sourced servers, `[initializeClient] Storing tool context: 0 tools`, and
`toolSchemaTokens: 0` is sent to the model. Verified in prod by:

- MongoDB query of `db.mcpservers` for the (UI-added) Cloudflare test server
  showing `tools: "search_cloudflare_documentation, ..."` AND `toolFunctions:
  {...}` and `initDuration: 974`.
- The yaml-sourced Microsoft365's analogous record showing absent `tools` and
  absent `toolFunctions`, with `initDuration: 0`.

### Issue B — admin UI does NOT support BYOT placeholder headers

The "Add MCP Server" dialog in v0.8.5 offers three Authentication modes:
`None (Auto-detect)`, `API Key`, `OAuth`. None of these accept a custom header
spec or pass a `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` placeholder through to the
runtime substitution pipeline. The yaml's `headers: { Authorization: "Bearer
{{...}}" }` pattern has no UI equivalent.

Test path (API Key with placeholder as the key value) showed LibreChat encrypts
the apiKey at rest (`config.apiKey.key` is hex-encoded ciphertext with IV
prefix, `authorization_type: "bearer"`). Whether `processMCPEnv` placeholder
substitution actually runs on the decrypted value at call time is **not yet
verified** — but rendered moot by Issue C.

### Issue C — UI-source rename doesn't propagate to discovered tool keys

When a server is added via the UI with name `Microsoft365`, LibreChat appears to
run discovery against a placeholder name `temp_server_name` BEFORE applying the
user's chosen name. The user-chosen name lands at:

- `serverName: "microsoft365"` (lowercased)
- `config.title: "Microsoft365"` (case preserved)

But the 172 discovered `toolFunctions` entries are keyed with `_mcp_temp_server_name`
suffix, NOT `_mcp_Microsoft365` or `_mcp_microsoft365`. The agent's stored
`agent.tools` (from when the server was yaml-sourced) uses `_mcp_Microsoft365`
suffix. Three-way mismatch: agent expects one suffix, DB stores another, runtime
resolver sees a third.

## What's known to be working

The SPEC-014 infrastructure layer IS deployed correctly. The next investigator
should NOT redo this work:

- `mcp-m365` sidecar (Softeria 0.110.0) running and healthy. End-to-end
  `curl POST /mcp` initialize succeeds with a valid Bearer token; returns
  `protocolVersion: "2025-11-25"` + tool list of 172 entries (with `--org-mode`
  off filtering out 133 Teams/SharePoint-admin tools).
- `MCPCallQueue` + `errorEnvelope` + REQ-020/021/022/027 implementations in
  `packages/api/src/mcp/` are compiled into `dist/index.js` and active in the
  api container (confirmed via `grep -c MCPCallQueue dist/index.js: 5`).
- `GraphTokenService` with JWT-invariant validation + single-flight + retry
  classification + scope cache-key normalization is in the rebuilt
  `dist/index.js` too.
- `processMCPEnv` + `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` resolver are wired and
  verifiable via the per-user reinit logs at sign-in (`[MCP Reinitialize]
  Successfully established connection for Microsoft365`).
- LibreChat's per-user MCP connection establishes at sign-in (the
  `Connection successfully established` log appears every time), but the
  connection state flips to `disconnected` between sign-in and agent runtime
  according to the `/status` admin endpoint.

## Investigation paths

In rough order of effort:

1. **Upgrade LibreChat.** v0.8.6+ may have fixed any of A/B/C. The bootstrap
   log already notes "Outdated Config version: 1.3.6 / Latest version: 1.3.9"
   for the config schema; a corresponding LibreChat release likely exists.
   Re-test SPEC-014 against the upgrade before patching anything.

2. **Patch Issue A (yaml-source tool persistence) only.** Likely scope: trace
   `mcpManager.getServerToolFunctions(userId, serverName)` for the yaml-source
   branch; verify it actually queries `tools/list` against the sidecar with the
   user's resolved Bearer header rather than using an empty cache. Source:
   `@librechat/api`'s MCPManager class (compiled in `node_modules/@librechat/
   api/dist/index.js`; src not directly in this repo).

3. **Patch Issue B (UI auth modes) only.** Add a "Custom header" or
   "Placeholder reference" auth mode to the Add-MCP-Server UI. Wire it to
   the same `processMCPEnv` substitution path the yaml code uses. May require
   client + server changes.

4. **Patch Issue C (UI rename propagation) only.** When the user clicks Save,
   ensure `toolFunctions` keys are rewritten to use the saved serverName, not
   the discovery-time `temp_server_name` placeholder. Likely a single function
   change in the server-save controller.

5. **File issues upstream against danny-avila/LibreChat.** Provide reproducer
   steps + the DB inspection commands from this debug session. Issues A and C
   look like clear bugs; Issue B is more of a feature gap.

## What NOT to do

- Do not declare SPEC-014's implementation incomplete. The SDD spec's deliverables
  (sidecar, BYOT plumbing, queue, JWT-invariant validation, error envelope,
  Verification Plan §1-18 smoke tests up to the LibreChat API boundary) are all
  done. SPEC-014 implicitly assumed LibreChat's MCP-to-agent bridge worked; that
  assumption was wrong. The fix is outside SPEC-014's scope, not a gap in its
  deliverables.
- Do not retry yaml-source ↔ UI-source migration ad-hoc. Both paths are broken
  in v0.8.5 in different ways. Picking one without fixing the underlying issues
  produces another half-working state.
- Do not modify the sidecar configuration further. It's working end-to-end and
  the BYOT contract is correct.

## Open questions for the investigator

1. Does upgrading LibreChat to the latest minor (whatever is current at investigation
   time) fix any of A/B/C without further patching? If yes, that's the cheapest
   path.
2. Is there a community LibreChat thread or issue about BYOT MCP tools + agents
   that suggests a known workaround?
3. If patching: which path (A, B, or C) is the smallest diff for the most
   benefit? Hypothesis: A alone may be sufficient if it makes yaml-source
   tool discovery work end-to-end.

## Pointers

- Spec: `SDD/requirements/SPEC-014-m365-mcp-integration.md`
- Implementation summary:
  `SDD/prompts/implementation-complete/IMPLEMENTATION-SUMMARY-014-2026-05-19_10-30-00.md`
- ADRs: `SDD/adr/0001-mcp-byot-over-librechat-resolved-obo.md`,
  `SDD/adr/0002-readonly-default-delegated-graph-scopes.md`
- Progress log: `SDD/prompts/context-management/progress.md` (see the SPEC-014
  section and the operator walkthrough closeout block).
- Relevant LibreChat files in the running container (paths inside `/app`):
  - `api/server/controllers/mcp.js` — `getMCPTools` REST endpoint (where the
    `No tools found for server X` log originates).
  - `api/server/services/MCP.js` — service-layer MCP integration.
  - `api/server/services/Tools/mcp.js` — agent-side MCP tool bridge.
  - `node_modules/@librechat/api/dist/index.js` — compiled `MCPManager` etc.
    (src is in this repo's `packages/api/src/`).
  - `node_modules/@librechat/agents/src/` — agent runtime (LLM tool injection
    happens here).
