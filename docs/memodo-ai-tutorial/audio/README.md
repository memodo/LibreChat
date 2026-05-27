# audio/ — TTS narration (generated, not committed)

This directory holds the per-section voiceover for the tutorial video — one MP3 per script section:

```
section-00.mp3   Cold open
section-01.mp3   Welcome
section-02.mp3   Interface tour
...
section-99.mp3   Outro
```

**These files are gitignored** (everything here except this README). They're large (~18 MB total) and fully regenerable, so they don't belong in git history. The **source of truth** is [`../recording-narration.md`](../recording-narration.md) plus the chosen ElevenLabs voice ID.

## How to (re)generate

```bash
# 1. Set your ElevenLabs API key
export ELEVENLABS_API_KEY=sk_...

# 2. (Optional) preview cost without calling the API
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --dry-run

# 3. Render all sections (writes section-*.mp3 here)
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs

# Re-render just one section after editing the narration:
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --sections 08 --force
```

Full options, voice picking, and cost notes: [`tooling/tts/README.md`](../tooling/tts/README.md) and the "TTS" section of [`../video-pipeline.md`](../video-pipeline.md).

> If this directory is empty on a fresh clone, that's expected — run the command above to populate it.
