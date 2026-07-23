# Progress

## Current State

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-22_12-37-01.md` (recording session).
- **Working on:** the standalone **"What's New (July 2026)"** MemodoAI update deliverable. **Screen recording
  of the companion video is COMPLETE** (operator-driven OBS; I drove the browser through the 7-chapter
  `docs/memodo-ai-tutorial/updates-2026-07/recording-script.md`; browser session wrapped up 2026-07-22).
  Now moving to the post-recording pipeline. **Ad-hoc docs work, NOT an SDD phase.**
- **Branch:** `pablo-oliva/docs-memodo-ai-tutorial`. All changes **UNCOMMITTED** (user commits/pushes manually).
- **Environment:** chat-test.memodo.de (v0.8.7-rc1 + M365; `ssh memodo-eng-test`), Microsoft SSO, window 1440×900.

- **Recording protocol (chapter-by-chapter):** I set the starting frame + say "ready" → user records →
  "go" → I drive one chapter then STOP → user cuts → "next".

- **Recording status (2026-07-22 + Ch3B 2026-07-23):** SCREEN RECORDING COMPLETE — ALL chapters.
  - ✅ **Ch 0 (cold open), Ch 1 (Microsoft 365), Ch 2 (Skills, Parts A+B), Ch 3 Part A (Chaining, incl. live
    run), Ch 3 Part B (Memory), Ch 4 (Projects), Ch 5 (Quality-of-life, Steps 5.1–5.4)** — RECORDED, all clean.
    - Ch 4: created `Q3 Planning` project (user deleted a stale pre-existing one first, then I created it fresh)
      → project page (`10-projects-sidebar.png`).
    - Ch 5.1 context meter ("Context 527 / 361k (0%)"); 5.2 XLSX rich preview card ("Spreadsheet"); 5.3 hover
      timestamp ("2 hours ago"); 5.4 instant title ("Ocean Fun Facts" appeared before reply finished).
  - ✅ **Ch 3 Part B (Memory) — RECORDED 2026-07-23** (was parked; memory-write fix now LIVE on chat-test per
    [[project_memory_write_broken_v087]] RESOLVED). Clip `2026-07-23 11-10-22.mkv` (=clip12 in the edit sheet).
    Pre-flight: verified write persists (today-dated entries existed), then deleted the two overlapping test
    memories (`team_affiliation_frontend`, `communication_preference_bulleted_concise`) so the on-camera save
    was fresh. On-camera: reply showed "Updated saved memory" + "Saved: You are on the Frontend team." /
    "Preference saved: concise, bulleted answers." + Memories panel reveal (usage 3%→4%, `09-memory-updated.png`).
    - Test artifacts left on chat-test (harmless): `Q3 Planning` project, `Ocean Fun Facts` chat, and the
      memory demo's two fresh entries + "Frontend Team: Concise…" chat.
    - Memory demo entries (Frontend team / concise-bulleted): user chose to **KEEP** (2026-07-23) — they're
      his real prefs; NOT deleted despite the script's "delete afterward" note.
  - ➖ **Ch 7 (Wrap-up):** narration-only; intended visual is a post-production outro card (logo + CTA), NOT a
    live screen capture. Nothing to drive in-browser.
  - ⏭️ **NEXT: post-recording pipeline** (see below).

- **Pre-recording assets DONE (prior sessions):** written guide (UI-verified), 14 screenshots, shot list +
  narration, folder reorg (Option A), shared root tooling — see prior compaction `compact-2026-07-22_10-19-36.md`.

- **Prereqs VERIFIED + persist on chat-test:** M365 MCP Active (OBO tool call works), `meeting-notes` skill
  exists, `Chain Test Primary`→`Uppercase Bot` chain wired, sample XLSX at `~/Downloads/MemodoAI-sample-roadmap.xlsx` (+ scratchpad copy).

- **Post-recording pipeline:** ✅ narration render DONE (7 MP3s in `updates-2026-07/audio/`, 7:14, gitignored)
  → ✅ **ASSEMBLE the cut DONE** (user-owned; final export `updates-2026-07/july-2026-updates.mpg`, MPEG-2
  1440×900/60fps, 7:01) → ✅ **MP4 CONVERSION DONE 2026-07-23** (`july-2026-updates.mp4`, 23.4MB; matched the
  intro-video profile `LibreChat/docs/memodo-ai-tutorial/MemodoAI-intro.mp4`: H.264 High/L4.2 yuv420p 1440×900
  60fps, AAC-LC 48k stereo, +faststart; CRF 20, landed ~310kbps ≈ ref's ~290) → ✅ **TRANSCRIPT DONE 2026-07-23**
  (`transcript/transcript.en.{srt,vtt,txt,json}`, 127 cues, 0:03→7:00, 1021 words; whisper large-v3 + VAD, clean
  no loop; post-fixed "Memodo AI"→"MemodoAI" ×3 across all 4 files) → ⏭️ **NEXT = transcode-for-delivery (if a
  smaller/streaming variant needed — MP4 already web-ready w/ faststart) + bilingual HTML export → `/guide`
  selector (`Guide.tsx`) → deploy** (chat-test now; prod at v0.8.7+M365 cutover). Plus evergreen getting-started/
  §7 corrections + stale `docs/m365-mcp-features.md` header. NOTE: transcript reflects the final cut, whose §07
  wrap-up audio is SHORTER than narration `section-07.mp3` (editor trimmed the M365-CTA middle; ends "…none of
  it changed. Thanks for watching.") — expected, not an error.
  - ✅ **§03 memory RESOLVED 2026-07-23:** memory-write fixed + Ch3B filmed (clip12); keep full `section-03.mp3`
    as rendered (NO re-render); §03 = chaining + memory, bumper "Chaining & Memory".

- **Written guide FINALIZED 2026-07-23:** `updates-2026-07/updates-july-2026.md` (companion to
  getting-started/memodo-ai-tutorial.md). Was already content-complete; this pass: removed stale draft-status
  banner/footer (screenshots all captured + UI verified via recording incl. memory); **trimmed 3 unverified
  claims** per Pablo (dropped "Planner" from M365 list → To Do example; "file and code previews" → "file
  previews"; removed unconfirmed long-chat "navigation strip" bullet); **added 4 captured screenshots** (07/07b
  skills-in-use+output, 08 chain-config, 14 message-timestamp). All 15 image refs resolve; 7 sections match
  getting-started house style. NEXT for guide: bilingual (EN/DE) HTML export → `/guide` selector (Guide.tsx).

- **`/guide` selector IMPLEMENTED 2026-07-23 (CODE WRITTEN, NOT YET TESTED):** app code, not docs.
  - `client/src/routes/Guide.tsx` refactored: parameterized by a `GuideDef[]` (getting-started + updates-2026-07),
    inline **tab toggle** at top (role=tablist), default = Getting Started. Per-guide video/captions/transcript/
    chapters/written paths; caption+transcript language toggles adapt to each guide's available langs (July video
    = EN-only; both written HTMLs bilingual). `<video key={guide.id}>` remounts on switch.
  - i18n (EN only, `client/src/locales/en/translation.json`): added com_ui_guide_july2026_title/_subtitle,
    _tab_getting_started, _tab_july2026, _tabs.
  - Test `Guide.spec.tsx`: added a tab-switch test (July title + written-guide href); existing tests unchanged.
  - Chapters: generated `updates-2026-07/transcript/chapters.json` (7 chapters, timings from the transcript).
  - **⚠️ NOT validated** — worktree has NO node_modules (jest/tsc/build can't run here). Merge to main repo
    (`/Users/pablooliva/Dev/AI dev/LibreChat`, base branch `feature/015-m365-obo-v0.8.7`) to run jest + typecheck
    + build + visual check. DEPLOY = `npm run build` + `./prod-sync.sh` (client/dist bind-mounted) PLUS copy
    July media into the prod `guide-media/` mount: `updates-2026-07/{july-2026-updates.mp4, transcript.en.vtt,
    transcript.en.txt, chapters.json, july-2026-updates.html}` (guide-media is bind-mounted, not git).

- **Source of truth:** `docs/memodo-ai-tutorial/updates-2026-07/{recording-script.md, recording-narration.md,
  UPDATE-PLAN-v0.8.7-m365.md}`; memory `project_july2026_updates_tutorial`, `project_memory_write_broken_v087`.
