# Video pipeline for the MemodoAI tutorial

How to take the written tutorial in `memodo-ai-tutorial.md` and turn it into a video deliverable — first as a one-off, later as a repeatable studio if MemodoAI keeps changing.

This document complements `recording-script.md` (the shot list) and `obs-recording.md` (the OBS WebSocket script). Read those first if you haven't.

---

## The two-track mental model

A product tutorial video is **not** a motion-graphics piece. It's a **documentary screen recording** with a thin layer of branded chrome wrapped around it.

```
┌──────────────────────────────────────────────────────────────┐
│  Documentary track (90% of runtime)                          │
│  • Live MemodoAI screen recording                            │
│  • OBS-captured, controlled by record.js                     │
│  • Aligned to recording-script.md, section by section        │
└──────────────────────────────────────────────────────────────┘
                          +
┌──────────────────────────────────────────────────────────────┐
│  Decoration track (10% of runtime, 90% of perceived polish)  │
│  • Branded intro card (5–10s)                                │
│  • Section bumpers between chapters (2–3s each)              │
│  • Optional overlay callouts on key UI moments               │
│  • Outro card                                                │
└──────────────────────────────────────────────────────────────┘
                          +
┌──────────────────────────────────────────────────────────────┐
│  Audio track                                                 │
│  • TTS-generated narration from recording-narration.md       │
│  • One audio file per section, aligned to OBS chapter marks  │
│  • Optional: low-volume background music bed                 │
└──────────────────────────────────────────────────────────────┘
```

Three tracks, composited in any video editor (iMovie, DaVinci Resolve, Final Cut, Premiere). Each track has its own production pipeline so you can iterate on one without touching the others.

---

## Stage 1 — Ship the first video (recommended for video #1)

**Goal:** publish-able tutorial within half a day of focused work, including narration. No Hyperframes setup.

### Tooling required

| Tool | Purpose | Cost |
|---|---|---|
| **OBS Studio 28+** | Documentary track recording | Free |
| **obs-websocket** (built into OBS 28+) | Scripted start/stop/chapter marks | Free |
| **Our `record.js` script** | Wraps obs-websocket; see `obs-recording.md` | n/a |
| **A TTS API** (OpenAI / Azure / ElevenLabs) | Audio track | See "TTS" below |
| **Claude Design** | Branded intro/outro card (Stage 1 only) | Included with Claude Max |
| **DaVinci Resolve Free** (or iMovie) | Final stitch + section title cards as text overlays | Free |
| **whisper.cpp** (optional) | Re-transcribe TTS audio to get word-level timestamps for fancier captions | Free, local |

### Workflow

1. **Pre-flight (one-time)**
   - Install OBS 28+ and enable WebSocket Server (`Tools → WebSocket Server Settings`).
   - Create a Window Capture scene targeting Chrome only.
   - Output settings: MKV recording, 1440×900 at 60fps (matches our screencap region).
   - `cd docs/memodo-ai-tutorial/tooling/obs-recorder && npm install obs-websocket-js`
   - Set `OBS_WS_PASSWORD` env var.

2. **Generate narration audio (do this first)**
   - Generate per-section MP3s from `recording-narration.md` using a TTS script (see "TTS" section below).
   - Listen back. Edit `recording-narration.md` for any awkward phrasing. Re-render. Costs cents per run.
   - Final per-section audio files: `docs/memodo-ai-tutorial/audio/section-01.mp3`, `section-02.mp3`, etc. (See `tooling/tts/README.md` for the renderer.)

3. **Take the documentary recording**
   - Open MemodoAI in Chrome at `chat.memodo-eng.de/c/new`, resized to 1440×900.
   - From the project root, in a terminal:
     ```bash
     node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js start
     ```
   - Walk through `recording-script.md` section by section. Between each section, mark the chapter:
     ```bash
     node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js mark "Section 3 — Your first conversation"
     ```
   - Take your time — don't rush. The screen-record speed will be slowed down by ~50% in post if the actions feel too fast. Easier to over-record than to re-record.
   - At the end:
     ```bash
     node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js stop
     ```
   - You now have `recording.mkv` and `timestamps.log`.

4. **Generate intro / outro (Claude Design)**
   - In Claude Design: pick the Animation template, MemodoAI brand kit. Prompt: *"5-second branded intro card for MemodoAI Tutorial — logo enters, subtitle 'Getting started with MemodoAI' fades in, fades out."*
   - Screen-record the result at 1440×900. Save as `intro.mov`.
   - Repeat for outro card.
   - Both ~5 seconds. Total Claude Design time: ~30 min.

5. **Edit and stitch (DaVinci / iMovie)**
   - Drop `recording.mkv` on the timeline.
   - Use `timestamps.log` to mark chapter cuts at the corresponding marks.
   - At each chapter mark, insert a simple text-overlay title card (e.g., "8. File Search — chat with your documents"). 1.5–2s each.
   - Drop the per-section audio files onto each segment in order. Slip-edit them to align speech with the on-screen action.
   - Add `intro.mov` at the start, `outro.mov` at the end.
   - Optional: 5–10% volume background music bed (use Epidemic Sound, YouTube Audio Library, or your team's approved tracks).
   - Export to MP4, H.264, 1080p.

6. **Caption (optional but recommended)**
   - Run the final video through whisper.cpp to generate word-level SRT.
   - Burn the subtitles in (DaVinci's "Auto Captions" handles this) or attach as a side-car file for the host platform.

**Total time for video #1:** ~5–8 hours, almost all of which is editing, not recording.

---

## Stage 2 — Recurring video studio (when you commit to video #2+)

**Trigger:** you publish a second MemodoAI video. Suddenly the per-bumper hand-edit work in Stage 1 is repeated cost. Switch to a Hyperframes-based studio.

### What's different

- **Branded bumpers, intro, outro, callout overlays** all become reusable HTML compositions in a Hyperframes project. Re-rendering is a script invocation, not a Claude Design + screen-record session.
- **Captions** are generated by whisper from the TTS audio at render time — perfectly synced, no manual SRT cleanup.
- **MemodoAI feature changes** that affect bumpers (e.g., a new section "16. Code execution") become a one-line addition to the compositions catalog, not a redo.

### Setup (one-time)

```bash
mkdir -p docs/memodo-ai-tutorial/tooling/video-studio
cd docs/memodo-ai-tutorial/tooling/video-studio
npx skills add heygen-com/hyperframes
```

Then point Claude Code at the Hyperframes project and ask it to:

1. Read MemodoAI's brand kit (logo, colors, typography). If we don't have a separate brand kit file, point it at `client/src/style.css` or whatever the canonical MemodoAI design tokens live in.
2. Generate base compositions:
   - `01-intro` — branded title card (parameterized: takes title + subtitle as inputs)
   - `02-section-bumper` — section number + title transition (parameterized: section number, title)
   - `03-callout-overlay` — annotation box with arrow (parameterized: x/y target, text)
   - `04-outro` — closing card (parameterized: CTA, contact info)
3. Wire up a `render.js` that:
   - Takes a JSON config describing which compositions to render with what inputs
   - Outputs MP4 clips per composition via Puppeteer + FFmpeg
   - Honors a `--watch` flag for live preview during iteration

### Workflow per video after Stage 2 setup

1. Update `recording-narration.md` for any new/changed sections.
2. Regenerate TTS audio (script change → one TTS API call).
3. Record the documentary track with OBS (only re-record the sections that changed).
4. Run `node docs/memodo-ai-tutorial/tooling/video-studio/render.js --config tutorial-v2.json` to produce intro/outro/bumpers/overlays for the new sections.
5. In DaVinci or via an `ffmpeg` stitch script, splice the new clips into the existing project.
6. Re-run whisper for captions on the new sections.
7. Export.

**Time per Stage 2 video:** 2–3 hours for a delta video; 5–6 hours for a full re-record. The compounding gain matches what the Nate Herk video describes: the studio gets smarter with each render.

### When to do Stage 2

Trigger conditions, in rough priority order:

- You publish a second MemodoAI tutorial video (likely)
- MemodoAI gets a major version bump that invalidates several sections
- You need a consistent visual identity across multiple internal videos (onboarding, security, dev workflows)
- A peer team wants to do their own tutorial in the same brand and asks for the kit

If none of those happen within ~3 months of Stage 1, don't bother with Stage 2. The setup cost doesn't amortize.

---

## TTS — text-to-voice for the narration

TTS is genuinely the better choice for this kind of tutorial. Reasons:

1. **Consistency** — the voice sounds the same in section 1 and section 15, with no "uh, sorry, take 4" energy.
2. **Re-render is free** — when you change a sentence in `recording-narration.md`, a single TTS call replaces it. No re-recording.
3. **Multilingual** — same script, German voice for a German variant. Hard to do with live narration.
4. **No talent dependency** — the video doesn't break when the person who narrated leaves the company.

### Provider: ElevenLabs

We're using **ElevenLabs** as the TTS provider for this project. It produces the most natural-sounding narration of the mainstream options, multilingual v2 supports both English and German (useful if you ever localize), and the REST API is straightforward enough that the renderer can be ~150 lines of zero-dependency Node.

If you're starting from scratch:

1. Sign up at [elevenlabs.io](https://elevenlabs.io) — the free tier is enough to validate the pipeline on a couple of sections.
2. Grab your API key: Profile → API key. Export it:
   ```bash
   export ELEVENLABS_API_KEY=sk_...
   ```
3. **Pay as you generate.** ElevenLabs offers pay-as-you-go at $0.05–$0.10 per 1,000 characters with no subscription required. A full render of the current narration script costs **roughly $0.85–$1.70**; re-rendering one edited section costs cents. Skip the monthly subscription unless and until you're producing multiple videos per month — see "Cost" below for the threshold.

### Other providers, briefly

If your ElevenLabs subscription lapses or you need a fallback, the renderer can be swapped to:

| Provider | Voice example | Notes |
|---|---|---|
| **OpenAI TTS** | `tts-1-hd` with `nova` | Cheapest ($0.40 per full render). Less natural prosody. Trivial API. |
| **Azure Neural TTS** | `en-US-AvaNeural` | Same Azure tenant as MemodoAI. Very natural with newer expressive voices. SSML support. |
| **Google Cloud TTS** | `en-US-Studio-O` | Strong on English narration. Multilingual library is smaller. |

Swapping is a ~20-line change to the renderer — different endpoint, slightly different request body. Not addressed in this doc; the source is straightforward enough to fork.

### The renderer

The script lives at **`docs/memodo-ai-tutorial/tooling/tts/narrate.mjs`** and is ready to run. No npm dependencies; just Node 20+.

```bash
# Dry-run first to see character cost
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --dry-run

# Render everything
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs

# Re-render only the section you edited
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --sections 08 --force
```

Existing files are skipped unless `--force` is passed, so partial runs are resumable. Output lands in `docs/memodo-ai-tutorial/audio/section-<id>.mp3` (gitignored — audio is regenerable from the script).

Full usage details and voice-picking tips: see [`tooling/tts/README.md`](tooling/tts/README.md).

### Default voice

The renderer ships pointing at **Rachel** (`21m00Tcm4TlvDq8ikWAM`) — a calm, narration-friendly American English female voice from the ElevenLabs default library. It's a sensible default for an internal tutorial: clear, warm, not theatrical.

To audition alternatives, run `node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --list-voices` to dump your account's full voice library with IDs. A few good starting points:

- **Daniel** (`onwK4e9ZLuTAKqWW03F9`) — clear British male, classic narrator vibe
- **Antoni** (`ErXwobaYiN019PkySvjV`) — well-rounded American male
- **Adam** (`pNInz6obpgDQGcFmaJgB`) — deeper American male, slightly more formal

You can also clone your own voice in ElevenLabs (Creator tier and above) and pass its `voice_id` — useful if you want the tutorial narrator to be someone in particular from Memodo.

### Cost — what to expect

The current narration script is ~3,400 words. After cues and director notes are stripped (the renderer does this automatically), the spoken text is **17,044 characters** (confirm for your exact script with `--dry-run`).

The cheapest sensible option is **pay-as-you-go**: $0.05–$0.10 per 1,000 characters, no subscription required, just an account and a payment method.

| Path | Cost for our script | When to pick it |
|---|---|---|
| Free tier | $0 (covers ~10–20K chars depending on model) | Validation only — render 1–2 sections to confirm voice and pacing |
| Pay-as-you-go | ~$0.85–$1.70 per full render; ~$0.05–$0.10 per single-section re-render | **Recommended for video #1.** No recurring charge. |
| Starter $6/mo | included quota = ~2 full renders/month | Cross over from PAYG when you'll render twice a month or more |
| Creator $11–$22/mo | included quota = ~4+ full renders/month | Active iteration, or German + English variants |
| Pro $99/mo | ~10+ full renders/month | Bulk production across multiple tutorials |

> A note on the pricing pages: ElevenLabs' `/pricing` and `/pricing/api` pages show different character quotas for the same tier. The discrepancy is because credits convert to characters at different rates depending on the model (Flash, Turbo, Multilingual v2, v3 all cost different amounts per character). Treat the `/pricing` numbers as your floor; verify your actual quota against your account dashboard after signup.

**Bottom line**: start with the free tier, render a couple of sections to lock the voice in, then move to pay-as-you-go for the rest. Total spend on video #1 is well under $5. Revisit the subscription question only if you commit to video #2 within a couple of months.

### Tips for TTS-friendly writing

The narration script will sound noticeably better if you follow a few conventions:

- **Short sentences.** TTS doesn't breathe; long sentences come out monotone.
- **Punctuate for prosody.** Commas = small pause, em-dashes = bigger pause, line breaks = sentence breaks. Use them.
- **Spell out tricky words.** "GPT-5" reads fine; "MCP" might read as "em-see-pee" — write "MCP" but test; write "M-C-P" or "Model Context Protocol" if it sounds wrong.
- **Avoid "click here" / "see above."** TTS doesn't know about the visual context; the documentary track shows what to click, the narration explains *why*. Lean into the why.
- **Use SSML if available.** Azure and ElevenLabs both support SSML tags like `<break time="500ms"/>` or `<emphasis>` for fine control. OpenAI TTS does not (yet).

---

## A note on what NOT to outsource to the model

The model can write narration drafts. The model can render bumpers. The model can drive Chrome MCP through the script while you record. **The model can't yet tell whether a sentence will *sound right* spoken aloud.**

Always listen to the TTS output before you cut. Skim is fine; full attention for the first take is not. The narration is the part of the video that, if it's off, no amount of motion graphics will save.

---

## Open questions to resolve before recording

These are decisions you'll want to make once and stick to:

1. **Length target.** 30 min is fine for a deep tutorial; some audiences prefer a 7-min "executive cut" + a 30-min deep dive. Pick one for the first take; the recording script supports both.
2. **Hosting.** Internal SharePoint / Confluence? YouTube unlisted? Loom? Each has different caption and chapter conventions.
3. **Re-record cadence.** Quarterly? Per major MemodoAI release? "On demand"? Drives whether Stage 2 is worth the investment.
4. **Language(s).** English only, or also German? Stage 1 TTS can do both with the same script translated; Stage 2 Hyperframes can swap the audio track without re-rendering bumpers.

None of these block the first take. They do shape the editing approach in step 5 of the Stage 1 workflow.

---

*Last updated: 2026-05-19. Companion to `recording-script.md`, `recording-narration.md`, `obs-recording.md`.*
