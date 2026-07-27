# Progress — ARCHIVED 2026-07-27 17:07

Rotated out of `SDD/orchestration/progress.md` during the v0.8.7 + M365 prod-cutover session,
to leave the live file scoped to the upgrade only. Everything below is **completed history**,
moved verbatim (byte-identical, not summarized):

- **SDD-FLOW 019 (memory-write-fix)** — full cycle, closed `DONE (2026-07-23)`. The fix
  (`memory.agent.enabled: true`) is in the repo yaml and is deploy-checklist item 1d.
- **The prior feature-015 ad-hoc head** (recording session, 2026-07-22) — superseded.
- **The "What's New (July 2026)" tutorial pipeline** — recording, narration, MP4, transcript,
  written guide, and the `/guide` selector. All shipped (commits `0dbafdf7b`…`8bad53a03`);
  the "⚠️ NOT validated" caveat on the selector is **obsolete** — it was merged and tested.

Carried forward to the live file (still open): the chat-test box's manually-edited dirty
`librechat.yaml` needs reconciling at formal deploy.

---

## SDD-FLOW 019 — memory-write-fix (STARTED 2026-07-22)

- **Task:** Debug + fix the v0.8.7 memory-WRITE regression on chat-test (writes don't persist; READ works; silent, no tool indicator, no logs).
- **Identifiers:** `[###]=019`, `[feature-name]=memory-write-fix`, `[YYYY-MM-DD]=2026-07-22`.
- **SKILL_ROOT:** `/Users/pablooliva/.claude/plugins/cache/pablooliva/agent-engineering/1.2.0/skills/sdd-flow`
- **Branch:** `feature/015-m365-obo-v0.8.7` (== chat-test build == prod cutover target).
- **Numbering rationale:** prior max = RESEARCH-018 / SPEC-017; next free slot = 019 (1:1 RESEARCH-019 ↔ SPEC-019 per feedback_sdd_flow).
- **Key lead for research:** progress.md 2026-07-15 recorded memory smoke "store→persist→cross-convo retrieve vs 14 real DB entries" as VERIFIED, but 2026-07-22 write is broken → discriminate latent-bug vs 07-15→07-22 regression via live DB query (memories collection, userId 69fb1a872eeae17e31b9e578, sort updatedAt desc).
- **Step 0:** scope assessment spawned.

---

## Current State (prior feature-015 ad-hoc follow-up — NOT this SDD feature)

- **Last compaction:** `SDD/orchestration/compacted/compact-2026-07-22_12-37-01.md` (recording session).
- **Working on:** the standalone **"What's New (July 2026)"** MemodoAI update deliverable. **Screen recording
  of the companion video is COMPLETE** (operator-driven OBS; I drove the browser through the 7-chapter
  `docs/memodo-ai-tutorial/updates-2026-07/recording-script.md`; browser session wrapped up 2026-07-22).
  Now moving to the post-recording pipeline. **Ad-hoc docs work, NOT an SDD phase.**
- **Branch:** `pablo-oliva/docs-memodo-ai-tutorial`. All changes **UNCOMMITTED** (user commits/pushes manually).
- **Environment:** chat-test.memodo.de (v0.8.7-rc1 + M365; `ssh memodo-eng-test`), Microsoft SSO, window 1440×900.

- **Recording protocol (chapter-by-chapter):** I set the starting frame + say "ready" → user records →
  "go" → I drive one chapter then STOP → user cuts → "next".

- Prior 2026-07-08 state (M365 tool-attachment fix, OBO refresh, People Search, Phase-1 SharePoint read,
  v4 steering) is captured in the prior compaction (`compact-2026-07-07_15-57-33.md`) + the
  `project_m365_mcp_integration` / `project_test_env_chat_test` memories.
- Full detail + resume plan for THIS session: the compaction file referenced above.
- Deploy discipline (test box): yaml/serverInstructions or `./api/server` (bind-mounted) change = git pull + recreate api;
  conv-log = `--build conv-log`; only `packages/*/src` changes need `npm run build` + `./prod-sync.sh` (none merged this session).

### Step 0 — scope-assessment subagent run
Status: COMPLETE. Verdict: PROCEED (single SDD cycle), no decomposition file written.
Code map verified accurate: client.js useMemory()/runMemory()/memoryPromise (L647,851,1541-42), cleanup.js L270-271, memory.ts buildInlineMemoryTool/processMemory/createMemoryProcessor/handleMemoryArtifact (L545,647,874,928) all confirmed present at stated lines.
Key decision: one coherent write-path chain (setup→invoke→cleanup-race candidate) touching 3 files, well under 8 REQ/EDGE items; no independent second defect found.
Pending: none — ready for RESEARCH-019 (memory-write-fix) to proceed.

### Step 1 / 1.5 — mode + clarification gate
Mode: **Supervised** (two checkpoints: post-research, pre-impl-commit).
Clarification: **Skipped (user opt-out, "proceed directly")** — equivalent to --skip-clarify; Step 2c critical review must record the gate-skip in its executive summary.
Next: Step 2 Research (RESEARCH-019).

### Step 2a — research subagent run (RESEARCH-019 memory-write-fix)
Status: COMPLETE. Doc: `SDD/research/RESEARCH-019-memory-write-fix.md`.
Verdict: NOT fully confirmed (read-only constraint) — best-supported hypothesis: gpt-5-mini post-turn extraction completes with no tool call (silent no-op, zero logs) OR the NEW (06-24, upstream #13869) inline memory-capability mechanism (independent 2nd write path, `capabilities:[...,"memory"]` in yaml) fails for the ephemeral-agent variant; cleanup-race + Azure-401 hypotheses RULED OUT by code+live evidence.
KEY: live DB (`memoryentries`, `updated_at`) shows 14 rows, newest 2026-06-10 — UNCHANGED since before 07-15 → the 07-15 "VERIFIED" memory smoke was a FALSE POSITIVE; bug is a latent regression from the 2026-06-22 v0.8.5→v0.8.7 merge, not a fresh 07-15→07-22 break.
Prod: NOT affected yet (still v0.8.5, pre-regression) — fix MUST ship before v0.8.7+M365 cutover. Tutorial: memory chapter ("Updated saved memory" indicator, recording-script.md L231 + memodo-ai-tutorial.md L239) must be reframed/cut until fixed.
Pending: Runtime Verification Plan (DEBUG_LOGGING + live SSO repro) requires user action — next is 2f supervised checkpoint.

### Step 2b — ADR capture: NO-OP (orchestrator routing)
No settled cross-cutting decision to capture: root cause unconfirmed → fix approach not yet selected among alternatives (research has comparison WITHOUT selection; cross-cutting-adr triggers on comparison-WITH-selection). Reconsider at the planning boundary (Step 3) once the fix mechanism is chosen.

### Step 2c — critical review run (RESEARCH-019 memory-write-fix)
Status: COMPLETE. Doc: `SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md`. Overall severity: MEDIUM (1 HIGH, 5 MEDIUM, 2 LOW). Decision: PROCEED WITH REQUIRED REVISIONS.
Design-Concept-Fidelity gate: SKIPPED (no CLARIFICATION-019, user opt-out) — recorded per body.
H1/H2 gap: **COLLAPSED statically** — regression is in the POST-TURN path (H1). All 14 DB rows predate the inline mechanism (`397ddc536`, verified 2026-06-24) and last write is 06-10, so H2 cannot regress pre-H2 behavior; inline is additionally toggle-gated (`ephemeralAgent.memory`→`Tools.memory`, added.ts:184/load.ts:76) and the "plain GPT-5" repro doesn't enable it.
Verified accurate: all git attributions (1d6c927e2/397ddc536/8fc231420 dates+ancestry), cleanup-race dismissal EARNED (await client.js:1720 in finally before null at 1760), gpt-5-mini NOT the cause (memory model since 03-30, wrote through 06-10).
Top finding: `397ddc536` (bucketed as "additive/independent" H2) actually refactored the post-turn `useMemory` setup (client.js +38/−11, memory.ts +499) → prime CODE suspect; diff it before any live repro.
Residual runtime-only Q (narrow): which 06-22-merge change broke post-turn — the `useMemory` refactor vs #13606 windowing/truncation vs genuine gpt-5-mini no-tool-call; settled by one log line (post-turn completes w/ no `set_memory` tool_end) + logged `memoryInput`.
Reads: 8/15 (safety-net not tripped).

### Step 2d — research-FIX subagent run (RESEARCH-019 memory-write-fix)
Status: COMPLETE. Doc updated: `SDD/research/RESEARCH-019-memory-write-fix.md`; review addendum: `SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md` ("Findings Addressed").
H1/H2: RESOLVED to H1 (post-turn) — H2 eliminated (postdates last write; toggle-gated, verified added.ts:184/load.ts:76/initialize.ts:1102-1104). NOT statically CONFIRMED to one line, but narrowed further: diffed `397ddc536` directly (task's top action) — it does NOT touch processMemory/Run.create/handleMemoryArtifact, so it's CLEARED as H1 cause (contra review's suspicion); also traced+cleared `8fc231420`'s windowing for this repro's shape (short chat never hits messageWindowSize=5/12000-token defaults).
New lead surfaced: `1b79e0b78` (LangChain-upgrade commit) adds `normalizeMemoryLLMConfig` (strips non-string apiKey) in memory.ts's finalLLMConfig — plausible but likely benign (fork uses static Azure API keys per `project_azure_endpoint_env_leak`). Recommended fix: new zero-cost Option A0 (trace apiKey population, no runtime) before Option A1 (live repro, toggle OFF).
Documented "72h logs"/n=1-user caveats honestly (corroborating not load-bearing) per review Findings 4/5; all HIGH/MEDIUM/LOW findings addressed in review addendum.
Still needs user: Option A1 supervised live repro (toggle explicitly OFF + ON runs) only if Option A0 (static, no user action) doesn't close the loop first.

### Step 2 (final) — A0 static-trace subagent run (RESEARCH-019 memory-write-fix)
Status: COMPLETE. Verdict: **CLEARED** — memory-agent azureOpenAI config/apiKey is NOT stripped/misrouted.
Trace: `useMemory()`→`initializeAgent`(initialize.ts:1175 overwrites agent.model_parameters with resolved `options.llmConfig`)→`getProviderConfig`/`initializeOpenAI` — same shared path as primary chat agent, no memory-specific branch. Standard (non-Responses-API) Azure branch (`openai/llm.ts:751-798`) never sets `.apiKey`; sets `azureOpenAIApiKey`/instance/deployment/version as plain strings via `Object.assign` (line 780) — fields `normalizeMemoryLLMConfig` (memory.ts:61-67) never touches (it only inspects `.apiKey`).
Live read-only check: `AZURE_OPENAI_API_KEY_SWEDEN` present/non-empty in box `/app/.env` (the actual gpt-5-mini group credential); distinct from the deliberately-emptied legacy `AZURE_OPENAI_API_KEY`/`ENDPOINT` pair.
Docs updated: `SDD/research/RESEARCH-019-memory-write-fix.md` (§5c CLEARED, Fix Options + Runtime Verification Plan revised, A0 marked DONE), `SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md` ("A0 static trace — CLOSED/CLEARED" appended).
Recommended fix: none code-level to apply yet — A1 (supervised live repro, toggle OFF) is now the ONLY remaining path to root cause; static investigation exhausted.
Reads: 11/15 (safety-net not tripped).

### Step 2e — commit research artifacts
Committed locally `0b72b85c2` (docs(sdd): RESEARCH-019 …) — RESEARCH-019 + CRITICAL-RESEARCH + progress.md. NOT pushed (Pablo pushes manually per feedback_pablo_branch). Counters left untracked (transient scratch).

### Step 2f — supervised checkpoint (RESEARCH complete)
Research phase COMPLETE. Root cause NARROWED BY ELIMINATION to a single runtime-only question: the post-turn ephemeral gpt-5-mini memory agent (H1) — every static suspect cleared. Decisive next step = A1 live debug repro (needs Pablo's SSO session + a box api restart). AWAITING user decision: (A) run A1 live now / (B) proceed to planning on hypothesis / (C) pause, user runs A1 later then /sdd-flow continue.

### Step 2f→A1 — live debug repro: BLOCKED on SSH + refined static finding
User chose (A) run A1 live repro now. NEW static finding (missed by 2a/2c/2d/A0): `awaitMemoryWithTimeout` (client.js:622-642) races memory processing against a 3s timeout (Promise.race); wired at 1542 (start) → 1720 (await ≤3s) → 1760 (null) → cleanup.js:270 (null processMemory). BUT commit 0c9284c8a (#8955, 2025-08-09) that introduced it is ALREADY IN v0.8.5 (tag-confirmed) → 3s timeout is NOT a standalone regression (v0.8.5 wrote fine with it). Reframe: memory is a background post-turn process → NO tool-call indicator is NORMAL, not a symptom. Hypothesis now: 3s timeout + a v0.8.7 change (slower gpt-5-mini call OR changed abort/teardown) cuts off the background write; OR model doesn't emit set_memory. Decisive = live debug logs.
BLOCKER: SSH port22 to 178.105.91.145 UNREACHABLE from my IP (firewall allowlist), though app HTTP 200 healthy. Cannot run box ops until SSH restored OR user runs the runbook. Grep targets: "Memory processing timed out"|"Memory set for key"|"MemoryAgent"|"Returned no content"|"Error processing memory". AWAITING user: restore my SSH (drive myself) vs run runbook themselves.

### A1 live diagnosis — SSH restored, box recon done, zero-restart probe pending
User re-allowlisted SSH (IP 79.205.210.123 = this Mac's egress). Box healthy (HTTP 200, LibreChat up 7d restarts=0). Recon: DEBUG_LOGGING NOT set; /app/logs has debug-*.log ONLY through 06-04 (06-11 = 0 bytes, none after) → v0.8.7 gates debug files behind DEBUG_LOGGING. error-2026-07-22.log = ONLY M365 MCP transport errors (expired token), ZERO memory errors → memory path throws no caught error. No timeout-warn in 48h stdout.
Plan: zero-restart probe first (3s-timeout warn is warn-level → stdout, no restart) — user runs one GPT-5 "remember" repro, I grep logs. If null → DEBUG_LOGGING=true + recreate api + repro for debug detail. AWAITING user "done" on the repro.

### A1 live repro — ROOT CAUSE CONFIRMED (100%)
Browser repro (real flow, authenticated session, GPT-5) reproduced the symptom: reply "Understood, sir... I will remember...", NO indicator (normal for background), auto-title OK. DB post-repro: Pablo memoryentries STILL 14, newest 2026-06-10, recent(15m)=0 → write did NOT persist.
LOG (warn, no debug needed): "[memory] Agent config detected without explicit `enabled: true`. Automatic memory extraction is now opt-in. Add `memory.agent.enabled: true`..."
CODE: packages/data-schemas/src/app/memory.ts isMemoryAgentEnabled() now requires `config.agent.enabled === true` (v0.8.7 opt-in change). Live yaml memory.agent has NO enabled key → returns false → useMemory takes non-agent branch (getRequestMemories = READ works) but never sets extraction processor → runMemory early-returns → silent no write.
FIX = one-line yaml: add `enabled: true` under memory.agent. YAML-only (git pull + restart api; no build/dist). Verifying live next.

### A1 — FIX VERIFIED LIVE (end-to-end)
Applied `memory.agent.enabled: true` to box librechat.yaml (backup: librechat.yaml.bak-mem019) + recreated api (healthy, restarts=0, opt-in warn GONE). Re-ran identical GPT-5 repro. DB: Pablo memoryentries 14→16, 2 rows updated_at 2026-07-23T07:26:27Z: team_affiliation_frontend="The user is on the Frontend team.", communication_preference_bulleted_concise="The user prefers concise, bulleted answers." Before fix = 0 new rows. FIX PROVEN.
BOX STATE: fix currently APPLIED on chat-test (yaml manually edited, uncommitted → dirty tree; memory works now). Repo librechat.yaml NOT yet changed. Prod (v0.8.5) needs same flag AT v0.8.7 cutover or memory silently breaks → deploy-checklist item. Tutorial memory chapter = NO cut needed, just deploy fix first.
Next: research/spec update + repo commit + prod checklist — pending supervised wrap-up decision.

### Step 3 — lightweight-finish wrap-up subagent run (memory-write-fix, 019)
Status: COMPLETE. Docs written/updated (no code changes):
- `SDD/research/RESEARCH-019-memory-write-fix.md` — Root Cause CONFIRMED (opt-in `enabled` gate) + Live Confirmation subsection (14→16 DB rows) + Fix Options/Impact/Tutorial Impact revised; historical H1/H2 analysis retained as superseded record.
- `SDD/requirements/SPEC-019-memory-write-fix.md` — NEW, concise (panel/eval intentionally skipped per frontmatter).
- `docs/deploy-checklist-015-m365-obo-v0.8.7.md` — new item 1d (prod cutover MUST add `memory.agent.enabled: true`).
- `SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md` — "Live Confirmation" note appended to Findings Addressed.
Key decision: fix is repo+chat-test applied; prod (still v0.8.5) needs it only at v0.8.7 cutover.
Nothing pending.

### SDD-FLOW 019 — DONE (2026-07-23)
Lightweight finish complete. Committed LOCAL `117d50444` (fix + RESEARCH-019 CONFIRMED + SPEC-019 + deploy-checklist 1d + review addendum). Repo librechat.yaml has the fix; chat-test box has it applied + verified live (memory writes work). Memories updated (project_memory_write_broken_v087 → RESOLVED, MEMORY.md index, tutorial memory note).
OPEN for Pablo: (1) push `feature/015-m365-obo-v0.8.7` when ready (2 unpushed commits: 0b72b85c2, 117d50444); (2) reconcile box dirty yaml at formal deploy (git checkout librechat.yaml && git pull); (3) prod cutover MUST include memory.agent.enabled:true (deploy-checklist 1d); (4) optional non-blocking: verify inline memory-capability toggle-ON (RESEARCH-019 Fix Option B). Panel/critical-review intentionally skipped (proportionate).

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
