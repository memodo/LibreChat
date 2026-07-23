# MemodoAI tutorials

Onboarding and update material for **MemodoAI**, Memodo's internal AI workspace. This directory is
organized as a set of **recordings** — each one an end-user guide plus a companion video — sharing a
common set of tooling and production conventions.

## Recordings

| Folder | What it is |
|---|---|
| [`getting-started/`](getting-started/) | The evergreen **"Getting Started with MemodoAI"** tutorial — the 15-section day-one walkthrough (chat, model picker, file search, agents, artifacts, memories, prompts, bookmarks, PII). Start here. |
| [`updates-2026-07/`](updates-2026-07/) | **"What's New (July 2026)"** — the update covering the v0.8.7 upgrade + Microsoft 365. A companion to the evergreen guide, not a rewrite. |

Future updates get their own dated folder (e.g. `updates-YYYY-MM/`) following the same layout.

## Shared at the root (applies to every recording)

| Path | What it is |
|---|---|
| [`tooling/tts/narrate.mjs`](tooling/tts/narrate.mjs) | Renders a recording's `recording-narration.md` → per-section MP3s via ElevenLabs. **Takes the recording folder as its first argument.** |
| [`tooling/transcribe.sh`](tooling/transcribe.sh) | Transcribes a recording's final video → its `transcript/` (whisper.cpp). Also takes the recording folder as its first argument. |
| [`video-pipeline.md`](video-pipeline.md) | How to turn a guide into a video — tooling, stages, TTS provider, cost. |
| [`obs-recording.md`](obs-recording.md) | Proposal for scripted OBS recording via `obs-websocket` (optional). |

```bash
# Render narration for a recording (dry-run shows cost; drop --dry-run to render):
export ELEVENLABS_API_KEY=sk_...
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs getting-started --dry-run
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs updates-2026-07

# Transcribe a recording's final cut → <recording>/transcript/:
bash docs/memodo-ai-tutorial/tooling/transcribe.sh updates-2026-07
```

Run either script with no arguments to see the list of available recordings.

## Per-recording layout (convention)

Each recording folder is self-contained for its **content and outputs**:

```
<recording>/
├── <guide>.md                (the written guide)
├── recording-script.md       (shot list)
├── recording-narration.md    (voiceover; rendered by the shared narrate.mjs)
├── screenshots/              (annotated PNGs, committed)
├── audio/                    (narration MP3s — gitignored, regenerable)
├── video/                    (recordings + final cut — gitignored, regenerable)
├── transcript/               (EN/DE .vtt/.txt + chapters.json — committed)
└── README.md                 (that recording's overview + status)
```

The **tooling** is *not* copied per recording — it lives once at the root and is pointed at a
recording by name (above). Content, screenshots, and outputs stay with each recording.

## In-app guide page (`/guide`)

Both the evergreen tour and the update video are surfaced inside MemodoAI at `/guide` (a graduation-cap
icon in the left rail), with a selector to switch between them. The page serves its media (video,
transcript, chapters, HTML guide) from a bind-mounted `./guide-media/` directory that is **gitignored**
— the media never travels through git. See each recording's README and `video-pipeline.md` for how the
media is produced and deployed.

---

*Structure: shared tooling + process docs at the root; each recording (getting-started, updates-*) in
its own folder. Last reorganized 2026-07-22.*
