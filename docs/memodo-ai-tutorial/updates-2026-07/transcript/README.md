# transcript/ — captions, reading copy, and chapter markers (generated)

Generated from the final video cut, used by the in-app `/guide` page.

- `transcript.en.{srt,vtt,txt,json}` — produced by
  [`../tooling/transcribe.sh`](../../tooling/transcribe.sh) (whisper.cpp, VAD-hardened):
  ```bash
  bash docs/memodo-ai-tutorial/tooling/transcribe.sh updates-2026-07   # auto-detects video/*.mpg
  ```
- `transcript.de.{vtt,txt}` — German, added by translating the EN copy (as the evergreen tutorial did).
- `chapters.json` — drives the clickable chapter list on `/guide` (mirror the 7 video chapters:
  What changed → Microsoft 365 → Skills → Chaining & Memory → Projects → Quality-of-life → Wrap-up).

Unlike `audio/` and `video/`, these text outputs are **committed** (small, and referenced by the
`/guide` selector deploy).
