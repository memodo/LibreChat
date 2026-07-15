# Progress

## Current State

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-15_10-38-20.md`
- **Working on:** feature/015 (v0.8.7 + M365 OBO) post-upgrade follow-up — all fix branches merged, C4
  decided, **fixes DEPLOYED to the test box and VERIFIED LIVE** (incl. a new Finding #5). Ad-hoc, NOT an SDD phase.
- **Branch:** `feature/015-m365-obo-v0.8.7` at `2969c529f`, working tree clean. **1 commit ahead of origin**
  (the Finding #5 RESOLVED doc — user pushes manually). Test box `chat-test.memodo.de` at `871149f13`
  (all containers healthy, v8 serverInstructions live).
- **Status (2026-07-15):**
  - **Findings #1/#2/#3/#5 all RESOLVED + VERIFIED LIVE on the box.** #4 (rag DELETE 404, Low) open/monitor.
  - **#1** conv-log mirror (merge `97bdefdaf`): live — `guardrail_events_log` 101 rows (was 0), decoupled
    watermark, back-links 101/101 msg-id. **#3** About build-metadata (merge `e1bc41554`): live — `/api/config`
    `buildInfo` populated. **#2** OneDrive q="*" steer (merge `f2a535581`) + **v7 field-min** (`fa0e9eb97`): live —
    clean `list-drives→get-drive-root-item→list-folder-files`, no 400.
  - **NEW Finding #5** (OneDrive wrong-drive): fixed **v8** serverInstructions (`a70895b7f`, checksum `2e40a0b0…`)
    + verified live (`2969c529f`) — fresh-convo "list my OneDrive files" now hits Dokumente drive, real ~20 items.
    driveType is `business` for all 3 drives (can't discriminate), no `/me/drive` tool → steer BY NAME (locale caveat).
  - **C3 image preview** verified (`c275414c3`). **C4 adoption decided** (`0194171d4`): adopt memory+chain+skills, rest off.
  - **Agent capabilities** `memory`+`chain`+`skills` live (`b61a9c08e`).
  - ⚠️ **Data-exposure incident** (earlier) remediated (scrub + force-push); origin is the PUBLIC fork. See `[[project_test_env_chat_test]]`.
- **Deploy mechanics (confirmed):** `./api/server` bind-mounted + conv-log builds from source → **no
  prod-sync/dist rebuild** for any merged fix. yaml/serverInstructions change = `git pull` + recreate api;
  conv-log fix = `./test.sh up -d --build conv-log`.
- **Remaining final test-env round (non-blocking):** Excel read (needs user `.xlsx` w/ planted value),
  memory/chain/skills smoke tests (test skill `memodo-signoff-test` ready), conversation delete. PII detect skipped.
- **Next step:** finish the round (user's pick of the 3 items) → push the pending commit → downstream:
  **fast-forward `pablo`** → **prod deploy** per `docs/deploy-checklist-015-m365-obo-v0.8.7.md`.

## Notes

- Prior 2026-07-08 state (M365 tool-attachment fix, OBO refresh, People Search, Phase-1 SharePoint read,
  v4 steering) is captured in the prior compaction (`compact-2026-07-07_15-57-33.md`) + the
  `project_m365_mcp_integration` / `project_test_env_chat_test` memories.
- Full detail + resume plan for THIS session: the compaction file referenced above.
- Deploy discipline (test box): yaml/serverInstructions or `./api/server` (bind-mounted) change = git pull + recreate api;
  conv-log = `--build conv-log`; only `packages/*/src` changes need `npm run build` + `./prod-sync.sh` (none merged this session).
