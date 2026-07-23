# audio/ — narration MP3s (regenerable, gitignored)

Per-chapter narration rendered from [`../recording-narration.md`](../recording-narration.md) by
[`../tooling/tts/narrate.mjs`](../../tooling/tts/narrate.mjs) via the ElevenLabs API.

```bash
export ELEVENLABS_API_KEY=sk_...
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs updates-2026-07        # → section-<id>.mp3
```

Files land here as `section-00.mp3` … `section-07.mp3` (one per `## Section` in the narration).
**Not committed** — the narration script + voice ID is the source of truth; audio is regenerable.
Only this `README.md` is tracked.
