# Progress

## Current State

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-06-16_18-10-43.md`
- **Working on:** ad-hoc LibreChat **v0.8.5 → v0.8.6** upstream upgrade (NOT an SDD phase).
- **Branch:** `feature-upgrade-15-06-26` @ `717b04527` — the entire upgrade is isolated here.
  Local only (push blocked: PAT lacks `workflow` scope; the merge touches ~19
  `.github/workflows/*`).
- **Status:** Re-targeted from `origin/main` HEAD to the **v0.8.6 release tag** (`566e20b6`)
  after the HEAD merge crash-looped. Validated: full build green (api dist=`index.js`, matches
  the v0.8.6 image), static check, **86** PII unit/integration tests, **151** data-schemas
  tests, stack **boots clean** on the v0.8.6 image, redakt detects PII correctly.
  `pablo` (`16a417f8f`) and `memodo` (`be0f8577a`) reverted to pre-upgrade (local + remote).
- **Next step:** stand up the v0.8.6 stack and test PII end-to-end with redakt (warn/detect);
  then decide how to land the branch (`workflow` token scope vs strip workflow-file changes)
  and the deferred prod deploy. See the compaction file for the step-by-step resume plan.

## Notes

- Full upgrade detail is durable in the `project_v086_upgrade` memory.
- Prior `progress.md` contents (SPEC-016 Conversation Log Sidecar, 702 lines) were archived to
  `SDD/orchestration/progress-archived-2026-06-16_18-10-43.md` — unrelated to this upgrade.
- This file and the compaction file are intentionally **uncommitted**.
