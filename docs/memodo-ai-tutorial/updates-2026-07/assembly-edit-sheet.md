# Assembly Edit Sheet — "What's New (July 2026)"

Work off this to splice the cut together in DaVinci Resolve / iMovie / Premiere. It maps every
**narration MP3** and **source clip** to its place in the final sequence, with per-segment sync
cues and trim targets.

- **Narration audio:** `audio/section-<id>.mp3` (7 files, rendered — the master timeline).
- **Source video:** `video/*.mkv` (12 operator-driven OBS clips, 1440×900 @ 60fps).
- **Companion docs:** `recording-script.md` (shot list), `recording-narration.md` (spoken text),
  `../video-pipeline.md` (three-track production model).

> **How to read the timeline logic:** narration is the **master track** — the video is trimmed/sped
> to fit the voiceover, not the other way round. Every source clip is **longer** than its narration
> because it contains setup and response-waiting dead-time. Your main job per segment is to **compress
> the dead-time** so the meaningful on-screen action lands under the words. Target on-screen length
> for each segment = its narration length (last column of the master table).

---

## 1. Source artifacts — the definitive clip ↔ chapter map

Clips are OBS timestamp-named; this is what each one actually contains (verified frame-by-frame).

| # | File (`video/`) | Length | Chapter / content |
|---|---|---|---|
| clip01 | `2026-07-22 10-42-47.mkv` | 3:08 (188.5s) | **Ch 1 — Microsoft 365.** Full flow incl. the Q&A: "what is my display name and job title?" → "Ran get-current-user in Microsoft365" → profile answer. |
| clip02 | `2026-07-22 10-46-37.mkv` | 1:14 (73.9s) | **Ch 0 — Cold open.** Static "Welcome to MemodoAI" screen, default composer. |
| clip03 | `2026-07-22 10-48-57.mkv` | 2:39 (159.1s) | **Ch 2A — Skills, use.** `$` picker → `meeting-notes` on a team-sync transcript → structured output. |
| clip04 | `2026-07-22 10-51-44.mkv` | 3:33 (212.7s) | **Ch 2B — Skills, manage/create.** Skills panel → "Write skill instructions" → sample `warranty-claim` → detail view. |
| clip05 | `2026-07-22 11-01-38.mkv` | 1:46 (106.5s) | **Ch 3A — Chaining, setup.** Agent Builder → Advanced → Multi-agent orchestration → Chain (Chain Test Primary + Uppercase Bot). |
| clip06 | `2026-07-22 11-03-51.mkv` | 2:27 (147.5s) | **Ch 3A — Chaining, run.** Select the chained agent → "capital of France?" → chain output + Uppercase transform. |
| clip07 | `2026-07-22 12-50-30.mkv` | 2:56 (175.8s) | **Ch 4 — Projects.** New project → name `Q3 Planning` → Create → project page ("Chats 0 / No chats yet"). |
| clip08 | `2026-07-22 12-57-20.mkv` | 1:01 (61.5s) | **Ch 5.1 — Context meter.** Hover the composer circle → "Context 527 / 361k (0%)" popover. |
| clip09 | `2026-07-22 13-10-55.mkv` | 0:46 (45.8s) | **Ch 5.2 — Office preview.** File Search on + attach XLSX → typed "Spreadsheet" preview card. |
| clip10 | `2026-07-22 13-13-47.mkv` | 0:29 (29.0s) | **Ch 5.3 — Timestamps.** Hover a message → "2 hours ago" by the sender name. |
| clip11 | `2026-07-22 13-16-18.mkv` | 0:52 (52.5s) | **Ch 5.4 — Instant titles.** Send "three fun facts about the ocean?" → title appears before the reply. |
| clip12 | `2026-07-23 11-10-22.mkv` | 3:33 (212.9s) | **Ch 3B — Memory.** Type "…remember I'm on the Frontend team and I prefer concise, bulleted answers." → reply shows "Updated saved memory" + "Saved: You are on the Frontend team." / "Preference saved: concise, bulleted answers." → brain icon reveals the Memories panel with the fresh today-dated entry. (Recorded 2026-07-23 after the memory-write fix.) |

**Narration inventory** (actual rendered MP3 durations — authoritative; the `> ~Ns` notes in
`recording-narration.md` are older estimates, ignore them for timing):

| MP3 | Length | Covers |
|---|---|---|
| `section-00.mp3` | 0:20 (19.9s) | Cold open |
| `section-01.mp3` | 1:40 (99.9s) | Microsoft 365 |
| `section-02.mp3` | 1:57 (117.2s) | Skills |
| `section-03.mp3` | 1:16 (76.4s) | Chaining **+ memory** (both recorded — see §3) |
| `section-04.mp3` | 0:25 (25.4s) | Projects |
| `section-05.mp3` | 0:46 (46.0s) | Quality-of-life |
| `section-07.mp3` | 0:50 (49.8s) | Wrap-up |
| **Total** | **7:14 (434.6s)** | |

**Estimated finished runtime:** ~7:40–8:00 with intro/bumpers/outro added (see §6). That sits just
under the script's "~8–9 min" target, which is fine for an "executive cut."

---

## 2. Global treatment (set once, apply to all clips)

1. **Crop the browser chrome + debug banner.** Every clip is a full 1440×900 Chrome window: macOS
   tab bar, URL bar, and (on most clips) a yellow **"'Claude' started debugging this browser"** banner
   with a Cancel button. Crop off the **top ~95–100 px** so the frame starts at the MemodoAI app.
   - Bonus: this also hides the `chat-test.memodo.de` **test hostname** in the URL bar and the pinned
     "Claude" browser tab — both of which you don't want in a published tutorial.
   - `clip07` (Projects) has **no** debug banner, so a uniform top-crop leaves it with a hair more top
     margin than the others. Harmless — set the crop once against a bannered clip and apply to all.
2. **Scale to 1080p.** After cropping (~1440×800) letterbox/scale to a **1920×1080** H.264 timeline.
   A slight pillarbox or a small zoom-to-fill both read fine; pick one and keep it consistent.
3. **Speed / dead-time.** Where a clip waits on a model response or a menu, either hard-cut the wait
   or run a 1.5–2× speed ramp over it. The pipeline doc's "slow by ~50%" note is the opposite case
   (fast live driving) — here the clips are slow, so you're mostly **removing** time, not adding it.
4. **Cursor.** The driven cursor sometimes lands a beat before the narration references it. Slip-edit
   ±0.5s so the click lands on the spoken cue ("click MCP Servers", "type a dollar sign", etc.).

---

## 3. ✅ Section 03 — chaining + memory (resolved 2026-07-23)

`section-03.mp3` (1:16) narrates **two** features: **chaining** (first ~35s) **and memory** (last
~40s: *"The second is memory… it just works"*). Both are now covered:

- **Chaining** — clip05 (setup) + clip06 (run).
- **Memory** — **clip12**, recorded 2026-07-23 after the memory-write fix went live on chat-test. The
  on-camera save works end-to-end: the reply confirms both facts and the Memories panel shows the
  fresh entry. So the "it just works" line now stands behind a working, filmed feature.

**No re-render needed** — keep the full `section-03.mp3` as rendered. Play the chaining clips then
the memory clip under one continuous voiceover; bumper stays **"Chaining & Memory."**

> Earlier drafts of this sheet flagged a decision here (memory was silently broken and unfilmed, so
> the plan was to trim §03 to chaining-only). That's now moot — memory is fixed, filmed, and kept.

---

## 4. Master assembly sequence

Play MP3s in **numeric order** (00 → 01 → 02 → 03 → 04 → 05 → 07) — that *is* the final sequence.
"On-screen target" = trim the source clip(s) to roughly this length, under the MP3.

| Seq | Bumper card | Narration | MP3 len | Source clip(s) | Clip len | On-screen target |
|---|---|---|---|---|---|---|
| — | **Intro card** | — | — | `intro.mov` (make) | ~7s | 7s |
| 00 | *(cold open — no bumper)* | `section-00` | 0:20 | clip02 | 1:14 | **0:20** — hold on Welcome; optional slow zoom |
| 01 | **Microsoft 365** | `section-01` | 1:40 | clip01 | 3:08 | **1:40** — beat cuts in §5 |
| 02 | **Skills** | `section-02` | 1:57 | clip03 → clip04 | 2:39 + 3:33 | **1:57** — split ~1:00 / ~0:57 |
| 03 | **Chaining & Memory** | `section-03` | 1:16 | clip05 → clip06 → clip12 | 1:46 + 2:27 + 3:33 | **1:16** — chaining (setup+run) then memory |
| 04 | **Projects** | `section-04` | 0:25 | clip07 | 2:56 | **0:25** — create-flow only |
| 05 | **Quality-of-Life** | `section-05` | 0:46 | clip08 → clip09 → clip11 → clip10 | see §5 | **0:46** — 4 quick hits |
| 07 | *(outro card)* | `section-07` | 0:50 | `outro.mov` (make) | ~8s vid | 0:50 — card holds under VO |

§5 below is the authoritative per-segment breakdown with sync cues, in this same order.

---

## 5. Per-segment detail & sync cues (authoritative order)

### Seg 00 — Cold open · `section-00.mp3` (0:20) · clip02
Static Welcome screen. Just hold 20s under the VO ("MemodoAI just got an update…"). Trim clip02's
extra ~54s. A slow 5% zoom-in keeps a static frame alive. Flows straight out of the intro card.

### Seg 01 — Microsoft 365 · `section-01.mp3` (1:40) · clip01 (3:08 → 1:40)
Beat-match the VO to the on-screen actions:
- "You turn it on in the composer: click **MCP Servers**, and tick **Microsoft365**" → show the
  dropdown open + the tick.
- "If you see a green dot… click the plug icon and **Initialize**" → if clip01 shows the connected
  green state, just hold on it; there's no disconnect to show, so this is voiceover-over-static.
- "Now I'll ask… *display name and job title*" → the send + the **"Ran get-current-user in
  Microsoft365"** line + the profile answer. This is the payoff — let it breathe.
- The three "keep in mind" points (runs as you / read-only / name a target) play over the result
  still on screen. Trim the response **wait** here; that's where most of clip01's excess 88s lives.

### Seg 02 — Skills · `section-02.mp3` (1:57) · clip03 (→~1:00) then clip04 (→~0:57)
Two source clips, one narration section. Split at the sentence *"You manage skills from the Skills
panel…"* — everything before it is **clip03**, everything after is **clip04**.
- **clip03 (first ~1:00):** "invoke it by name: type a dollar sign… I'll pick meeting-notes and paste
  a transcript" → the `$` picker + paste. "Look at the result…" → the structured output (attendees /
  decisions / action items / open questions). Trim the model-thinking wait.
- **clip04 (next ~0:57):** "click the plus and choose Write skill instructions… name, description,
  instructions in Markdown… three headings — When to use, Procedure, Output format… Save" → the
  create form being filled. "versioned and can be shared" → the detail view. Note the demo skill was
  **cancelled** (not saved), so don't imply it persisted — cut before/around the Cancel.

### Seg 03 — Chaining & Memory · `section-03.mp3` (1:16) · clip05 → clip06 → clip12
Two features under one voiceover. The VO splits at *"The second is memory…"* — everything before is
**chaining** (clip05 + clip06), everything after is **memory** (clip12).

**Chaining half (~first 0:35, clip05 → clip06):**
- clip05: "under Advanced, a Multi-agent orchestration section with a Chain option… a chain where a
  primary agent hands off to an Uppercase Bot" → the Chain builder showing both agents.
- clip06: "It lets you run a fixed sequence…" → select the agent + the run: "capital of France?" →
  "Sir, the capital of France is Paris." then "AI: SIR, THE CAPITAL OF FRANCE IS PARIS." (the
  uppercase transform is the visual punchline — land it on "one feeds the next").

**Memory half (~last 0:40, clip12):** clip12 is 3:33 — trim heavily to ~0:40.
- "MemodoAI can now actively remember things you tell it. Watch: I'll say… Frontend team… concise,
  bulleted answers" → the prompt being typed + sent.
- "The assistant confirms what it saved, right there in its reply" → the reply with the **"Updated
  saved memory"** badge and the two "Saved:" / "Preference saved:" bullets. This is the payoff — hold
  on it. Trim the model-thinking wait before the reply appears.
- "Those items now live in your Memories panel — the brain icon in the left rail" → the brain-icon
  click + the panel revealing the fresh today-dated entry. Land the panel reveal on this line.
- "tied to your account only… a toggle to turn it off" → plays over the panel (the "Use memory"
  toggle is visible top-left of the panel). Note the sidebar auto-titles "Frontend Team: Concise…" —
  a nice incidental reinforcement of instant titles.

### Seg 04 — Projects · `section-04.mp3` (0:25) · clip07 (2:56 → 0:25)
Tight. Only the create flow: "Click New project, give it a name" → the dialog + `Q3 Planning` typed
→ Create → the project page. clip07 has lots of pre-roll sidebar dead-time — cut straight to the
**New project** click. The "Projects = folders / Bookmarks = tags" line plays over the project page.

### Seg 05 — Quality-of-Life · `section-05.mp3` (0:46) · four clips, in VO order
The narration names features in this order — sequence the clips to match:
1. **Context meter** (clip08) — "the little circle in the message bar. Hover it…" → the "Context
   527 / 361k (0%)" popover. (~12s)
2. **Office preview** (clip09) — "When you attach a Word doc, a spreadsheet…" → the Spreadsheet
   preview card. (~12s)
3. **Instant titles** (clip11) — "new conversations get a title immediately" → send the ocean
   question, catch the sidebar title appearing before the reply. (~12s)
4. **Timestamps** (clip10) — "hovering any message shows you when it was sent" → the "2 hours ago"
   hover. (~10s)

Each clip is short already; take the single clean hit from each (trim entry/exit) and hard-cut
between the four. This is the fastest-cadence segment — keep it snappy.

### Seg 07 — Wrap-up · `section-07.mp3` (0:50) · outro card (make)
No live footage. The **outro card** (logo + CTA) holds for the full 50s of VO. CTA content from the
narration: "Try Microsoft 365 first — turn it on from MCP Servers, ask about your inbox or calendar,
it's read-only" + "Questions? Reach out to your AI or IT champion."

---

## 6. Decoration track (intro / bumpers / outro)

Per `../video-pipeline.md` Stage 1 (make these in Claude Design, screen-record at 1440×900, or build
as simple text-overlay cards in the editor):

- **Intro card** (~7s): MemodoAI logo, title **"What's New"**, subtitle **"July 2026"**. Fades into
  Seg 00.
- **Chapter bumpers** (~2s each, 5 total): text-overlay cards between segments —
  **"Microsoft 365"**, **"Skills"**, **"Chaining & Memory"**, **"Projects"**, **"Quality-of-Life"**.
  (Cold open needs none; it *is* the opener.)
- **Outro card** (~8s of motion, holds under the 50s §07 VO): logo + the CTA text above.
- **Optional:** callout arrows/boxes on the two payoff moments — the "Ran get-current-user" line
  (Seg 01) and the uppercase transform (Seg 03).
- **Optional:** a 5–10% background-music bed.

---

## 7. After the cut

1. **Export** the edited timeline to `video/` as MP4 (H.264, 1080p). Name it e.g.
   `whats-new-july-2026.mp4`.
2. **Transcribe** the final cut (tooling verified present — whisper-cli + ggml-large-v3 + Silero VAD):
   ```bash
   bash docs/memodo-ai-tutorial/tooling/transcribe.sh updates-2026-07
   ```
   Auto-detects `video/*.mp4`, writes `transcript/transcript.en.{srt,vtt,txt,json}`. Run this on the
   **final cut**, not the raw clips, so timestamps match. (VAD is essential — it skips the silent
   bumper/title-card gaps that otherwise send whisper into a repetition loop.)
3. **Captions:** burn the SRT in, or ship the VTT sidecar to the host platform.
4. **Then:** transcode for delivery → bilingual HTML export → `/guide` selector (`Guide.tsx`) → deploy.

---

## 8. Open decisions (flag before/at publish)

- **Hosting** — SharePoint / unlisted / Loom? Drives caption + chapter format.
- **Language** — English only now; the script + `narrate.mjs` support a German variant later
  (`eleven_multilingual_v2` already speaks German).
- **§01 disconnect beat** — the VO describes the plug-icon/Initialize reconnect, but clip01 shows the
  already-connected state. Fine as voiceover-over-static; just know there's no reconnect to *show*.
