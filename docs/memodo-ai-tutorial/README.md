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

## In-app guide page (`/guide`)

The tutorial is also surfaced **inside MemodoAI** as a dedicated page: a **graduation-cap icon in the left rail** opens `/guide`, a **standalone full-page route** (rendered outside the chat shell, so there's no sidebar and the video gets full width). It has the video, a clickable chapter list (seeks the video), the transcript, a "Back to MemodoAI" control, and links to open the written HTML guide in a new tab.

**How it's served.** The page is a frontend route (`client/src/routes/Guide.tsx`, mounted as a sibling of `<Root>` under `AuthLayout` so it stays authenticated but loses the sidebar). It fetches all content from `/guide-media/*`, a static path the API serves from a repo-root `./guide-media` directory (`api/server/index.js`). That directory is **gitignored** and **bind-mounted** into the container (`./guide-media:/app/guide-media`, declared in `docker-compose.override.yml` and `docker-compose.prod.yml`) — the media never travels through git.

**Contents of `./guide-media/`** (populate on each host before `up`):

| File | Purpose | Source |
|---|---|---|
| `MemodoAI-intro.mp4` | Web-playable video (H.264/AAC, faststart) | Transcode of the edited `.mpg` (see below) |
| `transcript.en.vtt` / `transcript.de.vtt` | Caption tracks on the `<video>` (EN/DE switch) | `transcript/transcript.en.vtt`, `transcript/transcript.de.vtt` |
| `transcript.en.txt` / `transcript.de.txt` | Plain transcript shown in the page (EN/DE switch) | `transcript/transcript.en.txt`, `transcript/transcript.de.txt` |
| `chapters.json` | Drives the clickable chapter list | `transcript/chapters.json` |
| `getting-started-with-MemodoAI.html` | Bilingual written guide, opened from the page (self-contained, ~10 MB) | Claude Design export |

Transcode the final video to web MP4:

```bash
ffmpeg -i "MemodoAI intro.mpg" -c:v libx264 -preset medium -crf 23 \
  -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "MemodoAI-intro.mp4"
```

**Deploying a change to the in-app guide:**

1. Frontend (route/page/icon/locale) → `npm run build`, then `./prod-sync.sh` (rsync `client/dist` + restart).
2. Backend static mount (`api/server/index.js`) → `git push` + `git pull` on prod (the `./api/server` bind-mount picks it up) + restart `api`.
3. Media → copy the `./guide-media/` files to the prod host's `./guide-media/` (e.g. `rsync`/`scp`); not in git. The compose mounts are already committed.

---

## Status

| Artifact | State |
|---|---|
| Written guide + 32 screenshots | Complete (draft for Claude Design polish) |
| Narration audio (18 sections, ~19:50) | Complete |
| Video documentary track | Recorded in OBS |
| Final video edit | Complete (title cards added; ~17:53) |
| Transcript + 15 chapters (English) | Complete, regenerated for the final cut |
| In-app guide page (`/guide`) | Built — serves from `./guide-media` |
| Written PDF guide | In progress (page shows placeholder until present) |
