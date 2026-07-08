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
- **Phase 1 (read-only SharePoint) — DONE + VERIFIED end-to-end.** Config committed `ab7408c9a`:
  `MS365_MCP_ORG_MODE: "true"` + `MS365_MCP_ALLOWED_SCOPES` (the 8 read scopes, lockstep with
  `librechat.yaml:168` `obo.scopes`) on the `mcp-m365` block in BOTH `docker-compose.override.yml` and
  `docker-compose.prod.yml`. **Verified 2026-07-08** via fresh Entra login + SharePoint search: sidecar
  registered **93 tools / 212 skipped / 0 failed** (writes trimmed = read-only posture), and real Graph
  data returned from `list-sharepoint-list-columns`, `list-sharepoint-site-lists` (2 sites), and
  `list-sharepoint-site-drives`. Latency is LLM-dominated (GPT-5 ~10–22s/step); MCP/Graph round-trips
  sub-second.
- **Agent query-steering — committed `22e508a35`, tightened to v4 (uncommitted).** `librechat.yaml`
  `serverInstructions` v3→v4 steers the model off the two SharePoint-list traps (no `$filter` contains()/
  non-indexed `Title`; **NEVER** `fetchAllPages: true`) + refreshed REQ-028 baseline
  (`mcp-m365/serverinstructions.sha256`). Verification showed steering is **partial**: Defect 1 (filter)
  avoided; Defect 2 (`fetchAllPages`) still fired once but harmless (single page, caught+swallowed). See
  `docs/m365-softeria-fetchallpages-toon-bug.md` — upstream bug filed 2026-07-08; decision: keep `--toon`.
- **Next step:** Branch is verified locally. Sequencing agreed (2026-07-08): (1) **push
  `feature/015-m365-obo-v0.8.7` to origin** (needs user OK — nothing pushed yet); (2) deploy to the
  **test env** (`chat-test`, build-from-source) + full v0.8.7 regression; (3) **fast-forward `pablo`**
  once test green (⚠️ FF promotes the WHOLE v0.8.5→v0.8.7 upgrade: 651 commits, `pablo` is v0.8.5);
  (4) **prod deploy** — THREE paths (yaml `"tools"`+serverInstructions; `packages/api`+`api/*.js` build
  via `prod-sync.sh`; `.env.prod` People-Search flag + compose recreate; People Search on prod ALSO
  needs C.5 code). **Teams (Phase 2)** deferred to its own branch, gated on Entra admin sign-off.

## Notes

- Prior `progress.md` (v0.8.6 upgrade on `feature-upgrade-15-06-26`, 2026-06-16) archived to
  `SDD/orchestration/progress-archived-2026-07-07_15-57-33.md` — unrelated to this work; also durable in
  the `project_v086_upgrade` memory.
- Full session detail, key discoveries, and the step-by-step resume plan are in the compaction file above.
