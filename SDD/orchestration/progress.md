# Progress

## Current State

- Last compaction: `SDD/orchestration/compacted/compact-2026-05-27_13-16-05.md`
- Working on: MemodoAI end-user tutorial (ad-hoc). Pablo re-exported the **final video with title cards** (`MemodoAI intro.mpg`, now ~17:53). English transcript + chapters **regenerated on the new timeline** (UNCOMMITTED). German not started.
- Branch: `pablo`. Commits this session: `3f6d59aa5`, `ab34bb6be`, `eeccee3c8` (first English pin), `c20bd22ad` (regenerated transcript + chapters for the final cut).

## In-app guide page `/guide` (built this session, UNCOMMITTED)
- New left-rail `GraduationCap` icon → `/guide` (route under `<Root>`). Page `client/src/routes/Guide.tsx`: localized intro, `<video>` (mp4 + vtt captions), clickable chapters from `chapters.json` (seeks video, active-highlight), lazy transcript, PDF section (HEAD-checks `/guide-media/MemodoAI-guide.pdf`, shows placeholder until present).
- Self-hosted media: API serves `/guide-media` from repo-root `./guide-media` (`api/server/index.js`, resolved via `__dirname` so it's identical local/docker/prod). New bind-mount `./guide-media:/app/guide-media` in both `docker-compose.override.yml` + `docker-compose.prod.yml`. `./guide-media/` is gitignored.
- Media: transcoded `MemodoAI intro.mpg` (360MB MPEG-2) → `MemodoAI-intro.mp4` (54MB H.264/AAC faststart). guide-media holds mp4 + transcript.en.{vtt,txt} + chapters.json; PDF pending.
- en keys `com_ui_guide_*` added to `translation.json`. Verified: tsc clean (my files), full client build OK, real-middleware `/guide-media` serving (correct MIME, video Range 206, PDF 404), 4/4 component tests pass. **Not** verified in a live browser (no stack up; `/guide` is auth-gated; vite dev proxy doesn't forward `/guide-media`).
- Deploy = frontend(build+prod-sync) + backend(git pull api/server) + media(copy ./guide-media to prod host) + compose committed. See tutorial README "In-app guide page".
- Heads-up: `docs/.../screenshots/27-artifact-rendered.png` shows modified (219KB→326KB, mid-session) but NOT by me — likely Pablo re-captured it. Left untouched, excluded from feature commit.

### Regenerated transcript files (committed `c20bd22ad`)

## Transcription gotcha (resolved)
- Plain whisper.cpp on the edited audio (silent title-card gaps) fell into an 870-line repetition loop, losing the back half. Fix: **VAD** (Silero `ggml-silero-v6.2.0.bin` in `~/.local/share/whisper-cpp/models/`, from huggingface.co/ggml-org/whisper-vad) + `--max-context 0`. Both now baked into `transcribe.sh`, which also defaults to the `.mpg` for video-aligned timestamps.
- Chapter markers = each topic's narration start (video-aligned; VAD keeps original timeline). Ch.1 anchored at 00:00 though narration starts 0:05. Only one real silent gap detected (13:52, before Prompts) → title cards run over music, not silence.

## Decisions locked
- **Guide↔video "Common workflows":** keep the written guide as a **superset** — §14 stays in `memodo-ai-tutorial.md`; video/chapters intentionally omit it. No guide edits.
- **English transcript + 15 chapters:** accepted as-is, committed in `eeccee3c8`.

## Next step

Deferred German work — **not started; resume only when Pablo asks** (informal *du*, keep English UI feature names):
1. **Task #24** — German written guide `memodo-ai-tutorial.de.md` (timing-independent, zero rework risk — safe to do anytime).
2. **Task #23** — German transcript/chapters. `chapters.de.txt` + timing-free `transcript.de.txt` are low-risk; the cue-bound `.srt/.vtt` will need re-sync (or re-translate) after Pablo's step-3 video re-export, so hold those until after re-export.

See the compaction file for full context, file references, and open questions.
