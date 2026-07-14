# Progress

## Current State

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-14_15-53-57.md`
- **Working on:** feature/015 (v0.8.7 + M365 OBO) post-upgrade follow-up — test verification COMPLETE,
  agent capabilities enabled, **all 3 fix branches merged** (Findings #1/#2/#3 RESOLVED). Ad-hoc, NOT an
  SDD phase.
- **Branch:** `feature/015-m365-obo-v0.8.7` at `eee1b7668`, working tree clean (except this progress.md +
  untracked compaction file). **14 commits ahead of origin `b61a9c08e`** (clean fast-forward; unpushed
  pending user OK). Test box `chat-test.memodo.de` at `b61a9c08e`.
- **Status (2026-07-14):**
  - Test verification (Part B + C1–C3) VERIFIED; C4 = adoption review
    (`docs/v0.8.7-feature-adoption-decisions.md`). 4 findings logged in
    `docs/test-verification-015-m365-obo-v0.8.7.md`.
  - **Agent capabilities** `memory`+`chain`+`skills` enabled (`b61a9c08e`) — yaml-only, LIVE on the test box.
  - **Finding #1 RESOLVED:** merged `fix/convlog-guardrail-mirror` (`f64ddab7c`) → merge `97bdefdaf`;
    back-link test 4/4; marked resolved (`b940e58a6`).
  - **Finding #2 RESOLVED:** merged `fix/onedrive-list-files` (`f9f419875`+`1495f90a6`) → merge `f2a535581`;
    3-point check green, YAML valid; resolved (`84325ddc1`). **+ v7 UX-002 field-minimization directive**
    added (`05c8acc8c` → merge `fa0e9eb97`) for full UX-002 parity (field-min + non-enum both present);
    marker v6→v7, checksum `ac4f517a…` reproduced+verified on the merged body (`eee1b7668`).
  - **Finding #3 RESOLVED:** merged `fix/inject-git-build` (`66e17d3ab`) → merge `e1bc41554`; `build.spec.ts`
    5/5, consumer `packages/api/src/app/build.ts` already in tree (upstream `6d6ea08da`); resolved (`bfaea66ed`).
  - **Finding #4** (rag DELETE 404, Low, no branch) — still open, monitor only.
  - ⚠️ **Data-exposure incident remediated:** real personal/M365/infra data was pushed to the PUBLIC fork,
    then scrubbed + history-rewritten + force-pushed (orphaned `9f549c271`/`f0fa876f4`/`c678dcf8b`; may
    linger in GitHub caches). No credentials leaked. See `[[project_test_env_chat_test]]`.
- **Decisions (2026-07-14, user):** **DO NOT push** feature/015 yet (stays local at `bfaea66ed`, 11 ahead
  of origin). **DO NOT deploy** the fixes to the test box yet (box stays at `b61a9c08e`). Both held — to be
  batched with the pablo FF / prod rollout later.
- **Next step (when resumed):** **fast-forward `pablo`** (promotes the whole v0.8.5→v0.8.7 upgrade + all 3
  fixes) → **prod deploy** per `docs/deploy-checklist-015-m365-obo-v0.8.7.md`. Deploy scopes for the fixes
  (for when it happens): #2 (yaml+checksum) + #3 (deploy scripts+compose env) = `git pull` +
  `./test.sh up -d --force-recreate api` (no rebuild); #1 (convlog) needs conv-log rebuild
  (`./test.sh up -d --build conv-log`) + api dist rebuild (touches
  `api/server/controllers/agents/request.js`), NOT yaml-only. Finding #4 (rag DELETE 404) stays open/monitor.

## Notes

- Prior 2026-07-08 state (M365 tool-attachment fix, OBO refresh, People Search, Phase-1 SharePoint read,
  v4 steering) is captured in the prior compaction (`compact-2026-07-07_15-57-33.md`) + the
  `project_m365_mcp_integration` / `project_test_env_chat_test` memories.
- Full detail + resume plan for THIS session: the compaction file referenced above.
- Deploy discipline: yaml-only change = git pull + recreate api; code change (conv-log / api dist) = rebuild required.
