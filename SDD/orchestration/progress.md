# Progress

## Current State (2026-07-27 17:02)

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-27_17-02-51.md`
- **Working on:** **PROD CUTOVER** of `feature/015-m365-obo-v0.8.7` to `chat.memodo.de`. Ad-hoc deploy
  work, NOT an SDD phase (SDD-FLOW 019 closed 2026-07-23 — see History). Deploy target branch is **`memodo`**
  (prod tracks it); `pablo` → `memodo` is a verified clean fast-forward (692 commits, 0 conflicts).
- **Prep COMPLETE, execution PENDING — prod has NOT been touched.** Deploy checklist item 4 (the last
  ⚠️ OPEN item) is **closed: build from source on prod**; the upstream registry image was rejected on
  evidence (our tree = v0.8.7 GA + ~96 post-GA commits, so the `v0.8.7` tag is OLDER than our code and
  crash-loops with our dist on an eager `@langchain/langgraph-checkpoint-mongodb` require).
- **Local commits not yet pushed:** `9cf4d4c12` (prod-sync host fix) + `516972353` (checklist/runbook).
  `pablo` is ahead 2 of `origin/pablo`.
- ⚠️ **Two traps to carry into the window:** (1) prod's dist overlays are v0.8.5-era (`index.js`, no
  `index.cjs`) and mount OVER the new image — build **and** rsync, and back the old dist up first or
  rollback is impossible; (2) only **item 1b** needs an `.env.prod` edit (items 1 and 1c verified
  already-correct on the box), and it must be re-chown'd `1000:1000` immediately after.
- **Next step:** runbook §5 of `docs/deploy-checklist-015-m365-obo-v0.8.7.md`, from step 0
  (`ssh memodo-eng-prod hostname` → FF-merge → push `memodo`). Full detail in the compaction file.
- **Carried forward (still open, NOT upgrade-blocking):** the chat-test box has a manually-edited
  **dirty `librechat.yaml`** — the `memory.agent.enabled: true` fix was applied by hand there on
  2026-07-23 (backup `librechat.yaml.bak-mem019`). Reconcile at formal deploy:
  `git checkout librechat.yaml && git pull`. Prod is unaffected (it gets the flag via the repo yaml).

---

## History (rotated 2026-07-27 17:07)

This file is deliberately scoped to the **v0.8.7 + M365 upgrade/cutover**. Completed work was moved
out verbatim — nothing was summarized or discarded:

- **`progress-archived-2026-07-27_17-07-24.md`** — SDD-FLOW 019 (memory-write-fix, closed `DONE (2026-07-23)`); the prior
  feature-015 ad-hoc recording head; and the full "What's New (July 2026)" tutorial pipeline
  (recording → narration → MP4 → transcript → written guide → `/guide` selector), all shipped in
  commits `0dbafdf7b`…`8bad53a03`.
- Earlier rotations: `progress-archived-2026-07-22_10-19-36.md`,
  `progress-archived-2026-07-07_15-57-33.md`, `progress-archived-2026-06-16_18-10-43.md`.
- Session compactions live in `SDD/orchestration/compacted/` — latest
  `compact-2026-07-27_17-02-51.md` (full cutover state + runbook).
