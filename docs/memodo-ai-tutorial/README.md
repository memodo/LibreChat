# MemodoAI Tutorial

Onboarding material for **MemodoAI**, Memodo's internal AI workspace. This directory holds the written end-user guide, its screenshots, the narration and production assets for a companion video, and the tooling used to generate them.

**Start here →** [`memodo-ai-tutorial.md`](memodo-ai-tutorial.md) — the 15-section end-user walkthrough. The rest of the files exist to produce, narrate, and (re)record it.

---

## What's in this directory

| Path | What it is |
|---|---|
| [`memodo-ai-tutorial.md`](memodo-ai-tutorial.md) | **The tutorial itself** — the end-user guide (chat, model picker, file search, agents, artifacts, memories, prompts, bookmarks, PII warnings). Draft intended for visual polish in Claude Design. |
| [`screenshots/`](screenshots/) | 32 annotated PNGs referenced by the guide, captured from the live instance (1440×900). |
| [`sample-q3-roadmap-memo.md`](sample-q3-roadmap-memo.md) | Fictional demo document used in the File Search section. |
| [`recording-script.md`](recording-script.md) | Step-by-step shot list for (re)capturing the tutorial — every action, expected UI state, and asset name. The source of truth when MemodoAI's UI changes. |
| [`recording-narration.md`](recording-narration.md) | Voiceover script, one block per section. Source for the TTS audio. |
| [`video-pipeline.md`](video-pipeline.md) | How to turn the guide into a video — tooling, stages, TTS provider, cost. |
| [`obs-recording.md`](obs-recording.md) | Proposal for scripted OBS recording via `obs-websocket` (optional, for recurring video production). |
| [`audio/`](audio/) | Per-section narration MP3s. **Gitignored, regenerable** — see [`audio/README.md`](audio/README.md). |
| [`video/`](video/) | Screen recordings + final cut. **Gitignored, regenerable** — see [`video/README.md`](video/README.md). |
| [`tooling/tts/`](tooling/tts/) | `narrate.mjs` — renders the narration script to per-section MP3s via the ElevenLabs API. |

Tracked in git: the guide, screenshots, scripts, and docs (~6.7 MB). Ignored: audio, raw video, and intro clips (~457 MB) — all regenerable.

---

## How this was produced

The tutorial was built end-to-end with **Claude Code driving a live MemodoAI session**. The pipeline:

1. **Recon & outline** — connected to the already-logged-in instance via the **Claude in Chrome extension** (MCP browser automation — *not* Playwright; the extension was chosen because the session was already authenticated, avoiding any login setup). Surveyed which features were enabled and agreed a 15-section structure.
2. **Screenshots** — Claude drove the browser (navigate / click / type / find) and saved each PNG as a region grab of the Chrome window via macOS `screencapture`. → [`screenshots/`](screenshots/)
3. **Written guide** — authored [`memodo-ai-tutorial.md`](memodo-ai-tutorial.md) plus the production docs in this directory.
4. **Narration** — wrote [`recording-narration.md`](recording-narration.md) and rendered it to 18 per-section MP3s (~19:50 total) with ElevenLabs via [`tooling/tts/narrate.mjs`](tooling/tts/narrate.mjs). → [`audio/`](audio/)
5. **Video (documentary track)** — recorded **separately in OBS**: the operator started and stopped the OBS recording by hand while Claude drove the browser through [`recording-script.md`](recording-script.md) end to end. → [`video/`](video/)
6. **Assembly** *(pending)* — stitch the documentary track + narration audio + a branded intro/outro in a video editor, per [`video-pipeline.md`](video-pipeline.md).

### A note on the OBS step

Everything except the video recording is fully driven by Claude through the Chrome extension and reproducible from this directory. **Video recording is the one step done outside that loop**: OBS runs on the operator's machine and is started/stopped manually. We landed on this split deliberately — an earlier attempt to capture the screen programmatically (`screencapture -v` launched in the background) lost the take because that tool doesn't flush its file when terminated from another process. Operator-controlled OBS is the reliable path: Claude handles all the on-screen navigation, the operator just owns the record button.

---

## Regenerating the assets

- **Narration audio** — `node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs` (needs `ELEVENLABS_API_KEY`). Details: [`audio/README.md`](audio/README.md) and the "TTS" section of [`video-pipeline.md`](video-pipeline.md).
- **Screenshots / video** — re-run the steps in [`recording-script.md`](recording-script.md). Details: [`video/README.md`](video/README.md).

When MemodoAI's UI changes, update [`recording-script.md`](recording-script.md) and [`memodo-ai-tutorial.md`](memodo-ai-tutorial.md) together, then re-capture only the affected sections.

---

## Status

| Artifact | State |
|---|---|
| Written guide + 32 screenshots | Complete (draft for Claude Design polish) |
| Narration audio (18 sections, ~19:50) | Complete |
| Video documentary track | Recorded in OBS |
| Final video edit | Pending |
