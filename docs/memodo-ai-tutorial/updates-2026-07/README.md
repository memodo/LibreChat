# MemodoAI — What's New (July 2026)

A **self-contained** update deliverable: the written guide, screenshots, and video-production assets
for the July 2026 MemodoAI update (v0.8.5 → v0.8.7-rc1 + Microsoft 365). It's a **companion** to the
evergreen "Getting Started" tutorial one level up — not a rewrite. Its content (guide, screenshots,
shot list, narration, outputs) lives in this folder; the TTS/transcription **tooling is shared at the
tutorial root** (`../tooling/`) and takes this folder's name as an argument (see below).

**Start here →** [`updates-july-2026.md`](updates-july-2026.md) — the written guide. The rest of the
files produce, narrate, and (re)record its companion video.

---

## What's in this folder

| Path | What it is |
|---|---|
| [`updates-july-2026.md`](updates-july-2026.md) | **The guide** — the end-user walkthrough of the new features (Microsoft 365, Skills, chaining & memory, Projects, quality-of-life). Draft for Claude Design polish. |
| [`screenshots/`](screenshots/) | 14 annotated PNGs referenced by the guide, captured from the live instance (1440×900). |
| [`recording-script.md`](recording-script.md) | **Shot list** — every action, expected UI state, and asset name, per video chapter. Source of truth when the UI changes. |
| [`recording-narration.md`](recording-narration.md) | Voiceover script, one block per chapter. Source for the TTS audio. |
| [`../tooling/tts/narrate.mjs`](../tooling/tts/narrate.mjs) | **Shared** renderer at the tutorial root — `narrate.mjs updates-2026-07` renders this folder's `recording-narration.md` → per-section MP3s (ElevenLabs). |
| [`../tooling/transcribe.sh`](../tooling/transcribe.sh) | **Shared** transcriber at the root — `transcribe.sh updates-2026-07` → this folder's `transcript/` (EN, whisper.cpp). |
| [`audio/`](audio/) | Per-chapter narration MP3s. **Gitignored, regenerable.** |
| [`video/`](video/) | Screen recordings + final cut. **Gitignored, regenerable.** |
| [`transcript/`](transcript/) | EN/DE `.vtt`/`.txt` + `chapters.json` for the `/guide` page (generated). |

The **plan and status** for this deliverable are in
[`UPDATE-PLAN-v0.8.7-m365.md`](UPDATE-PLAN-v0.8.7-m365.md) (this folder).

---

## Status

| Artifact | State |
|---|---|
| Written guide | Complete (draft for polish) — UI verified live on chat-test 2026-07-21 |
| Screenshots (14) | Captured (`01`–`12`, `14`; `13` code-artifacts out of scope — not available in our deployment) |
| Shot list + narration | Drafted (2026-07-21) |
| Narration audio | Pending render (`narrate.mjs`) |
| Video documentary track | Pending OBS recording |
| Final cut + transcript + chapters | Pending |

---

## Production pipeline

The video is produced the same way as the evergreen tutorial, with the operator owning the OBS
record button and Claude driving the browser.

1. **Guide + screenshots** — authored in `updates-july-2026.md` + `screenshots/` (done).
2. **Narration audio** — render `recording-narration.md` to per-chapter MP3s:
   ```bash
   export ELEVENLABS_API_KEY=sk_...
   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs updates-2026-07 --dry-run   # cost preview
   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs updates-2026-07             # → audio/section-*.mp3
   ```
   Details + voice options: [`../tooling/tts/README.md`](../tooling/tts/README.md).
3. **Documentary track** — record in OBS while driving chat-test through
   [`recording-script.md`](recording-script.md), chapter by chapter. See that file's checklist and
   the "Video recording with OBS" section. (Optional scripted-OBS proposal: the evergreen
   [`../obs-recording.md`](../obs-recording.md).)
4. **Assemble** — stitch documentary track + narration + branded intro/outro in an editor.
5. **Transcript + chapters** — run the transcriber against the final cut, then build `chapters.json`:
   ```bash
   bash docs/memodo-ai-tutorial/tooling/transcribe.sh updates-2026-07   # auto-detects video/*.mpg
   # → transcript/transcript.en.{srt,vtt,txt,json}
   ```
   Add the DE transcript by translation (as the evergreen tutorial did).
6. **Transcode** to web MP4 (H.264/AAC, faststart):
   ```bash
   ffmpeg -i "video/MemodoAI-updates-july-2026.mpg" -c:v libx264 -preset medium -crf 23 \
     -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "video/MemodoAI-updates-july-2026.mp4"
   ```

---

## Deploying to the in-app `/guide` page

The `/guide` page serves media from a bind-mounted `./guide-media/` (not in git). The July deliverable
is added as a **selector** on that page ("Getting Started" | "What's New (July 2026)") — a `Guide.tsx`
change. See [`UPDATE-PLAN-v0.8.7-m365.md`](UPDATE-PLAN-v0.8.7-m365.md) §5.

Per-host, copy the new media (namespaced, e.g. `guide-media/updates-2026-07/`): the transcoded MP4,
`transcript/` files, `chapters.json`, and the bilingual HTML export of this guide. **Publishing to
prod is coupled to the pending v0.8.7 + M365 prod cutover** — prod still runs v0.8.5, so hold the prod
publish until then; chat-test can publish as soon as assets are ready.

---

*Companion to `../getting-started/memodo-ai-tutorial.md` (the evergreen guide). Content lives here;
tooling is shared at the tutorial root. Last updated 2026-07-22.*
