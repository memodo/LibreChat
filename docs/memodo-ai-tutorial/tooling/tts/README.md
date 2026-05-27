# tts — TTS narration renderer

> Location: `docs/memodo-ai-tutorial/tooling/tts/`. The script resolves its paths relative to its own location, so it runs from any working directory.

Renders `docs/memodo-ai-tutorial/recording-narration.md` to per-section MP3 files via the **ElevenLabs API**.

No npm dependencies — uses Node 20+ built-in `fetch`.

## Quick start

```bash
# 1. Create an ElevenLabs account at https://elevenlabs.io.
#    The free tier (no subscription, no credit card) gives ~20K TTS
#    characters of "Flash"-class output or ~10K characters of high-quality
#    multilingual output. That's enough to validate voice + pacing on a
#    few sections before deciding how to pay for the rest. See "How to
#    pay for this" below.

# 2. Grab your API key: Profile → API key
export ELEVENLABS_API_KEY=sk_...

# 3. (Optional) Browse your voice library to pick a different voice
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --list-voices

# 4. (Recommended) Dry-run first to see the character cost
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --dry-run

# 5. Render a couple of sections first to audition the voice
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --sections 00,01

# 6. Once you're happy, render everything
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs

# Output lands in docs/memodo-ai-tutorial/audio/section-<id>.mp3
```

## Common workflows

```bash
# Re-render just one section after editing the narration
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --sections 08 --force

# Render with a different voice (use voice_id from --list-voices)
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --voice onwK4e9ZLuTAKqWW03F9   # Daniel — British male

# Use the latest model (if your account has access)
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --model eleven_v3

# Resume an interrupted run (existing files are skipped by default)
node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs
```

## Default settings

- **Voice**: `21m00Tcm4TlvDq8ikWAM` (Rachel) — calm, narration-friendly American English female. Override with `--voice <voice_id>`.
- **Model**: `eleven_multilingual_v2` — most stable, supports English and German. Override with `--model`.
- **Voice settings**: `stability=0.5`, `similarity_boost=0.75`, `speaker_boost=true`. Tweak with `--stability` / `--similarity`.

## Voice picking tips

A tutorial benefits from a narration-style voice — clear articulation, moderate pace, warm but not playful. Try these from the ElevenLabs default library:

| Voice | ID | Notes |
|---|---|---|
| Rachel | `21m00Tcm4TlvDq8ikWAM` | Calm female narrator (default). Recommended starting point. |
| Daniel | `onwK4e9ZLuTAKqWW03F9` | Clear British male, classic narrator vibe. |
| Antoni | `ErXwobaYiN019PkySvjV` | Well-rounded American male, very natural. |
| Bella | `EXAVITQu4vr4xnSDxMaL` | Soft American female. |
| Adam | `pNInz6obpgDQGcFmaJgB` | Deep American male, slightly more formal. |

For a German variant of the tutorial, the same script translated will work with `eleven_multilingual_v2`. ElevenLabs has both German-native voices in the public library (e.g. *Anika*, *Otto*) and most "Premade" voices can speak German with the multilingual model, just with a slight English accent.

## How to pay for this

The current narration script is ~3,400 words; stripped of cues and director notes (which the renderer skips automatically) it's around 17,000 characters. Confirm for your exact script with `--dry-run`.

ElevenLabs offers three relevant ways to pay. The right one depends on how often you'll render.

### Option 1 — Pay-as-you-go (recommended for occasional use)

You create an ElevenLabs account but **don't subscribe**. You add a payment method and pay only for what you generate.

- **Rate**: $0.05–$0.10 per 1,000 TTS characters (depends on model — Flash is cheapest, Multilingual v2 is in the middle, Eleven v3 is the most expensive).
- **One full render of our 17K narration**: roughly **$0.85 – $1.70**.
- **One re-render of a single ~1K-char section**: roughly **$0.05 – $0.10**.

For one tutorial video plus a couple of re-renders, you'll spend **under $5 total**. No recurring charge. No subscription to remember to cancel. This is almost certainly the right choice for video #1.

### Option 2 — Free tier (validation only)

Free tier gives you an API key with a small included quota. Use it to:

- Verify the renderer works in your environment
- Audition 2–3 voices on the first section
- Confirm pacing before committing to the full render

Don't try to fit the whole tutorial in the free tier — you'll hit the cap mid-render.

### Option 3 — Monthly subscription (only if recurring)

If video production becomes recurring — multiple tutorials per quarter, lots of iteration, or you want German variants of every section — a monthly plan starts to make sense. Cross the threshold when your projected PAYG spend exceeds the subscription price.

| Tier | Price | Use if… |
|---|---|---|
| Starter | $6/mo | You expect ~2 full renders / month |
| Creator | $11 first month / $22 ongoing | Active iteration, 4+ renders / month, or German + English |
| Pro | $99/mo | Bulk production, multiple tutorials concurrent |

The `/pricing` and `/pricing/api` pages on the ElevenLabs site disagree on exact character quotas (different number depending on whether they're showing high-quality or Flash-model character counts). Verify against your account dashboard once you've registered — the Usage page shows the canonical numbers for your tier.

### Bottom line

**Start with the free tier, then move to pay-as-you-go.** Skip the subscription unless and until you find yourself producing video #2.

## Tweaking voice settings

The two settings worth knowing:

- **`stability`** (0.0–1.0): lower = more emotion/variability across sentences, higher = more consistent monotone. Tutorials usually want 0.4–0.6.
- **`similarity_boost`** (0.0–1.0): how closely the rendered audio stays to the voice's reference recording. Higher = more like the original voice but can introduce artifacts on long passages. 0.7–0.8 is typical.

If a section sounds robotic or rushes punctuation, try slightly lowering stability. If a section sounds unnatural at sentence boundaries, raise similarity.

## SSML-style fine control

ElevenLabs supports a subset of SSML tags. The two most useful in narration:

- `<break time="800ms"/>` — explicit pause (use for emphasis between sentences or sections)
- `<phoneme alphabet="ipa" ph="...">...</phoneme>` — pronunciation override (use for brand names the voice mispronounces)

Edit `recording-narration.md` to add these tags inline; the renderer passes them through.

## Output layout

```
docs/memodo-ai-tutorial/audio/
  section-00.mp3       cold open (~10s)
  section-01.mp3       welcome (~45s)
  section-02.mp3       interface tour (~60s)
  ...
  section-99.mp3       outro (~15s)
```

These are not committed to git (`docs/memodo-ai-tutorial/audio/.gitignore` excludes `*.mp3`). The narration script + voice ID is the source of truth; audio is regenerable.

## Troubleshooting

- **HTTP 401**: API key missing or invalid. `echo $ELEVENLABS_API_KEY` to verify.
- **HTTP 422 "unusual_activity"**: ElevenLabs flagged your account (often a free-tier rate limit). Wait an hour or upgrade.
- **HTTP 429**: rate limit. Re-run after a minute; the script's resumability means it won't re-do completed sections.
- **Section IDs not matched**: the script splits on `^## Section <id>` headings. If you renamed sections, update `--sections` filters.
