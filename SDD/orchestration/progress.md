# Progress

## Current State

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-07_15-57-33.md`
- **Working on:** M365 MCP integration follow-ups + read-only enablement (ad-hoc, NOT an SDD phase).
- **Branch:** `feature/015-m365-obo-v0.8.7` — local only (NOT pushed, NOT on prod). Working tree clean.
- **Status:** Shipped + committed this session (`1fe8e546b`..`ed23cf642`): M365 tool-attachment fix
  (missing `"tools"` capability), OBO token refresh (C.6), Entra People Search enabled + verified
  locally, and SharePoint/Teams/People-Search runbooks (+ Teams risk assessment). M365 tools verified
  working (172/173 attach, real Graph data); People Search verified via login group-sync (43 groups
  from Graph, 0 local-fallback).
- **Phase 1 (read-only SharePoint) — DONE (config) + committed `ab7408c9a`.** Added
  `MS365_MCP_ORG_MODE: "true"` + `MS365_MCP_ALLOWED_SCOPES` (the 8 read scopes, lockstep with
  `librechat.yaml:168` `obo.scopes`) to the `mcp-m365` block in BOTH `docker-compose.override.yml` and
  `docker-compose.prod.yml`. Sidecar recreated locally + healthy; startup log confirms `Organization
  mode enabled` and the read-only scope set (`Notes.Read.All`→`Notes.Read` collapsed by the hierarchy
  matcher, so OneNote reads are covered — no literal `Notes.Read` needed).
- **Next step:** (1) **User re-login verification** — fresh Entra SSO ("Continue with Microsoft"), then
  confirm in `logs/debug-*.log` that `Storing tool context: N` shifts to ~86 (write tools drop, 18
  SharePoint reads appear) and a `search-sharepoint-sites` call returns real data. Only the user can do
  the interactive login. (2) Then the branch **prod deploy** — spans THREE paths (yaml `"tools"` fix;
  `packages/api`+`api/*.js` build via `prod-sync.sh`; `.env.prod` People-Search flag + this compose
  recreate). People Search on prod ALSO needs the C.5 code deployed. See the compaction file for the
  full three-path deploy detail.

## Notes

- Prior `progress.md` (v0.8.6 upgrade on `feature-upgrade-15-06-26`, 2026-06-16) archived to
  `SDD/orchestration/progress-archived-2026-07-07_15-57-33.md` — unrelated to this work; also durable in
  the `project_v086_upgrade` memory.
- Full session detail, key discoveries, and the step-by-step resume plan are in the compaction file above.
